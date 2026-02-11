// ============================================================================
// STRATEGIC CONQUEST - AI TACTICAL MANAGER
// ============================================================================
// Handles combat unit assignments: hunting, escorting, defending, patrolling.
// Priority: player transports > carriers > battleships > bombers > defense
//
// Dependencies: ai-helpers.js, game-constants.js, movement-engine.js, fog-of-war.js

import { UNIT_SPECS, ALL_DIRS, WATER, manhattanDistance } from './game-constants.js';
import { isAdjacentToWater } from './movement-engine.js';
import { calculateVisibility } from './fog-of-war.js';
import {
  PHASE, AI_CONFIG, log,
  findNearest, floodFillLand
} from './ai-helpers.js';

const logTactical = (...args) => console.log('[AI][TACTICAL]', ...args);

// ============================================================================
// THREAT DETECTION
// ============================================================================

/**
 * Scan visible tiles for player threats. Returns categorized threat list.
 */
export function detectThreats(state, knowledge) {
  const threats = {
    playerTransports: [],
    playerNavalCombat: [],
    playerFighters: [],
    playerBombers: [],
    threatenedCities: []
  };

  const visibility = calculateVisibility(state, 'ai');
  const aiCities = Object.entries(state.cities)
    .filter(([_, c]) => c.owner === 'ai')
    .map(([key, c]) => ({ key, ...c }));

  for (const key of visibility) {
    const [x, y] = key.split(',').map(Number);
    const playerUnits = state.units.filter(u =>
      u.x === x && u.y === y && u.owner === 'player' && !u.aboardId
    );

    for (const unit of playerUnits) {
      if (unit.type === 'transport') {
        threats.playerTransports.push(unit);
        // Check proximity to AI cities
        for (const city of aiCities) {
          const dist = manhattanDistance(x, y, city.x, city.y);
          if (dist <= AI_CONFIG.tactical.transportThreatRange) {
            threats.threatenedCities.push({ city, threat: unit, distance: dist });
          }
        }
      } else if (['destroyer', 'submarine', 'battleship', 'carrier'].includes(unit.type)) {
        threats.playerNavalCombat.push(unit);
      } else if (unit.type === 'fighter') {
        threats.playerFighters.push(unit);
      } else if (unit.type === 'bomber') {
        threats.playerBombers.push(unit);
      }
    }
  }

  threats.threatenedCities.sort((a, b) => a.distance - b.distance);

  if (threats.playerTransports.length > 0) {
    logTactical(`Detected ${threats.playerTransports.length} player transports`);
  }
  if (threats.threatenedCities.length > 0) {
    logTactical(`${threats.threatenedCities.length} cities under threat`);
  }

  return threats;
}

// ============================================================================
// MAIN TACTICAL ASSIGNMENT
// ============================================================================

/**
 * Assign tactical missions to combat-allocated units.
 *
 * @param {Object} state - Game state
 * @param {Object} knowledge - AI knowledge
 * @param {Array} units - Units allocated to tactical manager
 * @param {Object} threats - From detectThreats()
 * @param {string} phase - Current game phase
 * @param {Array} turnLog
 * @returns {Map<number, Object>} Map of unitId -> { mission }
 */
export function assignTacticalMissions(state, knowledge, units, threats, phase, turnLog) {
  const missions = new Map();

  // Categorize available units
  const destroyers = units.filter(u => u.type === 'destroyer');
  const submarines = units.filter(u => u.type === 'submarine');
  const battleships = units.filter(u => u.type === 'battleship');
  const carriers = units.filter(u => u.type === 'carrier');
  const fighters = units.filter(u => u.type === 'fighter');
  const bombers = units.filter(u => u.type === 'bomber');

  // Track claimed hunt targets
  const claimedTargets = new Set();

  // ===== PRIORITY 1: Hunt Player Transports =====
  // Transports are the highest value targets (transport + 6 tanks = 34 production days)
  if (threats.playerTransports.length > 0) {
    assignHuntMissions(
      [...destroyers, ...submarines, ...battleships],
      threats.playerTransports,
      claimedTargets,
      missions,
      'hunt_transport',
      9
    );
  }

  // ===== PRIORITY 2: Hunt Player Carriers =====
  const playerCarriers = threats.playerNavalCombat.filter(u => u.type === 'carrier');
  if (playerCarriers.length > 0) {
    const unassigned = getUnassigned([...destroyers, ...submarines, ...battleships], missions);
    assignHuntMissions(unassigned, playerCarriers, claimedTargets, missions, 'hunt_carrier', 7);
  }

  // ===== PRIORITY 3: Hunt Player Battleships =====
  const playerBattleships = threats.playerNavalCombat.filter(u => u.type === 'battleship');
  if (playerBattleships.length > 0) {
    const unassigned = getUnassigned([...submarines, ...destroyers], missions);
    assignHuntMissions(unassigned, playerBattleships, claimedTargets, missions, 'hunt_battleship', 6);
  }

  // ===== PRIORITY 4: Defend Threatened Cities =====
  if (threats.threatenedCities.length > 0) {
    assignCityDefense(state, threats, fighters, destroyers, missions, turnLog);
  }

  // ===== PRIORITY 5: Escort AI Transports =====
  const aiTransports = state.units.filter(u =>
    u.owner === 'ai' && u.type === 'transport' && !u.aboardId
  );
  if (aiTransports.length > 0 && (phase === PHASE.NAVAL || phase === PHASE.LATE_GAME)) {
    assignEscorts(aiTransports, destroyers, missions);
  }

  // ===== PRIORITY 6: Fighter Patrol =====
  const unassignedFighters = getUnassigned(fighters, missions);
  if (unassignedFighters.length > 0) {
    assignPatrolMissions(unassignedFighters, state, knowledge, missions);
  }

  // ===== PRIORITY 7: Opportunistic Fighter Hunting =====
  if (threats.playerFighters.length > 0) {
    const unassignedCombat = getUnassigned([...destroyers, ...battleships], missions);
    for (const unit of unassignedCombat) {
      const nearFighter = findNearest(unit, threats.playerFighters);
      if (nearFighter) {
        const dist = manhattanDistance(unit.x, unit.y, nearFighter.x, nearFighter.y);
        if (dist <= 4) {
          missions.set(unit.id, {
            mission: {
              type: 'hunt_target',
              target: { x: nearFighter.x, y: nearFighter.y },
              priority: 4,
              assignedBy: 'tactical',
              reason: `hunt fighter (dist=${dist})`
            }
          });
        }
      }
    }
  }

  // ===== Remaining unassigned: explore water (dual purpose) =====
  const allUnassigned = getUnassigned(units, missions);
  for (const unit of allUnassigned) {
    // Naval units without missions - default to water exploration
    if (UNIT_SPECS[unit.type]?.isNaval) {
      missions.set(unit.id, {
        mission: {
          type: 'patrol_area',
          target: null,
          priority: 2,
          assignedBy: 'tactical',
          reason: 'tactical_idle_patrol'
        }
      });
    }
  }

  return missions;
}

// ============================================================================
// HUNT MISSION ASSIGNMENT
// ============================================================================

function assignHuntMissions(hunters, targets, claimedTargets, missions, missionType, priority) {
  for (const target of targets) {
    const targetKey = `${target.x},${target.y}`;
    if (claimedTargets.has(targetKey)) continue;

    // Find closest unassigned hunter
    const available = hunters.filter(u => !missions.has(u.id));
    if (available.length === 0) break;

    const nearest = findNearest(target, available);
    if (nearest) {
      const dist = manhattanDistance(nearest.x, nearest.y, target.x, target.y);
      claimedTargets.add(targetKey);
      missions.set(nearest.id, {
        mission: {
          type: 'hunt_target',
          target: { x: target.x, y: target.y },
          priority,
          assignedBy: 'tactical',
          reason: `${missionType} at (${target.x},${target.y}) dist=${dist}`
        }
      });
      logTactical(`${nearest.type}#${nearest.id} -> ${missionType} at (${target.x},${target.y})`);
    }
  }
}

// ============================================================================
// CITY DEFENSE
// ============================================================================

function assignCityDefense(state, threats, fighters, destroyers, missions, turnLog) {
  for (const threatened of threats.threatenedCities) {
    const city = threatened.city;

    // Check if naval unit can intercept
    const unassignedDestroyers = getUnassigned(destroyers, missions);
    const canIntercept = unassignedDestroyers.some(d => {
      const dist = manhattanDistance(d.x, d.y, threatened.threat.x, threatened.threat.y);
      return dist <= d.movesLeft * 2;
    });

    if (canIntercept) {
      // Assign destroyer to intercept
      const nearest = findNearest(threatened.threat, unassignedDestroyers);
      if (nearest) {
        missions.set(nearest.id, {
          mission: {
            type: 'hunt_target',
            target: { x: threatened.threat.x, y: threatened.threat.y },
            priority: 9,
            assignedBy: 'tactical',
            reason: `intercept transport threatening city (${city.x},${city.y})`
          }
        });
      }
    } else {
      // No naval can intercept - assign fighter for emergency intercept
      const unassignedFighters = getUnassigned(fighters, missions);
      if (unassignedFighters.length > 0 && threatened.distance <= 4) {
        const nearest = findNearest(threatened.threat, unassignedFighters);
        if (nearest) {
          missions.set(nearest.id, {
            mission: {
              type: 'hunt_target',
              target: { x: threatened.threat.x, y: threatened.threat.y },
              priority: 9,
              assignedBy: 'tactical',
              reason: `emergency intercept transport (dist=${threatened.distance})`
            }
          });
          logTactical(`fighter#${nearest.id}: emergency intercept transport threatening (${city.x},${city.y})`);
        }
      }
    }

    // Also move tanks to defend if reachable by land
    const aiTanks = state.units.filter(u =>
      u.owner === 'ai' && u.type === 'tank' && !u.aboardId && u.movesLeft > 0
    );
    for (const tank of aiTanks) {
      if (missions.has(tank.id)) continue;
      const reachable = floodFillLand(tank.x, tank.y, state);
      if (reachable.has(`${city.x},${city.y}`)) {
        const dist = manhattanDistance(tank.x, tank.y, city.x, city.y);
        if (dist <= 6) {
          missions.set(tank.id, {
            mission: {
              type: 'defend_city',
              target: { x: city.x, y: city.y },
              priority: 8,
              assignedBy: 'tactical',
              reason: `defend from transport (dist=${dist})`
            }
          });
          break; // One tank per threatened city
        }
      }
    }
  }
}

// ============================================================================
// ESCORT MISSIONS
// ============================================================================

function assignEscorts(aiTransports, destroyers, missions) {
  const unassigned = getUnassigned(destroyers, missions);
  if (unassigned.length === 0) return;

  // Each loaded transport gets one escort if available
  const loadedTransports = aiTransports.filter(t =>
    // Check if transport has cargo
    true // We can't easily check cargo here, so escort any transport
  );

  for (const transport of loadedTransports) {
    if (unassigned.length === 0) break;
    const nearest = findNearest(transport, unassigned.filter(u => !missions.has(u.id)));
    if (!nearest) break;

    const dist = manhattanDistance(nearest.x, nearest.y, transport.x, transport.y);
    if (dist <= 8) {
      missions.set(nearest.id, {
        mission: {
          type: 'escort_transport',
          target: { x: transport.x, y: transport.y },
          priority: 5,
          assignedBy: 'tactical',
          reason: `escort transport#${transport.id}`
        }
      });
      logTactical(`destroyer#${nearest.id}: escorting transport#${transport.id}`);
    }
  }
}

// ============================================================================
// PATROL MISSIONS
// ============================================================================

function assignPatrolMissions(fighters, state, knowledge, missions) {
  const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');
  const coastalCities = aiCities.filter(c =>
    isAdjacentToWater(c.x, c.y, state.map, state.map[0].length, state.map.length)
  );

  if (coastalCities.length === 0) return;

  for (const fighter of fighters) {
    if (missions.has(fighter.id)) continue;

    const targetCity = coastalCities[Math.floor(Math.random() * coastalCities.length)];
    const patrolRadius = 3 + Math.floor(Math.random() * 4);
    const angle = Math.random() * Math.PI * 2;
    const px = Math.round(targetCity.x + Math.cos(angle) * patrolRadius);
    const py = Math.round(targetCity.y + Math.sin(angle) * patrolRadius);

    if (px >= 0 && px < state.width && py >= 0 && py < state.height) {
      missions.set(fighter.id, {
        mission: {
          type: 'patrol_area',
          target: { x: px, y: py },
          priority: 3,
          assignedBy: 'tactical',
          reason: `patrol near city (${targetCity.x},${targetCity.y})`
        }
      });
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function getUnassigned(units, missions) {
  return units.filter(u => !missions.has(u.id));
}

/**
 * Check if a given water tile is near known player combat units.
 * Used for transport route avoidance.
 */
export function getNavalDangerZone(state, knowledge) {
  const dangerTiles = new Set();
  const visibility = calculateVisibility(state, 'ai');

  for (const key of visibility) {
    const [x, y] = key.split(',').map(Number);
    const threats = state.units.filter(u =>
      u.x === x && u.y === y && u.owner === 'player' &&
      ['destroyer', 'submarine', 'battleship', 'carrier'].includes(u.type) &&
      !u.aboardId
    );

    for (const threat of threats) {
      // Mark tiles within threat range as dangerous
      const range = AI_CONFIG.tactical.navalThreatRange;
      for (let dy = -range; dy <= range; dy++) {
        for (let dx = -range; dx <= range; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= range) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height) {
              dangerTiles.add(`${nx},${ny}`);
            }
          }
        }
      }
    }
  }

  return dangerTiles;
}

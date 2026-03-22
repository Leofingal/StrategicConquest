// ============================================================================
// STRATEGIC CONQUEST - AI OPPONENT (Main Orchestrator)
// ============================================================================
// Coordinates the three AI managers and executes step-by-step movement.
// External interface is unchanged: executeAITurn, createAIKnowledge, etc.
//
// Architecture:
//   ai-opponent.js (this file) - orchestration, knowledge, movement
//   ai-helpers.js - shared utilities, constants, logging
//   ai-city-manager.js - production decisions
//   ai-exploration-manager.js - scout/explore/ferry missions
//   ai-tactical-manager.js - combat/escort/defend missions

import {
  WATER, LAND, NEUTRAL_CITY, PLAYER_CITY, AI_CITY, UNIT_SPECS, ALL_DIRS,
  STATUS_READY, STATUS_GOTO, STATUS_USED, STATUS_SKIPPED, STATUS_ABOARD,
  manhattanDistance
} from './game-constants.js';
// Movement engine not directly needed - managers use ai-helpers
import { calculateVisibility } from './fog-of-war.js';

// AI modules
import {
  PHASE, AI_CONFIG, TARGET_DIST, TACTICAL_ALLOCATION,
  log, logPhase, logMission, logTurnSummary,
  findNearest, floodFillLand, getMoveToward, clearPathCache,
  evaluateCombat, getAdjacentEnemies,
  getAdjacentPlayerUnits, isAdjacentToPlayerCity,
  getRefuelPoints, findNearestUnexplored, findBestExploreTarget
} from './ai-helpers.js';
import { planProduction } from './ai-city-manager.js';
import { assignExplorationMissions, updateIslandKnowledge } from './ai-exploration-manager.js';
import { assignTacticalMissions, detectThreats, getNavalDangerZone } from './ai-tactical-manager.js';

// Re-export config for external consumers
export { PHASE, AI_CONFIG };
export const setAIConfig = (c) => Object.assign(AI_CONFIG, c);
export const getAIConfig = () => ({ ...AI_CONFIG });

// ============================================================================
// AI KNOWLEDGE
// ============================================================================

export function createAIKnowledge(startX, startY) {
  return {
    exploredTiles: new Set(),
    startPosition: (startX != null && startY != null) ? { x: startX, y: startY } : null,
    explorationPhase: PHASE.LAND,
    hasSeenPlayerUnit: false,
    hasSeenPlayerCity: false,
    homeIslandTiles: null,
    homeIslandCities: new Set(),
    lostCities: new Set(),
    lastTurnObservations: [],
    knownCities: new Set(),
    islands: []  // Partial island tracking
  };
}

export function getAIStartPosition(gameState) {
  if (!gameState?.cities) return null;
  const aiCity = Object.values(gameState.cities).find(c => c.owner === 'ai');
  return aiCity ? { x: aiCity.x, y: aiCity.y } : null;
}

export function createAIKnowledgeFromState(gameState) {
  const startPos = getAIStartPosition(gameState);
  const k = createAIKnowledge(startPos?.x, startPos?.y);
  const visibility = calculateVisibility(gameState, 'ai');
  for (const key of visibility) {
    k.exploredTiles.add(key);
    if (gameState.cities[key]) k.knownCities.add(key);
  }
  return k;
}

export function recordPlayerObservations(k, observations) {
  return { ...k, lastTurnObservations: observations };
}

// ============================================================================
// KNOWLEDGE UPDATE
// ============================================================================

function updateAIKnowledge(k, state) {
  let knowledge = {
    ...k,
    exploredTiles: new Set(k.exploredTiles),
    knownCities: new Set(k.knownCities || new Set()),
    islands: k.islands ? k.islands.map(i => ({
      ...i,
      tiles: new Set(i.tiles),
      cities: new Set(i.cities),
      coastTiles: new Set(i.coastTiles || new Set())
    })) : []
  };

  // Auto-init start position
  if (!knowledge.startPosition) {
    const startPos = getAIStartPosition(state);
    if (startPos) {
      knowledge.startPosition = startPos;
      log(`Auto-init start: (${startPos.x},${startPos.y})`);
    }
  }

  const vis = calculateVisibility(state, 'ai');

  for (const key of vis) {
    knowledge.exploredTiles.add(key);
    if (state.cities[key]) knowledge.knownCities.add(key);
  }

  // Player contact check
  for (const key of vis) {
    const [x, y] = key.split(',').map(Number);
    if (state.units.find(u => u.x === x && u.y === y && u.owner === 'player' && !u.aboardId)) {
      knowledge.hasSeenPlayerUnit = true;
    }
    if (state.cities[key]?.owner === 'player') knowledge.hasSeenPlayerCity = true;
  }

  // Track lost cities
  for (const [key, city] of Object.entries(state.cities)) {
    if (city.owner === 'player' && knowledge.knownCities.has(key)) {
      knowledge.lostCities.add(key);
    }
  }

  // Home island init
  if (!knowledge.homeIslandTiles && knowledge.startPosition) {
    knowledge.homeIslandTiles = floodFillLand(knowledge.startPosition.x, knowledge.startPosition.y, state);
    log(`Home island: ${knowledge.homeIslandTiles.size} tiles`);
    for (const key of knowledge.homeIslandTiles) {
      if (state.cities[key]) knowledge.homeIslandCities.add(key);
    }
    log(`Home island cities: ${knowledge.homeIslandCities.size}`);
  }

  // Update island tracking
  knowledge = updateIslandKnowledge(knowledge, state);

  return knowledge;
}

// ============================================================================
// PHASE DETERMINATION
// ============================================================================

function determinePhase(k, state) {
  const { explorationPhase } = k;
  const cities = Object.values(state.cities);
  const aiCities = cities.filter(c => c.owner === 'ai').length;
  const playerCities = cities.filter(c => c.owner === 'player').length;
  const neutralCities = cities.filter(c => c.owner === 'neutral').length;
  const totalCities = cities.length;
  const aiUnits = state.units.filter(u => u.owner === 'ai' && !u.aboardId);
  const playerUnits = state.units.filter(u => u.owner === 'player' && !u.aboardId);

  const homeExp = getHomeExplored(k, state);
  const homeCitiesCaptured = checkHomeCitiesCaptured(k, state);
  const totalTiles = state.width * state.height;
  const mapExplored = k.exploredTiles.size / totalTiles;

  // Debug: always log phase check values
  logPhase(`Check: phase=${explorationPhase}, homeExp=${(homeExp*100).toFixed(1)}%, homeCitiesCaptured=${homeCitiesCaptured}, homeIslandTiles=${k.homeIslandTiles?.size || 'null'}, homeIslandCities=${k.homeIslandCities?.size || 0}, mapExp=${(mapExplored*100).toFixed(1)}%`);

  // LAND -> TRANSITION
  if (explorationPhase === PHASE.LAND) {
    // PRIMARY: All home island cities captured - this is the strategic goal of land phase
    if (homeCitiesCaptured && k.homeIslandCities && k.homeIslandCities.size > 0) {
      logPhase(`LAND -> TRANSITION: All ${k.homeIslandCities.size} home cities captured (homeExp=${(homeExp*100).toFixed(0)}%)`);
      return PHASE.TRANSITION;
    }
    // TANK THRESHOLD: Once 6 active tanks exist, the land force is large enough
    // to keep capturing home cities without full focus — start naval production now.
    const activeTanks = state.units.filter(u => u.owner === 'ai' && u.type === 'tank' && !u.aboardId).length;
    if (activeTanks >= 6) {
      logPhase(`LAND -> TRANSITION: 6 active tanks (${activeTanks}) — starting naval ramp`);
      return PHASE.TRANSITION;
    }
    // SECONDARY: 90% explored + cities captured (original trigger)
    if (homeExp >= AI_CONFIG.exploration.homeComplete && homeCitiesCaptured) {
      logPhase(`LAND -> TRANSITION: Home ${(homeExp*100).toFixed(0)}% + cities captured`);
      return PHASE.TRANSITION;
    }
    // FALLBACK: 100% home explored
    if (homeExp >= 1.0) {
      logPhase(`LAND -> TRANSITION: Home 100%`);
      return PHASE.TRANSITION;
    }
    // EDGE CASE: explored a lot but stuck
    if (mapExplored > 0.05 && aiCities >= 2) {
      logPhase(`LAND -> TRANSITION: Edge case ${(mapExplored*100).toFixed(1)}% explored, ${aiCities} cities`);
      return PHASE.TRANSITION;
    }
  }

  // TRANSITION -> NAVAL
  if (explorationPhase === PHASE.TRANSITION) {
    if (k.hasSeenPlayerUnit || k.hasSeenPlayerCity) {
      logPhase(`TRANSITION -> NAVAL: Player contact`);
      return PHASE.NAVAL;
    }
    if (mapExplored >= AI_CONFIG.exploration.navalMapThreshold) {
      logPhase(`TRANSITION -> NAVAL: ${(mapExplored*100).toFixed(1)}% explored`);
      return PHASE.NAVAL;
    }
  }

  // NAVAL -> LATE_GAME
  if (explorationPhase === PHASE.NAVAL) {
    const neutralRatio = totalCities > 0 ? neutralCities / totalCities : 1;
    const aiControl = totalCities > 0 ? aiCities / totalCities : 0;
    const aiStr = aiUnits.reduce((s, u) => s + u.strength, 0);
    const pStr = playerUnits.reduce((s, u) => s + u.strength, 0);

    if (neutralRatio < AI_CONFIG.exploration.lateNeutral) return PHASE.LATE_GAME;
    if (aiControl >= AI_CONFIG.exploration.lateCityControl) return PHASE.LATE_GAME;
    if (pStr > 0 && aiStr / pStr >= AI_CONFIG.exploration.lateStrength) return PHASE.LATE_GAME;
  }

  return explorationPhase;
}

function getHomeExplored(k, state) {
  if (!k.homeIslandTiles || k.homeIslandTiles.size === 0) return 0;
  let explored = 0;
  for (const key of k.homeIslandTiles) {
    if (k.exploredTiles.has(key)) explored++;
  }
  return explored / k.homeIslandTiles.size;
}

function checkHomeCitiesCaptured(k, state) {
  if (!k.homeIslandCities || k.homeIslandCities.size === 0) return true;
  for (const key of k.homeIslandCities) {
    if (state.cities[key]?.owner !== 'ai') return false;
  }
  return true;
}

// ============================================================================
// UNIT ALLOCATION
// ============================================================================

/**
 * Split units between exploration and tactical managers based on phase.
 */
function allocateUnits(state, phase) {
  const aiUnits = state.units.filter(u => u.owner === 'ai' && !u.aboardId && u.movesLeft > 0);
  const explorationUnits = [];
  const tacticalUnits = [];
  const allocation = TACTICAL_ALLOCATION[phase] || TACTICAL_ALLOCATION[PHASE.LAND];

  // Tanks and transports always go to exploration
  for (const unit of aiUnits) {
    if (unit.type === 'tank' || unit.type === 'transport') {
      explorationUnits.push(unit);
      continue;
    }

    const tacticalPct = allocation[unit.type] || 0;
    if (tacticalPct <= 0) {
      explorationUnits.push(unit);
    } else if (tacticalPct >= 1.0) {
      tacticalUnits.push(unit);
    } else {
      // Split: use unit ID for deterministic assignment
      if ((unit.id % 100) / 100 < tacticalPct) {
        tacticalUnits.push(unit);
      } else {
        explorationUnits.push(unit);
      }
    }
  }

  return { explorationUnits, tacticalUnits };
}

// ============================================================================
// STEP-BY-STEP MOVEMENT EXECUTION
// ============================================================================

function executeStepByStepMovements(state, knowledge, turnLog, missions) {
  const MAX_MOVES = 20;
  let s = { ...state, units: [...state.units], cities: { ...state.cities }, map: state.map.map(r => [...r]) };
  let k = {
    ...knowledge,
    exploredTiles: new Set(knowledge.exploredTiles),
    knownCities: new Set(knowledge.knownCities || new Set()),
    islands: knowledge.islands ? knowledge.islands.map(i => ({
      ...i, tiles: new Set(i.tiles), cities: new Set(i.cities), coastTiles: new Set(i.coastTiles || new Set())
    })) : []
  };
  const observations = [];
  const combatEvents = [];  // Track detailed combat results for player report
  let threats = detectThreats(s, k);

  // Observation tracking
  const observationState = new Map();
  for (const unit of s.units) {
    if (unit.owner === 'ai' && !unit.aboardId) {
      const startObs = getAdjacentPlayerUnits(unit.x, unit.y, s.units);
      const startCity = isAdjacentToPlayerCity(unit.x, unit.y, s.cities);
      observationState.set(unit.id, {
        trail: [{ x: unit.x, y: unit.y }],
        wasObserved: startObs.length > 0 || startCity,
        observers: [...startObs]
      });
    }
  }

  for (let movesRequired = MAX_MOVES; movesRequired >= 1; movesRequired--) {
    const unitsWithMoves = s.units.filter(u =>
      u.owner === 'ai' && !u.aboardId && u.movesLeft === movesRequired
    );
    if (unitsWithMoves.length === 0) continue;

    for (const unitRef of unitsWithMoves) {
      const unitIdx = s.units.findIndex(u => u.id === unitRef.id);
      if (unitIdx < 0) continue;
      const unit = s.units[unitIdx];
      if (unit.movesLeft !== movesRequired) continue;

      // === PRE-MOVEMENT: Transport unload check ===
      // If transport has cargo and is adjacent to a capturable city, unload NOW
      // This handles the case where the transport arrived last turn and is sitting at target
      if (UNIT_SPECS[unit.type]?.carriesTanks) {
        const cargo = s.units.filter(cu => cu.aboardId === unit.id);
        if (cargo.length > 0) {
          const unloadResult = tryTransportUnload(s, unitIdx, turnLog, missions);
          if (unloadResult.unloaded) {
            s = unloadResult.state;
            // Re-find unit index after state mutation
            const newIdx = s.units.findIndex(u => u.id === unit.id);
            if (newIdx >= 0) {
              s.units[newIdx] = { ...s.units[newIdx], movesLeft: 0, status: STATUS_USED };
            }
            continue; // Transport is done for this turn
          }
        }
      }

      const decision = decideNextStep(unit, s, k, threats, missions);

      if (decision.action === 'wait') {
        s.units[unitIdx] = { ...unit, movesLeft: 0, status: STATUS_USED };
        continue;
      }

      if (decision.action === 'attack') {
        const t = decision.target;
        turnLog.push(`${unit.type}@${unit.x},${unit.y} attacks ${t.enemy.type}`);
        const result = handleCombat(s, unitIdx, t, t.enemy, turnLog);
        s = result.state;
        
        // Record detailed combat event for player report
        if (result.combatEvent) {
          combatEvents.push(result.combatEvent);
        }
        
        updateObservation(observationState, unit.id, t.x, t.y, true);
        continue;
      }

      if (decision.action === 'capture') {
        const t = decision.target;
        turnLog.push(`${unit.type} captured city at ${t.x},${t.y}`);
        const cityKey = `${t.x},${t.y}`;
        s.cities = { ...s.cities, [cityKey]: { ...t.city, owner: 'ai', producing: 'tank', progress: {} } };
        s.map[t.y][t.x] = AI_CITY;
        // Refuel any friendly aircraft on the newly captured city tile
        s.units = s.units.map(u => {
          if (u.x === t.x && u.y === t.y && u.owner === 'ai' && !u.aboardId && UNIT_SPECS[u.type].isAir && UNIT_SPECS[u.type].fuel) {
            return { ...u, fuel: UNIT_SPECS[u.type].fuel };
          }
          return u;
        });
        s.units = s.units.filter(u => u.id !== unit.id);
        continue;
      }

      if (decision.action === 'move_toward') {
        // Transports avoid known enemy naval positions — compute danger zone tiles once
        // per move decision and pass as tile cost hints to the pathfinder.
        const avoidTiles = UNIT_SPECS[unit.type]?.carriesTanks ? getNavalDangerZone(s, k) : null;
        const moveTarget = getMoveToward(unit, decision.target, s, avoidTiles);
        if (moveTarget) {
          s = executeMove(s, unitIdx, moveTarget, unit, turnLog, observationState);
        } else {
          // No valid move (unreachable target or completely surrounded) — consume all moves
          // so the unit does not waste further attempts this turn. Mission will be
          // recalculated next turn; the exploration manager will pick a reachable target.
          s.units[unitIdx] = { ...unit, movesLeft: 0, status: STATUS_USED };
        }
      }
    }

    // Update fog after each sub-step level
    const newVis = calculateVisibility(s, 'ai');
    const prevSize = k.exploredTiles.size;
    for (const key of newVis) {
      k.exploredTiles.add(key);
      if (s.cities[key] && !k.knownCities.has(key)) {
        k.knownCities.add(key);
        log(`Discovered city at ${key} (owner: ${s.cities[key].owner})`);
      }
    }
    const newTiles = k.exploredTiles.size - prevSize;
    if (newTiles > 5) {
      // Only update islands when meaningful new territory discovered
      k = updateIslandKnowledge(k, s);
    }

    // Update threats
    threats = detectThreats(s, k);

    // Contact check
    for (const key of newVis) {
      const [x, y] = key.split(',').map(Number);
      if (s.units.find(u => u.x === x && u.y === y && u.owner === 'player' && !u.aboardId)) {
        k.hasSeenPlayerUnit = true;
      }
      if (s.cities[key]?.owner === 'player') k.hasSeenPlayerCity = true;
    }
  }

  // Mark remaining units as done
  s.units = s.units.map(u => {
    if (u.owner === 'ai' && u.movesLeft > 0 && !u.aboardId) {
      return { ...u, movesLeft: 0, status: STATUS_USED };
    }
    return u;
  });

  // Compile observations
  for (const [unitId, obsState] of observationState) {
    if (obsState.trail.length > 1) {
      const unit = s.units.find(u => u.id === unitId);
      observations.push({
        unitType: unit?.type || 'unknown',
        unitId,
        trail: obsState.trail,
        observedBy: [...new Set(obsState.observers.map(o => o.id))],
        combat: turnLog.some(l => l.includes('COMBAT'))
      });
    }
  }

  return { state: s, knowledge: k, observations, combatEvents };
}

// ============================================================================
// PER-STEP DECISION (immediate reactions + mission following)
// ============================================================================

function decideNextStep(unit, state, knowledge, threats, missions) {
  const spec = UNIT_SPECS[unit.type];

  // Collect city lists
  const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');

  // ===== FUEL CRITICAL =====
  if (spec.fuel) {
    const refuelPoints = getRefuelPoints(state);
    if (refuelPoints.length > 0) {
      const nearestRefuel = findNearest(unit, refuelPoints);
      const distToRefuel = nearestRefuel ? manhattanDistance(unit.x, unit.y, nearestRefuel.x, nearestRefuel.y) : Infinity;
      if (unit.fuel <= distToRefuel + 4) {
        return { action: 'move_toward', target: nearestRefuel, reason: 'fuel_critical' };
      }
    }
  }

  // ===== ADJACENT ATTACK OPPORTUNITY =====
  const adjacentEnemies = getAdjacentEnemies(unit, state);
  for (const { enemy, x, y } of adjacentEnemies) {
    const evaluation = evaluateCombat(unit, enemy, state);
    if (evaluation.shouldAttack) {
      return { action: 'attack', target: { x, y, enemy }, reason: evaluation.reason };
    }
  }

  // ===== ADJACENT CITY CAPTURE =====
  if (spec.canCapture) {
    for (const [dx, dy] of ALL_DIRS) {
      const nx = unit.x + dx, ny = unit.y + dy;
      const city = state.cities[`${nx},${ny}`];
      if (city && (city.owner === 'neutral' || city.owner === 'player')) {
        const defenders = state.units.filter(d =>
          d.x === nx && d.y === ny && d.owner === 'player' && !d.aboardId
        );
        if (defenders.length === 0) {
          return { action: 'capture', target: { x: nx, y: ny, city }, reason: 'adjacent_city' };
        }
      }
    }
  }

  // ===== TRANSPORT WITH CARGO: Dynamic destination finding =====
  // If transport has loaded tanks but its mission was just a pickup (or no delivery target),
  // dynamically find a city to deliver to, or explore water while carrying cargo.
  if (spec.carriesTanks) {
    const cargo = state.units.filter(cu => cu.aboardId === unit.id);
    const assignment = missions.get(unit.id);
    const mission = assignment?.mission;

    if (cargo.length > 0) {
      const isPickupMission = mission?.type === 'transport_pickup';
      const isDeliveryWithoutTarget = mission?.type === 'ferry_invasion' && !mission.targetKey;
      const isAtPickupTarget = isPickupMission && mission.target &&
        manhattanDistance(unit.x, unit.y, mission.target.x, mission.target.y) <= 1;

      if (isPickupMission || isDeliveryWithoutTarget) {
        // If we haven't reached the pickup point yet, keep going there to load more
        if (isPickupMission && !isAtPickupTarget) {
          return { action: 'move_toward', target: mission.target, reason: 'transport_pickup_enroute' };
        }

        // We have cargo - find a delivery destination
        // Priority 1: Known neutral or player cities
        const knownCities = [];
        for (const [key, city] of Object.entries(state.cities)) {
          if (!knowledge.exploredTiles.has(key)) continue;
          if (city.owner === 'neutral' || city.owner === 'player') {
            knownCities.push(city);
          }
        }

        if (knownCities.length > 0) {
          // Find nearest city and route to adjacent water
          const sorted = knownCities
            .map(c => ({ ...c, dist: manhattanDistance(unit.x, unit.y, c.x, c.y) }))
            .sort((a, b) => a.dist - b.dist);

          for (const dest of sorted) {
            // Find water tile adjacent to city
            for (const [ddx, ddy] of ALL_DIRS) {
              const wx = dest.x + ddx, wy = dest.y + ddy;
              if (state.map[wy]?.[wx] === WATER) {
                log(`[TRANSPORT] #${unit.id} loaded, redirecting to city (${dest.x},${dest.y}) via water (${wx},${wy})`);
                // Update the mission in-place for future steps this turn
                missions.set(unit.id, {
                  mission: {
                    type: 'ferry_invasion',
                    target: { x: wx, y: wy },
                    targetKey: `${dest.x},${dest.y}`,
                    priority: 8,
                    assignedBy: 'exploration',
                    reason: `deliver to city (${dest.x},${dest.y})`
                  }
                });
                return { action: 'move_toward', target: { x: wx, y: wy }, reason: 'transport_deliver' };
              }
            }
          }
        }

        // Priority 2: No known cities - explore water to find new islands
        log(`[TRANSPORT] #${unit.id} loaded but no target cities, exploring`);
        const waterTarget = findBestExploreTarget(unit, state, knowledge, 'water');
        if (waterTarget) {
          return { action: 'move_toward', target: waterTarget, reason: 'transport_explore_loaded' };
        }

        // Priority 3: No water to explore - wait
        return { action: 'wait', reason: 'transport_loaded_no_destination' };
      }
    }
  }

  // ===== TRANSPORT: EVADE NEARBY NAVAL THREATS =====
  // If a transport finds itself within close range of an enemy combat ship, abort the
  // current mission and retreat toward the nearest friendly city. The avoidTiles routing
  // in getMoveToward handles proactive rerouting; this handles reactive evasion when
  // already inside the danger zone.
  if (spec.carriesTanks) {
    const nearbyThreats = threats.playerNavalCombat.filter(t =>
      manhattanDistance(unit.x, unit.y, t.x, t.y) <= 3
    );
    if (nearbyThreats.length > 0) {
      const safeTarget = aiCities.reduce((best, c) => {
        const d = manhattanDistance(unit.x, unit.y, c.x, c.y);
        return (!best || d < best.d) ? { x: c.x, y: c.y, d } : best;
      }, null);
      if (safeTarget) {
        log(`[TRANSPORT] #${unit.id} at (${unit.x},${unit.y}) evading ${nearbyThreats.length} threat(s), retreating to city at (${safeTarget.x},${safeTarget.y})`);
        return { action: 'move_toward', target: safeTarget, reason: 'transport_evade_threat' };
      }
      // No friendly city to flee to — hold position rather than sailing deeper into danger
      log(`[TRANSPORT] #${unit.id} cornered by threats, holding position`);
      return { action: 'wait', reason: 'transport_cornered_by_threat' };
    }
  }

  // ===== FOLLOW ASSIGNED MISSION =====
  const assignment = missions.get(unit.id);
  if (assignment?.mission?.target) {
    const m = assignment.mission;

    // For aircraft following missions, check fuel allows it
    if (spec.fuel) {
      const refuelPoints = getRefuelPoints(state);
      const nearestRefuel = findNearest(unit, refuelPoints);
      if (nearestRefuel) {
        const distToRefuel = manhattanDistance(unit.x, unit.y, nearestRefuel.x, nearestRefuel.y);
        const fuelAfterReturn = unit.fuel - distToRefuel;
        if (fuelAfterReturn <= 4) {
          // Must return to refuel instead of following mission
          return { action: 'move_toward', target: nearestRefuel, reason: 'fuel_return' };
        }
      }
    }

    return { action: 'move_toward', target: m.target, reason: m.reason || m.type };
  }

  // ===== NO MISSION - DEFAULT BEHAVIOR =====

  // Fighters with no mission: find nearest unexplored
  if (unit.type === 'fighter') {
    const refuelPoints = getRefuelPoints(state);
    const nearestRefuel = findNearest(unit, refuelPoints);
    if (nearestRefuel) {
      const distToRefuel = manhattanDistance(unit.x, unit.y, nearestRefuel.x, nearestRefuel.y);
      if (unit.fuel - distToRefuel > 4) {
        const target = findNearestUnexplored(unit, state, knowledge);
        if (target) return { action: 'move_toward', target, reason: 'explore_default' };
      }
      if (distToRefuel > 0) return { action: 'move_toward', target: nearestRefuel, reason: 'return_base' };
    }
    return { action: 'wait', reason: 'fighter_at_base' };
  }

  // Naval with no mission: explore water
  if (spec.isNaval) {
    const target = findBestExploreTarget(unit, state, knowledge, 'water');
    if (target) return { action: 'move_toward', target, reason: 'explore_water_default' };
  }

  // Tank with no mission: explore land
  if (spec.isLand) {
    const reachable = floodFillLand(unit.x, unit.y, state);
    const target = findBestExploreTarget(unit, state, knowledge, 'land');
    if (target && reachable.has(`${target.x},${target.y}`)) {
      return { action: 'move_toward', target, reason: 'explore_land_default' };
    }
  }

  return { action: 'wait', reason: 'idle' };
}

// ============================================================================
// MOVEMENT HELPERS
// ============================================================================

function executeMove(state, unitIdx, moveTarget, unit, turnLog, observationState) {
  let s = { ...state, units: [...state.units] };
  const spec = UNIT_SPECS[unit.type];

  s.units[unitIdx] = {
    ...s.units[unitIdx],
    x: moveTarget.x,
    y: moveTarget.y,
    movesLeft: s.units[unitIdx].movesLeft - 1
  };

  // Fuel consumption
  if (spec.fuel && s.units[unitIdx].fuel != null) {
    s.units[unitIdx] = { ...s.units[unitIdx], fuel: s.units[unitIdx].fuel - 1 };
    const city = s.cities[`${moveTarget.x},${moveTarget.y}`];
    if (s.units[unitIdx].fuel <= 0 && (!city || city.owner !== 'ai')) {
      turnLog.push(`${unit.type} crashed at (${moveTarget.x},${moveTarget.y})`);
      s.units = s.units.filter(u => u.id !== unit.id);
      return s;
    }
    if (city?.owner === 'ai') {
      s.units[unitIdx] = { ...s.units[unitIdx], fuel: spec.fuel };
    }
  }

  // Transport auto-loading
  if (spec.carriesTanks) {
    s = handleTransportAutoLoad(s, unitIdx, turnLog);
    s = handleTransportAutoUnload(s, unitIdx, turnLog).state;
  }

  // Observation tracking
  updateObservation(observationState, unit.id, moveTarget.x, moveTarget.y, false, s);

  return s;
}

function updateObservation(observationState, unitId, x, y, forcedObserved, state) {
  const obsState = observationState.get(unitId);
  if (!obsState) return;
  if (forcedObserved) {
    obsState.wasObserved = true;
    obsState.trail.push({ x, y });
    return;
  }
  if (state) {
    const obs = getAdjacentPlayerUnits(x, y, state.units);
    const nearCity = isAdjacentToPlayerCity(x, y, state.cities);
    if (obs.length > 0 || nearCity) {
      obsState.wasObserved = true;
      obsState.observers.push(...obs);
      obsState.trail.push({ x, y });
    } else if (obsState.wasObserved) {
      obsState.trail.push({ x, y });
      obsState.wasObserved = false;
    }
  }
}

// ============================================================================
// COMBAT
// ============================================================================

function handleCombat(state, unitIdx, next, target, turnLog) {
  let s = { ...state, units: [...state.units] };
  const unit = s.units[unitIdx];
  const attSpec = UNIT_SPECS[unit.type], defSpec = UNIT_SPECS[target.type];

  // Store pre-combat state for reporting
  const attackerStartStrength = unit.strength;
  const defenderStartStrength = target.strength;

  let attRolls = attSpec.strength >= 10 ? Math.ceil(attSpec.strength * 0.5) : 1;
  let defRolls = defSpec.strength >= 10 ? Math.ceil(defSpec.strength * 0.5) : 1;
  let attRem = unit.strength, defRem = target.strength;

  for (let r = 0; r < Math.max(attRolls, defRolls); r++) {
    if (r < attRolls && Math.random() < 0.5) defRem--;
    if (r < defRolls && Math.random() < 0.5) attRem--;
  }

  turnLog.push(`COMBAT: ${unit.type}(str ${unit.strength}) vs ${target.type}(str ${target.strength}) -> att=${attRem} def=${defRem}`);

  // Build combat event for player report
  const combatEvent = {
    location: { x: next.x, y: next.y },
    attacker: {
      type: unit.type,
      owner: unit.owner,
      startStrength: attackerStartStrength,
      endStrength: Math.max(0, attRem),
      destroyed: attRem <= 0
    },
    defender: {
      type: target.type,
      owner: target.owner,
      startStrength: defenderStartStrength,
      endStrength: Math.max(0, defRem),
      destroyed: defRem <= 0
    }
  };

  const defIdx = s.units.findIndex(x => x.id === target.id);
  if (defRem <= 0) {
    // Remove the destroyed unit and any cargo it was carrying
    s.units = s.units.filter(x => x.id !== target.id && x.aboardId !== target.id);
  } else {
    s.units[defIdx] = { ...target, strength: defRem };
  }

  if (attRem <= 0) {
    // Remove the destroyed unit and any cargo it was carrying
    s.units = s.units.filter(x => x.id !== unit.id && x.aboardId !== unit.id);
    return { state: s, attackerDestroyed: true, combatEvent };
  } else {
    const newIdx = s.units.findIndex(x => x.id === unit.id);
    if (newIdx >= 0) {
      s.units[newIdx] = { ...s.units[newIdx], strength: attRem, movesLeft: 0, gotoPath: null, status: STATUS_USED };
      if (defRem <= 0) {
        const remaining = s.units.filter(eu => eu.x === next.x && eu.y === next.y && eu.owner !== 'ai' && !eu.aboardId);
        if (remaining.length === 0) {
          // Naval units cannot advance onto land tiles (cities owned by AI are ok)
          const targetTile = s.map[next.y]?.[next.x];
          const canAdvance = !attSpec.isNaval || targetTile === WATER
            || (s.cities[`${next.x},${next.y}`]?.owner === 'ai');
          if (canAdvance) {
            s.units[newIdx] = { ...s.units[newIdx], x: next.x, y: next.y };
          }
        }
      }
    }
    return { state: s, attackerDestroyed: false, combatEvent };
  }
}

// ============================================================================
// TRANSPORT LOADING/UNLOADING
// ============================================================================

/**
 * Aggressively try to unload transport cargo at adjacent capturable cities.
 * Unlike handleTransportAutoUnload (which only fires during movement),
 * this runs at the START of the transport's turn to handle the case where
 * the transport arrived at its target last turn.
 *
 * Checks:
 * 1. Adjacent city tiles (NEUTRAL_CITY, PLAYER_CITY on map)
 * 2. Adjacent cities by cities object (in case map tile doesn't match)
 * 3. Adjacent land tiles (unload even without a city to capture)
 */
function tryTransportUnload(state, unitIdx, turnLog, missions) {
  let s = { ...state, units: [...state.units], cities: { ...state.cities }, map: state.map.map(r => [...r]) };
  const unit = s.units[unitIdx];
  const cargo = s.units.filter(cu => cu.aboardId === unit.id);
  if (cargo.length === 0) return { state: s, unloaded: false };

  // Check all adjacent tiles for capturable cities
  for (const [dx, dy] of ALL_DIRS) {
    const adjX = unit.x + dx, adjY = unit.y + dy;
    if (adjX < 0 || adjX >= s.map[0].length || adjY < 0 || adjY >= s.map.length) continue;

    const adjTile = s.map[adjY][adjX];
    const cityKey = `${adjX},${adjY}`;
    const city = s.cities[cityKey];

    // Check for capturable city (check both map tile AND cities object)
    const isCapturable = (city && (city.owner === 'neutral' || city.owner === 'player')) ||
                          adjTile === NEUTRAL_CITY || adjTile === PLAYER_CITY;

    if (!isCapturable) continue;

    // Found a capturable city adjacent to transport!
    const defenders = s.units.filter(d => d.x === adjX && d.y === adjY && d.owner === 'player' && !d.aboardId);
    if (defenders.length > 0) continue; // Can't unload into defended city

    log(`[TRANSPORT] Unloading at (${unit.x},${unit.y}) -> city ${cityKey}`);
    let captured = false;

    for (const tank of cargo) {
      const tankIdx = s.units.findIndex(x => x.id === tank.id);
      if (tankIdx < 0) continue;

      if (!captured) {
        const targetCity = city || { owner: 'neutral' };
        turnLog.push(`Transport invasion: captured ${targetCity.owner} city ${cityKey}`);
        s.cities = { ...s.cities, [cityKey]: { ...targetCity, x: adjX, y: adjY, owner: 'ai', producing: 'tank', progress: {} } };
        s.map[adjY][adjX] = AI_CITY;
        s.units = s.units.filter(x => x.id !== tank.id); // Tank consumed by capture
        captured = true;
      } else {
        // Additional tanks disembark onto the city tile
        s.units[tankIdx] = { ...s.units[tankIdx], aboardId: null, x: adjX, y: adjY, status: STATUS_READY, movesLeft: 0 };
        turnLog.push(`Transport unloaded tank#${tank.id} at ${cityKey}`);
      }
    }

    return { state: s, unloaded: true };
  }

  // No capturable city adjacent - check if transport has arrived at its mission target
  // and should unload tanks onto land for an overland march to a landlocked city
  // IMPORTANT: Only do this for ferry_invasion missions WITH a valid targetKey.
  // transport_pickup missions (no targetKey) should NOT trigger coastal unload.
  const mission = missions?.get(unit.id)?.mission;
  const hasValidDeliveryTarget = mission?.type === 'ferry_invasion' && mission.targetKey;
  const atTarget = hasValidDeliveryTarget &&
    manhattanDistance(unit.x, unit.y, mission.target.x, mission.target.y) <= 1;

  if (atTarget) {
    // Find the best adjacent land tile to unload onto
    // Prefer tiles closest to the mission's target city (targetKey)
    let bestLand = null;
    let bestDist = Infinity;
    const [cityX, cityY] = mission.targetKey
      ? mission.targetKey.split(',').map(Number)
      : [mission.target.x, mission.target.y];

    for (const [dx, dy] of ALL_DIRS) {
      const adjX = unit.x + dx, adjY = unit.y + dy;
      if (adjX < 0 || adjX >= s.map[0].length || adjY < 0 || adjY >= s.map.length) continue;
      const adjTile = s.map[adjY][adjX];

      // Must be land (not water)
      if (adjTile === WATER) continue;

      // Don't unload onto a tile with enemy units
      const enemies = s.units.filter(u => u.x === adjX && u.y === adjY && u.owner === 'player' && !u.aboardId);
      if (enemies.length > 0) continue;

      const dist = manhattanDistance(adjX, adjY, cityX, cityY);
      if (dist < bestDist) {
        bestDist = dist;
        bestLand = { x: adjX, y: adjY };
      }
    }

    if (bestLand) {
      log(`[TRANSPORT] Coastal unload at (${unit.x},${unit.y}) -> land (${bestLand.x},${bestLand.y}) for march to city ${mission.targetKey}`);

      for (const tank of cargo) {
        const tankIdx = s.units.findIndex(x => x.id === tank.id);
        if (tankIdx < 0) continue;

        s.units[tankIdx] = {
          ...s.units[tankIdx],
          aboardId: null,
          x: bestLand.x,
          y: bestLand.y,
          status: STATUS_READY,
          movesLeft: 0 // Will get moves next turn
        };
        turnLog.push(`Transport coastal unload: tank#${tank.id} at (${bestLand.x},${bestLand.y}) -> march to ${mission.targetKey}`);
      }
      return { state: s, unloaded: true };
    }
  }

  return { state: s, unloaded: false };
}

function handleTransportAutoLoad(state, unitIdx, turnLog) {
  let s = { ...state, units: [...state.units] };
  const unit = s.units[unitIdx];
  const capacity = UNIT_SPECS[unit.type].capacity;

  for (const [dx, dy] of ALL_DIRS) {
    const adjX = unit.x + dx, adjY = unit.y + dy;
    if (s.map[adjY]?.[adjX] === WATER) continue;

    const tanksToLoad = s.units.filter(tank =>
      tank.x === adjX && tank.y === adjY && tank.type === 'tank' && tank.owner === 'ai' && !tank.aboardId
    );

    for (const tank of tanksToLoad) {
      const loaded = s.units.filter(cu => cu.aboardId === unit.id).length;
      if (loaded >= capacity) break;
      const tankIdx = s.units.findIndex(x => x.id === tank.id);
      if (tankIdx >= 0) {
        s.units[tankIdx] = { ...s.units[tankIdx], aboardId: unit.id, x: unit.x, y: unit.y, status: STATUS_ABOARD };
        turnLog.push(`Transport loaded tank#${tank.id}`);
      }
    }
  }
  return s;
}

function handleTransportAutoUnload(state, unitIdx, turnLog) {
  let s = { ...state, units: [...state.units], cities: { ...state.cities }, map: state.map.map(r => [...r]) };
  const unit = s.units[unitIdx];
  const cargo = s.units.filter(cu => cu.aboardId === unit.id);
  if (cargo.length === 0) return { state: s };

  for (const [dx, dy] of ALL_DIRS) {
    const adjX = unit.x + dx, adjY = unit.y + dy;
    if (adjX < 0 || adjX >= s.map[0].length || adjY < 0 || adjY >= s.map.length) continue;

    const adjTile = s.map[adjY]?.[adjX];
    const cityKey = `${adjX},${adjY}`;
    const city = s.cities[cityKey];

    // Check both map tile AND cities object for capturable city
    const isCapturable = (adjTile === NEUTRAL_CITY || adjTile === PLAYER_CITY) ||
                          (city && (city.owner === 'neutral' || city.owner === 'player'));
    if (!isCapturable) continue;

    const targetCity = city || { owner: 'neutral' };
    if (targetCity.owner !== 'neutral' && targetCity.owner !== 'player') continue;

    const defenders = s.units.filter(d => d.x === adjX && d.y === adjY && d.owner === 'player' && !d.aboardId);
    let captured = false;

    for (const tank of cargo) {
      const tankIdx = s.units.findIndex(x => x.id === tank.id);
      if (tankIdx < 0) continue;

      if (!captured && defenders.length === 0) {
        turnLog.push(`Transport invasion: captured ${targetCity.owner} city ${cityKey}`);
        s.cities = { ...s.cities, [cityKey]: { ...targetCity, x: adjX, y: adjY, owner: 'ai', producing: 'tank', progress: {} } };
        s.map[adjY][adjX] = AI_CITY;
        s.units = s.units.filter(x => x.id !== tank.id);
        captured = true;
      } else {
        s.units[tankIdx] = { ...s.units[tankIdx], aboardId: null, x: adjX, y: adjY, status: STATUS_READY, movesLeft: 0 };
        turnLog.push(`Transport unloaded tank at ${cityKey}`);
      }
    }
    break;
  }
  return { state: s };
}

// ============================================================================
// MAIN AI TURN EXECUTION
// ============================================================================

export function executeAITurn(gameState, knowledge, unused, playerMadeContact = false, playerObservations = []) {
  const turnStartExplored = knowledge.exploredTiles.size;
  log(`======== AI TURN ${gameState.turn} ========`);

  // Clear A* path cache from previous turn (unit positions have changed)
  clearPathCache();

  let state = { ...gameState, units: [...gameState.units], cities: { ...gameState.cities }, map: gameState.map.map(r => [...r]) };
  let k = updateAIKnowledge(knowledge, state);
  const turnLog = [];

  // Player contact handling
  if (playerMadeContact && !k.hasSeenPlayerUnit) {
    k.hasSeenPlayerUnit = true;
  }
  if (playerObservations?.length > 0) {
    k = recordPlayerObservations(k, playerObservations);
  }

  // Phase determination
  const oldPhase = k.explorationPhase;
  k.explorationPhase = determinePhase(k, state);
  if (oldPhase !== k.explorationPhase) {
    logPhase(`Phase changed: ${oldPhase} -> ${k.explorationPhase}`);
    turnLog.push(`Phase: ${k.explorationPhase}`);
  }

  // === CITY MANAGER: Production ===
  state = planProduction(state, k, turnLog);

  // === Reset moves, heal, refuel ===
  state.units = state.units.map(u => {
    if (u.owner !== 'ai') return u;
    const spec = UNIT_SPECS[u.type];
    // Damaged movement penalty: units at Ã¢â€°Â¤50% health get -1 move (minimum 1)
    let movement = spec.movement;
    if (u.strength <= spec.strength * 0.5) {
      movement = Math.max(1, movement - 1);
      log(`[DAMAGE] ${spec.name}#${u.id} at ${u.strength}/${spec.strength} str Ã¢â€ â€™ ${movement} moves (reduced)`);
    }
    const unit = { ...u, movesLeft: movement };
    if (unit.status === STATUS_USED || unit.status === STATUS_SKIPPED) unit.status = STATUS_READY;
    const city = state.cities[`${unit.x},${unit.y}`];
    if (city?.owner === 'ai' && !unit.aboardId) {
      if (unit.strength < spec.strength) unit.strength = Math.min(spec.strength, unit.strength + 1);
      if (spec.fuel) unit.fuel = spec.fuel;
    }
    return unit;
  });

  // === ALLOCATE UNITS between managers ===
  const { explorationUnits, tacticalUnits } = allocateUnits(state, k.explorationPhase);
  console.log(`[AI][ALLOC] exploration: ${explorationUnits.length}, tactical: ${tacticalUnits.length}`);

  // === Detect threats ===
  const threats = detectThreats(state, k);

  // === EXPLORATION MANAGER: Assign missions ===
  const explorationMissions = assignExplorationMissions(state, k, explorationUnits, k.explorationPhase, turnLog);

  // === TACTICAL MANAGER: Assign missions ===
  const tacticalMissions = assignTacticalMissions(state, k, tacticalUnits, threats, k.explorationPhase, turnLog);

  // === Merge missions ===
  const allMissions = new Map();
  for (const [id, m] of explorationMissions) allMissions.set(id, m);
  for (const [id, m] of tacticalMissions) allMissions.set(id, m);

  // === Log turn summary ===
  logTurnSummary(state, k, allMissions, turnLog);

  // === EXECUTE MOVEMENTS ===
  const moveResult = executeStepByStepMovements(state, k, turnLog, allMissions);
  state = moveResult.state;
  k = moveResult.knowledge;
  const observations = moveResult.observations;
  const combatEvents = moveResult.combatEvents || [];

  // === Final knowledge update & phase check ===
  const contactBefore = k.hasSeenPlayerUnit || k.hasSeenPlayerCity;
  k = updateAIKnowledge(k, state);
  const contactAfter = k.hasSeenPlayerUnit || k.hasSeenPlayerCity;

  if (!contactBefore && contactAfter) {
    const newPhase = determinePhase(k, state);
    if (newPhase !== k.explorationPhase) {
      logPhase(`Contact triggered: ${k.explorationPhase} -> ${newPhase}`);
      k.explorationPhase = newPhase;
      turnLog.push(`Phase: ${k.explorationPhase} (contact)`);
    }
  }

  // Exploration delta
  const newExplored = k.exploredTiles.size - turnStartExplored;
  const totalTiles = state.width * state.height;
  const explorePct = (k.exploredTiles.size / totalTiles * 100).toFixed(1);
  console.log(`[AI][EXPLORE] +${newExplored} tiles this turn -> ${explorePct}% explored`);
  return { state, knowledge: k, log: turnLog, observations, combatEvents };
}

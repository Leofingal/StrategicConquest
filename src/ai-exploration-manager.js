// ============================================================================
// STRATEGIC CONQUEST - AI EXPLORATION MANAGER
// ============================================================================
// Assigns exploration missions to maximize city discovery rate.
// Key behaviors:
//   - Fighters deep-scout in sectors (not crawl along frontier)
//   - Naval units follow island coastlines
//   - Fighters rebase to frontier cities
//   - Transports dispatched to discovered neutral cities
//   - Partial island tracking with merge
//
// Dependencies: ai-helpers.js, game-constants.js, movement-engine.js

import { UNIT_SPECS, ALL_DIRS, WATER, manhattanDistance } from './game-constants.js';
import { isAdjacentToWater } from './movement-engine.js';
import {
  PHASE, AI_CONFIG, log, logMission,
  findNearest, floodFillLand, floodFillExploredLand,
  findDeepScoutTarget, findBestExploreTarget, findNearestUnexplored,
  findCoastExploreTarget, getRefuelPoints
} from './ai-helpers.js';

const logExplore = (...args) => console.log('[AI][EXPLORE]', ...args);

// ============================================================================
// ISLAND TRACKING
// ============================================================================

/**
 * Update island knowledge based on newly explored tiles.
 * Builds partial islands from explored land tiles, merges when connected.
 */
export function updateIslandKnowledge(knowledge, state) {
  const k = { ...knowledge };
  if (!k.islands) k.islands = [];

  // Find all explored land tiles
  const exploredLand = new Set();
  for (const key of k.exploredTiles) {
    const [x, y] = key.split(',').map(Number);
    if (state.map[y]?.[x] !== WATER) {
      exploredLand.add(key);
    }
  }

  // Track which tiles are already assigned to an island
  const assignedTiles = new Set();
  for (const island of k.islands) {
    for (const tile of island.tiles) {
      assignedTiles.add(tile);
    }
  }

  // Find unassigned explored land tiles
  const unassigned = new Set();
  for (const key of exploredLand) {
    if (!assignedTiles.has(key)) unassigned.add(key);
  }

  if (unassigned.size === 0 && k.islands.length > 0) {
    // No new land, but update existing island stats
    updateIslandStats(k, state);
    return k;
  }

  // For each unassigned tile, flood-fill through explored land to find its island
  const processedThisRound = new Set();
  for (const key of unassigned) {
    if (processedThisRound.has(key)) continue;

    const [sx, sy] = key.split(',').map(Number);
    const connected = floodFillExploredLand(sx, sy, state, k.exploredTiles);

    for (const t of connected) processedThisRound.add(t);

    // Check if this connects to any existing island
    const touchingIslands = [];
    for (let i = 0; i < k.islands.length; i++) {
      for (const t of connected) {
        if (k.islands[i].tiles.has(t)) {
          touchingIslands.push(i);
          break;
        }
      }
    }

    if (touchingIslands.length === 0) {
      // New island
      const isHome = knowledge.startPosition &&
        connected.has(`${knowledge.startPosition.x},${knowledge.startPosition.y}`);
      const newIsland = {
        id: k.islands.length,
        tiles: connected,
        cities: new Set(),
        coastTiles: new Set(),
        exploredPct: 0,
        isHomeIsland: isHome,
        fullyMapped: false
      };
      k.islands.push(newIsland);
      logExplore(`Discovered new island #${newIsland.id} (${connected.size} tiles, home=${isHome})`);
    } else if (touchingIslands.length === 1) {
      // Extends existing island
      const island = k.islands[touchingIslands[0]];
      for (const t of connected) island.tiles.add(t);
    } else {
      // MERGE: multiple islands connected by new exploration
      const mergeInto = k.islands[touchingIslands[0]];
      for (const t of connected) mergeInto.tiles.add(t);

      // Absorb other islands (process in reverse to avoid index shifting)
      for (let i = touchingIslands.length - 1; i >= 1; i--) {
        const absorb = k.islands[touchingIslands[i]];
        for (const t of absorb.tiles) mergeInto.tiles.add(t);
        for (const c of absorb.cities) mergeInto.cities.add(c);
        if (absorb.isHomeIsland) mergeInto.isHomeIsland = true;
        k.islands.splice(touchingIslands[i], 1);
        logExplore(`Merged island #${absorb.id} into #${mergeInto.id}`);
      }
    }
  }

  // Update stats for all islands
  updateIslandStats(k, state);
  return k;
}

function updateIslandStats(k, state) {
  for (const island of k.islands) {
    // Update cities
    island.cities = new Set();
    for (const key of island.tiles) {
      if (state.cities[key]) island.cities.add(key);
    }

    // Update coast tiles
    island.coastTiles = new Set();
    for (const key of island.tiles) {
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of ALL_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height) {
          if (state.map[ny][nx] === WATER) {
            island.coastTiles.add(key);
            break;
          }
        }
      }
    }

    // Explored percentage
    // For home island: we know the REAL size from homeIslandTiles (floodFillLand on actual map)
    // For other islands: we only know explored tiles, so estimate via frontier check
    if (island.isHomeIsland && k.homeIslandTiles) {
      island.exploredPct = island.tiles.size / k.homeIslandTiles.size;
      island.fullyMapped = island.tiles.size >= k.homeIslandTiles.size;
    } else {
      // For non-home islands, check if there are unexplored tiles adjacent to known coast/land
      let unexploredAdjacent = 0;
      for (const key of island.tiles) {
        const [x, y] = key.split(',').map(Number);
        for (const [dx, dy] of ALL_DIRS) {
          const nx = x + dx, ny = y + dy;
          const nkey = `${nx},${ny}`;
          if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height) {
            if (!k.exploredTiles.has(nkey) && state.map[ny][nx] !== WATER) {
              unexploredAdjacent++;
            }
          }
        }
      }
      island.fullyMapped = unexploredAdjacent === 0 && island.tiles.size > 5;
      // Estimate: if no unexplored land adjacent, we've probably found most of it
      island.exploredPct = island.fullyMapped ? 1.0 : 0.5; // rough estimate for non-home
    }
  }
}

// ============================================================================
// SECTOR SYSTEM
// ============================================================================

/**
 * Divide map into sectors relative to start position for fighter assignment.
 * Uses 8 compass sectors (N, NE, E, SE, S, SW, W, NW).
 */
function getSectorForPoint(x, y, centerX, centerY) {
  const dx = x - centerX;
  const dy = y - centerY;
  const angle = Math.atan2(dy, dx); // -PI to PI
  // Convert to 0-7 sector index
  const sector = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8;
  return sector;
}

const SECTOR_NAMES = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW'];

function countUnexploredInSector(state, knowledge, centerX, centerY, sector) {
  let count = 0;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;
      if (getSectorForPoint(x, y, centerX, centerY) === sector) count++;
    }
  }
  return count;
}

// ============================================================================
// MAIN EXPLORATION ASSIGNMENT
// ============================================================================

/**
 * Assign exploration missions to units allocated to exploration.
 *
 * @param {Object} state - Game state
 * @param {Object} knowledge - AI knowledge with islands, exploredTiles
 * @param {Array} units - Array of unit objects allocated to exploration manager
 * @param {string} phase - Current game phase
 * @param {Array} turnLog - Turn log
 * @returns {Map<number, Object>} Map of unitId -> { mission }
 */
export function assignExplorationMissions(state, knowledge, units, phase, turnLog) {
  const missions = new Map();
  const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');
  const refuelPoints = getRefuelPoints(state);

  // Categorize units
  const fighters = units.filter(u => u.type === 'fighter');
  const tanks = units.filter(u => u.type === 'tank' && !u.aboardId);
  const transports = units.filter(u => u.type === 'transport' && !u.aboardId);
  const destroyers = units.filter(u => u.type === 'destroyer');
  const otherNaval = units.filter(u =>
    UNIT_SPECS[u.type]?.isNaval && u.type !== 'transport' && u.type !== 'destroyer'
  );

  // Known cities for targeting
  const knownNeutral = [];
  const knownPlayer = [];
  for (const [key, city] of Object.entries(state.cities)) {
    if (!knowledge.exploredTiles.has(key)) continue;
    if (city.owner === 'neutral') knownNeutral.push(city);
    else if (city.owner === 'player') knownPlayer.push(city);
  }

  // Track claimed targets to avoid duplicates
  const claimedCities = new Set();
  const claimedSectors = new Map(); // sector -> unitId

  // ===== FIGHTERS: Deep Scout or Island Interior Exploration =====
  assignFighterMissions(fighters, state, knowledge, refuelPoints, aiCities, claimedSectors, missions, turnLog);

  // ===== TANKS: Capture cities, garrison, or stage for transport =====
  assignTankMissions(tanks, state, knowledge, phase, aiCities, knownNeutral, knownPlayer, claimedCities, missions, turnLog);

  // ===== TRANSPORTS: Ferry tanks to target cities =====
  assignTransportMissions(transports, state, knowledge, knownNeutral, knownPlayer, claimedCities, missions, turnLog);

  // ===== DESTROYERS (exploration allocation): Explore water / follow island coasts =====
  assignNavalExplorationMissions(destroyers, state, knowledge, missions, turnLog);

  // Other naval (carriers in exploration mode) - explore water
  assignNavalExplorationMissions(otherNaval, state, knowledge, missions, turnLog);

  return missions;
}

// ============================================================================
// FIGHTER MISSION ASSIGNMENT
// ============================================================================

function assignFighterMissions(fighters, state, knowledge, refuelPoints, aiCities, claimedSectors, missions, turnLog) {
  if (fighters.length === 0) return;

  const centerX = knowledge.startPosition?.x || state.width / 2;
  const centerY = knowledge.startPosition?.y || state.height / 2;

  // Check for partially-explored non-home islands (high priority exploration)
  const nonHomeIslands = (knowledge.islands || []).filter(i => !i.isHomeIsland && !i.fullyMapped);

  // Identify frontier cities: AI cities that have unexplored tiles within fighter range
  const frontierCities = [];
  for (const city of aiCities) {
    const maxRange = 9; // half of fuel=20, minus safety
    let hasUnexplored = false;
    for (let dy = -maxRange; dy <= maxRange && !hasUnexplored; dy++) {
      for (let dx = -maxRange; dx <= maxRange && !hasUnexplored; dx++) {
        const nx = city.x + dx, ny = city.y + dy;
        if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
        if (Math.abs(dx) + Math.abs(dy) > maxRange) continue;
        if (!knowledge.exploredTiles.has(`${nx},${ny}`)) hasUnexplored = true;
      }
    }
    if (hasUnexplored) frontierCities.push(city);
  }

  // Track: max 1 fighter per non-home island
  const islandAssignments = new Map(); // islandId -> unitId

  // Build a reachability map: for each fighter, compute what it can reach round-trip
  // from the nearest refuel point (not just from current position)
  const fighterReach = fighters.map(fighter => {
    const nearestRefuel = findNearest(fighter, refuelPoints);
    const distToRefuel = nearestRefuel ? manhattanDistance(fighter.x, fighter.y, nearestRefuel.x, nearestRefuel.y) : Infinity;
    const fuelAfterReturn = fighter.fuel - distToRefuel;
    // Max exploration radius from nearest refuel point (round trip)
    const maxExploreRange = nearestRefuel ? Math.floor((fighter.fuel - 2) / 2) : 0;
    return { fighter, nearestRefuel, distToRefuel, fuelAfterReturn, maxExploreRange };
  });

  for (const { fighter, nearestRefuel, distToRefuel, fuelAfterReturn, maxExploreRange } of fighterReach) {
    if (!nearestRefuel) {
      missions.set(fighter.id, { mission: { type: 'wait', reason: 'no_refuel_point' } });
      continue;
    }

    // Priority 0: Return to refuel if fuel critical
    if (fuelAfterReturn <= 2 && distToRefuel > 0) {
      missions.set(fighter.id, {
        mission: {
          type: 'rebase',
          target: { x: nearestRefuel.x, y: nearestRefuel.y },
          priority: 9,
          assignedBy: 'exploration',
          reason: 'fuel_return'
        }
      });
      continue;
    }

    // Priority 1: Non-home island interior (MAX 1 fighter per island)
    let assignedIsland = false;
    if (nonHomeIslands.length > 0 && fuelAfterReturn > 4) {
      for (const island of nonHomeIslands) {
        if (islandAssignments.has(island.id)) continue; // Already assigned

        const closestIsland = findClosestIslandToExploreFromRefuel(fighter, island, knowledge, state, refuelPoints);
        if (closestIsland && closestIsland.roundTripFuel <= fighter.fuel - 2) {
          islandAssignments.set(island.id, fighter.id);
          missions.set(fighter.id, {
            mission: {
              type: 'explore_island_interior',
              target: closestIsland.target,
              priority: 8,
              assignedBy: 'exploration',
              reason: `island interior (island#${island.id}, rt=${closestIsland.roundTripFuel})`
            }
          });
          logMission(`fighter#${fighter.id}: explore island #${island.id} (round-trip fuel: ${closestIsland.roundTripFuel})`);
          assignedIsland = true;
          break;
        }
      }
    }
    if (assignedIsland) continue;

    // Priority 2: Deep scout into an UNCLAIMED sector
    if (fuelAfterReturn > 4) {
      // Find sectors not yet claimed by another fighter this turn
      const target = findDeepScoutTargetInUnclaimedSector(
        fighter, state, knowledge, refuelPoints, claimedSectors, centerX, centerY
      );
      if (target) {
        const sector = getSectorForPoint(target.x, target.y, centerX, centerY);
        claimedSectors.set(sector, fighter.id);
        missions.set(fighter.id, {
          mission: {
            type: 'explore_sector',
            target: { x: target.x, y: target.y },
            priority: 6,
            assignedBy: 'exploration',
            reason: `deep scout ${SECTOR_NAMES[sector]} (dist=${target.dist})`
          }
        });
        logMission(`fighter#${fighter.id}: deep scout ${SECTOR_NAMES[sector]} toward (${target.x},${target.y})`);
        continue;
      }

      // Fallback: any deep scout target (all sectors claimed)
      const fallbackTarget = findDeepScoutTarget(fighter, state, knowledge, refuelPoints);
      if (fallbackTarget) {
        missions.set(fighter.id, {
          mission: {
            type: 'explore_sector',
            target: { x: fallbackTarget.x, y: fallbackTarget.y },
            priority: 6,
            assignedBy: 'exploration',
            reason: `deep scout any (dist=${fallbackTarget.dist})`
          }
        });
        logMission(`fighter#${fighter.id}: deep scout any toward (${fallbackTarget.x},${fallbackTarget.y})`);
        continue;
      }
    }

    // Priority 3: Rebase to frontier city with unexplored in range
    if (frontierCities.length > 0) {
      const otherFrontier = frontierCities.filter(c =>
        c.x !== nearestRefuel.x || c.y !== nearestRefuel.y
      );
      const rebaseTarget = otherFrontier.length > 0
        ? findNearest(fighter, otherFrontier)
        : findNearest(fighter, frontierCities);

      if (rebaseTarget) {
        missions.set(fighter.id, {
          mission: {
            type: 'rebase',
            target: { x: rebaseTarget.x, y: rebaseTarget.y },
            priority: 5,
            assignedBy: 'exploration',
            reason: `rebase to frontier city (${rebaseTarget.x},${rebaseTarget.y})`
          }
        });
        logMission(`fighter#${fighter.id}: rebasing to frontier city (${rebaseTarget.x},${rebaseTarget.y})`);
        continue;
      }
    }

    // Default: nearest unexplored (fallback)
    const fallback = findNearestUnexplored(fighter, state, knowledge);
    if (fallback) {
      missions.set(fighter.id, {
        mission: {
          type: 'explore_sector',
          target: { x: fallback.x, y: fallback.y },
          priority: 4,
          assignedBy: 'exploration',
          reason: 'nearest_unexplored_fallback'
        }
      });
    } else {
      missions.set(fighter.id, {
        mission: { type: 'wait', reason: 'nothing_to_explore' }
      });
    }
  }
}

/**
 * Find closest unexplored tile near an island that is reachable round-trip
 * (fighter Ã¢â€ â€™ target Ã¢â€ â€™ nearest refuel). Returns null if unreachable.
 */
function findClosestIslandToExploreFromRefuel(fighter, island, knowledge, state, refuelPoints) {
  let best = null;
  let bestFuel = Infinity;

  for (const key of island.tiles) {
    const [lx, ly] = key.split(',').map(Number);
    for (const [dx, dy] of ALL_DIRS) {
      const nx = lx + dx, ny = ly + dy;
      if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
      if (knowledge.exploredTiles.has(`${nx},${ny}`)) continue;

      const distToTarget = manhattanDistance(fighter.x, fighter.y, nx, ny);

      // Find nearest refuel from target for return leg
      let bestReturn = Infinity;
      for (const rp of refuelPoints) {
        const returnDist = manhattanDistance(nx, ny, rp.x, rp.y);
        if (returnDist < bestReturn) bestReturn = returnDist;
      }

      const roundTrip = distToTarget + bestReturn;
      if (roundTrip < bestFuel) {
        bestFuel = roundTrip;
        best = { target: { x: nx, y: ny }, roundTripFuel: roundTrip, dist: distToTarget };
      }
    }
  }
  return best;
}

/**
 * Find a deep scout target in a sector not yet claimed by another fighter.
 * Tries sectors in order of most unexplored tiles.
 */
function findDeepScoutTargetInUnclaimedSector(fighter, state, knowledge, refuelPoints, claimedSectors, centerX, centerY) {
  const { width, height } = state;

  // Score sectors
  const sectorScores = [];
  for (let s = 0; s < 8; s++) {
    if (claimedSectors.has(s)) continue; // Already claimed
    const count = countUnexploredInSector(state, knowledge, centerX, centerY, s);
    if (count > 0) sectorScores.push({ sector: s, count });
  }
  sectorScores.sort((a, b) => b.count - a.count);

  // For each unclaimed sector (best first), find the best deep scout target in it
  for (const { sector } of sectorScores) {
    let best = null, bestScore = -Infinity;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (knowledge.exploredTiles.has(`${x},${y}`)) continue;
        if (getSectorForPoint(x, y, centerX, centerY) !== sector) continue;

        const distToTarget = manhattanDistance(fighter.x, fighter.y, x, y);

        // Check round-trip fuel
        let bestReturnDist = Infinity;
        for (const refuel of refuelPoints) {
          const returnDist = manhattanDistance(x, y, refuel.x, refuel.y);
          if (returnDist < bestReturnDist) bestReturnDist = returnDist;
        }

        if (distToTarget + bestReturnDist + 2 > fighter.fuel) continue;

        // Density bonus
        let density = 0;
        for (let dy2 = -2; dy2 <= 2; dy2++) {
          for (let dx2 = -2; dx2 <= 2; dx2++) {
            const nx = x + dx2, ny = y + dy2;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (!knowledge.exploredTiles.has(`${nx},${ny}`)) density++;
            }
          }
        }

        const score = distToTarget * 2 + density;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, dist: distToTarget };
        }
      }
    }

    if (best) return best;
  }
  return null;
}

// ============================================================================
// TANK MISSION ASSIGNMENT
// ============================================================================

function assignTankMissions(tanks, state, knowledge, phase, aiCities, knownNeutral, knownPlayer, claimedCities, missions, turnLog) {
  // Sort tanks by those closest to capturable cities first (greedy assignment)
  const tanksByDistance = tanks.map(tank => {
    const reachable = floodFillLand(tank.x, tank.y, state);
    const reachableNeutral = knownNeutral.filter(c => reachable.has(`${c.x},${c.y}`));
    const reachablePlayer = knownPlayer.filter(c => reachable.has(`${c.x},${c.y}`));
    const nearestNeutralDist = reachableNeutral.length > 0
      ? Math.min(...reachableNeutral.map(c => manhattanDistance(tank.x, tank.y, c.x, c.y)))
      : Infinity;
    const nearestPlayerDist = reachablePlayer.length > 0
      ? Math.min(...reachablePlayer.map(c => manhattanDistance(tank.x, tank.y, c.x, c.y)))
      : Infinity;
    const nearestDist = Math.min(nearestNeutralDist, nearestPlayerDist);
    return { tank, reachable, reachableNeutral, reachablePlayer, nearestDist };
  }).sort((a, b) => a.nearestDist - b.nearestDist);

  // Track garrisoned cities: only mark as garrisoned during assignment (not pre-populated).
  // This ensures exactly 1 tank gets garrison duty per city, extras get other missions.
  const garrisonedCities = new Set();

  for (const { tank, reachable, reachableNeutral, reachablePlayer } of tanksByDistance) {
    // ===== P1: Capture nearest unclaimed neutral city (always top priority) =====
    let assigned = false;
    for (const city of reachableNeutral) {
      const key = `${city.x},${city.y}`;
      if (claimedCities.has(key)) continue;
      claimedCities.add(key);
      missions.set(tank.id, {
        mission: {
          type: 'capture_city',
          target: { x: city.x, y: city.y },
          targetKey: key,
          priority: 7,
          assignedBy: 'exploration',
          reason: `capture neutral (${city.x},${city.y})`
        }
      });
      assigned = true;
      break;
    }
    if (assigned) continue;

    // ===== P1.5: Attack nearest reachable player city =====
    // Tanks on foreign islands should push to capture player cities, not sit idle
    if (reachablePlayer.length > 0) {
      const sorted = reachablePlayer
        .map(c => ({ ...c, dist: manhattanDistance(tank.x, tank.y, c.x, c.y) }))
        .sort((a, b) => a.dist - b.dist);
      for (const city of sorted) {
        const key = `${city.x},${city.y}`;
        if (claimedCities.has(key)) continue;
        claimedCities.add(key);
        missions.set(tank.id, {
          mission: {
            type: 'attack_city',
            target: { x: city.x, y: city.y },
            targetKey: key,
            priority: 6,
            assignedBy: 'exploration',
            reason: `attack player city (${city.x},${city.y})`
          }
        });
        assigned = true;
        break;
      }
      if (assigned) continue;
    }

    // =========================================================================
    // LAND PHASE: Capture and explore only - no garrison, no staging.
    // Every tank should be pushing outward to discover and capture cities.
    // =========================================================================
    if (phase === PHASE.LAND) {
      const target = findBestExploreTarget(tank, state, knowledge, 'land');
      if (target && reachable.has(`${target.x},${target.y}`)) {
        missions.set(tank.id, {
          mission: {
            type: 'explore_sector',
            target: { x: target.x, y: target.y },
            priority: 6,
            assignedBy: 'exploration',
            reason: 'explore_land'
          }
        });
      } else {
        const anyTarget = findNearestUnexplored(tank, state, knowledge);
        if (anyTarget && reachable.has(`${anyTarget.x},${anyTarget.y}`)) {
          missions.set(tank.id, {
            mission: {
              type: 'explore_sector',
              target: { x: anyTarget.x, y: anyTarget.y },
              priority: 5,
              assignedBy: 'exploration',
              reason: 'explore_any_reachable'
            }
          });
        } else {
          // Island fully explored, no cities left - stage at coast for pickup
          const coastalCities = aiCities.filter(c =>
            reachable.has(`${c.x},${c.y}`) &&
            isAdjacentToWater(c.x, c.y, state.map, state.map[0].length, state.map.length)
          );
          if (coastalCities.length > 0) {
            const nearest = findNearest(tank, coastalCities);
            if (nearest && (tank.x !== nearest.x || tank.y !== nearest.y)) {
              missions.set(tank.id, {
                mission: {
                  type: 'stage_coastal',
                  target: { x: nearest.x, y: nearest.y },
                  priority: 3,
                  assignedBy: 'exploration',
                  reason: `land done, stage at coast (${nearest.x},${nearest.y})`
                }
              });
            } else {
              missions.set(tank.id, { mission: { type: 'wait', reason: 'at_coast_awaiting_transport' } });
            }
          } else {
            missions.set(tank.id, { mission: { type: 'wait', reason: 'land_phase_complete' } });
          }
        }
      }
      continue;
    }

    // =========================================================================
    // TRANSITION / NAVAL / LATE GAME
    // =========================================================================

    // Determine if tank is on the home island or a foreign island
    const isOnHomeIsland = knowledge.homeIslandTiles &&
      knowledge.homeIslandTiles.has(`${tank.x},${tank.y}`);

    // === FOREIGN ISLAND: Explore before staging ===
    // Tanks landed on a foreign island should explore it to find cities before
    // sitting around waiting for transport pickup
    if (!isOnHomeIsland) {
      const target = findBestExploreTarget(tank, state, knowledge, 'land');
      if (target && reachable.has(`${target.x},${target.y}`)) {
        missions.set(tank.id, {
          mission: {
            type: 'explore_sector',
            target: { x: target.x, y: target.y },
            priority: 5,
            assignedBy: 'exploration',
            reason: 'explore_foreign_island'
          }
        });
        continue;
      }
    }

    // === GARRISON: Exactly 1 tank per city ===
    if (!missions.has(tank.id)) {
      for (const city of aiCities) {
        const key = `${city.x},${city.y}`;
        if (garrisonedCities.has(key)) continue;
        if (!reachable.has(key)) continue;
        garrisonedCities.add(key);
        missions.set(tank.id, {
          mission: {
            type: 'garrison',
            target: { x: city.x, y: city.y },
            priority: 3,
            assignedBy: 'exploration',
            reason: `garrison (${city.x},${city.y})`
          }
        });
        break;
      }
    }

    // === HOME ISLAND: Stage for transport ===
    if (!missions.has(tank.id) && isOnHomeIsland) {
      const transportCities = aiCities.filter(c =>
        reachable.has(`${c.x},${c.y}`) &&
        c.producing === 'transport' &&
        isAdjacentToWater(c.x, c.y, state.map, state.map[0].length, state.map.length)
      );
      if (transportCities.length > 0) {
        const nearest = findNearest(tank, transportCities);
        if (nearest && (tank.x !== nearest.x || tank.y !== nearest.y)) {
          missions.set(tank.id, {
            mission: {
              type: 'stage_coastal',
              target: { x: nearest.x, y: nearest.y },
              priority: 5,
              assignedBy: 'exploration',
              reason: `stage at transport city (${nearest.x},${nearest.y})`
            }
          });
          continue;
        }
      }

      // Fallback: any coastal city
      const coastalCities = aiCities.filter(c =>
        reachable.has(`${c.x},${c.y}`) &&
        isAdjacentToWater(c.x, c.y, state.map, state.map[0].length, state.map.length)
      );
      if (coastalCities.length > 0) {
        const nearest = findNearest(tank, coastalCities);
        if (nearest && (tank.x !== nearest.x || tank.y !== nearest.y)) {
          missions.set(tank.id, {
            mission: {
              type: 'stage_coastal',
              target: { x: nearest.x, y: nearest.y },
              priority: 4,
              assignedBy: 'exploration',
              reason: `stage at coast (${nearest.x},${nearest.y})`
            }
          });
          continue;
        }
      }
    }

    // === FOREIGN ISLAND: Stage at coast for re-embarkation ===
    if (!missions.has(tank.id) && !isOnHomeIsland) {
      const coastalCities = aiCities.filter(c =>
        reachable.has(`${c.x},${c.y}`) &&
        isAdjacentToWater(c.x, c.y, state.map, state.map[0].length, state.map.length)
      );
      if (coastalCities.length > 0) {
        const nearest = findNearest(tank, coastalCities);
        if (nearest && (tank.x !== nearest.x || tank.y !== nearest.y)) {
          missions.set(tank.id, {
            mission: {
              type: 'stage_coastal',
              target: { x: nearest.x, y: nearest.y },
              priority: 3,
              assignedBy: 'exploration',
              reason: `foreign island, stage for pickup (${nearest.x},${nearest.y})`
            }
          });
          continue;
        }
      }
      // Already at the only coastal city on this island - wait for transport
      missions.set(tank.id, { mission: { type: 'wait', reason: 'at_coast_awaiting_transport' } });
      continue;
    }

    // Low priority fallback: Explore reachable land
    if (!missions.has(tank.id)) {
      const target = findBestExploreTarget(tank, state, knowledge, 'land');
      if (target && reachable.has(`${target.x},${target.y}`)) {
        missions.set(tank.id, {
          mission: {
            type: 'explore_sector',
            target: { x: target.x, y: target.y },
            priority: 1,
            assignedBy: 'exploration',
            reason: 'explore_land_low_priority'
          }
        });
      } else {
        missions.set(tank.id, { mission: { type: 'wait', reason: 'tank_idle' } });
      }
    }
  }
}

// ============================================================================
// TRANSPORT HELPER: Find nearest coast for landlocked cities
// ============================================================================

/**
 * For a landlocked city, find the nearest water tile adjacent to the city's
 * island coastline. The transport can sail to this water tile, then unload
 * tanks who walk overland to capture the city.
 *
 * Returns: { x, y } water tile, or null if no coast found
 */
function findNearestCoastToCity(city, state, knowledge) {
  const { map, width, height } = state;

  // Flood-fill land from city to find all connected land tiles (the island)
  const islandTiles = floodFillLand(city.x, city.y, state);

  // Find coast tiles: land tiles that have at least one adjacent water tile
  // For each, also find the water tile and compute distance to city
  let bestWater = null;
  let bestDist = Infinity;

  for (const key of islandTiles) {
    const [lx, ly] = key.split(',').map(Number);

    for (const [dx, dy] of ALL_DIRS) {
      const wx = lx + dx, wy = ly + dy;
      if (wx < 0 || wx >= width || wy < 0 || wy >= height) continue;
      if (map[wy][wx] !== WATER) continue;

      // This is a water tile adjacent to the island
      // Score by distance from this coast point to the city (shorter = tanks walk less)
      const landDist = manhattanDistance(lx, ly, city.x, city.y);
      if (landDist < bestDist) {
        bestDist = landDist;
        bestWater = { x: wx, y: wy };
      }
    }
  }

  return bestWater;
}

// ============================================================================
// TRANSPORT MISSION ASSIGNMENT
// ============================================================================

function assignTransportMissions(transports, state, knowledge, knownNeutral, knownPlayer, claimedCities, missions, turnLog) {
  for (const transport of transports) {
    const cargo = state.units.filter(u => u.aboardId === transport.id);

    if (cargo.length > 0) {
      // HAS CARGO - find destination (neutral city preferred, then player city)
      const destinations = [...knownNeutral, ...knownPlayer];
      let assigned = false;

      // Sort by distance to transport
      const sorted = destinations
        .map(c => ({ ...c, dist: manhattanDistance(transport.x, transport.y, c.x, c.y) }))
        .sort((a, b) => a.dist - b.dist);

      for (const dest of sorted) {
        const key = `${dest.x},${dest.y}`;
        if (claimedCities.has(key)) continue;

        // Strategy 1: Find adjacent water tile to land at (coastal city)
        let targetWater = null;
        for (const [dx, dy] of ALL_DIRS) {
          const nx = dest.x + dx, ny = dest.y + dy;
          if (state.map[ny]?.[nx] === WATER) {
            targetWater = { x: nx, y: ny };
            break;
          }
        }

        if (targetWater) {
          claimedCities.add(key);
          missions.set(transport.id, {
            mission: {
              type: 'ferry_invasion',
              target: targetWater,
              targetKey: key,
              priority: 8,
              assignedBy: 'exploration',
              reason: `ferry to city (${dest.x},${dest.y})`
            }
          });
          assigned = true;
          break;
        }

        // Strategy 2: City is landlocked - find nearest coast tile on the same island
        // so transport can unload tanks who walk overland to capture it
        const nearestCoast = findNearestCoastToCity(dest, state, knowledge);
        if (nearestCoast) {
          claimedCities.add(key);
          missions.set(transport.id, {
            mission: {
              type: 'ferry_invasion',
              target: nearestCoast,
              targetKey: key,
              landingType: 'coastal_march',  // Flag: tanks must march overland
              priority: 7,
              assignedBy: 'exploration',
              reason: `ferry to coast near landlocked city (${dest.x},${dest.y})`
            }
          });
          logExplore(`Transport#${transport.id}: landlocked city (${dest.x},${dest.y}), landing at coast (${nearestCoast.x},${nearestCoast.y})`);
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        // No target city - explore water to find new islands
        const waterTarget = findBestExploreTarget(transport, state, knowledge, 'water');
        if (waterTarget) {
          missions.set(transport.id, {
            mission: {
              type: 'explore_sector',
              target: waterTarget,
              priority: 3,
              assignedBy: 'exploration',
              reason: 'transport_explore_with_cargo'
            }
          });
        }
      }
    } else {
      // NO CARGO - go pick up tanks from coastal cities
      const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');
      let assigned = false;

      // Sort cities by number of waiting tanks (prefer larger groups)
      const pickupCities = [];
      for (const city of aiCities) {
        if (!isAdjacentToWater(city.x, city.y, state.map, state.map[0].length, state.map.length)) continue;
        const tanksHere = state.units.filter(u =>
          u.x === city.x && u.y === city.y && u.type === 'tank' && u.owner === 'ai' && !u.aboardId
        );
        if (tanksHere.length === 0) continue;
        pickupCities.push({ city, tankCount: tanksHere.length });
      }
      // Prefer cities with more tanks (fill transport efficiently)
      pickupCities.sort((a, b) => b.tankCount - a.tankCount);

      for (const { city } of pickupCities) {
        // Find adjacent water tile
        for (const [dx, dy] of ALL_DIRS) {
          const nx = city.x + dx, ny = city.y + dy;
          if (state.map[ny]?.[nx] === WATER) {
            missions.set(transport.id, {
              mission: {
                type: 'transport_pickup',
                target: { x: nx, y: ny },
                pickupCity: `${city.x},${city.y}`,
                priority: 6,
                assignedBy: 'exploration',
                reason: `pickup tanks at (${city.x},${city.y})`
              }
            });
            assigned = true;
            break;
          }
        }
        if (assigned) break;
      }

      if (!assigned) {
        missions.set(transport.id, { mission: { type: 'wait', reason: 'transport_no_cargo_no_tanks' } });
      }
    }
  }
}

// ============================================================================
// NAVAL EXPLORATION MISSIONS
// ============================================================================

function assignNavalExplorationMissions(navalUnits, state, knowledge, missions, turnLog) {
  // Check for partially-explored islands with unexplored coastlines
  const partialIslands = (knowledge.islands || []).filter(i => !i.fullyMapped && i.tiles.size > 0);

  for (const unit of navalUnits) {
    // Priority 1: Follow coastline of partially-explored island
    if (partialIslands.length > 0) {
      let bestTarget = null, bestDist = Infinity;
      for (const island of partialIslands) {
        const target = findCoastExploreTarget(unit, state, knowledge, island.tiles);
        if (target && target.dist < bestDist) {
          bestDist = target.dist;
          bestTarget = { ...target, islandId: island.id };
        }
      }
      if (bestTarget) {
        missions.set(unit.id, {
          mission: {
            type: 'explore_island_coast',
            target: { x: bestTarget.x, y: bestTarget.y },
            priority: 6,
            assignedBy: 'exploration',
            reason: `coast explore island#${bestTarget.islandId}`
          }
        });
        continue;
      }
    }

    // Priority 2: Explore open water
    const waterTarget = findBestExploreTarget(unit, state, knowledge, 'water');
    if (waterTarget) {
      missions.set(unit.id, {
        mission: {
          type: 'explore_sector',
          target: waterTarget,
          priority: 4,
          assignedBy: 'exploration',
          reason: 'explore_water'
        }
      });
    } else {
      missions.set(unit.id, { mission: { type: 'wait', reason: 'naval_idle' } });
    }
  }
}

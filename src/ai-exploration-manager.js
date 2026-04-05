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
  const claimedPickupCities = new Set(); // prevent two transports racing to same pickup city
  assignTransportMissions(transports, state, knowledge, knownNeutral, knownPlayer, claimedCities, claimedPickupCities, missions, turnLog);

  // ===== DESTROYERS (exploration allocation): Deep scout in LAND/TRANSITION, coast in NAVAL+ =====
  assignNavalExplorationMissions(destroyers, state, knowledge, missions, turnLog, true, phase);

  // Other naval (carriers in exploration mode) - explore water
  assignNavalExplorationMissions(otherNaval, state, knowledge, missions, turnLog, false, phase);

  return missions;
}

// ============================================================================
// FIGHTER MISSION ASSIGNMENT — SPOKE PATTERN
// ============================================================================
// Each fighter picks an outer AI city as a base and flies SCAN_DEPTH tiles
// outward in a cardinal direction, shifting the perpendicular offset each turn
// to cover adjacent strips. Fuel-critical logic returns it to base to refuel.
// New captured cities automatically extend exploration to the next tier.

const FIGHTER_FUEL = 20;
const FUEL_SAFETY  = 2;                                             // buffer tiles
const SCAN_DEPTH   = Math.floor((FIGHTER_FUEL - FUEL_SAFETY) / 2); // = 9

// ALL_DIRS includes diagonals, so movement cost = Chebyshev distance (max|dx|,|dy|),
// not Manhattan. Use chebDist for all fighter fuel calculations.
const chebDist = (x1, y1, x2, y2) => Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));

// 8-spoke directions: 4 cardinals + 4 diagonals, each with a perpendicular vector
const SPOKE_DIRS = [
  { dx:  1, dy:  0, name: 'E',  perpDx: 0, perpDy:  1 },
  { dx: -1, dy:  0, name: 'W',  perpDx: 0, perpDy:  1 },
  { dx:  0, dy: -1, name: 'N',  perpDx: 1, perpDy:  0 },
  { dx:  0, dy:  1, name: 'S',  perpDx: 1, perpDy:  0 },
  { dx:  1, dy: -1, name: 'NE', perpDx: 1, perpDy:  1 },
  { dx: -1, dy: -1, name: 'NW', perpDx: 1, perpDy: -1 },
  { dx:  1, dy:  1, name: 'SE', perpDx: 1, perpDy: -1 },
  { dx: -1, dy:  1, name: 'SW', perpDx: 1, perpDy:  1 },
];

/** Next uncovered perpendicular strip for a spoke from base in direction dir. */
function findNextSpokeTarget(base, dir, state, knowledge, excluded) {
  const maxOff = Math.max(state.width, state.height);
  for (let offset = 0; offset <= maxOff; offset += 2) {
    const signs = offset === 0 ? [1] : [1, -1];
    for (const sign of signs) {
      const po = sign * offset;
      const tx = base.x + dir.dx * SCAN_DEPTH + dir.perpDx * po;
      const ty = base.y + dir.dy * SCAN_DEPTH + dir.perpDy * po;
      if (tx < 0 || tx >= state.width || ty < 0 || ty >= state.height) continue;
      const key = `${tx},${ty}`;
      if (knowledge.exploredTiles.has(key) || excluded.has(key)) continue;
      return { x: tx, y: ty };
    }
  }
  return null;
}

/** Best (base city, target) spoke for a fighter. */
function findBestSpoke(fighter, aiCities, refuelPoints, state, knowledge, excluded) {
  let best = null;
  let bestScore = -Infinity;

  for (const city of aiCities) {
    const distToCity = chebDist(fighter.x, fighter.y, city.x, city.y);
    for (const dir of SPOKE_DIRS) {
      const target = findNextSpokeTarget(city, dir, state, knowledge, excluded);
      if (!target) continue;

      // No pre-flight range check — per-step fuel safety in decideNextStep handles it.
      // Just score by unexplored density and proximity of the base city to the fighter.

      // Density: unexplored tiles in 5×5 around target
      let density = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = target.x + dx, ny = target.y + dy;
        if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height &&
            !knowledge.exploredTiles.has(`${nx},${ny}`)) density++;
      }
      if (density === 0) continue;

      const score = density * 2 - distToCity;
      if (score > bestScore) { bestScore = score; best = { base: city, target, dir }; }
    }
  }
  return best;
}

function assignFighterMissions(fighters, state, knowledge, refuelPoints, aiCities, _claimedSectors, missions, turnLog) {
  if (fighters.length === 0) return;

  // Check for partially-explored non-home islands (high priority exploration)
  const nonHomeIslands = (knowledge.islands || []).filter(i => !i.isHomeIsland && !i.fullyMapped);

  const islandAssignments = new Map(); // islandId -> fighterId (max 1 per island)
  const claimedTargets = new Set();    // Prevent two fighters targeting same tile

  for (const fighter of fighters) {
    const nearestRefuel = findNearest(fighter, refuelPoints);
    if (!nearestRefuel) {
      missions.set(fighter.id, { mission: { type: 'wait', reason: 'no_refuel', priority: 0, assignedBy: 'exploration' } });
      continue;
    }

    const distToRefuel = chebDist(fighter.x, fighter.y, nearestRefuel.x, nearestRefuel.y);

    // Priority 0: Fuel critical — return immediately
    if (fighter.fuel <= distToRefuel + FUEL_SAFETY) {
      missions.set(fighter.id, {
        mission: { type: 'rebase', target: { x: nearestRefuel.x, y: nearestRefuel.y }, priority: 9, assignedBy: 'exploration', reason: 'fuel_critical' }
      });
      continue;
    }

    // Priority 1: Non-home island interior (max 1 fighter per island)
    let assignedIsland = false;
    for (const island of nonHomeIslands) {
      if (islandAssignments.has(island.id)) continue;
      const closest = findClosestIslandToExploreFromRefuel(fighter, island, knowledge, state, refuelPoints);
      if (closest && closest.roundTripFuel + FUEL_SAFETY <= fighter.fuel) {
        islandAssignments.set(island.id, fighter.id);
        claimedTargets.add(`${closest.target.x},${closest.target.y}`);
        missions.set(fighter.id, {
          mission: { type: 'explore_island_interior', target: closest.target, priority: 8, assignedBy: 'exploration', reason: `island#${island.id} interior` }
        });
        assignedIsland = true;
        break;
      }
    }
    if (assignedIsland) continue;

    // Priority 2: Spoke exploration from best outer city
    const spoke = findBestSpoke(fighter, aiCities, refuelPoints, state, knowledge, claimedTargets);
    if (spoke) {
      const { base, target, dir } = spoke;
      claimedTargets.add(`${target.x},${target.y}`);

      // Go straight for the spoke target. Per-step fuel checks in decideNextStep will
      // turn the fighter around to refuel whenever the next step would be unsafe.
      missions.set(fighter.id, {
        mission: { type: 'explore_sector', target: { x: target.x, y: target.y }, priority: 6, assignedBy: 'exploration', reason: `spoke-${dir.name} from (${base.x},${base.y})` }
      });
      continue;
    }

    // No spoke target found — return to refuel
    missions.set(fighter.id, {
      mission: { type: 'rebase', target: { x: nearestRefuel.x, y: nearestRefuel.y }, priority: 3, assignedBy: 'exploration', reason: 'all_covered' }
    });
    logExplore(`fighter#${fighter.id}: all coverage done, returning`);
  }
}

/**
 * Find closest unexplored tile near a non-home island reachable round-trip.
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

      const distToTarget = chebDist(fighter.x, fighter.y, nx, ny);
      let bestReturn = Infinity;
      for (const rp of refuelPoints) {
        const d = chebDist(nx, ny, rp.x, rp.y);
        if (d < bestReturn) bestReturn = d;
      }
      const roundTrip = distToTarget + bestReturn;
      if (roundTrip < bestFuel) {
        bestFuel = roundTrip;
        best = { target: { x: nx, y: ny }, roundTripFuel: roundTrip };
      }
    }
  }
  return best;
}

// ============================================================================
// TANK MISSION ASSIGNMENT
// ============================================================================

/**
 * Find the nearest unexplored land tile that is adjacent to water (coastal frontier).
 * Tanks sent here will trace island outlines first, maximising new tiles revealed per
 * step and ensuring coastlines are never left behind an inland sweep.
 */
function findNearestUnexploredCoast(unit, state, knowledge) {
  const { width, height, map } = state;
  let best = null, bestDist = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;
      if (map[y][x] === WATER) continue;
      if (!isAdjacentToWater(x, y, map, width, height)) continue;
      const dist = manhattanDistance(unit.x, unit.y, x, y);
      if (dist < bestDist) { bestDist = dist; best = { x, y, dist }; }
    }
  }
  return best;
}

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

  // LAND phase: pre-count tanks already staged at transport-building cities so we
  // can rally additional tanks there. Target: 3 per in-production transport so the
  // first voyage departs loaded rather than empty.
  const TRANSPORT_STAGING_TARGET = 3;
  const transportStagingCounts = new Map();
  if (phase === PHASE.LAND) {
    for (const [key, city] of Object.entries(state.cities)) {
      if (city.owner !== 'ai' || city.producing !== 'transport') continue;
      const staged = state.units.filter(u =>
        u.owner === 'ai' && u.type === 'tank' && u.x === city.x && u.y === city.y
      ).length;
      transportStagingCounts.set(key, staged);
    }
  }

  for (const { tank, reachable, reachableNeutral, reachablePlayer } of tanksByDistance) {
    // ===== P0: Hold tanks that are staging in a city building a transport =====
    // If the tank is sitting in an AI city that's currently producing a transport,
    // keep it there so it gets auto-loaded when the transport spawns.
    const tankCityKey = `${tank.x},${tank.y}`;
    const tankCity = state.cities[tankCityKey];
    if (tankCity?.owner === 'ai' && tankCity.producing === 'transport') {
      missions.set(tank.id, { mission: { type: 'wait', reason: 'staging_for_transport' } });
      continue;
    }

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
      // ===== P0.5: Rally tanks to transport-building city =====
      // Ensures the transport doesn't sail empty on its first voyage.
      // Only kicks in when staging count is below target and this tank can reach the city.
      if (transportStagingCounts.size > 0) {
        let rallied = false;
        for (const [tcKey, staged] of transportStagingCounts) {
          if (staged >= TRANSPORT_STAGING_TARGET) continue;
          const [tx, ty] = tcKey.split(',').map(Number);
          if (tank.x === tx && tank.y === ty) continue; // P0 already holds tanks here
          if (!reachable.has(tcKey)) continue;
          missions.set(tank.id, {
            mission: { type: 'stage_for_transport', target: { x: tx, y: ty }, priority: 6, assignedBy: 'exploration', reason: 'rally_to_transport' }
          });
          transportStagingCounts.set(tcKey, staged + 1);
          rallied = true;
          break;
        }
        if (rallied) continue;
      }

      // Find the best explore target — coastal frontier first (traces island outline,
      // reveals more per step), then nearest unexplored land, then direct reachable scan.
      let exploreTarget = null;
      const coastHint = findNearestUnexploredCoast(tank, state, knowledge);
      if (coastHint && reachable.has(`${coastHint.x},${coastHint.y}`)) {
        exploreTarget = coastHint;
      } else {
        const hint = findBestExploreTarget(tank, state, knowledge, 'land');
        if (hint && reachable.has(`${hint.x},${hint.y}`)) {
          exploreTarget = hint;
        } else {
          const anyTarget = findNearestUnexplored(tank, state, knowledge);
          if (anyTarget && reachable.has(`${anyTarget.x},${anyTarget.y}`)) {
            exploreTarget = anyTarget;
          } else {
            // Direct scan: find any unexplored tile within the reachable land area
            let bestDist = Infinity;
            for (const key of reachable) {
              if (knowledge.exploredTiles.has(key)) continue;
              const [rx, ry] = key.split(',').map(Number);
              const d = manhattanDistance(tank.x, tank.y, rx, ry);
              if (d < bestDist) { bestDist = d; exploreTarget = { x: rx, y: ry }; }
            }
          }
        }
      }

      if (exploreTarget) {
        missions.set(tank.id, {
          mission: {
            type: 'explore_sector',
            target: { x: exploreTarget.x, y: exploreTarget.y },
            priority: 5,
            assignedBy: 'exploration',
            reason: 'explore_land'
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
      // Coastal-first on foreign islands too — find cities on the outline quickly
      const coastTarget = findNearestUnexploredCoast(tank, state, knowledge);
      const target = (coastTarget && reachable.has(`${coastTarget.x},${coastTarget.y}`))
        ? coastTarget
        : findBestExploreTarget(tank, state, knowledge, 'land');
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

    // === GARRISON: Exactly 1 tank per city (skip in TRANSITION — all tanks should stage) ===
    if (!missions.has(tank.id) && phase !== PHASE.TRANSITION) {
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

function assignTransportMissions(transports, state, knowledge, knownNeutral, knownPlayer, claimedCities, claimedPickupCities, missions, turnLog) {
  const activeMissions = knowledge.activeMissions || {};

  // ===== PHASE 1: Lock active deliveries =====
  // A transport with cargo on a valid ferry_invasion keeps its mission — never interrupted.
  // "Valid" means: has a targetKey, and the city is not yet AI-owned.
  const lockedTransports = new Set();
  for (const transport of transports) {
    const cargo = state.units.filter(u => u.aboardId === transport.id);
    const prevMission = activeMissions[transport.id];
    if (cargo.length > 0 && prevMission?.type === 'ferry_invasion' && prevMission.targetKey) {
      const targetCity = state.cities[prevMission.targetKey];
      if (targetCity && targetCity.owner !== 'ai') {
        claimedCities.add(prevMission.targetKey);
        missions.set(transport.id, { mission: prevMission });
        lockedTransports.add(transport.id);
      }
    }
  }

  // Remaining transports available for city assignment or free use
  const available = transports.filter(t => !lockedTransports.has(t.id));

  // ===== PHASE 2: City coverage — city-first assignment =====
  // For each unclaimed target city, assign the nearest available transport.
  // Neutral cities have priority over player cities.
  const sortedCities = [
    ...knownNeutral.filter(c => !claimedCities.has(`${c.x},${c.y}`)),
    ...knownPlayer.filter(c => !claimedCities.has(`${c.x},${c.y}`))
  ];

  const assignedInPhase2 = new Set(); // transport IDs committed in this phase

  for (const city of sortedCities) {
    const cityKey = `${city.x},${city.y}`;
    if (claimedCities.has(cityKey)) continue;

    // Find nearest available transport (not yet committed in phase 2)
    let bestTransport = null;
    let bestDist = Infinity;
    for (const t of available) {
      if (assignedInPhase2.has(t.id)) continue;
      const d = manhattanDistance(t.x, t.y, city.x, city.y);
      if (d < bestDist) { bestDist = d; bestTransport = t; }
    }
    if (!bestTransport) break; // No transports left to assign

    claimedCities.add(cityKey);
    assignedInPhase2.add(bestTransport.id);
    const cargo = state.units.filter(u => u.aboardId === bestTransport.id);

    if (cargo.length > 0) {
      // Loaded transport — ferry directly to this city
      const landing = findLandingTarget(city, state, knowledge);
      if (landing) {
        missions.set(bestTransport.id, {
          mission: {
            type: 'ferry_invasion',
            target: landing.water,
            targetKey: cityKey,
            landingType: landing.type,
            priority: 8,
            assignedBy: 'exploration',
            reason: `ferry to city (${city.x},${city.y})`
          }
        });
      }
    } else {
      // Empty transport — go pick up tanks, then next turn will get ferry_invasion
      const pickupResult = findPickupCity(bestTransport, state, claimedPickupCities);
      if (pickupResult) {
        claimedPickupCities.add(pickupResult.cityKey);
        missions.set(bestTransport.id, {
          mission: {
            type: 'transport_pickup',
            target: pickupResult.water,
            pickupCity: pickupResult.cityKey,
            priority: 6,
            assignedBy: 'exploration',
            reason: `pickup for city (${city.x},${city.y})`
          }
        });
      } else {
        // No tanks to load — rendezvous at nearest coastal AI city to wait
        const rendezvous = findRendezvousTarget(bestTransport, state);
        if (rendezvous) {
          missions.set(bestTransport.id, {
            mission: { type: 'transport_rendezvous', target: rendezvous, priority: 4, assignedBy: 'exploration', reason: `rendezvous for city (${city.x},${city.y})` }
          });
        } else {
          const waterTarget = findBestExploreTarget(bestTransport, state, knowledge, 'water');
          missions.set(bestTransport.id, {
            mission: waterTarget
              ? { type: 'explore_sector', target: waterTarget, priority: 2, assignedBy: 'exploration', reason: 'transport_explore_empty_phase2' }
              : { type: 'wait', reason: 'transport_no_pickup' }
          });
        }
      }
    }
  }

  // ===== PHASE 3: Remaining transports — no city assignment =====
  for (const transport of available) {
    if (assignedInPhase2.has(transport.id)) continue;

    const cargo = state.units.filter(u => u.aboardId === transport.id);
    const prevMission = activeMissions[transport.id];

    if (cargo.length > 0) {
      // Loaded but no city to deliver to — explore with cargo to find new islands
      const waterTarget = findBestExploreTarget(transport, state, knowledge, 'water');
      if (waterTarget) {
        missions.set(transport.id, {
          mission: { type: 'explore_sector', target: waterTarget, priority: 3, assignedBy: 'exploration', reason: 'transport_explore_with_cargo' }
        });
      }
    } else {
      // No cargo — check if persisted pickup mission is still valid
      if (prevMission?.type === 'transport_pickup' && prevMission.pickupCity) {
        const [pcx, pcy] = prevMission.pickupCity.split(',').map(Number);
        const atPickup = manhattanDistance(transport.x, transport.y, pcx, pcy) <= 1;
        const pcity = state.cities[prevMission.pickupCity];
        const tanksStillThere = state.units.some(u =>
          u.x === pcx && u.y === pcy && u.type === 'tank' && u.owner === 'ai' && !u.aboardId
        );
        if (!atPickup && tanksStillThere && !claimedPickupCities.has(prevMission.pickupCity) && pcity?.owner === 'ai') {
          claimedPickupCities.add(prevMission.pickupCity);
          missions.set(transport.id, { mission: prevMission });
          continue;
        }
      }

      // Find best pickup (prefer cities with more tanks)
      const pickupResult = findPickupCity(transport, state, claimedPickupCities);
      if (pickupResult) {
        claimedPickupCities.add(pickupResult.cityKey);
        missions.set(transport.id, {
          mission: {
            type: 'transport_pickup',
            target: pickupResult.water,
            pickupCity: pickupResult.cityKey,
            priority: 6,
            assignedBy: 'exploration',
            reason: `pickup tanks at (${pickupResult.cityKey})`
          }
        });
        continue;
      }

      // No tanks staged — rendezvous or explore
      const hasTargets = knownNeutral.length > 0 || knownPlayer.length > 0;
      if (hasTargets) {
        const rendezvous = findRendezvousTarget(transport, state);
        if (rendezvous && (transport.x !== rendezvous.cx || transport.y !== rendezvous.cy)) {
          missions.set(transport.id, {
            mission: { type: 'transport_rendezvous', target: rendezvous, priority: 3, assignedBy: 'exploration', reason: `rendezvous at coast` }
          });
          continue;
        }
      }

      const waterTarget = findBestExploreTarget(transport, state, knowledge, 'water');
      missions.set(transport.id, {
        mission: waterTarget
          ? { type: 'explore_sector', target: waterTarget, priority: 2, assignedBy: 'exploration', reason: 'transport_explore_empty' }
          : { type: 'wait', reason: 'transport_no_targets' }
      });
    }
  }
}

// Returns { water, type } for landing adjacent to a city, or null.
function findLandingTarget(city, state, knowledge) {
  for (const [dx, dy] of ALL_DIRS) {
    const nx = city.x + dx, ny = city.y + dy;
    if (state.map[ny]?.[nx] === WATER) return { water: { x: nx, y: ny }, type: 'direct' };
  }
  const coast = findNearestCoastToCity(city, state, knowledge);
  if (coast) {
    logExplore(`City (${city.x},${city.y}) landlocked, landing at (${coast.x},${coast.y})`);
    return { water: coast, type: 'coastal_march' };
  }
  return null;
}

// Returns { water, cityKey } for the best pickup city, or null.
// Prefers cities with more tanks (fills transport efficiently).
// Skips cities claimed by another transport or whose local transport is nearly done.
function findPickupCity(transport, state, claimedPickupCities) {
  const pickupCities = [];
  for (const [cityKey, city] of Object.entries(state.cities)) {
    if (city.owner !== 'ai') continue;
    if (!isAdjacentToWater(city.x, city.y, state.map, state.map[0].length, state.map.length)) continue;
    if (claimedPickupCities.has(cityKey)) continue;
    const tanksHere = state.units.filter(u =>
      u.x === city.x && u.y === city.y && u.type === 'tank' && u.owner === 'ai' && !u.aboardId
    );
    if (tanksHere.length === 0) continue;
    if (city.producing === 'transport' && tanksHere.length >= 2) {
      const turnsLeft = 10 - (city.progress?.transport || 0);
      if (turnsLeft <= 5) continue; // Let them wait for local transport
    }
    pickupCities.push({ city, cityKey, tankCount: tanksHere.length });
  }
  pickupCities.sort((a, b) => b.tankCount - a.tankCount);

  for (const { city, cityKey } of pickupCities) {
    for (const [dx, dy] of ALL_DIRS) {
      const nx = city.x + dx, ny = city.y + dy;
      if (state.map[ny]?.[nx] === WATER) return { water: { x: nx, y: ny }, cityKey };
    }
  }
  return null;
}

// Returns a water tile adjacent to the nearest coastal AI city, or null.
function findRendezvousTarget(transport, state) {
  const coastalCities = Object.values(state.cities).filter(c =>
    c.owner === 'ai' &&
    isAdjacentToWater(c.x, c.y, state.map, state.map[0].length, state.map.length)
  );
  const nearest = findNearest(transport, coastalCities);
  if (!nearest) return null;
  for (const [dx, dy] of ALL_DIRS) {
    const nx = nearest.x + dx, ny = nearest.y + dy;
    if (state.map[ny]?.[nx] === WATER) return { x: nx, y: ny, cx: nearest.x, cy: nearest.y };
  }
  return null;
}

// ============================================================================
// NAVAL EXPLORATION MISSIONS
// ============================================================================

/**
 * Find the best unexplored water tile for a destroyer: prefer tiles that are
 * far away AND surrounded by high unexplored density (deep frontier scouting).
 * Unlike fighters, destroyers have null fuel so no return-trip constraint.
 */
function findDestroyerDeepTarget(unit, state, knowledge) {
  const { width, height, map } = state;
  let best = null, bestScore = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (map[y][x] !== WATER) continue;
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;

      const dist = manhattanDistance(unit.x, unit.y, x, y);

      // Count unexplored tiles in 5×5 neighbourhood — measures how much unknown
      // territory this tile sits next to (high = edge of vast unknown)
      let density = 0;
      for (let dy2 = -2; dy2 <= 2; dy2++) {
        for (let dx2 = -2; dx2 <= 2; dx2++) {
          const nx = x + dx2, ny = y + dy2;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (!knowledge.exploredTiles.has(`${nx},${ny}`)) density++;
          }
        }
      }

      // Score: want far tiles with high unexplored density.
      // density * 3 strongly rewards open-ocean frontier over crawling along
      // an already-explored coastline.
      const score = dist + density * 3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function assignNavalExplorationMissions(navalUnits, state, knowledge, missions, turnLog, useDeepScouting = false, phase = PHASE.LAND) {
  // In LAND/TRANSITION, destroyers push outward into unexplored ocean — fighters and
  // transports handle nearby island coastlines.  In NAVAL/LATE_GAME, coastline following
  // is useful again (enemy contact established, island shape matters for routing).
  const destroyerDeepFirst = useDeepScouting &&
    (phase === PHASE.LAND || phase === PHASE.TRANSITION);

  // Check for partially-explored islands with unexplored coastlines
  const partialIslands = (knowledge.islands || []).filter(i => !i.fullyMapped && i.tiles.size > 0);

  for (const unit of navalUnits) {
    // Priority 1 (destroyers in LAND/TRANSITION): Deep frontier scouting first —
    // explore beyond fighter range before worrying about nearby coastlines.
    if (destroyerDeepFirst) {
      const deepTarget = findDestroyerDeepTarget(unit, state, knowledge);
      if (deepTarget) {
        missions.set(unit.id, {
          mission: {
            type: 'explore_sector',
            target: deepTarget,
            priority: 6,
            assignedBy: 'exploration',
            reason: 'destroyer_deep_scout'
          }
        });
        continue;
      }
    }

    // Priority 1 (non-destroyer or NAVAL+): Follow coastline of partially-explored island
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
            priority: 5,
            assignedBy: 'exploration',
            reason: `coast explore island#${bestTarget.islandId}`
          }
        });
        continue;
      }
    }

    // Priority 2 (destroyers in NAVAL+): Deep frontier scouting after coast is done
    if (useDeepScouting && !destroyerDeepFirst) {
      const deepTarget = findDestroyerDeepTarget(unit, state, knowledge);
      if (deepTarget) {
        missions.set(unit.id, {
          mission: {
            type: 'explore_sector',
            target: deepTarget,
            priority: 4,
            assignedBy: 'exploration',
            reason: 'destroyer_deep_scout'
          }
        });
        continue;
      }
    }

    // Fallback: nearest unexplored water
    const waterTarget = findBestExploreTarget(unit, state, knowledge, 'water');
    if (waterTarget) {
      missions.set(unit.id, {
        mission: {
          type: 'explore_sector',
          target: waterTarget,
          priority: 3,
          assignedBy: 'exploration',
          reason: 'explore_water'
        }
      });
    } else {
      missions.set(unit.id, { mission: { type: 'wait', reason: 'naval_idle' } });
    }
  }
}

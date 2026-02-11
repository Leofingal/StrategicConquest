// ============================================================================
// STRATEGIC CONQUEST - AI HELPERS MODULE
// ============================================================================
// Shared utilities for all AI managers. Pure functions, no state mutation.
// Dependencies: game-constants.js, movement-engine.js, fog-of-war.js

import {
  WATER, LAND, NEUTRAL_CITY, PLAYER_CITY, AI_CITY, UNIT_SPECS, ALL_DIRS,
  STATUS_READY, STATUS_GOTO, STATUS_USED, STATUS_SKIPPED, STATUS_ABOARD, manhattanDistance
} from './game-constants.js';
import { isAdjacentToWater, findPath } from './movement-engine.js';
import { calculateVisibility } from './fog-of-war.js';

// ============================================================================
// DEBUG LOGGING
// ============================================================================

// Master switches - set to false to silence categories
const DEBUG = true;
const DEBUG_PHASE = true;
const DEBUG_MISSIONS = true;

export const log = (...args) => DEBUG && console.log('[AI]', ...args);
export const logPhase = (...args) => DEBUG_PHASE && console.log('[AI][PHASE]', ...args);
export const logMission = (...args) => DEBUG_MISSIONS && console.log('[AI][MISSION]', ...args);

// Consolidated turn summary logger
export function logTurnSummary(state, knowledge, missions, turnLog) {
  const totalTiles = state.width * state.height;
  const explorePct = (knowledge.exploredTiles.size / totalTiles * 100).toFixed(1);
  const cities = Object.values(state.cities);
  const aiCities = cities.filter(c => c.owner === 'ai');
  const knownNeutral = [];
  const knownPlayer = [];
  for (const [key, city] of Object.entries(state.cities)) {
    if (!knowledge.exploredTiles.has(key)) continue;
    if (city.owner === 'neutral') knownNeutral.push(city);
    else if (city.owner === 'player') knownPlayer.push(city);
  }

  console.log(`[AI][PHASE] ${knowledge.explorationPhase}`);
  console.log(`[AI][EXPLORE] ${explorePct}% explored (${knowledge.exploredTiles.size}/${totalTiles})`);
  console.log(`[AI][EXPLORE] ${knownNeutral.length} neutral cities known, ${knownPlayer.length} player cities known`);

  // Island summary - use homeIslandTiles for accurate home island stats
  if (knowledge.homeIslandTiles) {
    let homeExplored = 0;
    for (const key of knowledge.homeIslandTiles) {
      if (knowledge.exploredTiles.has(key)) homeExplored++;
    }
    const homePct = (homeExplored / knowledge.homeIslandTiles.size * 100).toFixed(0);
    const homeCities = knowledge.homeIslandCities ? knowledge.homeIslandCities.size : '?';
    const homeCaptured = knowledge.homeIslandCities
      ? [...knowledge.homeIslandCities].filter(k => state.cities[k]?.owner === 'ai').length
      : '?';
    console.log(`[AI][EXPLORE] Home island: ${homeExplored}/${knowledge.homeIslandTiles.size} tiles explored (${homePct}%), cities: ${homeCaptured}/${homeCities} captured`);
  }
  if (knowledge.islands && knowledge.islands.length > 0) {
    const others = knowledge.islands.filter(i => !i.isHomeIsland);
    if (others.length > 0) {
      for (const island of others) {
        console.log(`[AI][EXPLORE] Island#${island.id}: ${island.tiles.size} tiles, ${island.cities.size} cities`);
      }
    }
  }

  // Production summary
  for (const city of aiCities) {
    const key = `${city.x},${city.y}`;
    const coastal = isAdjacentToWater(city.x, city.y, state.map, state.map[0].length, state.map.length);
    const prod = city.producing || 'none';
    const spec = UNIT_SPECS[prod];
    const progress = city.progress?.[prod] || 0;
    const total = spec ? spec.productionDays : '?';
    const tag = coastal ? ' [COASTAL]' : '';
    console.log(`[AI][PROD] City (${city.x},${city.y}): ${prod} - ${progress}/${total} days${tag}`);
  }

  // Unit counts
  const unitCounts = {};
  for (const type of Object.keys(UNIT_SPECS)) unitCounts[type] = 0;
  for (const u of state.units) {
    if (u.owner === 'ai') unitCounts[u.type]++;
  }
  const countStr = Object.entries(unitCounts)
    .filter(([_, c]) => c > 0)
    .map(([t, c]) => `${t}: ${c}`)
    .join(', ');
  console.log(`[AI][UNITS] ${countStr}`);

  // Mission summary
  if (missions && missions.size > 0) {
    let missionCount = 0;
    for (const [unitId, assignment] of missions) {
      if (!assignment.mission) continue;
      const unit = state.units.find(u => u.id === unitId);
      if (!unit) continue;
      const m = assignment.mission;
      const pos = `@(${unit.x},${unit.y})`;
      const targetStr = m.target ? `(${m.target.x},${m.target.y})` : '';
      // Show cargo count for transports
      let extra = '';
      if (unit.type === 'transport') {
        const cargo = state.units.filter(u => u.aboardId === unit.id);
        extra = ` [cargo:${cargo.length}]`;
      }
      console.log(`[AI][MISSION] ${unit.type}#${unitId}${pos}: ${m.type}${targetStr} - ${m.reason || ''}${extra}`);
      missionCount++;
      if (missionCount >= 15) {
        console.log(`[AI][MISSION] ... and ${missions.size - missionCount} more`);
        break;
      }
    }
  }
}

// ============================================================================
// PHASES & DISTRIBUTIONS
// ============================================================================

export const PHASE = {
  LAND: 'land_phase',
  TRANSITION: 'transition',
  NAVAL: 'naval_phase',
  LATE_GAME: 'late_game'
};

export const TARGET_DIST = {
  [PHASE.LAND]: { tank: 1.00 },
  [PHASE.TRANSITION]: { tank: 0.50, transport: 0.18, fighter: 0.17, destroyer: 0.15 },
  [PHASE.NAVAL]: { tank: 0.50, destroyer: 0.13, fighter: 0.15, transport: 0.12, battleship: 0.04, carrier: 0.03, submarine: 0.03 },
  [PHASE.LATE_GAME]: { tank: 0.35, destroyer: 0.18, fighter: 0.15, transport: 0.10, bomber: 0.05, battleship: 0.08, carrier: 0.05, submarine: 0.04 }
};

export const AI_CONFIG = {
  exploration: {
    homeComplete: 0.90,
    navalMapThreshold: 0.40,
    lateNeutral: 0.10,
    lateCityControl: 0.60,
    lateStrength: 2.0
  },
  fuel: { fighterReturn: 0.35, bomberReturn: 0.30 },
  defense: { garrisonPerCity: 1 },
  tactical: {
    fighterPatrolByPhase: {
      land_phase: 0.00,
      transition: 0.00,
      naval_phase: 0.25,
      late_game: 0.50
    },
    transportThreatRange: 8,
    navalThreatRange: 5
  }
};

// Unit allocation by phase: fraction given to tactical manager
export const TACTICAL_ALLOCATION = {
  [PHASE.LAND]: { fighter: 0, destroyer: 0, submarine: 0, battleship: 0, carrier: 0, bomber: 0 },
  [PHASE.TRANSITION]: { fighter: 0, destroyer: 0, submarine: 0, battleship: 0, carrier: 0, bomber: 0 },
  [PHASE.NAVAL]: { fighter: 0.30, destroyer: 0.70, submarine: 1.0, battleship: 1.0, carrier: 0.70, bomber: 0.50 },
  [PHASE.LATE_GAME]: { fighter: 0.70, destroyer: 0.90, submarine: 1.0, battleship: 1.0, carrier: 0.90, bomber: 1.0 }
};

export const setAIConfig = (c) => Object.assign(AI_CONFIG, c);
export const getAIConfig = () => ({ ...AI_CONFIG });

// ============================================================================
// GEOMETRY & PATHFINDING HELPERS
// ============================================================================

export function findNearest(from, targets) {
  if (!targets || targets.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const t of targets) {
    const d = manhattanDistance(from.x, from.y, t.x, t.y);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

export function floodFillLand(startX, startY, state) {
  const { map, width, height } = state;
  const result = new Set();
  const queue = [[startX, startY]];
  const visited = new Set();

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (map[y][x] === WATER) continue;
    result.add(key);
    for (const [dx, dy] of ALL_DIRS) {
      queue.push([x + dx, y + dy]);
    }
  }
  return result;
}

// Flood fill only through EXPLORED land tiles (for partial island tracking)
export function floodFillExploredLand(startX, startY, state, exploredTiles) {
  const { map, width, height } = state;
  const result = new Set();
  const queue = [[startX, startY]];
  const visited = new Set();

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (!exploredTiles.has(key)) continue;
    if (map[y][x] === WATER) continue;
    result.add(key);
    for (const [dx, dy] of ALL_DIRS) {
      queue.push([x + dx, y + dy]);
    }
  }
  return result;
}

// Path cache: stores computed A* paths keyed by "unitId->targetX,targetY"
// Cleared each turn in clearPathCache()
const _pathCache = new Map();

export function clearPathCache() {
  _pathCache.clear();
}

/**
 * Find the best single-step move toward a target using A* pathfinding.
 * Uses findPath from movement-engine.js to compute a full route, then
 * returns the first step. Paths are cached per unit+target so repeated
 * calls within the same turn reuse the same path.
 *
 * Falls back to:
 * 1. Greedy best adjacent tile (original behavior) if A* fails
 * 2. Any valid adjacent tile if greedy also fails (prevents wasting all moves)
 */
export function getMoveToward(unit, target, state) {
  const spec = UNIT_SPECS[unit.type];
  const { map, width, height, units, cities } = state;

  // Helper: check if an adjacent tile is free to move into (no enemies, no naval collision)
  function isValidStep(nx, ny) {
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) return false;
    const tile = map[ny][nx];

    // Terrain check
    if (spec.isNaval && tile !== WATER && !cities[`${nx},${ny}`]) return false;
    if (spec.isLand && tile === WATER) return false;
    // Aircraft can go anywhere

    // Collision check
    const unitsAtDest = units.filter(u => u.x === nx && u.y === ny && !u.aboardId);
    const enemiesAtDest = unitsAtDest.filter(u => u.owner !== 'ai');
    if (enemiesAtDest.length > 0) return false;
    const friendsAtDest = unitsAtDest.filter(u => u.owner === 'ai');
    if (spec.isNaval && friendsAtDest.some(u => UNIT_SPECS[u.type].isNaval) && !cities[`${nx},${ny}`]) return false;

    return true;
  }

  // === STRATEGY 1: A* pathfinding (cached) ===
  const cacheKey = `${unit.id}->${target.x},${target.y}`;
  let path = _pathCache.get(cacheKey);

  if (!path) {
    // Compute A* path (cap search distance to avoid huge computations on large maps)
    const maxDist = Math.min(200, width + height);
    // findPath needs a unit with owner set for isFriendlyCity checks
    path = findPath(unit.x, unit.y, target.x, target.y, unit, state, maxDist);
    if (path && path.length > 0) {
      _pathCache.set(cacheKey, path);
    }
  }

  if (path && path.length > 0) {
    // Walk along cached path, consuming steps already passed
    // Find the first step in the path we haven't reached yet
    let stepIdx = 0;
    for (let i = 0; i < path.length; i++) {
      if (path[i].x === unit.x && path[i].y === unit.y) {
        stepIdx = i + 1; // Next step after current position
      }
    }

    if (stepIdx < path.length) {
      const nextStep = path[stepIdx];
      // Validate the step is still clear (units may have moved since path was cached)
      if (isValidStep(nextStep.x, nextStep.y)) {
        return { x: nextStep.x, y: nextStep.y };
      } else {
        // Path is blocked, invalidate cache and fall through to greedy
        _pathCache.delete(cacheKey);
        log(`[PATH] Cached path blocked for ${unit.type}#${unit.id} at step ${stepIdx}, falling back`);
      }
    } else {
      // We've reached or passed all steps in the path
      _pathCache.delete(cacheKey);
    }
  }

  // === STRATEGY 2: Greedy best adjacent tile (fallback) ===
  let bestMove = null, bestDist = Infinity;
  const validMoves = [];

  for (const [dx, dy] of ALL_DIRS) {
    const nx = unit.x + dx, ny = unit.y + dy;
    if (!isValidStep(nx, ny)) continue;

    validMoves.push({ x: nx, y: ny });
    const dist = manhattanDistance(nx, ny, target.x, target.y);
    if (dist < bestDist) { bestDist = dist; bestMove = { x: nx, y: ny }; }
  }

  if (bestMove) return bestMove;

  // === STRATEGY 3: Any valid adjacent tile (prevents wasting all moves) ===
  if (validMoves.length > 0) {
    // Pick a random valid move rather than losing all remaining movement
    const pick = validMoves[Math.floor(Math.random() * validMoves.length)];
    log(`[PATH] ${unit.type}#${unit.id} stuck, taking random valid move to (${pick.x},${pick.y})`);
    return pick;
  }

  // Truly stuck (surrounded by impassable terrain or enemies on all sides)
  return null;
}

// Find nearest unexplored tile (any terrain)
export function findNearestUnexplored(unit, state, knowledge) {
  const { width, height } = state;
  let best = null, bestDist = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;
      const dist = manhattanDistance(unit.x, unit.y, x, y);
      if (dist < bestDist) { bestDist = dist; best = { x, y, dist }; }
    }
  }
  return best;
}

// Find nearest unexplored tile of specific terrain type
export function findBestExploreTarget(unit, state, knowledge, terrain) {
  const { width, height, map } = state;
  let best = null, bestDist = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;
      const tile = map[y][x];
      const isWater = tile === WATER;
      if (terrain === 'water' && !isWater) continue;
      if (terrain === 'land' && isWater) continue;
      const dist = manhattanDistance(unit.x, unit.y, x, y);
      if (dist < bestDist) { bestDist = dist; best = { x, y, dist }; }
    }
  }
  return best;
}

// Find farthest unexplored tile that can be reached AND returned from
export function findDeepScoutTarget(unit, state, knowledge, refuelPoints) {
  const { width, height } = state;
  let best = null, bestScore = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;

      const distToTarget = manhattanDistance(unit.x, unit.y, x, y);

      // Check if we can return from there
      let bestReturnDist = Infinity;
      for (const refuel of refuelPoints) {
        const returnDist = manhattanDistance(x, y, refuel.x, refuel.y);
        if (returnDist < bestReturnDist) bestReturnDist = returnDist;
      }

      const totalFuelNeeded = distToTarget + bestReturnDist + 2; // +2 safety margin
      if (totalFuelNeeded > unit.fuel) continue;

      // Score: prefer far away but also dense unexplored areas
      // Count unexplored neighbors in 3-tile radius as "density bonus"
      let density = 0;
      for (let dy2 = -2; dy2 <= 2; dy2++) {
        for (let dx2 = -2; dx2 <= 2; dx2++) {
          const nx = x + dx2, ny = y + dy2;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (!knowledge.exploredTiles.has(`${nx},${ny}`)) density++;
          }
        }
      }

      // Score = distance (want far) + density bonus
      const score = distToTarget * 2 + density;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, dist: distToTarget, returnDist: bestReturnDist };
      }
    }
  }
  return best;
}

// Find unexplored tiles adjacent to known island coast (for coastline exploration)
export function findCoastExploreTarget(unit, state, knowledge, islandTiles) {
  const { width, height, map } = state;
  let best = null, bestDist = Infinity;

  for (const key of islandTiles) {
    const [lx, ly] = key.split(',').map(Number);
    // Check neighbors of known land for unexplored water/land
    for (const [dx, dy] of ALL_DIRS) {
      const nx = lx + dx, ny = ly + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nkey = `${nx},${ny}`;
      if (knowledge.exploredTiles.has(nkey)) continue;
      // For naval units, we want water tiles adjacent to island
      if (map[ny][nx] !== WATER) continue;

      const dist = manhattanDistance(unit.x, unit.y, nx, ny);
      if (dist < bestDist) { bestDist = dist; best = { x: nx, y: ny, dist }; }
    }
  }
  return best;
}

// ============================================================================
// COMBAT EVALUATION
// ============================================================================

export function evaluateCombat(attacker, defender, gameState) {
  const attSpec = UNIT_SPECS[attacker.type];
  const defSpec = UNIT_SPECS[defender.type];

  const attRolls = attSpec.halfStrengthCombat ? Math.ceil(attacker.strength * 0.5) : Math.max(1, attSpec.attackRolls);
  const defRolls = defSpec.halfStrengthCombat ? Math.ceil(defender.strength * 0.5) : Math.max(1, defSpec.defenseRolls);
  const defCanFightBack = !(attSpec.stealth && !defSpec.detectsSubs);

  const expectedDmgToDefender = attRolls * 0.5;
  const expectedDmgToAttacker = defCanFightBack ? defRolls * 0.5 : 0;

  // === VALUE CALCULATION ===
  // Use full replacement cost (productionDays) for risk assessment, NOT health-discounted.
  // A damaged unit can heal for free in a friendly city, so losing it costs the full
  // production time to replace regardless of current health.
  // Defender value IS discounted by health since that's what we'd "gain" by destroying it
  // (a half-dead enemy is less of a threat than a full-health one).
  let attackerValue = attSpec.productionDays; // Full replacement cost
  const cargo = gameState.units.filter(u => u.aboardId === attacker.id);
  if (cargo.length > 0) {
    const cargoValue = cargo.reduce((sum, u) => {
      const cSpec = UNIT_SPECS[u.type];
      return sum + (cSpec ? cSpec.productionDays : 0); // Full cost per cargo unit too
    }, 0);
    attackerValue += cargoValue;
  }
  const defenderValue = defSpec.productionDays * defender.strength / defSpec.strength;

  let shouldAttack = false, reason = '';

  // === TRANSPORT COMBAT RULE ===
  // Transports are terrible attackers (1 die). They should almost never initiate combat.
  // Only exception: empty, full health, vs a fighter (guaranteed kill, acceptable risk).
  if (attSpec.carriesTanks) {
    if (cargo.length > 0) {
      // NEVER attack with cargo aboard - the risk is catastrophic
      log(`[COMBAT-EVAL] ${attacker.type}#${attacker.id}(str ${attacker.strength}, cargo ${cargo.length}) REFUSING combat with ${defender.type}(str ${defender.strength}) - ${attackerValue} prod days at risk`);
      return { shouldAttack: false, reason: 'cargo_protection', attackerValue, defenderValue };
    }
    if (attacker.strength < attSpec.strength) {
      // Don't attack when damaged - heal up instead
      log(`[COMBAT-EVAL] transport#${attacker.id}(str ${attacker.strength}/${attSpec.strength}) AVOIDING combat - damaged, should repair`);
      return { shouldAttack: false, reason: 'damaged_transport', attackerValue, defenderValue };
    }
    // Full health, empty transport - only attack fighters (1 str, easy kill)
    if (defender.type === 'fighter') {
      shouldAttack = true; reason = 'transport_vs_fighter';
    } else {
      // Don't attack anything else - 1 attack die is not worth the risk
      return { shouldAttack: false, reason: 'transport_weak_attacker', attackerValue, defenderValue };
    }
    return { shouldAttack, reason, attackerValue, defenderValue };
  }

  // === CARRIER WITH CARGO ===
  // Carriers are strong but losing embarked aircraft is costly
  if (attSpec.carriesAir && cargo.length > 0) {
    // Only attack if we have overwhelming strength advantage
    if (attacker.strength >= defender.strength * 2) {
      shouldAttack = true;
      reason = 'loaded_carrier_favorable';
    } else {
      log(`[COMBAT-EVAL] carrier#${attacker.id}(str ${attacker.strength}, cargo ${cargo.length}) AVOIDING combat with ${defender.type}(str ${defender.strength}) - ${attackerValue} prod days at risk`);
      return { shouldAttack: false, reason: 'carrier_cargo_protection', attackerValue, defenderValue };
    }
    return { shouldAttack, reason, attackerValue, defenderValue };
  }

  // === STANDARD COMBAT RULES (non-transport, non-loaded-carrier) ===
  if (defender.type === 'transport') { shouldAttack = true; reason = 'transport_high_value'; }
  else if (defender.type === 'fighter' && attSpec.isLand) { shouldAttack = true; reason = 'tank_vs_fighter'; }
  else if (defender.type === 'fighter' && attacker.type === 'destroyer') { shouldAttack = true; reason = 'destroyer_vs_fighter'; }
  else if (attacker.type === 'submarine' && defSpec.isNaval && !defSpec.detectsSubs) { shouldAttack = true; reason = 'sub_stealth'; }
  else if (attacker.type === 'destroyer' && defender.type === 'submarine') { shouldAttack = true; reason = 'destroyer_vs_sub'; }
  else if (attacker.strength >= defender.strength * 1.5) { shouldAttack = true; reason = 'strength_advantage'; }
  else if (defenderValue > attackerValue * 1.2) { shouldAttack = true; reason = 'economic_value'; }
  else if ((attacker.type === 'battleship' || attacker.type === 'carrier') && defender.strength <= 4) { shouldAttack = true; reason = 'heavy_vs_light'; }

  const nearFriendlyCity = Object.values(gameState.cities).some(c =>
    c.owner === 'ai' && manhattanDistance(attacker.x, attacker.y, c.x, c.y) <= 3
  );
  if (nearFriendlyCity && !shouldAttack && attacker.strength >= defender.strength) {
    shouldAttack = true; reason = 'near_repair';
  }

  return { shouldAttack, reason, attackerValue, defenderValue };
}

// Get adjacent enemies that this unit could attack
export function getAdjacentEnemies(unit, state) {
  const enemies = [];
  const spec = UNIT_SPECS[unit.type];

  for (const [dx, dy] of ALL_DIRS) {
    const nx = unit.x + dx, ny = unit.y + dy;
    const enemiesAt = state.units.filter(u =>
      u.x === nx && u.y === ny && u.owner !== unit.owner && !u.aboardId
    );
    for (const enemy of enemiesAt) {
      const eSpec = UNIT_SPECS[enemy.type];
      if (spec.stealth && !eSpec.isNaval) continue;
      const tile = state.map[ny]?.[nx];
      if (spec.isLand && eSpec.isNaval && tile === WATER) continue;
      enemies.push({ enemy, x: nx, y: ny });
    }
  }
  return enemies;
}

// ============================================================================
// OBSERVATION HELPERS (for player visibility symmetry)
// ============================================================================

export function getAdjacentPlayerUnits(x, y, units) {
  const adjacent = [];
  for (const [dx, dy] of ALL_DIRS) {
    const nx = x + dx, ny = y + dy;
    const pu = units.find(u => u.x === nx && u.y === ny && u.owner === 'player' && !u.aboardId);
    if (pu) adjacent.push(pu);
  }
  return adjacent;
}

export function isAdjacentToPlayerCity(x, y, cities) {
  for (const [dx, dy] of ALL_DIRS) {
    const key = `${x + dx},${y + dy}`;
    if (cities[key]?.owner === 'player') return true;
  }
  return false;
}

// ============================================================================
// REFUEL POINTS
// ============================================================================

export function getRefuelPoints(state) {
  const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');
  const carriers = state.units.filter(u => u.owner === 'ai' && u.type === 'carrier' && !u.aboardId);
  return [...aiCities, ...carriers];
}

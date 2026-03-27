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

// Runtime-togglable debug flags — call setAILogging() to switch modes.
// Observer mode ON  → debugAI=false, debugObserver=true
// Observer mode OFF → debugAI=true,  debugObserver=false
let _debugAI = false;
let _debugObserver = false;

export function setAILogging(ai, observer) {
  _debugAI = ai;
  _debugObserver = observer;
}

export const log      = (...args) => _debugAI      && console.log('[AI]', ...args);
export const logPhase = (...args) => _debugAI      && console.log('[AI][PHASE]', ...args);
export const logMission = (...args) => _debugAI    && console.log('[AI][MISSION]', ...args);
export const logAI    = (pfx, ...args) => _debugAI && console.log(`[AI][${pfx}]`, ...args);
export const logObs   = (...args) => _debugObserver && console.log('[OBS]', ...args);

// Consolidated turn summary logger
export function logTurnSummary(state, knowledge, missions, turnLog) {
  if (!_debugAI) return;
  // Phase
  console.log(`[AI][PHASE] ${knowledge.explorationPhase}`);

  // Production summary (no coordinates)
  const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');
  const prodParts = aiCities.map(city => {
    const prod = city.producing || 'none';
    const spec = UNIT_SPECS[prod];
    const progress = city.progress?.[prod] || 0;
    const total = spec ? spec.productionDays : '?';
    return `${prod}(${progress}/${total})`;
  });
  if (prodParts.length > 0) {
    console.log(`[AI][PROD] ${prodParts.join(', ')}`);
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
  [PHASE.TRANSITION]: { fighter: 0, destroyer: 0, submarine: 0.6, battleship: 1.0, carrier: 0, bomber: 0 },
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
export function getMoveToward(unit, target, state, avoidTiles = null) {
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
  // Cache key includes avoidance flag — danger zones change each turn so avoided paths
  // must not be reused for non-avoided movement and vice versa.
  const cacheKey = `${unit.id}->${target.x},${target.y}${avoidTiles ? ':avoid' : ''}`;
  let path = _pathCache.get(cacheKey);
  let hadCachedPath = !!path;

  if (!path) {
    const maxDist = Math.min(200, width + height);
    const tileCostFn = avoidTiles
      ? (x, y) => (avoidTiles.has(`${x},${y}`) ? 20 : 1)
      : null;
    path = findPath(unit.x, unit.y, target.x, target.y, unit, state, maxDist, tileCostFn);
    if (path && path.length > 0) {
      _pathCache.set(cacheKey, path);
    } else {
      // A* found no path — target is genuinely unreachable from here.
      // Return null immediately; greedy would only cause aimless wandering.
      return null;
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
      // Validate (a) the unit is actually adjacent to this step (it may have deviated from
      // the cached path, e.g. after a fuel-return detour) and (b) the tile is still clear.
      const isAdjacent = Math.abs(nextStep.x - unit.x) <= 1 && Math.abs(nextStep.y - unit.y) <= 1;
      if (isAdjacent && isValidStep(nextStep.x, nextStep.y)) {
        return { x: nextStep.x, y: nextStep.y };
      } else {
        // Either unit deviated from path or tile is transiently blocked — invalidate cache
        _pathCache.delete(cacheKey);
        hadCachedPath = true; // signal: we had a valid path, just temporarily blocked
      }
    } else {
      // We've reached or passed all steps in the path
      _pathCache.delete(cacheKey);
    }
  }

  // === STRATEGY 2: Greedy best adjacent tile (fallback for transient blocks) ===
  let bestMove = null, bestDist = Infinity;
  const validMoves = [];

  for (const [dx, dy] of ALL_DIRS) {
    const nx = unit.x + dx, ny = unit.y + dy;
    if (!isValidStep(nx, ny)) continue;
    validMoves.push({ x: nx, y: ny });
  }

  // Prefer safe tiles when avoidance is active; fall back to any valid tile if all are dangerous
  const preferredMoves = avoidTiles
    ? (validMoves.filter(m => !avoidTiles.has(`${m.x},${m.y}`)).length > 0
        ? validMoves.filter(m => !avoidTiles.has(`${m.x},${m.y}`))
        : validMoves)
    : validMoves;

  for (const m of preferredMoves) {
    const dist = manhattanDistance(m.x, m.y, target.x, target.y);
    if (dist < bestDist) { bestDist = dist; bestMove = m; }
  }

  if (bestMove) return bestMove;

  // === STRATEGY 3: Any valid adjacent tile (prevents wasting all moves) ===
  if (validMoves.length > 0) {
    // Completely surrounded — pick any valid adjacent tile rather than wasting all remaining moves
    return validMoves[Math.floor(Math.random() * validMoves.length)];
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

      const totalFuelNeeded = distToTarget + bestReturnDist + 4; // +4 safety margin
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
  // Defender value includes any cargo aboard (e.g. transport full of tanks)
  let defenderValue = defSpec.productionDays * defender.strength / defSpec.strength;
  const defCargo = gameState.units.filter(u => u.aboardId === defender.id);
  if (defCargo.length > 0) {
    defenderValue += defCargo.reduce((sum, u) => {
      const cSpec = UNIT_SPECS[u.type];
      return sum + (cSpec ? cSpec.productionDays : 0);
    }, 0);
  }

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

  // === EXPECTED VALUE COMBAT ASSESSMENT ===
  // Estimate win probability via a rounds-to-kill model:
  //   effAttack  = expected damage dealt per round (dice × 0.5 hit chance × damage-per-hit)
  //   effDefense = same for defender; 0 if defender cannot fight back (sub stealth)
  //   winProb    = roundsToKillAttacker / (roundsToKillDef + roundsToKillAtt)
  //              → approaches 1.0 when attacker kills much faster; 0.0 when it dies first
  const effAttack  = attRolls * 0.5 * attSpec.damagePerHit;
  const effDefense = defCanFightBack ? defRolls * 0.5 * defSpec.defenseDamagePerHit : 0;
  const roundsToKillDef = defender.strength / effAttack;
  const roundsToKillAtt = effDefense > 0 ? attacker.strength / effDefense : Infinity;
  const winProb = roundsToKillAtt === Infinity ? 1.0
                : roundsToKillAtt / (roundsToKillDef + roundsToKillAtt);

  const netEV = winProb * defenderValue - (1 - winProb) * attackerValue;

  // Accept a small negative EV to account for strategic value (threat removal, area control)
  // that the pure economic model doesn't capture.
  const baseThreshold = -attackerValue * 0.15;
  shouldAttack = netEV > baseThreshold;
  reason = `ev(${netEV.toFixed(1)},win${(winProb * 100).toFixed(0)}%)`;

  // Near a friendly repair city: tolerate a worse trade (unit can heal if it survives)
  const nearFriendlyCity = Object.values(gameState.cities).some(c =>
    c.owner === 'ai' && manhattanDistance(attacker.x, attacker.y, c.x, c.y) <= 3
  );
  if (nearFriendlyCity && netEV > -attackerValue * 0.35) {
    shouldAttack = true;
    reason = `ev_near_repair(${netEV.toFixed(1)})`;
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
      // Stealthy enemy units (subs) are invisible unless the attacker has detectsSubs
      if (eSpec.stealth && !spec.detectsSubs) continue;
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

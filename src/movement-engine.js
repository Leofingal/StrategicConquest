// ============================================================================
// STRATEGIC CONQUEST - MOVEMENT ENGINE MODULE
// ============================================================================
// Handles all movement validation, pathfinding, and terrain checks.
// Pure functions with no side effects.
// 
// Dependencies: game-constants.js
// Line count target: ~250 lines
// 
// CHANGELOG:
// - Added getBombardTargets() for battleship range-2 bombardment

import {
  WATER,
  PLAYER_CITY,
  AI_CITY,
  NEUTRAL_CITY,
  UNIT_SPECS,
  DIRECTIONS,
  ALL_DIRS,
  isCityTile,
  isFriendlyCity,
  isEnemyCity,
  manhattanDistance
} from './game-constants.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get carrier/transport position by ID
 */
function getCarrierPosition(carrierId, units) {
  const carrier = units.find(u => u.id === carrierId);
  return carrier ? { x: carrier.x, y: carrier.y } : null;
}

/**
 * Get count of units aboard a carrier/transport
 */
export function getCargoCount(carrierId, units) {
  return units.filter(u => u.aboardId === carrierId).length;
}

/**
 * Get the effective location of a unit (follows carrier if aboard)
 */
export function getUnitLocation(unit, units) {
  if (unit.aboardId) {
    const pos = getCarrierPosition(unit.aboardId, units);
    return pos || { x: unit.x, y: unit.y };
  }
  return { x: unit.x, y: unit.y };
}

/**
 * Get all units at a specific location (not aboard transports)
 */
export function getUnitsAtLocation(x, y, units) {
  return units.filter(u => !u.aboardId && u.x === x && u.y === y);
}

// ============================================================================
// TERRAIN CHECKS
// ============================================================================

/**
 * Check if a tile is adjacent to water
 */
export function isAdjacentToWater(x, y, map, width, height) {
  for (const [dx, dy] of ALL_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height && map[ny][nx] === WATER) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a tile is adjacent to land
 */
export function isAdjacentToLand(x, y, map, width, height) {
  for (const [dx, dy] of ALL_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height && map[ny][nx] !== WATER) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a unit can enter a terrain tile
 */
export function canEnterTerrain(unit, x, y, gameState) {
  const spec = UNIT_SPECS[unit.type];
  const { map, width, height } = gameState;
  const tile = map[y][x];
  
  if (spec.isAir) return true;
  
  if (spec.isNaval) {
    // Naval can enter water or friendly coastal cities
    return tile === WATER || 
           (isFriendlyCity(tile, unit.owner) && isAdjacentToWater(x, y, map, width, height));
  }
  
  if (spec.isLand) {
    return tile !== WATER;
  }
  
  return false;
}

/**
 * Check if a unit can stack at a location
 * Returns: { ok: boolean, reason?: string }
 */
export function canStackAt(unit, x, y, gameState) {
  const { map, units } = gameState;
  const tile = map[y][x];
  const spec = UNIT_SPECS[unit.type];
  const atTarget = getUnitsAtLocation(x, y, units);
  const friends = atTarget.filter(u => u.owner === unit.owner);
  const enemies = atTarget.filter(u => u.owner !== unit.owner);
  
  // Can't stack with enemies (that's combat)
  if (enemies.length > 0) {
    return { ok: false, reason: 'enemy' };
  }
  
  // Aircraft can always stack
  if (spec.isAir) {
    return { ok: true };
  }
  
  // Land units
  if (spec.isLand) {
    for (const u of friends) {
      const uSpec = UNIT_SPECS[u.type];
      if (uSpec.isLand || uSpec.isAir) continue;
      // Can board transport with capacity
      if (uSpec.carriesTanks && getCargoCount(u.id, units) < uSpec.capacity) continue;
      // Can share city with naval
      if (isCityTile(tile) && uSpec.isNaval) continue;
      return { ok: false, reason: 'no_space' };
    }
    return { ok: true };
  }
  
  // Naval units
  if (spec.isNaval) {
    for (const u of friends) {
      const uSpec = UNIT_SPECS[u.type];
      if (uSpec.isAir || uSpec.isLand) continue;
      // Naval can't stack at sea (only in cities)
      if (uSpec.isNaval && !isCityTile(tile)) {
        return { ok: false, reason: 'naval_collision' };
      }
    }
    return { ok: true };
  }
  
  return { ok: true };
}

/**
 * Check if unit is on a refuel tile (city, carrier)
 */
export function isOnRefuelTile(unit, gameState) {
  const spec = UNIT_SPECS[unit.type];
  if (!spec.isAir) return false;
  if (unit.aboardId) return true;
  
  const pos = getUnitLocation(unit, gameState.units);
  const city = gameState.cities[`${pos.x},${pos.y}`];
  if (city && city.owner === unit.owner) return true;
  
  // Check for friendly carrier at same location
  const carrier = gameState.units.find(u => 
    u.x === pos.x && 
    u.y === pos.y && 
    u.id !== unit.id && 
    u.owner === unit.owner && 
    UNIT_SPECS[u.type].carriesAir
  );
  return !!carrier;
}

// ============================================================================
// VALID MOVES CALCULATION
// ============================================================================

/**
 * Get all valid moves for a unit
 * Returns array of { x, y, dir, isAttack, isCity, disembark?, boardId? }
 */
export function getValidMoves(unit, gameState) {
  if (!unit || unit.movesLeft <= 0) return [];
  
  const spec = UNIT_SPECS[unit.type];
  const { map, width: W, height: H, units, cities } = gameState;
  const moves = [];
  
  // Get unit's actual location (if aboard, use carrier's position)
  const pos = getUnitLocation(unit, units);
  const ux = pos.x;
  const uy = pos.y;
  
  for (const [key, { dx, dy }] of Object.entries(DIRECTIONS)) {
    const nx = ux + dx;
    const ny = uy + dy;
    
    // Bounds check
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    
    const tile = map[ny][nx];
    const atTarget = getUnitsAtLocation(nx, ny, units);
    const enemies = atTarget.filter(u => u.owner !== unit.owner);
    const friends = atTarget.filter(u => u.owner === unit.owner);
    
    // Attack enemy unit
    // BUG #9 FIX: Submarines can only attack naval units (not land units in cities)
    // BUG #10 FIX: Carriers and transports CAN attack if they have enemies to target
    if (enemies.length > 0) {
      // Filter valid targets based on attacker type
      let validTargets = enemies;
      
      // Submarines can only attack naval units
      if (spec.stealth) {  // Submarine
        validTargets = enemies.filter(e => UNIT_SPECS[e.type].isNaval);
      }
      
      // Only allow attack if there are valid targets
      if (validTargets.length > 0) {
        // Land units can attack from transport (disembark attack)
        if (unit.aboardId && spec.isLand && tile !== WATER) {
          moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true, disembark: true });
        } 
        // CARRIER FIX: Aircraft can attack from carrier (launch and attack)
        else if (unit.aboardId && spec.isAir) {
          moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true, disembark: true });
        }
        else if (!unit.aboardId) {
          moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true });
        }
        continue;
      }
      // If no valid targets (e.g. sub vs land unit), fall through to check other move types
    }
    
    // Capture city
    const isNeutral = tile === NEUTRAL_CITY;
    const isEnemy = isEnemyCity(tile, unit.owner);
    if ((isNeutral || isEnemy) && spec.canCapture) {
      if (unit.aboardId && spec.isLand) {
        moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true, isCity: true, disembark: true });
      } else if (!unit.aboardId) {
        moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true, isCity: true });
      }
      continue;
    }
    
    // Disembark tank to land
    if (unit.aboardId && spec.isLand && tile !== WATER) {
      const stackOk = canStackAt(unit, nx, ny, gameState);
      if (stackOk.ok) {
        moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false, disembark: true });
      }
      continue;
    }
    
    // CARRIER FIX: Aircraft launch from carrier (carriers act like mobile cities)
    // Aircraft can fly off to any adjacent tile without needing an "unload" action
    if (unit.aboardId && spec.isAir) {
      // Air units can enter any tile (water or land)
      const stackOk = canStackAt(unit, nx, ny, gameState);
      if (stackOk.ok) {
        moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false, disembark: true });
      }
      continue;
    }
    
    // Normal movement (not aboard)
    if (unit.aboardId) continue;
    
    const canEnter = canEnterTerrain(unit, nx, ny, gameState);
    if (!canEnter) {
      // Tank can board adjacent transport at sea
      if (spec.isLand) {
        const transport = friends.find(u => 
          UNIT_SPECS[u.type].carriesTanks && 
          getCargoCount(u.id, units) < UNIT_SPECS[u.type].capacity
        );
        if (transport) {
          moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false, boardId: transport.id });
        }
      }
      continue;
    }
    
    const stackOk = canStackAt(unit, nx, ny, gameState);
    if (!stackOk.ok) continue;
    
    // Check boarding opportunities
    if (spec.isLand) {
      const transport = friends.find(u => 
        UNIT_SPECS[u.type].carriesTanks && 
        getCargoCount(u.id, units) < UNIT_SPECS[u.type].capacity
      );
      if (transport) {
        moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false, boardId: transport.id });
        continue;
      }
    }
    if (spec.isAir) {
      const carrier = friends.find(u => 
        UNIT_SPECS[u.type].carriesAir && 
        getCargoCount(u.id, units) < UNIT_SPECS[u.type].capacity
      );
      if (carrier) {
        moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false, boardId: carrier.id });
        continue;
      }
    }
    
    moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false });
  }
  
  return moves;
}

// ============================================================================
// BOMBARDMENT TARGETS (NEW)
// ============================================================================

/**
 * Get valid bombardment targets for a unit with canBombard
 * Bombardment is at range 2 (Chebyshev distance exactly 2)
 * Target must be visible (fog state === FOG_VISIBLE)
 * 
 * @param {Object} unit - The unit (must have canBombard spec)
 * @param {Object} gameState - Current game state
 * @param {Array} fog - 2D fog array (from buildFogArray)
 * @param {number} FOG_VISIBLE_VALUE - The fog visible constant (usually 2)
 * @returns {Array<{x, y, hasEnemy, enemyUnit}>} - Valid bombard targets
 */
export function getBombardTargets(unit, gameState, fog, FOG_VISIBLE_VALUE = 2) {
  const spec = UNIT_SPECS[unit.type];
  
  // Only units with canBombard can use this
  if (!spec.canBombard) return [];
  
  // Unit must have moves left
  if (unit.movesLeft <= 0) return [];
  
  const { width: W, height: H, units } = gameState;
  const targets = [];
  
  const ux = unit.x;
  const uy = unit.y;
  
  // Check all tiles at Chebyshev distance exactly 2
  // Chebyshev distance = max(|dx|, |dy|)
  // Range 2 means tiles where max(|dx|, |dy|) == 2
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
      
      // Only range 2 (not adjacent, not same tile, not beyond)
      if (chebyshev !== 2) continue;
      
      const tx = ux + dx;
      const ty = uy + dy;
      
      // Bounds check
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      
      // Must be visible (another unit revealed it)
      if (!fog[ty] || fog[ty][tx] !== FOG_VISIBLE_VALUE) continue;
      
      // Check for enemy units at target
      const enemiesAtTarget = units.filter(u => 
        u.x === tx && 
        u.y === ty && 
        u.owner !== unit.owner && 
        !u.aboardId
      );
      
      targets.push({
        x: tx,
        y: ty,
        hasEnemy: enemiesAtTarget.length > 0,
        enemyUnit: enemiesAtTarget.length > 0 ? enemiesAtTarget[0] : null
      });
    }
  }
  
  return targets;
}

// ============================================================================
// PATHFINDING (A* algorithm)
// ============================================================================

/**
 * Find path from start to end using A* pathfinding
 * Returns: Array<{x, y}> or null if no path exists
 */
export function findPath(startX, startY, endX, endY, unit, gameState, maxDistance = 1000, tileCostFn = null) {
  const spec = UNIT_SPECS[unit.type];
  const { map, width: W, height: H } = gameState;
  
  const open = [{
    x: startX,
    y: startY,
    g: 0,
    h: Math.abs(endX - startX) + Math.abs(endY - startY),
    path: []
  }];
  const closed = new Set();
  
  while (open.length > 0 && open.length < maxDistance * 10) {
    // Sort by f = g + h (lowest first)
    open.sort((a, b) => (a.g + a.h) - (b.g + b.h));
    const cur = open.shift();
    
    // Reached destination
    if (cur.x === endX && cur.y === endY) {
      return cur.path;
    }
    
    const key = `${cur.x},${cur.y}`;
    if (closed.has(key)) continue;
    closed.add(key);
    
    // Explore neighbors
    for (const [dx, dy] of ALL_DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      
      // Bounds and already visited check
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || closed.has(`${nx},${ny}`)) continue;
      
      const tile = map[ny][nx];
      let canMove = false;
      
      // Check terrain accessibility
      if (spec.isAir) {
        canMove = true;
      } else if (spec.isNaval) {
        canMove = tile === WATER || isFriendlyCity(tile, unit.owner);
      } else if (spec.isLand) {
        canMove = tile !== WATER;
      }
      
      if (!canMove) continue;
      
      open.push({
        x: nx,
        y: ny,
        g: cur.g + (tileCostFn ? tileCostFn(nx, ny) : 1),
        h: Math.abs(endX - nx) + Math.abs(endY - ny),
        path: [...cur.path, { x: nx, y: ny }]
      });
    }
  }
  
  return null; // No path found
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a simple test map for testing
 */
export function createTestMap(width, height, landTiles = []) {
  const map = Array.from({ length: height }, () => Array(width).fill(WATER));
  landTiles.forEach(([x, y]) => {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      map[y][x] = 1; // LAND
    }
  });
  return map;
}

// ============================================================================
// STRATEGIC CONQUEST - FOG OF WAR MODULE
// ============================================================================
// Handles all visibility calculations and fog state management.
// Pure functions with no side effects.
// 
// Dependencies: game-constants.js
// Line count target: ~100 lines

import {
  FOG_UNEXPLORED,
  FOG_EXPLORED,
  FOG_VISIBLE
} from './game-constants.js';

/**
 * Calculate currently visible tiles for a player
 * Each unit and owned city provides 3x3 vision (1 tile radius)
 * 
 * @param {GameState} gameState - Current game state
 * @param {string} owner - 'player' or 'ai'
 * @returns {Set<string>} Set of "x,y" coordinate strings that are visible
 */
export function calculateVisibility(gameState, owner) {
  const { width, height, units, cities } = gameState;
  const visible = new Set();
  
  /**
   * Add 3x3 vision around a point
   */
  const addVision = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          visible.add(`${nx},${ny}`);
        }
      }
    }
  };
  
  // Vision from units (not aboard transports/carriers)
  units
    .filter(u => u.owner === owner && !u.aboardId)
    .forEach(u => addVision(u.x, u.y));
  
  // Vision from cities
  Object.values(cities)
    .filter(c => c.owner === owner)
    .forEach(c => addVision(c.x, c.y));
  
  return visible;
}

/**
 * Build fog array for rendering
 * Returns 2D array where each cell is FOG_UNEXPLORED, FOG_EXPLORED, or FOG_VISIBLE
 * 
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {Set<string>} explored - Previously explored tiles
 * @param {Set<string>} currentlyVisible - Currently visible tiles
 * @param {Set<string>} [turnVisibility] - Tiles seen this turn (optional)
 * @returns {number[][]} 2D array of fog states
 */
export function buildFogArray(width, height, explored, currentlyVisible, turnVisibility = new Set()) {
  const fog = Array.from({ length: height }, () => Array(width).fill(FOG_UNEXPLORED));
  
  // Mark explored tiles
  explored.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      fog[y][x] = FOG_EXPLORED;
    }
  });
  
  // Mark currently visible tiles
  currentlyVisible.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      fog[y][x] = FOG_VISIBLE;
    }
  });
  
  // Mark turn visibility (tiles seen during this turn but not currently visible)
  turnVisibility.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      fog[y][x] = FOG_VISIBLE;
    }
  });
  
  return fog;
}

/**
 * Update explored tiles with new visibility
 * Returns new Set with merged tiles (immutable)
 * 
 * @param {Set<string>} explored - Previously explored tiles
 * @param {Set<string>} newlyVisible - Newly visible tiles to add
 * @returns {Set<string>} New set containing all explored tiles
 */
export function updateExploredTiles(explored, newlyVisible) {
  const updated = new Set(explored);
  newlyVisible.forEach(key => updated.add(key));
  return updated;
}

/**
 * Check if a specific tile is visible to a player
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {GameState} gameState - Current game state
 * @param {string} owner - 'player' or 'ai'
 * @param {number[][]} [fogState] - Pre-computed fog array (optional, for efficiency)
 * @returns {boolean} True if tile is currently visible
 */
export function isTileVisible(x, y, gameState, owner, fogState = null) {
  if (fogState) {
    return fogState[y]?.[x] === FOG_VISIBLE;
  }
  
  // Calculate visibility on the fly
  const visible = calculateVisibility(gameState, owner);
  return visible.has(`${x},${y}`);
}

/**
 * Check if a tile has been explored (seen at some point)
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Set<string>} explored - Set of explored tile keys
 * @returns {boolean} True if tile has been explored
 */
export function isTileExplored(x, y, explored) {
  return explored.has(`${x},${y}`);
}

/**
 * Get fog state for a specific tile
 * 
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number[][]} fogArray - Pre-computed fog array
 * @returns {number} FOG_UNEXPLORED, FOG_EXPLORED, or FOG_VISIBLE
 */
export function getFogState(x, y, fogArray) {
  if (y < 0 || y >= fogArray.length || x < 0 || x >= fogArray[0].length) {
    return FOG_UNEXPLORED;
  }
  return fogArray[y][x];
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create test visibility set for testing
 */
export function createTestVisibility(tiles) {
  return new Set(tiles.map(([x, y]) => `${x},${y}`));
}

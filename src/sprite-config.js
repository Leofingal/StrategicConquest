// ============================================================================
// STRATEGIC CONQUEST - SPRITE CONFIGURATION (FIXED)
// ============================================================================
// FIX 1: Removed corner/diagonal logic - now only uses 15 cardinal transitions
// FIX 2: failedAutotiles now stores normalized suffixes for proper caching
// ============================================================================

import { WATER, LAND, PLAYER_CITY, AI_CITY, NEUTRAL_CITY, COLORS } from './game-constants.js';

// Base path for sprites
export const SPRITE_BASE_PATH = '/sprites';

// Tile dimensions
export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 48;

// ============================================================================
// UNIT SPRITE CONFIGURATION
// ============================================================================

export const IMAGE_SPRITE_CONFIG = {
  tank: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/tank_player.png`,
    ai: `${SPRITE_BASE_PATH}/tank_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  fighter: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/fighter_player.png`,
    ai: `${SPRITE_BASE_PATH}/fighter_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  bomber: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/bomber_player.png`,
    ai: `${SPRITE_BASE_PATH}/bomber_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  transport: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/transport_player.png`,
    ai: `${SPRITE_BASE_PATH}/transport_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  destroyer: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/destroyer_player.png`,
    ai: `${SPRITE_BASE_PATH}/destroyer_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  submarine: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/submarine_player.png`,
    ai: `${SPRITE_BASE_PATH}/submarine_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  carrier: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/carrier_player.png`,
    ai: `${SPRITE_BASE_PATH}/carrier_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
  battleship: { 
    type: 'image', 
    player: `${SPRITE_BASE_PATH}/battleship_player.png`,
    ai: `${SPRITE_BASE_PATH}/battleship_ai.png`,
    width: SPRITE_WIDTH, 
    height: SPRITE_HEIGHT 
  },
};

export const EMOJI_SPRITE_CONFIG = {
  tank: { type: 'emoji', value: 'T', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  fighter: { type: 'emoji', value: 'F', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  bomber: { type: 'emoji', value: 'B', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  transport: { type: 'emoji', value: 'Tr', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  destroyer: { type: 'emoji', value: 'D', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  submarine: { type: 'emoji', value: 'S', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  carrier: { type: 'emoji', value: 'C', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
  battleship: { type: 'emoji', value: 'Bs', width: SPRITE_WIDTH, height: SPRITE_HEIGHT },
};

// ============================================================================
// TILE CONFIGURATION
// ============================================================================

export const IMAGE_TILE_CONFIG = {
  [WATER]: { 
    type: 'image', 
    src: `${SPRITE_BASE_PATH}/water.png`,
    supportsAutotile: true,
  },
  [LAND]: { 
    type: 'image', 
    src: `${SPRITE_BASE_PATH}/land.png`,
    supportsAutotile: false,
  },
  [PLAYER_CITY]: { 
    type: 'image', 
    src: `${SPRITE_BASE_PATH}/player_city.png`,
    supportsAutotile: false,
  },
  [AI_CITY]: { 
    type: 'image', 
    src: `${SPRITE_BASE_PATH}/ai_city.png`,
    supportsAutotile: false,
  },
  [NEUTRAL_CITY]: { 
    type: 'image', 
    src: `${SPRITE_BASE_PATH}/neutral_city.png`,
    supportsAutotile: false,
  },
};

export const COLOR_TILE_CONFIG = {
  [WATER]: { type: 'color', value: COLORS.water, valueLight: COLORS.waterLight },
  [LAND]: { type: 'color', value: COLORS.land, valueLight: COLORS.landLight },
  [PLAYER_CITY]: { type: 'color', value: COLORS.playerCity },
  [AI_CITY]: { type: 'color', value: COLORS.aiCity },
  [NEUTRAL_CITY]: { type: 'color', value: COLORS.neutralCity },
};

// ============================================================================
// AUTOTILE SYSTEM (Cardinal directions only - 15 transitions + base)
// ============================================================================
// 
// Sprites needed:
//   water.png      - base (no adjacent land)
//   water_N.png    - land to north
//   water_E.png    - land to east
//   water_S.png    - land to south
//   water_W.png    - land to west
//   water_NE.png   - land to north and east
//   water_NS.png   - land to north and south
//   water_NW.png   - land to north and west
//   water_ES.png   - land to east and south
//   water_EW.png   - land to east and west
//   water_SW.png   - land to south and west
//   water_NES.png  - land to north, east, and south
//   water_NEW.png  - land to north, east, and west
//   water_NSW.png  - land to north, south, and west
//   water_ESW.png  - land to east, south, and west
//   water_NESW.png - land on all sides
// ============================================================================

// Cardinal edge flags only
export const EDGE = {
  NONE: 0,
  N: 1,
  E: 2,
  S: 4,
  W: 8,
};

/**
 * Convert edge flags to filename suffix
 * Only handles cardinal directions (N, E, S, W)
 */
export function edgesToSuffix(edges) {
  if (edges === EDGE.NONE) return '';
  
  let suffix = '_';
  if (edges & EDGE.N) suffix += 'N';
  if (edges & EDGE.E) suffix += 'E';
  if (edges & EDGE.S) suffix += 'S';
  if (edges & EDGE.W) suffix += 'W';
  
  return suffix;
}

/**
 * Calculate edge flags for a water tile based on cardinal neighbors only
 * Diagonal neighbors are ignored
 */
export function calculateWaterEdges(x, y, map) {
  const height = map.length;
  const width = map[0].length;
  
  const isLand = (tx, ty) => {
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) return false;
    const tile = map[ty][tx];
    return tile === LAND || tile === PLAYER_CITY || tile === AI_CITY || tile === NEUTRAL_CITY;
  };
  
  let edges = EDGE.NONE;
  
  // Check cardinal directions only
  if (isLand(x, y - 1)) edges |= EDGE.N;
  if (isLand(x + 1, y)) edges |= EDGE.E;
  if (isLand(x, y + 1)) edges |= EDGE.S;
  if (isLand(x - 1, y)) edges |= EDGE.W;
  
  return edges;
}

/**
 * Track failed autotile suffixes for caching
 */
export const failedAutotileSuffixes = new Set();

/**
 * Extract suffix from any URL or path containing "water[suffix].png"
 */
export function extractSuffixFromSrc(src) {
  const match = src.match(/water(_[NESW]+)?\.png/i);
  return match ? (match[1] || '') : null;
}

/**
 * Mark a suffix as failed - call from img onError handler
 */
export function markAutotileFailed(src) {
  const suffix = extractSuffixFromSrc(src);
  if (suffix !== null && suffix !== '') {
    failedAutotileSuffixes.add(suffix);
    console.log(`[AUTOTILE] Cached missing sprite: water${suffix}.png`);
  }
}

/**
 * Get the appropriate water tile image path based on neighbors
 */
export function getWaterTileSrc(x, y, map) {
  const edges = calculateWaterEdges(x, y, map);
  const suffix = edgesToSuffix(edges);
  
  // No edges = open water
  if (suffix === '') {
    return `${SPRITE_BASE_PATH}/water.png`;
  }
  
  // Check if this suffix previously failed
  if (failedAutotileSuffixes.has(suffix)) {
    return `${SPRITE_BASE_PATH}/water.png`;
  }
  
  return `${SPRITE_BASE_PATH}/water${suffix}.png`;
}

// Legacy export for backward compatibility
export const failedAutotiles = failedAutotileSuffixes;

// ============================================================================
// DYNAMIC SHADING AND FOG
// ============================================================================

export const SHADING = {
  lightMultiplier: 1.15,
  lightFilter: 'brightness(1.15)',
  darkFilter: 'none',
};

export function getCheckerboardFilter(x, y) {
  return (x + y) % 2 === 1 ? SHADING.lightFilter : SHADING.darkFilter;
}

export const FOG_STYLES = {
  unexplored: {
    backgroundColor: '#0a1015',
    opacity: 1,
  },
  explored: {
    backgroundColor: 'rgba(10, 16, 21, 0.6)',
    opacity: 1,
  },
  visible: null,
};

// ============================================================================
// ACTIVE CONFIGURATION
// ============================================================================

export const USE_IMAGE_SPRITES = true;
export const USE_AUTOTILES = true;

export const SPRITE_CONFIG = USE_IMAGE_SPRITES ? IMAGE_SPRITE_CONFIG : EMOJI_SPRITE_CONFIG;
export const TILE_CONFIG = USE_IMAGE_SPRITES ? IMAGE_TILE_CONFIG : COLOR_TILE_CONFIG;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getUnitSpriteSrc(unitType, owner) {
  const sprite = SPRITE_CONFIG[unitType];
  if (!sprite || sprite.type !== 'image') return null;
  return owner === 'player' ? sprite.player : sprite.ai;
}

export function getTileImageSrc(tileType, x = 0, y = 0, map = null) {
  const tile = TILE_CONFIG[tileType];
  if (!tile || tile.type !== 'image') return null;
  
  if (USE_AUTOTILES && tile.supportsAutotile && map && tileType === WATER) {
    return getWaterTileSrc(x, y, map);
  }
  
  return tile.src;
}

export function getTileColor(tileType, isLight = false) {
  const tile = TILE_CONFIG[tileType];
  if (!tile) return '#ff00ff';
  if (tile.type === 'color') {
    return isLight && tile.valueLight ? tile.valueLight : tile.value;
  }
  return 'transparent';
}

export function getTileStyle(tileType, x, y, map = null) {
  const tile = TILE_CONFIG[tileType];
  const filter = getCheckerboardFilter(x, y);
  
  if (tile && tile.type === 'image') {
    return {
      backgroundImage: `url(${getTileImageSrc(tileType, x, y, map)})`,
      backgroundSize: 'cover',
      filter: filter,
      imageRendering: 'pixelated',
    };
  } else {
    const isLight = (x + y) % 2 === 1;
    return {
      backgroundColor: getTileColor(tileType, isLight),
    };
  }
}

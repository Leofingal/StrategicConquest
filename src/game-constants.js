// ============================================================================
// STRATEGIC CONQUEST - SHARED CONSTANTS
// ============================================================================
// This module exports all constants used across the game modules.
// Import from this file to maintain consistency.
//
// BUG #2 FIX: Increased viewport from 20x14 to 24x18 tiles

// Tile types
export const WATER = 0;
export const LAND = 1;
export const PLAYER_CITY = 2;
export const AI_CITY = 3;
export const NEUTRAL_CITY = 4;

// Fog states
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

// Game phases
export const PHASE_MENU = 'menu';
export const PHASE_PLAYING = 'playing';
export const PHASE_VICTORY = 'victory';
export const PHASE_DEFEAT = 'defeat';

// Unit statuses
export const STATUS_READY = 'R';
export const STATUS_WAITING = 'W';
export const STATUS_SENTRY = 'S';
export const STATUS_PATROL = 'P';
export const STATUS_GOTO = 'G';
export const STATUS_SKIPPED = 'K';
export const STATUS_USED = 'U';
export const STATUS_ABOARD = 'A';

// Display settings - 4:3 aspect ratio tiles
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 48;
export const TILE_SIZE = TILE_WIDTH; // Legacy compatibility - use TILE_WIDTH/TILE_HEIGHT for new code
// BUG #2 FIX: Larger viewport for better fighter path visibility
export const VIEWPORT_TILES_X = 24;
export const VIEWPORT_TILES_Y = 18; // 24x18 grid at 64x48 = 1536x864 viewport

// Color palette
export const COLORS = {
  water: '#1a3a4a',
  waterLight: '#234d5f',
  land: '#4a7c59',
  landLight: '#5d9970',
  playerCity: '#e8c547',
  aiCity: '#c94c4c',
  neutralCity: '#ffffff',
  background: '#0d1b21',
  text: '#c4d4d0',
  textMuted: '#6a8a84',
  textDark: '#1a1a1a',
  panel: '#142830',
  panelLight: '#1a3540',
  border: '#2a4a54',
  selected: '#3a6a74',
  highlight: '#e8c547',
  danger: '#c94c4c',
  success: '#5d9970',
  fogUnexplored: '#0a1015',
  fogExplored: 'rgba(10, 16, 21, 0.6)',
  gotoLine: 'rgba(232, 197, 71, 0.8)',
  patrolLine: 'rgba(202, 159, 106, 0.8)',
};

// Unit specifications
export const UNIT_SPECS = {
  tank: {
    name: 'Tank',
    strength: 2,
    movement: 1,
    fuel: null,
    productionDays: 4,
    isLand: true,
    canCapture: true,
    icon: 'T',
    attackRolls: 2,
    defenseRolls: 2,
    damagePerHit: 1,
    defenseDamagePerHit: 1,
    description: 'Only unit that can capture cities'
  },
  fighter: {
    name: 'Fighter',
    strength: 1,
    movement: 20,
    fuel: 20,
    productionDays: 6,
    isAir: true,
    icon: 'F',
    attackRolls: 1,
    defenseRolls: 1,
    damagePerHit: 1,
    defenseDamagePerHit: 1,
    description: 'Critical for reconnaissance'
  },
  bomber: {
    name: 'Bomber',
    strength: 1,
    movement: 10,
    fuel: 30,
    productionDays: 25,
    isAir: true,
    icon: 'B',
    attackRolls: 1,
    defenseRolls: 0,
    damagePerHit: 1,
    defenseDamagePerHit: 0,
    description: 'Destroys 3x3 area; no defenses'
  },
  transport: {
    name: 'Transport',
    strength: 3,
    movement: 3,
    fuel: null,
    productionDays: 10,
    isNaval: true,
    capacity: 6,
    carriesTanks: true,
    icon: 'Tr',
    attackRolls: 1,
    defenseRolls: 1,
    damagePerHit: 1,
    defenseDamagePerHit: 1,
    description: 'Carries 6 tanks'
  },
  destroyer: {
    name: 'Destroyer',
    strength: 4,
    movement: 4,
    fuel: null,
    productionDays: 8,
    isNaval: true,
    detectsSubs: true,
    icon: 'D',
    attackRolls: 4,
    defenseRolls: 4,
    damagePerHit: 1,
    defenseDamagePerHit: 1,
    description: 'Detects submarines'
  },
  submarine: {
    name: 'Submarine',
    strength: 3,
    movement: 3,
    fuel: null,
    productionDays: 10,
    isNaval: true,
    stealth: true,
    icon: 'S',
    attackRolls: 3,
    defenseRolls: 3,
    damagePerHit: 4,
    defenseDamagePerHit: 1,
    description: 'Stealth; 4x damage attacking'
  },
  carrier: {
    name: 'Carrier',
    strength: 10,
    movement: 3,
    fuel: null,
    productionDays: 14,
    isNaval: true,
    capacity: 8,
    carriesAir: true,
    icon: 'C',
    halfStrengthCombat: true,
    damagePerHit: 1,
    defenseDamagePerHit: 1,
    description: 'Carries 8 aircraft'
  },
  battleship: {
    name: 'Battleship',
    strength: 18,
    movement: 3,
    fuel: null,
    productionDays: 20,
    isNaval: true,
    canBombard: true,
    icon: 'Bs',
    halfStrengthCombat: true,
    damagePerHit: 1,
    defenseDamagePerHit: 1,
    description: 'Range 2 bombardment'
  },
};

// Combat constants
export const BASE_HIT_CHANCE = 0.50;
export const NAVAL_VS_LAND_HIT_CHANCE = 0.33;
export const BOMBARD_HIT_CHANCE = 0.20;

export const CITY_COMBAT = {
  strength: 1,
  attackRolls: 1,
  defenseRolls: 1,
  damagePerHit: 1,
  defenseDamagePerHit: 1,
  isLand: true
};

// Unit order for production menus
export const UNIT_ORDER = ['tank', 'fighter', 'bomber', 'transport', 'destroyer', 'submarine', 'carrier', 'battleship'];

// Direction mappings (numpad style)
export const DIRECTIONS = {
  7: { dx: -1, dy: -1 },
  8: { dx: 0, dy: -1 },
  9: { dx: 1, dy: -1 },
  4: { dx: -1, dy: 0 },
  6: { dx: 1, dy: 0 },
  1: { dx: -1, dy: 1 },
  2: { dx: 0, dy: 1 },
  3: { dx: 1, dy: 1 }
};

export const ALL_DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// Status labels for UI
export const STATUS_LABELS = {
  [STATUS_READY]: { label: 'Ready', color: '#5d9970' },
  [STATUS_WAITING]: { label: 'Waiting', color: COLORS.highlight },
  [STATUS_SENTRY]: { label: 'Sentry', color: '#6a9fca' },
  [STATUS_PATROL]: { label: 'Patrol', color: '#ca9f6a' },
  [STATUS_GOTO]: { label: 'Moving', color: '#9fca6a' },
  [STATUS_SKIPPED]: { label: 'Skipped', color: COLORS.textMuted },
  [STATUS_USED]: { label: 'Used', color: COLORS.textMuted },
  [STATUS_ABOARD]: { label: 'Aboard', color: '#9f6aca' },
};

// Map sizes
export const MAP_SIZES = {
  small: { width: 48, height: 32, totalCities: 20, label: 'Small (48x32)' },
  medium: { width: 96, height: 64, totalCities: 40, label: 'Medium (96x64)' },
  large: { width: 124, height: 96, totalCities: 60, label: 'Large (124x96)' },
};

// Terrain types
export const TERRAIN_TYPES = {
  wet: { waterRatio: 0.85, label: 'Wet (85% water)' },
  normal: { waterRatio: 0.80, label: 'Normal (80% water)' },
  dry: { waterRatio: 0.75, label: 'Dry (75% water)' },
};

// Difficulty settings
export const DIFFICULTY_LEVELS = [
  { value: 1, label: '1 - Easiest', aiCities: 3, playerCities: 7 },
  { value: 2, label: '2', aiCities: 3, playerCities: 6 },
  { value: 3, label: '3', aiCities: 4, playerCities: 6 },
  { value: 4, label: '4', aiCities: 4, playerCities: 5 },
  { value: 5, label: '5 - Normal', aiCities: 5, playerCities: 5 },
  { value: 6, label: '6', aiCities: 5, playerCities: 4 },
  { value: 7, label: '7', aiCities: 6, playerCities: 4 },
  { value: 8, label: '8', aiCities: 6, playerCities: 3 },
  { value: 9, label: '9', aiCities: 7, playerCities: 3 },
  { value: 10, label: '10 - Hardest', aiCities: 7, playerCities: 2 },
];

// Game balance constants
export const BUFFER_DISTANCE = 3;
export const SURRENDER_RATIO = 4;

// ============================================================================
// HELPER FUNCTIONS (pure, stateless utilities)
// ============================================================================

/**
 * Check if a tile type is a city
 */
export function isCityTile(t) {
  return t === PLAYER_CITY || t === AI_CITY || t === NEUTRAL_CITY;
}

/**
 * Check if tile is a friendly city for the given owner
 */
export function isFriendlyCity(t, owner) {
  return (owner === 'player' && t === PLAYER_CITY) || (owner === 'ai' && t === AI_CITY);
}

/**
 * Check if tile is an enemy city for the given owner
 */
export function isEnemyCity(t, owner) {
  return (owner === 'player' && t === AI_CITY) || (owner === 'ai' && t === PLAYER_CITY);
}

/**
 * Check if tile is hostile (neutral or enemy city)
 */
export function isHostileCity(t, owner) {
  return t === NEUTRAL_CITY || isEnemyCity(t, owner);
}

/**
 * Calculate Manhattan distance between two points
 */
export function manhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

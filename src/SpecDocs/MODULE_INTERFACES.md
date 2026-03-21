# Module Interface Specifications

## Purpose
Exact function signatures and data structures for each module, reflecting the current implementation.

---

## Data Structures

### Unit
```javascript
const Unit = {
  id: number,
  type: string,         // 'tank', 'fighter', 'bomber', 'transport', 'destroyer', 'submarine', 'carrier', 'battleship'
  owner: 'player' | 'ai',
  x: number,
  y: number,
  strength: number,
  movesLeft: number,
  fuel: number | null,  // null for non-aircraft
  status: string,       // 'R', 'W', 'S', 'P', 'G', 'K', 'U', 'A'
  aboardId: number | null,
  gotoPath: Array<{x, y}> | null,
  patrolPath: Array<{x, y}> | null,
  patrolIdx: number,
  hasBombarded: boolean | undefined,  // set after battleship fires
};
```

### City
```javascript
const City = {
  owner: 'player' | 'ai' | 'neutral',
  x: number,
  y: number,
  producing: string | null,
  progress: { [unitType: string]: number }, // days invested
};
```

### GameState
```javascript
const GameState = {
  map: number[][],           // 2D array of tile types, accessed as map[y][x]
  width: number,
  height: number,
  units: Unit[],
  cities: { [key: string]: City }, // key is "x,y"
  turn: number,
  activeUnitId: number | null,
  nextUnitId: number,
  mapSize: 'small' | 'medium' | 'large',
  terrain: 'wet' | 'normal' | 'dry',
  difficulty: number,
};
```

---

## 1. Movement Engine (`movement-engine.js`)

```javascript
/**
 * Get count of units currently aboard a carrier/transport.
 */
export function getCargoCount(carrierId: number, units: Unit[]): number;

/**
 * Get the effective location of a unit (returns carrier's position if aboard).
 */
export function getUnitLocation(unit: Unit, units: Unit[]): { x: number, y: number };

/**
 * Get all non-aboard units at a specific tile.
 */
export function getUnitsAtLocation(x: number, y: number, units: Unit[]): Unit[];

/**
 * Check if a tile has any adjacent water tiles.
 */
export function isAdjacentToWater(x, y, map, width, height): boolean;

/**
 * Check if a tile has any adjacent non-water tiles.
 */
export function isAdjacentToLand(x, y, map, width, height): boolean;

/**
 * Check if a unit can enter a terrain tile (terrain-only check, no collision).
 */
export function canEnterTerrain(unit: Unit, x: number, y: number, gameState: GameState): boolean;

/**
 * Check if a unit can stack at a location (terrain + collision).
 * Returns: { ok: boolean, reason?: 'enemy' | 'no_space' | 'naval_collision' }
 */
export function canStackAt(unit: Unit, x: number, y: number, gameState: GameState): { ok: boolean, reason?: string };

/**
 * Check if an aircraft unit is on a refuel tile (friendly city or carrier).
 */
export function isOnRefuelTile(unit: Unit, gameState: GameState): boolean;

/**
 * Get all valid moves for a unit (one-tile range).
 * Returns array of { x, y, dir, isAttack, isCity, disembark?, boardId? }
 */
export function getValidMoves(unit: Unit, gameState: GameState): Move[];

const Move = {
  x: number,
  y: number,
  dir: number,          // Numpad direction key (1-9)
  isAttack: boolean,
  isCity: boolean,
  disembark?: boolean,  // Unit leaving a transport
  boardId?: number,     // ID of transport/carrier to board
};

/**
 * Get valid bombardment targets for a battleship (canBombard units).
 * Targets are at Chebyshev distance exactly 2 from the unit.
 * Requires fog array to filter to visible tiles only.
 *
 * @param unit - Must have UNIT_SPECS[unit.type].canBombard === true
 * @param gameState
 * @param fog - 2D fog array from buildFogArray()
 * @param FOG_VISIBLE_VALUE - The FOG_VISIBLE constant (default 2)
 * @returns Array of { x, y, hasEnemy, enemyUnit }
 */
export function getBombardTargets(
  unit: Unit,
  gameState: GameState,
  fog: number[][],
  FOG_VISIBLE_VALUE?: number
): Array<{ x: number, y: number, hasEnemy: boolean, enemyUnit: Unit | null }>;

/**
 * Find a path from start to end using A* pathfinding.
 * Returns array of {x,y} steps (not including start), or null if no path.
 *
 * @param tileCostFn - Optional function(x, y) => number for weighted pathfinding.
 *                     Used by AI transport avoidance (high cost for danger tiles).
 * @param maxDistance - Open set size limit (default 1000)
 */
export function findPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  unit: Unit,
  gameState: GameState,
  maxDistance?: number,
  tileCostFn?: (x: number, y: number) => number
): Array<{x: number, y: number}> | null;

/**
 * Test utility: create a blank map filled with WATER, with optional land tiles.
 */
export function createTestMap(width: number, height: number, landTiles?: [number, number][]): number[][];
```

---

## 2. Game State (`game-state.js`)

```javascript
export function createGameState(mapData, mapSize, terrain, difficulty): GameState;

export function setUnitGoTo(state: GameState, unitId: number, path: Array<{x,y}>): GameState;

export function setUnitPatrol(state: GameState, unitId: number, waypoints: Array<{x,y}>): GameState;

export function setUnitStatus(state: GameState, unitId: number, status: string): GameState;

export function unloadUnit(state: GameState, carrierId: number): { state: GameState, unloadedCount: number };

export function setCityProduction(state: GameState, cityKey: string, unitType: string): GameState;

export function endPlayerTurn(state: GameState): GameState;

export function checkVictoryCondition(state: GameState): { status: 'playing' | 'victory' | 'defeat', reason?: string };

export function findNextUnit(state: GameState, currentId?: number, excludeWaiting?: boolean): number | null;
```

---

## 3. Fog of War (`fog-of-war.js`)

```javascript
/**
 * Calculate currently visible tiles for a player.
 * Vision radius: 3x3 (one tile in all 8 directions).
 * Returns Set of "x,y" strings.
 */
export function calculateVisibility(gameState: GameState, owner: 'player' | 'ai'): Set<string>;

/**
 * Build 2D fog array for rendering.
 * Returns array[y][x] of FOG_UNEXPLORED | FOG_EXPLORED | FOG_VISIBLE.
 */
export function buildFogArray(
  width: number,
  height: number,
  explored: Set<string>,
  currentlyVisible: Set<string>,
  turnVisibility?: Set<string>
): number[][];

/**
 * Merge two explored tile Sets. Returns new Set.
 */
export function updateExploredTiles(explored: Set<string>, newlyVisible: Set<string>): Set<string>;
```

---

## 4. AI Opponent (`ai-opponent.js`)

### External API (unchanged)

```javascript
/**
 * Execute a full AI turn. Mutates nothing — returns new state and knowledge.
 */
export function executeAITurn(
  gameState: GameState,
  knowledge: AIKnowledge
): { state: GameState, knowledge: AIKnowledge, observations: any[], combatEvents: any[] };

/**
 * Create a blank AI knowledge object (for new games).
 */
export function createAIKnowledge(startX?: number, startY?: number): AIKnowledge;

/**
 * Create AI knowledge from an existing game state (for resuming/loading).
 */
export function createAIKnowledgeFromState(gameState: GameState): AIKnowledge;

/**
 * Record what the AI saw during the player's turn (observation symmetry).
 */
export function recordPlayerObservations(knowledge: AIKnowledge, observations: any[]): AIKnowledge;

// Re-exported from ai-helpers.js:
export { PHASE, AI_CONFIG, setAIConfig, getAIConfig };
```

### AI Knowledge State

```javascript
const AIKnowledge = {
  exploredTiles: Set<string>,
  startPosition: { x: number, y: number } | null,
  explorationPhase: string,           // PHASE.LAND | TRANSITION | NAVAL | LATE_GAME
  hasSeenPlayerUnit: boolean,
  hasSeenPlayerCity: boolean,
  homeIslandTiles: Set<string> | null,
  homeIslandCities: Set<string>,
  lostCities: Set<string>,
  lastTurnObservations: any[],
  knownCities: Set<string>,
  islands: IslandRecord[],            // Partial island tracking
};

const IslandRecord = {
  id: number,
  tiles: Set<string>,
  cities: Set<string>,
  coastTiles: Set<string>,
  exploredPct: number,
  isHomeIsland: boolean,
  fullyMapped: boolean,
};
```

---

## 5. AI Helpers (`ai-helpers.js`)

```javascript
// Logging
export const log: (...args) => void;
export const logPhase: (...args) => void;
export const logMission: (...args) => void;
export function logTurnSummary(state, knowledge, missions, turnLog): void;

// Phase / Config
export const PHASE: { LAND, TRANSITION, NAVAL, LATE_GAME };
export const TARGET_DIST: { [phase]: { [unitType]: number } };
export const AI_CONFIG: { exploration, fuel, defense, tactical };
export const TACTICAL_ALLOCATION: { [phase]: { [unitType]: number } };
export const setAIConfig: (c) => void;
export const getAIConfig: () => object;

// Geometry
export function findNearest(from: {x,y}, targets: {x,y}[]): {x,y} | null;
export function floodFillLand(startX, startY, state): Set<string>;
export function floodFillExploredLand(startX, startY, state, exploredTiles): Set<string>;
export function clearPathCache(): void;

/**
 * Find the best single-step move toward a target using cached A* + greedy fallback.
 *
 * @param avoidTiles - Optional Set<"x,y"> of tiles to penalise (cost 20 per tile).
 *                     Used by transports to route around naval danger zones.
 */
export function getMoveToward(
  unit: Unit,
  target: {x,y},
  state: GameState,
  avoidTiles?: Set<string>
): {x,y} | null;

export function findNearestUnexplored(unit, state, knowledge): {x,y,dist} | null;
export function findBestExploreTarget(unit, state, knowledge, terrain: 'water'|'land'): {x,y,dist} | null;
export function findDeepScoutTarget(unit, state, knowledge, refuelPoints): {x,y,dist,returnDist} | null;
export function findCoastExploreTarget(unit, state, knowledge, islandTiles): {x,y,dist} | null;

/**
 * Evaluate whether an AI unit should initiate combat.
 *
 * Uses an EV (expected value) model:
 *   effAttack  = attRolls * 0.5 * damagePerHit
 *   effDefense = defRolls * 0.5 * defenseDamagePerHit  (0 if sub vs non-destroyer)
 *   roundsToKillDef = defender.strength / effAttack
 *   roundsToKillAtt = attacker.strength / effDefense  (Infinity if defender can't fight back)
 *   winProb    = roundsToKillAtt / (roundsToKillDef + roundsToKillAtt)
 *   netEV      = winProb * defenderValue - (1 - winProb) * attackerValue
 *
 * Thresholds:
 *   - Standard: netEV > -attackerValue * 0.15
 *   - Near friendly city (dist <= 3): netEV > -attackerValue * 0.35
 *
 * Special rules override the EV model for transports and loaded carriers.
 * Cargo value (productionDays) is included in both attacker and defender valuation.
 *
 * Returns { shouldAttack, reason, attackerValue, defenderValue }
 */
export function evaluateCombat(
  attacker: Unit,
  defender: Unit,
  gameState: GameState
): { shouldAttack: boolean, reason: string, attackerValue: number, defenderValue: number };

export function getAdjacentEnemies(unit, state): Array<{enemy, x, y}>;
export function getAdjacentPlayerUnits(x, y, units): Unit[];
export function isAdjacentToPlayerCity(x, y, cities): boolean;
export function getRefuelPoints(state): Array<{x,y}>;
```

---

## 6. AI Tactical Manager (`ai-tactical-manager.js`)

```javascript
/**
 * Scan visible tiles for threats.
 */
export function detectThreats(state: GameState, knowledge: AIKnowledge): {
  playerTransports: Unit[],
  playerNavalCombat: Unit[],
  playerFighters: Unit[],
  playerBombers: Unit[],
  threatenedCities: Array<{ city, threat, distance }>
};

/**
 * Assign combat missions to tactical-allocated units.
 * Returns Map<unitId, { mission }>
 */
export function assignTacticalMissions(
  state, knowledge, units, threats, phase, turnLog
): Map<number, { mission: Mission | null }>;

/**
 * Build the set of tiles that are within naval threat range of any visible
 * player combat ship. Used by getMoveToward as an avoidTiles set for transports.
 */
export function getNavalDangerZone(state: GameState, knowledge: AIKnowledge): Set<string>;
```

---

## 7. AI Exploration Manager (`ai-exploration-manager.js`)

```javascript
/**
 * Assign exploration/ferry/staging missions.
 * Returns Map<unitId, { mission }>
 */
export function assignExplorationMissions(
  state, knowledge, units, phase, turnLog
): Map<number, { mission: Mission | null }>;

/**
 * Update partial island knowledge from newly explored tiles.
 */
export function updateIslandKnowledge(knowledge: AIKnowledge, state: GameState): AIKnowledge;
```

---

## 8. AI City Manager (`ai-city-manager.js`)

```javascript
/**
 * Plan production for all AI cities. Returns updated state.
 * Never switches production mid-build (progress > 0).
 * Uses fractional unit counting to balance production.
 */
export function planProduction(state: GameState, knowledge: AIKnowledge, turnLog: string[]): GameState;
```

---

## 9. UI Components (`ui-components.jsx`)

```javascript
export function Tile({
  type: number,
  fogState: number,
  x: number,
  y: number,
  isValidMove?: boolean,
  isAttack?: boolean,
  isPath?: boolean,
  isPatrolWaypoint?: boolean,
  onClick?: () => void,
  onDoubleClick?: () => void,
  onMouseDown?: (e) => void,
  onMouseEnter?: () => void,
  onMouseUp?: () => void,
  style?: object,
  tileConfig?: object,   // Override tile rendering (default: DEFAULT_TILE_CONFIG)
  map?: number[][],      // Optional: passed for autotile water edge detection
}): JSX.Element;

/**
 * Renders a unit sprite with optional health, cargo, and stack count badges.
 *
 * cargoCount (top-left, blue badge): number of units aboard this carrier/transport.
 * stackCount (top-right, amber badge): total friendly units on this tile.
 *   Only rendered when stackCount > 1. The badge is shown on the topmost unit only
 *   (the one with tileTop matching its id in the render loop).
 */
export function UnitSprite({
  unit: Unit,
  isActive?: boolean,
  blink?: boolean,
  onClick?: (e) => void,
  cargoCount?: number,
  stackCount?: number,
  isAboard?: boolean,
  spriteConfig?: object,  // Override sprite rendering (default: DEFAULT_SPRITE_CONFIG)
}): JSX.Element;

export function MiniMap({
  map: number[][],
  fog: number[][],
  units: Unit[],
  width: number,
  height: number,
  viewportX: number,
  viewportY: number,
  onNavigate: (x, y) => void,
  exploredPercent?: number,
}): JSX.Element;

export function TurnInfo({
  turn: number,
  phase: string,
  unitsWaiting: number,
  playerCities: number,
  aiCities: number,
  neutralCities: number,
  onEndTurn: () => void,
  onShowCityList: () => void,
  onShowAllUnits?: () => void,
  onShowAiSummary?: () => void,
  onSaveGame?: () => void,
  hasAiObservations?: boolean,
}): JSX.Element;

export function UnitInfoPanel({
  unit: Unit | null,
  units: Unit[],
  gameState: GameState,
}): JSX.Element;

export function CommandMenu({
  activeUnit: Unit | null,
  onCommand: (cmd: string) => void,
  disabled?: boolean,
  patrolMode?: boolean,
  bombardMode?: boolean,
}): JSX.Element;

export function GotoLineOverlay({
  sx, sy, ex, ey,   // Start/end tile coordinates
  vx, vy,           // Viewport offset
  dist: number,
  turns: number,
}): JSX.Element;

export function PatrolOverlay({
  waypoints: Array<{x,y}>,
  vx: number,
  vy: number,
}): JSX.Element;

// Sprite/tile config exports
export const DEFAULT_SPRITE_CONFIG: object;
export const DEFAULT_TILE_CONFIG: object;
```

---

## 10. Dialog Components (`dialog-components.jsx`)

```javascript
export function CityProductionDialog({ city, cityKey, map, width, height, units, fogArray, onClose, onSetProduction, onMakeActive }): JSX.Element;
export function UnitViewDialog({ x, y, map, width, height, units, fogArray, onClose, onMakeActive }): JSX.Element;
export function CityListDialog({ cities, units, onClose, onSelectCity }): JSX.Element;
export function AllUnitsListDialog({ units, map, width, height, fogArray, onClose, onSelectUnit, onMakeActive }): JSX.Element;
export function PatrolConfirmDialog({ waypoints, segmentDistances, onConfirm, onCancel }): JSX.Element;
export function SurrenderDialog({ message, onYes, onNo }): JSX.Element;
export function VictoryDialog({ turn, mapSize, difficulty, onNewGame }): JSX.Element;
export function DefeatDialog({ onNewGame }): JSX.Element;
export function AITurnSummaryDialog({ observations, combatEvents, onContinue, onCenterOn }): JSX.Element;
export function SaveGameDialog({ gameState, exploredTiles, aiKnowledge, onSave, onSaveAndQuit, onClose }): JSX.Element;
export function LoadGameDialog({ onLoad, onClose }): JSX.Element;
export function getSavedGames(): Array<SaveSlot | null>;
```

---

## Mission Object (assigned by managers, consumed by movement)

```javascript
const Mission = {
  type: string,         // See mission types below
  target: { x, y },
  targetKey?: string,   // "x,y" for dedup
  assignedBy: 'exploration' | 'tactical' | 'city',
  priority: number,     // 1-10
  reason: string,
};
```

### Mission Types

| Type | Manager | Description |
|------|---------|-------------|
| `explore_sector` | Exploration | Fighter deep-scouts a map sector |
| `explore_island_coast` | Exploration | Naval follows island coastline |
| `explore_island_interior` | Exploration | Fighter explores newly found island |
| `rebase` | Exploration | Fighter relocates to frontier city |
| `capture_city` | Exploration | Tank moves to neutral/player city |
| `ferry_invasion` | Exploration | Transport delivers tanks to target island |
| `stage_coastal` | Exploration | Tank moves to coast for transport pickup |
| `garrison` | Exploration | Tank stays in city as defense |
| `hunt_target` | Tactical | Combat unit attacks high-value target |
| `escort_transport` | Tactical | Destroyer escorts AI transport |
| `defend_city` | Tactical | Unit moves to defend threatened city |
| `patrol_area` | Tactical | Fighter patrols around AI territory |

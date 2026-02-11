# Module Interface Specifications

## Purpose
Define exact function signatures and data structures for each module to enable parallel development across threads without integration conflicts.

---

## 1. Game State Module (`game-state.js`)

### Data Structure

```javascript
const GameState = {
  // Map data
  map: number[][], // 2D array of tile types
  width: number,
  height: number,
  
  // Entities
  units: Unit[],
  cities: { [key: string]: City }, // key is "x,y"
  
  // Turn tracking
  turn: number,
  activeUnitId: number | null,
  nextUnitId: number, // for generating new units
  
  // Game config
  mapSize: 'small' | 'medium' | 'large',
  terrain: 'wet' | 'normal' | 'dry',
  difficulty: number, // 1-10
};

const Unit = {
  id: number,
  type: string, // 'tank', 'fighter', etc.
  owner: 'player' | 'ai',
  x: number,
  y: number,
  strength: number,
  movesLeft: number,
  fuel: number | null,
  status: string, // 'R', 'W', 'S', 'P', 'U', 'A', 'K'
  aboardId: number | null, // ID of carrier/transport
  gotoPath: Array<{x: number, y: number}> | null,
  patrolPath: Array<{x: number, y: number}> | null,
  patrolIdx: number,
};

const City = {
  owner: 'player' | 'ai' | 'neutral',
  x: number,
  y: number,
  producing: string | null, // unit type
  progress: { [unitType: string]: number }, // days invested
};
```

### Public Functions

```javascript
/**
 * Create initial game state from map generation
 */
export function createGameState(
  mapData: { map, width, height, cities },
  mapSize: string,
  terrain: string,
  difficulty: number
): GameState;

/**
 * Attempt to move a unit (validates, executes, handles combat)
 * Returns: { success: boolean, newState: GameState, message: string }
 */
export function moveUnit(
  state: GameState,
  unitId: number,
  dx: number,
  dy: number
): { success: boolean, state: GameState, message: string, unitDestroyed: boolean };

/**
 * Set a unit's GoTo path
 */
export function setUnitGoTo(
  state: GameState,
  unitId: number,
  path: Array<{x, y}>
): GameState;

/**
 * Set a unit's patrol route
 */
export function setUnitPatrol(
  state: GameState,
  unitId: number,
  waypoints: Array<{x, y}>
): GameState;

/**
 * Change unit status (wait, skip, sentry, etc.)
 */
export function setUnitStatus(
  state: GameState,
  unitId: number,
  status: string
): GameState;

/**
 * Board a unit onto a carrier/transport
 */
export function boardUnit(
  state: GameState,
  unitId: number,
  carrierId: number
): GameState;

/**
 * Unload all cargo from a carrier/transport
 */
export function unloadUnit(
  state: GameState,
  carrierId: number
): { state: GameState, unloadedCount: number };

/**
 * Set city production
 */
export function setCityProduction(
  state: GameState,
  cityKey: string,
  unitType: string
): GameState;

/**
 * Process end of turn (reset moves, production, healing)
 */
export function endPlayerTurn(
  state: GameState
): GameState;

/**
 * Check victory condition
 * Returns: { status: 'playing' | 'victory' | 'defeat', reason?: string }
 */
export function checkVictoryCondition(
  state: GameState
): { status: string, reason?: string };

/**
 * Find next available unit for the player
 */
export function findNextUnit(
  state: GameState,
  currentId?: number,
  excludeWaiting?: boolean
): number | null;

/**
 * Get all units at a specific location
 */
export function getUnitsAt(
  state: GameState,
  x: number,
  y: number,
  includeAboard?: boolean
): Unit[];

/**
 * Get effective location of unit (follows carrier if aboard)
 */
export function getUnitLocation(
  unit: Unit,
  state: GameState
): { x: number, y: number };
```

---

## 2. Movement Engine Module (`movement-engine.js`)

### Public Functions

```javascript
/**
 * Get all valid moves for a unit
 * Returns array of { x, y, dir, isAttack, isCity, disembark?, boardId? }
 */
export function getValidMoves(
  unit: Unit,
  gameState: GameState
): Move[];

const Move = {
  x: number,
  y: number,
  dir: number, // 1-9 (numpad)
  isAttack: boolean,
  isCity: boolean,
  disembark?: boolean, // tank leaving transport
  boardId?: number, // boarding a carrier/transport
};

/**
 * Check if a unit can enter a terrain tile
 */
export function canEnterTerrain(
  unit: Unit,
  x: number,
  y: number,
  gameState: GameState
): boolean;

/**
 * Check if a unit can stack at a location
 * Returns: { ok: boolean, reason?: string }
 */
export function canStackAt(
  unit: Unit,
  x: number,
  y: number,
  gameState: GameState
): { ok: boolean, reason?: string };

/**
 * Find path from start to end using A* pathfinding
 * Returns: Array<{x, y}> or null if no path
 */
export function findPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  unit: Unit,
  gameState: GameState,
  maxDistance?: number
): Array<{x: number, y: number}> | null;

/**
 * Calculate Manhattan distance
 */
export function manhattanDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number;

/**
 * Check if a tile is adjacent to water (for coastal detection)
 */
export function isAdjacentToWater(
  x: number,
  y: number,
  gameState: GameState
): boolean;

/**
 * Check if a tile is adjacent to land
 */
export function isAdjacentToLand(
  x: number,
  y: number,
  gameState: GameState
): boolean;

/**
 * Check if unit is on a refuel tile (city, carrier)
 */
export function isOnRefuelTile(
  unit: Unit,
  gameState: GameState
): boolean;
```

---

## 3. Combat Engine Module (`combat-engine.js`)

### Public Functions

```javascript
/**
 * Simulate combat between two units
 * Returns damage dealt to each side and survivor info
 */
export function simulateCombat(
  attacker: Unit,
  defender: Unit,
  gameState: GameState,
  options?: {
    isFirstAttack?: boolean,
    isBombard?: boolean
  }
): CombatResult;

const CombatResult = {
  damageToDefender: number,
  damageToAttacker: number,
  attackerSurvived: boolean,
  defenderSurvived: boolean,
  attackerRemainingStrength: number,
  defenderRemainingStrength: number,
  attackerRolls: number,
  defenderRolls: number,
  attackerHits: number,
  defenderHits: number,
  subStealthActive: boolean,
  isBombard: boolean,
};

/**
 * Resolve combat between unit and empty city
 */
export function resolveCityAttack(
  attacker: Unit,
  gameState: GameState
): CityCombatResult;

const CityCombatResult = {
  damageToAttacker: number,
  cityDestroyed: boolean,
  attackerRemainingStrength: number,
};

/**
 * Calculate hit chance for an attack
 */
export function calculateHitChance(
  attacker: Unit,
  defender: Unit,
  gameState: GameState,
  isBombard?: boolean
): number;

/**
 * Get number of attack rolls for a unit
 */
export function getAttackRolls(
  unit: Unit,
  gameState: GameState
): number;

/**
 * Get number of defense rolls for a unit
 */
export function getDefenseRolls(
  unit: Unit,
  gameState: GameState,
  attacker: Unit
): number;

/**
 * Run multiple combat simulations (for testing/AI)
 * Returns statistics about likely outcomes
 */
export function runCombatSimulations(
  attacker: Unit,
  defender: Unit,
  gameState: GameState,
  iterations: number = 100
): CombatStatistics;

const CombatStatistics = {
  attackerWins: number, // percentage
  defenderWins: number,
  bothSurvive: number,
  averageDamageToDefender: number,
  averageDamageToAttacker: number,
};
```

---

## 4. Fog of War Module (`fog-of-war.js`)

### Data Structures

```javascript
// Fog states
const FOG_UNEXPLORED = 0;
const FOG_EXPLORED = 1;
const FOG_VISIBLE = 2;
```

### Public Functions

```javascript
/**
 * Calculate currently visible tiles for a player
 * Returns Set of "x,y" strings
 */
export function calculateVisibility(
  gameState: GameState,
  owner: 'player' | 'ai'
): Set<string>;

/**
 * Build fog array for rendering
 * Returns 2D array of fog states
 */
export function buildFogArray(
  width: number,
  height: number,
  explored: Set<string>,
  currentlyVisible: Set<string>
): number[][];

/**
 * Update explored tiles with new visibility
 * Returns new Set with merged tiles
 */
export function updateExploredTiles(
  explored: Set<string>,
  newlyVisible: Set<string>
): Set<string>;

/**
 * Check if a tile is visible to a player
 */
export function isTileVisible(
  x: number,
  y: number,
  gameState: GameState,
  owner: 'player' | 'ai',
  fogState: number[][]
): boolean;
```

---

## 5. AI Opponent Module (`ai-opponent.js`)

### Configuration

```javascript
const AIConfig = {
  difficulty: number, // 1-10
  personality: 'aggressive' | 'defensive' | 'economic' | 'balanced',
  weights: {
    expansion: number, // 0-1
    defense: number,
    economy: number,
    aggression: number,
  },
  thresholds: {
    attack: number, // min win probability
    retreat: number, // max health ratio
  },
};
```

### AI Knowledge State

```javascript
const AIKnowledge = {
  exploredTiles: Set<string>,
  knownCities: Array<{
    x: number,
    y: number,
    owner: string,
    lastSeen: number, // turn number
  }>,
  knownEnemyUnits: Array<{
    id: number,
    type: string,
    x: number,
    y: number,
    lastSeen: number,
  }>,
  strategicAssessment: {
    playerStrength: number, // 0-1 estimate
    territorialControl: number, // 0-1
    economicAdvantage: number, // -1 to 1
  },
};
```

### Public Functions

```javascript
/**
 * Execute full AI turn
 * Returns: { newState: GameState, knowledge: AIKnowledge, log: string[] }
 */
export function executeAITurn(
  gameState: GameState,
  aiKnowledge: AIKnowledge,
  config?: AIConfig
): { state: GameState, knowledge: AIKnowledge, log: string[] };

/**
 * Configure AI behavior
 */
export function setAIConfig(config: Partial<AIConfig>): void;

/**
 * Get current AI configuration
 */
export function getAIConfig(): AIConfig;

/**
 * Update AI's knowledge of the game state
 */
export function updateAIKnowledge(
  knowledge: AIKnowledge,
  gameState: GameState
): AIKnowledge;

/**
 * Decide action for a single unit
 * Returns: { type: 'move' | 'attack' | 'goto' | 'wait', details: any }
 */
export function decideUnitAction(
  unit: Unit,
  gameState: GameState,
  aiKnowledge: AIKnowledge,
  config: AIConfig
): UnitDecision;

const UnitDecision = {
  type: 'move' | 'attack' | 'goto' | 'wait' | 'board' | 'unload',
  target?: { x: number, y: number },
  path?: Array<{x: number, y: number}>,
  reason?: string, // for debugging
};

/**
 * Determine production for an AI city
 */
export function determineProduction(
  city: City,
  gameState: GameState,
  aiKnowledge: AIKnowledge,
  config: AIConfig
): string; // unit type

/**
 * Assess strategic situation
 */
export function assessStrategicSituation(
  gameState: GameState,
  aiKnowledge: AIKnowledge
): {
  phase: 'early' | 'mid' | 'late',
  position: 'winning' | 'losing' | 'even',
  recommendations: string[],
};
```

---

## 6. UI Components Module (`ui-components.jsx`)

### Component Signatures

```javascript
/**
 * Render a single map tile
 */
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
}): JSX.Element;

/**
 * Render a unit sprite
 */
export function UnitSprite({
  unit: Unit,
  isActive?: boolean,
  blink?: boolean,
  onClick?: (e) => void,
  cargoCount?: number,
  isAboard?: boolean,
}): JSX.Element;

/**
 * Render mini-map
 */
export function MiniMap({
  map: number[][],
  fog: number[][],
  units: Unit[],
  width: number,
  height: number,
  viewportX: number,
  viewportY: number,
  onNavigate: (x, y) => void,
}): JSX.Element;

/**
 * Turn info panel
 */
export function TurnInfo({
  turn: number,
  phase: string,
  unitsWaiting: number,
  playerCities: number,
  aiCities: number,
  neutralCities: number,
  onEndTurn: () => void,
  onShowCityList: () => void,
}): JSX.Element;

/**
 * Unit info panel
 */
export function UnitInfoPanel({
  unit: Unit | null,
  units: Unit[],
  gameState: GameState,
}): JSX.Element;

/**
 * Command menu
 */
export function CommandMenu({
  activeUnit: Unit | null,
  onCommand: (cmd: string) => void,
  disabled?: boolean,
  patrolMode?: boolean,
}): JSX.Element;

/**
 * GoTo path overlay (SVG)
 */
export function GotoLineOverlay({
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  vx: number,
  vy: number,
  dist: number,
  turns: number,
}): JSX.Element;

/**
 * Patrol waypoints overlay (SVG)
 */
export function PatrolOverlay({
  waypoints: Array<{x, y}>,
  vx: number,
  vy: number,
}): JSX.Element;
```

---

## 7. Dialog Components Module (`dialog-components.jsx`)

### Component Signatures

```javascript
/**
 * City production dialog
 */
export function CityProductionDialog({
  city: City,
  cityKey: string,
  map: number[][],
  width: number,
  height: number,
  units: Unit[],
  onClose: () => void,
  onSetProduction: (cityKey, unitType) => void,
  onMakeActive: (unitId) => void,
}): JSX.Element;

/**
 * Unit view dialog (for stacks)
 */
export function UnitViewDialog({
  x: number,
  y: number,
  map: number[][],
  width: number,
  height: number,
  units: Unit[],
  onClose: () => void,
  onMakeActive: (unitId) => void,
}): JSX.Element;

/**
 * City list dialog
 */
export function CityListDialog({
  cities: { [key: string]: City },
  units: Unit[],
  onClose: () => void,
  onSelectCity: (x, y) => void,
}): JSX.Element;

/**
 * Patrol confirmation dialog
 */
export function PatrolConfirmDialog({
  waypoints: Array<{x, y}>,
  onConfirm: () => void,
  onCancel: () => void,
}): JSX.Element;

/**
 * Surrender prompt dialog
 */
export function SurrenderDialog({
  message: string,
  onYes: () => void,
  onNo: () => void,
}): JSX.Element;

/**
 * Victory screen
 */
export function VictoryDialog({
  turn: number,
  mapSize: string,
  difficulty: number,
  onNewGame: () => void,
}): JSX.Element;

/**
 * Defeat screen
 */
export function DefeatDialog({
  onNewGame: () => void,
}): JSX.Element;
```

---

## Integration Pattern

### Main Game Component Usage

```javascript
import { createGameState, moveUnit, endPlayerTurn } from './game-state.js';
import { executeAITurn } from './ai-opponent.js';
import { getValidMoves } from './movement-engine.js';
import { calculateVisibility } from './fog-of-war.js';
import { simulateCombat } from './combat-engine.js';
import { Tile, UnitSprite, MiniMap } from './ui-components.jsx';
import { CityProductionDialog, VictoryDialog } from './dialog-components.jsx';

function StrategicConquestGame() {
  const [gameState, setGameState] = useState(null);
  
  // Movement
  const handleMove = (dx, dy) => {
    const result = moveUnit(gameState, activeUnitId, dx, dy);
    if (result.success) {
      setGameState(result.state);
      setMessage(result.message);
    }
  };
  
  // End turn
  const handleEndTurn = () => {
    let newState = endPlayerTurn(gameState);
    const aiResult = executeAITurn(newState, aiKnowledge);
    setGameState(aiResult.state);
    setAiKnowledge(aiResult.knowledge);
  };
  
  // Render
  return (
    <div>
      {/* Map viewport */}
      {gameState.map.map((row, y) => row.map((tile, x) => (
        <Tile key={`${x}-${y}`} type={tile} fogState={fog[y][x]} 
              x={x} y={y} onClick={() => handleTileClick(x, y)} />
      )))}
      
      {/* Units */}
      {gameState.units.map(unit => (
        <UnitSprite key={unit.id} unit={unit} isActive={unit.id === activeUnitId} />
      ))}
      
      {/* UI panels */}
      <MiniMap map={gameState.map} units={gameState.units} ... />
    </div>
  );
}
```

---

## Testing Interfaces

Each module should export test utilities:

```javascript
// game-state.js
export function createTestGameState(overrides?: Partial<GameState>): GameState;

// combat-engine.js
export function createTestUnit(type: string, strength: number): Unit;

// movement-engine.js
export function createTestMap(width: number, height: number): number[][];
```

---

## Type Checking

Consider adding TypeScript or JSDoc for type safety:

```javascript
/**
 * @typedef {Object} GameState
 * @property {number[][]} map
 * @property {number} width
 * @property {number} height
 * @property {Unit[]} units
 * @property {Object.<string, City>} cities
 */

/**
 * Move a unit on the map
 * @param {GameState} state - Current game state
 * @param {number} unitId - ID of unit to move
 * @param {number} dx - X displacement
 * @param {number} dy - Y displacement
 * @returns {{success: boolean, state: GameState, message: string}}
 */
export function moveUnit(state, unitId, dx, dy) {
  // ...
}
```

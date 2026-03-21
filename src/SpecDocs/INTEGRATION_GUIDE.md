# Module Integration Guide

## Purpose
Guide to how modules connect in the main game orchestrator (`strategic-conquest-game-integrated.jsx`). Covers data flow, event handling, and coordination between modules.

---

## High-Level Data Flow

```
User Input (keyboard/mouse)
         |
   Game Orchestrator (strategic-conquest-game-integrated.jsx)
         |
   +---------+----------+
   |                    |
Game State          UI State
   |
   +-> Movement Engine  -> Valid Moves, Pathfinding, Bombard Targets
   +-> Combat (inline)  -> Battle Results
   +-> Fog of War       -> Visibility
   +-> AI Opponent      -> AI Actions (on end turn)
   +-> game-state.js    -> Production, Status changes, Turn transitions
         |
   Updated State
         |
   UI Components (render)
```

---

## State Management in Main Component

```javascript
// Core game state
const [gameState, setGameState] = useState(null);
const [phase, setPhase] = useState(PHASE_MENU);

// Viewport
const [viewportX, setViewportX] = useState(0);
const [viewportY, setViewportY] = useState(0);

// Fog of war (player perspective)
const [exploredTiles, setExploredTiles] = useState(() => new Set());
const [turnVisibility, setTurnVisibility] = useState(() => new Set());

// AI knowledge
const [aiKnowledge, setAiKnowledge] = useState(() => createAIKnowledge());

// Mode state
const [gotoMode, setGotoMode] = useState(false);
const [patrolMode, setPatrolMode] = useState(false);
const [bombardMode, setBombardMode] = useState(false);

// Auto-movement (GoTo/Patrol execution)
const [autoMovingUnitId, setAutoMovingUnitId] = useState(null);
const [autoMoveQueue, setAutoMoveQueue] = useState([]);
```

---

## Integration Point 1: Game Initialization

```javascript
import { generateMap } from './map-generator.js';
import { createGameState } from './game-state.js';
import { createAIKnowledge } from './ai-opponent.js';

const handleStartGame = (mapSize, terrain, difficulty) => {
  const mapData = generateMap(mapSize, terrain, difficulty);
  const newState = createGameState(mapData, mapSize, terrain, difficulty);

  // Initialize AI knowledge with AI's starting city position
  const aiCity = Object.values(newState.cities).find(c => c.owner === 'ai');
  setAiKnowledge(createAIKnowledge(aiCity?.x, aiCity?.y));

  setGameState(newState);
  setPhase(PHASE_PLAYING);
  setExploredTiles(new Set());
  setTurnVisibility(new Set());
};
```

---

## Integration Point 2: Fog of War

Fog is computed via `useMemo` each render:

```javascript
import { calculateVisibility, buildFogArray, updateExploredTiles } from './fog-of-war.js';

const currentVisibility = useMemo(() =>
  gameState ? calculateVisibility(gameState, 'player') : new Set(),
  [gameState]
);

const fog = useMemo(() =>
  gameState ? buildFogArray(gameState.width, gameState.height, exploredTiles, currentVisibility, turnVisibility) : [],
  [gameState, exploredTiles, currentVisibility, turnVisibility]
);

// Merge current visibility into explored tiles on every render
useEffect(() => {
  if (gameState) setExploredTiles(prev => updateExploredTiles(prev, currentVisibility));
}, [currentVisibility, gameState]);
```

---

## Integration Point 3: Valid Moves and Bombard Targets

```javascript
import { getValidMoves, getBombardTargets } from './movement-engine.js';

const validMoves = useMemo(() =>
  activeUnit && gameState ? getValidMoves(activeUnit, gameState) : [],
  [activeUnit, gameState]
);

const bombardTargets = useMemo(() => {
  if (!bombardMode || !activeUnit || !gameState) return [];
  if (activeUnit.hasBombarded) return [];
  return getBombardTargets(activeUnit, gameState, fog, FOG_VISIBLE);
}, [bombardMode, activeUnit, gameState, fog]);
```

---

## Integration Point 4: Combat Resolution (Inline Functions)

Combat is resolved by inline functions in `strategic-conquest-game-integrated.jsx` (not in a separate module). These functions mirror the same dice-roll logic for all combat types.

### Unit vs Unit

```javascript
function simulateCombatWithDefender(attacker, defender, allUnits = []) {
  // Base rolls adjusted for current strength ratio
  // Carrier bonus: +1 attack/defense die per 2 fighters aboard
  // Submarine stealth: defender can't fight back (dRolls = 0) unless detectsSubs
  // Naval vs land: 33% hit chance instead of 50%
  // Returns: { dmgToDef, dmgToAtt, attRem, defRem }
}

const resolveCombat = (att, def, allUnits = []) => { ... };
```

### Unit vs City

```javascript
// City has 1 strength point (CITY_COMBAT from game-constants.js)
const resolveCityAttack = (att) => { ... };
```

### Battleship Bombardment

```javascript
function resolveBombardment(attacker, defender) {
  // ceil(strength * 0.5) rolls at BOMBARD_HIT_CHANCE (20%)
  // No counterattack - defender cannot fire back
  // Returns: { hits, defRem, defDead, rolls }
}
```

### Cargo Orphan Cleanup

When any unit is destroyed, all units aboard it are also removed:

```javascript
// Player combat (in handleMove):
newUnits = newUnits.filter(u => u.id !== deadId && u.aboardId !== deadId);

// AI combat (in ai-opponent.js handleCombat):
s.units = s.units.filter(x => x.id !== deadId && x.aboardId !== deadId);
```

This applies in: player attacking AI unit, AI attacking player unit, fuel crashes.

---

## Integration Point 5: Carrier Bonus

Carriers gain +1 attack and +1 defense die per 2 fighters aboard:

```javascript
if (att.carriesAir && allUnits.length > 0) {
  const fightersAboard = allUnits.filter(u => u.aboardId === attacker.id && u.type === 'fighter').length;
  const bonusDice = Math.floor(fightersAboard / 2);
  aRolls += bonusDice;
}
// Same for defender carrier
```

---

## Integration Point 6: AI Turn

```javascript
import { executeAITurn, recordPlayerObservations } from './ai-opponent.js';

const handleEndTurn = async () => {
  // 1. Record what AI saw during player's turn (observation symmetry)
  const updatedKnowledge = recordPlayerObservations(aiKnowledge, playerObservations);

  // 2. Process player end-of-turn (moves reset, production, healing)
  let newState = endPlayerTurn(gameState);

  // 3. Execute AI turn
  const { state: aiState, knowledge: newKnowledge, observations, combatEvents } =
    executeAITurn(newState, updatedKnowledge);

  // 4. Update AI knowledge and observations
  setAiKnowledge(newKnowledge);
  setAiObservations(observations);
  setAiCombatEvents(combatEvents);

  // 5. Check victory conditions
  const victory = checkVictoryCondition(aiState);
  if (victory.status !== 'playing') {
    setPhase(victory.status === 'victory' ? PHASE_VICTORY : PHASE_DEFEAT);
    setGameState(aiState);
    return;
  }

  // 6. Set up player's next turn
  setGameState(advanceToNextUnit(aiState));
};
```

---

## Integration Point 7: GoTo/Patrol Auto-movement

GoTo and Patrol execution uses a step-by-step system driven by React state:

```javascript
// Set GoTo destination
const handleSetGoto = (destX, destY) => {
  const path = findPath(activeUnit.x, activeUnit.y, destX, destY, activeUnit, gameState);
  if (path) {
    setGameState(setUnitGoTo(gameState, activeUnit.id, path));
    setAutoMovingUnitId(activeUnit.id);  // triggers auto-move loop
  }
};

// Each render tick: execute one step if auto-moving
// executeOneAutoMoveStep() handles: arrived, blocked, enemy contact
// On enemy contact, sets a message and stops auto-movement
```

Auto-move uses `findPath` to compute each step toward the current GoTo/Patrol waypoint. The step is validated against `getValidMoves` before execution. If blocked or an enemy is encountered, auto-movement stops and the player is notified.

---

## Integration Point 8: Bombardment Mode

```javascript
// Entering bombard mode (B key)
const handleBombardMode = () => {
  if (activeUnit?.type === 'battleship' && !activeUnit.hasBombarded) {
    setBombardMode(true);
  }
};

// Tile click in bombard mode
const handleBombard = (targetX, targetY) => {
  const target = bombardTargets.find(t => t.t === targetX && t.y === targetY);
  if (!target?.hasEnemy) return; // Only bombard tiles with enemies

  const result = resolveBombardment(activeUnit, target.enemyUnit);
  // Apply damage, mark hasBombarded: true, exit bombard mode
};
```

Bombard mode highlights range-2 tiles with enemies. Bombarding costs the unit's remaining moves (`movesLeft = 0`) and sets `hasBombarded = true` to prevent firing twice.

---

## Integration Point 9: City Production

City production is handled by `endPlayerTurn` in `game-state.js`. When a unit completes production, it spawns at the city tile. The player can set production via `CityProductionDialog` which calls `setCityProduction(gameState, cityKey, unitType)`.

---

## Integration Point 10: Save/Load

Save state is serialized to `localStorage` via `SaveGameDialog`. It stores `gameState`, `exploredTiles` (Set converted to array), and `aiKnowledge` (Sets converted to arrays). On load, arrays are converted back to Sets.

---

## Rendering

The viewport renders 24x18 tiles using absolutely-positioned divs. Units are rendered as `UnitSprite` components positioned by `(u.x - viewportX) * TILE_WIDTH, (u.y - viewportY) * TILE_HEIGHT`.

Per-tile stack counting determines the `stackCount` badge:

```javascript
const tileStack = {};
const tileTop = {};
for (const u of visibleUnits) {
  const k = `${u.x},${u.y}`;
  tileStack[k] = (tileStack[k] || 0) + 1;
  tileTop[k] = u.id;  // Last unit wins (active unit sorted last)
}
// stackCount is passed to the top unit only
<UnitSprite stackCount={tileTop[key] === u.id ? tileStack[key] : 0} />
```

AI observation trails from the previous AI turn are rendered as red SVG lines over the viewport.

---

## Error Handling

- All module calls are defensive: check for null `gameState`, null `activeUnit`, empty paths.
- AI result is validated before applying to state.
- If a path is not found, the operation is cancelled with a message to the player.
- Cargo orphan cleanup (`filter(u => u.aboardId !== deadId)`) prevents ghost units after any unit destruction.

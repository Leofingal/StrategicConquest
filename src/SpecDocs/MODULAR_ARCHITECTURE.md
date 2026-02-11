# Strategic Conquest - Modular Architecture

## Overview
Breaking the game into independent, testable modules to prevent context window overload and enable parallel development across threads.

## Current State Analysis
- **strategic-conquest-game.jsx**: 1000+ lines, contains everything
- **Problem**: Context window overload, difficult to debug, hard to iterate on AI
- **Solution**: Separate into 7-8 focused components with clear interfaces

---

## Module Breakdown

### 1. Core Game State (`game-state.js`)
**Responsibility**: Pure data structure and state transitions
**Size**: ~200 lines
**No dependencies on React or UI**

```javascript
// Public API
export function createGameState(mapConfig);
export function moveUnit(gameState, unitId, dx, dy);
export function endTurn(gameState);
export function updateFogOfWar(gameState, owner);
// etc.
```

**Contains**:
- Game state shape definition
- Pure state manipulation functions
- Victory/defeat condition checks
- Unit creation/destruction
- City production logic
- No UI logic, no AI logic

**Why separate**: Can be tested independently, used by both player and AI

---

### 2. Map Generator (`map-generator.js`)
**Status**: ✅ Already exists as standalone
**Responsibility**: Procedural map generation
**Size**: ~400 lines
**Dependencies**: None

**Integration point**:
```javascript
import { generateMap } from './map-generator.js';
const { map, width, height, cities } = generateMap(mapSize, terrain, difficulty);
```

**No changes needed** - already well-isolated

---

### 3. Combat Engine (`combat-engine.js`)
**Status**: ✅ Exists as simulator, needs adaptation
**Responsibility**: Resolve all combat calculations
**Size**: ~150 lines
**Dependencies**: game-state (for unit specs)

```javascript
// Public API
export function simulateCombat(attacker, defender, isFirstAttack);
export function resolveCityAttack(attacker);
export function calculateDamage(unit, target, modifiers);
```

**Contains**:
- Hit chance calculations
- Damage rolls
- Special unit rules (submarine stealth, carrier/battleship 50% rolls)
- Combat modifiers (naval vs land, bombard)

**Why separate**: Pure logic, easily testable, AI needs this too

---

### 4. Movement & Pathfinding (`movement-engine.js`)
**Responsibility**: All movement validation and pathfinding
**Size**: ~250 lines
**Dependencies**: game-state

```javascript
// Public API
export function getValidMoves(unit, gameState);
export function canStackAt(unit, x, y, gameState);
export function findPath(start, end, unit, gameState);
export function canEnterTerrain(unit, tile, gameState);
```

**Contains**:
- Movement validation rules
- Stacking rules
- A* pathfinding
- Boarding/disembarking logic
- Terrain accessibility checks

**Why separate**: AI needs this, complex logic, testable

---

### 5. AI Opponent (`ai-opponent.js`)
**Responsibility**: AI decision-making and turn execution
**Size**: ~300 lines
**Dependencies**: game-state, movement-engine, combat-engine

```javascript
// Public API
export function executeAITurn(gameState, aiExploredTiles);
export function setAIStrategy(strategy); // 'aggressive', 'defensive', 'balanced'
export function setAIDifficulty(level); // 1-10
```

**Contains**:
- Strategic decision making
- Target prioritization
- Unit micro-management
- Production decisions
- Exploration logic

**Configuration object**:
```javascript
const AI_CONFIG = {
  difficulty: 5,
  strategy: 'balanced',
  priorities: {
    captureNeutralCities: 0.8,
    explore: 0.5,
    defendCities: 0.7,
    attackPlayer: 0.3,
  },
  behavior: {
    retreatThreshold: 0.3, // retreat if strength < 30%
    aggressiveness: 0.5,
    productionBalance: { tanks: 0.4, naval: 0.3, air: 0.3 }
  }
};
```

**Why separate**: 
- Enables tuning without touching game logic
- Can be swapped/enhanced independently
- Easy to add difficulty levels
- Can add different AI personalities

---

### 6. Fog of War System (`fog-of-war.js`)
**Responsibility**: Visibility calculations and fog state
**Size**: ~100 lines
**Dependencies**: game-state

```javascript
// Public API
export function calculateVisibility(gameState, owner);
export function buildFogArray(width, height, explored, current);
export function updateExploredTiles(explored, newlyVisible);
```

**Contains**:
- Vision range calculations
- Fog state management (unexplored, explored, visible)
- Per-player explored tile tracking

**Why separate**: Both player and AI need this, clear responsibility

---

### 7. UI Components (`ui-components.jsx`)
**Responsibility**: Reusable UI elements
**Size**: ~300 lines
**Dependencies**: React only

```javascript
// Exports
export function Tile({ type, fogState, onClick, ... });
export function UnitSprite({ unit, isActive, ... });
export function MiniMap({ map, units, ... });
export function StatusPanel({ gameState });
export function CommandMenu({ onCommand, ... });
```

**Contains**:
- Tile rendering
- Unit sprites
- Mini-map
- Turn info panel
- Command buttons
- Reusable styled components

**Why separate**: Pure presentation, no game logic

---

### 8. Dialog Components (`dialog-components.jsx`)
**Responsibility**: Modal dialogs and overlays
**Size**: ~400 lines
**Dependencies**: React, ui-components

```javascript
// Exports
export function CityProductionDialog({ ... });
export function UnitViewDialog({ ... });
export function CityListDialog({ ... });
export function VictoryDialog({ ... });
export function DefeatDialog({ ... });
```

**Why separate**: Large but self-contained, not needed during gameplay

---

### 9. Main Game Orchestrator (`strategic-conquest-game.jsx`)
**Responsibility**: Coordinate all modules, handle user input, render
**Size**: ~400 lines
**Dependencies**: ALL of the above

```javascript
import { createGameState, moveUnit, endTurn } from './game-state.js';
import { executeAITurn } from './ai-opponent.js';
import { getValidMoves, findPath } from './movement-engine.js';
import { calculateVisibility } from './fog-of-war.js';
// etc.
```

**Contains**:
- React component lifecycle
- User input handling (keyboard, mouse)
- State management (useState, useEffect)
- Viewport scrolling
- Rendering coordination
- Mode management (goto, patrol)

**Why this stays large**: It's the glue, but now it's mostly orchestration

---

## Module Communication Pattern

```
User Input → Game Orchestrator
                ↓
         Game State ← AI Opponent
                ↓          ↓
         ┌──────┴──────────┴────────┐
         ↓         ↓         ↓       ↓
    Movement   Combat    Fog    Production
         ↓         ↓         ↓       ↓
         └─────────┴─────────┴───────┘
                    ↓
              UI Components
```

---

## Development Workflow

### Thread 1: Core Systems (this thread)
- Finalize architecture docs
- Create interface specifications
- Update Memory/Instructions

### Thread 2: Game State Module
- Implement game-state.js
- Pure functions, no UI
- Unit tests for state transitions

### Thread 3: AI Opponent Module
- Implement ai-opponent.js
- Use interface to game-state and movement-engine
- Configurable behavior parameters

### Thread 4: Integration
- Wire everything together in main orchestrator
- Test full game flow
- Debug interactions

---

## Benefits of This Architecture

1. **Context Window Management**: Each module fits comfortably in context
2. **Parallel Development**: Different threads can work on different modules
3. **Testing**: Each module can be tested independently
4. **AI Tuning**: Can modify AI without touching game logic
5. **Debugging**: Easier to isolate problems
6. **Reusability**: Modules can be used in other projects

---

## Migration Path from Current Code

1. Extract combat logic → combat-engine.js
2. Extract movement logic → movement-engine.js
3. Extract AI logic → ai-opponent.js
4. Extract fog logic → fog-of-war.js
5. Refactor game state → game-state.js
6. Split UI → ui-components.jsx + dialog-components.jsx
7. Slim down main file to orchestration only

---

## File Size Targets

| Module | Target Lines | Current Status |
|--------|--------------|----------------|
| game-state.js | ~200 | needs extraction |
| map-generator.js | ~400 | ✅ exists |
| combat-engine.js | ~150 | ✅ exists (needs adaptation) |
| movement-engine.js | ~250 | needs extraction |
| ai-opponent.js | ~300 | needs extraction + enhancement |
| fog-of-war.js | ~100 | needs extraction |
| ui-components.jsx | ~300 | needs extraction |
| dialog-components.jsx | ~400 | needs extraction |
| strategic-conquest-game.jsx | ~400 | needs refactoring |

**Total: ~2500 lines across 9 files** (currently 1000+ in one file)

---

## Next Steps

1. Review and approve this architecture
2. Create detailed interface specifications for each module
3. Prioritize which modules to build first
4. Update project Memory and Instructions

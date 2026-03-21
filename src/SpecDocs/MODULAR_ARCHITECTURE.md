# Strategic Conquest - Modular Architecture

## Overview

The game is a browser-based turn-based strategy game (React 19 + Vite, pure JavaScript/JSX). All game logic runs client-side across 18 source files (~11,300 lines total).

---

## Module Breakdown

### Core Game Flow

```
Player Input --> Game Orchestrator --> Pure State Functions --> React Re-render
                      |
                      v (on turn end)
                 AI Opponent
                 (orchestrator)
                      |
          +-----------+-----------+
          v           v           v
     City Mgr   Explore Mgr  Tactical Mgr
```

---

## Module List and Responsibilities

| Module | Lines | Role |
|--------|-------|------|
| `game-constants.js` | 305 | Single source of truth for constants, unit specs, game rules |
| `game-state.js` | 460 | Pure functional state management (immutable updates) |
| `movement-engine.js` | 491 | Pathfinding, movement validation, terrain rules, bombardment |
| `fog-of-war.js` | 167 | Visibility calculations (3x3 vision radius) |
| `map-generator.js` | 831 | Procedural island/terrain/city generation |
| `ai-helpers.js` | 610 | Shared AI utilities: geometry, pathfinding, combat eval, logging |
| `ai-opponent.js` | 1080 | AI turn orchestrator: knowledge, phases, movement execution |
| `ai-city-manager.js` | 182 | AI production decisions |
| `ai-exploration-manager.js` | 1025 | Scout assignments, island tracking, ferry invasions |
| `ai-tactical-manager.js` | 412 | Combat missions, threat detection, transport danger zones |
| `ui-components.jsx` | 845 | Tile, UnitSprite, MiniMap, TurnInfo, UnitInfoPanel, CommandMenu, overlays |
| `dialog-components.jsx` | 2500 | Modal dialogs (production, unit info, victory/defeat, save/load) |
| `sprite-config.js` | 334 | Sprite/tile image configuration with autotile infrastructure |
| `ui-symbols.js` | 42 | Unicode symbol constants (prevents encoding corruption) |
| `strategic-conquest-game-integrated.jsx` | 1852 | Main orchestrator: input handling, combat resolution, AI coordination, rendering |

---

## Dependency Graph

```
game-constants.js  (no dependencies)
        |
        +---> game-state.js
        +---> movement-engine.js
        +---> fog-of-war.js
        +---> map-generator.js
        |
        +---> ai-helpers.js -------> movement-engine.js, fog-of-war.js
        |
        +---> ai-city-manager.js --> ai-helpers.js
        +---> ai-exploration-manager.js --> ai-helpers.js, movement-engine.js, fog-of-war.js
        +---> ai-tactical-manager.js --> ai-helpers.js, movement-engine.js, fog-of-war.js
        +---> ai-opponent.js -------> ai-helpers.js, ai-city-manager.js,
        |                             ai-exploration-manager.js, ai-tactical-manager.js,
        |                             fog-of-war.js
        |
        +---> sprite-config.js
        +---> ui-symbols.js
        +---> ui-components.jsx ---> game-constants.js, sprite-config.js, ui-symbols.js
        +---> dialog-components.jsx --> game-constants.js, ui-symbols.js
        |
        +---> strategic-conquest-game-integrated.jsx  (imports ALL of the above)
```

---

## Key Conventions

- **Grid coordinates**: `map[y][x]` (row-major). City keys are `"x,y"` strings.
- **Viewport**: 24x18 tiles at 64x48 pixels (4:3 aspect ratio, 1536x864px total).
- **TILE_WIDTH=64, TILE_HEIGHT=48** — use these instead of the legacy `TILE_SIZE` alias for new code.
- **Unicode rule**: Never use literal Unicode characters in source. Always use `SYMBOLS.XXX` from `ui-symbols.js`.
- **State management**: All `game-state.js` functions are pure — they return new state objects.
- **Unit statuses**: R=Ready, W=Waiting, S=Sentry, P=Patrol, G=Goto, K=Skipped, U=Used, A=Aboard.
- **AI phases**: LAND -> TRANSITION -> NAVAL -> LATE_GAME, driven by exploration progress.
- **Sprites**: Dual rendering — image sprites at `/sprites/[unit]_[player|ai].png` with emoji fallback.

---

## Module Details

### `game-constants.js`
Single source of truth. Exports tile types, fog states, game phases, unit statuses, display settings, unit specs (`UNIT_SPECS`), combat constants, map/terrain/difficulty configs, and pure helper functions (`isCityTile`, `isFriendlyCity`, `isEnemyCity`, `isHostileCity`, `manhattanDistance`).

### `game-state.js`
Pure state management. Handles unit creation/destruction, city production/capture, turn transitions, victory/defeat checking, GoTo/Patrol setup, unit boarding/unloading. No UI or AI logic.

### `movement-engine.js`
Validates all unit movement, computes valid move lists, runs A* pathfinding, handles stacking rules, terrain checks, boarding/disembarking, refuel tile detection, and bombardment target calculation. Exports include `getBombardTargets` (battleship range-2 Chebyshev targeting) and `findPath` with optional `tileCostFn` parameter.

### `fog-of-war.js`
Calculates currently visible tiles per player (3x3 vision radius), builds 2D fog arrays for rendering, merges explored tile sets.

### `map-generator.js`
Procedural map generation: island shapes, terrain distribution, city placement. Uses map size and terrain type as inputs.

### `ai-helpers.js`
Shared utilities for all AI managers. Contains phase constants, target distributions, AI configuration (`AI_CONFIG`), geometry helpers (`findNearest`, `floodFillLand`, `floodFillExploredLand`), A*-based `getMoveToward` with optional `avoidTiles` parameter, deep-scout targeting, and the EV-based `evaluateCombat` function.

### `ai-opponent.js`
Main AI orchestrator. Manages AI knowledge state, phase transitions, unit allocation to managers, step-by-step movement execution with immediate reactions (fuel, capture, combat), and cargo orphan cleanup on unit death. External API: `executeAITurn`, `createAIKnowledge`, `createAIKnowledgeFromState`, `recordPlayerObservations`.

### `ai-city-manager.js`
Production decisions. Uses phase-based target distributions. Never switches production mid-build (progress > 0). Counts fractional in-progress builds to prevent all cities building the same unit type.

### `ai-exploration-manager.js`
Assigns exploration missions: deep-scout sectors, follow island coastlines, ferry invasions, stage tanks at coastal cities. Tracks and merges partial island knowledge.

### `ai-tactical-manager.js`
Assigns combat missions: hunt player transports, escort AI transports, defend threatened cities, patrol areas. Computes naval danger zones (`getNavalDangerZone`) used by transports for threat-aware pathfinding.

### `ui-components.jsx`
Pure presentation components: `Tile`, `UnitSprite` (with `stackCount` amber badge), `MiniMap`, `TurnInfo`, `UnitInfoPanel`, `CommandMenu`, `GotoLineOverlay`, `PatrolOverlay`. Imports from `sprite-config.js` for dual image/emoji rendering.

### `dialog-components.jsx`
Modal dialogs: `CityProductionDialog`, `UnitViewDialog`, `CityListDialog`, `AllUnitsListDialog`, `PatrolConfirmDialog`, `VictoryDialog`, `DefeatDialog`, `AITurnSummaryDialog`, `SurrenderDialog`, `SaveGameDialog`, `LoadGameDialog`.

### `sprite-config.js`
Sprite/tile configuration. `USE_IMAGE_SPRITES` toggles image vs. emoji fallback. Includes autotile infrastructure (`USE_AUTOTILES`) for water edge transitions. Exports `getUnitSpriteSrc`, `getTileImageSrc`, `getTileColor`, `getWaterTileSrc`.

### `strategic-conquest-game-integrated.jsx`
Main orchestrator (1852 lines). Contains combat functions inline (`simulateCombat`, `resolveCombat`, `resolveCityAttack`, `resolveBombardment`), MenuScreen, and the primary game React component. Handles all user input, viewport management, GoTo/Patrol auto-movement, AI turn execution, save/load, and rendering.

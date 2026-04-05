# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev        # Start Vite dev server with HMR
npm run build      # Production build to dist/
npm run lint       # ESLint (React hooks + refresh plugins)
npm run preview    # Preview production build locally
```

No formal test runner is configured. `src/test-modules.js` provides manual/console-based unit test utilities.

## Architecture Overview

This is a browser-based turn-based strategy game (React 19 + Vite, pure JavaScript/JSX, no TypeScript). The entire game runs client-side with ~11,300 lines across 18 source files.

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

### Module Responsibilities

| Module | Role |
|--------|------|
| `game-constants.js` | Single source of truth for all constants, unit specs, game rules |
| `game-state.js` | Pure functional state management (immutable updates, no side effects) |
| `movement-engine.js` | Pathfinding, movement validation, terrain rules |
| `fog-of-war.js` | Visibility calculations (3x3 vision radius) |
| `map-generator.js` | Procedural island/terrain/city generation |
| `strategic-conquest-game-integrated.jsx` | Main orchestrator component - input handling, combat resolution, AI coordination, rendering |
| `ai-opponent.js` | AI turn orchestrator with knowledge system and mission execution |
| `ai-helpers.js` | Shared AI utilities, logging, constants |
| `ai-city-manager.js` | AI production decisions |
| `ai-exploration-manager.js` | Scout assignments, island tracking |
| `ai-tactical-manager.js` | Combat missions, threat detection |
| `ui-components.jsx` | Tile, unit sprite, minimap, panels |
| `dialog-components.jsx` | Modal dialogs (production, unit info, victory/defeat) |
| `sprite-config.js` | Sprite/tile image configuration with emoji fallback |
| `ui-symbols.js` | Unicode symbol constants |

### Key Conventions

- **Grid coordinates**: `map[y][x]` (row-major). City keys are `"x,y"` strings.
- **Viewport**: 24x18 tiles at 64x48 pixels (4:3 aspect ratio).
- **Unicode rule**: Never use literal Unicode characters in source. Always use `SYMBOLS.XXX` constants from `ui-symbols.js` to prevent encoding corruption.
- **State management**: All game state functions in `game-state.js` are pure - they return new state objects without side effects.
- **Unit statuses**: R=Ready, W=Waiting, S=Sentry, P=Patrol, G=Goto, K=Skipped, U=Used, A=Aboard.
- **AI phases**: LAND -> TRANSITION -> NAVAL -> LATE_GAME, determined by exploration progress.
- **AI mission system**: Units are assigned missions (exploration, tactical, combat, escort, defense) and execute step-by-step with real-time reactions.
- **Constants**: All shared constants and unit specs live in `game-constants.js`. Import from there, never hardcode game values.
- **Sprites**: Dual rendering - image sprites at `/sprites/[unit]_[player|ai].png` with emoji fallback.

### Combat System

Combat is resolved in `strategic-conquest-game-integrated.jsx` (top of file). Key rules:
- Carrier bonus: +1 attack/defense die per 2 fighters aboard
- Submarine stealth: 4x damage when attacking, detected by destroyers
- Battleships: range-2 bombardment, half-strength in direct combat
- Carriers: half-strength in direct combat

## Collaboration Workflow

For incremental adjustments and subtle behavioral changes (as opposed to clear bugs or new features), Claude should **propose the approach and wait for approval before writing code**. This applies when:
- The change affects AI decision-making or priority ordering
- Multiple valid interpretations of the request exist
- The fix requires restructuring existing logic rather than a targeted addition

For clear bugs (crashes, wrong values, missing guards), implement directly. For everything else, describe the proposed change in plain terms first.

## Documentation

Detailed architecture docs live in `src/SpecDocs/` covering modular architecture, AI manager design, module interfaces, combat rules, sprite integration, and UI component usage.

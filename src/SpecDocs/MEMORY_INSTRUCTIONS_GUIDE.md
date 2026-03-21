# Memory and Instructions Guide

## Purpose

This document describes the current project structure, coding conventions, and development guidelines for working on Strategic Conquest. It is intended to be read at the start of any development session.

---

## Project Overview

Strategic Conquest is a browser-based turn-based strategy game built with React 19 + Vite (pure JavaScript/JSX, no TypeScript). All game logic runs client-side.

**Build commands:**
```bash
npm run dev      # Vite dev server with HMR
npm run build    # Production build to dist/
npm run lint     # ESLint
npm run preview  # Preview production build
```

---

## Architecture

The game is divided into focused modules. Key files:

| File | Role |
|------|------|
| `game-constants.js` | All constants, unit specs, game rules |
| `game-state.js` | Pure functional state management |
| `movement-engine.js` | Pathfinding, movement validation, bombardment |
| `fog-of-war.js` | Visibility calculations |
| `map-generator.js` | Procedural map generation |
| `ai-helpers.js` | Shared AI utilities, EV combat model |
| `ai-opponent.js` | AI turn orchestrator |
| `ai-city-manager.js` | AI production decisions |
| `ai-exploration-manager.js` | AI scout/ferry missions |
| `ai-tactical-manager.js` | AI combat/threat missions |
| `ui-components.jsx` | Tile, UnitSprite, MiniMap, panels |
| `dialog-components.jsx` | Modal dialogs |
| `sprite-config.js` | Sprite/tile rendering configuration |
| `ui-symbols.js` | Unicode symbol constants |
| `strategic-conquest-game-integrated.jsx` | Main orchestrator (combat inline) |

See `MODULAR_ARCHITECTURE.md` for line counts and dependency graph.

---

## Critical Conventions

### 1. Unicode Rule (Non-negotiable)

Never use literal Unicode characters in source files. Always use `SYMBOLS.XXX` from `ui-symbols.js`:

```javascript
import { SYMBOLS } from './ui-symbols.js';
// GOOD:
<button>{SYMBOLS.CLOSE}</button>
// BAD — will get corrupted:
<button>×</button>
```

### 2. Grid Coordinates

- Map is accessed as `map[y][x]` (row-major)
- City keys are `"x,y"` strings
- Viewport: 24x18 tiles at 64x48 pixels

### 3. Tile Dimensions

```javascript
// GOOD (new code):
left: vx * TILE_WIDTH, top: vy * TILE_HEIGHT

// AVOID (legacy):
left: vx * TILE_SIZE  // TILE_SIZE is an alias for TILE_WIDTH only
```

### 4. State Management

All `game-state.js` functions are pure — they take a state object and return a new one. No mutation, no side effects. The main component calls these and uses `setGameState()`.

### 5. Constants Source of Truth

Import all constants from `game-constants.js`. Never hardcode unit specs, combat values, map sizes, or game rules in component files.

### 6. Unit Statuses

| Code | Meaning |
|------|---------|
| R | Ready |
| W | Waiting |
| S | Sentry |
| P | Patrol |
| G | Goto |
| K | Skipped |
| U | Used |
| A | Aboard |

---

## Module Development Guidelines

### Before Writing Code

1. Read the relevant `SpecDocs/*.md` file for the module you're working on
2. Check `MODULE_INTERFACES.md` for the function signatures
3. Check `game-constants.js` for any relevant constants before adding new ones

### Module Independence

- Each module should import only from its documented dependencies
- `game-constants.js` has no dependencies and can be imported by anyone
- AI modules import from `ai-helpers.js`, not directly from each other
- UI components do not import from game-state, movement-engine, or AI modules

### When to Update Docs

- When adding or renaming exported functions: update `MODULE_INTERFACES.md`
- When the line count changes significantly: update `MODULAR_ARCHITECTURE.md`
- When combat rules change: update `COMBAT_INLINE_GUIDE.md`
- When AI behavior changes: update `AI_MANAGER_ARCHITECTURE.md` and `AI_OPPONENT_SPEC.md`

---

## AI Development Guidelines

1. The AI's external interface is fixed: `executeAITurn`, `createAIKnowledge`, `createAIKnowledgeFromState`, `recordPlayerObservations`
2. All combat evaluation uses the EV model in `evaluateCombat()` — do not add type-specific hardcoded fight decisions
3. Transport avoidance uses `getNavalDangerZone()` via `getMoveToward(unit, target, state, avoidTiles)` — the avoidTiles parameter is the correct hook
4. When any unit is destroyed: always filter `u.aboardId !== deadId` to clean up cargo orphans
5. Naval units cannot advance onto non-water tiles unless it's a friendly city (carrier fix)

---

## Combat Development Guidelines

1. Combat is inline in `strategic-conquest-game-integrated.jsx` — there is no separate combat module
2. All three forms must stay in sync: `simulateCombatWithDefender` (player), `handleCombat` (AI in ai-opponent.js), and `resolveBombardment` (bombardment)
3. Carrier fighter bonus: `+1 die per 2 fighters aboard`, applied to both attacker and defender
4. Cargo orphan cleanup is required everywhere a unit can be destroyed

---

## Testing

No formal test runner. `src/test-modules.js` provides manual/console-based utilities.

For quick combat verification: open browser console and call the inline functions directly with test unit objects.

---

## File Management

- Design docs: `src/SpecDocs/` — keep accurate and current
- Implementation: `src/` — source of truth; docs must match implementation
- Public assets: `public/sprites/` — PNG files for sprites

When the implementation diverges from docs, the implementation wins. Update the docs.

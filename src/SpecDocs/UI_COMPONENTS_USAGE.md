# UI Components - Usage Guide

## Overview

This document covers the components exported from `ui-components.jsx` and `dialog-components.jsx`.

**Files:**
- `ui-components.jsx` (~845 lines) — Pure presentation components
- `dialog-components.jsx` (~2500 lines) — Modal dialog components

---

## Imports

```javascript
import {
  Tile,
  UnitSprite,
  MiniMap,
  TurnInfo,
  UnitInfoPanel,
  CommandMenu,
  GotoLineOverlay,
  PatrolOverlay,
  DEFAULT_SPRITE_CONFIG,
  DEFAULT_TILE_CONFIG
} from './ui-components.jsx';

import {
  CityProductionDialog,
  UnitViewDialog,
  CityListDialog,
  AllUnitsListDialog,
  PatrolConfirmDialog,
  SurrenderDialog,
  VictoryDialog,
  DefeatDialog,
  AITurnSummaryDialog,
  SaveGameDialog,
  LoadGameDialog,
  getSavedGames
} from './dialog-components.jsx';

import {
  WATER, LAND, PLAYER_CITY, AI_CITY, NEUTRAL_CITY,
  FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE,
  COLORS, TILE_WIDTH, TILE_HEIGHT
} from './game-constants.js';
```

---

## Component Reference

### 1. Tile

Renders a single 64x48 map tile with optional overlays.

```javascript
<Tile
  type={WATER}
  fogState={FOG_VISIBLE}
  x={10}
  y={5}
  isValidMove={true}
  isAttack={false}
  isPath={false}
  isPatrolWaypoint={false}
  onClick={() => handleTileClick(10, 5)}
  onDoubleClick={() => handleDoubleClick(10, 5)}
  onMouseEnter={() => handleHover(10, 5)}
  style={{ position: 'absolute', left: vx * TILE_WIDTH, top: vy * TILE_HEIGHT }}
  map={gameState.map}  // Optional: enables autotile water edges
/>
```

**Props:**
- `type` — Tile type constant (WATER, LAND, PLAYER_CITY, AI_CITY, NEUTRAL_CITY)
- `fogState` — FOG_UNEXPLORED, FOG_EXPLORED, or FOG_VISIBLE
- `x`, `y` — Grid coordinates (used for checkerboard shading and autotile)
- `isValidMove` — Highlights as valid move (also used for bombard targets)
- `isAttack` — Highlights as attack target (red border instead of gold)
- `isPath` — Shows GoTo path dot
- `isPatrolWaypoint` — Shows patrol waypoint marker
- `style` — Applied to the outer div (used for absolute positioning in the viewport)
- `tileConfig` — Override tile rendering (default: `DEFAULT_TILE_CONFIG`)
- `map` — Optional full map array, required for autotile water edge detection

Checkerboard shading is applied via CSS `filter: brightness(1.15)` for `(x + y) % 2 === 1` tiles.

---

### 2. UnitSprite

Renders a unit with health, cargo count, and stack count indicators.

```javascript
<UnitSprite
  unit={unit}
  isActive={unit.id === activeUnitId}
  blink={blink}
  onClick={() => handleUnitClick(unit.id)}
  cargoCount={getCargoCount(unit.id, gameState.units)}
  stackCount={tileStack[`${unit.x},${unit.y}`]}
/>
```

**Props:**
- `unit` — Unit object
- `isActive` — Whether this is the active unit (highlights with blink effect)
- `blink` — Boolean toggle for the blink animation (from `setInterval`)
- `cargoCount` — Number shown as blue badge (top-left). Pass units-aboard count for carriers/transports.
- `stackCount` — Number shown as amber badge (top-right). Only shown when `stackCount > 1`. Should be passed only for the topmost unit on the tile (see render loop below).
- `isAboard` — Smaller, semi-transparent rendering for units shown aboard a carrier
- `spriteConfig` — Override sprite rendering (default: `DEFAULT_SPRITE_CONFIG`)

**Badge placement:**
- Bottom-right (red): current strength when damaged
- Top-left (blue): cargo count (units aboard this transport/carrier)
- Top-right (amber): stack count (total friendly units on this tile, shown only when > 1)

**Stack count render pattern (from main game):**

```javascript
// Per-tile stack counts
const tileStack = {};
const tileTop = {};
for (const u of visibleUnits) {
  const k = `${u.x},${u.y}`;
  tileStack[k] = (tileStack[k] || 0) + 1;
  tileTop[k] = u.id;  // Last in sort order = drawn on top
}

// Render: pass stackCount only to the top unit on each tile
<UnitSprite
  unit={u}
  cargoCount={getCargoCount(u.id, gameState.units)}
  stackCount={tileTop[`${u.x},${u.y}`] === u.id ? tileStack[`${u.x},${u.y}`] : 0}
/>
```

---

### 3. TurnInfo

Left sidebar panel with turn info and action buttons.

```javascript
<TurnInfo
  turn={gameState.turn}
  phase={phase}
  unitsWaiting={unitsWaiting}
  playerCities={cityCounts.player}
  aiCities={cityCounts.ai}
  neutralCities={cityCounts.neutral}
  onEndTurn={handleEndTurn}
  onShowCityList={() => setShowCityList(true)}
  onShowAllUnits={() => setShowAllUnits(true)}
  onShowAiSummary={() => setShowAiSummary(true)}
  onSaveGame={handleSaveGame}
  hasAiObservations={aiObservations.length > 0 || aiCombatEvents.length > 0}
/>
```

---

### 4. UnitInfoPanel

Left sidebar panel showing the active unit's stats.

```javascript
<UnitInfoPanel
  unit={activeUnit}
  units={gameState.units}
  gameState={gameState}
/>
```

Shows unit type, owner, strength, fuel, status, and cargo contents if a carrier/transport.

---

### 5. CommandMenu

Left sidebar panel with command buttons.

```javascript
<CommandMenu
  activeUnit={activeUnit}
  onCommand={cmd => {
    const map = { wait: 'w', skip: 'k', next: 'n', sentry: 's', goto: 'g', patrol: 'p', unload: 'u', bombard: 'b' };
    if (map[cmd]) window.dispatchEvent(new KeyboardEvent('keydown', { key: map[cmd] }));
  }}
  disabled={!activeUnit || !!autoMovingUnitId}
  patrolMode={patrolMode}
  bombardMode={bombardMode}
/>
```

The `bombard` command is only shown when the active unit has `canBombard: true` (battleships).

---

### 6. MiniMap

Clickable mini-map for navigation.

```javascript
<MiniMap
  map={gameState.map}
  fog={fog}
  units={gameState.units}
  width={gameState.width}
  height={gameState.height}
  viewportX={viewportX}
  viewportY={viewportY}
  onNavigate={(x, y) => {
    setViewportX(Math.max(0, Math.min(gameState.width - VIEWPORT_TILES_X, x)));
    setViewportY(Math.max(0, Math.min(gameState.height - VIEWPORT_TILES_Y, y)));
  }}
  exploredPercent={exploredPercent}
/>
```

---

### 7. GotoLineOverlay

SVG line overlay showing GoTo path preview.

```javascript
{(gotoMode || dragging) && previewTarget && activeUnit && gotoPreview && (
  <GotoLineOverlay
    sx={getUnitLocation(activeUnit, gameState.units).x}
    sy={getUnitLocation(activeUnit, gameState.units).y}
    ex={previewTarget.x}
    ey={previewTarget.y}
    vx={viewportX}
    vy={viewportY}
    dist={gotoPreview.dist}
    turns={gotoPreview.turns}
  />
)}
```

---

### 8. PatrolOverlay

SVG overlay showing patrol waypoints and connecting lines.

```javascript
{patrolMode && patrolWaypoints.length > 0 && (
  <PatrolOverlay
    waypoints={patrolWaypoints}
    vx={viewportX}
    vy={viewportY}
  />
)}
```

---

## Dialog Reference

### CityProductionDialog

```javascript
{showCityDialog && (
  <CityProductionDialog
    city={gameState.cities[showCityDialog]}
    cityKey={showCityDialog}
    map={gameState.map}
    width={gameState.width}
    height={gameState.height}
    units={gameState.units}
    fogArray={fog}
    onClose={() => setShowCityDialog(null)}
    onSetProduction={(ck, unitType) => setGameState(setCityProduction(gameState, ck, unitType))}
    onMakeActive={handleMakeActive}
  />
)}
```

### UnitViewDialog

Shows all units stacked at a tile. Clicking a unit makes it active.

```javascript
{showUnitView && (
  <UnitViewDialog
    x={showUnitView.x}
    y={showUnitView.y}
    map={gameState.map}
    width={gameState.width}
    height={gameState.height}
    units={gameState.units}
    fogArray={fog}
    onClose={() => setShowUnitView(null)}
    onMakeActive={handleMakeActive}
  />
)}
```

### CityListDialog / AllUnitsListDialog

Navigation dialogs. CityListDialog shows all player cities; AllUnitsListDialog shows all player units.

### PatrolConfirmDialog

```javascript
{showPatrolConfirm && (
  <PatrolConfirmDialog
    waypoints={patrolWaypoints}
    segmentDistances={patrolDistances}  // Distances computed by calcPatrolDists()
    onConfirm={handleConfirmPatrol}
    onCancel={() => { setShowPatrolConfirm(false); setPatrolMode(false); setPatrolWaypoints([]); }}
  />
)}
```

### AITurnSummaryDialog

Shows AI unit movements (red trails) and combat events from the previous AI turn.

```javascript
{showAiSummary && (aiObservations.length > 0 || aiCombatEvents.length > 0) && (
  <AITurnSummaryDialog
    observations={aiObservations}
    combatEvents={aiCombatEvents}
    onContinue={() => setShowAiSummary(false)}
    onCenterOn={(pos) => { setViewportX(...); setViewportY(...); }}
  />
)}
```

### SaveGameDialog / LoadGameDialog

```javascript
{showSaveDialog && (
  <SaveGameDialog
    gameState={gameState}
    exploredTiles={exploredTiles}
    aiKnowledge={aiKnowledge}
    onSave={handleSaveComplete}
    onSaveAndQuit={handleSaveAndQuit}
    onClose={() => setShowSaveDialog(false)}
  />
)}
```

`getSavedGames()` returns an array of save slots (null if empty).

### VictoryDialog / DefeatDialog

```javascript
{phase === PHASE_VICTORY && (
  <VictoryDialog
    turn={gameState.turn}
    mapSize={gameState.mapSize}
    difficulty={gameState.difficulty}
    onNewGame={() => { setPhase(PHASE_MENU); setGameState(null); }}
  />
)}

{phase === PHASE_DEFEAT && (
  <DefeatDialog onNewGame={() => { setPhase(PHASE_MENU); setGameState(null); }} />
)}
```

VictoryDialog saves the score to `localStorage` leaderboard.

---

## Swapping Art Assets

To use custom images instead of the default emoji/letter sprites:

### Step 1: Provide image sprites
Place PNG files in `public/sprites/` following the naming convention:
- Unit sprites: `[unittype]_player.png`, `[unittype]_ai.png` (64x48px)
- Terrain tiles: `water.png`, `land.png`, `player_city.png`, `ai_city.png`, `neutral_city.png`

### Step 2: Enable image sprites
In `sprite-config.js`:
```javascript
export const USE_IMAGE_SPRITES = true;
```

### Step 3: (Optional) Enable autotile water edges
```javascript
export const USE_AUTOTILES = true;
// Then provide water_N.png, water_NE.png, etc. transition tiles
```

---

## Dependencies

**`ui-components.jsx`:**
- React
- `./game-constants.js`
- `./sprite-config.js`
- `./ui-symbols.js`

**`dialog-components.jsx`:**
- React
- `./game-constants.js`
- `./ui-symbols.js`
- `localStorage` (for leaderboard and save/load)

No circular dependencies. Both files are independent modules.

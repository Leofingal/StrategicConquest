# UI Components - Usage Guide

## Overview

This document provides usage examples for the extracted UI components from Strategic Conquest. 

**Files Created:**
- `ui-components.jsx` (662 lines) - Pure presentation components
- `dialog-components.jsx` (985 lines) - Modal dialog components

## Line Count Notes

Both files exceed initial targets but this is justified:
1. **Extensive JSDoc documentation** - Essential for maintainability
2. **External sprite/tile configuration** - Critical user requirement
3. **Proper inline styling** - Matches original format
4. **Helper functions** - Included locally to maintain module independence

Per QUICK_REFERENCE.md: "Module line counts can exceed targets if functionality justifies it"

---

## Basic Imports

```javascript
// Import UI components
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

// Import dialog components
import { 
  CityProductionDialog, 
  UnitViewDialog, 
  CityListDialog, 
  PatrolConfirmDialog, 
  SurrenderDialog, 
  VictoryDialog, 
  DefeatDialog 
} from './dialog-components.jsx';

// Import constants (both files need this)
import { 
  WATER, LAND, PLAYER_CITY, AI_CITY, NEUTRAL_CITY,
  FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE,
  COLORS, TILE_SIZE
} from './game-constants.js';
```

---

## Component Usage Examples

### 1. Tile Component

**Basic usage:**
```javascript
<Tile 
  type={WATER} 
  fogState={FOG_VISIBLE} 
  x={10} 
  y={5} 
  onClick={() => handleTileClick(10, 5)} 
/>
```

**With overlays:**
```javascript
<Tile 
  type={LAND} 
  fogState={FOG_VISIBLE} 
  x={10} 
  y={5} 
  isValidMove={true}
  isAttack={false}
  isPath={false}
  onClick={() => handleMove(10, 5)} 
  onDoubleClick={() => handleDoubleClick(10, 5)}
/>
```

**With custom tile images:**
```javascript
const CUSTOM_TILE_CONFIG = {
  [WATER]: { type: 'image', src: '/assets/tiles/water.png' },
  [LAND]: { type: 'image', src: '/assets/tiles/grass.png' },
  [PLAYER_CITY]: { type: 'image', src: '/assets/tiles/city-blue.png' },
  [AI_CITY]: { type: 'image', src: '/assets/tiles/city-red.png' },
  [NEUTRAL_CITY]: { type: 'image', src: '/assets/tiles/city-gray.png' },
};

<Tile 
  type={WATER} 
  fogState={FOG_VISIBLE} 
  x={10} 
  y={5} 
  tileConfig={CUSTOM_TILE_CONFIG}
  onClick={() => handleTileClick(10, 5)} 
/>
```

### 2. UnitSprite Component

**Basic usage:**
```javascript
<UnitSprite 
  unit={unit} 
  isActive={unit.id === activeUnitId} 
  onClick={() => handleUnitClick(unit.id)} 
/>
```

**With cargo count:**
```javascript
const cargoCount = gameState.units.filter(u => u.aboardId === carrier.id).length;

<UnitSprite 
  unit={carrier} 
  isActive={true} 
  cargoCount={cargoCount}
  onClick={() => handleUnitClick(carrier.id)} 
/>
```

**With custom sprites:**
```javascript
const CUSTOM_SPRITE_CONFIG = {
  tank: { type: 'image', src: '/assets/sprites/tank.png', width: 32, height: 32 },
  fighter: { type: 'image', src: '/assets/sprites/fighter.png', width: 32, height: 32 },
  bomber: { type: 'image', src: '/assets/sprites/bomber.png', width: 32, height: 32 },
  // ... etc for all unit types
};

<UnitSprite 
  unit={unit} 
  isActive={false}
  spriteConfig={CUSTOM_SPRITE_CONFIG}
  onClick={() => handleUnitClick(unit.id)} 
/>
```

### 3. TurnInfo Panel

```javascript
<TurnInfo 
  turn={gameState.turn}
  phase={phase}
  unitsWaiting={unitsWaiting}
  playerCities={playerCityCount}
  aiCities={aiCityCount}
  neutralCities={neutralCityCount}
  onEndTurn={handleEndTurn}
  onShowCityList={() => setShowCityList(true)}
/>
```

### 4. UnitInfoPanel

```javascript
const activeUnit = gameState.units.find(u => u.id === activeUnitId);

<UnitInfoPanel 
  unit={activeUnit}
  units={gameState.units}
  gameState={gameState}
/>
```

### 5. CommandMenu

```javascript
<CommandMenu 
  activeUnit={activeUnit}
  onCommand={handleCommand}
  disabled={!activeUnit || activeUnit.movesLeft === 0}
  patrolMode={patrolMode}
/>
```

### 6. MiniMap

```javascript
<MiniMap 
  map={gameState.map}
  fog={fogArray}
  units={gameState.units}
  width={gameState.width}
  height={gameState.height}
  viewportX={viewportX}
  viewportY={viewportY}
  onNavigate={(x, y) => {
    setViewportX(Math.max(0, Math.min(x, gameState.width - VIEWPORT_TILES_X)));
    setViewportY(Math.max(0, Math.min(y, gameState.height - VIEWPORT_TILES_Y)));
  }}
/>
```

### 7. GotoLineOverlay

```javascript
{activeUnit && activeUnit.gotoPath && activeUnit.gotoPath.length > 0 && (
  <GotoLineOverlay 
    sx={activeUnit.x}
    sy={activeUnit.y}
    ex={activeUnit.gotoPath[activeUnit.gotoPath.length - 1].x}
    ey={activeUnit.gotoPath[activeUnit.gotoPath.length - 1].y}
    vx={viewportX}
    vy={viewportY}
    dist={activeUnit.gotoPath.length}
    turns={Math.ceil(activeUnit.gotoPath.length / UNIT_SPECS[activeUnit.type].movement)}
  />
)}
```

### 8. PatrolOverlay

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

## Dialog Component Usage

### 1. CityProductionDialog

```javascript
{showCityDialog && (
  <CityProductionDialog 
    city={gameState.cities[showCityDialog]}
    cityKey={showCityDialog}
    map={gameState.map}
    width={gameState.width}
    height={gameState.height}
    units={gameState.units}
    onClose={() => setShowCityDialog(null)}
    onSetProduction={(cityKey, unitType) => {
      // Update city production
      setGameState(prev => ({
        ...prev,
        cities: {
          ...prev.cities,
          [cityKey]: {
            ...prev.cities[cityKey],
            producing: unitType
          }
        }
      }));
    }}
    onMakeActive={(unitId) => {
      setActiveUnitId(unitId);
      const unit = gameState.units.find(u => u.id === unitId);
      if (unit) {
        // Center viewport on unit
        setViewportX(Math.max(0, unit.x - Math.floor(VIEWPORT_TILES_X / 2)));
        setViewportY(Math.max(0, unit.y - Math.floor(VIEWPORT_TILES_Y / 2)));
      }
    }}
  />
)}
```

### 2. UnitViewDialog

```javascript
{showUnitView && (
  <UnitViewDialog 
    x={showUnitView.x}
    y={showUnitView.y}
    map={gameState.map}
    width={gameState.width}
    height={gameState.height}
    units={gameState.units}
    onClose={() => setShowUnitView(null)}
    onMakeActive={(unitId) => {
      setActiveUnitId(unitId);
      setShowUnitView(null);
    }}
  />
)}
```

### 3. CityListDialog

```javascript
{showCityList && (
  <CityListDialog 
    cities={gameState.cities}
    units={gameState.units}
    onClose={() => setShowCityList(false)}
    onSelectCity={(x, y) => {
      // Center viewport on city
      setViewportX(Math.max(0, x - Math.floor(VIEWPORT_TILES_X / 2)));
      setViewportY(Math.max(0, y - Math.floor(VIEWPORT_TILES_Y / 2)));
      // Open city production dialog
      const cityKey = `${x},${y}`;
      if (gameState.cities[cityKey]) {
        setShowCityDialog(cityKey);
      }
    }}
  />
)}
```

### 4. PatrolConfirmDialog

```javascript
{showPatrolConfirm && (
  <PatrolConfirmDialog 
    waypoints={patrolWaypoints}
    onConfirm={() => {
      // Set patrol route on active unit
      setGameState(prev => ({
        ...prev,
        units: prev.units.map(u => 
          u.id === activeUnitId 
            ? { ...u, patrolPath: patrolWaypoints, status: STATUS_PATROL } 
            : u
        )
      }));
      setShowPatrolConfirm(false);
      setPatrolMode(false);
      setPatrolWaypoints([]);
    }}
    onCancel={() => {
      setShowPatrolConfirm(false);
      setPatrolMode(false);
      setPatrolWaypoints([]);
    }}
  />
)}
```

### 5. SurrenderDialog

```javascript
{showSurrender && (
  <SurrenderDialog 
    message={showSurrender}
    onYes={() => {
      setPhase(PHASE_DEFEAT);
      setShowSurrender(null);
    }}
    onNo={() => {
      setShowSurrender(null);
    }}
  />
)}
```

### 6. VictoryDialog

```javascript
{phase === PHASE_VICTORY && (
  <VictoryDialog 
    turn={gameState.turn}
    mapSize={gameState.mapSize}
    difficulty={gameState.difficulty}
    onNewGame={() => {
      // Reset to menu
      setPhase(PHASE_MENU);
      setGameState(null);
    }}
  />
)}
```

### 7. DefeatDialog

```javascript
{phase === PHASE_DEFEAT && (
  <DefeatDialog 
    onNewGame={() => {
      setPhase(PHASE_MENU);
      setGameState(null);
    }}
  />
)}
```

---

## Full Integration Example

Here's how the main game component would use these modules:

```javascript
import React, { useState, useEffect } from 'react';
import { 
  Tile, UnitSprite, MiniMap, TurnInfo, UnitInfoPanel, CommandMenu,
  GotoLineOverlay, PatrolOverlay, DEFAULT_SPRITE_CONFIG, DEFAULT_TILE_CONFIG
} from './ui-components.jsx';
import { 
  CityProductionDialog, UnitViewDialog, CityListDialog,
  PatrolConfirmDialog, SurrenderDialog, VictoryDialog, DefeatDialog
} from './dialog-components.jsx';
import { COLORS, TILE_SIZE, VIEWPORT_TILES_X, VIEWPORT_TILES_Y } from './game-constants.js';

function StrategicConquestGame() {
  const [gameState, setGameState] = useState(null);
  const [phase, setPhase] = useState('menu');
  const [viewportX, setViewportX] = useState(0);
  const [viewportY, setViewportY] = useState(0);
  const [activeUnitId, setActiveUnitId] = useState(null);
  const [fogArray, setFogArray] = useState([]);
  
  // Dialog states
  const [showCityDialog, setShowCityDialog] = useState(null);
  const [showUnitView, setShowUnitView] = useState(null);
  const [showCityList, setShowCityList] = useState(false);
  const [showPatrolConfirm, setShowPatrolConfirm] = useState(false);
  const [showSurrender, setShowSurrender] = useState(null);
  
  // Mode states
  const [patrolMode, setPatrolMode] = useState(false);
  const [patrolWaypoints, setPatrolWaypoints] = useState([]);
  
  if (phase === 'menu') {
    return <MenuScreen onStartGame={(config) => {
      // Initialize game...
    }} />;
  }
  
  const activeUnit = gameState?.units.find(u => u.id === activeUnitId);
  
  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: COLORS.background }}>
      {/* Main viewport */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: `repeat(${VIEWPORT_TILES_X}, ${TILE_SIZE}px)`,
          gap: 0 
        }}>
          {/* Render tiles */}
          {gameState.map.slice(viewportY, viewportY + VIEWPORT_TILES_Y).map((row, dy) =>
            row.slice(viewportX, viewportX + VIEWPORT_TILES_X).map((tile, dx) => {
              const x = viewportX + dx;
              const y = viewportY + dy;
              return (
                <Tile 
                  key={`${x}-${y}`}
                  type={tile}
                  fogState={fogArray[y][x]}
                  x={x}
                  y={y}
                  onClick={() => handleTileClick(x, y)}
                />
              );
            })
          )}
        </div>
        
        {/* Render units */}
        {gameState.units.map(unit => (
          <UnitSprite 
            key={unit.id}
            unit={unit}
            isActive={unit.id === activeUnitId}
            onClick={() => handleUnitClick(unit.id)}
          />
        ))}
        
        {/* Overlays */}
        {activeUnit?.gotoPath && (
          <GotoLineOverlay 
            sx={activeUnit.x}
            sy={activeUnit.y}
            ex={activeUnit.gotoPath[activeUnit.gotoPath.length - 1].x}
            ey={activeUnit.gotoPath[activeUnit.gotoPath.length - 1].y}
            vx={viewportX}
            vy={viewportY}
            dist={activeUnit.gotoPath.length}
            turns={Math.ceil(activeUnit.gotoPath.length / UNIT_SPECS[activeUnit.type].movement)}
          />
        )}
      </div>
      
      {/* Right sidebar */}
      <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
        <TurnInfo 
          turn={gameState.turn}
          phase={phase}
          unitsWaiting={unitsWaiting}
          playerCities={playerCityCount}
          aiCities={aiCityCount}
          neutralCities={neutralCityCount}
          onEndTurn={handleEndTurn}
          onShowCityList={() => setShowCityList(true)}
        />
        
        <UnitInfoPanel 
          unit={activeUnit}
          units={gameState.units}
          gameState={gameState}
        />
        
        <CommandMenu 
          activeUnit={activeUnit}
          onCommand={handleCommand}
          disabled={!activeUnit}
          patrolMode={patrolMode}
        />
        
        <MiniMap 
          map={gameState.map}
          fog={fogArray}
          units={gameState.units}
          width={gameState.width}
          height={gameState.height}
          viewportX={viewportX}
          viewportY={viewportY}
          onNavigate={(x, y) => {
            setViewportX(x);
            setViewportY(y);
          }}
        />
      </div>
      
      {/* Dialogs */}
      {showCityDialog && <CityProductionDialog {...} />}
      {showUnitView && <UnitViewDialog {...} />}
      {showCityList && <CityListDialog {...} />}
      {showPatrolConfirm && <PatrolConfirmDialog {...} />}
      {showSurrender && <SurrenderDialog {...} />}
      {phase === 'victory' && <VictoryDialog {...} />}
      {phase === 'defeat' && <DefeatDialog {...} />}
    </div>
  );
}
```

---

## Swapping Art Assets

To replace emojis with custom images:

### Step 1: Create sprite configuration
```javascript
const CUSTOM_SPRITES = {
  tank: { type: 'image', src: '/assets/sprites/tank.png', width: 32, height: 32 },
  fighter: { type: 'image', src: '/assets/sprites/fighter.png', width: 32, height: 32 },
  bomber: { type: 'image', src: '/assets/sprites/bomber.png', width: 32, height: 32 },
  transport: { type: 'image', src: '/assets/sprites/transport.png', width: 32, height: 32 },
  destroyer: { type: 'image', src: '/assets/sprites/destroyer.png', width: 32, height: 32 },
  submarine: { type: 'image', src: '/assets/sprites/submarine.png', width: 32, height: 32 },
  carrier: { type: 'image', src: '/assets/sprites/carrier.png', width: 32, height: 32 },
  battleship: { type: 'image', src: '/assets/sprites/battleship.png', width: 32, height: 32 },
};
```

### Step 2: Pass to components
```javascript
<UnitSprite 
  unit={unit} 
  isActive={false}
  spriteConfig={CUSTOM_SPRITES}
/>
```

### Step 3: Similarly for tiles
```javascript
const CUSTOM_TILES = {
  [WATER]: { type: 'image', src: '/assets/tiles/water.png' },
  [LAND]: { type: 'image', src: '/assets/tiles/land.png' },
  [PLAYER_CITY]: { type: 'image', src: '/assets/tiles/city-player.png' },
  [AI_CITY]: { type: 'image', src: '/assets/tiles/city-ai.png' },
  [NEUTRAL_CITY]: { type: 'image', src: '/assets/tiles/city-neutral.png' },
};

<Tile 
  type={tile}
  fogState={fog}
  x={x}
  y={y}
  tileConfig={CUSTOM_TILES}
/>
```

---

## Testing Notes

### Components Tested
âœ… **Tile** - Renders correctly with colors and fog states  
âœ… **UnitSprite** - Displays emoji sprites with health/cargo indicators  
âœ… **TurnInfo** - Buttons and counters work  
âœ… **UnitInfoPanel** - Shows unit stats correctly  
âœ… **CommandMenu** - All commands render, disabled states work  
âœ… **MiniMap** - Clickable navigation works  
âœ… **GotoLineOverlay** - SVG line renders  
âœ… **PatrolOverlay** - Waypoints and lines render  

âœ… **CityProductionDialog** - Radio selection, unit list, coastal check  
âœ… **UnitViewDialog** - Unit list with activate button  
âœ… **CityListDialog** - Scrollable city list  
âœ… **PatrolConfirmDialog** - Simple confirm/cancel  
âœ… **SurrenderDialog** - Yes/No buttons  
âœ… **VictoryDialog** - Leaderboard saves to localStorage  
âœ… **DefeatDialog** - Simple game over screen  

### Integration Testing Required
- [ ] Full game loop with extracted components
- [ ] External sprite/tile images loading
- [ ] Dialog state management in main game
- [ ] Performance with large maps (96x64+)
- [ ] Memory usage with many units

### Known Issues
None - all components are pure presentation with no game logic.

### Suggested Improvements
1. Add React.memo() to expensive components (MiniMap, Tile)
2. Consider virtual scrolling for large city/unit lists
3. Add loading states for external images
4. Add error boundaries around dialogs

---

## Dependencies

**ui-components.jsx:**
- React
- `./game-constants.js` - All constants

**dialog-components.jsx:**
- React (useState, useEffect)
- `./game-constants.js` - All constants
- localStorage (for leaderboard)

**No circular dependencies** - Both files are independent modules that only import from game-constants.js.

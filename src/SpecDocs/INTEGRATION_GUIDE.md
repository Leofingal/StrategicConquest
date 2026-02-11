# Module Integration Guide

## Purpose
Detailed guide for integrating all modules into the main game orchestrator. Shows data flow, event handling, and coordination between independent modules.

---

## High-Level Data Flow

```
User Input (keyboard/mouse)
         ↓
   Game Orchestrator (strategic-conquest-game.jsx)
         ↓
   ┌─────┴─────┐
   ↓           ↓
Game State   UI State
   ↓           ↓
   ├→ Movement Engine → Valid Moves
   ├→ Combat Engine → Battle Results  
   ├→ Fog of War → Visibility
   ├→ AI Opponent → AI Actions
   └→ Production → New Units
         ↓
   Updated State
         ↓
   UI Components (render)
```

---

## Main Game Structure

### State Management

```javascript
function StrategicConquestGame() {
  // Core game state
  const [gameState, setGameState] = useState(null);
  const [phase, setPhase] = useState(PHASE_MENU);
  
  // Viewport
  const [viewportX, setViewportX] = useState(0);
  const [viewportY, setViewportY] = useState(0);
  
  // Fog of war (player perspective)
  const [exploredTiles, setExploredTiles] = useState(() => new Set());
  const [turnVisibility, setTurnVisibility] = useState(() => new Set());
  
  // AI knowledge (separate fog)
  const [aiExplored, setAiExplored] = useState(() => new Set());
  const [aiKnowledge, setAiKnowledge] = useState(() => createAIKnowledge());
  
  // UI state
  const [message, setMessage] = useState('');
  const [showCityDialog, setShowCityDialog] = useState(null);
  const [gotoMode, setGotoMode] = useState(false);
  const [patrolMode, setPatrolMode] = useState(false);
  
  // ... rest of component
}
```

---

## Integration Point 1: Game Initialization

### Menu → New Game

```javascript
import { generateMap } from './map-generator.js';
import { createGameState } from './game-state.js';

const handleStartGame = (mapSize, terrain, difficulty) => {
  // 1. Generate map
  const mapData = generateMap(mapSize, terrain, difficulty);
  
  // 2. Create game state
  const state = createGameState(mapData, mapSize, terrain, difficulty);
  
  // 3. Initialize fog
  setExploredTiles(new Set());
  setTurnVisibility(new Set());
  setAiExplored(new Set());
  
  // 4. Initialize AI knowledge
  const aiVis = calculateVisibility(state, 'ai');
  setAiKnowledge(createAIKnowledge(aiVis));
  
  // 5. Center viewport on player starting city
  const playerCity = Object.values(state.cities).find(c => c.owner === 'player');
  if (playerCity) {
    setViewportX(Math.max(0, playerCity.x - VIEWPORT_TILES_X / 2));
    setViewportY(Math.max(0, playerCity.y - VIEWPORT_TILES_Y / 2));
  }
  
  // 6. Start game
  setGameState(state);
  setPhase(PHASE_PLAYING);
  setMessage('Turn 1: Explore and conquer!');
};
```

---

## Integration Point 2: Player Movement

### User Input → Movement Execution

```javascript
import { getValidMoves } from './movement-engine.js';
import { moveUnit } from './game-state.js';

// Calculate valid moves (computed every render for active unit)
const validMoves = useMemo(() => {
  if (!activeUnit || activeUnit.movesLeft <= 0) return [];
  return getValidMoves(activeUnit, gameState);
}, [activeUnit, gameState]);

// Handle keyboard movement
const handleMove = (dx, dy) => {
  if (!activeUnit) return;
  
  // Get unit's current location (might be aboard carrier)
  const pos = getUnitLocation(activeUnit, gameState);
  const targetX = pos.x + dx;
  const targetY = pos.y + dy;
  
  // Check if this move is valid
  const move = validMoves.find(m => m.x === targetX && m.y === targetY);
  if (!move) {
    setMessage('Invalid move.');
    return;
  }
  
  // Execute move (handles combat, boarding, etc.)
  const result = moveUnit(gameState, activeUnit.id, dx, dy);
  
  if (result.success) {
    setGameState(result.state);
    setMessage(result.message);
    
    // If unit destroyed, advance to next
    if (result.unitDestroyed) {
      const nextId = findNextUnit(result.state);
      setGameState(prev => ({ ...prev, activeUnitId: nextId }));
    }
  } else {
    setMessage(result.message);
  }
};

// Keyboard handler
useEffect(() => {
  const handleKeyDown = (e) => {
    const dir = DIRECTIONS[e.key]; // numpad keys
    if (dir) {
      e.preventDefault();
      handleMove(dir.dx, dir.dy);
    }
  };
  
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [handleMove]);
```

---

## Integration Point 3: Combat Resolution

### Movement with Attack → Combat Engine

```javascript
import { simulateCombat, resolveCityAttack } from './combat-engine.js';

// This happens inside game-state.js moveUnit() function
function executeMove(unit, targetX, targetY, move, gameState) {
  if (move.isAttack && move.isCity) {
    // Attacking city
    const result = resolveCityAttack(unit, gameState);
    
    if (result.cityDestroyed) {
      // Capture city
      const cityKey = `${targetX},${targetY}`;
      const newCities = { ...gameState.cities };
      newCities[cityKey] = {
        ...newCities[cityKey],
        owner: unit.owner,
        producing: 'tank',
        progress: {}
      };
      
      // Update map tile
      const newMap = gameState.map.map(row => [...row]);
      newMap[targetY][targetX] = unit.owner === 'player' ? PLAYER_CITY : AI_CITY;
      
      // Move unit to city
      const newUnits = gameState.units.map(u => 
        u.id === unit.id 
          ? { ...u, x: targetX, y: targetY, strength: result.attackerRemainingStrength, movesLeft: 0, status: STATUS_USED }
          : u
      );
      
      return {
        state: { ...gameState, map: newMap, cities: newCities, units: newUnits },
        message: 'City captured!',
        showCityDialog: true
      };
    } else {
      // Attack failed
      const newUnits = gameState.units.map(u =>
        u.id === unit.id
          ? { ...u, strength: result.attackerRemainingStrength, movesLeft: Math.max(0, u.movesLeft - 1) }
          : u
      );
      
      return {
        state: { ...gameState, units: newUnits },
        message: `Attack failed. Unit: ${result.attackerRemainingStrength}/${UNIT_SPECS[unit.type].strength}`
      };
    }
  }
  
  if (move.isAttack && !move.isCity) {
    // Attacking unit
    const enemyIdx = gameState.units.findIndex(u => 
      u.x === targetX && u.y === targetY && u.owner !== unit.owner
    );
    const enemy = gameState.units[enemyIdx];
    
    const result = simulateCombat(unit, enemy, gameState);
    
    let newUnits = [...gameState.units];
    
    // Update attacker
    const attackerIdx = newUnits.findIndex(u => u.id === unit.id);
    newUnits[attackerIdx] = {
      ...newUnits[attackerIdx],
      strength: result.attackerRemainingStrength,
      movesLeft: Math.max(0, newUnits[attackerIdx].movesLeft - 1)
    };
    
    if (result.defenderSurvived) {
      // Update defender
      newUnits[enemyIdx] = {
        ...newUnits[enemyIdx],
        strength: result.defenderRemainingStrength
      };
    } else {
      // Remove defender
      newUnits = newUnits.filter(u => u.id !== enemy.id);
      
      // Attacker moves into square if survived
      if (result.attackerSurvived) {
        const attackerIdx = newUnits.findIndex(u => u.id === unit.id);
        newUnits[attackerIdx] = {
          ...newUnits[attackerIdx],
          x: targetX,
          y: targetY
        };
      }
    }
    
    // Remove attacker if destroyed
    if (!result.attackerSurvived) {
      newUnits = newUnits.filter(u => u.id !== unit.id);
    }
    
    return {
      state: { ...gameState, units: newUnits },
      message: `Combat: Dealt ${result.damageToDefender}, took ${result.damageToAttacker}`,
      unitDestroyed: !result.attackerSurvived
    };
  }
  
  // Normal movement (no combat)
  // ... handle boarding, fuel, etc.
}
```

---

## Integration Point 4: Fog of War

### Every Turn → Update Visibility

```javascript
import { calculateVisibility, buildFogArray } from './fog-of-war.js';

// Calculate current visibility (memoized)
const currentVisibility = useMemo(() => 
  gameState ? calculateVisibility(gameState, 'player') : new Set(),
  [gameState]
);

// Build fog array for rendering
const fog = useMemo(() => 
  gameState 
    ? buildFogArray(gameState.width, gameState.height, exploredTiles, currentVisibility, turnVisibility)
    : [],
  [gameState, exploredTiles, currentVisibility, turnVisibility]
);

// Update turn visibility as units move
useEffect(() => {
  if (!gameState) return;
  
  // Add currently visible tiles to turn visibility
  setTurnVisibility(prev => {
    const newSet = new Set(prev);
    currentVisibility.forEach(tile => newSet.add(tile));
    return newSet;
  });
}, [currentVisibility, gameState]);

// On end turn, merge into explored tiles
const handleEndTurn = () => {
  // Merge turn visibility into permanent explored
  setExploredTiles(prev => {
    const newSet = new Set(prev);
    turnVisibility.forEach(tile => newSet.add(tile));
    currentVisibility.forEach(tile => newSet.add(tile));
    return newSet;
  });
  
  // Clear turn visibility
  setTurnVisibility(new Set());
  
  // ... rest of end turn logic
};
```

---

## Integration Point 5: AI Turn

### Player End Turn → AI Execution → Player Turn

```javascript
import { executeAITurn } from './ai-opponent.js';
import { endPlayerTurn } from './game-state.js';

const handleEndTurn = () => {
  // 1. Merge fog of war
  setExploredTiles(prev => {
    const newSet = new Set(prev);
    turnVisibility.forEach(tile => newSet.add(tile));
    currentVisibility.forEach(tile => newSet.add(tile));
    return newSet;
  });
  setTurnVisibility(new Set());
  
  // 2. Process player end-of-turn (reset moves, production, healing)
  let newState = endPlayerTurn(gameState);
  
  // 3. Execute AI turn
  const aiResult = executeAITurn(newState, aiKnowledge, AI_CONFIG);
  
  // 4. Update AI knowledge
  setAiKnowledge(aiResult.knowledge);
  
  // 5. Check victory conditions
  const victory = checkVictoryCondition(aiResult.state);
  if (victory.status !== 'playing') {
    setPhase(victory.status === 'victory' ? PHASE_VICTORY : PHASE_DEFEAT);
    setGameState(aiResult.state);
    return;
  }
  
  // 6. Find first available player unit
  const firstUnitId = findNextUnit(aiResult.state);
  
  // 7. Update state
  setGameState({
    ...aiResult.state,
    activeUnitId: firstUnitId,
    turn: aiResult.state.turn + 1
  });
  
  setMessage(`Turn ${aiResult.state.turn + 1}: Your move.`);
};
```

---

## Integration Point 6: GoTo Pathfinding

### User Sets Destination → Pathfinding → Auto-execution

```javascript
import { findPath } from './movement-engine.js';

// Set GoTo destination
const handleSetGoto = (destX, destY) => {
  if (!activeUnit) return;
  
  const pos = getUnitLocation(activeUnit, gameState);
  const path = findPath(pos.x, pos.y, destX, destY, activeUnit, gameState);
  
  if (!path || path.length === 0) {
    setMessage('No path found!');
    return;
  }
  
  setGameState(prev => {
    const newUnits = prev.units.map(u =>
      u.id === activeUnit.id
        ? { ...u, gotoPath: path, status: STATUS_GOTO }
        : u
    );
    return { ...prev, units: newUnits };
  });
  
  setMessage(`GoTo set: ${path.length} steps.`);
};

// Auto-execute GoTo (runs on timer)
const executeGotoStep = useCallback(() => {
  if (!activeUnit?.gotoPath || activeUnit.gotoPath.length === 0 || activeUnit.movesLeft <= 0) {
    return false;
  }
  
  const nextTile = activeUnit.gotoPath[0];
  const moves = getValidMoves(activeUnit, gameState);
  const move = moves.find(m => m.x === nextTile.x && m.y === nextTile.y);
  
  if (!move) {
    // Path blocked - cancel GoTo
    setGameState(prev => {
      const newUnits = prev.units.map(u =>
        u.id === activeUnit.id
          ? { ...u, gotoPath: null, status: STATUS_READY }
          : u
      );
      return { ...prev, units: newUnits };
    });
    setMessage('Path blocked!');
    return false;
  }
  
  // Execute move
  const result = moveUnit(gameState, activeUnit.id, nextTile.x - activeUnit.x, nextTile.y - activeUnit.y);
  
  if (result.success) {
    // Update path
    setGameState(prev => {
      const unit = prev.units.find(u => u.id === activeUnit.id);
      const remaining = unit.gotoPath.slice(1);
      
      const newUnits = prev.units.map(u =>
        u.id === activeUnit.id
          ? { 
              ...u, 
              gotoPath: remaining.length > 0 ? remaining : null,
              status: remaining.length === 0 ? STATUS_READY : STATUS_GOTO
            }
          : u
      );
      
      return { ...result.state, units: newUnits };
    });
    
    return true;
  }
  
  return false;
}, [activeUnit, gameState]);

// Timer for auto-execution
useEffect(() => {
  if (phase !== PHASE_PLAYING || !activeUnit?.gotoPath) return;
  
  const timer = setTimeout(() => {
    if (executeGotoStep()) {
      // Continue executing
    }
  }, 150); // 150ms delay between moves
  
  return () => clearTimeout(timer);
}, [phase, activeUnit, executeGotoStep]);
```

---

## Integration Point 7: City Production

### Double-click City → Dialog → Set Production → Next Turn → Spawn Unit

```javascript
import { setCityProduction } from './game-state.js';

// Open dialog
const handleTileDoubleClick = (x, y) => {
  const tile = gameState.map[y][x];
  if (tile === PLAYER_CITY) {
    const cityKey = `${x},${y}`;
    if (gameState.cities[cityKey]) {
      setShowCityDialog(cityKey);
    }
  }
};

// Set production
const handleSetProduction = (cityKey, unitType) => {
  const newState = setCityProduction(gameState, cityKey, unitType);
  setGameState(newState);
  setMessage(`Production set to ${UNIT_SPECS[unitType].name}.`);
  setShowCityDialog(null);
};

// Production happens in endPlayerTurn()
function endPlayerTurn(gameState) {
  let newCities = { ...gameState.cities };
  let newUnits = [...gameState.units];
  let nextId = gameState.nextUnitId;
  
  Object.entries(newCities).forEach(([key, city]) => {
    if (city.owner !== 'player' || !city.producing) return;
    
    const spec = UNIT_SPECS[city.producing];
    const progress = (city.progress[city.producing] || 0) + 1;
    
    if (progress >= spec.productionDays) {
      // Spawn unit
      newUnits.push({
        id: nextId++,
        type: city.producing,
        owner: 'player',
        x: city.x,
        y: city.y,
        strength: spec.strength,
        movesLeft: spec.movement,
        fuel: spec.fuel,
        status: STATUS_READY,
        aboardId: null,
        gotoPath: null,
        patrolPath: null,
        patrolIdx: 0
      });
      
      // Reset progress
      newCities[key] = {
        ...city,
        progress: { ...city.progress, [city.producing]: 0 }
      };
    } else {
      // Increment progress
      newCities[key] = {
        ...city,
        progress: { ...city.progress, [city.producing]: progress }
      };
    }
  });
  
  return {
    ...gameState,
    cities: newCities,
    units: newUnits,
    nextUnitId: nextId
  };
}
```

---

## Integration Point 8: Rendering

### Game State → UI Components

```javascript
import { Tile, UnitSprite, MiniMap, TurnInfo, CommandMenu } from './ui-components.jsx';

return (
  <div>
    {/* Map viewport */}
    <div style={{ width: VIEWPORT_TILES_X * TILE_SIZE, height: VIEWPORT_TILES_Y * TILE_SIZE }}>
      {Array.from({ length: VIEWPORT_TILES_Y }, (_, vy) => {
        const y = viewportY + vy;
        return Array.from({ length: VIEWPORT_TILES_X }, (_, vx) => {
          const x = viewportX + vx;
          if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) return null;
          
          const move = validMoves.find(m => m.x === x && m.y === y);
          
          return (
            <Tile
              key={`${x}-${y}`}
              type={gameState.map[y][x]}
              fogState={fog[y]?.[x] ?? FOG_UNEXPLORED}
              x={x}
              y={y}
              isValidMove={!!move && !gotoMode}
              isAttack={move?.isAttack}
              onClick={() => handleTileClick(x, y)}
              onDoubleClick={() => handleTileDoubleClick(x, y)}
            />
          );
        });
      })}
      
      {/* Units */}
      {gameState.units
        .filter(u => !u.aboardId && u.x >= viewportX && u.x < viewportX + VIEWPORT_TILES_X &&
                     u.y >= viewportY && u.y < viewportY + VIEWPORT_TILES_Y)
        .filter(u => u.owner === 'player' || fog[u.y]?.[u.x] === FOG_VISIBLE)
        .map(unit => (
          <UnitSprite
            key={unit.id}
            unit={unit}
            isActive={unit.id === gameState.activeUnitId}
            blink={blink}
            onClick={(e) => handleUnitClick(unit, e)}
            cargoCount={gameState.units.filter(u => u.aboardId === unit.id).length}
          />
        ))}
    </div>
    
    {/* UI Panels */}
    <TurnInfo
      turn={gameState.turn}
      phase={phase}
      unitsWaiting={unitsWaiting}
      playerCities={cityCounts.player}
      aiCities={cityCounts.ai}
      neutralCities={cityCounts.neutral}
      onEndTurn={handleEndTurn}
      onShowCityList={() => setShowCityList(true)}
    />
    
    <MiniMap
      map={gameState.map}
      fog={fog}
      units={gameState.units}
      width={gameState.width}
      height={gameState.height}
      viewportX={viewportX}
      viewportY={viewportY}
      onNavigate={handleNavigate}
    />
    
    <CommandMenu
      activeUnit={activeUnit}
      onCommand={handleCommand}
      disabled={!activeUnit || activeUnit.aboardId}
      patrolMode={patrolMode}
    />
  </div>
);
```

---

## Error Handling Strategy

### Defensive Programming at Integration Points

```javascript
// Always validate state before operations
const handleMove = (dx, dy) => {
  if (!gameState) {
    console.error('No game state');
    return;
  }
  
  if (!activeUnit) {
    setMessage('No unit selected.');
    return;
  }
  
  if (activeUnit.movesLeft <= 0) {
    setMessage('Unit has no moves left.');
    return;
  }
  
  // ... proceed with move
};

// Wrap external module calls in try-catch
try {
  const result = moveUnit(gameState, unitId, dx, dy);
  setGameState(result.state);
} catch (error) {
  console.error('Move failed:', error);
  setMessage('Error: Move failed. Please report this bug.');
}

// Validate AI results
const aiResult = executeAITurn(gameState, aiKnowledge);
if (!aiResult || !aiResult.state || !aiResult.knowledge) {
  console.error('Invalid AI result:', aiResult);
  setMessage('AI turn failed. Skipping.');
  return;
}
```

---

## Performance Considerations

### Memoization & Optimization

```javascript
// Memoize expensive calculations
const validMoves = useMemo(() => 
  activeUnit ? getValidMoves(activeUnit, gameState) : [],
  [activeUnit, gameState]
);

const currentVisibility = useMemo(() => 
  gameState ? calculateVisibility(gameState, 'player') : new Set(),
  [gameState]
);

// Throttle AI execution
const executeAIWithDelay = async (state) => {
  // Add small delays between AI unit actions for visibility
  for (const unit of aiUnits) {
    await new Promise(resolve => setTimeout(resolve, 100));
    // Process unit
  }
};

// Viewport culling (only render visible tiles/units)
const visibleUnits = gameState.units.filter(u => 
  u.x >= viewportX && u.x < viewportX + VIEWPORT_TILES_X &&
  u.y >= viewportY && u.y < viewportY + VIEWPORT_TILES_Y
);
```

---

## Testing Integration

### Integration Test Checklist

- [ ] Map generates and initializes game state
- [ ] Player can move units with keyboard
- [ ] Valid moves display correctly
- [ ] Combat resolves and updates state
- [ ] Cities can be captured
- [ ] Production works (units spawn)
- [ ] Fog of war updates correctly
- [ ] AI takes full turn
- [ ] AI units move and capture cities
- [ ] Turn counter increments
- [ ] Victory/defeat detection works
- [ ] GoTo pathfinding executes
- [ ] Patrol routes work
- [ ] Dialogs open and save changes
- [ ] Mini-map navigation works
- [ ] Viewport scrolling works

### Debug Mode

Add debug overlay for development:

```javascript
const [debugMode, setDebugMode] = useState(false);

// Press D to toggle debug
useEffect(() => {
  const handler = (e) => {
    if (e.key === 'd' && e.ctrlKey) {
      setDebugMode(prev => !prev);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);

{debugMode && (
  <div style={{ position: 'fixed', top: 0, left: 0, background: 'rgba(0,0,0,0.8)', color: '#0f0', padding: '10px', fontSize: '10px', fontFamily: 'monospace', zIndex: 9999 }}>
    <div>Turn: {gameState.turn}</div>
    <div>Active Unit: {activeUnit?.id} ({activeUnit?.type})</div>
    <div>Units: {gameState.units.length} (Player: {gameState.units.filter(u => u.owner === 'player').length}, AI: {gameState.units.filter(u => u.owner === 'ai').length})</div>
    <div>Valid Moves: {validMoves.length}</div>
    <div>Visibility: {currentVisibility.size} tiles</div>
    <div>Explored: {exploredTiles.size} tiles</div>
  </div>
)}
```

---

## Next Steps

1. Extract modules from current strategic-conquest-game.jsx
2. Test each module independently
3. Wire modules together following this guide
4. Test integration points one at a time
5. Add error handling and validation
6. Optimize performance
7. Add debug mode for development

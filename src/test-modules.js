// ============================================================================
// STRATEGIC CONQUEST - MODULE INTEGRATION TEST
// ============================================================================
// Run with: node --experimental-vm-modules test-modules.js
// Or in browser console with the modules loaded

// Test 1: Create a simple game state
console.log('=== TEST 1: Creating test game state ===');

const testGameState = {
  map: [
    [0, 0, 0, 0, 0], // 0 = WATER
    [0, 1, 2, 1, 0], // 1 = LAND, 2 = PLAYER_CITY
    [0, 1, 1, 3, 0], // 3 = AI_CITY
    [0, 1, 4, 1, 0], // 4 = NEUTRAL_CITY
    [0, 0, 0, 0, 0],
  ],
  width: 5,
  height: 5,
  cities: {
    '2,1': { owner: 'player', x: 2, y: 1, producing: 'tank', progress: {} },
    '3,2': { owner: 'ai', x: 3, y: 2, producing: 'tank', progress: {} },
    '2,3': { owner: 'neutral', x: 2, y: 3, producing: null, progress: {} },
  },
  units: [
    { id: 1, type: 'tank', owner: 'player', x: 2, y: 1, strength: 2, movesLeft: 1, fuel: null, status: 'R', aboardId: null, gotoPath: null, patrolPath: null, patrolIdx: 0 },
    { id: 2, type: 'tank', owner: 'ai', x: 3, y: 2, strength: 2, movesLeft: 1, fuel: null, status: 'R', aboardId: null, gotoPath: null, patrolPath: null, patrolIdx: 0 },
  ],
  turn: 1,
  activeUnitId: 1,
  nextUnitId: 3,
  mapSize: 'small',
  terrain: 'normal',
  difficulty: 5,
};

console.log('Game state created:', {
  mapSize: `${testGameState.width}x${testGameState.height}`,
  units: testGameState.units.length,
  cities: Object.keys(testGameState.cities).length,
});

// Test 2: Test fog of war calculation
console.log('\n=== TEST 2: Fog of War ===');

// Inline fog calculation for testing
function calculateVisibility(gameState, owner) {
  const { width, height, units, cities } = gameState;
  const visible = new Set();
  
  const addVision = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          visible.add(`${nx},${ny}`);
        }
      }
    }
  };
  
  units.filter(u => u.owner === owner && !u.aboardId).forEach(u => addVision(u.x, u.y));
  Object.values(cities).filter(c => c.owner === owner).forEach(c => addVision(c.x, c.y));
  return visible;
}

const playerVis = calculateVisibility(testGameState, 'player');
const aiVis = calculateVisibility(testGameState, 'ai');
console.log('Player visibility:', playerVis.size, 'tiles');
console.log('AI visibility:', aiVis.size, 'tiles');

// Test 3: Test valid moves calculation
console.log('\n=== TEST 3: Valid Moves ===');

// Inline movement constants
const DIRECTIONS = { 7: { dx: -1, dy: -1 }, 8: { dx: 0, dy: -1 }, 9: { dx: 1, dy: -1 }, 4: { dx: -1, dy: 0 }, 6: { dx: 1, dy: 0 }, 1: { dx: -1, dy: 1 }, 2: { dx: 0, dy: 1 }, 3: { dx: 1, dy: 1 } };
const WATER = 0;
const NEUTRAL_CITY = 4;

function getValidMoves(unit, gameState) {
  if (!unit || unit.movesLeft <= 0) return [];
  const { map, width: W, height: H, units } = gameState;
  const moves = [];
  
  for (const [key, { dx, dy }] of Object.entries(DIRECTIONS)) {
    const nx = unit.x + dx, ny = unit.y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const tile = map[ny][nx];
    
    // Tank can't enter water
    if (tile === WATER) continue;
    
    // Check for enemies
    const enemiesAtTarget = units.filter(u => !u.aboardId && u.x === nx && u.y === ny && u.owner !== unit.owner);
    if (enemiesAtTarget.length > 0) {
      moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true });
      continue;
    }
    
    // Check for neutral/enemy city
    if (tile === NEUTRAL_CITY || tile === 3) {
      moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: true, isCity: true });
      continue;
    }
    
    moves.push({ x: nx, y: ny, dir: parseInt(key), isAttack: false });
  }
  
  return moves;
}

const playerTank = testGameState.units.find(u => u.owner === 'player');
const aiTank = testGameState.units.find(u => u.owner === 'ai');

const playerMoves = getValidMoves(playerTank, testGameState);
const aiMoves = getValidMoves(aiTank, testGameState);

console.log('Player tank at', `(${playerTank.x}, ${playerTank.y})`);
console.log('Player valid moves:', playerMoves.length);
playerMoves.forEach(m => console.log(`  - (${m.x}, ${m.y}) attack:${m.isAttack} city:${m.isCity || false}`));

console.log('AI tank at', `(${aiTank.x}, ${aiTank.y})`);
console.log('AI valid moves:', aiMoves.length);
aiMoves.forEach(m => console.log(`  - (${m.x}, ${m.y}) attack:${m.isAttack} city:${m.isCity || false}`));

// Test 4: Test pathfinding
console.log('\n=== TEST 4: Pathfinding ===');

const ALL_DIRS = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];

function findPath(sx, sy, ex, ey, unit, gameState, maxDist = 100) {
  const { map, width: W, height: H } = gameState;
  const open = [{ x: sx, y: sy, g: 0, h: Math.abs(ex - sx) + Math.abs(ey - sy), path: [] }];
  const closed = new Set();
  
  while (open.length > 0 && open.length < maxDist * 10) {
    open.sort((a, b) => (a.g + a.h) - (b.g + b.h));
    const cur = open.shift();
    if (cur.x === ex && cur.y === ey) return cur.path;
    const key = `${cur.x},${cur.y}`;
    if (closed.has(key)) continue;
    closed.add(key);
    
    for (const [dx, dy] of ALL_DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || closed.has(`${nx},${ny}`)) continue;
      const tile = map[ny][nx];
      // Tank can only move on land
      if (tile === WATER) continue;
      open.push({ x: nx, y: ny, g: cur.g + 1, h: Math.abs(ex - nx) + Math.abs(ey - ny), path: [...cur.path, { x: nx, y: ny }] });
    }
  }
  return null;
}

// AI tank should be able to path to neutral city
const neutralCity = testGameState.cities['2,3'];
const pathToNeutral = findPath(aiTank.x, aiTank.y, neutralCity.x, neutralCity.y, aiTank, testGameState);
console.log(`Path from AI tank (${aiTank.x},${aiTank.y}) to neutral city (${neutralCity.x},${neutralCity.y}):`);
if (pathToNeutral) {
  console.log(`  Found path with ${pathToNeutral.length} steps`);
  pathToNeutral.forEach((p, i) => console.log(`    Step ${i + 1}: (${p.x}, ${p.y})`));
} else {
  console.log('  No path found!');
}

// Test 5: Simulate AI turn
console.log('\n=== TEST 5: AI Turn Simulation ===');

function manhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

function simulateAITurn(gameState) {
  console.log('[AI] Turn starting');
  
  let newState = { ...gameState, units: [...gameState.units] };
  const aiKnowledge = { exploredTiles: calculateVisibility(gameState, 'ai') };
  
  // Get AI units
  const aiUnits = newState.units.filter(u => u.owner === 'ai' && !u.aboardId);
  console.log(`[AI] Found ${aiUnits.length} AI units`);
  
  // Find known neutral cities
  const knownNeutralCities = Object.values(newState.cities)
    .filter(c => c.owner === 'neutral' && aiKnowledge.exploredTiles.has(`${c.x},${c.y}`));
  console.log(`[AI] Known neutral cities: ${knownNeutralCities.length}`);
  
  // Process each AI unit
  for (const unit of aiUnits) {
    console.log(`[AI][Unit ${unit.id} ${unit.type}] at (${unit.x}, ${unit.y}), movesLeft: ${unit.movesLeft}`);
    
    if (unit.movesLeft <= 0) {
      console.log(`[AI][Unit ${unit.id}] No moves left`);
      continue;
    }
    
    // Find nearest neutral city
    let target = null;
    let bestDist = Infinity;
    for (const city of knownNeutralCities) {
      const d = manhattanDistance(unit.x, unit.y, city.x, city.y);
      if (d < bestDist) { bestDist = d; target = city; }
    }
    
    if (target) {
      console.log(`[AI][Unit ${unit.id}] Target: neutral city at (${target.x}, ${target.y}), distance: ${bestDist}`);
      
      const path = findPath(unit.x, unit.y, target.x, target.y, unit, newState);
      if (path && path.length > 0) {
        console.log(`[AI][Unit ${unit.id}] Found path with ${path.length} steps`);
        const idx = newState.units.findIndex(u => u.id === unit.id);
        newState.units[idx] = { ...newState.units[idx], gotoPath: path, status: 'G' };
        console.log(`[AI][Unit ${unit.id}] Set goto path`);
      } else {
        console.log(`[AI][Unit ${unit.id}] No path found to target!`);
      }
    } else {
      console.log(`[AI][Unit ${unit.id}] No target city found`);
    }
  }
  
  // Execute movements
  console.log('[AI] --- Executing movements ---');
  let movesExecuted = 0;
  
  for (let i = 0; i < newState.units.length; i++) {
    const unit = newState.units[i];
    if (unit.owner !== 'ai' || unit.aboardId || !unit.gotoPath || unit.gotoPath.length === 0 || unit.movesLeft <= 0) continue;
    
    console.log(`[AI][Unit ${unit.id}] Executing goto, path: ${unit.gotoPath.length} steps`);
    
    while (unit.gotoPath && unit.gotoPath.length > 0 && unit.movesLeft > 0) {
      const next = unit.gotoPath[0];
      const moves = getValidMoves(unit, newState);
      console.log(`[AI][Unit ${unit.id}] Valid moves: ${moves.length}, target: (${next.x}, ${next.y})`);
      
      const move = moves.find(m => m.x === next.x && m.y === next.y);
      if (!move) {
        console.log(`[AI][Unit ${unit.id}] Cannot reach next step - clearing path`);
        newState.units[i] = { ...unit, gotoPath: null, status: 'R' };
        break;
      }
      
      const oldPos = `(${unit.x}, ${unit.y})`;
      newState.units[i] = { 
        ...newState.units[i], 
        x: next.x, 
        y: next.y, 
        movesLeft: newState.units[i].movesLeft - 1, 
        gotoPath: newState.units[i].gotoPath.slice(1) 
      };
      
      // Update loop reference
      unit.x = newState.units[i].x;
      unit.y = newState.units[i].y;
      unit.movesLeft = newState.units[i].movesLeft;
      unit.gotoPath = newState.units[i].gotoPath;
      
      movesExecuted++;
      console.log(`[AI][Unit ${unit.id}] Moved from ${oldPos} to (${next.x}, ${next.y})`);
      
      // Handle city capture
      if (move.isCity) {
        const cityKey = `${next.x},${next.y}`;
        console.log(`[AI][Unit ${unit.id}] CAPTURING CITY at ${cityKey}!`);
        newState.cities = { ...newState.cities };
        newState.cities[cityKey] = { ...newState.cities[cityKey], owner: 'ai', producing: 'tank', progress: {} };
        newState.map = newState.map.map(row => [...row]);
        newState.map[next.y][next.x] = 3; // AI_CITY
      }
    }
  }
  
  console.log(`[AI] Executed ${movesExecuted} moves total`);
  console.log('[AI] Turn complete');
  
  return newState;
}

const afterAITurn = simulateAITurn(testGameState);

console.log('\n=== RESULTS ===');
const aiUnitAfter = afterAITurn.units.find(u => u.owner === 'ai');
console.log('AI tank position after turn:', `(${aiUnitAfter.x}, ${aiUnitAfter.y})`);
console.log('AI tank goto path remaining:', aiUnitAfter.gotoPath?.length || 0, 'steps');
console.log('Neutral city owner:', afterAITurn.cities['2,3'].owner);

if (aiUnitAfter.x !== aiTank.x || aiUnitAfter.y !== aiTank.y) {
  console.log('\n✅ SUCCESS: AI unit moved!');
} else {
  console.log('\n❌ FAILURE: AI unit did not move');
}

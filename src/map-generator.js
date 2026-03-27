// ============================================================================
// STRATEGIC CONQUEST - MAP GENERATOR MODULE (FIXED)
// ============================================================================
// Procedural island-based map generation with configurable parameters.
// Ensures valid starting positions for player and AI with proper separation.
//
// FIX: Added interior hole filling to reduce archipelago effect
// - Islands now have more solid interiors, especially for normal/dry terrain
// - Terrain types have distinct personalities (wet=archipelago, normal=mixed, dry=continental)
//
// Dependencies: game-constants.js
// Target line count: ~500-600 lines (complex algorithm)

import {
  WATER,
  LAND,
  PLAYER_CITY,
  AI_CITY,
  NEUTRAL_CITY
} from './game-constants.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Map size configurations with separation ranges
 */
export const MAP_SIZES = {
  small: { 
    width: 48, 
    height: 32, 
    totalCities: 20, 
    label: 'Small (48x32) - 20 cities',
    minSeparationPercent: 10,
    maxSeparationPercent: 60,
  },
  medium: { 
    width: 96, 
    height: 64, 
    totalCities: 40, 
    label: 'Medium (96x64) - 40 cities',
    minSeparationPercent: 20,
    maxSeparationPercent: 70,
  },
  large: { 
    width: 124, 
    height: 96, 
    totalCities: 60, 
    label: 'Large (124x96) - 60 cities',
    minSeparationPercent: 30,
    maxSeparationPercent: 80,
  },
};

/**
 * Terrain configurations controlling water ratio and island characteristics
 * 
 * NEW PARAMETERS:
 * - growthProbability: How likely neighbors are added during island growth (higher = more solid)
 * - fillHoleRadius: How far to check for landlocked water (higher = more holes filled)
 * - fillHoleThreshold: Minimum land neighbors needed to fill a hole (4=strict, 3=moderate)
 */
export const TERRAIN_TYPES = {
  wet: { 
    waterRatio: 0.85, 
    islandSizeMin: 0.3, 
    islandSizeMax: 0.8,
    islandAttempts: 150,
    growthProbability: 0.50,    // Keep sparse, archipelago feel
    fillHoleRadius: 1,          // Only fill tiny 1-tile holes
    fillHoleThreshold: 4,       // Must be completely surrounded
    label: 'Wet (85% water) - Archipelago' 
  },
  normal: { 
    waterRatio: 0.80, 
    islandSizeMin: 0.5, 
    islandSizeMax: 1.2,
    islandAttempts: 200,
    growthProbability: 0.70,    // More solid islands
    fillHoleRadius: 2,          // Fill medium-sized holes
    fillHoleThreshold: 3,       // Fill if 3+ cardinal neighbors are land
    label: 'Normal (80% water) - Mixed' 
  },
  dry: { 
    waterRatio: 0.70,           // Reduced from 0.75 for more land
    islandSizeMin: 1.0,         // Larger minimum island size
    islandSizeMax: 2.5,         // Larger maximum island size
    islandAttempts: 300,        // More attempts for bigger landmasses
    growthProbability: 0.85,    // Very solid, continental islands
    fillHoleRadius: 2,          // Fill medium interior holes
    fillHoleThreshold: 3,       // Fill if 3+ cardinal neighbors are land (prevents bridging channels)
    label: 'Dry (70% water) - Large Islands'
  },
};

/**
 * Difficulty settings controlling starting city distribution
 */
export const DIFFICULTY_LEVELS = [
  { value: 1, label: '1 - Easiest', aiCities: 3, playerCities: 7 },
  { value: 2, label: '2', aiCities: 3, playerCities: 6 },
  { value: 3, label: '3', aiCities: 4, playerCities: 6 },
  { value: 4, label: '4', aiCities: 4, playerCities: 5 },
  { value: 5, label: '5 - Normal', aiCities: 5, playerCities: 5 },
  { value: 6, label: '6', aiCities: 5, playerCities: 4 },
  { value: 7, label: '7', aiCities: 6, playerCities: 4 },
  { value: 8, label: '8', aiCities: 6, playerCities: 3 },
  { value: 9, label: '9', aiCities: 7, playerCities: 3 },
  { value: 10, label: '10 - Hardest', aiCities: 7, playerCities: 2 },
];

/**
 * Soft buffer distance around starting islands for neutral city placement
 */
const BUFFER_DISTANCE = 3;

/**
 * Maximum generation attempts before giving up
 */
const MAX_GENERATION_ATTEMPTS = 10;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate Euclidean distance between two points
 */
function distance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Calculate edge-to-edge separation between two islands
 * @param {Object} island1 - {tiles: Set, minX, maxX, minY, maxY}
 * @param {Object} island2 - {tiles: Set, minX, maxX, minY, maxY}
 * @returns {number} Minimum distance between island edges
 */
function calculateEdgeSeparation(island1, island2) {
  let minDist = Infinity;
  
  for (const tile1 of island1.tiles) {
    const [x1, y1] = tile1.split(',').map(Number);
    for (const tile2 of island2.tiles) {
      const [x2, y2] = tile2.split(',').map(Number);
      const dist = distance(x1, y1, x2, y2);
      if (dist < minDist) {
        minDist = dist;
      }
    }
  }
  
  return minDist;
}

/**
 * Check if a tile is 8-adjacent to any tile in a land set.
 * O(1) — used to enforce minimum 1-tile water gap between island edges.
 */
function isAdjacentToLand(x, y, landSet) {
  return (
    landSet.has(`${x-1},${y}`)   || landSet.has(`${x+1},${y}`)   ||
    landSet.has(`${x},${y-1}`)   || landSet.has(`${x},${y+1}`)   ||
    landSet.has(`${x-1},${y-1}`) || landSet.has(`${x+1},${y-1}`) ||
    landSet.has(`${x-1},${y+1}`) || landSet.has(`${x+1},${y+1}`)
  );
}

/**
 * Generate a starting island (player or AI) with configurable growth probability
 * @returns {Object} Island data with tiles and bounding box
 */
function generateStartingIsland(centerX, centerY, targetSize, mapWidth, mapHeight, boundingBox, growthProbability = 0.65) {
  const island = new Set();
  const queue = [`${centerX},${centerY}`];
  island.add(queue[0]);
  
  let minX = centerX, maxX = centerX, minY = centerY, maxY = centerY;
  
  while (island.size < targetSize && queue.length > 0) {
    const current = queue.shift();
    const [x, y] = current.split(',').map(Number);
    
    const neighbors = [
      [x-1, y], [x+1, y], [x, y-1], [x, y+1],
      [x-1, y-1], [x+1, y-1], [x-1, y+1], [x+1, y+1],
    ];
    
    for (const [nx, ny] of neighbors) {
      if (nx < boundingBox.minX || nx > boundingBox.maxX || 
          ny < boundingBox.minY || ny > boundingBox.maxY) continue;
      
      const nkey = `${nx},${ny}`;
      if (!island.has(nkey) && Math.random() < growthProbability) {
        island.add(nkey);
        queue.push(nkey);
        
        minX = Math.min(minX, nx);
        maxX = Math.max(maxX, nx);
        minY = Math.min(minY, ny);
        maxY = Math.max(maxY, ny);
      }
    }
  }
  
  return { tiles: island, minX, maxX, minY, maxY };
}

/**
 * Calculate minimum distance from a point to any tile in a set
 */
function minDistanceToSet(x, y, protectedTiles) {
  let minDist = Infinity;
  for (const tile of protectedTiles) {
    const [tx, ty] = tile.split(',').map(Number);
    const dist = distance(x, y, tx, ty);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

/**
 * Generate a neutral island away from starting islands
 * Now accepts growthProbability parameter for terrain-specific behavior
 */
function generateNeutralIsland(startX, startY, targetSize, mapWidth, mapHeight, existingLand, protectedTiles, bufferDistance, growthProbability = 0.5) {
  const island = new Set();
  const queue = [[startX, startY]];
  const visited = new Set();
  visited.add(`${startX},${startY}`);
  
  while (queue.length > 0 && island.size < targetSize) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    
    if (existingLand.has(key)) continue;
    // Enforce 1-tile water gap between this island and all existing land
    if (isAdjacentToLand(x, y, existingLand)) continue;

    const distToProtected = minDistanceToSet(x, y, protectedTiles);
    if (distToProtected >= bufferDistance) {
      island.add(key);
    }
    
    const neighbors = [
      [x-1, y], [x+1, y], [x, y-1], [x, y+1],
      [x-1, y-1], [x+1, y-1], [x-1, y+1], [x+1, y+1],
    ];
    
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue;
      
      const nkey = `${nx},${ny}`;
      if (!visited.has(nkey)) {
        visited.add(nkey);
        if (Math.random() < growthProbability) {
          queue.push([nx, ny]);
        }
      }
    }
  }
  
  return island;
}

/**
 * Count number of distinct islands using flood fill
 */
function countDistinctIslands(allLand) {
  const unvisited = new Set(allLand);
  let islandCount = 0;
  
  while (unvisited.size > 0) {
    islandCount++;
    const start = [...unvisited][0];
    const queue = [start];
    unvisited.delete(start);
    
    while (queue.length > 0) {
      const current = queue.shift();
      const [x, y] = current.split(',').map(Number);
      
      const neighbors = [
        `${x-1},${y}`, `${x+1},${y}`, `${x},${y-1}`, `${x},${y+1}`,
        `${x-1},${y-1}`, `${x+1},${y-1}`, `${x-1},${y+1}`, `${x+1},${y+1}`,
      ];
      
      for (const nkey of neighbors) {
        if (unvisited.has(nkey)) {
          unvisited.delete(nkey);
          queue.push(nkey);
        }
      }
    }
  }
  
  return islandCount;
}

/**
 * Check if a tile is coastal (adjacent to water)
 */
function isCoastal(x, y, landTiles, mapWidth, mapHeight) {
  const neighbors = [
    [x-1, y], [x+1, y], [x, y-1], [x, y+1],
  ];
  
  for (const [nx, ny] of neighbors) {
    if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) return true;
    if (!landTiles.has(`${nx},${ny}`)) return true;
  }
  
  return false;
}

/**
 * Check if a city location is at least minDist away from all existing cities
 */
function isMinDistanceFromCities(x, y, existingCities, minDist) {
  for (const cityKey of existingCities) {
    const [cx, cy] = cityKey.split(',').map(Number);
    const dist = Math.abs(x - cx) + Math.abs(y - cy); // Manhattan distance
    if (dist < minDist) {
      return false;
    }
  }
  return true;
}

/**
 * Place cities on an island, preferring coastal locations
 * Ensures minimum distance of 2 between cities
 * For starting islands, guarantees at least 1 coastal city
 */
function placeCitiesOnIsland(island, count, allLand, mapWidth, mapHeight, isStartingIsland = false, minDistance = 2) {
  const islandArray = Array.from(island.tiles);
  
  const coastalTiles = islandArray.filter(key => {
    const [x, y] = key.split(',').map(Number);
    return isCoastal(x, y, allLand, mapWidth, mapHeight);
  });
  
  const interiorTiles = islandArray.filter(key => !coastalTiles.includes(key));
  
  const cities = [];
  const used = new Set();
  
  const selectFrom = (pool, needed) => {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (const tile of shuffled) {
      if (cities.length >= needed) break;
      if (!used.has(tile)) {
        const [x, y] = tile.split(',').map(Number);
        // Check minimum distance from existing cities
        if (isMinDistanceFromCities(x, y, cities, minDistance)) {
          cities.push(tile);
          used.add(tile);
        }
      }
    }
  };
  
  // For starting islands, ensure at least 1 coastal city
  if (isStartingIsland && coastalTiles.length > 0) {
    // Place first city on coast
    const shuffled = [...coastalTiles].sort(() => Math.random() - 0.5);
    for (const tile of shuffled) {
      if (!used.has(tile)) {
        cities.push(tile);
        used.add(tile);
        break;
      }
    }
  }
  
  const coastalNeeded = Math.ceil(count * 0.7);
  selectFrom(coastalTiles, coastalNeeded);
  
  if (cities.length < count) {
    selectFrom(interiorTiles, count);
  }
  
  if (cities.length < count) {
    selectFrom(islandArray, count);
  }
  
  return cities.slice(0, count);
}

// ============================================================================
// INTERIOR HOLE FILLING (NEW)
// ============================================================================

/**
 * Count land neighbors in cardinal directions within a given radius
 * Returns count of land tiles found in N/S/E/W directions
 */
function countCardinalLandNeighbors(x, y, allLand, mapWidth, mapHeight, radius) {
  let landCount = 0;
  
  // Check each cardinal direction
  const directions = [
    [0, -1],  // North
    [0, 1],   // South
    [-1, 0],  // West
    [1, 0],   // East
  ];
  
  for (const [dx, dy] of directions) {
    let foundLand = false;
    for (let r = 1; r <= radius; r++) {
      const nx = x + dx * r;
      const ny = y + dy * r;
      
      // If out of bounds, treat as blocking (not open water)
      if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) {
        foundLand = true;
        break;
      }
      
      if (allLand.has(`${nx},${ny}`)) {
        foundLand = true;
        break;
      }
    }
    if (foundLand) landCount++;
  }
  
  return landCount;
}

/**
 * Check if a water tile is "landlocked" - surrounded by land in all cardinal directions
 * within the specified radius
 */
function isLandlocked(x, y, allLand, mapWidth, mapHeight, radius, threshold) {
  const landNeighbors = countCardinalLandNeighbors(x, y, allLand, mapWidth, mapHeight, radius);
  return landNeighbors >= threshold;
}

/**
 * Fill interior holes in landmasses based on terrain configuration
 * This converts water tiles that are landlocked into land tiles
 * 
 * @param {Set} allLand - Set of all land tile keys
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 * @param {number} fillRadius - How far to check for surrounding land
 * @param {number} fillThreshold - Minimum cardinal directions with land (2-4)
 * @returns {Set} Updated land set with holes filled
 */
function fillInteriorHoles(allLand, mapWidth, mapHeight, fillRadius, fillThreshold) {
  const filledLand = new Set(allLand);
  let changed = true;
  let passes = 0;
  const maxPasses = 5; // Prevent infinite loops
  
  // Iterate until no more changes (holes expand to fill larger gaps)
  while (changed && passes < maxPasses) {
    changed = false;
    passes++;
    
    const tilesToFill = [];
    
    // Check all water tiles
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const key = `${x},${y}`;
        if (!filledLand.has(key)) {
          // This is a water tile - check if landlocked
          if (isLandlocked(x, y, filledLand, mapWidth, mapHeight, fillRadius, fillThreshold)) {
            tilesToFill.push(key);
          }
        }
      }
    }
    
    // Fill identified holes
    if (tilesToFill.length > 0) {
      changed = true;
      for (const key of tilesToFill) {
        filledLand.add(key);
      }
    }
  }
  
  console.log(`[MAP-GEN] Filled ${filledLand.size - allLand.size} interior holes in ${passes} passes`);
  
  return filledLand;
}

// ============================================================================
// MAIN GENERATION FUNCTIONS
// ============================================================================

/**
 * Attempt to generate a valid map
 * @param {string} mapSize - 'small', 'medium', or 'large'
 * @param {string} terrain - 'wet', 'normal', or 'dry'
 * @param {number} difficulty - 1-10
 * @returns {Object} Map generation result with validity flags
 */
function generateMapAttempt(mapSize, terrain, difficulty) {
  const { width: MAP_WIDTH, height: MAP_HEIGHT, totalCities, minSeparationPercent, maxSeparationPercent } = MAP_SIZES[mapSize];
  const { 
    waterRatio, 
    islandSizeMin, 
    islandSizeMax, 
    islandAttempts,
    growthProbability,
    fillHoleRadius,
    fillHoleThreshold 
  } = TERRAIN_TYPES[terrain];
  const diffConfig = DIFFICULTY_LEVELS.find(d => d.value === difficulty);
  
  const targetLandTiles = Math.floor(MAP_WIDTH * MAP_HEIGHT * (1 - waterRatio));
  const targetWaterPercent = Math.round(waterRatio * 100);
  
  const mapDiagonal = Math.sqrt(MAP_WIDTH ** 2 + MAP_HEIGHT ** 2);
  const minSeparation = Math.floor(mapDiagonal * minSeparationPercent / 100);
  const maxSeparation = Math.floor(mapDiagonal * maxSeparationPercent / 100);
  
  let allLand = new Set();
  
  const baseIslandSize = Math.floor((MAP_WIDTH * MAP_HEIGHT) / 150);
  
  console.log(`[MAP-GEN] Generating ${terrain} terrain: growthProb=${growthProbability}, fillRadius=${fillHoleRadius}, fillThreshold=${fillHoleThreshold}`);
  
  // ========== STEP 1: Calculate starting island sizes ==========
  
  const playerCitiesNeeded = diffConfig.playerCities;
  const playerIslandSize = playerCitiesNeeded * 8 + 15 + Math.floor(Math.random() * 20);
  const playerIslandRadius = Math.ceil(Math.sqrt(playerIslandSize) * 1.3);
  
  const aiCitiesNeeded = diffConfig.aiCities;
  const aiIslandSize = aiCitiesNeeded * 8 + 15 + Math.floor(Math.random() * 20);
  const aiIslandRadius = Math.ceil(Math.sqrt(aiIslandSize) * 1.3);
  
  // ========== STEP 2: Place player island ==========
  
  const playerMargin = playerIslandRadius + 2;
  const playerCenterX = playerMargin + Math.floor(Math.random() * Math.max(1, MAP_WIDTH - 2 * playerMargin));
  const playerCenterY = playerMargin + Math.floor(Math.random() * Math.max(1, MAP_HEIGHT - 2 * playerMargin));
  
  const playerBoundingBox = {
    minX: Math.max(0, playerCenterX - playerIslandRadius),
    maxX: Math.min(MAP_WIDTH - 1, playerCenterX + playerIslandRadius),
    minY: Math.max(0, playerCenterY - playerIslandRadius),
    maxY: Math.min(MAP_HEIGHT - 1, playerCenterY + playerIslandRadius),
  };
  
  const playerIsland = generateStartingIsland(
    playerCenterX, playerCenterY, playerIslandSize,
    MAP_WIDTH, MAP_HEIGHT, playerBoundingBox, growthProbability
  );
  
  playerIsland.tiles.forEach(tile => allLand.add(tile));
  
  // ========== STEP 3: Place AI island with target separation ==========
  
  const targetEdgeSeparation = minSeparation + Math.floor(Math.random() * (maxSeparation - minSeparation));
  const targetCenterSeparation = targetEdgeSeparation + playerIslandRadius + aiIslandRadius;
  const angle = Math.random() * 2 * Math.PI;
  
  let aiCenterX = Math.round(playerCenterX + targetCenterSeparation * Math.cos(angle));
  let aiCenterY = Math.round(playerCenterY + targetCenterSeparation * Math.sin(angle));
  
  const aiMargin = aiIslandRadius + 2;
  aiCenterX = Math.max(aiMargin, Math.min(MAP_WIDTH - aiMargin, aiCenterX));
  aiCenterY = Math.max(aiMargin, Math.min(MAP_HEIGHT - aiMargin, aiCenterY));
  
  // Check if too close and use corners if needed
  let centerDist = distance(playerCenterX, playerCenterY, aiCenterX, aiCenterY);
  
  if (centerDist < minSeparation + playerIslandRadius + aiIslandRadius) {
    const corners = [
      { x: aiMargin, y: aiMargin },
      { x: MAP_WIDTH - aiMargin, y: aiMargin },
      { x: aiMargin, y: MAP_HEIGHT - aiMargin },
      { x: MAP_WIDTH - aiMargin, y: MAP_HEIGHT - aiMargin },
    ];
    
    let bestCorner = corners[0];
    let bestDist = 0;
    
    for (const corner of corners) {
      const dist = distance(playerCenterX, playerCenterY, corner.x, corner.y);
      if (dist > bestDist) {
        bestDist = dist;
        bestCorner = corner;
      }
    }
    
    aiCenterX = bestCorner.x;
    aiCenterY = bestCorner.y;
  }
  
  const aiBoundingBox = {
    minX: Math.max(0, aiCenterX - aiIslandRadius),
    maxX: Math.min(MAP_WIDTH - 1, aiCenterX + aiIslandRadius),
    minY: Math.max(0, aiCenterY - aiIslandRadius),
    maxY: Math.min(MAP_HEIGHT - 1, aiCenterY + aiIslandRadius),
  };
  
  const aiIsland = generateStartingIsland(
    aiCenterX, aiCenterY, aiIslandSize,
    MAP_WIDTH, MAP_HEIGHT, aiBoundingBox, growthProbability
  );
  
  aiIsland.tiles.forEach(tile => allLand.add(tile));
  
  // ========== STEP 4: Calculate actual separation ==========
  
  const edgeSeparation = calculateEdgeSeparation(playerIsland, aiIsland);
  const separationValid = edgeSeparation >= minSeparation && edgeSeparation <= maxSeparation;
  
  // ========== STEP 5: Place cities on starting islands ==========
  
  const playerCityTiles = placeCitiesOnIsland(playerIsland, playerCitiesNeeded, allLand, MAP_WIDTH, MAP_HEIGHT, true);
  const aiCityTiles = placeCitiesOnIsland(aiIsland, aiCitiesNeeded, allLand, MAP_WIDTH, MAP_HEIGHT, true);
  
  const startingCities = playerCitiesNeeded + aiCitiesNeeded;
  const neutralCitiesNeeded = totalCities - startingCities;
  
  // Protected tiles (player and AI islands)
  const protectedTiles = new Set([...playerIsland.tiles, ...aiIsland.tiles]);
  
  // ========== STEP 6: Generate neutral islands ==========
  
  const neutralIslands = [];
  
  for (let attempt = 0; attempt < islandAttempts && allLand.size < targetLandTiles; attempt++) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    
    if (allLand.has(`${x},${y}`)) continue;
    // Require seed at least 1 tile clear of all existing land
    if (isAdjacentToLand(x, y, allLand)) continue;

    const distToProtected = minDistanceToSet(x, y, protectedTiles);
    if (distToProtected < BUFFER_DISTANCE) continue;
    
    const sizeVariation = islandSizeMin + Math.random() * (islandSizeMax - islandSizeMin);
    const islandSize = Math.floor(baseIslandSize * sizeVariation);
    
    const island = generateNeutralIsland(x, y, islandSize, MAP_WIDTH, MAP_HEIGHT, allLand, protectedTiles, BUFFER_DISTANCE, growthProbability);
    
    if (island.size >= 5) {
      island.forEach(tile => allLand.add(tile));
      neutralIslands.push({ tiles: island });
    }
  }
  
  // ========== STEP 6.5: Fill interior holes (NEW) ==========
  
  const preFillLandSize = allLand.size;
  allLand = fillInteriorHoles(allLand, MAP_WIDTH, MAP_HEIGHT, fillHoleRadius, fillHoleThreshold);
  const postFillLandSize = allLand.size;
  
  console.log(`[MAP-GEN] Land tiles: ${preFillLandSize} -> ${postFillLandSize} (filled ${postFillLandSize - preFillLandSize})`);
  
  // ========== STEP 7: Place neutral cities ==========
  
  const allIslands = [playerIsland, aiIsland, ...neutralIslands];
  
  let remainingNeutralCities = neutralCitiesNeeded;
  const neutralCityTiles = [];
  
  for (const island of neutralIslands) {
    if (remainingNeutralCities <= 0) break;

    if (island.tiles.size < 5) continue;
    // Scale cities by island size: 1 city per 20 tiles (min 1, capped to remaining budget).
    // Larger islands from dry-mode generation need proportionally more cities so the
    // total city count reaches targetCities even with fewer, bigger islands.
    const citiesForIsland = Math.min(
      remainingNeutralCities,
      Math.max(1, Math.floor(island.tiles.size / 20))
    );
    const cities = placeCitiesOnIsland(island, citiesForIsland, allLand, MAP_WIDTH, MAP_HEIGHT);
    for (const c of cities) {
      neutralCityTiles.push(c);
      remainingNeutralCities--;
      if (remainingNeutralCities <= 0) break;
    }
  }
  
  // ========== STEP 8: Build final map grid ==========
  
  const map = Array.from({ length: MAP_HEIGHT }, () => Array(MAP_WIDTH).fill(WATER));
  
  allLand.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = LAND;
  });
  
  playerCityTiles.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = PLAYER_CITY;
  });
  
  aiCityTiles.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = AI_CITY;
  });
  
  neutralCityTiles.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = NEUTRAL_CITY;
  });
  
  // ========== Build cities object for game state ==========
  
  const cities = {};
  
  // Only FIRST player city is owned, rest are neutral
  playerCityTiles.forEach((key, index) => {
    const [x, y] = key.split(',').map(Number);
    cities[key] = {
      owner: index === 0 ? 'player' : 'neutral',
      x,
      y,
      producing: index === 0 ? 'tank' : null,  // Only owned city produces
      progress: {}
    };
  });
  
  // Only FIRST AI city is owned, rest are neutral
  aiCityTiles.forEach((key, index) => {
    const [x, y] = key.split(',').map(Number);
    cities[key] = {
      owner: index === 0 ? 'ai' : 'neutral',
      x,
      y,
      producing: index === 0 ? 'tank' : null,  // Only owned city produces
      progress: {}
    };
  });
  
  neutralCityTiles.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    cities[key] = {
      owner: 'neutral',
      x,
      y,
      producing: null,  // Neutral cities don't produce until captured
      progress: {}
    };
  });
  
  // ========== Update map tiles to match city ownership ==========
  // This ensures map visuals match the actual city ownership in cities object
  Object.entries(cities).forEach(([key, city]) => {
    const [x, y] = key.split(',').map(Number);
    if (city.owner === 'player') {
      map[y][x] = PLAYER_CITY;
    } else if (city.owner === 'ai') {
      map[y][x] = AI_CITY;
    } else {
      map[y][x] = NEUTRAL_CITY;
    }
  });
  
  // ========== STEP 9: Calculate statistics ==========
  
  const totalTiles = MAP_WIDTH * MAP_HEIGHT;
  const landTiles = allLand.size;
  const waterTiles = totalTiles - landTiles;
  const actualWaterPercent = Math.round((waterTiles / totalTiles) * 100);
  const islandCount = countDistinctIslands(allLand);
  
  return {
    map,
    cities,  // ADD THIS
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    mapSize,
    terrain,
    difficulty,
    playerCities: playerCityTiles.length,
    aiCities: aiCityTiles.length,
    neutralCities: neutralCityTiles.length,
    totalCities: playerCityTiles.length + aiCityTiles.length + neutralCityTiles.length,
    targetCities: totalCities,
    landTiles,
    waterTiles,
    targetLandTiles,
    targetWaterPercent,
    actualWaterPercent,
    islandCount,
    edgeSeparation,
    minSeparation,
    maxSeparation,
    separationValid,
    playerIslandSize: playerIsland.tiles.size,
    aiIslandSize: aiIsland.tiles.size,
  };
}

/**
 * Generate a map, retrying until valid or max attempts reached
 * @param {string} mapSize - 'small', 'medium', or 'large'
 * @param {string} terrain - 'wet', 'normal', or 'dry'
 * @param {number} difficulty - 1-10
 * @returns {Object} Map data with generation metadata
 */
export function generateMap(mapSize, terrain, difficulty) {
  let attempts = 0;
  let result = null;
  
  while (attempts < MAX_GENERATION_ATTEMPTS) {
    result = generateMapAttempt(mapSize, terrain, difficulty);
    attempts++;
    
    const citiesValid = result.totalCities >= result.targetCities;
    if (result.separationValid && citiesValid) {
      return {
        ...result,
        generationAttempts: attempts,
        generationFailed: false,
      };
    }
  }
  
  // All attempts failed, return the last result with failure flag
  return {
    ...result,
    generationAttempts: attempts,
    generationFailed: true,
  };
}

/**
 * Get map size configuration
 */
export function getMapSizeConfig(mapSize) {
  return MAP_SIZES[mapSize];
}

/**
 * Get terrain configuration
 */
export function getTerrainConfig(terrain) {
  return TERRAIN_TYPES[terrain];
}

/**
 * Get difficulty configuration
 */
export function getDifficultyConfig(difficulty) {
  return DIFFICULTY_LEVELS.find(d => d.value === difficulty);
}

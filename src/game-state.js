// ============================================================================
// STRATEGIC CONQUEST - GAME STATE MODULE
// ============================================================================
// Pure state management - creates, updates, and queries game state.
// All functions are pure (no side effects).
//
// Dependencies: game-constants.js, movement-engine.js
// Line count target: ~200 lines
//
// BUG FIX #1: Air units aboard carriers should remain active in movement queue

import {
  WATER,
  PLAYER_CITY,
  AI_CITY,
  NEUTRAL_CITY,
  UNIT_SPECS,
  MAP_SIZES,
  TERRAIN_TYPES,
  DIFFICULTY_LEVELS,
  STATUS_READY,
  STATUS_WAITING,
  STATUS_SENTRY,
  STATUS_USED,
  STATUS_SKIPPED,
  STATUS_ABOARD,
  STATUS_GOTO,
  STATUS_PATROL
} from './game-constants.js';

import {
  getValidMoves,
  getUnitLocation,
  getCargoCount,
  isOnRefuelTile,
  isAdjacentToWater
} from './movement-engine.js';

// ============================================================================
// STATE CREATION
// ============================================================================

/**
 * Create initial game state from map data
 */
export function createGameState(mapData, mapSize, terrain, difficulty) {
  const { map, width, height, cities } = mapData;
  
  // Find starting cities
  const pCity = Object.values(cities).find(c => c.owner === 'player');
  const aCity = Object.values(cities).find(c => c.owner === 'ai');
  
  // Create starting units
  const units = [
    {
      id: 1,
      type: 'tank',
      owner: 'player',
      x: pCity.x,
      y: pCity.y,
      strength: 2,
      movesLeft: 1,
      fuel: null,
      status: STATUS_READY,
      aboardId: null,
      gotoPath: null,
      patrolPath: null,
      patrolIdx: 0,
      hasBombarded: false
    },
    {
      id: 2,
      type: 'tank',
      owner: 'ai',
      x: aCity.x,
      y: aCity.y,
      strength: 2,
      movesLeft: 1,
      fuel: null,
      status: STATUS_READY,
      aboardId: null,
      gotoPath: null,
      patrolPath: null,
      patrolIdx: 0,
      hasBombarded: false
    }
  ];
  
  return {
    map,
    width,
    height,
    cities,
    units,
    turn: 1,
    activeUnitId: 1,
    nextUnitId: 3,
    mapSize,
    terrain,
    difficulty
  };
}

// ============================================================================
// UNIT STATUS MANAGEMENT
// ============================================================================

/**
 * Set a unit's GoTo path
 */
export function setUnitGoTo(state, unitId, path) {
  return {
    ...state,
    units: state.units.map(u =>
      u.id === unitId
        ? { ...u, gotoPath: path, status: STATUS_GOTO, patrolPath: null }
        : u
    )
  };
}

/**
 * Set a unit's patrol route
 */
export function setUnitPatrol(state, unitId, waypoints) {
  return {
    ...state,
    units: state.units.map(u =>
      u.id === unitId
        ? { ...u, patrolPath: waypoints, patrolIdx: 0, status: STATUS_PATROL, gotoPath: null }
        : u
    )
  };
}

/**
 * Change unit status
 */
export function setUnitStatus(state, unitId, status) {
  return {
    ...state,
    units: state.units.map(u =>
      u.id === unitId
        ? { ...u, status, gotoPath: status === STATUS_SENTRY ? null : u.gotoPath }
        : u
    )
  };
}

/**
 * Board a unit onto a carrier/transport
 */
export function boardUnit(state, unitId, carrierId) {
  return {
    ...state,
    units: state.units.map(u =>
      u.id === unitId
        ? { ...u, aboardId: carrierId, status: STATUS_ABOARD }
        : u
    )
  };
}

/**
 * Unload all cargo from a carrier/transport
 */
export function unloadUnit(state, carrierId) {
  const carrier = state.units.find(u => u.id === carrierId);
  if (!carrier) return { state, unloadedCount: 0 };
  
  let unloadedCount = 0;
  const newUnits = state.units.map(u => {
    if (u.aboardId === carrierId) {
      unloadedCount++;
      return { ...u, x: carrier.x, y: carrier.y, aboardId: null, status: STATUS_READY };
    }
    return u;
  });
  
  return { state: { ...state, units: newUnits }, unloadedCount };
}

// ============================================================================
// CITY MANAGEMENT
// ============================================================================

/**
 * Set city production
 */
export function setCityProduction(state, cityKey, unitType) {
  return {
    ...state,
    cities: {
      ...state.cities,
      [cityKey]: { ...state.cities[cityKey], producing: unitType }
    }
  };
}

// ============================================================================
// TURN MANAGEMENT
// ============================================================================

/**
 * Process end of player turn (reset moves, production, healing)
 */
export function endPlayerTurn(state) {
  let newUnits = [...state.units];
  let newCities = { ...state.cities };
  let nextId = state.nextUnitId;
  
  // Reset player units
  newUnits = newUnits.map(u => {
    if (u.owner !== 'player') return u;
    
    const spec = UNIT_SPECS[u.type];
    const unit = { ...u };
    
    // BUG #7 FIX: Check if unit moved BEFORE resetting movesLeft
    const didNotMove = u.movesLeft === spec.movement && !u.aboardId;
    
    // Reset movement
    unit.movesLeft = spec.movement;
    
    // BOMBARD FIX: Reset bombardment flag
    unit.hasBombarded = false;
    
    // BUG #8 FIX: Damaged naval units (half health or less) have reduced movement by 1
    if (spec.isNaval && unit.strength <= spec.strength / 2) {
      unit.movesLeft = Math.max(1, unit.movesLeft - 1);
      console.log(`[MOVE][BUG8] Damaged naval ${spec.name} (${unit.strength}/${spec.strength}) has reduced movement: ${spec.movement} -> ${unit.movesLeft}`);
    }
    
    // Reset status
    if (unit.status === STATUS_USED || unit.status === STATUS_WAITING || unit.status === STATUS_SKIPPED) {
      unit.status = STATUS_READY;
    }
    
    // BUG #1 FIX: Air units aboard carriers should reset to STATUS_READY (not stay ABOARD)
    // This allows them to be in the movement queue next turn
    if (unit.aboardId && spec.isAir) {
      unit.status = STATUS_READY;
    }
    
    // Heal in city
    // BUG #1 FIX: Units only repair if directly in city OR aboard transport that is in friendly city
    // Units aboard should NOT use their own x,y for city check
    let shouldRepair = false;
    
    if (unit.aboardId) {
      // Unit is aboard - ONLY check carrier's position
      const carrier = newUnits.find(c => c.id === unit.aboardId);
      if (carrier) {
        const carrierCityKey = `${carrier.x},${carrier.y}`;
        const carrierCity = newCities[carrierCityKey];
        if (carrierCity && carrierCity.owner === 'player') {
          shouldRepair = true;
          console.log(`[REPAIR] Unit ${unit.id} aboard transport in friendly city - will repair`);
        }
      }
    } else {
      // Unit is NOT aboard - check its own position
      const cityKey = `${unit.x},${unit.y}`;
      const city = newCities[cityKey];
      if (city && city.owner === 'player') {
        shouldRepair = true;
      }
    }
    
    if (shouldRepair && unit.strength < spec.strength) {
      unit.strength = Math.min(spec.strength, unit.strength + 1);
      console.log(`[REPAIR] Unit ${unit.id} (${spec.name}) repaired: ${unit.strength - 1} -> ${unit.strength}`);
    }
    
    // Handle aircraft fuel
    if (spec.fuel) {
      // BUG #7 FIX: Stationary aircraft consume 1 fuel per turn
      if (didNotMove) {
        unit.fuel = Math.max(0, unit.fuel - 1);
        console.log(`[FUEL][BUG7] Stationary ${spec.name} at (${unit.x},${unit.y}) consumed fuel: ${unit.fuel + 1} -> ${unit.fuel}`);
      }
      
      // Refuel if on refuel tile or aboard carrier
      if (isOnRefuelTile(unit, { ...state, units: newUnits }) || unit.aboardId) {
        const oldFuel = unit.fuel;
        unit.fuel = spec.fuel;
        console.log(`[FUEL][ENDTURN] ${spec.name} refueled at (${unit.x},${unit.y}): ${oldFuel} -> ${unit.fuel}`);
      }
    }
    
    return unit;
  });
  
  // Process player production
  Object.entries(newCities).forEach(([key, city]) => {
    if (city.owner !== 'player' || !city.producing) return;
    
    const spec = UNIT_SPECS[city.producing];
    const progress = (city.progress[city.producing] || 0) + 1;
    
    if (progress >= spec.productionDays) {
      // Spawn new unit
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
        patrolIdx: 0,
        hasBombarded: false
      });
      newCities[key] = { ...city, progress: { ...city.progress, [city.producing]: 0 } };
    } else {
      newCities[key] = { ...city, progress: { ...city.progress, [city.producing]: progress } };
    }
  });
  
  return { ...state, units: newUnits, cities: newCities, nextUnitId: nextId };
}

// ============================================================================
// VICTORY CONDITIONS
// ============================================================================

/**
 * Check victory condition
 * Returns: { status: 'playing' | 'victory' | 'defeat', reason?: string }
 */
export function checkVictoryCondition(state) {
  const cities = Object.values(state.cities);
  const playerCities = cities.filter(c => c.owner === 'player').length;
  const aiCities = cities.filter(c => c.owner === 'ai').length;
  
  if (playerCities === 0) {
    return { status: 'defeat', reason: 'All cities lost' };
  }
  
  if (aiCities === 0) {
    return { status: 'victory', reason: 'All enemy cities captured' };
  }
  
  return { status: 'playing' };
}

// ============================================================================
// UNIT QUERIES
// ============================================================================

/**
 * Helper: Check if unit is an air unit aboard a carrier
 * Air units on carriers should still be active (like being in a mobile city)
 */
function isAirUnitOnCarrier(unit, units) {
  if (!unit.aboardId) return false;
  const spec = UNIT_SPECS[unit.type];
  if (!spec.isAir) return false;
  
  // Verify it's actually aboard a carrier (not some bug state)
  const carrier = units.find(u => u.id === unit.aboardId);
  if (!carrier) return false;
  
  const carrierSpec = UNIT_SPECS[carrier.type];
  return carrierSpec.carriesAir;
}

/**
 * Find next available unit for the player
 * 
 * BUG #1 FIX: Air units aboard carriers should still be in the movement queue
 * Carriers are "mobile cities" for aircraft - fighters can still sortie
 */
export function findNextUnit(state, currentId = null, excludeWaiting = false) {
  const available = state.units.filter(u => {
    // Basic ownership and movement check
    if (u.owner !== 'player') return false;
    if (u.movesLeft <= 0) return false;
    
    // Status exclusions (sentry units don't get turns)
    if (u.status === STATUS_SENTRY) return false;
    if (u.status === STATUS_USED) return false;
    if (u.status === STATUS_SKIPPED) return false;
    if (excludeWaiting && u.status === STATUS_WAITING) return false;
    
    // Don't re-select current unit
    if (u.id === currentId) return false;
    
    // BUG #1 FIX: Handle aboardId check
    // Ground units aboard transports: EXCLUDE from queue (they can't act)
    // Air units aboard carriers: INCLUDE in queue (carriers are mobile airfields)
    if (u.aboardId) {
      // Air units on carriers can still act
      if (isAirUnitOnCarrier(u, state.units)) {
        console.log(`[QUEUE] Air unit ${u.id} (${u.type}) aboard carrier ${u.aboardId} - INCLUDED in movement queue`);
        return true;
      }
      // All other aboard units (tanks in transports) are excluded
      return false;
    }
    
    return true;
  });
  
  if (available.length === 0) {
    // If we excluded waiting, try again with waiting units
    if (excludeWaiting) {
      return findNextUnit(state, currentId, false);
    }
    return null;
  }
  
  // Try to find a unit with higher ID than current
  if (currentId) {
    const idx = available.findIndex(u => u.id > currentId);
    if (idx >= 0) return available[idx].id;
  }
  
  return available[0].id;
}

/**
 * Get all units at a specific location
 */
export function getUnitsAt(state, x, y, includeAboard = false) {
  return state.units.filter(u => {
    if (!includeAboard && u.aboardId) return false;
    const pos = getUnitLocation(u, state.units);
    return pos.x === x && pos.y === y;
  });
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a minimal test game state
 */
export function createTestGameState(overrides = {}) {
  const defaultState = {
    map: [[0, 0], [0, 0]],
    width: 2,
    height: 2,
    cities: {},
    units: [],
    turn: 1,
    activeUnitId: null,
    nextUnitId: 1,
    mapSize: 'small',
    terrain: 'normal',
    difficulty: 5
  };
  return { ...defaultState, ...overrides };
}

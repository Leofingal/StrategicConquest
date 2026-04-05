// ============================================================================
// STRATEGIC CONQUEST - AI OPPONENT (Main Orchestrator)
// ============================================================================
// Coordinates the three AI managers and executes step-by-step movement.
// External interface is unchanged: executeAITurn, createAIKnowledge, etc.
//
// Architecture:
//   ai-opponent.js (this file) - orchestration, knowledge, movement
//   ai-helpers.js - shared utilities, constants, logging
//   ai-city-manager.js - production decisions
//   ai-exploration-manager.js - scout/explore/ferry missions
//   ai-tactical-manager.js - combat/escort/defend missions

import {
  WATER, LAND, NEUTRAL_CITY, PLAYER_CITY, AI_CITY, UNIT_SPECS, ALL_DIRS,
  STATUS_READY, STATUS_GOTO, STATUS_USED, STATUS_SKIPPED, STATUS_ABOARD, STATUS_SENTRY,
  manhattanDistance, CITY_COMBAT, BASE_HIT_CHANCE, NAVAL_VS_LAND_HIT_CHANCE, BOMBARD_HIT_CHANCE
} from './game-constants.js';
// Movement engine not directly needed - managers use ai-helpers
import { calculateVisibility } from './fog-of-war.js';
import { recordCombatStats } from './game-state.js';

// AI modules
import {
  PHASE, AI_CONFIG, TARGET_DIST, TACTICAL_ALLOCATION,
  log, logPhase, logMission, logTurnSummary, logUnitSummary, logObs,
  floodFillLand, getMoveToward, clearPathCache,
  evaluateCombat, getAdjacentEnemies,
  getAdjacentPlayerUnits, isAdjacentToPlayerCity,
  getRefuelPoints, findNearestUnexplored, findBestExploreTarget, findCoastExploreTarget
} from './ai-helpers.js';
import { planProduction } from './ai-city-manager.js';
import { assignExplorationMissions, updateIslandKnowledge } from './ai-exploration-manager.js';
import { assignTacticalMissions, detectThreats, getNavalDangerZone } from './ai-tactical-manager.js';

// Re-export config for external consumers
export { PHASE, AI_CONFIG };
export const setAIConfig = (c) => Object.assign(AI_CONFIG, c);
export const getAIConfig = () => ({ ...AI_CONFIG });

// ============================================================================
// AI KNOWLEDGE
// ============================================================================

export function createAIKnowledge(startX, startY, homeIslandTiles = null, homeIslandCityKeys = null) {
  return {
    exploredTiles: new Set(),
    startPosition: (startX != null && startY != null) ? { x: startX, y: startY } : null,
    explorationPhase: PHASE.LAND,
    hasSeenPlayerUnit: false,
    hasSeenPlayerCity: false,
    homeIslandTiles: homeIslandTiles || null,
    homeIslandCities: homeIslandCityKeys ? new Set(homeIslandCityKeys) : new Set(),
    lostCities: new Set(),
    lastTurnObservations: [],
    knownCities: new Set(),
    islands: [],  // Partial island tracking
    activeMissions: {}  // Persisted transport missions: unitId -> mission (survives between turns)
  };
}

export function getAIStartPosition(gameState) {
  if (!gameState?.cities) return null;
  const aiCity = Object.values(gameState.cities).find(c => c.owner === 'ai');
  return aiCity ? { x: aiCity.x, y: aiCity.y } : null;
}

export function createAIKnowledgeFromState(gameState) {
  const startPos = getAIStartPosition(gameState);
  // Compute home island from clean initial state so it isn't corrupted by later game events
  let homeIslandTiles = null;
  let homeIslandCityKeys = null;
  if (startPos) {
    homeIslandTiles = floodFillLand(startPos.x, startPos.y, gameState);
    homeIslandCityKeys = [];
    for (const key of homeIslandTiles) {
      if (gameState.cities[key]) homeIslandCityKeys.push(key);
    }
  }
  const k = createAIKnowledge(startPos?.x, startPos?.y, homeIslandTiles, homeIslandCityKeys);
  const visibility = calculateVisibility(gameState, 'ai');
  for (const key of visibility) {
    k.exploredTiles.add(key);
    if (gameState.cities[key]) k.knownCities.add(key);
  }
  return k;
}

export function recordPlayerObservations(k, observations) {
  return { ...k, lastTurnObservations: observations };
}

// ============================================================================
// MID-TURN EVENT HELPERS
// ============================================================================

/**
 * Find nearest unexplored tile reachable from the unit's current position
 * (constrained to the provided flood-fill reachable set for land units).
 */
function findNearestReachableUnexplored(unit, state, knowledge, reachableSet) {
  const { width, height } = state;
  let best = null, bestDist = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (knowledge.exploredTiles.has(`${x},${y}`)) continue;
      if (!reachableSet.has(`${x},${y}`)) continue;
      const dist = manhattanDistance(unit.x, unit.y, x, y);
      if (dist < bestDist) { bestDist = dist; best = { x, y }; }
    }
  }
  return best;
}

/**
 * Resolve city capture combat using the same dice rules as the player.
 * City has strength 1, 1 defense die, defenseDamagePerHit 1.
 * Returns { cityDead, attRem }.
 */
function resolveAICityAttack(attacker) {
  const spec = UNIT_SPECS[attacker.type];
  const aRatio = attacker.strength / spec.strength;
  const aRolls = spec.halfStrengthCombat
    ? Math.max(1, Math.ceil(attacker.strength * 0.5))
    : Math.max(1, Math.round(spec.attackRolls * aRatio));
  // City always has 1 defense roll at full strength (matches CITY_COMBAT spec)
  const dRolls = CITY_COMBAT.defenseRolls;

  let dmgToDef = 0, dmgToAtt = 0;
  for (let i = 0; i < aRolls; i++) if (Math.random() < BASE_HIT_CHANCE) dmgToDef += spec.damagePerHit;
  for (let i = 0; i < dRolls; i++) if (Math.random() < BASE_HIT_CHANCE) dmgToAtt += CITY_COMBAT.defenseDamagePerHit;

  return {
    cityDead: dmgToDef >= CITY_COMBAT.strength,
    attRem: Math.max(0, attacker.strength - dmgToAtt)
  };
}

/**
 * When a capturable city is discovered mid-turn, redirect the nearest eligible
 * AI tank on the same landmass from its current explore mission to capture it.
 * Only tanks with low-priority explore missions are candidates (not units already
 * assigned to capture/garrison/high-priority tasks).
 */
function redirectNearestTankToCapture(state, knowledge, missions, cx, cy) {
  const cityLandmass = floodFillLand(cx, cy, state);
  let bestTank = null, bestDist = Infinity;

  for (const unit of state.units) {
    if (unit.owner !== 'ai' || unit.type !== 'tank' || unit.aboardId) continue;
    if (unit.movesLeft <= 0) continue;
    if (!cityLandmass.has(`${unit.x},${unit.y}`)) continue;

    // Only redirect low-priority explore missions — don't override capture/garrison/combat
    const mission = missions.get(unit.id);
    const mType = mission?.mission?.type;
    if (mType === 'capture_city' || mType === 'attack_city' || mType === 'garrison') continue;

    const dist = manhattanDistance(unit.x, unit.y, cx, cy);
    if (dist < bestDist) { bestDist = dist; bestTank = unit; }
  }

  if (bestTank) {
    log(`City discovery event: redirecting tank#${bestTank.id} → capture (${cx},${cy})`);
    missions.set(bestTank.id, {
      mission: {
        type: 'capture_city',
        target: { x: cx, y: cy },
        targetKey: `${cx},${cy}`,
        priority: 7,
        assignedBy: 'event',
        reason: `discovered city (${cx},${cy})`
      }
    });
  }
}

// ============================================================================
// KNOWLEDGE UPDATE
// ============================================================================

function updateAIKnowledge(k, state) {
  let knowledge = {
    ...k,
    exploredTiles: new Set(k.exploredTiles),
    knownCities: new Set(k.knownCities || new Set()),
    islands: k.islands ? k.islands.map(i => ({
      ...i,
      tiles: new Set(i.tiles),
      cities: new Set(i.cities),
      coastTiles: new Set(i.coastTiles || new Set())
    })) : []
  };

  // Auto-init start position
  if (!knowledge.startPosition) {
    const startPos = getAIStartPosition(state);
    if (startPos) {
      knowledge.startPosition = startPos;
      log(`Auto-init start: (${startPos.x},${startPos.y})`);
    }
  }

  const vis = calculateVisibility(state, 'ai');

  for (const key of vis) {
    knowledge.exploredTiles.add(key);
    if (state.cities[key]) knowledge.knownCities.add(key);
  }

  // Player contact check
  for (const key of vis) {
    const [x, y] = key.split(',').map(Number);
    if (state.units.find(u => u.x === x && u.y === y && u.owner === 'player' && !u.aboardId)) {
      knowledge.hasSeenPlayerUnit = true;
    }
    if (state.cities[key]?.owner === 'player') knowledge.hasSeenPlayerCity = true;
  }

  // Track lost cities
  for (const [key, city] of Object.entries(state.cities)) {
    if (city.owner === 'player' && knowledge.knownCities.has(key)) {
      knowledge.lostCities.add(key);
    }
  }

  // Home island init (fallback if not seeded at game creation)
  if (!knowledge.homeIslandTiles && knowledge.startPosition) {
    knowledge.homeIslandTiles = floodFillLand(knowledge.startPosition.x, knowledge.startPosition.y, state);
    log(`Home island: ${knowledge.homeIslandTiles.size} tiles`);
  }
  // Update homeIslandCities each turn — catches newly-discovered cities on home island
  if (knowledge.homeIslandTiles) {
    for (const key of knowledge.homeIslandTiles) {
      if (state.cities[key] && !knowledge.homeIslandCities.has(key)) {
        knowledge.homeIslandCities.add(key);
        log(`Home island city discovered: ${key}`);
      }
    }
    if (knowledge.homeIslandCities.size === 0) {
      log(`Home island cities: 0 (warning: no cities found on home island)`);
    }
  }

  // Update island tracking
  knowledge = updateIslandKnowledge(knowledge, state);

  return knowledge;
}

// ============================================================================
// PHASE DETERMINATION
// ============================================================================

function determinePhase(k, state) {
  const { explorationPhase } = k;
  const cities = Object.values(state.cities);
  const aiCities = cities.filter(c => c.owner === 'ai').length;
  const playerCities = cities.filter(c => c.owner === 'player').length;
  const neutralCities = cities.filter(c => c.owner === 'neutral').length;
  const totalCities = cities.length;
  const aiUnits = state.units.filter(u => u.owner === 'ai' && !u.aboardId);
  const playerUnits = state.units.filter(u => u.owner === 'player' && !u.aboardId);

  const homeExp = getHomeExplored(k, state);
  const homeCitiesCaptured = checkHomeCitiesCaptured(k, state);
  const totalTiles = state.width * state.height;
  const mapExplored = k.exploredTiles.size / totalTiles;

  // Debug: always log phase check values

  // LAND -> TRANSITION
  if (explorationPhase === PHASE.LAND) {
    // PRIMARY: All home island cities captured - this is the strategic goal of land phase
    if (homeCitiesCaptured && k.homeIslandCities && k.homeIslandCities.size > 0) {
      logPhase(`LAND -> TRANSITION: All ${k.homeIslandCities.size} home cities captured (homeExp=${(homeExp*100).toFixed(0)}%)`);
      return PHASE.TRANSITION;
    }
    // TANK THRESHOLD: Once 6 active tanks exist, the land force is large enough
    // to keep capturing home cities without full focus — start naval production now.
    const activeTanks = state.units.filter(u => u.owner === 'ai' && u.type === 'tank' && !u.aboardId).length;
    if (activeTanks >= 6) {
      logPhase(`LAND -> TRANSITION: 6 active tanks (${activeTanks}) — starting naval ramp`);
      return PHASE.TRANSITION;
    }
    // SECONDARY: 90% explored + cities captured (original trigger)
    if (homeExp >= AI_CONFIG.exploration.homeComplete && homeCitiesCaptured) {
      logPhase(`LAND -> TRANSITION: Home ${(homeExp*100).toFixed(0)}% + cities captured`);
      return PHASE.TRANSITION;
    }
    // FALLBACK: 100% home explored
    if (homeExp >= 1.0) {
      logPhase(`LAND -> TRANSITION: Home 100%`);
      return PHASE.TRANSITION;
    }
    // EDGE CASE: explored a lot but stuck
    if (mapExplored > 0.05 && aiCities >= 2) {
      logPhase(`LAND -> TRANSITION: Edge case ${(mapExplored*100).toFixed(1)}% explored, ${aiCities} cities`);
      return PHASE.TRANSITION;
    }
  }

  // TRANSITION -> NAVAL
  if (explorationPhase === PHASE.TRANSITION) {
    if (k.hasSeenPlayerUnit || k.hasSeenPlayerCity) {
      logPhase(`TRANSITION -> NAVAL: Player contact`);
      return PHASE.NAVAL;
    }
    if (mapExplored >= AI_CONFIG.exploration.navalMapThreshold) {
      logPhase(`TRANSITION -> NAVAL: ${(mapExplored*100).toFixed(1)}% explored`);
      return PHASE.NAVAL;
    }
  }

  // NAVAL -> LATE_GAME (requires minimum map exploration)
  if (explorationPhase === PHASE.NAVAL) {
    const neutralRatio = totalCities > 0 ? neutralCities / totalCities : 1;
    const aiControl = totalCities > 0 ? aiCities / totalCities : 0;
    const aiStr = aiUnits.reduce((s, u) => s + u.strength, 0);
    const pStr = playerUnits.reduce((s, u) => s + u.strength, 0);

    if (mapExplored >= AI_CONFIG.exploration.lateMapExplored) {
      if (neutralRatio < AI_CONFIG.exploration.lateNeutral) return PHASE.LATE_GAME;
      if (aiControl >= AI_CONFIG.exploration.lateCityControl) return PHASE.LATE_GAME;
      if (pStr > 0 && aiStr / pStr >= AI_CONFIG.exploration.lateStrength) return PHASE.LATE_GAME;
    } else {
      logPhase(`LATE_GAME blocked: map only ${(mapExplored*100).toFixed(1)}% explored (need ${(AI_CONFIG.exploration.lateMapExplored*100).toFixed(0)}%)`);
    }
  }

  return explorationPhase;
}

function getHomeExplored(k, state) {
  if (!k.homeIslandTiles || k.homeIslandTiles.size === 0) return 0;
  let explored = 0;
  for (const key of k.homeIslandTiles) {
    if (k.exploredTiles.has(key)) explored++;
  }
  return explored / k.homeIslandTiles.size;
}

function checkHomeCitiesCaptured(k, state) {
  if (!k.homeIslandCities || k.homeIslandCities.size === 0) return true;
  for (const key of k.homeIslandCities) {
    if (state.cities[key]?.owner !== 'ai') return false;
  }
  return true;
}

// ============================================================================
// UNIT ALLOCATION
// ============================================================================

/**
 * Split units between exploration and tactical managers based on phase.
 */
function allocateUnits(state, phase) {
  const aiUnits = state.units.filter(u => u.owner === 'ai' && !u.aboardId && u.movesLeft > 0);
  const explorationUnits = [];
  const tacticalUnits = [];
  const allocation = TACTICAL_ALLOCATION[phase] || TACTICAL_ALLOCATION[PHASE.LAND];

  // Tanks and transports always go to exploration
  for (const unit of aiUnits) {
    if (unit.type === 'tank' || unit.type === 'transport') {
      explorationUnits.push(unit);
      continue;
    }

    const tacticalPct = allocation[unit.type] || 0;
    if (tacticalPct <= 0) {
      explorationUnits.push(unit);
    } else if (tacticalPct >= 1.0) {
      tacticalUnits.push(unit);
    } else {
      // Split: use unit ID for deterministic assignment
      if ((unit.id % 100) / 100 < tacticalPct) {
        tacticalUnits.push(unit);
      } else {
        explorationUnits.push(unit);
      }
    }
  }

  return { explorationUnits, tacticalUnits };
}

// ============================================================================
// STEP-BY-STEP MOVEMENT EXECUTION
// ============================================================================

function executeStepByStepMovements(state, knowledge, turnLog, missions, observerMode = false) {
  const MAX_MOVES = 20;
  let s = { ...state, units: [...state.units], cities: { ...state.cities }, map: state.map.map(r => [...r]) };
  let k = {
    ...knowledge,
    exploredTiles: new Set(knowledge.exploredTiles),
    knownCities: new Set(knowledge.knownCities || new Set()),
    islands: knowledge.islands ? knowledge.islands.map(i => ({
      ...i, tiles: new Set(i.tiles), cities: new Set(i.cities), coastTiles: new Set(i.coastTiles || new Set())
    })) : []
  };
  const observations = [];
  const combatEvents = [];  // Track detailed combat results for player report
  const contactEvents = [];  // Track first AI contact with player territory
  let threats = detectThreats(s, k);

  // Observer mode: track every tile visited per unit
  const observerPositionLog = new Map();
  if (observerMode) {
    for (const unit of s.units) {
      if (unit.owner === 'ai' && !unit.aboardId) {
        observerPositionLog.set(unit.id, [{ x: unit.x, y: unit.y }]);
      }
    }
  }

  // Observation tracking
  const observationState = new Map();
  for (const unit of s.units) {
    if (unit.owner === 'ai' && !unit.aboardId) {
      const startObs = getAdjacentPlayerUnits(unit.x, unit.y, s.units);
      const startCity = isAdjacentToPlayerCity(unit.x, unit.y, s.cities);
      observationState.set(unit.id, {
        trail: [{ x: unit.x, y: unit.y }],
        wasObserved: startObs.length > 0 || startCity,
        observers: [...startObs]
      });
    }
  }

  // Helper: record position after each move in observer mode
  const trackPos = (unitId) => {
    if (!observerMode) return;
    const u = s.units.find(u => u.id === unitId);
    if (u) {
      const log = observerPositionLog.get(unitId);
      if (log) log.push({ x: u.x, y: u.y });
    }
  };

  for (let movesRequired = MAX_MOVES; movesRequired >= 1; movesRequired--) {
    const unitsWithMoves = s.units.filter(u =>
      u.owner === 'ai' && !u.aboardId && u.movesLeft === movesRequired
    );
    if (unitsWithMoves.length === 0) continue;

    for (const unitRef of unitsWithMoves) {
      const unitIdx = s.units.findIndex(u => u.id === unitRef.id);
      if (unitIdx < 0) continue;
      const unit = s.units[unitIdx];
      if (unit.movesLeft !== movesRequired) continue;

      // === PRE-MOVEMENT: Transport load check ===
      // If transport is at a pickup city (arrived last turn), load tanks NOW before deciding where to go
      if (UNIT_SPECS[unit.type]?.carriesTanks) {
        const currentMission = missions.get(unit.id)?.mission;
        if (currentMission?.type === 'transport_pickup' && currentMission.pickupCity) {
          const [pcx, pcy] = currentMission.pickupCity.split(',').map(Number);
          if (manhattanDistance(unit.x, unit.y, pcx, pcy) <= 1) {
            s = handleTransportAutoLoad(s, unitIdx, turnLog, currentMission);
          }
        }
      }

      // === PRE-MOVEMENT: Transport unload check ===
      // If transport has cargo and is adjacent to a capturable city, unload NOW
      // This handles the case where the transport arrived last turn and is sitting at target
      if (UNIT_SPECS[unit.type]?.carriesTanks) {
        const cargo = s.units.filter(cu => cu.aboardId === unit.id);
        if (cargo.length > 0) {
          const unloadResult = tryTransportUnload(s, unitIdx, turnLog, missions);
          if (unloadResult.unloaded) {
            s = unloadResult.state;
            // Re-find unit index after state mutation
            const newIdx = s.units.findIndex(u => u.id === unit.id);
            if (newIdx >= 0) {
              s.units[newIdx] = { ...s.units[newIdx], movesLeft: 0, status: STATUS_USED };
            }
            continue; // Transport is done for this turn
          }
        }
      }

      const decision = decideNextStep(unit, s, k, threats, missions);

      if (decision.action === 'wait') {
        s.units[unitIdx] = { ...unit, movesLeft: 0, status: STATUS_USED };
        continue;
      }

      if (decision.action === 'attack') {
        const t = decision.target;
        turnLog.push(`${unit.type}@${unit.x},${unit.y} attacks ${t.enemy.type}`);
        const result = handleCombat(s, unitIdx, t, t.enemy, turnLog);
        s = result.state;
        
        // Record detailed combat event for player report
        if (result.combatEvent) {
          combatEvents.push(result.combatEvent);
        }
        
        updateObservation(observationState, unit.id, t.x, t.y, true);
        continue;
      }

      if (decision.action === 'capture') {
        const t = decision.target;
        const cityKey = `${t.x},${t.y}`;
        const combatResult = resolveAICityAttack(unit);

        if (combatResult.cityDead) {
          // Capture successful
          turnLog.push(`${unit.type} captured city at ${t.x},${t.y}`);
          s.cities = { ...s.cities, [cityKey]: { ...t.city, owner: 'ai', producing: 'tank', progress: {} } };
          s.map[t.y][t.x] = AI_CITY;
          // Refuel any friendly aircraft on the newly captured city tile
          s.units = s.units.map(u => {
            if (u.x === t.x && u.y === t.y && u.owner === 'ai' && !u.aboardId && UNIT_SPECS[u.type].isAir && UNIT_SPECS[u.type].fuel) {
              return { ...u, fuel: UNIT_SPECS[u.type].fuel };
            }
            return u;
          });
          s.units = s.units.filter(u => u.id !== unit.id); // tank becomes garrison
        } else if (combatResult.attRem <= 0) {
          // Tank destroyed in failed assault
          turnLog.push(`${unit.type} destroyed assaulting city at ${t.x},${t.y}`);
          s.units = s.units.filter(u => u.id !== unit.id);
        } else {
          // Capture failed — tank takes damage, will retry next turn
          turnLog.push(`${unit.type} failed to capture city at ${t.x},${t.y} (str ${combatResult.attRem} remaining)`);
          s.units[unitIdx] = { ...unit, strength: combatResult.attRem, movesLeft: 0, status: STATUS_USED };
        }
        continue;
      }

      if (decision.action === 'bombard') {
        const t = decision.target;
        turnLog.push(`${unit.type}@${unit.x},${unit.y} bombards ${t.enemy.type}@${t.x},${t.y}`);
        const result = handleAIBombardment(s, unitIdx, t, turnLog);
        s = result.state;
        if (result.combatEvent) combatEvents.push(result.combatEvent);
        updateObservation(observationState, unit.id, t.x, t.y, true);
        continue;
      }

      if (decision.action === 'move_toward') {
        // Transports avoid known enemy naval positions — compute danger zone tiles once
        // per move decision and pass as tile cost hints to the pathfinder.
        const avoidTiles = UNIT_SPECS[unit.type]?.carriesTanks ? getNavalDangerZone(s, k) : null;
        const moveTarget = getMoveToward(unit, decision.target, s, avoidTiles);
        if (moveTarget) {
          if (observerMode) logObs(`    #${unit.id} ${unit.type}@(${unit.x},${unit.y})→(${moveTarget.x},${moveTarget.y}) [${decision.reason}] moves=${unit.movesLeft - 1}${unit.fuel != null ? ` fuel=${unit.fuel - 1}` : ''}`);
          s = executeMove(s, unitIdx, moveTarget, unit, turnLog, observationState, missions.get(unit.id)?.mission);
          trackPos(unit.id);
          // Post-move unload: if this transport just used its last move and is now
          // adjacent to a capturable city, assault immediately rather than waiting a turn.
          if (UNIT_SPECS[unit.type]?.carriesTanks) {
            const postIdx = s.units.findIndex(u => u.id === unit.id);
            if (postIdx >= 0 && s.units[postIdx].movesLeft === 0) {
              const postCargo = s.units.filter(cu => cu.aboardId === unit.id);
              if (postCargo.length > 0) {
                const postUnload = tryTransportUnload(s, postIdx, turnLog, missions);
                if (postUnload.unloaded) s = postUnload.state;
              }
            }
          }
        } else {
          // getMoveToward returned null: the assigned target is unreachable (e.g. explore
          // target just became explored by this unit's own vision, or target is on a
          // different land mass). Clear the stale mission and try a fallback before stalling.
          missions.delete(unit.id);
          let rescued = false;
          const spec = UNIT_SPECS[unit.type];

          if (spec?.isLand) {
            const reachable = floodFillLand(unit.x, unit.y, s);
            const altTarget = findNearestReachableUnexplored(unit, s, k, reachable);
            if (altTarget) {
              const altMove = getMoveToward(unit, altTarget, s, null);
              if (altMove) {
                s = executeMove(s, unitIdx, altMove, unit, turnLog, observationState, null);
                trackPos(unit.id);
                rescued = true;
              }
            }
          } else if (spec.isNaval) {
            const altTarget = findBestExploreTarget(unit, s, k, 'water');
            if (altTarget) {
              const altMove = getMoveToward(unit, altTarget, s, null);
              if (altMove) {
                s = executeMove(s, unitIdx, altMove, unit, turnLog, observationState, null);
                trackPos(unit.id);
                rescued = true;
              }
            }
          } else if (spec.isAir) {
            // Air units: find nearest unexplored (fuel permitting) or return to base
            const refuelPoints = getRefuelPoints(s);
            const chebDistLocal = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
            const nearestRefuel = refuelPoints.reduce((best, p) => {
              const d = chebDistLocal(unit.x, unit.y, p.x, p.y);
              const bestD = best ? chebDistLocal(unit.x, unit.y, best.x, best.y) : Infinity;
              return d < bestD ? p : best;
            }, null);
            const distToRefuel = nearestRefuel
              ? chebDistLocal(unit.x, unit.y, nearestRefuel.x, nearestRefuel.y) : Infinity;
            if (nearestRefuel && unit.fuel - distToRefuel > 4) {
              const altTarget = findNearestUnexplored(unit, s, k);
              if (altTarget) {
                const altMove = getMoveToward(unit, altTarget, s, null);
                if (altMove) {
                  s = executeMove(s, unitIdx, altMove, unit, turnLog, observationState, null);
                  trackPos(unit.id);
                  rescued = true;
                }
              }
            }
            if (!rescued && nearestRefuel && distToRefuel > 0) {
              const altMove = getMoveToward(unit, nearestRefuel, s, null);
              if (altMove) {
                s = executeMove(s, unitIdx, altMove, unit, turnLog, observationState, null);
                trackPos(unit.id);
                rescued = true;
              }
            }
          }

          if (!rescued) {
            s.units[unitIdx] = { ...unit, movesLeft: 0, status: STATUS_USED };
          }
        }
      }
    }

    // Update fog after each sub-step level
    const newVis = calculateVisibility(s, 'ai');
    const prevSize = k.exploredTiles.size;
    for (const key of newVis) {
      k.exploredTiles.add(key);
      if (s.cities[key] && !k.knownCities.has(key)) {
        k.knownCities.add(key);
        const discoveredCity = s.cities[key];
        log(`Discovered ${discoveredCity.owner} city`);
        // Mid-turn event: capturable city discovered → redirect nearest eligible tank
        if (discoveredCity.owner === 'neutral' || discoveredCity.owner === 'player') {
          const [cx, cy] = key.split(',').map(Number);
          redirectNearestTankToCapture(s, k, missions, cx, cy);
        }
      }
    }
    const newTiles = k.exploredTiles.size - prevSize;
    if (newTiles > 5) {
      // Only update islands when meaningful new territory discovered
      k = updateIslandKnowledge(k, s);
    }

    // Update threats
    threats = detectThreats(s, k);

    // Contact check — record first-time discoveries for the player summary
    for (const key of newVis) {
      const [x, y] = key.split(',').map(Number);
      const playerUnit = s.units.find(u => u.x === x && u.y === y && u.owner === 'player' && !u.aboardId);
      if (playerUnit) {
        if (!k.hasSeenPlayerUnit) {
          contactEvents.push({ type: 'found_unit', x, y, unitType: playerUnit.type });
        }
        k.hasSeenPlayerUnit = true;
      }
      if (s.cities[key]?.owner === 'player') {
        if (!k.hasSeenPlayerCity) {
          contactEvents.push({ type: 'found_city', x, y });
        }
        k.hasSeenPlayerCity = true;
      }
    }
  }

  // Mark remaining units as done
  s.units = s.units.map(u => {
    if (u.owner === 'ai' && u.movesLeft > 0 && !u.aboardId) {
      return { ...u, movesLeft: 0, status: STATUS_USED };
    }
    return u;
  });

  // Compile observations
  for (const [unitId, obsState] of observationState) {
    if (obsState.trail.length > 1) {
      const unit = s.units.find(u => u.id === unitId);
      observations.push({
        unitType: unit?.type || 'unknown',
        unitId,
        trail: obsState.trail,
        observedBy: [...new Set(obsState.observers.map(o => o.id))],
        combat: turnLog.some(l => l.includes('COMBAT'))
      });
    }
  }

  return { state: s, knowledge: k, observations, combatEvents, contactEvents, observerPositionLog };
}

// ============================================================================
// PER-STEP DECISION (immediate reactions + mission following)
// ============================================================================

function decideNextStep(unit, state, knowledge, threats, missions) {
  const spec = UNIT_SPECS[unit.type];

  // Collect city lists
  const aiCities = Object.values(state.cities).filter(c => c.owner === 'ai');

  // ===== FUEL CRITICAL =====
  // chebDist helper for Chebyshev (8-directional) fuel planning
  const chebDist = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  let _nearestRefuel = null; // cached for per-step check below
  if (spec.fuel) {
    const refuelPoints = getRefuelPoints(state);
    if (refuelPoints.length > 0) {
      // Use Chebyshev distance for aircraft — matches actual fuel cost (diagonal moves allowed)
      _nearestRefuel = refuelPoints.reduce((best, p) => {
        const d = chebDist(unit.x, unit.y, p.x, p.y);
        const bestD = best ? chebDist(unit.x, unit.y, best.x, best.y) : Infinity;
        return d < bestD ? p : best;
      }, null);
      const distToRefuel = _nearestRefuel
        ? chebDist(unit.x, unit.y, _nearestRefuel.x, _nearestRefuel.y)
        : Infinity;
      if (unit.fuel <= distToRefuel + 2) {
        return { action: 'move_toward', target: _nearestRefuel, reason: 'fuel_critical' };
      }
    }
  }

  // ===== REPAIR RETREAT =====
  // Naval units (not air) retreat to a city when badly damaged, then stay until
  // healed to 75%+ before resuming. This prevents oscillation where the mission
  // system immediately pulls the unit back out before it can heal.
  if (spec.isNaval && !spec.isAir) {
    const inAICity = state.cities[`${unit.x},${unit.y}`]?.owner === 'ai';
    const healThreshold = spec.strength * 0.75;
    const retreatThreshold = spec.strength * 0.5;

    if (inAICity && unit.strength < healThreshold) {
      // Already at a repair city — stay until healed to 75%+
      return { action: 'wait', reason: 'repairing_in_city' };
    }

    if (!inAICity && unit.strength < retreatThreshold) {
      // Below 50% and not in a city — retreat unless friendly fleet locally dominates
      const nearbyFriendlyStr = state.units
        .filter(u => u.owner === 'ai' && !u.aboardId && UNIT_SPECS[u.type]?.isNaval &&
                     manhattanDistance(u.x, u.y, unit.x, unit.y) <= 4)
        .reduce((sum, u) => sum + u.strength, 0);
      const nearbyEnemyStr = state.units
        .filter(u => u.owner === 'player' && !u.aboardId &&
                     manhattanDistance(u.x, u.y, unit.x, unit.y) <= 4)
        .reduce((sum, u) => sum + u.strength, 0);
      const friendlyDominates = nearbyEnemyStr === 0 || nearbyFriendlyStr >= nearbyEnemyStr * 1.5;
      if (!friendlyDominates) {
        const repairTarget = aiCities.reduce((best, c) => {
          const d = manhattanDistance(unit.x, unit.y, c.x, c.y);
          return (!best || d < best.d) ? { x: c.x, y: c.y, d } : best;
        }, null);
        if (repairTarget) {
          log(`[REPAIR] ${spec.name}#${unit.id} at ${unit.strength}/${spec.strength} hp retreating to (${repairTarget.x},${repairTarget.y})`);
          return { action: 'move_toward', target: repairTarget, reason: 'repair_retreat' };
        }
      }
    }
  }

  // ===== ADJACENT ATTACK OPPORTUNITY =====
  const adjacentEnemies = getAdjacentEnemies(unit, state);
  for (const { enemy, x, y } of adjacentEnemies) {
    const evaluation = evaluateCombat(unit, enemy, state);
    if (evaluation.shouldAttack) {
      return { action: 'attack', target: { x, y, enemy }, reason: evaluation.reason };
    }
  }

  // ===== BOMBARD OPPORTUNITY (range-2, Chebyshev) =====
  // Battleships can bombard before/after moving — check for high-value targets at exactly range 2.
  if (spec.canBombard && !unit.hasBombarded) {
    let bestTarget = null, bestValue = -1;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue; // Chebyshev == 2
        const bx = unit.x + dx, by = unit.y + dy;
        if (bx < 0 || bx >= state.width || by < 0 || by >= state.height) continue;
        const enemiesAt = state.units.filter(u => u.x === bx && u.y === by && u.owner !== unit.owner && !u.aboardId);
        for (const enemy of enemiesAt) {
          const eSpec = UNIT_SPECS[enemy.type];
          if (!eSpec) continue;
          const val = (eSpec.productionDays || 0) +
            state.units.filter(cu => cu.aboardId === enemy.id)
              .reduce((sum, cu) => sum + (UNIT_SPECS[cu.type]?.productionDays || 0), 0);
          if (val > bestValue) { bestValue = val; bestTarget = { x: bx, y: by, enemy }; }
        }
      }
    }
    if (bestTarget) {
      log(`[BOMBARD] ${spec.name}#${unit.id} at (${unit.x},${unit.y}) bombarding ${bestTarget.enemy.type} at (${bestTarget.x},${bestTarget.y}) value=${bestValue}`);
      return { action: 'bombard', target: bestTarget, reason: 'bombard_opportunity' };
    }
  }

  // ===== ADJACENT CITY CAPTURE =====
  if (spec.canCapture) {
    for (const [dx, dy] of ALL_DIRS) {
      const nx = unit.x + dx, ny = unit.y + dy;
      const city = state.cities[`${nx},${ny}`];
      if (city && (city.owner === 'neutral' || city.owner === 'player')) {
        const defenders = state.units.filter(d =>
          d.x === nx && d.y === ny && d.owner === 'player' && !d.aboardId
        );
        if (defenders.length === 0) {
          return { action: 'capture', target: { x: nx, y: ny, city }, reason: 'adjacent_city' };
        }
      }
    }
  }

  // ===== TRANSPORT WITH CARGO: Dynamic destination finding =====
  // If transport has loaded tanks but its mission was just a pickup (or no delivery target),
  // dynamically find a city to deliver to, or explore water while carrying cargo.
  if (spec.carriesTanks) {
    const cargo = state.units.filter(cu => cu.aboardId === unit.id);
    const assignment = missions.get(unit.id);
    const mission = assignment?.mission;

    if (cargo.length > 0) {
      const isPickupMission = mission?.type === 'transport_pickup';
      const isDeliveryWithoutTarget = mission?.type === 'ferry_invasion' && !mission.targetKey;
      const isAtPickupTarget = isPickupMission && mission.target &&
        manhattanDistance(unit.x, unit.y, mission.target.x, mission.target.y) <= 1;

      if (isPickupMission || isDeliveryWithoutTarget) {
        // If we haven't reached the pickup point yet, keep going there to load more
        if (isPickupMission && !isAtPickupTarget) {
          return { action: 'move_toward', target: mission.target, reason: 'transport_pickup_enroute' };
        }

        // We have cargo - find a delivery destination
        // Priority 1: Known neutral or player cities
        const knownCities = [];
        for (const [key, city] of Object.entries(state.cities)) {
          if (!knowledge.exploredTiles.has(key)) continue;
          if (city.owner === 'neutral' || city.owner === 'player') {
            knownCities.push(city);
          }
        }

        if (knownCities.length > 0) {
          // Find nearest city and route to adjacent water
          const sorted = knownCities
            .map(c => ({ ...c, dist: manhattanDistance(unit.x, unit.y, c.x, c.y) }))
            .sort((a, b) => a.dist - b.dist);

          for (const dest of sorted) {
            // Find water tile adjacent to city
            for (const [ddx, ddy] of ALL_DIRS) {
              const wx = dest.x + ddx, wy = dest.y + ddy;
              if (state.map[wy]?.[wx] === WATER) {
                log(`[TRANSPORT] #${unit.id} loaded, redirecting to city (${dest.x},${dest.y}) via water (${wx},${wy})`);
                // Update the mission in-place for future steps this turn
                missions.set(unit.id, {
                  mission: {
                    type: 'ferry_invasion',
                    target: { x: wx, y: wy },
                    targetKey: `${dest.x},${dest.y}`,
                    priority: 8,
                    assignedBy: 'exploration',
                    reason: `deliver to city (${dest.x},${dest.y})`
                  }
                });
                return { action: 'move_toward', target: { x: wx, y: wy }, reason: 'transport_deliver' };
              }
            }
          }
        }

        // Priority 2: No known cities - explore water to find new islands
        log(`[TRANSPORT] #${unit.id} loaded but no target cities, exploring`);
        const waterTarget = findBestExploreTarget(unit, state, knowledge, 'water');
        if (waterTarget) {
          return { action: 'move_toward', target: waterTarget, reason: 'transport_explore_loaded' };
        }

        // Priority 3: No water to explore - wait
        return { action: 'wait', reason: 'transport_loaded_no_destination' };
      }
    }
  }

  // ===== TRANSPORT: EVADE NEARBY NAVAL THREATS =====
  // If a transport finds itself within close range of an enemy combat ship, abort the
  // current mission and retreat toward the nearest friendly city. The avoidTiles routing
  // in getMoveToward handles proactive rerouting; this handles reactive evasion when
  // already inside the danger zone.
  if (spec.carriesTanks) {
    const nearbyThreats = threats.playerNavalCombat.filter(t =>
      manhattanDistance(unit.x, unit.y, t.x, t.y) <= 3
    );
    if (nearbyThreats.length > 0) {
      const safeTarget = aiCities.reduce((best, c) => {
        const d = manhattanDistance(unit.x, unit.y, c.x, c.y);
        return (!best || d < best.d) ? { x: c.x, y: c.y, d } : best;
      }, null);
      if (safeTarget) {
        log(`[TRANSPORT] #${unit.id} at (${unit.x},${unit.y}) evading ${nearbyThreats.length} threat(s), retreating to city at (${safeTarget.x},${safeTarget.y})`);
        return { action: 'move_toward', target: safeTarget, reason: 'transport_evade_threat' };
      }
      // No friendly city to flee to — hold position rather than sailing deeper into danger
      log(`[TRANSPORT] #${unit.id} cornered by threats, holding position`);
      return { action: 'wait', reason: 'transport_cornered_by_threat' };
    }
  }

  // ===== FOLLOW ASSIGNED MISSION =====
  const assignment = missions.get(unit.id);
  // Explicit wait mission: must be checked before the target branch so a
  // wait-type mission doesn't fall through to default naval/land exploration.
  if (assignment?.mission?.type === 'wait') {
    return { action: 'wait', reason: assignment.mission.reason || 'assigned_wait' };
  }
  if (assignment?.mission?.target) {
    const m = assignment.mission;

    // If the unit has already reached its mission target, clear it.
    // Rebase missions: stop here to refuel (next turn will assign a new spoke).
    // Explore missions: fall through so remaining moves explore productively.
    if (unit.x === m.target.x && unit.y === m.target.y) {
      missions.delete(unit.id);
      if (m.type === 'rebase') {
        return { action: 'wait', reason: 'rebase_complete' };
      }
      // Island coast mission reached — immediately find the next coast segment
      // rather than falling through to generic water exploration, which would
      // send the destroyer away from the island mid-circumnavigation.
      if (m.type === 'explore_island_coast') {
        const partialIslands = (knowledge.islands || []).filter(i => !i.fullyMapped && i.tiles.size > 0);
        for (const island of partialIslands) {
          const next = findCoastExploreTarget(unit, state, knowledge, island.tiles);
          if (next) {
            // Commit as a new mission so remaining steps this turn don't re-evaluate
            missions.set(unit.id, {
              mission: { type: 'explore_island_coast', target: next, priority: 5, assignedBy: 'default', reason: 'island_coast_continue' }
            });
            return { action: 'move_toward', target: next, reason: 'island_coast_continue' };
          }
        }
        // Island fully mapped — fall through to general exploration
      }
      // Loaded transport with explore_sector reached: chain to next water target
      // instead of falling to island_coast_default which picks backward coast tiles.
      if (m.type === 'explore_sector' && spec.carriesTanks) {
        const cargo = state.units.filter(cu => cu.aboardId === unit.id);
        if (cargo.length > 0) {
          const nextTarget = findBestExploreTarget(unit, state, knowledge, 'water');
          if (nextTarget) {
            missions.set(unit.id, {
              mission: { type: 'explore_sector', target: nextTarget, priority: 3, assignedBy: 'default', reason: 'transport_explore_with_cargo' }
            });
            return { action: 'move_toward', target: nextTarget, reason: 'transport_explore_with_cargo' };
          }
        }
      }
      // Fall through to NO MISSION section below
    } else {
      // Per-step fuel safety for aircraft: before committing to the next step,
      // estimate where we'd be (one Chebyshev step toward mission target) and
      // verify we can still return to the nearest refuel point from there.
      if (spec.fuel && _nearestRefuel && m.type !== 'rebase') {
        const dx = Math.sign(m.target.x - unit.x);
        const dy = Math.sign(m.target.y - unit.y);
        const nextDistToRefuel = chebDist(unit.x + dx, unit.y + dy, _nearestRefuel.x, _nearestRefuel.y);
        if (unit.fuel - 1 < nextDistToRefuel + 2) {
          return { action: 'move_toward', target: _nearestRefuel, reason: 'fuel_return_next_step' };
        }
      }

      return { action: 'move_toward', target: m.target, reason: m.reason || m.type };
    }
  }

  // ===== NO MISSION - DEFAULT BEHAVIOR =====

  // Bombers with no mission (no player cities known yet): return to nearest AI city
  if (unit.type === 'bomber') {
    if (_nearestRefuel) {
      const distToBase = Math.max(Math.abs(unit.x - _nearestRefuel.x), Math.abs(unit.y - _nearestRefuel.y));
      if (distToBase > 0) return { action: 'move_toward', target: _nearestRefuel, reason: 'bomber_hold_at_base' };
    }
    return { action: 'wait', reason: 'bomber_at_base' };
  }

  // Fighters with no mission: find nearest unexplored, per-step fuel check
  if (unit.type === 'fighter') {
    if (_nearestRefuel) {
      const target = findNearestUnexplored(unit, state, knowledge);
      if (target) {
        const dx = Math.sign(target.x - unit.x);
        const dy = Math.sign(target.y - unit.y);
        const nextDistToRefuel = chebDist(unit.x + dx, unit.y + dy, _nearestRefuel.x, _nearestRefuel.y);
        if (unit.fuel - 1 >= nextDistToRefuel + 2) {
          return { action: 'move_toward', target, reason: 'explore_default' };
        }
      }
      const distToRefuel = chebDist(unit.x, unit.y, _nearestRefuel.x, _nearestRefuel.y);
      if (distToRefuel > 0) return { action: 'move_toward', target: _nearestRefuel, reason: 'return_base' };
    }
    return { action: 'wait', reason: 'fighter_at_base' };
  }

  // Naval with no mission: finish any partial island circumnavigation first,
  // then fall back to general water exploration.
  // IMPORTANT: commit the chosen target as a mission so subsequent steps this turn
  // don't re-evaluate and reverse direction as nearby coast tiles get explored.
  if (spec.isNaval) {
    const partialIslands = (knowledge.islands || []).filter(i => !i.fullyMapped && i.tiles.size > 0);
    for (const island of partialIslands) {
      const coastTarget = findCoastExploreTarget(unit, state, knowledge, island.tiles);
      if (coastTarget) {
        missions.set(unit.id, {
          mission: { type: 'explore_island_coast', target: coastTarget, priority: 5, assignedBy: 'default', reason: 'island_coast_default' }
        });
        return { action: 'move_toward', target: coastTarget, reason: 'island_coast_default' };
      }
    }
    const target = findBestExploreTarget(unit, state, knowledge, 'water');
    if (target) {
      missions.set(unit.id, {
        mission: { type: 'explore_water', target, priority: 3, assignedBy: 'default', reason: 'explore_water_default' }
      });
      return { action: 'move_toward', target, reason: 'explore_water_default' };
    }
  }

  // Tank with no mission: explore land
  if (spec.isLand) {
    const reachable = floodFillLand(unit.x, unit.y, state);
    const target = findBestExploreTarget(unit, state, knowledge, 'land');
    if (target && reachable.has(`${target.x},${target.y}`)) {
      return { action: 'move_toward', target, reason: 'explore_land_default' };
    }
  }

  return { action: 'wait', reason: 'idle' };
}

// ============================================================================
// MOVEMENT HELPERS
// ============================================================================

function executeMove(state, unitIdx, moveTarget, unit, turnLog, observationState, mission) {
  let s = { ...state, units: [...state.units] };
  const spec = UNIT_SPECS[unit.type];

  const dx = moveTarget.x - unit.x;
  const movedToNewTile = dx !== 0 || moveTarget.y !== unit.y;
  const newFacing = dx < 0 ? 'W' : dx > 0 ? 'E' : (s.units[unitIdx].facing || 'E');
  s.units[unitIdx] = {
    ...s.units[unitIdx],
    x: moveTarget.x,
    y: moveTarget.y,
    movesLeft: s.units[unitIdx].movesLeft - 1,
    facing: newFacing,
    ...(spec.stealth && movedToNewTile ? { revealed: false } : {})
  };

  // Fuel consumption
  if (spec.fuel && s.units[unitIdx].fuel != null) {
    s.units[unitIdx] = { ...s.units[unitIdx], fuel: s.units[unitIdx].fuel - 1 };
    const city = s.cities[`${moveTarget.x},${moveTarget.y}`];
    if (s.units[unitIdx].fuel <= 0 && (!city || city.owner !== 'ai')) {
      turnLog.push(`${unit.type} crashed at (${moveTarget.x},${moveTarget.y})`);
      s.units = s.units.filter(u => u.id !== unit.id);
      return s;
    }
    if (city?.owner === 'ai') {
      s.units[unitIdx] = { ...s.units[unitIdx], fuel: spec.fuel };
    }
  }

  // Transport auto-loading: only load when at or adjacent to pickup city (not while en route)
  if (spec.carriesTanks) {
    s = handleTransportAutoLoad(s, unitIdx, turnLog, mission);
  }

  // Observation tracking
  updateObservation(observationState, unit.id, moveTarget.x, moveTarget.y, false, s);

  return s;
}

function updateObservation(observationState, unitId, x, y, forcedObserved, state) {
  const obsState = observationState.get(unitId);
  if (!obsState) return;
  if (forcedObserved) {
    obsState.wasObserved = true;
    obsState.trail.push({ x, y });
    return;
  }
  if (state) {
    const aiUnit = state.units.find(u => u.id === unitId);
    const aiSpec = aiUnit ? UNIT_SPECS[aiUnit.type] : null;
    const allObs = getAdjacentPlayerUnits(x, y, state.units);
    // Stealthy AI units (subs) can only be spotted by player units with detectsSubs, unless revealed
    const isHiddenSub = aiSpec?.stealth && !aiUnit?.revealed;
    const obs = isHiddenSub
      ? allObs.filter(pu => UNIT_SPECS[pu.type]?.detectsSubs)
      : allObs;
    // Cities also can't detect submerged submarines (but can spot revealed ones)
    const nearCity = !isHiddenSub && isAdjacentToPlayerCity(x, y, state.cities);
    if (obs.length > 0 || nearCity) {
      obsState.wasObserved = true;
      obsState.observers.push(...obs);
      obsState.trail.push({ x, y });
    } else if (obsState.wasObserved) {
      obsState.trail.push({ x, y });
      obsState.wasObserved = false;
    }
  }
}

// ============================================================================
// COMBAT
// ============================================================================

function handleCombat(state, unitIdx, next, target, turnLog) {
  let s = { ...state, units: [...state.units] };
  const unit = s.units[unitIdx];
  const attSpec = UNIT_SPECS[unit.type], defSpec = UNIT_SPECS[target.type];

  // NUKE: Bomber destroys all units and neutralizes all cities in 3x3 blast area
  if (attSpec.isNuke) {
    const cx = next.x, cy = next.y;
    s.units = s.units.filter(u => Math.abs(u.x - cx) > 1 || Math.abs(u.y - cy) > 1);
    let newCities = { ...s.cities };
    let newMap = s.map.map(row => [...row]);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bx = cx + dx, by = cy + dy;
        const ck = `${bx},${by}`;
        if (newCities[ck]) {
          newCities[ck] = { ...newCities[ck], owner: 'neutral', producing: null, progress: {} };
          if (by >= 0 && by < newMap.length && bx >= 0 && bx < newMap[0].length) {
            newMap[by][bx] = NEUTRAL_CITY;
          }
        }
      }
    }
    s.cities = newCities;
    s.map = newMap;
    turnLog.push(`NUKE: Bomber obliterated area around (${cx},${cy})`);
    return {
      state: s,
      attackerDestroyed: true,
      combatEvent: {
        location: { x: cx, y: cy },
        isNuke: true,
        attacker: { type: unit.type, owner: unit.owner, startStrength: unit.strength, endStrength: 0, destroyed: true },
        defender: { type: target.type, owner: target.owner, startStrength: target.strength, endStrength: 0, destroyed: true }
      }
    };
  }

  // Store pre-combat state for reporting
  const attackerStartStrength = unit.strength;
  const defenderStartStrength = target.strength;

  // Roll calculation mirrors player's simulateCombatWithDefender exactly.
  const aRatio = unit.strength / attSpec.strength;
  const dRatio = target.strength / defSpec.strength;
  let attRolls = attSpec.halfStrengthCombat
    ? Math.max(1, Math.ceil(unit.strength * 0.5))
    : Math.max(1, Math.round((attSpec.attackRolls || 1) * aRatio));
  let defRolls = defSpec.halfStrengthCombat
    ? Math.max(1, Math.ceil(target.strength * 0.5))
    : Math.max(0, Math.round((defSpec.defenseRolls || 1) * dRatio));

  // Submarine stealth: defender can't shoot back unless it has sub-detection (or sub is already revealed)
  if (attSpec.stealth && !defSpec.detectsSubs && !unit.revealed) defRolls = 0;

  // Naval vs land: both sides hit less often (sea-to-shore difficulty)
  const aHit = (attSpec.isNaval && defSpec.isLand) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
  const dHit = (defSpec.isNaval && attSpec.isLand) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;

  let dmgToDef = 0, dmgToAtt = 0;
  for (let i = 0; i < attRolls; i++) if (Math.random() < aHit) dmgToDef += (attSpec.damagePerHit || 1);
  for (let i = 0; i < defRolls; i++) if (Math.random() < dHit) dmgToAtt += (defSpec.defenseDamagePerHit || 1);
  let attRem = Math.max(0, unit.strength - dmgToAtt);
  let defRem = Math.max(0, target.strength - dmgToDef);

  turnLog.push(`COMBAT: ${unit.type}(str ${unit.strength}) vs ${target.type}(str ${target.strength}) -> att=${attRem} def=${defRem}`);

  // Build combat event for player report
  const combatEvent = {
    location: { x: next.x, y: next.y },
    attacker: {
      type: unit.type,
      owner: unit.owner,
      startStrength: attackerStartStrength,
      endStrength: Math.max(0, attRem),
      destroyed: attRem <= 0
    },
    defender: {
      type: target.type,
      owner: target.owner,
      startStrength: defenderStartStrength,
      endStrength: Math.max(0, defRem),
      destroyed: defRem <= 0
    }
  };

  // Record combat stats before filtering dead units
  { const sr = recordCombatStats(s.units, s.destroyedUnits || [], unit.id, target.id, attackerStartStrength, defenderStartStrength, attRem, defRem, s.turn);
    s.units = sr.units; s.destroyedUnits = sr.destroyedUnits; }

  const defIdx = s.units.findIndex(x => x.id === target.id);
  if (defRem <= 0) {
    // Remove the destroyed unit and any cargo it was carrying
    s.units = s.units.filter(x => x.id !== target.id && x.aboardId !== target.id);
  } else {
    s.units[defIdx] = { ...target, strength: defRem };
  }

  if (attRem <= 0) {
    // Remove the destroyed unit and any cargo it was carrying
    s.units = s.units.filter(x => x.id !== unit.id && x.aboardId !== unit.id);
    return { state: s, attackerDestroyed: true, combatEvent };
  } else {
    const newIdx = s.units.findIndex(x => x.id === unit.id);
    if (newIdx >= 0) {
      // Multi-attack rule: each attack costs 1 move; the second attack exhausts all remaining moves.
      // Uses hasAttacked flag (not movesLeft comparison) so movement before attacking doesn't penalize.
      const newMovesLeft = (!unit.hasAttacked && unit.movesLeft > 1) ? unit.movesLeft - 1 : 0;
      const newStatus = newMovesLeft === 0 ? STATUS_USED : unit.status;
      // Sub reveals itself when firing torpedoes
      const subRevealed = attSpec.stealth ? true : (s.units[newIdx].revealed || false);
      s.units[newIdx] = { ...s.units[newIdx], strength: attRem, movesLeft: newMovesLeft, hasAttacked: true, gotoPath: null, status: newStatus, revealed: subRevealed };
      if (defRem <= 0) {
        const remaining = s.units.filter(eu => eu.x === next.x && eu.y === next.y && eu.owner !== 'ai' && !eu.aboardId);
        if (remaining.length === 0) {
          // Naval units cannot advance onto land; land units cannot advance onto water
          const targetTile = s.map[next.y]?.[next.x];
          const canAdvance = attSpec.isNaval
            ? (targetTile === WATER || s.cities[`${next.x},${next.y}`]?.owner === 'ai')
            : (targetTile !== WATER);
          if (canAdvance) {
            // Sub advances to new tile — concealed again
            s.units[newIdx] = { ...s.units[newIdx], x: next.x, y: next.y, revealed: false };
          }
        }
      }
    }
    return { state: s, attackerDestroyed: false, combatEvent };
  }
}

// ============================================================================
// AI BOMBARDMENT
// ============================================================================

/**
 * AI unit performs range-2 bombardment against an enemy unit.
 * No counterattack — defender takes damage, attacker keeps full strength.
 * Costs 1 move and sets hasBombarded=true, same as player bombardment rules.
 */
function handleAIBombardment(state, unitIdx, target, turnLog) {
  let s = { ...state, units: [...state.units], cities: { ...state.cities }, map: state.map.map(r => [...r]) };
  const unit = s.units[unitIdx];
  const spec = UNIT_SPECS[unit.type];
  const defUnit = target.enemy;
  const defSpec = UNIT_SPECS[defUnit.type];

  const aRolls = Math.max(1, Math.ceil(unit.strength * 0.5));
  let dmgToDef = 0;
  for (let i = 0; i < aRolls; i++) {
    if (Math.random() < BOMBARD_HIT_CHANCE) dmgToDef += (spec.damagePerHit || 1);
  }
  const defRem = Math.max(0, defUnit.strength - dmgToDef);
  const defDead = defRem <= 0;

  turnLog.push(`BOMBARD: ${unit.type}@${unit.x},${unit.y} fires at ${defUnit.type}@${target.x},${target.y} → ${dmgToDef} dmg, defRem=${defRem}`);

  // Record combat stats (no attacker damage — atkStrAfter = atkStrBefore)
  { const sr = recordCombatStats(s.units, s.destroyedUnits || [], unit.id, defUnit.id, unit.strength, defUnit.strength, unit.strength, defRem, s.turn);
    s.units = sr.units; s.destroyedUnits = sr.destroyedUnits; }

  if (defDead) {
    s.units = s.units.filter(u => u.id !== defUnit.id && u.aboardId !== defUnit.id);
  } else {
    const defIdx = s.units.findIndex(u => u.id === defUnit.id);
    if (defIdx >= 0) s.units[defIdx] = { ...s.units[defIdx], strength: defRem };
  }

  const newIdx = s.units.findIndex(u => u.id === unit.id);
  if (newIdx >= 0) {
    const newMovesLeft = Math.max(0, s.units[newIdx].movesLeft - 1);
    s.units[newIdx] = { ...s.units[newIdx], movesLeft: newMovesLeft, hasBombarded: true,
      status: newMovesLeft === 0 ? STATUS_USED : s.units[newIdx].status };
  }

  const combatEvent = {
    location: { x: target.x, y: target.y },
    isBombardment: true,
    attacker: { type: unit.type, owner: unit.owner, startStrength: unit.strength, endStrength: unit.strength, destroyed: false },
    defender: { type: defUnit.type, owner: defUnit.owner, startStrength: defUnit.strength, endStrength: defRem, destroyed: defDead }
  };

  return { state: s, combatEvent };
}

// ============================================================================
// TRANSPORT LOADING/UNLOADING
// ============================================================================

/**
 * Aggressively try to unload transport cargo at adjacent capturable cities.
 * Unlike handleTransportAutoUnload (which only fires during movement),
 * this runs at the START of the transport's turn to handle the case where
 * the transport arrived at its target last turn.
 *
 * Checks:
 * 1. Adjacent city tiles (NEUTRAL_CITY, PLAYER_CITY on map)
 * 2. Adjacent cities by cities object (in case map tile doesn't match)
 * 3. Adjacent land tiles (unload even without a city to capture)
 */
function tryTransportUnload(state, unitIdx, turnLog, missions) {
  let s = { ...state, units: [...state.units], cities: { ...state.cities }, map: state.map.map(r => [...r]) };
  const unit = s.units[unitIdx];
  const cargo = s.units.filter(cu => cu.aboardId === unit.id);
  if (cargo.length === 0) return { state: s, unloaded: false };

  // Check all adjacent tiles for capturable cities
  let adjacentCapturableCity = null; // Track defended cities for fallback land drop

  for (const [dx, dy] of ALL_DIRS) {
    const adjX = unit.x + dx, adjY = unit.y + dy;
    if (adjX < 0 || adjX >= s.map[0].length || adjY < 0 || adjY >= s.map.length) continue;

    const adjTile = s.map[adjY][adjX];
    const cityKey = `${adjX},${adjY}`;
    const city = s.cities[cityKey];

    // Check for capturable city (check both map tile AND cities object)
    const isCapturable = (city && (city.owner === 'neutral' || city.owner === 'player')) ||
                          adjTile === NEUTRAL_CITY || adjTile === PLAYER_CITY;

    if (!isCapturable) continue;

    // Remember this city as a land-drop target even if it's defended
    if (!adjacentCapturableCity) adjacentCapturableCity = { x: adjX, y: adjY };

    // Only directly assault undefended cities — defended ones get a land drop below
    const defenders = s.units.filter(d => d.x === adjX && d.y === adjY && d.owner === 'player' && !d.aboardId);
    if (defenders.length > 0) continue;

    // Use the first tank to assault the city — goes through city combat like a regular capture
    const assaultTank = cargo[0];
    const assaultIdx = s.units.findIndex(x => x.id === assaultTank.id);
    if (assaultIdx < 0) continue;

    const combatResult = resolveAICityAttack(s.units[assaultIdx]);
    if (!combatResult.cityDead) {
      // City defended — tank takes damage and stays aboard; transport will retry next turn
      const tankRem = combatResult.attRem;
      turnLog.push(`Transport assault on ${cityKey} repelled (tank str ${tankRem} remaining)`);
      if (tankRem <= 0) {
        s.units = s.units.filter(x => x.id !== assaultTank.id);
      } else {
        s.units[assaultIdx] = { ...s.units[assaultIdx], strength: tankRem };
      }
      return { state: s, unloaded: true }; // transport is done for this turn
    }

    log(`[TRANSPORT] Unloading at (${unit.x},${unit.y}) -> city ${cityKey}`);
    const targetCity = city || { owner: 'neutral' };
    turnLog.push(`Transport invasion: captured ${targetCity.owner} city ${cityKey}`);
    s.cities = { ...s.cities, [cityKey]: { ...targetCity, x: adjX, y: adjY, owner: 'ai', producing: 'tank', progress: {} } };
    s.map[adjY][adjX] = AI_CITY;
    s.units = s.units.filter(x => x.id !== assaultTank.id); // First tank consumed as garrison
    // Remaining tanks stay aboard — transport will seek the next city next turn

    return { state: s, unloaded: true };
  }

  // Adjacent capturable city found but it was defended — land a tank on the nearest
  // non-enemy land tile adjacent to the transport, aimed toward that city.
  // This lets the tank march overland to threaten the city rather than doing nothing.
  if (adjacentCapturableCity) {
    const { x: cityX, y: cityY } = adjacentCapturableCity;
    let bestLand = null, bestDist = Infinity;
    for (const [dx, dy] of ALL_DIRS) {
      const adjX = unit.x + dx, adjY = unit.y + dy;
      if (adjX < 0 || adjX >= s.map[0].length || adjY < 0 || adjY >= s.map.length) continue;
      if (s.map[adjY][adjX] === WATER) continue;
      const blockers = s.units.filter(u => u.x === adjX && u.y === adjY && u.owner === 'player' && !u.aboardId);
      if (blockers.length > 0) continue;
      const dist = manhattanDistance(adjX, adjY, cityX, cityY);
      if (dist < bestDist) { bestDist = dist; bestLand = { x: adjX, y: adjY }; }
    }
    if (bestLand) {
      const tank = cargo[0];
      const tankIdx = s.units.findIndex(x => x.id === tank.id);
      if (tankIdx >= 0) {
        s.units[tankIdx] = { ...s.units[tankIdx], aboardId: null, x: bestLand.x, y: bestLand.y, status: STATUS_READY, movesLeft: 0 };
        turnLog.push(`Transport landing tank#${tank.id} at (${bestLand.x},${bestLand.y}) -> march to defended city (${cityX},${cityY})`);
      }
      return { state: s, unloaded: true };
    }
  }

  // No capturable city adjacent - check if transport has arrived at its mission target
  // and should unload tanks onto land for an overland march to a landlocked city
  // IMPORTANT: Only do this for ferry_invasion missions WITH a valid targetKey.
  // transport_pickup missions (no targetKey) should NOT trigger coastal unload.
  const mission = missions?.get(unit.id)?.mission;
  const hasValidDeliveryTarget = mission?.type === 'ferry_invasion' && mission.targetKey;
  const atTarget = hasValidDeliveryTarget &&
    manhattanDistance(unit.x, unit.y, mission.target.x, mission.target.y) <= 1;

  if (atTarget) {
    // Find the best adjacent land tile to unload onto
    // Prefer tiles closest to the mission's target city (targetKey)
    let bestLand = null;
    let bestDist = Infinity;
    const [cityX, cityY] = mission.targetKey
      ? mission.targetKey.split(',').map(Number)
      : [mission.target.x, mission.target.y];

    for (const [dx, dy] of ALL_DIRS) {
      const adjX = unit.x + dx, adjY = unit.y + dy;
      if (adjX < 0 || adjX >= s.map[0].length || adjY < 0 || adjY >= s.map.length) continue;
      const adjTile = s.map[adjY][adjX];

      // Must be land (not water)
      if (adjTile === WATER) continue;

      // Don't unload onto a tile with enemy units
      const enemies = s.units.filter(u => u.x === adjX && u.y === adjY && u.owner === 'player' && !u.aboardId);
      if (enemies.length > 0) continue;

      const dist = manhattanDistance(adjX, adjY, cityX, cityY);
      if (dist < bestDist) {
        bestDist = dist;
        bestLand = { x: adjX, y: adjY };
      }
    }

    if (bestLand) {
      log(`[TRANSPORT] Coastal unload at (${unit.x},${unit.y}) -> land (${bestLand.x},${bestLand.y}) for march to city ${mission.targetKey}`);

      // Only unload one tank per turn — it marches overland while the rest stay
      // aboard so the transport can continue to other cities without returning to pick up tanks
      const tank = cargo[0];
      const tankIdx = s.units.findIndex(x => x.id === tank.id);
      if (tankIdx >= 0) {
        s.units[tankIdx] = {
          ...s.units[tankIdx],
          aboardId: null,
          x: bestLand.x,
          y: bestLand.y,
          status: STATUS_READY,
          movesLeft: 0 // Will get moves next turn
        };
        turnLog.push(`Transport coastal unload: tank#${tank.id} at (${bestLand.x},${bestLand.y}) -> march to ${mission.targetKey}`);
      }
      return { state: s, unloaded: true };
    }
  }

  return { state: s, unloaded: false };
}

function handleTransportAutoLoad(state, unitIdx, turnLog, mission) {
  let s = { ...state, units: [...state.units] };
  const unit = s.units[unitIdx];
  const capacity = UNIT_SPECS[unit.type].capacity;

  // Only load tanks when on an explicit transport_pickup mission AND adjacent to the
  // pickup city. Loading during exploration/ferry/other missions causes phantom cargo
  // accumulation and makes tanks appear to teleport onto the transport.
  if (mission?.type !== 'transport_pickup') return s;
  const pickupCity = mission.pickupCity;
  if (!pickupCity) return s;
  const [pcx, pcy] = pickupCity.split(',').map(Number);
  if (manhattanDistance(unit.x, unit.y, pcx, pcy) > 1) return s;

  for (const [dx, dy] of ALL_DIRS) {
    const adjX = unit.x + dx, adjY = unit.y + dy;
    if (s.map[adjY]?.[adjX] === WATER) continue;

    // Don't load from a tile that has adjacent enemy units — the city is under threat
    const tileThreats = s.units.filter(u => {
      if (u.owner !== 'player' || u.aboardId) return false;
      return ALL_DIRS.some(([ex, ey]) => u.x === adjX + ex && u.y === adjY + ey);
    });
    if (tileThreats.length > 0) continue;

    const tanksToLoad = s.units.filter(tank =>
      tank.x === adjX && tank.y === adjY && tank.type === 'tank' && tank.owner === 'ai' && !tank.aboardId
    );

    for (const tank of tanksToLoad) {
      const loaded = s.units.filter(cu => cu.aboardId === unit.id).length;
      if (loaded >= capacity) break;
      const tankIdx = s.units.findIndex(x => x.id === tank.id);
      if (tankIdx >= 0) {
        s.units[tankIdx] = { ...s.units[tankIdx], aboardId: unit.id, x: unit.x, y: unit.y, status: STATUS_ABOARD };
        turnLog.push(`Transport loaded tank#${tank.id}`);
      }
    }
  }
  return s;
}

// ============================================================================
// MAIN AI TURN EXECUTION
// ============================================================================

export function executeAITurn(gameState, knowledge, unused, playerMadeContact = false, playerObservations = []) {
  log(`======== AI TURN ${gameState.turn} ========`);

  // Clear A* path cache from previous turn (unit positions have changed)
  clearPathCache();

  let state = { ...gameState, units: [...gameState.units], cities: { ...gameState.cities }, map: gameState.map.map(r => [...r]) };
  // Snapshot contact state BEFORE this turn's updates — used for declaration of war
  const hadContactBeforeTurn = knowledge.hasSeenPlayerUnit || knowledge.hasSeenPlayerCity;
  let k = updateAIKnowledge(knowledge, state);
  const turnLog = [];

  // Player contact handling
  if (playerMadeContact && !k.hasSeenPlayerUnit) {
    k.hasSeenPlayerUnit = true;
  }
  if (playerObservations?.length > 0) {
    k = recordPlayerObservations(k, playerObservations);
  }

  // Phase determination
  const oldPhase = k.explorationPhase;
  k.explorationPhase = determinePhase(k, state);
  if (oldPhase !== k.explorationPhase) {
    logPhase(`Phase changed: ${oldPhase} -> ${k.explorationPhase}`);
    turnLog.push(`Phase: ${k.explorationPhase}`);
  }

  // === CITY MANAGER: Production ===
  state = planProduction(state, k, turnLog);

  // === Reset moves, heal, refuel ===
  state.units = state.units.map(u => {
    if (u.owner !== 'ai') return u;
    const spec = UNIT_SPECS[u.type];
    // Damaged movement penalty: units at Ã¢â€°Â¤50% health get -1 move (minimum 1)
    let movement = spec.movement;
    if (u.strength <= spec.strength * 0.5) {
      movement = Math.max(1, movement - 1);
      log(`[DAMAGE] ${spec.name}#${u.id} at ${u.strength}/${spec.strength} str Ã¢â€ â€™ ${movement} moves (reduced)`);
    }
    const unit = { ...u, movesLeft: movement, hasAttacked: false };
    if (unit.status === STATUS_USED || unit.status === STATUS_SKIPPED) unit.status = STATUS_READY;
    const city = state.cities[`${unit.x},${unit.y}`];
    if (city?.owner === 'ai' && !unit.aboardId) {
      if (unit.strength < spec.strength) unit.strength = Math.min(spec.strength, unit.strength + 1);
      if (spec.fuel) unit.fuel = spec.fuel;
    }
    return unit;
  });

  // === ALLOCATE UNITS between managers ===
  const { explorationUnits, tacticalUnits } = allocateUnits(state, k.explorationPhase);

  // === Detect threats ===
  const threats = detectThreats(state, k);

  // === EXPLORATION MANAGER: Assign missions ===
  const explorationMissions = assignExplorationMissions(state, k, explorationUnits, k.explorationPhase, turnLog);

  // === TACTICAL MANAGER: Assign missions ===
  const tacticalMissions = assignTacticalMissions(state, k, tacticalUnits, threats, k.explorationPhase, turnLog);

  // === Merge missions ===
  const allMissions = new Map();
  for (const [id, m] of explorationMissions) allMissions.set(id, m);
  for (const [id, m] of tacticalMissions) allMissions.set(id, m);

  // === Log turn summary ===
  logTurnSummary(state, k, allMissions, turnLog);

  // === EXECUTE MOVEMENTS ===
  const aiUnitsBefore = new Map(state.units.filter(u => u.owner === 'ai').map(u => [u.id, u.type]));
  const moveResult = executeStepByStepMovements(state, k, turnLog, allMissions);
  state = moveResult.state;
  k = moveResult.knowledge;
  const observations = moveResult.observations;
  const combatEvents = moveResult.combatEvents || [];
  const contactEvents = moveResult.contactEvents || [];
  logUnitSummary(state, aiUnitsBefore, turnLog);

  // === Final knowledge update & phase check ===
  // Also catch contact that becomes visible from static unit positions after movement ends
  const hadSeenUnit = k.hasSeenPlayerUnit;
  const hadSeenCity = k.hasSeenPlayerCity;
  const contactBefore = hadSeenUnit || hadSeenCity;
  k = updateAIKnowledge(k, state);
  // Record static-visibility contact events (not already captured during movement)
  if (!hadSeenUnit && k.hasSeenPlayerUnit) contactEvents.push({ type: 'found_unit', x: null, y: null, unitType: null });
  if (!hadSeenCity && k.hasSeenPlayerCity) contactEvents.push({ type: 'found_city', x: null, y: null });

  const contactAfter = k.hasSeenPlayerUnit || k.hasSeenPlayerCity;

  if (!contactBefore && contactAfter) {
    const newPhase = determinePhase(k, state);
    if (newPhase !== k.explorationPhase) {
      logPhase(`Contact triggered: ${k.explorationPhase} -> ${newPhase}`);
      k.explorationPhase = newPhase;
      turnLog.push(`Phase: ${k.explorationPhase} (contact)`);
    }
  }

  // Add phase change to contact events so the player sees it in the summary
  if (oldPhase !== k.explorationPhase) {
    contactEvents.push({ type: 'phase_change', from: oldPhase, to: k.explorationPhase });
  }

  // Persist transport missions into knowledge so next turn can avoid redundant reassignment
  k.activeMissions = {};
  for (const [id, entry] of allMissions) {
    if (entry?.mission) k.activeMissions[id] = entry.mission;
  }

  const declarationOfWar = !hadContactBeforeTurn && (k.hasSeenPlayerUnit || k.hasSeenPlayerCity);
  return { state, knowledge: k, log: turnLog, observations, combatEvents, contactEvents, declarationOfWar };
}

// ============================================================================
// OBSERVER TURN — runs the full AI pipeline driving player units
// ============================================================================

/**
 * Swap player↔ai owners (units, cities, map tiles) so the AI engine can
 * operate on player units as if they were its own.
 */
function ownerSwap(state) {
  const swap = o => o === 'player' ? 'ai' : o === 'ai' ? 'player' : o;
  return {
    ...state,
    units: state.units.map(u => ({ ...u, owner: swap(u.owner) })),
    cities: Object.fromEntries(
      Object.entries(state.cities).map(([k, c]) => [k, { ...c, owner: swap(c.owner) }])
    ),
    map: state.map.map(row =>
      row.map(t => t === PLAYER_CITY ? AI_CITY : t === AI_CITY ? PLAYER_CITY : t)
    )
  };
}

/**
 * Create initial observer knowledge for the player's perspective.
 * Uses the shadow (owner-swapped) state so AI machinery initialises from
 * the player's starting city and player-unit visibility.
 */
export function createObserverKnowledge(gameState, playerExploredTiles) {
  const shadow = ownerSwap(gameState);
  const k = createAIKnowledgeFromState(shadow);
  // Seed with everything the player has ever explored
  for (const tile of playerExploredTiles) k.exploredTiles.add(tile);
  return k;
}

/**
 * Run the full AI pipeline (production + explore + tactical missions + step-by-step movement)
 * against player units by operating in a shadow state with owners swapped.
 * Returns { state, observerKnowledge, log, trails }.
 */
export function executeObserverTurn(gameState, observerKnowledge) {
  clearPathCache();
  const turnLog = [];
  const exploredBefore = observerKnowledge.exploredTiles.size;
  const totalTiles = gameState.width * gameState.height;

  // Shadow state: player ↔ ai
  let shadow = ownerSwap(gameState);

  // Update knowledge using the shadow state (player units are 'ai' here)
  let k = updateAIKnowledge(observerKnowledge, shadow);

  // Phase determination: use natural phase, but hold in LAND until
  // all-but-one home island city is captured (player starts owning their
  // home city; remaining neutrals need tanks to secure them first).
  const oldPhase = k.explorationPhase;
  const naturalPhase = determinePhase(k, shadow);
  let observerPhase = naturalPhase;

  if (naturalPhase !== PHASE.LAND && k.homeIslandCities && k.homeIslandCities.size > 0) {
    let uncaptured = 0;
    for (const key of k.homeIslandCities) {
      if (shadow.cities[key]?.owner !== 'ai') uncaptured++;
    }
    if (uncaptured > 1) observerPhase = PHASE.LAND;
  }

  k.explorationPhase = observerPhase;
  const phaseChanged = oldPhase !== k.explorationPhase;

  // === CITY MANAGER: Assign production targets (no progress tick — endPlayerTurn already did it) ===
  const prodLogStart = turnLog.length;
  shadow = planProduction(shadow, k, turnLog, false);
  const prodEvents = turnLog.slice(prodLogStart);

  // === Reset moves, heal, refuel (same as executeAITurn) ===
  shadow = {
    ...shadow,
    units: shadow.units.map(u => {
      if (u.owner !== 'ai') return u;
      const spec = UNIT_SPECS[u.type];
      let movement = spec.movement;
      if (u.strength <= spec.strength * 0.5) movement = Math.max(1, movement - 1);
      const unit = { ...u, movesLeft: movement };
      // Sentry and aboard units don't move (but stay in their status)
      if (unit.status === STATUS_SENTRY || unit.aboardId) unit.movesLeft = 0;
      if (unit.status === STATUS_USED || unit.status === STATUS_SKIPPED) unit.status = STATUS_READY;
      const city = shadow.cities[`${unit.x},${unit.y}`];
      if (city?.owner === 'ai' && !unit.aboardId) {
        if (unit.strength < spec.strength) unit.strength = Math.min(spec.strength, unit.strength + 1);
        if (spec.fuel) unit.fuel = spec.fuel;
      }
      return unit;
    })
  };

  // Snapshot positions of all eligible units for trail building
  const startPositions = new Map(
    shadow.units
      .filter(u => u.owner === 'ai' && !u.aboardId && u.movesLeft > 0)
      .map(u => [u.id, { x: u.x, y: u.y, type: u.type }])
  );

  const phaseNote = observerPhase !== naturalPhase
    ? ` (forced=${observerPhase}, natural=${naturalPhase})`
    : phaseChanged ? ` (was ${oldPhase})` : '';
  logObs(`=== Turn ${gameState.turn} — phase: ${k.explorationPhase}${phaseNote} — ${startPositions.size} units eligible ===`);
  if (prodEvents.length) logObs(`  production: ${prodEvents.join(' | ')}`);

  const { explorationUnits, tacticalUnits } = allocateUnits(shadow, k.explorationPhase);
  logObs(`  explore=${explorationUnits.length}u  tactical=${tacticalUnits.length}u`);

  // Assign missions
  const threats = detectThreats(shadow, k);
  const explorationMissions = assignExplorationMissions(shadow, k, explorationUnits, k.explorationPhase, turnLog);
  const tacticalMissions = assignTacticalMissions(shadow, k, tacticalUnits, threats, k.explorationPhase, turnLog);
  const allMissions = new Map([...explorationMissions, ...tacticalMissions]);

  // Log mission assignments
  for (const [id, start] of startPositions) {
    const m = allMissions.get(id);
    if (m?.mission) {
      const t = m.mission.target;
      logObs(`  #${id} ${start.type}@(${start.x},${start.y}) → ${m.mission.type}${t ? ` (${t.x},${t.y})` : ''}`);
    } else {
      logObs(`  #${id} ${start.type}@(${start.x},${start.y}) → NO MISSION`);
    }
  }

  // Execute all moves
  const moveResult = executeStepByStepMovements(shadow, k, turnLog, allMissions, true);
  shadow = moveResult.state;
  k = moveResult.knowledge;

  // Build full-path trails using per-tile position log
  const trails = [];
  const posLog = moveResult.observerPositionLog;
  for (const [id, start] of startPositions) {
    const unit = shadow.units.find(u => u.id === id);
    if (!unit) {
      logObs(`  #${id} ${start.type} — destroyed/captured`);
    } else {
      const history = posLog.get(id) || [];
      if (history.length > 1) {
        logObs(`  #${id} ${start.type} (${start.x},${start.y})→(${unit.x},${unit.y}) [${history.length} steps]`);
        trails.push({ unitId: id, unitType: start.type, trail: history });
      } else if (unit.x !== start.x || unit.y !== start.y) {
        logObs(`  #${id} ${start.type} moved (${start.x},${start.y})→(${unit.x},${unit.y})`);
        trails.push({ unitId: id, unitType: start.type, trail: [{ x: start.x, y: start.y }, { x: unit.x, y: unit.y }] });
      } else {
        logObs(`  #${id} ${start.type}@(${start.x},${start.y}) — did not move (status: ${unit.status})`);
      }
    }
  }

  const exploredAfter = k.exploredTiles.size;
  logObs(`  explored: +${exploredAfter - exploredBefore} tiles → ${(exploredAfter / totalTiles * 100).toFixed(1)}% total`);
  if (turnLog.length) logObs(`  events: ${turnLog.join(' | ')}`);

  // Persist observer transport missions for next turn continuity
  k.activeMissions = {};
  for (const [id, entry] of allMissions) {
    if (entry?.mission) k.activeMissions[id] = entry.mission;
  }

  // Swap owners back to restore player/ai context
  const resultState = ownerSwap(shadow);
  return { state: resultState, observerKnowledge: k, log: turnLog, trails };
}

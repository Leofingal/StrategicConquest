// ============================================================================
// STRATEGIC CONQUEST - AI CITY MANAGER
// ============================================================================
// Manages production for all AI cities with COMMITTED builds.
// Core rule: NEVER switch production mid-build. Progress is preserved per type
// but switching wastes turns, so we only assign when a city is idle.
//
// Dependencies: ai-helpers.js, game-constants.js, movement-engine.js

import { UNIT_SPECS } from './game-constants.js';
import { isAdjacentToWater } from './movement-engine.js';
import { TARGET_DIST, PHASE, log } from './ai-helpers.js';

const logProd = () => {}; // silenced — summary printed by logTurnSummary

// ============================================================================
// MAIN PRODUCTION PLANNER
// ============================================================================

/**
 * Plan production for all AI cities. Only assigns production to IDLE cities.
 * A city is idle when: no producing set, OR current type just completed (progress rolled to 0).
 *
 * @param {Object} state - Game state (will be mutated via shallow copy)
 * @param {Object} knowledge - AI knowledge with explorationPhase
 * @param {Array} turnLog - Turn log array for messages
 * @returns {Object} Updated state with production decisions
 */
/**
 * @param {boolean} [tickProgress=true] - If false, skip the progress increment and
 *   unit spawning (used by observer mode where endPlayerTurn already ticked progress).
 *   Only idle cities (producing===null) get a production assignment.
 */
export function planProduction(state, knowledge, turnLog, tickProgress = true) {
  let s = { ...state, units: [...state.units], cities: { ...state.cities } };
  const phase = knowledge.explorationPhase;
  const targetDist = TARGET_DIST[phase] || TARGET_DIST[PHASE.LAND];

  // Step 1: Count current units + fractional in-progress
  const unitCounts = {};
  for (const type of Object.keys(UNIT_SPECS)) unitCounts[type] = 0;
  for (const unit of s.units) {
    if (unit.owner === 'ai') unitCounts[unit.type]++;
  }

  // Add fractional for in-progress production (so we don't over-produce one type)
  for (const city of Object.values(s.cities)) {
    if (city.owner !== 'ai' || !city.producing) continue;
    const spec = UNIT_SPECS[city.producing];
    if (!spec) continue;
    const progress = city.progress?.[city.producing] || 0;
    if (progress > 0) {
      unitCounts[city.producing] += progress / spec.productionDays;
    }
  }

  const totalUnits = Math.max(1, Object.values(unitCounts).reduce((a, b) => a + b, 0));

  // Step 2: Process each AI city
  for (const [key, city] of Object.entries(s.cities)) {
    if (city.owner !== 'ai') continue;

    // Step 2a: Tick progress / spawn completed units
    if (city.producing) {
      if (!tickProgress) {
        // endPlayerTurn already ticked progress. If it's > 0 the city is mid-production
        // and committed. If it's 0 the unit just completed last turn (endPlayerTurn reset
        // progress to 0 but left producing set) — treat as idle so AI can reassign.
        const currentProgress = city.progress?.[city.producing] || 0;
        if (currentProgress > 0) continue;
        // Fall through to Step 2b to reassign this freshly-completed city
      } else {
        const spec = UNIT_SPECS[city.producing];
        if (!spec) continue;
        const progress = (city.progress?.[city.producing] || 0) + 1;

        if (progress >= spec.productionDays) {
          // UNIT COMPLETED - spawn it
          const newUnit = {
            id: s.nextUnitId++,
            type: city.producing,
            owner: 'ai',
            x: city.x,
            y: city.y,
            strength: spec.strength,
            movesLeft: 0,  // Can't move on spawn turn
            fuel: spec.fuel || null,
            status: 'R',
            aboardId: null,
            gotoPath: null,
            patrolPath: null,
            patrolIdx: 0
          };
          s.units.push(newUnit);
          turnLog.push(`Built ${city.producing} at ${key}`);
          logProd(`COMPLETED: ${city.producing} at ${key}`);

          // Reset: mark city as needing new assignment
          s.cities = {
            ...s.cities,
            [key]: { ...city, producing: null, progress: { ...city.progress, [city.producing]: 0 } }
          };
        } else {
          // Increment progress, keep building
          s.cities = {
            ...s.cities,
            [key]: { ...city, progress: { ...city.progress, [city.producing]: progress } }
          };
          // City is COMMITTED - skip production assignment
          continue;
        }
      }
    }

    // Step 2b: City is IDLE - assign new production
    const currentCity = s.cities[key];
    const isCoastal = isAdjacentToWater(city.x, city.y, s.map, s.map[0].length, s.map.length);
    const bestType = pickBestProduction(unitCounts, totalUnits, targetDist, isCoastal, currentCity, key);

    s.cities = { ...s.cities, [key]: { ...currentCity, producing: bestType } };
    logProd(`${key}: Starting ${bestType} (idle city)`);

    // Count this pending production as a FULL unit commitment
    // so the next idle city picks a different type
    unitCounts[bestType] += 1;
  }

  return s;
}

// ============================================================================
// PRODUCTION SELECTION
// ============================================================================

/**
 * Pick the best unit type to produce based on deficit against target distribution.
 * Respects coastal/inland constraints.
 */
function pickBestProduction(unitCounts, totalUnits, targetDist, isCoastal, city, cityKey) {
  let bestType = 'tank';
  let bestDeficit = -Infinity;
  const candidates = [];

  // Check if city has partial progress on anything in the target dist
  // Prefer resuming a partially-built unit if it's still in the target distribution
  for (const [type, targetPct] of Object.entries(targetDist)) {
    const spec = UNIT_SPECS[type];
    if (!spec) continue;
    if (spec.isNaval && !isCoastal) continue;

    const existingProgress = city.progress?.[type] || 0;
    const current = unitCounts[type] || 0;
    const target = totalUnits * targetPct;
    let deficit = target - current;

    if (existingProgress > 0) {
      // Bonus for resuming partial progress
      const progressBonus = existingProgress / spec.productionDays * 2.0;
      deficit += progressBonus;
    }

    candidates.push({ type, target: target.toFixed(1), current: current.toFixed(1), deficit: deficit.toFixed(2), progress: existingProgress });

    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestType = type;
    }
  }

  logProd(`${cityKey} decision: total=${totalUnits.toFixed(1)} | ${candidates.map(c => `${c.type}(need=${c.target} have=${c.current} def=${c.deficit}${c.progress > 0 ? ' prog='+c.progress : ''})`).join(', ')} -> ${bestType}`);

  return bestType;
}

/**
 * Emergency production check: returns true if we desperately need a specific type.
 * Used rarely - e.g., 0 transports in naval phase.
 * NOTE: Even emergencies don't interrupt in-progress builds. They only affect
 * the priority when a city becomes idle.
 */
export function getEmergencyNeeds(state, knowledge) {
  const phase = knowledge.explorationPhase;
  const needs = [];

  if (phase === PHASE.NAVAL || phase === PHASE.LATE_GAME) {
    const transports = state.units.filter(u => u.owner === 'ai' && u.type === 'transport');
    const transportInProd = Object.values(state.cities).some(c =>
      c.owner === 'ai' && c.producing === 'transport'
    );
    if (transports.length === 0 && !transportInProd) {
      needs.push('transport');
    }
  }

  return needs;
}

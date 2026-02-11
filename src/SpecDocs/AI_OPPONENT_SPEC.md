# AI Opponent Design Specification

## Document Status

**Last Updated**: Current session  
**Matches Implementation**: `ai-opponent.js`  
**Status**: Active - implementation is source of truth

---

## Overview

The AI opponent uses a **phase-based strategy** with **target unit distributions**, **tactical threat response**, and a **strict priority hierarchy** for unit decisions. The AI maintains its own fog of war and knowledge state separate from the player.

---

## Phase System

### Four Phases

```javascript
export const PHASE = {
  LAND: 'land_phase',      // Exploring home island with tanks
  TRANSITION: 'transition', // Building naval/air capability  
  NAVAL: 'naval_phase',    // Active expansion to other islands
  LATE_GAME: 'late_game'   // Final push for victory
};
```

### Phase Transition Triggers

| From       | To         | Trigger                                                           |
| ---------- | ---------- | ----------------------------------------------------------------- |
| LAND       | TRANSITION | 90% home island explored **AND** all visible home cities captured |
| LAND       | TRANSITION | (Fallback) 100% home island explored                              |
| LAND       | TRANSITION | (Edge case) 5%+ map explored AND 2+ cities                        |
| TRANSITION | NAVAL      | Player contact OR 40% map explored                                |
| NAVAL      | LATE_GAME  | <10% neutral cities OR 60% city control OR 2x unit strength       |

### Implementation

```javascript
if (k.explorationPhase === PHASE.LAND) {
  if (homeExp >= 0.90 && homeCitiesCaptured) {
    return PHASE.TRANSITION;  // Primary trigger
  }
  if (homeExp >= 1.0) {
    return PHASE.TRANSITION;  // Fallback
  }
}
```

The `homeCitiesCaptured` check ensures AI doesn't prematurely transition if a city on the home island remains uncaptured.

---

## Target Unit Distributions

### Distribution by Phase

```javascript
const TARGET_DIST = {
  [PHASE.LAND]: { 
    tank: 1.00  // 100% tanks - maximize city capture
  },

  [PHASE.TRANSITION]: { 
    tank: 0.50,      // 50% - ground forces for invasion
    transport: 0.18, // 20% - critical for expansion
    destroyer: 0.15, // 15% - naval escort and exploration
    fighter: 0.17    // 15% - scouting and patrol
  },

  [PHASE.NAVAL]: { 
    tank: 0.50,       // 50% - 6 tanks per transport, tanks build fast
    fighter: 0.15,    // 15%
    destroyer: 0.13,  // 13%
    transport: 0.12,  // 12%
    battleship: 0.04, // 4%
    carrier: 0.03,    // 3%
    submarine: 0.03   // 3%
    // NOTE: No bomber in naval phase
  },

  [PHASE.LATE_GAME]: { 
    tank: 0.35,       // 35% - reduced for bombers
    destroyer: 0.18,  // 18%
    fighter: 0.15,    // 15%
    transport: 0.10,  // 10%
    battleship: 0.08, // 8%
    bomber: 0.05,     // 5% - only in late game
    carrier: 0.05,    // 5%
    submarine: 0.04   // 4%
  }
};
```

### Why 50% Tanks?

- Each transport carries 6 tanks
- Tanks build in 4 days; transports in 10 days
- Tanks needed for defense and conquest

### Fractional Unit Counting

In-progress production counts as fractional units to prevent all cities from building the same thing:

```javascript
// 2/4 days progress on a tank = 0.5 units in distribution calculation
const fraction = progress / spec.productionDays;
counts[city.producing] += fraction;
```

---

## Tactical Threat Response System

### Threat Detection

Each turn, the AI scans visible tiles for threats:

```javascript
const threats = {
  playerTransports: [],      // HIGH PRIORITY - invasion threat
  playerNavalCombat: [],     // Destroyers, subs, battleships, carriers
  playerFighters: [],        // Opportunity targets (reduce player intel)
  playerBombers: [],         // Air threat
  threatenedCities: []       // AI cities that may be under attack
};
```

### Transport Threat Range

When a player transport is spotted within 8 tiles of an AI coastal city, that city is flagged as threatened:

```javascript
if (dist <= AI_CONFIG.tactical.transportThreatRange) {  // 8 tiles
  threats.threatenedCities.push({ city, threat: transport, distance: dist });
}
```

---

## Unit-Specific Tactical Behaviors

### Naval Combat Units (Destroyer, Submarine, Battleship, Carrier)

**Priority 1: Hunt Player Transports**

- Transports represent major invasion threats (potentially 6 tanks)
- All naval combat units will target the nearest visible player transport

```javascript
if (threats.playerTransports.length > 0) {
  const nearestTransport = findNearest(unit, threats.playerTransports);
  return { type: 'goto', target: nearestTransport, reason: 'hunt_transport' };
}
```

**Priority 2: Opportunistically Target Fighters**

- Killing player fighters reduces player intelligence
- Only engage if within 2 tiles (don't chase across map)
- Submarines don't engage fighters (they can't attack air)

```javascript
if (threats.playerFighters.length > 0 && unit.type !== 'submarine') {
  const nearestFighter = findNearest(unit, threats.playerFighters);
  if (dist <= 4) {
    return { type: 'goto', target: nearestFighter, reason: 'hunt_fighter' };
  }
}
```

### Fighters

**Behavior Split: 70% Scout, 30% Patrol**

```javascript
const shouldScout = Math.random() < 0.70;
```

**Scouting (70%)**

- Find the FARTHEST unexplored tile that can be reached AND returned from
- Maximizes exploration per turn
- Uses fuel-aware pathfinding

**Patrol (30%)**

- Circle around AI coastal cities at 3-6 tile radius
- Detects incoming threats before they reach cities
- Provides early warning for transport invasions

**Emergency Intercept**

- If a player transport threatens an AI city AND no naval units can intercept, fighters will attack
- Transports are high-value targets (up to 6 tanks)
- Otherwise, fighters are too valuable as scouts to risk

```javascript
if (threats.threatenedCities.length > 0) {
  const intercept = canInterceptWithNaval(urgentThreat.threat, gs);
  if (!intercept.canIntercept && urgentThreat.distance <= 4) {
    return { type: 'goto', target: urgentThreat.threat, reason: 'emergency_intercept' };
  }
}
```

### Transports

**Threat Avoidance**

- When routing to destinations, apply penalty scores to paths near enemy naval units
- Prefer routes that avoid destroyers, subs, battleships, carriers
- Within 3 tiles: +100 penalty; Within 5 tiles: +50 penalty

```javascript
for (const threat of nearbyThreats) {
  const threatDist = manhattanDistance(nx, ny, threat.unit.x, threat.unit.y);
  if (threatDist < 3) threatPenalty += 100;
  else if (threatDist < 5) threatPenalty += 50;
}
const score = -dist - threatPenalty;  // Pick highest score
```

**Auto-Loading**

- When a transport moves adjacent to tanks on land, automatically load them
- No manual boarding required
- Loads up to capacity (6 tanks)

### Tanks

**Threat Response**

- When a player transport is detected threatening an AI city, nearby tanks move to defend
- Only responds if the city is reachable by land (same island)
- Takes priority over staging behavior

```javascript
if (threats.threatenedCities.length > 0 && spec.isLand) {
  const nearestThreat = threats.threatenedCities
    .filter(t => reachableLand.has(`${t.city.x},${t.city.y}`))
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearestThreat && nearestThreat.distance <= 6) {
    return { type: 'goto', target: nearestThreat.city, reason: 'defend_from_transport' };
  }
}
```

**Coastal Staging**

- In TRANSITION/NAVAL phases, tanks at coastal cities WAIT for transport
- Don't wander off to garrison inland cities
- Allows efficient transport loading

**Reachability Check**

- Before assigning any target, verify it's reachable by land (flood-fill)
- Prevents tanks from repeatedly trying to path across water

---

## Priority System

### Unit Decision Priority Order

| Priority | Name                | Applies To      | Description                          |
| -------- | ------------------- | --------------- | ------------------------------------ |
| P0       | Fuel Critical       | Aircraft        | Must return to refuel immediately    |
| TACTICAL | Hunt Transport      | Naval Combat    | Attack visible player transports     |
| TACTICAL | Hunt Fighter        | Naval (not sub) | Opportunistic attack within 4 tiles  |
| TACTICAL | Emergency Intercept | Fighter         | Attack transport if no naval can     |
| TACTICAL | Defend City         | Tank            | Move to threatened coastal city      |
| P1       | Capture Neutral     | Tank            | Take known neutral cities            |
| P1.5     | Recapture Lost      | Tank            | Retake cities lost to player         |
| P2       | Explore             | All             | Find more of the map                 |
| P3       | Garrison            | Tank            | Maintain 1 tank per city             |
| P3.5     | Staging             | Tank            | Move to coastal cities for transport |
| P4       | Attack              | Tank            | Strike player cities                 |
| P5       | Default             | All             | Explore or wait                      |

---

## AI Observation Reports (Symmetry)

### The Principle

If the player gets reports about AI movements they observed, the AI should get equivalent information about player movements it observed.

### Implementation

**Recording Observations**

```javascript
export function recordPlayerObservations(k, observations) {
  // Called from main game after player turn
  // observations = [{ unitType, trail, ... }]
  const newK = { ...k, lastTurnObservations: observations };
  return newK;
}
```

**Integration Point**
The main game file (`strategic-conquest-game-integrated.jsx`) should:

1. Track what AI units saw during player movement (similar to how player observations are tracked)
2. Call `recordPlayerObservations(k, observations)` before the AI turn
3. AI can then factor this into tactical decisions

---

## Configuration

```javascript
export const AI_CONFIG = {
  exploration: {
    homeComplete: 0.90,        // 90% home island explored (was 100%)
    navalMapThreshold: 0.40,   // 40% map explored → NAVAL
    lateNeutral: 0.10,         // <10% neutral cities → LATE_GAME
    lateCityControl: 0.60,     // 60% city control → LATE_GAME
    lateStrength: 2.0          // 2x unit strength → LATE_GAME
  },

  fuel: {
    fighterReturn: 0.40,       // Return at 40% fuel (8/20)
    bomberReturn: 0.30         // Return at 30% fuel (9/30)
  },

  defense: {
    garrisonPerCity: 1         // Minimum tanks per city
  },

  tactical: {
    fighterScoutPriority: 0.70,   // 70% scout, 30% patrol
    transportThreatRange: 8,       // Tiles at which transport triggers alert
    navalThreatRange: 5            // Range for naval threat avoidance
  }
};
```

---

## AI Knowledge State

```javascript
function createAIKnowledge(startX, startY) {
  return {
    // Exploration
    exploredTiles: new Set(),       // "x,y" strings
    startPosition: { x, y },        // AI's initial city
    homeIslandTiles: null,          // Cached flood-fill result
    homeIslandCities: new Set(),    // Cities discovered on home island
    explorationPhase: PHASE.LAND,

    // Player contact
    hasSeenPlayerUnit: false,
    hasSeenPlayerCity: false,

    // Strategic tracking
    lostCities: new Set(),          // Cities we owned that player took

    // Observation symmetry
    lastTurnObservations: []        // What AI saw during player's turn
  };
}
```

### Knowledge Update Timing

Knowledge is updated **twice per AI turn**:

1. At turn start (see current visibility)
2. After movements (scouts may have discovered new areas)

Contact made during movement can trigger immediate phase transitions.

---

## Turn Execution Flow

```javascript
function executeAITurn(gameState, knowledge) {
  // 1. Update knowledge
  k = updateAIKnowledge(knowledge, state);

  // 2. Detect threats (transports, naval, etc.)
  const threats = detectThreats(state, k);

  // 3. Check phase transitions
  k.explorationPhase = determinePhase(k, state);

  // 4. Handle production
  state = handleProduction(state, k, turnLog);

  // 5. Reset unit moves, heal, refuel
  state.units = resetAIUnits(state);

  // 6. Decide actions (with threat awareness)
  for (const unit of aiUnits) {
    const action = decideUnitAction(unit, state, k, threats);
    if (action.type === 'goto') setPath(unit, action.target);
  }

  // 7. Execute movements
  state = executeMovementsWithObservations(state, turnLog);

  // 8. Update knowledge again (post-movement discovery)
  k = updateAIKnowledge(k, state);

  // 9. Re-check phase if contact made
  if (newContact) k.explorationPhase = determinePhase(k, state);

  return { state, knowledge: k };
}
```

---

## Debug Logging

```javascript
const DEBUG = true;
const DEBUG_PROD = true;      // Production decisions
const DEBUG_PHASE = true;     // Phase transitions
const DEBUG_TACTICAL = true;  // Threat detection and response

// Example output:
// [AI][TACTICAL] Detected 1 player transports
// [AI][TACTICAL] THREAT: Transport at (15,8) threatens city (12,10), dist=5
// [AI][destroyer@10,12] TACTICAL: Targeting player transport at (15,8), dist=5
// [AI][fighter@12,10] Patrolling to (15,13) near city (12,10)
```

---

## File Naming

The AI module is now `ai-opponent.js` (no version number).

**Required change in strategic-conquest-game-integrated.jsx:**

```javascript
// Change from:
import { executeAITurn, createAIKnowledge } from './ai-opponent-v2.js';

// To:
import { executeAITurn, createAIKnowledge } from './ai-opponent.js';
```

---

## Changelog

| Version | Changes                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| v1      | Initial spec                                                                                                  |
| v2      | Tank staging, transport auto-loading, fractional production                                                   |
| Current | Tactical threat response, 90%+cities phase trigger, fighter patrol, transport avoidance, observation symmetry |

---

## Future Improvements

1. **Coordinated attacks**: Multi-unit assault planning
2. **Combat evaluation**: Estimate win probability before engaging  
3. **Naval task forces**: Group destroyers with transports for escort
4. **Bomber targeting**: Target high production value groupings of enemies (large stacks of tanks, battleships, carriers).  A bomber's target should be >>30 days worth of production unless a lesser target could change a pivotal battle opportunity.
5. **Adaptive difficulty**: Scale AI aggressiveness based on game state

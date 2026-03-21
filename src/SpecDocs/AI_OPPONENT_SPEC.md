# AI Opponent Design Specification

## Document Status

**Matches Implementation**: `ai-opponent.js`, `ai-helpers.js`, `ai-tactical-manager.js`
**Status**: Active — implementation is source of truth

---

## Overview

The AI opponent uses a **phase-based strategy** with **target unit distributions**, **tactical threat response**, and a **strict priority hierarchy** for unit decisions. The AI maintains its own fog of war and knowledge state separate from the player. Combat assessment uses an EV (expected value) model.

---

## Phase System

### Four Phases

```javascript
export const PHASE = {
  LAND: 'land_phase',
  TRANSITION: 'transition',
  NAVAL: 'naval_phase',
  LATE_GAME: 'late_game'
};
```

### Phase Transition Triggers

| From | To | Trigger |
|------|-----|---------|
| LAND | TRANSITION | All home island cities captured (primary) |
| LAND | TRANSITION | 90% home explored + cities captured |
| LAND | TRANSITION | (Fallback) 100% home explored |
| LAND | TRANSITION | (Edge case) 5%+ map AND 2+ cities |
| TRANSITION | NAVAL | Player contact OR 40% map explored |
| NAVAL | LATE_GAME | <10% neutral cities OR 60% city control OR 2x strength |

---

## Target Unit Distributions

```javascript
const TARGET_DIST = {
  [PHASE.LAND]: {
    tank: 1.00
  },
  [PHASE.TRANSITION]: {
    tank: 0.50, transport: 0.18, fighter: 0.17, destroyer: 0.15
  },
  [PHASE.NAVAL]: {
    tank: 0.50, destroyer: 0.13, fighter: 0.15, transport: 0.12,
    battleship: 0.04, carrier: 0.03, submarine: 0.03
  },
  [PHASE.LATE_GAME]: {
    tank: 0.35, destroyer: 0.18, fighter: 0.15, transport: 0.10,
    bomber: 0.05, battleship: 0.08, carrier: 0.05, submarine: 0.04
  }
};
```

Bombers only appear in LATE_GAME. Fractional unit counting prevents all cities building the same type:

```javascript
// 2/4 days progress on a tank = 0.5 units in distribution calculation
counts[city.producing] += (progress / spec.productionDays);
```

---

## EV-Based Combat Model

The AI uses an expected-value model to evaluate combat, replacing older type-specific win/loss tables. See `evaluateCombat()` in `ai-helpers.js`.

**Core formula:**

```
effAttack  = attRolls * 0.5 * damagePerHit
effDefense = defRolls * 0.5 * defenseDamagePerHit  (0 if stealth vs non-detector)

roundsToKillDef = defender.strength / effAttack
roundsToKillAtt = attacker.strength / effDefense  (Infinity if defender can't retaliate)

winProb = roundsToKillAtt / (roundsToKillDef + roundsToKillAtt)
netEV   = winProb * defenderValue - (1 - winProb) * attackerValue
```

**Thresholds:**

- Standard: `netEV > -attackerValue * 0.15`
- Near friendly city (dist <= 3): `netEV > -attackerValue * 0.35`

**Why this correctly prevents bad fights:**

Fighter (attRolls=1, hp=1) vs Destroyer (defRolls=4, hp=4):
- winProb = 0.5 / (8 + 0.5) = ~6%
- netEV = 0.06*8 - 0.94*6 = -5.1 — well below threshold, correctly declines

Destroyer (attRolls=4, hp=4) vs Fighter (defRolls=1, hp=1):
- winProb = 0.5 / (4 + 0.5) = ~89%
- netEV = 0.89*6 - 0.11*8 = +4.5 — correctly attacks

---

## Tactical Threat Response System

### Threat Detection

```javascript
const threats = {
  playerTransports: [],       // HIGH PRIORITY - invasion threat
  playerNavalCombat: [],      // Destroyers, subs, battleships, carriers
  playerFighters: [],         // Opportunity targets
  playerBombers: [],          // Air threat
  threatenedCities: []        // AI cities within 8 tiles of player transport
};
```

### Transport Threat Range

```javascript
if (dist <= AI_CONFIG.tactical.transportThreatRange) {  // 8 tiles
  threats.threatenedCities.push({ city, threat: transport, distance: dist });
}
```

---

## Unit-Specific Behaviors

### Transports

**Threat avoidance (two layers):**

1. Proactive: `getMoveToward()` uses `getNavalDangerZone()` as `avoidTiles` (cost penalty 20x for danger tiles)
2. Reactive: When within 3 tiles of any enemy combat ship, abort mission and flee to nearest AI city

```javascript
const nearbyThreats = threats.playerNavalCombat.filter(t =>
  manhattanDistance(unit.x, unit.y, t.x, t.y) <= 3
);
if (nearbyThreats.length > 0) {
  return { action: 'move_toward', target: nearestAiCity, reason: 'transport_evade_threat' };
}
```

**Combat rules:**
- Never attack with cargo aboard
- Never attack when damaged
- Full health, empty: only attack fighters (acceptable 1-die risk)

### Naval Combat Units (Destroyer, Submarine, Battleship, Carrier)

Priority order during mission assignment:
1. Hunt player transports (highest value, invasion threat)
2. Escort AI transports
3. Defend threatened AI cities
4. Patrol AI territory

Carriers with fighters get a combat bonus applied during combat resolution in the main game file (not in the AI's own `evaluateCombat`).

### Fighters

Phase-dependent patrol split:

```javascript
fighterPatrolByPhase: {
  land_phase: 0.00,    // All scout
  transition: 0.00,    // All scout
  naval_phase: 0.25,   // 75% scout, 25% patrol
  late_game: 0.50      // 50% scout, 50% patrol
}
```

Scouting uses `findDeepScoutTarget()` — finds the farthest unexplored area that can be reached AND returned from within current fuel. Patrolling circles AI coastal cities.

Emergency intercept: if a player transport threatens a city and no naval unit can reach it in time, fighters will attack.

### Tanks

Priority order:
1. Defend threatened cities (if reachable by land flood-fill)
2. Capture neutral/player cities
3. Recapture lost cities
4. Explore land
5. Garrison (maintain 1 tank per city)
6. Stage at coastal cities (TRANSITION/NAVAL phases)
7. Attack player cities

Reachability is verified via `floodFillLand()` before assigning any target.

---

## Priority System

| Priority | Name | Applies To | Description |
|----------|------|-----------|-------------|
| P0 | Fuel Critical | Aircraft | Return to refuel immediately |
| P0.5 | Transport Evade | Transport | Flee enemy naval within 3 tiles |
| TACTICAL | Hunt Transport | Naval Combat | Attack visible player transports |
| TACTICAL | Escort AI Transport | Destroyer | Stay with AI transport |
| TACTICAL | Defend City | Tank | Move to threatened coastal city |
| P1 | Capture City | Tank | Capture neutral/player cities |
| P1.5 | Recapture | Tank | Retake player-owned cities |
| P2 | Explore | All | Find more of the map |
| P3 | Garrison | Tank | Maintain 1 tank per city |
| P3.5 | Staging | Tank | Move to coastal cities for transport |
| P4 | Attack | Tank | Strike player cities |
| P5 | Default | All | Explore or wait |

---

## Cargo Orphan Cleanup

When a unit is destroyed, all units aboard it are removed from the game. This applies whether the destroyer is AI or player, and in fuel crashes:

```javascript
// In ai-opponent.js handleCombat:
s.units = s.units.filter(x => x.id !== deadId && x.aboardId !== deadId);
```

Same pattern in the player combat handler and fuel crash handler in `strategic-conquest-game-integrated.jsx`.

---

## AI Observation Reports (Symmetry)

The AI records what it observed during its turn (unit movements near player units/cities). The player sees these as red trail overlays in the AI Turn Summary dialog. Symmetrically, the player's movements that were observed by AI units are recorded and passed to the AI before its next turn.

```javascript
export function recordPlayerObservations(k, observations) {
  return { ...k, lastTurnObservations: observations };
}
```

---

## Configuration

```javascript
export const AI_CONFIG = {
  exploration: {
    homeComplete: 0.90,      // 90% home island explored (+ all cities captured = TRANSITION)
    navalMapThreshold: 0.40, // 40% map explored -> NAVAL
    lateNeutral: 0.10,
    lateCityControl: 0.60,
    lateStrength: 2.0
  },
  fuel: {
    fighterReturn: 0.35,     // Return at 35% fuel remaining
    bomberReturn: 0.30
  },
  defense: {
    garrisonPerCity: 1       // Minimum tanks per city
  },
  tactical: {
    fighterPatrolByPhase: { land_phase: 0, transition: 0, naval_phase: 0.25, late_game: 0.50 },
    transportThreatRange: 8, // Tiles at which transport triggers city alert
    navalThreatRange: 5      // Range for naval danger zone calculation
  }
};
```

---

## AI Knowledge State

```javascript
{
  exploredTiles: Set<"x,y">,
  startPosition: { x, y } | null,
  explorationPhase: PHASE.LAND | TRANSITION | NAVAL | LATE_GAME,
  hasSeenPlayerUnit: boolean,
  hasSeenPlayerCity: boolean,
  homeIslandTiles: Set<"x,y"> | null,     // Flood-filled from start position
  homeIslandCities: Set<"x,y">,
  lostCities: Set<"x,y">,
  lastTurnObservations: any[],
  knownCities: Set<"x,y">,
  islands: IslandRecord[],                // Partial island tracking
}
```

Knowledge is updated twice per turn: at turn start (current visibility) and after movements (scouts may have discovered new areas).

---

## Turn Execution Flow

```
executeAITurn(gameState, knowledge)
  1. updateAIKnowledge()         - what AI sees now
  2. detectThreats()             - player transports, naval, air threats
  3. determinePhase()            - check for phase transitions
  4. planProduction()            - update city production
  5. resetAIUnits()              - restore moves, fuel, heal at cities
  6. allocateUnits()             - split between exploration/tactical
  7. assignExplorationMissions() - exploration manager
  8. assignTacticalMissions()    - tactical manager
  9. executeStepByStepMovements()- move all units (highest movesLeft first)
  10. updateAIKnowledge()        - post-movement discovery
  11. re-check phase if contact  - immediate phase transition if player found
  return { state, knowledge, observations, combatEvents }
```

---

## Debug Logging

```javascript
// Master switches in ai-helpers.js
const DEBUG = true;
const DEBUG_PHASE = true;
const DEBUG_MISSIONS = true;
```

Example output:
```
[AI][PHASE] Check: phase=land_phase, homeExp=97.2%, homeCitiesCaptured=true
[AI][PHASE] LAND -> TRANSITION: All 4 home cities captured (homeExp=97%)
[AI][TACTICAL] Detected 1 player transports
[AI][TACTICAL] 2 cities under threat
[AI][MISSION] transport#14@(22,15): ferry_invasion(30,12) - ferry to known city
```

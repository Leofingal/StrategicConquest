# AI Manager Architecture

## Overview

The AI opponent uses a **three-manager command hierarchy** that coordinates unit missions and city production at a strategic level, with per-step tactical reactions handled during movement execution.

```
executeAITurn()
    |
    +- updateAIKnowledge()           <- fog, islands, contacts
    +- detectThreats()               <- player transports, naval, air
    +- determinePhase()              <- LAND/TRANSITION/NAVAL/LATE_GAME
    +- planProduction()              <- committed production, no flip-flopping
    +- resetUnitMoves()              <- heal, refuel, restore moves
    +- allocateUnits()               <- split units between managers
    +- assignExplorationMissions()   <- scouts, island explore, ferry invasion
    +- assignTacticalMissions()      <- combat, escort, defense
    +- executeStepByStepMovements()  <- units follow missions + immediate reactions
    +- updateAIKnowledge() (again)   <- post-movement discovery
```

---

## File Structure

| File | Purpose | Lines |
|------|---------|-------|
| `ai-opponent.js` | Main orchestrator: executeAITurn, knowledge, phases, movement execution | 1080 |
| `ai-helpers.js` | Shared utilities: geometry, pathfinding, combat eval, logging, constants | 610 |
| `ai-city-manager.js` | Production coordination: committed builds, deficit tracking | 182 |
| `ai-exploration-manager.js` | Scout assignments, island tracking, frontier cities, ferry invasions | 1025 |
| `ai-tactical-manager.js` | Combat missions, escort, transport avoidance, threat response | 412 |

---

## Shared Data Structures

### Mission Object

```javascript
{
  type: string,           // Mission type
  target: { x, y },
  targetKey?: string,     // "x,y" for dedup
  assignedBy: 'exploration' | 'tactical',
  priority: number,       // 1-10
  reason: string,
}
```

### Unit Allocation

```javascript
// TACTICAL_ALLOCATION[phase][unitType] = fraction given to tactical manager
// Tanks and transports always go to exploration manager
{
  [PHASE.LAND]:      { fighter: 0,    destroyer: 0,    submarine: 0, battleship: 0, carrier: 0,    bomber: 0 },
  [PHASE.TRANSITION]:{ fighter: 0,    destroyer: 0,    submarine: 0, battleship: 0, carrier: 0,    bomber: 0 },
  [PHASE.NAVAL]:     { fighter: 0.30, destroyer: 0.70, submarine: 1, battleship: 1, carrier: 0.70, bomber: 0.50 },
  [PHASE.LATE_GAME]: { fighter: 0.70, destroyer: 0.90, submarine: 1, battleship: 1, carrier: 0.90, bomber: 1 },
}
```

Split is deterministic per unit ID: `(unit.id % 100) / 100 < tacticalPct`.

---

## Manager Interfaces

### City Manager

```javascript
// ai-city-manager.js
export function planProduction(state, knowledge, turnLog)
// Returns: modified state with updated city.producing
// Rules:
//   - NEVER switch production mid-build (progress > 0)
//   - Use target distribution for current phase
//   - Fractional counting: 2/4 days = 0.5 units in distribution
//   - Respect coastal/inland constraints
```

### Exploration Manager

```javascript
// ai-exploration-manager.js
export function assignExplorationMissions(state, knowledge, units, phase, turnLog)
// Returns: Map<unitId, { mission }>
// Responsibilities:
//   - Assign fighters to sectors for deep scouting
//   - Route fighters to frontier cities when local area explored
//   - Assign naval units to follow island coastlines
//   - Dispatch transports to discovered neutral/player cities
//   - Stage tanks at coastal cities for transport pickup
//   - Track and merge partial islands

export function updateIslandKnowledge(knowledge, state)
// Returns: updated knowledge with merged islands
```

### Tactical Manager

```javascript
// ai-tactical-manager.js
export function assignTacticalMissions(state, knowledge, units, threats, phase, turnLog)
// Returns: Map<unitId, { mission }>

export function detectThreats(state, knowledge)
// Returns: { playerTransports, playerNavalCombat, playerFighters, playerBombers, threatenedCities }

export function getNavalDangerZone(state, knowledge)
// Returns: Set<"x,y"> of tiles within naval threat range of visible player combat ships
// Used by getMoveToward(unit, target, state, avoidTiles) for transport routing
```

---

## Movement Execution

Units follow their assigned mission as strategic direction. `decideNextStep()` uses a layered priority system:

```javascript
function decideNextStep(unit, state, knowledge, threats, missions) {
  // 0. FUEL CRITICAL (aircraft only): return to nearest refuel immediately

  // 1. TRANSPORT UNLOAD: if at destination with cargo, unload before moving

  // 2. TRANSPORT EVADE: if enemy naval within 3 tiles, abort mission and flee
  //    to nearest friendly city using getNavalDangerZone() as avoidTiles

  // 3. ADJACENT REACTIONS (always checked before mission):
  //    - Adjacent capturable city -> capture it
  //    - Adjacent enemy with favorable EV -> attack

  // 4. FOLLOW MISSION: move toward mission.target via getMoveToward()
  //    - Aircraft check fuel allows reaching target AND returning
  //    - getMoveToward uses avoidTiles for transport danger zone routing

  // 5. DEFAULT (no mission): explore or wait
}
```

---

## Transport Threat Avoidance

Transports use a two-layer avoidance system:

**Layer 1: Proactive routing (mission pathfinding)**

`getMoveToward(unit, target, state, avoidTiles)` accepts a `Set<"x,y">` of tiles to penalize (cost 20x). When routing a transport, the exploration manager passes `getNavalDangerZone()` as the avoidTiles set. This steers the path around areas near visible enemy combat ships.

**Layer 2: Reactive evasion (step execution)**

If a transport finds itself within 3 tiles of an enemy combat ship during step execution (i.e., already inside the danger zone), it abandons its current mission and retreats to the nearest friendly city regardless of path cost.

```javascript
// In decideNextStep, for transports:
const nearbyThreats = threats.playerNavalCombat.filter(t =>
  manhattanDistance(unit.x, unit.y, t.x, t.y) <= 3
);
if (nearbyThreats.length > 0) {
  // Flee to nearest AI city, ignoring current mission
  return { action: 'move_toward', target: nearestCity, reason: 'transport_evade_threat' };
}
```

---

## EV-Based Combat Assessment

The `evaluateCombat()` function in `ai-helpers.js` uses an expected-value model to decide whether an AI unit should initiate combat.

**Formula:**

```
effAttack  = attRolls * 0.5 * damagePerHit
effDefense = defRolls * 0.5 * defenseDamagePerHit  (0 if stealth vs non-detector)

roundsToKillDef = defender.strength / effAttack
roundsToKillAtt = attacker.strength / effDefense  (Infinity if defender can't fight back)

winProb = roundsToKillAtt / (roundsToKillDef + roundsToKillAtt)
netEV   = winProb * defenderValue - (1 - winProb) * attackerValue
```

**Decision thresholds:**

- Standard: `netEV > -attackerValue * 0.15` (accept small negative EV for strategic value)
- Near friendly city (dist <= 3): `netEV > -attackerValue * 0.35` (unit can heal if it survives)

**Value calculation:**

- `attackerValue = attSpec.productionDays` (full replacement cost, not health-discounted — a damaged unit heals for free)
- Plus cargo value: each unit aboard contributes its own `productionDays` to the attacker's total risk
- `defenderValue = defSpec.productionDays * defender.strength / defSpec.strength` (health-discounted — a half-dead enemy is less of a threat)
- Plus cargo value: units aboard the defender also add to `defenderValue`

**Special overrides (applied before EV model):**

- Transport with cargo: never attacks (catastrophic risk)
- Transport damaged: never attacks (heal first)
- Transport full health, empty: only attacks fighters (1-die combat acceptable)
- Loaded carrier: only attacks if `attacker.strength >= defender.strength * 2`

**Example — Fighter vs Destroyer:**

```
attRolls = 1, damagePerHit = 1, effAttack = 0.5
defRolls = 4, defenseDamagePerHit = 1, effDefense = 2.0

roundsToKillDef = 4 / 0.5 = 8 rounds
roundsToKillAtt = 1 / 2.0 = 0.5 rounds

winProb = 0.5 / (8 + 0.5) = 5.9%
netEV   = 0.059 * 8 - 0.941 * 6 = -5.2

netEV (-5.2) << threshold (-0.9), so fighter correctly declines combat.
```

---

## Carrier Non-Advance Fix

After winning combat, naval units cannot advance onto non-water tiles unless it is a friendly city:

```javascript
const canAdvance = !attSpec.isNaval || targetTile === WATER
  || (s.cities[`${next.x},${next.y}`]?.owner === 'ai');
if (canAdvance) {
  s.units[newIdx] = { ...s.units[newIdx], x: next.x, y: next.y };
}
```

This prevents carriers and other naval units from "landing" on enemy city tiles after defeating a defender.

---

## Cargo Orphan Cleanup

When any unit is destroyed in AI combat, units aboard it are also removed:

```javascript
// In handleCombat (ai-opponent.js):
s.units = s.units.filter(x => x.id !== deadId && x.aboardId !== deadId);
```

This applies for both attacker and defender destruction. The same pattern is used in player combat and fuel crash handling in the main game file.

---

## Phase Transitions

| From | To | Primary Trigger |
|------|-----|---------|
| LAND | TRANSITION | All home island cities captured |
| LAND | TRANSITION | 90% home explored + cities captured |
| LAND | TRANSITION | (Fallback) 100% home explored |
| LAND | TRANSITION | (Edge case) 5%+ map AND 2+ cities |
| TRANSITION | NAVAL | Player contact (unit or city seen) |
| TRANSITION | NAVAL | 40% map explored |
| NAVAL | LATE_GAME | <10% neutral cities remaining |
| NAVAL | LATE_GAME | 60% city control |
| NAVAL | LATE_GAME | 2x AI unit strength vs player |

---

## Target Unit Distributions

```javascript
const TARGET_DIST = {
  [PHASE.LAND]:       { tank: 1.00 },
  [PHASE.TRANSITION]: { tank: 0.50, transport: 0.18, fighter: 0.17, destroyer: 0.15 },
  [PHASE.NAVAL]:      { tank: 0.50, destroyer: 0.13, fighter: 0.15, transport: 0.12,
                         battleship: 0.04, carrier: 0.03, submarine: 0.03 },
  [PHASE.LATE_GAME]:  { tank: 0.35, destroyer: 0.18, fighter: 0.15, transport: 0.10,
                         bomber: 0.05, battleship: 0.08, carrier: 0.05, submarine: 0.04 }
};
```

Note: Bombers only appear in LATE_GAME.

---

## Logging

### Turn Summary (always logged)

```
[AI][PHASE] naval_phase
[AI][EXPLORE] 34.2% explored (2644/7728)
[AI][EXPLORE] 3 neutral cities known, 1 player cities known
[AI][EXPLORE] Home island: 312/320 tiles explored (97%), cities: 4/4 captured
[AI][PROD] City (12,8): fighter - 3/6 days [COASTAL]
[AI][UNITS] tank: 8, fighter: 3, transport: 2, destroyer: 2
[AI][MISSION] transport#14@(22,15): ferry_invasion(30,12) - ferry to known city
```

### Movement: minimal
Only logs combat, captures, crashes, and transport loading. No per-step position spam.

---

## External Interface

The main game file imports only:

```javascript
import { executeAITurn, createAIKnowledge, createAIKnowledgeFromState, recordPlayerObservations } from './ai-opponent.js';
```

All internal restructuring is invisible to the main game.

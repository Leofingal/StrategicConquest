# AI Manager Architecture

## Overview

The AI opponent uses a **three-manager command hierarchy** that coordinates unit missions and city production at a strategic level, with per-step tactical reactions handled during movement execution.

```
executeAITurn()
    │
    ├─ updateAIKnowledge()           ← fog, islands, contacts
    ├─ determinePhase()              ← LAND/TRANSITION/NAVAL/LATE_GAME
    ├─ cityManager.planProduction()  ← committed production, no flip-flopping
    ├─ resetUnitMoves()              ← heal, refuel, restore moves
    ├─ explorationManager.assignMissions()  ← scouts, island explore, frontier
    ├─ tacticalManager.assignMissions()     ← combat, escort, defense
    └─ executeStepByStepMovements()  ← units follow missions + immediate reactions
```

---

## File Structure

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `ai-opponent.js` | Main orchestrator: executeAITurn, knowledge, phases, movement execution | ~500 |
| `ai-helpers.js` | Shared utilities: findNearest, floodFill, combat eval, logging, constants | ~300 |
| `ai-city-manager.js` | Production coordination: committed builds, deficit tracking | ~200 |
| `ai-exploration-manager.js` | Scout assignments, island tracking, frontier cities, rebase | ~400 |
| `ai-tactical-manager.js` | Combat missions, escort, transport protection, threat response | ~350 |

---

## Shared Data Structures

### Mission Object (assigned by managers, consumed by movement)

```javascript
{
  type: string,           // Mission type (see below)
  target: { x, y },      // Primary destination
  targetKey: string,      // "x,y" for dedup (optional)
  assignedBy: string,     // 'exploration' | 'tactical' | 'city'
  priority: number,       // 1-10, higher = more important
  reason: string,         // Human-readable for logging
}
```

### Mission Types

| Type | Assigned By | Description |
|------|-------------|-------------|
| `explore_sector` | Exploration | Fighter deep-scouts a map sector |
| `explore_island_coast` | Exploration | Naval unit follows island coastline |
| `explore_island_interior` | Exploration | Fighter explores newly found island |
| `rebase` | Exploration | Fighter relocates to frontier city |
| `capture_city` | Exploration | Tank moves to neutral/player city |
| `ferry_invasion` | Exploration | Transport delivers tanks to target island |
| `stage_coastal` | Exploration | Tank moves to coast for transport pickup |
| `hunt_target` | Tactical | Combat unit attacks high-value target |
| `escort_transport` | Tactical | Destroyer escorts AI transport |
| `defend_city` | Tactical | Unit moves to defend threatened city |
| `patrol_area` | Tactical | Fighter patrols around AI territory |
| `garrison` | Exploration | Tank stays in city as defense |

### Island Tracking (in knowledge)

```javascript
knowledge.islands = [
  {
    id: 0,
    tiles: Set<string>,           // Known land tiles "x,y"
    cities: Set<string>,          // Known city keys on this island
    coastTiles: Set<string>,      // Known coastal tiles (land adj to water)
    exploredPct: number,          // % of known tiles that are in exploredTiles
    isHomeIsland: boolean,
    fullyMapped: boolean,         // true when no unexplored adj to known coast
  }
]
```

Islands are partial — they only contain tiles the AI has actually explored. When newly explored land connects two partial islands, they merge.

### Unit Allocation Map (per turn)

```javascript
{
  unitId: {
    manager: 'exploration' | 'tactical' | 'unassigned',
    mission: Mission | null,
  }
}
```

Allocation is determined by phase:

| Phase | Exploration Gets | Tactical Gets |
|-------|-----------------|---------------|
| LAND | All units | None |
| TRANSITION | All units | City defense only |
| NAVAL | Fighters 70%, tanks, transports | Destroyers, subs, battleships, fighters 30% |
| LATE_GAME | Fighters 30%, transports | Most combat units, fighters 70% |

---

## Manager Interfaces

### City Manager

```javascript
// ai-city-manager.js
export function planProduction(state, knowledge, turnLog)
  // Returns: modified state with updated city.producing
  // Rules:
  //   - NEVER switch production mid-build (progress > 0)
  //   - Only assign production to idle cities (progress === 0 or no producing)
  //   - Use target distribution for current phase
  //   - Respect coastal/inland constraints
  //   - Emergency override: only if unit count is 0 for a critical type
```

### Exploration Manager

```javascript
// ai-exploration-manager.js
export function assignExplorationMissions(state, knowledge, units, phase, turnLog)
  // Returns: Map<unitId, Mission>
  // Responsibilities:
  //   - Assign fighters to sectors for deep scouting
  //   - Route fighters to frontier cities when local area explored
  //   - Assign naval units to follow island coastlines
  //   - Dispatch transports to discovered neutral cities
  //   - Stage tanks at coastal cities
  //   - Track and merge partial islands

export function updateIslandKnowledge(knowledge, state, newlyExplored)
  // Returns: updated knowledge with merged islands
  // Called after each movement sub-step when new tiles are discovered
```

### Tactical Manager

```javascript
// ai-tactical-manager.js
export function assignTacticalMissions(state, knowledge, units, threats, phase, turnLog)
  // Returns: Map<unitId, Mission>
  // Responsibilities:
  //   - Hunt player transports (highest priority)
  //   - Escort AI transports
  //   - Defend threatened cities
  //   - Assign patrol routes
  //   - Avoid exposing AI transports to player vision

export function detectThreats(state, knowledge)
  // Returns: threats object (playerTransports, etc.)
```

---

## Movement Execution

The step-by-step movement system remains largely the same, but units now consult their **mission** for strategic direction instead of calling `decideNextStep()` from scratch:

```javascript
function decideNextStep(unit, state, knowledge, threats, missions) {
  // 1. IMMEDIATE REACTIONS (always checked):
  //    - Fuel critical → return to nearest refuel
  //    - Adjacent capturable city → capture it
  //    - Adjacent favorable combat → attack

  // 2. FOLLOW MISSION (from manager assignment):
  //    - Get mission from missions map
  //    - Move toward mission target
  //    - If blocked, try alternate path

  // 3. DEFAULT (no mission, no reaction):
  //    - Wait
}
```

---

## Logging Overhaul

### Turn Summary (always logged)

```
======== AI TURN 15 ========
[PHASE] transition
[EXPLORE] Turn start: 12.3% explored → explored 47 new tiles → 12.8% explored
[EXPLORE] 3 neutral cities known, 0 player cities known
[EXPLORE] 2 partial islands tracked (home: 89% mapped)
[PRODUCTION] City (12,8): Fighter - 3/6 days
[PRODUCTION] City (15,10): Tank - 2/4 days
[PRODUCTION] City (10,12): Transport - 1/10 days [COASTAL]
[PRODUCTION] City (14,6): Tank - 4/4 days → COMPLETED, next: Fighter
[PRODUCTION] City (18,9): Destroyer - 5/8 days [COASTAL]
[UNITS] Tanks: 3, Fighters: 2, Transports: 0, Destroyers: 1
[UNITS] Target: tank 50%, transport 18%, fighter 17%, destroyer 15%
[MISSIONS] fighter#5: explore_sector(NE) from city(12,8)
[MISSIONS] fighter#8: explore_island(island#2) from city(15,10)
[MISSIONS] tank#3: capture_city(22,15)
[MISSIONS] tank#6: stage_coastal(15,10)
======== AI TURN 15 END ========
```

### Movement logging: MINIMAL

Only log combat, captures, crashes, and transport loading. No per-step "moved to (x,y)" spam.

---

## Phase Transitions (unchanged)

| From | To | Trigger |
|------|-----|---------|
| LAND | TRANSITION | 90% home explored AND all home cities captured |
| LAND | TRANSITION | 100% home explored (fallback) |
| LAND | TRANSITION | 5%+ map AND 2+ cities (edge case) |
| TRANSITION | NAVAL | Player contact OR 40% map explored |
| NAVAL | LATE_GAME | <10% neutral OR 60% city control OR 2× strength |

---

## External Interface (UNCHANGED)

The main game file continues to import exactly the same functions:

```javascript
import { executeAITurn, createAIKnowledge, createAIKnowledgeFromState, recordPlayerObservations } from './ai-opponent.js';
```

All internal restructuring is invisible to the main game.

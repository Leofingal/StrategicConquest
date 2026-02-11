# AI Opponent Design Specification

## Current Problem
The AI in strategic-conquest-game.jsx is not taking its turns. Possible causes:
1. AI logic not being triggered properly in turn cycle
2. AI units not finding valid moves
3. Pathfinding failing for AI units
4. AI execution being skipped silently

## AI Requirements

### Core Principles
1. **Predictable but challenging**: AI should feel logical, not random
2. **Difficulty scaling**: Same AI logic, different starting advantages
3. **Performance**: AI turn should complete in <2 seconds
4. **Observable**: AI actions should be visible to player
5. **Configurable**: Easy to tune without rewriting

---

## AI Decision Framework

### Priority System (0.0 to 1.0 scale)

```javascript
const AI_PRIORITIES = {
  // Offensive priorities
  captureNeutralCity: 0.85,      // Go for easy wins first
  attackPlayerCity: 0.45,         // Risky, only when advantageous
  attackPlayerUnit: 0.35,         // Opportunistic
  
  // Defensive priorities
  defendOwnCity: 0.90,            // Protect what we have
  reinforceWeakCity: 0.70,        // Prevent loss
  
  // Economic priorities
  buildUp: 0.60,                  // Produce units steadily
  explore: 0.50,                   // Discover map
  
  // Transport priorities
  loadTanks: 0.75,                // Get tanks across water
  ferryToFront: 0.80,             // Active transport missions
};
```

### Decision Tree (per unit, per turn)

```
For each AI unit:
  ↓
Can attack enemy unit in range?
  Yes → Calculate win probability → > 70% → ATTACK
  No → Continue
  ↓
Can capture city in range?
  Yes → Is neutral? → Yes → CAPTURE (high priority)
       ↓ No
       Is player city? → Calculate garrison → Weak? → CAPTURE
  No → Continue
  ↓
Has GoTo path assigned?
  Yes → Continue path (already has orders)
  No → Continue
  ↓
Determine unit role:
  Tank → Find nearest neutral city OR explore
  Fighter → Scout unexplored areas
  Bomber → Wait for targets (expensive, cautious)
  Transport → Load tanks OR ferry to landing zone
  Destroyer → Patrol / hunt subs / escort transports
  Submarine → Hunt player naval units / patrol
  Carrier → Support fighters / hold position
  Battleship → Bombardment positions / escort
  ↓
Assign GoTo path based on role
  ↓
Execute one step of path
```

---

## AI Strategic Phases

The AI should adapt its strategy based on game state:

### Phase 1: Early Game (Turns 1-15)
**Focus**: Secure neutral cities, explore map
- 90% priority: capture neutral cities
- 10% priority: explore
- Production: 70% tanks, 20% transports, 10% fighters

### Phase 2: Expansion (Turns 16-40)
**Focus**: Establish dominance, build economy
- If AI cities > player cities: consolidate, defend
- If AI cities < player cities: aggressive expansion
- If AI cities ≈ player cities: balanced
- Production: 50% tanks, 30% naval, 20% air

### Phase 3: Late Game (Turn 40+)
**Focus**: Achieve victory or desperate defense
- If winning (2x cities): aggressive push
- If losing (0.5x cities): all-in attacks
- If even: strategic warfare
- Production: balanced based on threats

---

## AI Production Strategy

### Coastal Cities
Priority order:
1. **Tanks** (if < 5 tanks owned) → land conquest
2. **Transports** (if < 2 transports AND tanks > 3) → ferry capability
3. **Destroyers** (if player has subs) → counter threat
4. **Carriers** (if fighters > 4 AND no carriers) → air support
5. **Battleships** (late game, if strong economy) → naval dominance
6. Default: **Tanks**

### Inland Cities
Priority order:
1. **Tanks** (always good)
2. **Fighters** (if < 3 fighters owned) → reconnaissance
3. **Bombers** (late game, if economy strong) → game-enders

### Production Logic
```javascript
function determineProduction(city, gameState, aiState) {
  const isCoastal = isAdjacentToWater(city.x, city.y, gameState.map);
  const aiUnits = gameState.units.filter(u => u.owner === 'ai');
  
  // Count unit types
  const tanks = aiUnits.filter(u => u.type === 'tank').length;
  const transports = aiUnits.filter(u => u.type === 'transport').length;
  const fighters = aiUnits.filter(u => u.type === 'fighter').length;
  
  // Early game: tanks
  if (gameState.turn < 15 && tanks < 10) return 'tank';
  
  // Coastal logic
  if (isCoastal) {
    if (tanks >= 5 && transports < 2) return 'transport';
    if (tanks >= 8 && transports >= 2) return 'destroyer';
    return 'tank';
  }
  
  // Inland logic
  if (fighters < 3) return 'fighter';
  return 'tank';
}
```

---

## AI Unit Behaviors

### Tank AI
```javascript
function tankBehavior(tank, gameState, aiKnowledge) {
  // 1. Check for capturable cities in range
  const neutralCities = findNeutralCitiesInRange(tank, aiKnowledge, range=1);
  if (neutralCities.length > 0) {
    return setGoTo(tank, neutralCities[0]); // Immediate capture
  }
  
  // 2. Check for player cities (aggressive)
  const playerCities = findPlayerCitiesInRange(tank, aiKnowledge, range=10);
  if (playerCities.length > 0 && shouldAttackCity(tank, playerCities[0])) {
    return setGoTo(tank, playerCities[0]);
  }
  
  // 3. Look for known neutral cities
  const knownNeutral = aiKnowledge.cities.filter(c => c.owner === 'neutral');
  if (knownNeutral.length > 0) {
    const nearest = findNearest(tank, knownNeutral);
    return setGoTo(tank, nearest);
  }
  
  // 4. Explore (head toward unexplored regions)
  const unexploredTarget = findUnexploredDirection(tank, aiKnowledge);
  if (unexploredTarget) {
    return setGoTo(tank, unexploredTarget, maxDist=10);
  }
  
  // 5. Default: stay put or random move
  return null;
}
```

### Transport AI
```javascript
function transportBehavior(transport, gameState, aiKnowledge) {
  const cargo = gameState.units.filter(u => u.aboardId === transport.id);
  
  // 1. If empty, go to friendly city to load tanks
  if (cargo.length === 0) {
    const friendlyCities = aiKnowledge.cities.filter(c => c.owner === 'ai' && isCoastal(c));
    const cityWithTanks = friendlyCities.find(c => {
      const tanksHere = gameState.units.filter(u => 
        u.x === c.x && u.y === c.y && 
        u.type === 'tank' && 
        u.owner === 'ai' && 
        !u.aboardId
      );
      return tanksHere.length > 0;
    });
    
    if (cityWithTanks) return setGoTo(transport, cityWithTanks);
  }
  
  // 2. If loaded, ferry to landing zone near target
  if (cargo.length > 0) {
    // Find target city (neutral or player)
    const targetCities = [
      ...aiKnowledge.cities.filter(c => c.owner === 'neutral'),
      ...aiKnowledge.cities.filter(c => c.owner === 'player')
    ];
    
    if (targetCities.length > 0) {
      const target = findNearest(transport, targetCities);
      // Find water tile adjacent to target
      const landingZone = findAdjacentWater(target, gameState.map);
      if (landingZone) return setGoTo(transport, landingZone);
    }
  }
  
  // 3. Default: patrol near coast
  return null;
}
```

### Fighter AI
```javascript
function fighterBehavior(fighter, gameState, aiKnowledge) {
  // 1. Check fuel - must return to base if low
  if (fighter.fuel < 10) {
    const nearestBase = findNearestRefuelPoint(fighter, gameState, aiKnowledge);
    if (nearestBase) return setGoTo(fighter, nearestBase);
  }
  
  // 2. Scout unexplored areas (primary role)
  const unexplored = findLargestUnexploredArea(fighter, aiKnowledge);
  if (unexplored && fighter.fuel > 20) {
    return setGoTo(fighter, unexplored, maxDist=fighter.fuel/2);
  }
  
  // 3. Return to carrier/city
  const base = findNearestRefuelPoint(fighter, gameState, aiKnowledge);
  return setGoTo(fighter, base);
}
```

### Destroyer AI
```javascript
function destroyerBehavior(destroyer, gameState, aiKnowledge) {
  // 1. Hunt known submarines
  const enemySubs = gameState.units.filter(u => 
    u.owner !== 'ai' && 
    u.type === 'submarine' &&
    aiKnowledge.lastSeen[u.id] // we've seen this sub
  );
  
  if (enemySubs.length > 0) {
    const nearest = findNearest(destroyer, enemySubs);
    return setGoTo(destroyer, nearest);
  }
  
  // 2. Escort transports
  const friendlyTransports = gameState.units.filter(u => 
    u.owner === 'ai' && 
    u.type === 'transport'
  );
  
  if (friendlyTransports.length > 0) {
    const transportWithCargo = friendlyTransports.find(t => 
      gameState.units.some(u => u.aboardId === t.id)
    );
    if (transportWithCargo) {
      // Stay near transport
      return setGoTo(destroyer, transportWithCargo);
    }
  }
  
  // 3. Patrol sea routes
  const patrolPoint = findSeaPatrolPoint(destroyer, gameState);
  return setGoTo(destroyer, patrolPoint);
}
```

---

## AI Knowledge System

The AI maintains separate fog of war and knowledge base:

```javascript
const aiKnowledge = {
  exploredTiles: Set(), // tiles AI has seen
  cities: [
    { x, y, owner, lastSeen: turnNumber }
  ],
  enemyUnits: [
    { type, x, y, lastSeen: turnNumber }
  ],
  strategicAssessment: {
    playerStrength: 0.7, // estimated 0-1
    economicAdvantage: 0.5, // -1 to 1
    territorialControl: 0.6, // 0-1
  }
};
```

---

## AI Tuning Parameters

Exposed configuration object for easy adjustment:

```javascript
export const AI_CONFIG = {
  // Difficulty (affects starting resources, not intelligence)
  difficulty: 5, // 1-10
  
  // Personality (affects decision weights)
  personality: 'balanced', // 'aggressive', 'defensive', 'economic', 'balanced'
  
  // Behavior thresholds
  retreatThreshold: 0.3, // retreat if unit strength < 30%
  attackThreshold: 0.7, // attack if win probability > 70%
  
  // Strategic weights (0-1)
  weights: {
    expansion: 0.8,
    defense: 0.6,
    economy: 0.7,
    aggression: 0.4,
  },
  
  // Production preferences (must sum to 1.0)
  productionMix: {
    land: 0.5,
    naval: 0.3,
    air: 0.2,
  },
  
  // Performance
  maxPathfindingDistance: 50, // tiles
  maxUnitsProcessedPerTurn: 50,
  thinkingTimeMs: 100, // delay between moves for visibility
};
```

---

## Debugging AI Issues

### Diagnostic Checklist

1. **Is AI turn being called?**
   - Add `console.log('AI turn starting')` at entry
   - Check turn counter increments

2. **Are AI units found?**
   - Log `aiUnits.length`
   - Check owner property is 'ai'

3. **Are valid moves calculated?**
   - Log `getValidMoves(aiUnit)` result
   - Check if units are stuck

4. **Is pathfinding working?**
   - Log pathfinding attempts and results
   - Check if paths are being assigned

5. **Are GoTo paths executing?**
   - Log when units have gotoPath
   - Check if path array is being consumed

6. **Is AI production working?**
   - Log AI city production each turn
   - Check if new units are spawning

### Debug Output Example

```javascript
function executeAITurn(gameState) {
  console.log('=== AI TURN START ===');
  console.log('Turn:', gameState.turn);
  
  const aiUnits = gameState.units.filter(u => u.owner === 'ai');
  console.log('AI units:', aiUnits.length);
  
  aiUnits.forEach(unit => {
    console.log(`Unit ${unit.id} (${unit.type}): pos=(${unit.x},${unit.y}), moves=${unit.movesLeft}`);
    
    const moves = getValidMoves(unit, gameState);
    console.log(`  Valid moves: ${moves.length}`);
    
    // ... decision logic
    
    if (unit.gotoPath) {
      console.log(`  Assigned path: ${unit.gotoPath.length} steps`);
    }
  });
  
  console.log('=== AI TURN END ===');
}
```

---

## Testing AI

### Unit Tests
```javascript
// Test AI finds nearest neutral city
test('AI tank targets neutral city', () => {
  const gameState = createTestGameState();
  const tank = createAITank(10, 10);
  const neutralCity = { x: 12, y: 10, owner: 'neutral' };
  
  const decision = tankBehavior(tank, gameState, aiKnowledge);
  
  expect(decision.type).toBe('goto');
  expect(decision.target).toEqual(neutralCity);
});
```

### Integration Tests
```javascript
// Test full AI turn
test('AI executes complete turn', () => {
  const gameState = createGameState('small', 'normal', 5);
  const initialAIUnits = gameState.units.filter(u => u.owner === 'ai').length;
  
  const newState = executeAITurn(gameState);
  
  // AI units should have moved or done something
  const aiUnitsAfter = newState.units.filter(u => u.owner === 'ai');
  expect(aiUnitsAfter.length).toBeGreaterThanOrEqual(initialAIUnits);
  
  // At least one unit should have reduced moves
  const movedUnits = aiUnitsAfter.filter(u => u.movesLeft < UNIT_SPECS[u.type].movement);
  expect(movedUnits.length).toBeGreaterThan(0);
});
```

---

## Next Steps for AI Implementation

1. **Extract AI logic** from current game file
2. **Add extensive logging** to diagnose current issue
3. **Implement simple AI first** (just capture nearest neutral city)
4. **Test and verify** AI takes turns
5. **Gradually add complexity** (exploration, production, strategy)
6. **Tune parameters** based on playtesting

---

## AI Personality Presets

```javascript
const AI_PERSONALITIES = {
  aggressive: {
    weights: { expansion: 0.9, defense: 0.4, economy: 0.5, aggression: 0.9 },
    attackThreshold: 0.5,
    retreatThreshold: 0.2,
  },
  
  defensive: {
    weights: { expansion: 0.5, defense: 0.9, economy: 0.7, aggression: 0.3 },
    attackThreshold: 0.8,
    retreatThreshold: 0.5,
  },
  
  economic: {
    weights: { expansion: 0.7, defense: 0.6, economy: 0.9, aggression: 0.2 },
    attackThreshold: 0.8,
    retreatThreshold: 0.4,
  },
  
  balanced: {
    weights: { expansion: 0.7, defense: 0.6, economy: 0.6, aggression: 0.5 },
    attackThreshold: 0.7,
    retreatThreshold: 0.3,
  },
};
```

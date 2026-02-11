# Actual Combat Code for Inline Use

## The Real Game Uses This (Only ~30 lines!)

The actual game has a **simple 12-line combat function** plus two small wrappers.

This is what should be **inlined** in the integrated game:

```javascript
// ============================================================================
// COMBAT (inline in integrated game)
// ============================================================================
// These constants are already in game-constants.js:
// - BASE_HIT_CHANCE = 0.50
// - NAVAL_VS_LAND_HIT_CHANCE = 0.33
// - CITY_COMBAT = { strength: 1, attackRolls: 1, ... }

/**
 * Simulate combat between attacker and defender
 * Returns damage dealt and remaining strength
 */
function simulateCombat(attackerUnit, defenderSpec, defenderStr) {
  const att = UNIT_SPECS[attackerUnit.type];
  const aStr = attackerUnit.strength;
  const aRatio = aStr / att.strength;
  const dRatio = defenderStr / defenderSpec.strength;
  
  // Calculate attack/defense rolls based on current strength
  let aRolls = att.halfStrengthCombat 
    ? Math.max(1, Math.ceil(aStr * 0.5)) 
    : Math.max(1, Math.round(att.attackRolls * aRatio));
    
  let dRolls = defenderSpec.halfStrengthCombat 
    ? Math.max(1, Math.ceil(defenderStr * 0.5)) 
    : Math.max(0, Math.round(defenderSpec.defenseRolls * dRatio));
  
  // Submarine stealth: defender can't attack if not a destroyer
  if (att.stealth && !defenderSpec.detectsSubs) {
    dRolls = 0;
  }
  
  // Calculate hit chances
  const aHit = (att.isNaval && defenderSpec.isLand) 
    ? NAVAL_VS_LAND_HIT_CHANCE 
    : BASE_HIT_CHANCE;
    
  const dHit = (defenderSpec.isLand && att.isNaval) 
    ? NAVAL_VS_LAND_HIT_CHANCE 
    : BASE_HIT_CHANCE;
  
  // Roll for damage
  let dmgToDef = 0, dmgToAtt = 0;
  for (let i = 0; i < aRolls; i++) {
    if (Math.random() < aHit) dmgToDef += att.damagePerHit;
  }
  for (let i = 0; i < dRolls; i++) {
    if (Math.random() < dHit) dmgToAtt += defenderSpec.defenseDamagePerHit;
  }
  
  return { 
    dmgToDef, 
    dmgToAtt, 
    attRem: Math.max(0, aStr - dmgToAtt), 
    defRem: Math.max(0, defenderStr - dmgToDef) 
  };
}

/**
 * Resolve combat between two units
 */
function resolveCombat(attUnit, defUnit) {
  const r = simulateCombat(attUnit, UNIT_SPECS[defUnit.type], defUnit.strength);
  return { 
    attDmg: attUnit.strength - r.attRem, 
    defDmg: defUnit.strength - r.defRem, 
    attDead: r.attRem <= 0, 
    defDead: r.defRem <= 0, 
    attRem: r.attRem, 
    defRem: r.defRem 
  };
}

/**
 * Resolve attack on a city
 */
function resolveCityAttack(attUnit) {
  const r = simulateCombat(attUnit, CITY_COMBAT, 1);
  return { 
    attDmg: attUnit.strength - r.attRem, 
    cityDead: r.defRem <= 0, 
    attRem: r.attRem 
  };
}
```

**Total: ~30 lines of actual combat logic**

---

## Comparison with Combat Simulator

### combat-simulator.jsx (Testing Tool)
- **Purpose**: Balance testing, run 100+ simulations
- **Features**:
  - `isFirstAttack` parameter (test submarine after revealed)
  - `isBombard` parameter (battleship range 2 attacks)
  - Follow-up attack simulation
  - Detailed statistics (hit counts, rolls, percentages)
  - Win/loss distribution analysis
- **Size**: ~200 lines total
- **Use case**: Game designer testing unit balance

### Original Game Combat (Production Code)
- **Purpose**: Resolve ONE combat outcome
- **Features**:
  - Submarine stealth (always active vs non-destroyers)
  - Naval vs land penalties (33% vs 50%)
  - Half-strength combat (carrier/battleship)
  - Strength-based roll scaling
- **Size**: ~30 lines total
- **Use case**: Actual gameplay

---

## Verification Against game-constants.js

✅ **Unit specs match exactly:**
- submarine: `damagePerHit: 4` (4× damage)
- submarine: `stealth: true`
- destroyer: `detectsSubs: true`
- carrier/battleship: `halfStrengthCombat: true`
- All attack/defense rolls match

✅ **Combat constants exported:**
```javascript
// From game-constants.js lines 189-194
export const BASE_HIT_CHANCE = 0.50;
export const NAVAL_VS_LAND_HIT_CHANCE = 0.33;
export const CITY_COMBAT = {
  strength: 1,
  attackRolls: 1,
  defenseRolls: 1,
  damagePerHit: 1,
  defenseDamagePerHit: 1,
  isLand: true
};
```

✅ **Logic matches original game exactly** (lines 295-317 of strategic-conquest-game.jsx)

---

## Recommendation for Phase 3

**Inline these 3 functions** (~30 lines total):
1. `simulateCombat()` - Core combat logic
2. `resolveCombat()` - Unit vs unit wrapper
3. `resolveCityAttack()` - Unit vs city wrapper

**Do NOT use:**
- ❌ combat-simulator.jsx (testing tool)
- ❌ combat-engine.js (unnecessary module)

**Why inline is better:**
- Simple (~30 lines)
- Self-contained
- Only used in movement/combat execution
- No extra module needed

---

## Updated Phase 3 Target

With ~30 lines of combat code inline:
- ~30 lines: Combat functions (inline)
- ~300-400 lines: Orchestration, hooks, handlers, rendering
- ~100 lines: Menu screen (keep inline or extract later)

**Total: ~430-530 lines** ✅ (well within 600 line maximum)

Much better than trying to use the 200+ line combat simulator!

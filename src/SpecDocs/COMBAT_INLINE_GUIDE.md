# Combat System Reference

## Overview

All combat resolution is handled by inline functions in `strategic-conquest-game-integrated.jsx`. There is no separate combat module. The combat system resolves one outcome per attack — no simulation or pre-calculation.

---

## Core Combat Functions

### `simulateCombatWithDefender(attacker, defender, allUnits = [])`

Full unit-vs-unit combat. Returns `{ dmgToDef, dmgToAtt, attRem, defRem }`.

```javascript
function simulateCombatWithDefender(attacker, defender, allUnits = []) {
  const att = UNIT_SPECS[attacker.type], defSpec = UNIT_SPECS[defender.type];
  const aStr = attacker.strength, defStr = defender.strength;
  const aRatio = aStr / att.strength, dRatio = defStr / defSpec.strength;

  // Base attack/defense rolls, scaled by current health ratio
  let aRolls = att.halfStrengthCombat
    ? Math.max(1, Math.ceil(aStr * 0.5))
    : Math.max(1, Math.round(att.attackRolls * aRatio));
  let dRolls = defSpec.halfStrengthCombat
    ? Math.max(1, Math.ceil(defStr * 0.5))
    : Math.max(0, Math.round(defSpec.defenseRolls * dRatio));

  // Carrier bonus: +1 attack/defense die per 2 fighters aboard
  if (att.carriesAir) {
    const fightersAboard = allUnits.filter(u => u.aboardId === attacker.id && u.type === 'fighter').length;
    aRolls += Math.floor(fightersAboard / 2);
  }
  if (defSpec.carriesAir) {
    const fightersAboard = allUnits.filter(u => u.aboardId === defender.id && u.type === 'fighter').length;
    dRolls += Math.floor(fightersAboard / 2);
  }

  // Submarine stealth: defender can't fight back unless it has detectsSubs
  if (att.stealth && !defSpec.detectsSubs) dRolls = 0;

  // Hit chances
  const aHit = (att.isNaval && defSpec.isLand) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
  const dHit = (defSpec.isLand && att.isNaval) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;

  // Roll dice
  let dmgToDef = 0, dmgToAtt = 0;
  for (let i = 0; i < aRolls; i++) if (Math.random() < aHit) dmgToDef += att.damagePerHit;
  for (let i = 0; i < dRolls; i++) if (Math.random() < dHit) dmgToAtt += defSpec.defenseDamagePerHit;

  return { dmgToDef, dmgToAtt, attRem: Math.max(0, aStr - dmgToAtt), defRem: Math.max(0, defStr - dmgToDef) };
}
```

### `resolveCombat(att, def, allUnits = [])`

Wrapper that returns structured result:

```javascript
const resolveCombat = (att, def, allUnits = []) => {
  const r = simulateCombatWithDefender(att, def, allUnits);
  return { attDmg, defDmg, attDead: r.attRem <= 0, defDead: r.defRem <= 0, attRem: r.attRem, defRem: r.defRem };
};
```

### `resolveCityAttack(att)`

Attack vs empty city (uses `CITY_COMBAT` constant — 1 strength, 1 die, 1 damage):

```javascript
const resolveCityAttack = (att) => {
  const r = simulateCombat(att, CITY_COMBAT, 1);
  return { attDmg, cityDead: r.defRem <= 0, attRem: r.attRem };
};
```

---

## Bombardment (`resolveBombardment`)

Battleship range-2 attack. No counterattack. Uses `BOMBARD_HIT_CHANCE` (20%).

```javascript
function resolveBombardment(attacker, defender) {
  const aRolls = Math.max(1, Math.ceil(attacker.strength * 0.5));
  let dmgToDef = 0;
  for (let i = 0; i < aRolls; i++) {
    if (Math.random() < BOMBARD_HIT_CHANCE) dmgToDef += att.damagePerHit;
  }
  const defRem = Math.max(0, defender.strength - dmgToDef);
  return { hits: dmgToDef, defRem, defDead: defRem <= 0, rolls: aRolls };
}
```

Bombard targets are Chebyshev distance exactly 2 from the battleship. Found via `getBombardTargets()` in `movement-engine.js`. Bombarding consumes all remaining moves and sets `hasBombarded: true` to prevent firing twice per turn.

---

## Combat Constants (from `game-constants.js`)

```javascript
export const BASE_HIT_CHANCE = 0.50;
export const NAVAL_VS_LAND_HIT_CHANCE = 0.33;
export const BOMBARD_HIT_CHANCE = 0.20;

export const CITY_COMBAT = {
  strength: 1,
  attackRolls: 1,
  defenseRolls: 1,
  damagePerHit: 1,
  defenseDamagePerHit: 1,
  isLand: true
};
```

---

## Unit Combat Properties (from `UNIT_SPECS`)

| Unit | Strength | AttRolls | DefRolls | DmgPerHit | DefDmgPerHit | Special |
|------|----------|----------|----------|-----------|--------------|---------|
| tank | 2 | 2 | 2 | 1 | 1 | |
| fighter | 1 | 1 | 1 | 1 | 1 | |
| bomber | 1 | 1 | 0 | 1 | 0 | No defense |
| transport | 3 | 1 | 1 | 1 | 1 | |
| destroyer | 4 | 4 | 4 | 1 | 1 | detectsSubs |
| submarine | 3 | 3 | 3 | **4** | 1 | stealth, 4x attack damage |
| carrier | 10 | — | — | 1 | 1 | halfStrengthCombat, carriesAir |
| battleship | 18 | — | — | 1 | 1 | halfStrengthCombat, canBombard |

**halfStrengthCombat**: rolls = `ceil(strength * 0.5)` regardless of attackRolls/defenseRolls fields.

---

## Special Rules

### Submarine Stealth

When a submarine attacks, the defender gets 0 defense rolls (cannot fight back) unless the defender has `detectsSubs: true` (only destroyers).

```javascript
if (att.stealth && !defSpec.detectsSubs) dRolls = 0;
```

### Carrier Fighter Bonus

For each 2 fighters aboard a carrier, it gains +1 attack roll and +1 defense roll. This is applied in `simulateCombatWithDefender` using `allUnits` (the full game units array).

```javascript
const fightersAboard = allUnits.filter(u => u.aboardId === carrier.id && u.type === 'fighter').length;
const bonusDice = Math.floor(fightersAboard / 2);
// carrier with 4 fighters: +2 attack dice, +2 defense dice
```

### Naval vs Land

Naval units attacking land units (or defending against land units while at sea) have a reduced 33% hit chance instead of 50%.

```javascript
const aHit = (att.isNaval && defSpec.isLand) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
const dHit = (defSpec.isLand && att.isNaval) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
```

### Strength-Scaled Rolls

Attack and defense rolls scale with current strength ratio (simulates attrition):

```javascript
aRolls = Math.max(1, Math.round(att.attackRolls * (currentStrength / maxStrength)));
```

Exception: units with `halfStrengthCombat` (carrier, battleship) always use `ceil(strength * 0.5)` regardless.

---

## Cargo Orphan Cleanup

When any unit is destroyed (player attacks AI, AI attacks player, fuel crash), all units aboard the destroyed unit are also removed:

```javascript
// Player combat (in handleMove):
newUnits = newUnits.filter(u => u.id !== deadId && u.aboardId !== deadId);

// AI combat (in ai-opponent.js):
s.units = s.units.filter(x => x.id !== deadId && x.aboardId !== deadId);

// Fuel crash (in the fuel depletion handler):
newUnits = newUnits.filter(u => u.id !== unit.id && u.aboardId !== unit.id);
```

---

## AI Combat Decision (EV Model)

The AI uses `evaluateCombat()` from `ai-helpers.js` to decide whether to initiate combat. It does NOT use the dice-roll `simulateCombat` function for planning — instead it uses a deterministic expected-value model:

```javascript
// Effective damage per round (expected value)
const effAttack  = attRolls * 0.5 * attSpec.damagePerHit;
const effDefense = defCanFightBack ? defRolls * 0.5 * defSpec.defenseDamagePerHit : 0;

// Rounds to kill each side
const roundsToKillDef = defender.strength / effAttack;
const roundsToKillAtt = effDefense > 0 ? attacker.strength / effDefense : Infinity;

// Win probability approximation
const winProb = roundsToKillAtt === Infinity
  ? 1.0
  : roundsToKillAtt / (roundsToKillDef + roundsToKillAtt);

// Net expected value
const netEV = winProb * defenderValue - (1 - winProb) * attackerValue;

// Accept combat if EV is above threshold
const shouldAttack = netEV > -attackerValue * 0.15;
// Near friendly city: looser threshold
// netEV > -attackerValue * 0.35 is also accepted
```

**Value calculation:**

- `attackerValue` = full replacement cost (`productionDays`) + cargo value (each unit aboard contributes its own `productionDays`)
- `defenderValue` = health-discounted (`productionDays * strength / maxStrength`) + cargo value

This causes the AI to correctly avoid bad fights (e.g. fighter vs destroyer: ~6% win, large negative EV) while taking good ones (e.g. destroyer vs fighter: ~89% win, large positive EV).

---

## Example Combat Outcomes

| Attacker | Defender | Win Probability | Typical Result |
|----------|----------|----------------|----------------|
| Tank (full) | Tank (full) | 50% | Even fight |
| Destroyer | Fighter | ~89% | Destroyer wins |
| Fighter | Destroyer | ~6% | Fighter loses |
| Submarine | Transport | ~100% (stealth) | Sub wins, transport sunk with all cargo |
| Submarine | Destroyer | 50% (no stealth bonus) | Even fight |
| Carrier (4 fighters) | Battleship | Improved | +2 attack/+2 defense dice for carrier |
| Battleship (bombard) | Any unit | 20% per roll | 1-9 rolls at 20%, no counterattack |

# Unit & Combat Guide

Strategic Conquest fields eight unit types across land, sea, and air. Each has a distinct role — understanding their strengths and limits is the key to winning.

---

## Units Overview

**Cost** = production days required at a city. **Fuel** = maximum moves before the unit must land and refuel (— means no fuel limit). **Strength** = hit points; a unit is destroyed when it reaches 0.

| Unit       | Cost (days) | Strength | Moves | Fuel | Type  | Special                                        |
| ---------- | ----------- | -------- | ----- | ---- | ----- | ---------------------------------------------- |
| Tank       | 4           | 2        | 1     | —    | Land  | Captures cities                                |
| Fighter    | 6           | 1        | 20    | 20   | Air   | Can land on carriers                           |
| Bomber     | 25          | 1        | 10    | 30   | Air   | No defense in combat                           |
| Transport  | 10          | 3        | 3     | —    | Naval | Carries up to 6 tanks                          |
| Destroyer  | 8           | 4        | 4     | —    | Naval | Detects submarines                             |
| Submarine  | 10          | 3        | 3     | —    | Naval | Stealth attack                                 |
| Carrier    | 14          | 10       | 3     | —    | Naval | Carries up to 8 fighters; half-strength combat |
| Battleship | 20          | 18       | 3     | —    | Naval | Half-strength combat; range-2 bombardment      |

---

## Unit Details

### Tank

**Role:** The core of your army — the only unit that can capture cities.

- Moves 1 tile per turn across land.
- Can board a Transport by moving onto one at sea or by being in the same city.
- Combat: 2 attack dice, 2 defense dice, 1 damage per hit.
- Cheap and fast to produce. Build them constantly.



---

### Fighter

**Role:** Fast scout and air superiority unit.

- 20 moves per turn, 20 fuel capacity.
- **running out of fuel destroys the aircraft.**
- Can land on and refuel from Carriers.
- Combat: 1 attack die, 1 defense die.
- Best used against other air units and undefended or lightly defended targets.
- Avoid committing fighters to attacks against units with strong defense — they only have 1 strength point.

---

### Bomber

**Role:** Long-range strike aircraft for hitting high-value targets deep in enemy territory.

- 10 moves per turn, 30 fuel capacity.
- **Has 0 defense dice.**
- Attack will destroy every unit within 1 tile of the targeted unit.
- Expensive at 25 days — losing one to a careless move hurts.

---

### Transport

**Role:** Moves Tanks across water to enemy shores.

- Carries up to 6 Tanks.
- Tanks automatically embark when in the same city as a Transport.
- Low combat ability: 1 attack die, 1 defense die. It cannot defend itself meaningfully.
- Keep Transports away from all enemy contact.
- **If a Transport is sunk, all Tanks aboard are lost with it.**

---

### Destroyer

**Role:** The all-purpose naval combat ship and the only counter to Submarines.

- 4 moves, 4 attack dice, 4 defense dice.
- **Detects Submarines** — Submarines get no stealth bonus when fighting a Destroyer.
- The fastest naval unit and the most cost-effective in direct fleet battles.

---

### Submarine

**Role:** Stealth ambush unit — devastatingly effective against ships that cannot detect it.

- 3 moves, 3 attack dice, 1 defense die, 3 strength.
- When attacking any ship **other than a Destroyer**, the target gets **0 defense dice** — it cannot fight back at all.
- Deals 4× normal damage per hit against naval targets when in stealth mode.
- Very fragile if caught — only 3 strength and 1 defense die.
- A Destroyer will detect and defeat a Submarine in a fair fight. Always check for enemy Destroyers before committing a Submarine.

---

### Carrier

**Role:** Floating airbase that extends Fighter range across the ocean.

- Carries up to 8 Fighters.
- Fighters that land on or fly over a Carrier are automatically refueled.
- When a Carrier moves into a tile where a friendly Fighter is waiting, that Fighter moves with the Carrier and is refueled.
- **Half-strength combat:** uses ceil(strength ÷ 2) dice rather than its full attack and defense values.
- **Carrier bonus:** gains +1 attack die and +1 defense die for every 2 Fighters currently aboard.
- **If the Carrier is sunk, all Fighters aboard are lost.****

---

### Battleship

**Role:** The most powerful naval unit, capable of bombarding land and sea targets at range.

- 18 strength, 3 moves.

- **Half-strength combat** in direct engagements: uses ceil(18 ÷ 2) = 9 dice at full health.

- Two attack modes:
  
  **Direct combat:** Move into the target's tile. Fights at half-strength.
  
  **Bombardment:** Targets a tile exactly 2 tiles away in any direction (including diagonals). The target cannot counterattack. Hit chance is 20% per roll. Costs 1 move point. The Battleship stays in place.

- Bombardment is useful for softening up defended cities or enemy fleets before a direct assault.

---

## Combat System

### Basic Combat

Combat begins when you move a unit into a tile occupied by an enemy unit.

- Both sides roll dice simultaneously.
- Each die has a **50% chance to hit**.
- Each hit deals damage equal to the attacker's damage value (usually 1 per hit).
- Combat continues until one side is destroyed (reduced to 0 strength).
- There is no retreat once combat starts.

### Strength Scaling

A unit's dice count scales with its current health. A unit at half strength rolls roughly half as many dice. This means it is often worth weakening an enemy unit before attacking it with another — a damaged unit fights back much less effectively.

### Special Combat Rules

| Situation                              | Effect                                                            |
| -------------------------------------- | ----------------------------------------------------------------- |
| Naval unit attacks a land unit         | Hit chance reduced to 33% (instead of normal 50%)                 |
| Submarine attacks a non-Destroyer      | Defender gets 0 defense dice — no counterattack possible          |
| Carrier or Battleship in direct combat | Uses ceil(strength ÷ 2) dice (half-strength mode)                 |
| Carrier has fighters aboard            | +1 die to both attack and defense per 2 fighters currently aboard |
| Attacking an unoccupied enemy city     | City fights back with 1 die at 50% hit chance                     |

### Bombers in Combat

Bombers have 0 defense dice. If a Bomber is attacked, it will deal its attack damage normally but cannot roll any defense. In practice this means a Bomber that is caught by an enemy unit is almost guaranteed to be destroyed. Never move a Bomber into a tile where it can be intercepted.

### Bombardment

A Battleship can bombard any visible tile at exactly Chebyshev distance 2 — that is, any tile within a 5×5 area centered on the Battleship, but not the inner 3×3. This includes diagonals.

- The Battleship does not move into the target tile.
- The target cannot counterattack.
- Each roll has a 20% hit chance (weaker than direct combat, but risk-free).
- Costs 1 move point per bombardment.

Use bombardment to chip away at high-strength targets before committing to a direct assault.

### Cargo and Sinking

When a Transport or Carrier is destroyed, **every unit aboard is lost immediately**. This makes loaded Transports one of the highest-priority escort and protection tasks in the game. A single lucky Submarine or Destroyer attack can wipe out an entire invasion force.

---

## Air Unit Rules

- Fighters and Bombers **must end every turn on a friendly city or Carrier** (Fighters only for Carriers).
- An aircraft that runs out of fuel crashes and is permanently destroyed.
- Carriers refuel Fighters automatically when they land or fly over.
- When a Carrier moves into a tile where a friendly Fighter is sitting, the Fighter moves with the Carrier and is refueled.
- Bombers cannot land on Carriers — they need a city.
- Plan flight paths carefully. A Fighter stranded far from any friendly city or Carrier will not survive the turn.

---

## Stacking

- **Land units** can share tiles freely.
- **Air units** can stack with anything.
- **Naval units** cannot stack at open sea — they may only share a tile when in a city port.
- When multiple units occupy a tile, a **small number badge** appears in the top-right corner of the tile's sprite showing the stack count.
- Cargo loaded aboard a Transport or Carrier is shown as a **blue badge** in the top-left corner.

---

## Unit Commands

| Key | Command | Description                                                 |
| --- | ------- | ----------------------------------------------------------- |
| W   | Wait    | Skip this unit's turn                                       |
| S   | Sentry  | Hold position indefinitely until an enemy is spotted nearby |
| P   | Patrol  | Set a repeating waypoint path between two tiles             |
| G   | Goto    | Move automatically toward a destination tile                |
| U   | Unload  | Disembark cargo from a Transport or Carrier                 |
| B   | Bombard | Enter bombardment mode (Battleship only)                    |
| K   | Skip    | Skip this unit for the remainder of the current turn        |
| N   | Next    | Advance to the next unit that needs orders                  |

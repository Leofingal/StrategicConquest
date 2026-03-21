# Strategic Conquest — Enhanced Edition
## As reimagined by Chris Lee

This strategy war game is based on the original Strategic Conquest by Peter Merrill for the Macintosh in 1984. It was updated several times after that. This Enhanced Edition is based on the original version with some improvements in AI play, graphics, and several quality of life features. The combat engine is probably not the same as the original, as it was done from memory of how the original game felt in balance. The AI is much stronger in this version, and plays entirely by the same rules as the player (unlike the original, which had production rate tweaks at higher difficulties).

This was a development effort by Chris Lee, as a "Vibe Coding" experiment. It was developed using a combination of the web version of Claude, and by the end in Claude Code. ALL of the code was written by Claude. All debugging was done by describing the problems to Claude, and having Claude find and fix the bug(s). For more on the Vibe Coding adventure, see **The Limit Case** website at https://the-limit-case.vercel.app/

---

# Starting Conditions Guide

The New Game screen lets you configure the map and difficulty before play begins. These choices shape the entire game — from how long it lasts to what kind of strategy will win.

---

## Map Size

Larger maps have more territory, more cities, and longer travel times between fronts. Expect bigger maps to run significantly longer.

| Size | Dimensions | Total Cities |
|------|-----------|-------------|
| Small | 48 × 32 | 20 |
| Medium | 96 × 64 | 40 |
| Large | 124 × 96 | 60 |

Cities are the source of all unit production, so more cities means more units in play and larger-scale battles by mid-game.

---

## Terrain

Terrain controls the ratio of land to water and the shape of the landmasses. It has a major effect on how naval and land strategies balance out.

| Setting | Water % | What to Expect |
|---------|---------|----------------|
| Wet | 85% | Archipelago of small scattered islands — naval power dominates; landing troops is essential |
| Normal | 80% | Mixed islands of varying sizes — balanced land and sea play |
| Dry | 70% | Large continental landmasses — land armies carry more weight, but the sea is still significant |

On wet maps, Transports and Destroyers are essential early. On dry maps, Tanks and city-to-city land campaigns carry more weight.

---

## Difficulty

Difficulty controls the **number of cities placed on each home island** at the start of the game. It does not change how the AI thinks — both players use the same unit rules and combat odds at every difficulty level.

**Important:** Each side begins the game owning only **1 city** on their home island. The remaining cities on your island start neutral and must be captured before you can use them. The difficulty setting determines how many of those neutral cities are within easy reach on your starting island, giving you a faster or slower economic ramp.

More cities on your home island means you can secure production quickly; fewer means a slower start and a tighter early game.

| Level | Your Island Cities | AI Island Cities |
|-------|-------------------|-----------------|
| 1 — Easiest | 7 | 3 |
| 2 | 6 | 3 |
| 3 | 6 | 4 |
| 4 | 5 | 4 |
| **5 — Normal** | **5** | **5** |
| 6 | 4 | 5 |
| 7 | 4 | 6 |
| 8 | 3 | 6 |
| 9 | 3 | 7 |
| 10 — Hardest | 2 | 7 |

Level 5 is an even start. Below 5 you have the advantage; above 5 the AI's home island has more cities to expand into. New players should start at Level 3 or 4.

---

## How It Fits Together

City count drives everything: more cities means more simultaneous production queues, which means more units reaching the front sooner. Terrain determines whether those units will be fighting across open land or island-hopping by sea. Map size sets the pace — a small dry map can end in a quick blitz while a large wet map becomes a long naval campaign. Pick settings that match how long you want to play and which unit types you enjoy using.

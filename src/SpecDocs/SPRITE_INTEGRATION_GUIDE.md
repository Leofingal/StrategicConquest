# Strategic Conquest Sprite Integration Guide

## Overview

The game supports two rendering modes:
- **Image sprites**: PNG files loaded from `/sprites/`
- **Emoji/letter fallback**: Used when `USE_IMAGE_SPRITES = false` or images fail to load

Rendering is controlled by `sprite-config.js`. Tiles use 64x48 pixels (4:3 aspect ratio).

---

## File Structure

```
public/sprites/             # Copy PNG files here
├── tank_player.png        # Unit sprites (64x48)
├── tank_ai.png
├── fighter_player.png
├── fighter_ai.png
├── bomber_player.png
├── bomber_ai.png
├── transport_player.png
├── transport_ai.png
├── destroyer_player.png
├── destroyer_ai.png
├── submarine_player.png
├── submarine_ai.png
├── carrier_player.png
├── carrier_ai.png
├── battleship_player.png
├── battleship_ai.png
├── water.png              # Terrain tiles
├── land.png
├── player_city.png
├── ai_city.png
└── neutral_city.png

src/
├── sprite-config.js       # Configuration and export
├── ui-components.jsx      # Imports sprite config
└── game-constants.js      # TILE_WIDTH=64, TILE_HEIGHT=48
```

---

## Quick Setup

### 1. Copy sprites
```bash
cp -r sprites/ your-project/public/sprites/
```

### 2. Enable image sprites
In `src/sprite-config.js`:
```javascript
export const USE_IMAGE_SPRITES = true;
```

### 3. Verify
Open browser dev tools Network tab. Sprites load from `/sprites/[unit]_[owner].png`.

---

## Architecture

### Dynamic Checkerboard Shading

No pre-baked dark/light tile variants. A single base tile is used with CSS:

```javascript
// In Tile component (ui-components.jsx)
const checkerFilter = (type === WATER || type === LAND) && (x + y) % 2 === 1
  ? 'brightness(1.15)'
  : 'none';
```

### Dynamic Fog of War

Fog is a CSS overlay div, not baked into tiles:

```javascript
// Unexplored:
{ backgroundColor: COLORS.fogUnexplored, opacity: 1 }   // '#0a1015'

// Explored but not visible:
{ backgroundColor: COLORS.fogExplored, opacity: 1 }      // 'rgba(10,16,21,0.6)'
```

### Autotile System (Optional)

`sprite-config.js` includes infrastructure for water/land transition tiles. Currently disabled by default.

Enable with:
```javascript
export const USE_AUTOTILES = true;
```

When enabled, `getWaterTileSrc(x, y, map)` calculates which adjacent tiles are land and returns the appropriate autotile variant. Water tile naming convention:

```
water.png        Open water (no adjacent land)
water_N.png      Beach on north edge
water_NE.png     Beach on north and east edges
water_ne.png     Corner beach in NE (diagonal land only)
water_N_se.png   North edge + SE corner
water_NESW.png   Beach on all four edges
```

If an autotile variant image fails to load (404), `markAutotileFailed()` is called and the tile falls back to the base `water.png`.

---

## Sprite Specifications

| Property | Value |
|----------|-------|
| Dimensions | 64x48 pixels |
| Aspect Ratio | 4:3 |
| Rendering | `image-rendering: pixelated` (nearest-neighbor) |
| Format | PNG with transparency |

### Suggested Color Coding

| Type | Background | Border |
|------|-----------|--------|
| Player units | Light gray (#f0f0f0) | Dark (#333) |
| AI units | Light red (#ffb4b4) | Red (#c00) |
| Water | Dark blue-green (#1a3a4a) | — |
| Land | Forest green (#4a7c59) | — |
| Player city | Gold with star | — |
| AI city | Red with star | — |
| Neutral city | White with star | — |

---

## Viewport Dimensions

With 64x48 tiles and 24x18 grid:
- Viewport width: 24 x 64 = 1536px
- Viewport height: 18 x 48 = 864px

Coordinates in the main game use `TILE_WIDTH` (64) for horizontal and `TILE_HEIGHT` (48) for vertical. The legacy `TILE_SIZE` alias equals `TILE_WIDTH` and should not be used for new code.

---

## `sprite-config.js` Exports

```javascript
export const USE_IMAGE_SPRITES: boolean;
export const USE_AUTOTILES: boolean;
export const SPRITE_BASE_PATH: string;      // '/sprites'
export const SPRITE_CONFIG: object;         // Per-unit type config
export const TILE_CONFIG: object;           // Per-tile type config
export function getUnitSpriteSrc(unitType, owner): string;
export function getTileImageSrc(tileType): string;
export function getTileColor(tileType, isLight): string;
export function getWaterTileSrc(x, y, map): string;  // Autotile lookup
export const failedAutotiles: Set<string>;  // Tracks failed image loads
export function markAutotileFailed(src): void;
```

---

## Fallback Behavior

If `USE_IMAGE_SPRITES = false` or an image fails to load, the `UnitSprite` component falls back to letter-based rendering using `spec.icon` (e.g. "T" for tank, "F" for fighter).

The `Tile` component falls back to color-based rendering using `COLORS` from `game-constants.js`.

---

## Troubleshooting

**Sprites look blurry:**
Ensure CSS includes `image-rendering: pixelated` on the image element.

**404 errors:**
Check that files are in `public/sprites/`, not `src/sprites/`. Vite serves `public/` as the root.

**Aspect ratio seems wrong:**
Confirm both `TILE_WIDTH` (64) and `TILE_HEIGHT` (48) are imported and used for x/y positioning respectively. Do not use the legacy `TILE_SIZE` for new positioning code.

**Checkerboard not showing:**
Verify the `filter: brightness(1.15)` CSS is being applied to odd tiles `((x+y) % 2 === 1)`.

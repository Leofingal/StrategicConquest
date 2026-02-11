# Strategic Conquest Sprite Integration Guide

## Overview

This guide explains how to integrate the new image-based sprites with:
- **64×48 pixel tiles** (4:3 aspect ratio)
- **Dynamic checkerboard shading** (CSS filter, not pre-baked)
- **Dynamic fog of war** (CSS overlay)
- **Autotile architecture** for future water/land transitions

## Files Provided

```
sprites/                    # Copy to public/sprites/
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
├── water.png              # Base terrain tiles
├── land.png
├── player_city.png
├── ai_city.png
└── neutral_city.png

game-constants.js          # Updated with TILE_WIDTH=64, TILE_HEIGHT=48
sprite-config.js           # NEW - sprite/autotile configuration
ui-components.jsx          # Updated with image sprite support
```

## Quick Setup

### 1. Copy Sprites
```bash
cp -r sprites/ your-project/public/sprites/
```

### 2. Replace/Add Source Files
```bash
cp game-constants.js your-project/src/
cp sprite-config.js your-project/src/      # NEW FILE
cp ui-components.jsx your-project/src/
```

### 3. Update Main Game File

The main game file (`strategic-conquest-game-integrated.jsx`) needs updates:

#### 3a. Update Imports (around line 10)

```javascript
// Change from:
import {
  TILE_SIZE, VIEWPORT_TILES_X, VIEWPORT_TILES_Y, ...
} from './game-constants.js';

// To:
import {
  TILE_SIZE, TILE_WIDTH, TILE_HEIGHT, VIEWPORT_TILES_X, VIEWPORT_TILES_Y, ...
} from './game-constants.js';
```

#### 3b. Find & Replace TILE_SIZE

Replace all instances of `TILE_SIZE` with the appropriate dimension:
- **X/horizontal positions**: Use `TILE_WIDTH`
- **Y/vertical positions**: Use `TILE_HEIGHT`

Key locations:

```javascript
// Viewport container size (~line 1540)
// From:
width: VIEWPORT_TILES_X * TILE_SIZE, height: VIEWPORT_TILES_Y * TILE_SIZE

// To:
width: VIEWPORT_TILES_X * TILE_WIDTH, height: VIEWPORT_TILES_Y * TILE_HEIGHT


// Tile positioning (~line 1560)
// From:
left: vx * TILE_SIZE, top: vy * TILE_SIZE

// To:
left: vx * TILE_WIDTH, top: vy * TILE_HEIGHT


// Unit positioning (~line 1565)
// From:
left: (u.x - viewportX) * TILE_SIZE, top: (u.y - viewportY) * TILE_SIZE

// To:
left: (u.x - viewportX) * TILE_WIDTH, top: (u.y - viewportY) * TILE_HEIGHT


// AI observation trails (~lines 1571-1598)
// Update all coordinate calculations similarly
```

## Architecture Notes

### Dynamic Shading (Not Pre-baked)

Previously: Tiles had `_dark.png` and `_light.png` variants for checkerboard.

Now: Single base tile + CSS `filter: brightness(1.15)` for light squares.

This reduces sprite count and simplifies future autotile transitions.

```javascript
// The Tile component now applies:
const checkerFilter = (type === WATER || type === LAND) && isLight 
  ? 'brightness(1.15)' 
  : 'none';

// And uses imageRendering: 'pixelated' for crisp pixel art
```

### Dynamic Fog of War

Fog is rendered as CSS overlay divs, not baked into tiles:

```javascript
// Unexplored
{ backgroundColor: '#0a1015', opacity: 1 }

// Explored but not visible  
{ backgroundColor: 'rgba(10, 16, 21, 0.6)', opacity: 1 }
```

### Autotile System (Future)

The `sprite-config.js` includes infrastructure for water/land transition tiles:

```javascript
// When transition tiles are designed, name them:
water.png       // Open water (no adjacent land)
water_N.png     // Beach on north edge (land to north)
water_NE.png    // Beach on north and east edges
water_NESW.png  // Beach on all edges (small pond)

// For corner beaches (diagonal land only):
water_ne.png    // Corner beach in NE

// Combined:
water_N_se.png  // North edge + SE corner
```

Enable with: `USE_AUTOTILES = true` in sprite-config.js

The system calculates edges automatically using `calculateWaterEdges(x, y, map)`.

## Sprite Specifications

| Property | Value |
|----------|-------|
| Dimensions | 64×48 pixels |
| Aspect Ratio | 4:3 |
| Scaling | Nearest-neighbor (pixel-perfect) |
| Format | PNG with transparency |

### Unit Sprites
- Player: Light gray background (#f0f0f0), dark border (#333)
- AI: Light red background (#ffb4b4), red border (#c00)

### Terrain Tiles
- Water: Dark blue-green (#1a3a4a)
- Land: Forest green (#4a7c59)
- Cities: Gold/Red/White with star markers

## Viewport Calculations

With 64×48 tiles and ~20×14 grid:
- Viewport width: 20 × 64 = 1280px
- Viewport height: 14 × 48 = 672px
- Total: ~860,160 pixels (fits well in 1920×1080 with UI panels)

## Fallback Mode

If images don't load:

```javascript
// In sprite-config.js:
export const USE_IMAGE_SPRITES = false;
```

This reverts to letter-based rendering.

## Troubleshooting

### Sprites look blurry
Ensure CSS includes:
```css
image-rendering: pixelated;
```

### Checkerboard not showing
Verify the `filter: brightness(1.15)` is being applied for odd tiles.

### 404 errors for sprites
Check browser dev tools Network tab. Sprites should load from `/sprites/`.

### Aspect ratio seems wrong
Confirm both TILE_WIDTH and TILE_HEIGHT are imported and used correctly (not just TILE_SIZE).

## Next Steps

1. **Design transition tiles** - Create `water_N.png`, `water_NE.png`, etc.
2. **Enable autotiles** - Set `USE_AUTOTILES = true` once tiles are ready
3. **Test thoroughly** - Verify pixel-perfect rendering at various zoom levels

## File Verification

```bash
ls -la public/sprites/
# Should show 21 PNG files (16 unit + 5 terrain)
# All should be ~1-3KB each
```

import React, { useState } from 'react';
import {
  WATER, LAND, PLAYER_CITY, AI_CITY, NEUTRAL_CITY,
  FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE,
  STATUS_LABELS, UNIT_SPECS, TILE_WIDTH, TILE_HEIGHT, TILE_SIZE, VIEWPORT_TILES_X, VIEWPORT_TILES_Y,
  COLORS
} from './game-constants.js';
import { SYMBOLS } from './ui-symbols.js';

// Import sprite configuration - uses image sprites by default
import { 
  SPRITE_CONFIG, 
  TILE_CONFIG, 
  getUnitSpriteSrc, 
  getTileImageSrc, 
  getTileColor,
  USE_IMAGE_SPRITES,
  USE_AUTOTILES,
  getWaterTileSrc,
  failedAutotiles,
  SPRITE_BASE_PATH,
  markAutotileFailed
} from './sprite-config.js';

// ============================================================================
// SPRITE AND TILE CONFIGURATION (Legacy - now imported from sprite-config.js)
// ============================================================================

/**
 * Default sprite configuration - can be overridden to use external images
 * Each unit type maps to either an emoji (default) or an image path
 */
export const DEFAULT_SPRITE_CONFIG = SPRITE_CONFIG;

/**
 * Default tile configuration - can be overridden to use external images
 * Each tile type maps to either a color (default) or an image path
 */
export const DEFAULT_TILE_CONFIG = TILE_CONFIG;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isCityTile(t) {
  return t === PLAYER_CITY || t === AI_CITY || t === NEUTRAL_CITY;
}

function getUnitLocation(unit, units) {
  if (!unit.aboardId) return { x: unit.x, y: unit.y };
  const carrier = units.find(u => u.id === unit.aboardId);
  return carrier ? { x: carrier.x, y: carrier.y } : { x: unit.x, y: unit.y };
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

/**
 * Render a single map tile with optional overlays
 * @param {Object} props
 * @param {number} props.type - Tile type (WATER, LAND, PLAYER_CITY, etc.)
 * @param {number} props.fogState - Fog of war state (FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE)
 * @param {number} props.x - Tile x coordinate
 * @param {number} props.y - Tile y coordinate
 * @param {boolean} [props.isValidMove] - Whether this is a valid move destination
 * @param {boolean} [props.isAttack] - Whether this is an attack move
 * @param {boolean} [props.isPath] - Whether this is part of a goto path
 * @param {boolean} [props.isPatrolWaypoint] - Whether this is a patrol waypoint
 * @param {Function} [props.onClick] - Click handler
 * @param {Function} [props.onDoubleClick] - Double-click handler
 * @param {Function} [props.onMouseDown] - Mouse down handler
 * @param {Function} [props.onMouseEnter] - Mouse enter handler
 * @param {Function} [props.onMouseUp] - Mouse up handler
 * @param {Object} [props.tileConfig] - Tile configuration object for custom rendering
 */
export function Tile({ 
  type, 
  fogState, 
  x, 
  y, 
  isValidMove, 
  isAttack, 
  isPath, 
  isPatrolWaypoint, 
  onClick, 
  onDoubleClick, 
  onMouseDown, 
  onMouseEnter, 
  onMouseUp,
  style,
  tileConfig = DEFAULT_TILE_CONFIG,
  map = null // Optional: pass map for autotile support
}) {
  const tile = tileConfig[type];
  const isCity = isCityTile(type);
  const isLight = (x + y) % 2 === 1; // Checkerboard pattern
  
  // Track if current autotile image failed (for re-render with fallback)
  const [imgError, setImgError] = useState(false);
  
  // Determine base color or image
  let base, tileSrc = null;
  // Dynamic checkerboard shading via CSS filter (not pre-baked tiles)
  const checkerFilter = (type === WATER || type === LAND) && isLight ? 'brightness(1.15)' : 'none';
  
  if (tile && tile.type === 'image') {
    base = COLORS.water; // Fallback color while image loads
    
    // For water tiles with autotile support
    if (type === WATER && USE_AUTOTILES && map && !imgError) {
      tileSrc = getWaterTileSrc(x, y, map);
    } else {
      tileSrc = tile.src;
    }
  } else if (tile) {
    // Color-based rendering with checkerboard pattern for water/land
    if (type === WATER || type === LAND) {
      base = isLight ? tile.valueLight : tile.value;
    } else {
      base = tile.value;
    }
  } else {
    base = '#ff00ff'; // Magenta for missing tile config
  }
  
  // Handle image load error - fallback to base water tile
  const handleImageError = (e) => {
    const failedSrc = e.target.src;
    markAutotileFailed(failedSrc);
    setImgError(true);
    // Set src to base water tile
    e.target.src = `${SPRITE_BASE_PATH}/water.png`;
  };
  
  return (
    <div 
      onClick={onClick} 
      onDoubleClick={onDoubleClick} 
      onMouseDown={onMouseDown} 
      onMouseEnter={onMouseEnter} 
      onMouseUp={onMouseUp}
      style={{ 
        width: TILE_WIDTH, 
        height: TILE_HEIGHT, 
        backgroundColor: base,
        filter: checkerFilter,
        position: 'relative', 
        cursor: 'pointer', 
        boxSizing: 'border-box', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        overflow: 'hidden',
        ...style
      }}
    >
      {/* Image-based tile rendering */}
      {tileSrc && (
        <img 
          src={tileSrc}
          alt=""
          onError={handleImageError}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            imageRendering: 'pixelated',
            pointerEvents: 'none'
          }}
        />
      )}
      
      {/* City icon - only needed for color-based rendering */}
      {isCity && !tileSrc && (
        <span style={{ 
          fontSize: 12, 
          color: type === PLAYER_CITY ? COLORS.textDark : type === AI_CITY ? '#fff' : '#333', 
          fontWeight: 'bold',
          zIndex: 1
        }}>
          {SYMBOLS.STAR_FILLED}
        </span>
      )}
      
      {/* Fog of war overlays */}
      {fogState === FOG_UNEXPLORED && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: COLORS.fogUnexplored }} />
      )}
      {fogState === FOG_EXPLORED && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: COLORS.fogExplored }} />
      )}
      
      {/* Valid move indicator */}
      {isValidMove && (
        <div style={{ 
          position: 'absolute', 
          inset: 3, 
          border: `2px solid ${isAttack ? COLORS.danger : COLORS.highlight}`, 
          borderRadius: 2, 
          opacity: 0.8 
        }} />
      )}
      
      {/* GoTo path indicator */}
      {isPath && (
        <div style={{ 
          position: 'absolute', 
          inset: 8, 
          backgroundColor: COLORS.gotoLine, 
          borderRadius: '50%' 
        }} />
      )}
      
      {/* Patrol waypoint indicator */}
      {isPatrolWaypoint && (
        <div style={{ 
          position: 'absolute', 
          inset: 3, 
          border: `3px solid ${COLORS.patrolLine}`, 
          borderRadius: 4 
        }} />
      )}
    </div>
  );
}

/**
 * Render a unit sprite with health and cargo indicators
 * @param {Object} props
 * @param {Object} props.unit - Unit object with type, owner, strength
 * @param {boolean} [props.isActive] - Whether this is the active unit
 * @param {boolean} [props.blink] - Whether to invert colors (blinking effect)
 * @param {Function} [props.onClick] - Click handler
 * @param {number} [props.cargoCount] - Number of units aboard (for carriers/transports)
 * @param {number} [props.stackCount] - Number of friendly units stacked on this tile (shown top-right)
 * @param {boolean} [props.isAboard] - Whether this unit is aboard another unit
 * @param {Object} [props.spriteConfig] - Sprite configuration object for custom rendering
 */
export function UnitSprite({
  unit,
  isActive,
  blink,
  onClick,
  cargoCount,
  stackCount,
  isAboard,
  spriteConfig = DEFAULT_SPRITE_CONFIG
}) {
  const spec = UNIT_SPECS[unit.type];
  const sprite = spriteConfig[unit.type];
  const inv = isActive && blink;
  
  // For image sprites, get the correct source based on owner
  const spriteSrc = sprite && sprite.type === 'image' 
    ? (unit.owner === 'player' ? sprite.player : sprite.ai)
    : null;
  
  // For emoji-based rendering, use traditional colors
  const bg = unit.owner === 'player' ? '#f0f0f0' : '#ffcccc';
  const border = unit.owner === 'player' ? '#333' : '#c00';
  
  return (
    <div 
      onClick={onClick} 
      style={{ 
        width: TILE_WIDTH - 4, 
        height: TILE_HEIGHT - 4, 
        margin: 2, 
        backgroundColor: sprite && sprite.type === 'image' ? 'transparent' : (inv ? border : bg), 
        border: sprite && sprite.type === 'image' ? 'none' : `2px solid ${inv ? bg : border}`, 
        borderRadius: 3, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        fontSize: isAboard ? 10 : 14, 
        color: inv ? bg : border, 
        fontWeight: 'bold', 
        position: 'relative', 
        cursor: 'pointer',
        opacity: isAboard ? 0.7 : 1,
        overflow: 'hidden',
      }}
    >
      {/* Unit sprite - either image or emoji */}
      {sprite && sprite.type === 'image' ? (
        <img 
          src={spriteSrc} 
          alt={spec.name}
          style={{ 
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter: inv ? 'invert(1)' : 'none',
            opacity: isAboard ? 0.7 : 1,
          }}
        />
      ) : (
        sprite ? sprite.value : spec.icon
      )}
      
      {/* Health indicator (bottom-right) */}
      {unit.strength < spec.strength && (
        <div style={{ 
          position: 'absolute', 
          bottom: 1, 
          right: 2, 
          fontSize: 8, 
          color: COLORS.danger, 
          fontWeight: 'bold',
          textShadow: '0 0 2px #000',
          backgroundColor: 'rgba(0,0,0,0.5)',
          padding: '0 2px',
          borderRadius: 2,
        }}>
          {unit.strength}
        </div>
      )}
      
      {/* Cargo count (top-left, blue) */}
      {cargoCount > 0 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 2,
          fontSize: 8,
          color: '#fff',
          fontWeight: 'bold',
          textShadow: '0 0 2px #000',
          backgroundColor: 'rgba(0,0,128,0.7)',
          padding: '0 2px',
          borderRadius: 2,
        }}>
          {cargoCount}
        </div>
      )}

      {/* Stack count (top-right, amber) — only shown when >1 unit on tile */}
      {stackCount > 1 && (
        <div style={{
          position: 'absolute',
          top: 0,
          right: 2,
          fontSize: 8,
          color: '#fff',
          fontWeight: 'bold',
          textShadow: '0 0 2px #000',
          backgroundColor: 'rgba(180,100,0,0.85)',
          padding: '0 2px',
          borderRadius: 2,
        }}>
          {stackCount}
        </div>
      )}
    </div>
  );
}

/**
 * Display turn information and end turn button
 * @param {Object} props
 * @param {number} props.turn - Current turn number
 * @param {string} props.phase - Game phase
 * @param {number} props.unitsWaiting - Number of units awaiting orders
 * @param {number} props.playerCities - Player city count
 * @param {number} props.aiCities - AI city count
 * @param {number} props.neutralCities - Neutral city count
 * @param {Function} props.onEndTurn - End turn handler
 * @param {Function} props.onShowCityList - Show city list handler
 */
export function TurnInfo({ 
  turn, 
  phase, 
  unitsWaiting, 
  playerCities, 
  aiCities, 
  neutralCities, 
  onEndTurn, 
  onShowCityList,
  onShowAllUnits,
  onShowAiSummary,
  onSaveGame,
  hasAiObservations
}) {
  return (
    <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '10px' }}>
      {/* BUG #8: Add game title */}
      <div style={{ 
        fontSize: 11, 
        fontWeight: 600, 
        letterSpacing: 1, 
        color: COLORS.highlight, 
        marginBottom: 8,
        textAlign: 'center',
        borderBottom: `1px solid ${COLORS.border}`,
        paddingBottom: 8
      }}>
        STRATEGIC CONQUEST
      </div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: COLORS.textMuted, marginBottom: 6 }}>
        Status
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        Turn {turn}
      </div>
      <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 4 }}>
        Cities: <span style={{ color: COLORS.playerCity }}>{playerCities}</span> / <span style={{ color: COLORS.aiCity }}>{aiCities}</span> / <span style={{ color: COLORS.neutralCity }}>{neutralCities}</span>
      </div>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 8 }}>
        Awaiting orders: {unitsWaiting}
      </div>
      <button 
        onClick={onShowCityList} 
        style={{ 
          width: '100%', 
          padding: '6px', 
          marginBottom: 6, 
          backgroundColor: COLORS.border, 
          border: 'none', 
          color: COLORS.text, 
          fontSize: 10, 
          textTransform: 'uppercase', 
          letterSpacing: 1, 
          cursor: 'pointer', 
          fontFamily: 'inherit' 
        }}
      >
        City List [C]
      </button>
      <button 
        onClick={onShowAllUnits} 
        style={{ 
          width: '100%', 
          padding: '6px', 
          marginBottom: 6, 
          backgroundColor: COLORS.border, 
          border: 'none', 
          color: COLORS.text, 
          fontSize: 10, 
          textTransform: 'uppercase', 
          letterSpacing: 1, 
          cursor: 'pointer', 
          fontFamily: 'inherit' 
        }}
      >
        All Units [V]
      </button>
      {/* BUG #8: AI Turn summary button */}
      <button 
        onClick={onShowAiSummary} 
        disabled={!hasAiObservations}
        style={{ 
          width: '100%', 
          padding: '6px', 
          marginBottom: 6, 
          backgroundColor: hasAiObservations ? 'rgba(200, 80, 80, 0.3)' : COLORS.border, 
          border: hasAiObservations ? '1px solid rgba(200, 80, 80, 0.5)' : 'none', 
          color: hasAiObservations ? COLORS.danger : COLORS.textMuted, 
          fontSize: 10, 
          textTransform: 'uppercase', 
          letterSpacing: 1, 
          cursor: hasAiObservations ? 'pointer' : 'default', 
          fontFamily: 'inherit',
          opacity: hasAiObservations ? 1 : 0.5
        }}
      >
        AI Turn [A]
      </button>
      {/* Save Game button */}
      <button 
        onClick={onSaveGame} 
        style={{ 
          width: '100%', 
          padding: '6px', 
          marginBottom: 6, 
          backgroundColor: COLORS.border, 
          border: 'none', 
          color: COLORS.text, 
          fontSize: 10, 
          textTransform: 'uppercase', 
          letterSpacing: 1, 
          cursor: 'pointer', 
          fontFamily: 'inherit' 
        }}
      >
        Save Game
      </button>
      <button 
        onClick={onEndTurn} 
        style={{ 
          width: '100%', 
          padding: '8px', 
          backgroundColor: COLORS.highlight, 
          border: 'none', 
          color: COLORS.textDark, 
          fontSize: 11, 
          fontWeight: 600, 
          textTransform: 'uppercase', 
          letterSpacing: 1, 
          cursor: 'pointer', 
          fontFamily: 'inherit' 
        }}
      >
        End Turn
      </button>
    </div>
  );
}

/**
 * Display active unit information
 * @param {Object} props
 * @param {Object|null} props.unit - Active unit object
 * @param {Array} props.units - All units (needed for cargo count)
 * @param {Object} props.gameState - Game state (for location lookup)
 */
export function UnitInfoPanel({ unit, units, gameState }) {
  if (!unit) {
    return (
      <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '10px' }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: COLORS.textMuted, marginBottom: 6 }}>
          Active Unit
        </div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic' }}>
          No unit selected
        </div>
      </div>
    );
  }
  
  const spec = UNIT_SPECS[unit.type];
  const st = STATUS_LABELS[unit.status] || { label: unit.status, color: COLORS.text };
  const pos = getUnitLocation(unit, units);
  const cargo = units.filter(u => u.aboardId === unit.id).length;
  
  // Get the unit sprite for display
  const sprite = SPRITE_CONFIG[unit.type];
  const spriteSrc = sprite && sprite.type === 'image' 
    ? (unit.owner === 'player' ? sprite.player : sprite.ai)
    : null;
  
  return (
    <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '10px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: COLORS.textMuted, marginBottom: 6 }}>
        Active Unit
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {/* Show unit sprite in info panel */}
        {spriteSrc ? (
          <img src={spriteSrc} alt={spec.name} style={{ width: 32, height: 24, objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: 18, fontWeight: 'bold' }}>{spec.icon}</span>
        )}
        <span style={{ fontSize: 14, fontWeight: 600 }}>{spec.name}</span>
      </div>
      <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div>Position: ({pos.x}, {pos.y})</div>
        <div>
          Strength: <span style={{ color: unit.strength < spec.strength ? COLORS.danger : COLORS.text }}>
            {unit.strength}/{spec.strength}
          </span>
        </div>
        <div>
          Moves: <span style={{ color: unit.movesLeft === 0 ? COLORS.textMuted : COLORS.text }}>
            {unit.movesLeft}/{spec.movement}
          </span>
        </div>
        {spec.fuel && (
          <div>
            Fuel: <span style={{ color: unit.fuel < 5 ? COLORS.danger : COLORS.text }}>
              {unit.fuel}/{spec.fuel}
            </span>
          </div>
        )}
        {spec.capacity && <div>Cargo: {cargo}/{spec.capacity}</div>}
        <div>
          Status: <span style={{ color: st.color }}>{st.label}</span>
        </div>
        {unit.gotoPath && (
          <div style={{ color: COLORS.success }}>GoTo: {unit.gotoPath.length} steps</div>
        )}
        {unit.patrolPath && (
          <div style={{ color: COLORS.patrolLine }}>Patrol: {unit.patrolPath.length} waypoints</div>
        )}
        {unit.aboardId && (
          <div style={{ color: '#9f6aca' }}>Aboard transport</div>
        )}
      </div>
    </div>
  );
}

/**
 * Display unit command menu
 * @param {Object} props
 * @param {Object|null} props.activeUnit - Active unit object
 * @param {Function} props.onCommand - Command handler
 * @param {boolean} [props.disabled] - Whether commands are disabled
 * @param {boolean} [props.patrolMode] - Whether patrol mode is active
 */
export function CommandMenu({ activeUnit, onCommand, disabled, patrolMode, bombardMode }) {
  const cmds = [
    { key: 'W', label: 'Wait', cmd: 'wait', hint: 'End of queue' },
    { key: 'K', label: 'Skip', cmd: 'skip', hint: 'Next turn' },
    { key: 'N', label: 'Next', cmd: 'next', hint: 'Next unit' },
    { key: 'S', label: 'Sentry', cmd: 'sentry' },
    { key: 'G', label: 'Go To', cmd: 'goto' },
    { key: 'P', label: 'Patrol', cmd: 'patrol', highlight: patrolMode },
    { key: 'B', label: 'Bombard', cmd: 'bombard', hint: 'Range 2', highlight: bombardMode, showIf: (u) => u && UNIT_SPECS[u.type].canBombard },
    { key: 'U', label: 'Unload', cmd: 'unload', showIf: (u) => u && (UNIT_SPECS[u.type].capacity || u.aboardId) },
  ];
  
  return (
    <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '10px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: COLORS.textMuted, marginBottom: 8 }}>
        Commands
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {cmds.filter(c => !c.showIf || c.showIf(activeUnit)).map(c => (
          <button 
            key={c.cmd} 
            onClick={() => onCommand(c.cmd)} 
            disabled={disabled && c.cmd !== 'next'} 
            style={{ 
              padding: '6px 8px', 
              backgroundColor: c.highlight ? COLORS.patrolLine : (disabled && c.cmd !== 'next') ? COLORS.panelLight : COLORS.border, 
              border: 'none', 
              color: (disabled && c.cmd !== 'next') ? COLORS.textMuted : COLORS.text, 
              fontSize: 10, 
              textAlign: 'left', 
              cursor: (disabled && c.cmd !== 'next') ? 'not-allowed' : 'pointer', 
              fontFamily: 'inherit', 
              display: 'flex', 
              justifyContent: 'space-between' 
            }}
          >
            <span>
              {c.label} {c.hint && <span style={{ color: COLORS.textMuted, fontSize: 9 }}>({c.hint})</span>}
            </span>
            <span style={{ color: COLORS.textMuted }}>[{c.key}]</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Display mini-map with viewport indicator
 * @param {Object} props
 * @param {Array} props.map - 2D map array
 * @param {Array} props.fog - 2D fog array
 * @param {Array} props.units - All units
 * @param {number} props.width - Map width
 * @param {number} props.height - Map height
 * @param {number} props.viewportX - Viewport X position
 * @param {number} props.viewportY - Viewport Y position
 * @param {Function} props.onNavigate - Navigation handler (x, y)
 */
export function MiniMap({ map, fog, units, width, height, viewportX, viewportY, onNavigate, exploredPercent }) {
  const scale = Math.min(160 / width, 100 / height);
  
  return (
    <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: COLORS.textMuted }}>
          Map
        </div>
        {/* BUG #2 FIX: Display explored percentage in MiniMap header */}
        <div style={{ fontSize: 9, color: COLORS.highlight }}>
          ({exploredPercent}% explored)
        </div>
      </div>
      <div 
        onClick={(e) => { 
          const r = e.currentTarget.getBoundingClientRect(); 
          onNavigate(
            Math.floor((e.clientX - r.left) / scale) - Math.floor(VIEWPORT_TILES_X / 2), 
            Math.floor((e.clientY - r.top) / scale) - Math.floor(VIEWPORT_TILES_Y / 2)
          ); 
        }}
        style={{ 
          width: width * scale, 
          height: height * scale, 
          position: 'relative', 
          cursor: 'pointer', 
          backgroundColor: COLORS.water 
        }}
      >
        {/* Render tiles */}
        {map.map((row, y) => row.map((t, x) => {
          if (fog[y][x] === FOG_UNEXPLORED) return null;
          const c = t === WATER ? null : 
                    t === PLAYER_CITY ? COLORS.playerCity : 
                    t === AI_CITY ? COLORS.aiCity : 
                    t === NEUTRAL_CITY ? COLORS.neutralCity : 
                    COLORS.land;
          return c && (
            <div 
              key={`${x}-${y}`} 
              style={{ 
                position: 'absolute', 
                left: x * scale, 
                top: y * scale, 
                width: Math.max(1, scale), 
                height: Math.max(1, scale), 
                backgroundColor: c 
              }} 
            />
          );
        }))}
        
        {/* Render units */}
        {units.filter(u => !u.aboardId && (u.owner === 'player' || fog[u.y][u.x] === FOG_VISIBLE)).map(u => (
          <div 
            key={u.id} 
            style={{ 
              position: 'absolute', 
              left: u.x * scale, 
              top: u.y * scale, 
              width: Math.max(2, scale * 2), 
              height: Math.max(2, scale * 2), 
              backgroundColor: u.owner === 'player' ? '#fff' : '#f00', 
              borderRadius: '50%' 
            }} 
          />
        ))}
        
        {/* Viewport indicator */}
        <div 
          style={{ 
            position: 'absolute', 
            left: viewportX * scale, 
            top: viewportY * scale, 
            width: VIEWPORT_TILES_X * scale, 
            height: VIEWPORT_TILES_Y * scale, 
            border: '1px solid #fff', 
            boxSizing: 'border-box', 
            pointerEvents: 'none' 
          }} 
        />
      </div>
    </div>
  );
}

/**
 * Display SVG line showing GoTo path
 * @param {Object} props
 * @param {number} props.sx - Start X (map coordinates)
 * @param {number} props.sy - Start Y (map coordinates)
 * @param {number} props.ex - End X (map coordinates)
 * @param {number} props.ey - End Y (map coordinates)
 * @param {number} props.vx - Viewport X offset
 * @param {number} props.vy - Viewport Y offset
 * @param {number} props.dist - Distance in tiles
 * @param {number} props.turns - Number of turns required
 */
export function GotoLineOverlay({ sx, sy, ex, ey, vx, vy, dist, turns }) {
  const x1 = (sx - vx) * TILE_WIDTH + TILE_WIDTH / 2;
  const y1 = (sy - vy) * TILE_HEIGHT + TILE_HEIGHT / 2;
  const x2 = (ex - vx) * TILE_WIDTH + TILE_WIDTH / 2;
  const y2 = (ey - vy) * TILE_HEIGHT + TILE_HEIGHT / 2;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <line 
        x1={x1} 
        y1={y1} 
        x2={x2} 
        y2={y2} 
        stroke={COLORS.gotoLine} 
        strokeWidth="3" 
        strokeDasharray="6,4" 
      />
      <circle cx={x2} cy={y2} r="6" fill={COLORS.highlight} />
      <rect x={mx - 30} y={my - 12} width="60" height="24" rx="4" fill="rgba(0,0,0,0.8)" />
      <text 
        x={mx} 
        y={my + 5} 
        fill="#fff" 
        fontSize="11" 
        textAnchor="middle" 
        fontFamily="monospace"
      >
        {dist} ({turns}t)
      </text>
    </svg>
  );
}

/**
 * Display SVG showing patrol waypoints and route
 * @param {Object} props
 * @param {Array} props.waypoints - Array of {x, y} waypoint objects
 * @param {number} props.vx - Viewport X offset
 * @param {number} props.vy - Viewport Y offset
 */
export function PatrolOverlay({ waypoints, vx, vy }) {
  if (waypoints.length === 0) return null;
  
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {waypoints.map((wp, i) => {
        const x = (wp.x - vx) * TILE_WIDTH + TILE_WIDTH / 2;
        const y = (wp.y - vy) * TILE_HEIGHT + TILE_HEIGHT / 2;
        const next = waypoints[(i + 1) % waypoints.length];
        const nx = (next.x - vx) * TILE_WIDTH + TILE_WIDTH / 2;
        const ny = (next.y - vy) * TILE_HEIGHT + TILE_HEIGHT / 2;
        
        return (
          <g key={i}>
            {i < waypoints.length - 1 && (
              <line 
                x1={x} 
                y1={y} 
                x2={nx} 
                y2={ny} 
                stroke={COLORS.patrolLine} 
                strokeWidth="2" 
                strokeDasharray="4,4" 
              />
            )}
            <circle cx={x} cy={y} r="8" fill={COLORS.patrolLine} />
            <text 
              x={x} 
              y={y + 4} 
              fill="#fff" 
              fontSize="10" 
              textAnchor="middle" 
              fontWeight="bold"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

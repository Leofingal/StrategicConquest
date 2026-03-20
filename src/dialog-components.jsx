import React, { useState } from 'react';
import {
  WATER, PLAYER_CITY, AI_CITY, NEUTRAL_CITY,
  FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE,
  STATUS_LABELS, UNIT_SPECS, UNIT_ORDER, MAP_SIZES, ALL_DIRS,
  COLORS
} from './game-constants.js';
import { SYMBOLS } from './ui-symbols.js';

// Import sprite configuration for image-based icons
import { SPRITE_CONFIG, USE_IMAGE_SPRITES } from './sprite-config.js';

// ============================================================================
// MINI UNIT ICON COMPONENT
// ============================================================================

/**
 * Small unit icon for use in dialogs and lists
 * Renders sprite image at reduced size, falls back to text icon
 * 
 * @param {string} type - Unit type (tank, fighter, etc.)
 * @param {string} [owner='player'] - Unit owner for sprite variant
 * @param {number} [size='small'] - 'tiny' (16x12), 'small' (24x18), 'medium' (32x24)
 * @param {Object} [style] - Additional inline styles
 */
export function MiniUnitIcon({ type, owner = 'player', size = 'small', style = {} }) {
  const spec = UNIT_SPECS[type];
  const sprite = SPRITE_CONFIG?.[type];
  
  // Size presets (maintaining 4:3 aspect ratio)
  const sizes = {
    tiny: { width: 32, height: 24, fontSize: 14 },
    small: { width: 24, height: 18, fontSize: 12 },
    medium: { width: 32, height: 24, fontSize: 14 },
  };
  
  const { width, height, fontSize } = sizes[size] || sizes.small;
  
  // Use image sprite if available
  if (USE_IMAGE_SPRITES && sprite?.type === 'image') {
    const src = owner === 'player' ? sprite.player : sprite.ai;
    return (
      <img 
        src={src}
        alt={spec?.name || type}
        style={{
          width,
          height,
          objectFit: 'contain',
          imageRendering: 'pixelated',
          verticalAlign: 'middle',
          ...style
        }}
      />
    );
  }
  
  // Fallback to text icon
  return (
    <span style={{ 
      display: 'inline-block',
      width,
      textAlign: 'center',
      fontSize,
      fontWeight: 'bold',
      verticalAlign: 'middle',
      ...style
    }}>
      {spec?.icon || type[0].toUpperCase()}
    </span>
  );
}

/**
 * Inline unit icon with name - common pattern in dialogs
 */
export function UnitIconWithName({ type, owner = 'player', size = 'small', showName = true }) {
  const spec = UNIT_SPECS[type];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <MiniUnitIcon type={type} owner={owner} size={size} />
      {showName && <span>{spec?.name || type}</span>}
    </span>
  );
}

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

function isAdjacentToWater(x, y, map, W, H) {
  for (const [dx, dy] of ALL_DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H && map[ny][nx] === WATER) {
      return true;
    }
  }
  return false;
}

// Leaderboard functions (localStorage)
function getLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem('scLeaderboard') || '{}');
  } catch {
    return {};
  }
}

function saveToLeaderboard(mapSize, difficulty, turns) {
  try {
    const lb = getLeaderboard();
    const key = `${mapSize}-${difficulty}`;
    if (!lb[key]) lb[key] = [];
    lb[key].push({ turns, date: new Date().toLocaleDateString() });
    lb[key].sort((a, b) => a.turns - b.turns);
    lb[key] = lb[key].slice(0, 3);
    localStorage.setItem('scLeaderboard', JSON.stringify(lb));
  } catch {}
}

function getTopScores(mapSize, difficulty) {
  return getLeaderboard()[`${mapSize}-${difficulty}`] || [];
}

// ============================================================================
// MINIMAP COMPONENT FOR DIALOGS (7x7)
// ============================================================================

/**
 * 7x7 Minimap for dialogs - shows terrain around a location
 * BUG #2 FIX: Now supports fog of war visualization
 * @param {number[][]} fogArray - Optional fog state array (FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE)
 */
function MiniMapView({ centerX, centerY, map, width, height, fogArray }) {
  const MINI_SIZE = 7;
  const TILE_SIZE = 12;
  const startX = Math.max(0, centerX - 3);
  const startY = Math.max(0, centerY - 3);
  
  const tiles = [];
  for (let dy = 0; dy < MINI_SIZE; dy++) {
    for (let dx = 0; dx < MINI_SIZE; dx++) {
      const x = startX + dx;
      const y = startY + dy;
      if (x >= width || y >= height) continue;
      
      const tile = map[y][x];
      const isCenter = x === centerX && y === centerY;
      
      // Get fog state for this tile (default to VISIBLE if no fogArray provided)
      const fogState = fogArray?.[y]?.[x] ?? FOG_VISIBLE;
      
      // Determine base terrain color
      let color = COLORS.water;
      if (tile === WATER) color = COLORS.water;
      else if (tile === PLAYER_CITY) color = COLORS.playerCity;
      else if (tile === AI_CITY) color = COLORS.aiCity;
      else if (tile === NEUTRAL_CITY) color = COLORS.neutralCity;
      else color = COLORS.land;
      
      // Apply fog state visualization
      let finalColor = color;
      let fogOverlay = null;
      
      if (fogState === FOG_UNEXPLORED) {
        // Completely hidden - show as dark
        finalColor = COLORS.fogUnexplored;
      } else if (fogState === FOG_EXPLORED) {
        // Explored but not currently visible - show terrain with fog overlay
        fogOverlay = (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: COLORS.fogExplored,
            pointerEvents: 'none'
          }} />
        );
      }
      // FOG_VISIBLE - show full terrain color (no change needed)
      
      tiles.push(
        <div
          key={`${x}-${y}`}
          style={{
            position: 'absolute',
            left: dx * TILE_SIZE,
            top: dy * TILE_SIZE,
            width: TILE_SIZE,
            height: TILE_SIZE,
            backgroundColor: finalColor,
            border: isCenter ? '2px solid ' + COLORS.highlight : 'none',
            boxSizing: 'border-box'
          }}
        >
          {fogOverlay}
        </div>
      );
    }
  }
  
  return (
    <div style={{ 
      width: MINI_SIZE * TILE_SIZE, 
      height: MINI_SIZE * TILE_SIZE, 
      position: 'relative',
      border: `1px solid ${COLORS.border}`,
      backgroundColor: COLORS.water
    }}>
      {tiles}
    </div>
  );
}

// ============================================================================
// DIALOG COMPONENTS
// ============================================================================

/**
 * City production dialog - select unit to produce
 * NOW WITH 7x7 MINIMAP! (Bug #9 fix)
 * BUG #2 FIX: Now accepts fogArray for fog of war visualization
 */
export function CityProductionDialog({ 
  city, 
  cityKey, 
  map, 
  width, 
  height, 
  units,
  fogArray,
  onClose, 
  onSetProduction, 
  onMakeActive 
}) {
  const [selProd, setSelProd] = useState(city.producing || 'tank');
  const [selUnit, setSelUnit] = useState(null);
  const isCoastal = isAdjacentToWater(city.x, city.y, map, width, height);
  const cityUnits = units.filter(u => {
    const pos = getUnitLocation(u, units);
    return pos.x === city.x && pos.y === city.y && u.owner === 'player';
  });
  
  // BUG #1 FIX: Handle keyboard events - Enter confirms, Escape closes
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onSetProduction(cityKey, selProd);
      onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.border}`, 
        width: 500, 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.border, 
          padding: '8px 12px', 
          fontSize: 12, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase' 
        }}>
          City Production - ({city.x}, {city.y})
        </div>
        
        {/* 7x7 MINIMAP HEADER - BUG #9 FIX */}
        <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
          <MiniMapView centerX={city.x} centerY={city.y} map={map} width={width} height={height} fogArray={fogArray} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              Position: ({city.x}, {city.y})
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>
              Type: {isCoastal ? 'Coastal' : 'Landlocked'}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
              Producing: {city.producing ? (
                <UnitIconWithName type={city.producing} size="tiny" />
              ) : 'None'}
            </div>
          </div>
        </div>
        
        <div style={{ 
          padding: 12, 
          borderBottom: `1px solid ${COLORS.border}`, 
          maxHeight: 200, 
          overflowY: 'auto' 
        }}>
          <div style={{ 
            fontSize: 10, 
            textTransform: 'uppercase', 
            letterSpacing: 1, 
            color: COLORS.textMuted, 
            marginBottom: 8 
          }}>
            Unit Production
          </div>
          {UNIT_ORDER.map(ut => {
            const spec = UNIT_SPECS[ut];
            const disabled = !isCoastal && spec.isNaval;
            const selected = selProd === ut;
            const progress = city.progress[ut] || 0;
            const remaining = spec.productionDays - progress;
            return (
              <div 
                key={ut} 
                onClick={() => !disabled && setSelProd(ut)} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  padding: '6px', 
                  cursor: disabled ? 'not-allowed' : 'pointer', 
                  backgroundColor: selected ? COLORS.selected : 'transparent', 
                  opacity: disabled ? 0.5 : 1, 
                  borderRadius: 4 
                }}
              >
                <input 
                  type="radio" 
                  checked={selected} 
                  onChange={() => {}} 
                  disabled={disabled} 
                  style={{ margin: 0 }} 
                />
                <MiniUnitIcon type={ut} size="small" />
                <span style={{ flex: 1, color: selected ? COLORS.highlight : COLORS.text }}>
                  {spec.name}
                </span>
                <span style={{ width: 50, textAlign: 'center', fontFamily: 'monospace' }}>
                  {remaining}d
                </span>
                <span style={{ width: 30, textAlign: 'center' }}>{spec.strength}</span>
                <span style={{ width: 30, textAlign: 'center' }}>{spec.movement}</span>
              </div>
            );
          })}
        </div>
        
        <div style={{ padding: 12 }}>
          <div style={{ 
            fontSize: 10, 
            textTransform: 'uppercase', 
            letterSpacing: 1, 
            color: COLORS.textMuted, 
            marginBottom: 8, 
            display: 'flex', 
            justifyContent: 'space-between' 
          }}>
            <span>Units Here ({cityUnits.length})</span>
            <button 
              onClick={() => { 
                if (selUnit) { 
                  onMakeActive(selUnit); 
                  onClose(); 
                } 
              }} 
              disabled={!selUnit} 
              style={{ 
                padding: '4px 12px', 
                fontSize: 10, 
                backgroundColor: selUnit ? COLORS.border : COLORS.panelLight, 
                border: 'none', 
                color: selUnit ? COLORS.text : COLORS.textMuted, 
                cursor: selUnit ? 'pointer' : 'not-allowed' 
              }}
            >
              Activate
            </button>
          </div>
          <div style={{ 
            maxHeight: 100, 
            overflowY: 'auto', 
            border: `1px solid ${COLORS.border}` 
          }}>
            {cityUnits.length === 0 ? (
              <div style={{ padding: 8, color: COLORS.textMuted, fontSize: 11 }}>No units</div>
            ) : cityUnits.map(u => {
              const sp = UNIT_SPECS[u.type];
              const sel = selUnit === u.id;
              const st = STATUS_LABELS[u.status];
              return (
                <div 
                  key={u.id} 
                  onClick={() => setSelUnit(u.id)} 
                  style={{ 
                    display: 'flex', 
                    gap: 8, 
                    padding: '6px 8px', 
                    fontSize: 11, 
                    cursor: 'pointer', 
                    backgroundColor: sel ? COLORS.selected : 'transparent', 
                    borderBottom: `1px solid ${COLORS.border}`,
                    alignItems: 'center'
                  }}
                >
                  <UnitIconWithName type={u.type} size="tiny" />
                  {u.aboardId && (
                    <span style={{ color: '#9f6aca', fontSize: 9 }}>(aboard)</span>
                  )}
                  <span style={{ marginLeft: 'auto', color: st.color }}>{st.label}</span>
                  <span style={{ fontFamily: 'monospace' }}>{u.strength}/{sp.strength}</span>
                </div>
              );
            })}
          </div>
        </div>
        
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 8 
        }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer' 
            }}
          >
            Cancel
          </button>
          <button 
            onClick={() => { 
              onSetProduction(cityKey, selProd); 
              onClose(); 
            }} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: COLORS.highlight, 
              border: 'none', 
              color: COLORS.textDark, 
              cursor: 'pointer', 
              fontWeight: 600 
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Unit view dialog - show all units at a location
 * NOW WITH 7x7 MINIMAP! (Bug #8 fix)
 * BUG #2 FIX: Now accepts fogArray for fog of war visualization
 */
export function UnitViewDialog({ 
  x, 
  y, 
  map, 
  width, 
  height, 
  units,
  fogArray,
  onClose, 
  onMakeActive 
}) {
  const [selUnit, setSelUnit] = useState(null);
  const tile = map[y][x];
  const terrain = tile === WATER ? 'Sea' : isCityTile(tile) ? 'City' : 'Land';
  
  // Get all units at location, including those aboard carriers/transports here
  const locationUnits = units.filter(u => {
    const pos = getUnitLocation(u, units);
    return pos.x === x && pos.y === y;
  });
  
  // BUG #1 FIX: Handle keyboard events - Enter activates selected, Escape closes
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (selUnit) {
        onMakeActive(selUnit);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.border}`, 
        width: 400, 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.border, 
          padding: '8px 12px', 
          fontSize: 12, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase' 
        }}>
          Units at ({x}, {y})
        </div>
        
        {/* 7x7 MINIMAP HEADER - BUG #8 FIX */}
        <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
          <MiniMapView centerX={x} centerY={y} map={map} width={width} height={height} fogArray={fogArray} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              Position: ({x}, {y})
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>
              Terrain: {terrain}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>
              Units: {locationUnits.length}
            </div>
          </div>
        </div>
        
        <div style={{ padding: 12 }}>
          <div style={{ 
            fontSize: 10, 
            textTransform: 'uppercase', 
            letterSpacing: 1, 
            color: COLORS.textMuted, 
            marginBottom: 8, 
            display: 'flex', 
            justifyContent: 'space-between' 
          }}>
            <span>Units</span>
            <button 
              onClick={() => { 
                if (selUnit) { 
                  onMakeActive(selUnit); 
                  onClose(); 
                } 
              }} 
              disabled={!selUnit} 
              style={{ 
                padding: '4px 12px', 
                fontSize: 10, 
                backgroundColor: selUnit ? COLORS.border : COLORS.panelLight, 
                border: 'none', 
                color: selUnit ? COLORS.text : COLORS.textMuted, 
                cursor: selUnit ? 'pointer' : 'not-allowed' 
              }}
            >
              Activate
            </button>
          </div>
          <div style={{ 
            maxHeight: 200, 
            overflowY: 'auto', 
            border: `1px solid ${COLORS.border}` 
          }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '90px 60px 50px 50px', 
              gap: 8, 
              padding: '6px 8px', 
              fontSize: 9, 
              color: COLORS.textMuted, 
              fontWeight: 600, 
              borderBottom: `1px solid ${COLORS.border}`, 
              backgroundColor: COLORS.panel, 
              position: 'sticky', 
              top: 0 
            }}>
              <div>UNIT</div>
              <div>STATUS</div>
              <div>STR</div>
              <div>MV</div>
            </div>
            {locationUnits.map(u => {
              const sp = UNIT_SPECS[u.type];
              const sel = selUnit === u.id;
              const canSel = u.owner === 'player';
              const st = STATUS_LABELS[u.status] || { label: u.status, color: COLORS.text };
              return (
                <div 
                  key={u.id} 
                  onClick={() => canSel && setSelUnit(u.id)} 
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '90px 60px 50px 50px', 
                    gap: 8, 
                    padding: '6px 8px', 
                    fontSize: 11, 
                    cursor: canSel ? 'pointer' : 'default', 
                    backgroundColor: sel ? COLORS.selected : 'transparent', 
                    borderBottom: `1px solid ${COLORS.border}`, 
                    opacity: canSel ? 1 : 0.6,
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MiniUnitIcon type={u.type} owner={u.owner} size="tiny" />
                    {sp.name}
                    {u.aboardId && (
                      <span style={{ fontSize: 8, color: '#9f6aca' }}>(a)</span>
                    )}
                    {u.owner !== 'player' && (
                      <span style={{ fontSize: 8, color: COLORS.danger }}>!</span>
                    )}
                  </div>
                  <div style={{ color: st.color }}>{st.label}</div>
                  <div style={{ fontFamily: 'monospace' }}>
                    {u.strength}/{sp.strength}
                  </div>
                  <div style={{ fontFamily: 'monospace' }}>
                    {u.movesLeft}/{sp.movement}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end' 
        }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer' 
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * NEW: All Units List Dialog - show all player units with filtering and selection
 * BUG #13 FIX
 * BUG #2 FIX: Now accepts fogArray for fog of war visualization
 * BUG #1 FIX: Now captures Enter key to activate selected unit
 * BUG #11 FIX: "Make Active Unit" button moved outside scrollable area
 */
export function AllUnitsListDialog({ 
  units, 
  map,
  width,
  height,
  fogArray,
  onClose, 
  onSelectUnit,
  onMakeActive
}) {
  const [selUnit, setSelUnit] = useState(null);
  const [hoveredUnit, setHoveredUnit] = useState(null);
  
  const playerUnits = units.filter(u => u.owner === 'player');
  const selectedUnitData = selUnit ? playerUnits.find(u => u.id === selUnit) : null;
  
  // BUG #1 FIX: Handle keyboard events - Enter activates selected, Escape closes
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (selUnit && selectedUnitData) {
        onMakeActive(selUnit);
        onSelectUnit(selectedUnitData);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.border}`, 
        width: 650, 
        maxHeight: '80vh', 
        display: 'flex', 
        flexDirection: 'column', 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.border, 
          padding: '8px 12px', 
          fontSize: 12, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase', 
          display: 'flex', 
          justifyContent: 'space-between' 
        }}>
          <span>All Units - Player ({playerUnits.length} total)</span>
          <button 
            onClick={onClose} 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: COLORS.textMuted, 
              fontSize: 14, 
              cursor: 'pointer' 
            }}
          >
            X
          </button>
        </div>
        
        {/* MINIMAP AND INFO PANEL - shows selected/hovered unit */}
        {selectedUnitData && (
          <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
            <MiniMapView centerX={getUnitLocation(selectedUnitData, units).x} centerY={getUnitLocation(selectedUnitData, units).y} map={map} width={width} height={height} fogArray={fogArray} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <MiniUnitIcon type={selectedUnitData.type} size="medium" />
                <span>{UNIT_SPECS[selectedUnitData.type].name}</span>
                {selectedUnitData.aboardId && (
                  <span style={{ fontSize: 9, color: '#9f6aca', marginLeft: 4 }}>(aboard)</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                Position: ({getUnitLocation(selectedUnitData, units).x}, {getUnitLocation(selectedUnitData, units).y})
              </div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                Status: {STATUS_LABELS[selectedUnitData.status]?.label || selectedUnitData.status}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                Strength: {selectedUnitData.strength}/{UNIT_SPECS[selectedUnitData.type].strength}
              </div>
            </div>
          </div>
        )}
        
        {/* BUG #11 FIX: Scrollable unit list WITHOUT the button */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <div style={{ 
            fontSize: 10, 
            textTransform: 'uppercase', 
            letterSpacing: 1, 
            color: COLORS.textMuted, 
            marginBottom: 8
          }}>
            Click to select, double-click or Enter to activate
          </div>
          <div style={{ border: `1px solid ${COLORS.border}` }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '100px 80px 60px 70px 70px 80px', 
              gap: 8, 
              padding: '6px 8px', 
              fontSize: 9, 
              color: COLORS.textMuted, 
              fontWeight: 600, 
              borderBottom: `1px solid ${COLORS.border}`, 
              backgroundColor: COLORS.panel, 
              position: 'sticky', 
              top: 0 
            }}>
              <div>UNIT</div>
              <div>POSITION</div>
              <div>STATUS</div>
              <div>MOVES</div>
              <div>FUEL</div>
              <div>STRENGTH</div>
            </div>
            {playerUnits.length === 0 ? (
              <div style={{ 
                padding: 12, 
                color: COLORS.textMuted, 
                textAlign: 'center' 
              }}>
                No units available
              </div>
            ) : playerUnits.map(u => {
              const sp = UNIT_SPECS[u.type];
              const sel = selUnit === u.id;
              const st = STATUS_LABELS[u.status] || { label: u.status, color: COLORS.text };
              const pos = getUnitLocation(u, units);
              return (
                <div 
                  key={u.id} 
                  onClick={() => setSelUnit(u.id)} 
                  onDoubleClick={() => {
                    onMakeActive(u.id);
                    onSelectUnit(u);
                    onClose();
                  }}
                  onMouseEnter={() => setHoveredUnit(u.id)}
                  onMouseLeave={() => setHoveredUnit(null)}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '100px 80px 60px 70px 70px 80px', 
                    gap: 8, 
                    padding: '8px', 
                    fontSize: 11, 
                    cursor: 'pointer', 
                    backgroundColor: sel ? COLORS.selected : (hoveredUnit === u.id ? COLORS.panelLight : 'transparent'),
                    borderBottom: `1px solid ${COLORS.border}`,
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MiniUnitIcon type={u.type} size="tiny" />
                    {sp.name}
                    {u.aboardId && (
                      <span style={{ fontSize: 8, color: '#9f6aca' }}>(a)</span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    ({pos.x}, {pos.y})
                  </div>
                  <div style={{ color: st.color, fontSize: 10 }}>
                    {st.label}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    {u.movesLeft}/{sp.movement}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    {sp.fuel ? `${u.fuel}/${sp.fuel}` : '-'}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    {u.strength}/{sp.strength}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* BUG #11 FIX: Buttons in fixed footer outside scroll area */}
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end',
          gap: 8
        }}>
          <button 
            onClick={() => { 
              if (selUnit && selectedUnitData) { 
                onMakeActive(selUnit); 
                onSelectUnit(selectedUnitData);
                onClose(); 
              } 
            }} 
            disabled={!selUnit} 
            style={{ 
              padding: '8px 16px', 
              fontSize: 11, 
              backgroundColor: selUnit ? COLORS.highlight : COLORS.panelLight, 
              border: 'none', 
              color: selUnit ? COLORS.textDark : COLORS.textMuted, 
              cursor: selUnit ? 'pointer' : 'not-allowed',
              fontWeight: selUnit ? 600 : 400
            }}
          >
            Make Active Unit
          </button>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * City list dialog - show all player cities
 */
export function CityListDialog({ cities, units, onClose, onSelectCity }) {
  const playerCities = Object.entries(cities).filter(([, c]) => c.owner === 'player');
  const aiCount = Object.values(cities).filter(c => c.owner === 'ai').length;
  const neutralCount = Object.values(cities).filter(c => c.owner === 'neutral').length;
  
  return (
    <div style={{ 
      position: 'fixed', 
      inset: 0, 
      backgroundColor: 'rgba(0,0,0,0.7)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      zIndex: 1000 
    }}>
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.border}`, 
        width: 500, 
        maxHeight: '80vh', 
        display: 'flex', 
        flexDirection: 'column', 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.border, 
          padding: '8px 12px', 
          fontSize: 12, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase', 
          display: 'flex', 
          justifyContent: 'space-between' 
        }}>
          <span>City List</span>
          <button 
            onClick={onClose} 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: COLORS.textMuted, 
              fontSize: 14, 
              cursor: 'pointer' 
            }}
          >
            X
          </button>
        </div>
        
        <div style={{ 
          padding: 12, 
          borderBottom: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          gap: 16, 
          fontSize: 11 
        }}>
          <span>Total: {Object.keys(cities).length}</span>
          <span style={{ color: COLORS.playerCity }}>Yours: {playerCities.length}</span>
          <span style={{ color: COLORS.aiCity }}>AI: {aiCount}</span>
          <span style={{ color: COLORS.neutralCity }}>Neutral: {neutralCount}</span>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <div style={{ border: `1px solid ${COLORS.border}` }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '70px 100px 50px 1fr', 
              gap: 8, 
              padding: '6px 8px', 
              fontSize: 9, 
              color: COLORS.textMuted, 
              fontWeight: 600, 
              borderBottom: `1px solid ${COLORS.border}`, 
              backgroundColor: COLORS.panel 
            }}>
              <div>LOCATION</div>
              <div>PRODUCING</div>
              <div>DAYS</div>
              <div>UNITS</div>
            </div>
            {playerCities.length === 0 ? (
              <div style={{ 
                padding: 12, 
                color: COLORS.textMuted, 
                textAlign: 'center' 
              }}>
                No cities
              </div>
            ) : playerCities.map(([key, city]) => {
              const prod = city.producing ? UNIT_SPECS[city.producing] : null;
              const progress = prod ? (city.progress[city.producing] || 0) : 0;
              const remaining = prod ? prod.productionDays - progress : 0;
              const unitsHere = units.filter(u => {
                const p = getUnitLocation(u, units);
                return p.x === city.x && p.y === city.y && u.owner === 'player';
              });
              return (
                <div 
                  key={key} 
                  onClick={() => { 
                    onSelectCity(city.x, city.y); 
                    onClose(); 
                  }} 
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '70px 100px 50px 1fr', 
                    gap: 8, 
                    padding: '8px', 
                    fontSize: 11, 
                    cursor: 'pointer', 
                    borderBottom: `1px solid ${COLORS.border}`,
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = COLORS.selected}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <div>({city.x}, {city.y})</div>
                  <div style={{ color: prod ? COLORS.text : COLORS.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {prod ? (
                      <>
                        <MiniUnitIcon type={city.producing} size="tiny" />
                        {prod.name}
                      </>
                    ) : '-'}
                  </div>
                  <div style={{ 
                    fontFamily: 'monospace', 
                    color: remaining <= 1 ? COLORS.success : COLORS.text 
                  }}>
                    {prod ? remaining : '-'}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {unitsHere.length > 0 ? unitsHere.map(u => (
                      <MiniUnitIcon key={u.id} type={u.type} size="tiny" />
                    )) : <span style={{ color: COLORS.textMuted }}>-</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end' 
        }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer' 
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Patrol confirmation dialog
 * BUG #1 FIX: Now captures Enter key to confirm patrol
 * BUG #2 FIX: Now shows total patrol route distance
 */
export function PatrolConfirmDialog({ waypoints, segmentDistances, onConfirm, onCancel }) {
  
  // BUG #1 FIX: Handle keyboard events - Enter confirms, Escape cancels
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{
        backgroundColor: COLORS.panel,
        border: `2px solid ${COLORS.patrolLine}`,
        width: 380,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
      }}>
        <div style={{
          backgroundColor: COLORS.patrolLine,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: '#fff'
        }}>
          Confirm Patrol
        </div>
        <div style={{ padding: 16 }}>
          {segmentDistances && (
            <div style={{ fontSize: 11, marginBottom: 10 }}>
              {segmentDistances.segs.map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.text, marginBottom: 3 }}>
                  <span>WP{i} ({waypoints[i].x},{waypoints[i].y}) → WP{i+1} ({waypoints[i+1].x},{waypoints[i+1].y})</span>
                  <span style={{ marginLeft: 12, whiteSpace: 'nowrap' }}>{d} tiles</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, marginBottom: 3 }}>
                <span>Return WP{segmentDistances.segs.length} → WP0</span>
                <span style={{ marginLeft: 12 }}>{segmentDistances.returnDist} tiles</span>
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 6, paddingTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: 10, marginBottom: 2 }}>
                  <span>Subtotal (excl. return)</span>
                  <span>{segmentDistances.subtotal} tiles</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 12 }}>
                  <span>Total (incl. return)</span>
                  <span>{segmentDistances.total} tiles</span>
                </div>
              </div>
            </div>
          )}
          <p style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' }}>
            Unit will patrol continuously until given new orders
          </p>
        </div>
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'center', 
          gap: 8 
        }}>
          <button 
            onClick={onCancel} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer' 
            }}
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm} 
            style={{ 
              padding: '8px 20px', 
              backgroundColor: COLORS.patrolLine, 
              border: 'none', 
              color: '#fff', 
              cursor: 'pointer', 
              fontWeight: 600 
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Combat result dialog
 */
export function CombatDialog({ result, onClose }) {
  if (!result) return null;
  
  const { attacker, defender, attackerDamage, defenderDamage, attackerDestroyed, defenderDestroyed } = result;
  const attSpec = UNIT_SPECS[attacker.type];
  const defSpec = defender.isCity ? null : UNIT_SPECS[defender.type];
  
  return (
    <div style={{ 
      position: 'fixed', 
      inset: 0, 
      backgroundColor: 'rgba(0,0,0,0.7)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      zIndex: 1000 
    }}>
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.danger}`, 
        width: 350, 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.danger, 
          padding: '8px 12px', 
          fontSize: 12, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase', 
          textAlign: 'center', 
          color: '#fff' 
        }}>
          Combat Report
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: 16 
          }}>
            <div style={{ textAlign: 'center' }}>
              <MiniUnitIcon type={attacker.type} owner={attacker.owner} size="medium" />
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{attSpec.name}</div>
              <div style={{ fontSize: 10, color: COLORS.textMuted }}>Attacker</div>
              <div style={{ 
                fontSize: 11, 
                marginTop: 4, 
                color: attackerDestroyed ? COLORS.danger : (attackerDamage > 0 ? COLORS.highlight : COLORS.success) 
              }}>
                {attackerDestroyed ? 'DESTROYED' : attackerDamage > 0 ? `-${attackerDamage} HP` : 'Unharmed'}
              </div>
            </div>
            <div style={{ fontSize: 20, color: COLORS.danger }}>{SYMBOLS.VS}</div>
            <div style={{ textAlign: 'center' }}>
              {defSpec ? (
                <MiniUnitIcon type={defender.type} owner={defender.owner} size="medium" />
              ) : (
                <div style={{ 
                  width: 32, 
                  height: 24, 
                  backgroundColor: COLORS.neutralCity, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  margin: '0 auto'
                }}>{SYMBOLS.STAR_FILLED}</div>
              )}
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                {defSpec ? defSpec.name : 'City'}
              </div>
              <div style={{ fontSize: 10, color: COLORS.textMuted }}>Defender</div>
              <div style={{ 
                fontSize: 11, 
                marginTop: 4, 
                color: defenderDestroyed ? COLORS.danger : (defenderDamage > 0 ? COLORS.highlight : COLORS.success) 
              }}>
                {defenderDestroyed ? 'DESTROYED' : defenderDamage > 0 ? `-${defenderDamage} HP` : 'Unharmed'}
              </div>
            </div>
          </div>
        </div>
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'center' 
        }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '8px 24px', 
              backgroundColor: COLORS.highlight, 
              border: 'none', 
              color: COLORS.textDark, 
              cursor: 'pointer', 
              fontWeight: 600 
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Victory screen with leaderboard
 */
export function VictoryDialog({ turn, mapSize, difficulty, onNewGame }) {
  // BUG #6 FIX: Removed useEffect that saved to leaderboard here.
  // The leaderboard save is already handled in the main game when victory is detected.
  // Having it here caused duplicate entries (same score saved multiple times).
  
  const scores = getTopScores(mapSize, difficulty);
  
  return (
    <div style={{ 
      position: 'fixed', 
      inset: 0, 
      backgroundColor: 'rgba(0,0,0,0.85)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      zIndex: 1000 
    }}>
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.success}`, 
        width: 400, 
        boxShadow: '0 4px 30px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.success, 
          padding: '12px', 
          fontSize: 16, 
          fontWeight: 600, 
          letterSpacing: 2, 
          textTransform: 'uppercase', 
          textAlign: 'center', 
          color: '#fff' 
        }}>
          VICTORY!
        </div>
        <div style={{ padding: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 14 }}>Congratulations!</p>
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
            You have conquered all cities in <span style={{ color: COLORS.highlight, fontWeight: 600 }}>{turn}</span> turns.
          </p>
          <div style={{ 
            marginTop: 20, 
            padding: 12, 
            backgroundColor: COLORS.panelLight, 
            borderRadius: 4 
          }}>
            <div style={{ 
              fontSize: 10, 
              textTransform: 'uppercase', 
              letterSpacing: 1, 
              color: COLORS.textMuted, 
              marginBottom: 8 
            }}>
              Leaderboard ({MAP_SIZES[mapSize].label}, Diff {difficulty})
            </div>
            {scores.length === 0 ? (
              <div style={{ color: COLORS.textMuted, fontSize: 11 }}>No records yet</div>
            ) : scores.map((s, i) => (
              <div 
                key={i} 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  fontSize: 12, 
                  padding: '4px 0', 
                  color: s.turns === turn ? COLORS.highlight : COLORS.text 
                }}
              >
                <span>#{i + 1}</span>
                <span>{s.turns} turns</span>
                <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{s.date}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'center' 
        }}>
          <button 
            onClick={onNewGame} 
            style={{ 
              padding: '10px 30px', 
              backgroundColor: COLORS.highlight, 
              border: 'none', 
              color: COLORS.textDark, 
              cursor: 'pointer', 
              fontWeight: 600, 
              fontSize: 12, 
              textTransform: 'uppercase', 
              letterSpacing: 1 
            }}
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Defeat screen
 */
export function DefeatDialog({ onNewGame }) {
  return (
    <div style={{ 
      position: 'fixed', 
      inset: 0, 
      backgroundColor: 'rgba(0,0,0,0.85)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      zIndex: 1000 
    }}>
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.danger}`, 
        width: 400, 
        boxShadow: '0 4px 30px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.danger, 
          padding: '12px', 
          fontSize: 16, 
          fontWeight: 600, 
          letterSpacing: 2, 
          textTransform: 'uppercase', 
          textAlign: 'center', 
          color: '#fff' 
        }}>
          DEFEAT
        </div>
        <div style={{ padding: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 14 }}>You have lost all your cities.</p>
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
            The AI has emerged victorious.
          </p>
        </div>
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'center' 
        }}>
          <button 
            onClick={onNewGame} 
            style={{ 
              padding: '10px 30px', 
              backgroundColor: COLORS.highlight, 
              border: 'none', 
              color: COLORS.textDark, 
              cursor: 'pointer', 
              fontWeight: 600, 
              fontSize: 12, 
              textTransform: 'uppercase', 
              letterSpacing: 1 
            }}
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Surrender confirmation dialog
 * BUG #1 FIX: Now captures Escape key to cancel
 */
export function SurrenderDialog({ message, onYes, onNo }) {
  // BUG #1 FIX: Handle keyboard events - Escape closes (says No)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onNo();
    }
    // Note: NOT capturing Enter here since surrender is dangerous
  };
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.7)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.border}`, 
        width: 350, 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.danger, 
          padding: '8px 12px', 
          fontSize: 12, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase', 
          color: '#fff' 
        }}>
          Surrender?
        </div>
        <div style={{ padding: 16, fontSize: 12 }}>{message}</div>
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 8 
        }}>
          <button 
            onClick={onNo} 
            style={{ 
              padding: '8px 16px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer' 
            }}
          >
            No
          </button>
          <button 
            onClick={onYes} 
            style={{ 
              padding: '8px 16px', 
              backgroundColor: COLORS.danger, 
              border: 'none', 
              color: '#fff', 
              cursor: 'pointer', 
              fontWeight: 600 
            }}
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * BUG #2: AI Turn Summary Dialog
 * Shows observed enemy movements at end of AI turn
 */
export function AITurnSummaryDialog({ observations, combatEvents, onContinue, onCenterOn }) {
  const hasCombat = combatEvents && combatEvents.length > 0;
  const hasObservations = observations && observations.length > 0;
  
  if (!hasCombat && !hasObservations) return null;
  
  // Handle keyboard - Enter/Space to continue
  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onContinue();
    }
  };
  
  return (
    <div 
      style={{ 
        position: "fixed", 
        inset: 0, 
        backgroundColor: "rgba(0,0,0,0.8)", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center", 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.danger}`, 
        width: 450, 
        maxHeight: "80vh",
        boxShadow: "0 4px 30px rgba(0,0,0,0.5)" 
      }}>
        <div style={{ 
          backgroundColor: COLORS.danger, 
          padding: "10px 12px", 
          fontSize: 13, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: "uppercase", 
          textAlign: "center", 
          color: "#fff" 
        }}>
          Enemy Activity Observed
        </div>
        <div style={{ 
          padding: 16, 
          maxHeight: "60vh", 
          overflowY: "auto" 
        }}>
          {/* Combat Events Section */}
          {hasCombat && (
            <>
              <div style={{ 
                fontSize: 11, 
                fontWeight: 600, 
                color: COLORS.danger, 
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 1
              }}>
                Combat Results
              </div>
              {combatEvents.map((evt, idx) => (
                <div 
                  key={`combat-${idx}`} 
                  style={{ 
                    padding: "12px", 
                    marginBottom: 10, 
                    backgroundColor: "rgba(200, 50, 50, 0.2)", 
                    border: "1px solid rgba(200, 50, 50, 0.4)",
                    borderRadius: 4,
                    cursor: "pointer"
                  }}
                  onClick={() => onCenterOn && onCenterOn(evt.location)}
                >
                  {/* Combat header */}
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center",
                    marginBottom: 8,
                    paddingBottom: 8,
                    borderBottom: "1px solid rgba(200, 50, 50, 0.3)"
                  }}>
                    <span style={{ fontWeight: 600, color: "#fff" }}>
                      Combat at ({evt.location.x}, {evt.location.y})
                    </span>
                    <span style={{ 
                      fontSize: 10, 
                      backgroundColor: COLORS.danger, 
                      color: "#fff", 
                      padding: "2px 6px", 
                      borderRadius: 3 
                    }}>
                      {SYMBOLS.CROSSED_SWORDS || "⚔"} BATTLE
                    </span>
                  </div>
                  
                  {/* Attacker info */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 8, 
                    marginBottom: 6 
                  }}>
                    <MiniUnitIcon type={evt.attacker.type} owner={evt.attacker.owner} size="small" />
                    <span style={{ color: COLORS.danger, fontWeight: 600 }}>
                      Enemy {UNIT_SPECS[evt.attacker.type]?.name || evt.attacker.type}
                    </span>
                    <span style={{ color: COLORS.textMuted, fontSize: 11 }}>
                      (str {evt.attacker.startStrength} {SYMBOLS.ARROW_RIGHT} {evt.attacker.endStrength})
                    </span>
                    {evt.attacker.destroyed && (
                      <span style={{ 
                        fontSize: 10, 
                        backgroundColor: COLORS.success, 
                        color: "#000", 
                        padding: "1px 5px", 
                        borderRadius: 3,
                        fontWeight: 600
                      }}>
                        DESTROYED
                      </span>
                    )}
                  </div>
                  
                  {/* "attacked" label */}
                  <div style={{ 
                    fontSize: 10, 
                    color: COLORS.textMuted, 
                    marginLeft: 28,
                    marginBottom: 6
                  }}>
                    attacked
                  </div>
                  
                  {/* Defender info */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 8 
                  }}>
                    <MiniUnitIcon type={evt.defender.type} owner={evt.defender.owner} size="small" />
                    <span style={{ color: COLORS.playerCity, fontWeight: 600 }}>
                      Your {UNIT_SPECS[evt.defender.type]?.name || evt.defender.type}
                    </span>
                    <span style={{ color: COLORS.textMuted, fontSize: 11 }}>
                      (str {evt.defender.startStrength} {SYMBOLS.ARROW_RIGHT} {evt.defender.endStrength})
                    </span>
                    {evt.defender.destroyed && (
                      <span style={{ 
                        fontSize: 10, 
                        backgroundColor: COLORS.danger, 
                        color: "#fff", 
                        padding: "1px 5px", 
                        borderRadius: 3,
                        fontWeight: 600
                      }}>
                        LOST
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          
          {/* Movement Observations Section */}
          {hasObservations && (
            <>
              {hasCombat && (
                <div style={{ 
                  fontSize: 11, 
                  fontWeight: 600, 
                  color: COLORS.textMuted, 
                  marginTop: 12,
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 1
                }}>
                  Other Sightings
                </div>
              )}
              {observations.filter(obs => !obs.combat).map((obs, idx) => (
            <div 
              key={idx} 
              style={{ 
                padding: "10px 12px", 
                marginBottom: 8, 
                backgroundColor: "rgba(200, 80, 80, 0.15)", 
                border: "1px solid rgba(200, 80, 80, 0.3)",
                borderRadius: 4,
                cursor: "pointer"
              }}
              onClick={() => onCenterOn && onCenterOn(obs.trail[0])}
            >
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                marginBottom: 6 
              }}>
                <span style={{ fontWeight: 600, color: COLORS.danger, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MiniUnitIcon type={obs.unitType} owner="ai" size="small" />
                  Enemy {UNIT_SPECS[obs.unitType]?.name || obs.unitType}
                </span>
                {obs.combat && (
                  <span style={{ 
                    fontSize: 10, 
                    backgroundColor: COLORS.danger, 
                    color: "#fff", 
                    padding: "2px 6px", 
                    borderRadius: 3 
                  }}>
                    COMBAT
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                {obs.trail.length === 2 ? (
                  <>
                    Observed at ({obs.trail[0].x}, {obs.trail[0].y}) {SYMBOLS.ARROW_RIGHT} moved to ({obs.trail[1].x}, {obs.trail[1].y})
                  </>
                ) : obs.trail.length > 2 ? (
                  <>
                    Trail: {obs.trail.map((p, i) => `(${p.x},${p.y})`).join(` ${SYMBOLS.ARROW_RIGHT} `)}
                  </>
                ) : (
                  <>
                    Observed at ({obs.trail[0].x}, {obs.trail[0].y})
                  </>
                )}
              </div>
            </div>
          ))}
            </>
          )}
        </div>
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: "flex", 
          justifyContent: "center" 
        }}>
          <button 
            onClick={onContinue} 
            style={{ 
              padding: "10px 24px", 
              backgroundColor: COLORS.highlight, 
              border: "none", 
              color: "#000", 
              cursor: "pointer", 
              fontWeight: 600,
              fontSize: 12, 
              textTransform: "uppercase", 
              letterSpacing: 1 
            }}
          >
            Continue (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// SAVE/LOAD GAME DIALOGS
// ============================================================================

/**
 * Generate default save filename
 * Format: [MapSize]-[Difficulty]-Turn[#]-[MMDD]
 */
function generateDefaultFilename(mapSize, difficulty, turn) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const mapLabel = MAP_SIZES[mapSize]?.label || mapSize;
  return `${mapLabel}-D${difficulty}-T${turn}-${month}${day}`;
}

/**
 * Get saved games from localStorage
 * Returns array of 5 slots (null for empty slots)
 */
export function getSavedGames() {
  try {
    const saved = localStorage.getItem('scSaveSlots');
    if (saved) {
      const slots = JSON.parse(saved);
      // Ensure we always have 5 slots
      while (slots.length < 5) slots.push(null);
      return slots.slice(0, 5);
    }
  } catch (e) {
    console.error('Error loading saved games:', e);
  }
  return [null, null, null, null, null];
}

/**
 * Save game to a specific slot
 */
export function saveGameToSlot(slotIndex, saveData) {
  try {
    const slots = getSavedGames();
    slots[slotIndex] = {
      ...saveData,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('scSaveSlots', JSON.stringify(slots));
    return true;
  } catch (e) {
    console.error('Error saving game:', e);
    return false;
  }
}

/**
 * Delete a saved game from a slot
 */
export function deleteSaveSlot(slotIndex) {
  try {
    const slots = getSavedGames();
    slots[slotIndex] = null;
    localStorage.setItem('scSaveSlots', JSON.stringify(slots));
    return true;
  } catch (e) {
    console.error('Error deleting save:', e);
    return false;
  }
}

/**
 * Save Game Dialog
 * Shows 5 save slots, allows naming and saving
 */
export function SaveGameDialog({ 
  gameState, 
  exploredTiles, 
  aiKnowledge,
  onSave, 
  onSaveAndQuit, 
  onClose 
}) {
  const [slots, setSlots] = useState(() => getSavedGames());
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [filename, setFilename] = useState(() => 
    generateDefaultFilename(gameState.mapSize, gameState.difficulty, gameState.turn)
  );
  const [saving, setSaving] = useState(false);
  
  // Handle keyboard - Escape to close
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  
  const handleSave = (andQuit = false) => {
    setSaving(true);
    
    // Serialize exploredTiles Set to array
    const exploredArray = Array.from(exploredTiles);
    
    // Serialize aiKnowledge Sets to arrays for JSON storage
    const serializedAiKnowledge = aiKnowledge ? {
      ...aiKnowledge,
      exploredTiles: Array.from(aiKnowledge.exploredTiles || []),
      homeIslandTiles: aiKnowledge.homeIslandTiles ? Array.from(aiKnowledge.homeIslandTiles) : null,
      homeIslandCities: Array.from(aiKnowledge.homeIslandCities || []),
      lostCities: Array.from(aiKnowledge.lostCities || []),
      knownCities: Array.from(aiKnowledge.knownCities || []),
      // Also serialize island-level Sets (tiles, cities, coastTiles)
      islands: (aiKnowledge.islands || []).map(island => ({
        ...island,
        tiles: Array.from(island.tiles || []),
        cities: Array.from(island.cities || []),
        coastTiles: Array.from(island.coastTiles || [])
      }))
    } : null;
    
    const saveData = {
      filename: filename.trim() || generateDefaultFilename(gameState.mapSize, gameState.difficulty, gameState.turn),
      mapSize: gameState.mapSize,
      terrain: gameState.terrain,
      difficulty: gameState.difficulty,
      turn: gameState.turn,
      gameState: gameState,
      exploredTiles: exploredArray,
      aiKnowledge: serializedAiKnowledge
    };
    
    const success = saveGameToSlot(selectedSlot, saveData);
    
    if (success) {
      setSlots(getSavedGames());
      if (andQuit) {
        onSaveAndQuit();
      } else {
        onSave();
      }
    } else {
      setSaving(false);
      alert('Failed to save game. Please try again.');
    }
  };
  
  // Update filename when slot changes (use existing name if slot has a save)
  const handleSlotSelect = (idx) => {
    setSelectedSlot(idx);
    if (slots[idx]) {
      setFilename(slots[idx].filename);
    } else {
      setFilename(generateDefaultFilename(gameState.mapSize, gameState.difficulty, gameState.turn));
    }
  };
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.8)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.highlight}`, 
        width: 450, 
        boxShadow: '0 4px 30px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.highlight, 
          padding: '10px 12px', 
          fontSize: 13, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase', 
          textAlign: 'center', 
          color: COLORS.textDark 
        }}>
          Save Game
        </div>
        
        {/* Current game info */}
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: COLORS.panelLight, 
          borderBottom: `1px solid ${COLORS.border}`,
          fontSize: 11 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: COLORS.textMuted }}>Map:</span>
            <span>{MAP_SIZES[gameState.mapSize]?.label}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: COLORS.textMuted }}>Difficulty:</span>
            <span>{gameState.difficulty}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: COLORS.textMuted }}>Turn:</span>
            <span style={{ color: COLORS.highlight, fontWeight: 600 }}>{gameState.turn}</span>
          </div>
        </div>
        
        {/* Save slots */}
        <div style={{ padding: 16 }}>
          <div style={{ 
            fontSize: 10, 
            textTransform: 'uppercase', 
            letterSpacing: 1, 
            color: COLORS.textMuted, 
            marginBottom: 8 
          }}>
            Select Save Slot
          </div>
          
          {slots.map((slot, idx) => (
            <div 
              key={idx}
              onClick={() => handleSlotSelect(idx)}
              style={{ 
                padding: '10px 12px', 
                marginBottom: 6, 
                backgroundColor: selectedSlot === idx ? 'rgba(200, 180, 100, 0.2)' : COLORS.panelLight,
                border: `1px solid ${selectedSlot === idx ? COLORS.highlight : COLORS.border}`,
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ 
                  fontSize: 11, 
                  fontWeight: selectedSlot === idx ? 600 : 400,
                  color: selectedSlot === idx ? COLORS.highlight : COLORS.text 
                }}>
                  Slot {idx + 1}: {slot ? slot.filename : '(Empty)'}
                </span>
                {slot && (
                  <span style={{ fontSize: 9, color: COLORS.textMuted }}>
                    Turn {slot.turn}
                  </span>
                )}
              </div>
              {slot && (
                <div style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 4 }}>
                  {MAP_SIZES[slot.mapSize]?.label} | Diff {slot.difficulty} | {new Date(slot.savedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
          
          {/* Filename input */}
          <div style={{ marginTop: 16 }}>
            <label style={{ 
              display: 'block', 
              fontSize: 10, 
              textTransform: 'uppercase', 
              letterSpacing: 1, 
              color: COLORS.textMuted, 
              marginBottom: 6 
            }}>
              Save Name
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input 
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                maxLength={40}
                style={{ 
                  flex: 1, 
                  padding: '8px 10px', 
                  backgroundColor: COLORS.panelLight, 
                  border: `1px solid ${COLORS.border}`, 
                  color: COLORS.text, 
                  fontSize: 12,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
              <button
                onClick={() => setFilename(generateDefaultFilename(gameState.mapSize, gameState.difficulty, gameState.turn))}
                style={{
                  padding: '8px 12px',
                  backgroundColor: COLORS.border,
                  border: 'none',
                  color: COLORS.text,
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap'
                }}
                title="Reset to auto-generated name"
              >
                Default
              </button>
            </div>
          </div>
          
          {slots[selectedSlot] && (
            <div style={{ 
              marginTop: 8, 
              padding: 8, 
              backgroundColor: 'rgba(200, 80, 80, 0.15)', 
              border: '1px solid rgba(200, 80, 80, 0.3)',
              borderRadius: 4,
              fontSize: 10, 
              color: COLORS.danger 
            }}>
              Warning: This will overwrite the existing save in Slot {selectedSlot + 1}.
            </div>
          )}
        </div>
        
        {/* Buttons */}
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 8 
        }}>
          <button 
            onClick={onClose}
            disabled={saving}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit'
            }}
          >
            Cancel
          </button>
          <button 
            onClick={() => handleSave(false)}
            disabled={saving}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: COLORS.border, 
              border: 'none', 
              color: COLORS.text, 
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 11,
              fontFamily: 'inherit'
            }}
          >
            {saving ? 'Saving...' : 'Save Game'}
          </button>
          <button 
            onClick={() => handleSave(true)}
            disabled={saving}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: COLORS.highlight, 
              border: 'none', 
              color: COLORS.textDark, 
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 11,
              fontFamily: 'inherit'
            }}
          >
            {saving ? 'Saving...' : 'Save & Quit'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Load Game Dialog
 * Shows 5 save slots, allows loading or deleting
 */
export function LoadGameDialog({ onLoad, onClose }) {
  const [slots, setSlots] = useState(() => getSavedGames());
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  
  // Handle keyboard - Escape to close
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (confirmDelete !== null) {
        setConfirmDelete(null);
      } else {
        onClose();
      }
    }
  };
  
  const handleLoad = () => {
    if (selectedSlot === null || !slots[selectedSlot]) return;
    onLoad(slots[selectedSlot]);
  };
  
  const handleDelete = (idx) => {
    deleteSaveSlot(idx);
    setSlots(getSavedGames());
    setConfirmDelete(null);
    if (selectedSlot === idx) setSelectedSlot(null);
  };
  
  const hasSaves = slots.some(s => s !== null);
  
  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        backgroundColor: 'rgba(0,0,0,0.8)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: 1000 
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div style={{ 
        backgroundColor: COLORS.panel, 
        border: `2px solid ${COLORS.highlight}`, 
        width: 450, 
        boxShadow: '0 4px 30px rgba(0,0,0,0.5)' 
      }}>
        <div style={{ 
          backgroundColor: COLORS.highlight, 
          padding: '10px 12px', 
          fontSize: 13, 
          fontWeight: 600, 
          letterSpacing: 1, 
          textTransform: 'uppercase', 
          textAlign: 'center', 
          color: COLORS.textDark 
        }}>
          Load Game
        </div>
        
        {/* Save slots */}
        <div style={{ padding: 16 }}>
          {!hasSaves ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '30px 20px', 
              color: COLORS.textMuted,
              fontSize: 12 
            }}>
              No saved games found.
            </div>
          ) : (
            <>
              <div style={{ 
                fontSize: 10, 
                textTransform: 'uppercase', 
                letterSpacing: 1, 
                color: COLORS.textMuted, 
                marginBottom: 8 
              }}>
                Select a saved game to load
              </div>
              
              {slots.map((slot, idx) => (
                <div 
                  key={idx}
                  style={{ 
                    padding: '10px 12px', 
                    marginBottom: 6, 
                    backgroundColor: selectedSlot === idx ? 'rgba(200, 180, 100, 0.2)' : (slot ? COLORS.panelLight : 'transparent'),
                    border: `1px solid ${selectedSlot === idx ? COLORS.highlight : (slot ? COLORS.border : 'transparent')}`,
                    borderRadius: 4,
                    cursor: slot ? 'pointer' : 'default',
                    opacity: slot ? 1 : 0.5,
                    transition: 'all 0.15s'
                  }}
                  onClick={() => slot && setSelectedSlot(idx)}
                >
                  {confirmDelete === idx ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: COLORS.danger }}>Delete this save?</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                          style={{ 
                            padding: '4px 10px', 
                            backgroundColor: 'transparent', 
                            border: `1px solid ${COLORS.border}`, 
                            color: COLORS.text, 
                            cursor: 'pointer',
                            fontSize: 10
                          }}
                        >
                          No
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}
                          style={{ 
                            padding: '4px 10px', 
                            backgroundColor: COLORS.danger, 
                            border: 'none', 
                            color: '#fff', 
                            cursor: 'pointer',
                            fontSize: 10
                          }}
                        >
                          Yes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ 
                          fontSize: 11, 
                          fontWeight: selectedSlot === idx ? 600 : 400,
                          color: slot ? (selectedSlot === idx ? COLORS.highlight : COLORS.text) : COLORS.textMuted 
                        }}>
                          Slot {idx + 1}: {slot ? slot.filename : '(Empty)'}
                        </span>
                        {slot && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 9, color: COLORS.textMuted }}>
                              Turn {slot.turn}
                            </span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(idx); }}
                              style={{ 
                                padding: '2px 6px', 
                                backgroundColor: 'transparent', 
                                border: `1px solid ${COLORS.danger}`, 
                                color: COLORS.danger, 
                                cursor: 'pointer',
                                fontSize: 9,
                                borderRadius: 2
                              }}
                            >
                              {SYMBOLS.CLOSE}
                            </button>
                          </div>
                        )}
                      </div>
                      {slot && (
                        <div style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 4 }}>
                          {MAP_SIZES[slot.mapSize]?.label} | Diff {slot.difficulty} | {new Date(slot.savedAt).toLocaleDateString()}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        
        {/* Buttons */}
        <div style={{ 
          padding: 12, 
          borderTop: `1px solid ${COLORS.border}`, 
          display: 'flex', 
          justifyContent: 'flex-end', 
          gap: 8 
        }}>
          <button 
            onClick={onClose}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: 'transparent', 
              border: `1px solid ${COLORS.border}`, 
              color: COLORS.text, 
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit'
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleLoad}
            disabled={selectedSlot === null || !slots[selectedSlot]}
            style={{ 
              padding: '8px 16px', 
              backgroundColor: selectedSlot !== null && slots[selectedSlot] ? COLORS.highlight : COLORS.border, 
              border: 'none', 
              color: selectedSlot !== null && slots[selectedSlot] ? COLORS.textDark : COLORS.textMuted, 
              cursor: selectedSlot !== null && slots[selectedSlot] ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              fontSize: 11,
              fontFamily: 'inherit'
            }}
          >
            Load Game
          </button>
        </div>
      </div>
    </div>
  );
}

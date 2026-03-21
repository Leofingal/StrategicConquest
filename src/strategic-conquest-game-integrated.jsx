import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';

// ============================================================================
// MODULE IMPORTS
// ============================================================================
import {
  WATER, LAND, PLAYER_CITY, AI_CITY, NEUTRAL_CITY, FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE,
  PHASE_MENU, PHASE_PLAYING, PHASE_VICTORY, PHASE_DEFEAT,
  STATUS_READY, STATUS_WAITING, STATUS_SENTRY, STATUS_PATROL, STATUS_GOTO, STATUS_SKIPPED, STATUS_USED, STATUS_ABOARD,
  TILE_SIZE, TILE_WIDTH, TILE_HEIGHT, VIEWPORT_TILES_X, VIEWPORT_TILES_Y, UNIT_SPECS, COLORS, DIRECTIONS,
  BASE_HIT_CHANCE, NAVAL_VS_LAND_HIT_CHANCE, CITY_COMBAT, BOMBARD_HIT_CHANCE
} from './game-constants.js';
import { calculateVisibility, buildFogArray, updateExploredTiles } from './fog-of-war.js';
import { getValidMoves, findPath, getUnitLocation, getCargoCount, isOnRefuelTile, getBombardTargets } from './movement-engine.js';
import { createGameState, setUnitGoTo, setUnitPatrol, setUnitStatus, unloadUnit, setCityProduction, endPlayerTurn, checkVictoryCondition, findNextUnit } from './game-state.js';
import { executeAITurn, createAIKnowledge, createAIKnowledgeFromState, recordPlayerObservations } from './ai-opponent.js';
import { generateMap, MAP_SIZES, TERRAIN_TYPES, DIFFICULTY_LEVELS } from './map-generator.js';
import { Tile, UnitSprite, MiniMap, TurnInfo, UnitInfoPanel, CommandMenu, GotoLineOverlay, PatrolOverlay } from './ui-components.jsx';
import { CityProductionDialog, UnitViewDialog, CityListDialog, AllUnitsListDialog, PatrolConfirmDialog, VictoryDialog, DefeatDialog, AITurnSummaryDialog, SurrenderDialog, SaveGameDialog, LoadGameDialog, HelpDialog, getSavedGames } from './dialog-components.jsx';

// ============================================================================
// LEADERBOARD
// ============================================================================

// DEBUG FLAGS
const DEBUG_GOTO = false;  // Set to true to see goto/patrol step logging

const getLeaderboard = () => { try { return JSON.parse(localStorage.getItem('scLeaderboard') || '{}'); } catch { return {}; } };

// Calculate patrol segment distances using real pathfinding
// Returns { segs: number[], returnDist: number, subtotal: number, total: number }
function calcPatrolDists(waypoints, unit, state) {
  if (!waypoints || waypoints.length < 2 || !unit || !state) return null;
  const segs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p = findPath(waypoints[i].x, waypoints[i].y, waypoints[i + 1].x, waypoints[i + 1].y, unit, state);
    segs.push(p ? p.length : 0);
  }
  const last = waypoints[waypoints.length - 1];
  const ret = findPath(last.x, last.y, waypoints[0].x, waypoints[0].y, unit, state);
  const returnDist = ret ? ret.length : 0;
  const subtotal = segs.reduce((a, b) => a + b, 0);
  return { segs, returnDist, subtotal, total: subtotal + returnDist };
}
const saveToLeaderboard = (mapSize, difficulty, turns) => { try { const lb = getLeaderboard(), key = `${mapSize}-${difficulty}`; if (!lb[key]) lb[key] = []; lb[key].push({ turns, date: new Date().toLocaleDateString() }); lb[key].sort((a, b) => a.turns - b.turns); lb[key] = lb[key].slice(0, 3); localStorage.setItem('scLeaderboard', JSON.stringify(lb)); } catch {} };
const getTopScores = (mapSize, difficulty) => getLeaderboard()[`${mapSize}-${difficulty}`] || [];

// ============================================================================
// COMBAT
// ============================================================================
function simulateCombat(attacker, defSpec, defStr, allUnits = []) {
  const att = UNIT_SPECS[attacker.type], aStr = attacker.strength, aRatio = aStr / att.strength, dRatio = defStr / defSpec.strength;
  
  // Calculate base rolls
  let aRolls = att.halfStrengthCombat ? Math.max(1, Math.ceil(aStr * 0.5)) : Math.max(1, Math.round(att.attackRolls * aRatio));
  let dRolls = defSpec.halfStrengthCombat ? Math.max(1, Math.ceil(defStr * 0.5)) : Math.max(0, Math.round(defSpec.defenseRolls * dRatio));
  
  // CARRIER BONUS: +1 attack/defense die per 2 fighters aboard
  if (att.carriesAir && allUnits.length > 0) {
    const fightersAboard = allUnits.filter(u => u.aboardId === attacker.id && u.type === 'fighter').length;
    const bonusDice = Math.floor(fightersAboard / 2);
    if (bonusDice > 0) {
      aRolls += bonusDice;
      console.log(`[COMBAT] Carrier attack bonus: +${bonusDice} dice from ${fightersAboard} fighters`);
    }
  }
  
  if (att.stealth && !defSpec.detectsSubs) dRolls = 0;
  const aHit = (att.isNaval && defSpec.isLand) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE, dHit = (defSpec.isLand && att.isNaval) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
  let dmgToDef = 0, dmgToAtt = 0;
  for (let i = 0; i < aRolls; i++) if (Math.random() < aHit) dmgToDef += att.damagePerHit;
  for (let i = 0; i < dRolls; i++) if (Math.random() < dHit) dmgToAtt += defSpec.defenseDamagePerHit;
  return { dmgToDef, dmgToAtt, attRem: Math.max(0, aStr - dmgToAtt), defRem: Math.max(0, defStr - dmgToDef) };
}

// Carrier defense bonus helper
function getCarrierDefenseBonus(defender, allUnits) {
  const defSpec = UNIT_SPECS[defender.type];
  if (defSpec.carriesAir && allUnits.length > 0) {
    const fightersAboard = allUnits.filter(u => u.aboardId === defender.id && u.type === 'fighter').length;
    return Math.floor(fightersAboard / 2);
  }
  return 0;
}

function simulateCombatWithDefender(attacker, defender, allUnits = []) {
  const att = UNIT_SPECS[attacker.type], defSpec = UNIT_SPECS[defender.type];
  const aStr = attacker.strength, defStr = defender.strength;
  const aRatio = aStr / att.strength, dRatio = defStr / defSpec.strength;
  
  // Calculate base rolls
  let aRolls = att.halfStrengthCombat ? Math.max(1, Math.ceil(aStr * 0.5)) : Math.max(1, Math.round(att.attackRolls * aRatio));
  let dRolls = defSpec.halfStrengthCombat ? Math.max(1, Math.ceil(defStr * 0.5)) : Math.max(0, Math.round(defSpec.defenseRolls * dRatio));
  
  // CARRIER BONUS: +1 attack/defense die per 2 fighters aboard
  if (att.carriesAir && allUnits.length > 0) {
    const fightersAboard = allUnits.filter(u => u.aboardId === attacker.id && u.type === 'fighter').length;
    const bonusDice = Math.floor(fightersAboard / 2);
    if (bonusDice > 0) {
      aRolls += bonusDice;
      console.log(`[COMBAT] Carrier attack bonus: +${bonusDice} dice from ${fightersAboard} fighters`);
    }
  }
  
  if (defSpec.carriesAir && allUnits.length > 0) {
    const fightersAboard = allUnits.filter(u => u.aboardId === defender.id && u.type === 'fighter').length;
    const bonusDice = Math.floor(fightersAboard / 2);
    if (bonusDice > 0) {
      dRolls += bonusDice;
      console.log(`[COMBAT] Carrier defense bonus: +${bonusDice} dice from ${fightersAboard} fighters`);
    }
  }
  
  if (att.stealth && !defSpec.detectsSubs) dRolls = 0;
  const aHit = (att.isNaval && defSpec.isLand) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
  const dHit = (defSpec.isLand && att.isNaval) ? NAVAL_VS_LAND_HIT_CHANCE : BASE_HIT_CHANCE;
  let dmgToDef = 0, dmgToAtt = 0;
  for (let i = 0; i < aRolls; i++) if (Math.random() < aHit) dmgToDef += att.damagePerHit;
  for (let i = 0; i < dRolls; i++) if (Math.random() < dHit) dmgToAtt += defSpec.defenseDamagePerHit;
  return { dmgToDef, dmgToAtt, attRem: Math.max(0, aStr - dmgToAtt), defRem: Math.max(0, defStr - dmgToDef) };
}

const resolveCombat = (att, def, allUnits = []) => { 
  const r = simulateCombatWithDefender(att, def, allUnits); 
  return { attDmg: att.strength - r.attRem, defDmg: def.strength - r.defRem, attDead: r.attRem <= 0, defDead: r.defRem <= 0, attRem: r.attRem, defRem: r.defRem }; 
};
const resolveCityAttack = (att) => { const r = simulateCombat(att, CITY_COMBAT, 1); return { attDmg: att.strength - r.attRem, cityDead: r.defRem <= 0, attRem: r.attRem }; };

// ============================================================================
// BOMBARDMENT COMBAT (NEW)
// Battleship bombardment: ceil(strength x 0.5) rolls at 20% hit chance
// No counterattack (defender can't shoot back)
// ============================================================================
function resolveBombardment(attacker, defender) {
  const att = UNIT_SPECS[attacker.type];
  const defSpec = UNIT_SPECS[defender.type];
  
  // Attacker gets ceil(strength x 0.5) rolls (same as halfStrengthCombat)
  const aRolls = Math.max(1, Math.ceil(attacker.strength * 0.5));
  
  let dmgToDef = 0;
  for (let i = 0; i < aRolls; i++) {
    if (Math.random() < BOMBARD_HIT_CHANCE) {
      dmgToDef += att.damagePerHit;
    }
  }
  
  const defRem = Math.max(0, defender.strength - dmgToDef);
  
  console.log(`[BOMBARD] ${attacker.type} (str ${attacker.strength}) fires ${aRolls} rolls at ${defender.type} (str ${defender.strength})`);
  console.log(`[BOMBARD] Hit chance: ${BOMBARD_HIT_CHANCE * 100}%, Damage dealt: ${dmgToDef}, Defender remaining: ${defRem}`);
  
  return {
    hits: dmgToDef,
    defRem,
    defDead: defRem <= 0,
    rolls: aRolls
  };
}

// ============================================================================
// MENU SCREEN
// ============================================================================
function MenuScreen({ onStart, onLoadGame }) {
  const [mapSize, setMapSize] = useState('small'), [terrain, setTerrain] = useState('normal'), [difficulty, setDifficulty] = useState(5);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const scores = getTopScores(mapSize, difficulty);
  const hasSaves = getSavedGames().some(s => s !== null);
  const selectStyle = { width: '100%', padding: '8px', backgroundColor: COLORS.panelLight, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: '12px' };
  const labelStyle = { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: COLORS.textMuted, marginBottom: '6px' };
  
  const handleLoad = (saveData) => {
    setShowLoadDialog(false);
    onLoadGame(saveData);
  };
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: COLORS.background, color: COLORS.text, fontFamily: 'Monaco, monospace' }}>
      <div style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px', letterSpacing: '2px' }}>STRATEGIC CONQUEST</div>
      <div style={{ fontSize: '12px', color: COLORS.textMuted, marginBottom: '32px' }}>Enhanced Edition - as reimagined by Chris Lee</div>
      <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '24px', minWidth: '320px' }}>
        <div style={{ marginBottom: '16px' }}><label style={labelStyle}>Map Size</label><select value={mapSize} onChange={e => setMapSize(e.target.value)} style={selectStyle}>{Object.entries(MAP_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div style={{ marginBottom: '16px' }}><label style={labelStyle}>Terrain</label><select value={terrain} onChange={e => setTerrain(e.target.value)} style={selectStyle}>{Object.entries(TERRAIN_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div style={{ marginBottom: '24px' }}><label style={labelStyle}>Difficulty</label><select value={difficulty} onChange={e => setDifficulty(Number(e.target.value))} style={selectStyle}>{DIFFICULTY_LEVELS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
        <button onClick={() => onStart(mapSize, terrain, difficulty)} style={{ width: '100%', padding: '12px', backgroundColor: COLORS.highlight, border: 'none', color: COLORS.textDark, fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', letterSpacing: '1px', marginBottom: '8px' }}>START GAME</button>
        <button 
          onClick={() => setShowLoadDialog(true)} 
          disabled={!hasSaves}
          style={{ 
            width: '100%', 
            padding: '10px', 
            backgroundColor: hasSaves ? COLORS.border : COLORS.panelLight, 
            border: 'none', 
            color: hasSaves ? COLORS.text : COLORS.textMuted, 
            fontSize: '12px', 
            fontWeight: '600', 
            cursor: hasSaves ? 'pointer' : 'not-allowed', 
            letterSpacing: '1px' 
          }}
        >
          LOAD GAME
        </button>
        {scores.length > 0 && <div style={{ marginTop: '16px', fontSize: '10px', color: COLORS.textMuted }}><div style={{ marginBottom: '4px' }}>Best scores ({mapSize}, difficulty {difficulty}):</div>{scores.map((s, i) => <div key={i}>{i + 1}. {s.turns} turns ({s.date})</div>)}</div>}
        <div style={{ marginTop: '12px', textAlign: 'right' }}>
          <button onClick={() => setShowHelp(true)} title="Starting Conditions Help" style={{ background: 'none', border: `1px solid ${COLORS.textMuted}`, color: COLORS.textMuted, fontSize: '11px', cursor: 'pointer', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>?</button>
        </div>
      </div>
      {showLoadDialog && <LoadGameDialog onLoad={handleLoad} onClose={() => setShowLoadDialog(false)} />}
      {showHelp && <HelpDialog title="Starting Conditions Guide" guide="starting" onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// ============================================================================
// MAIN GAME COMPONENT
// ============================================================================
export default function StrategicConquestGame() {
  const [phase, setPhase] = useState(PHASE_MENU);
  const [gameState, setGameState] = useState(null);
  const [exploredTiles, setExploredTiles] = useState(() => new Set());
  const [turnVisibility, setTurnVisibility] = useState(() => new Set());
  const [aiKnowledge, setAiKnowledge] = useState(() => createAIKnowledge());
  const [viewportX, setViewportX] = useState(0), [viewportY, setViewportY] = useState(0);
  const [message, setMessage] = useState('Your turn. Select a unit to move.');
  const [blink, setBlink] = useState(false);
  const [gotoMode, setGotoMode] = useState(false), [patrolMode, setPatrolMode] = useState(false), [patrolWaypoints, setPatrolWaypoints] = useState([]), [patrolDistances, setPatrolDistances] = useState(null);
  const [bombardMode, setBombardMode] = useState(false); // NEW: Bombardment mode for battleships
  const [dragging, setDragging] = useState(false), [dragTarget, setDragTarget] = useState(null);
  // BUG #8 FIX: Add hoverTarget state for gotoMode preview
  const [hoverTarget, setHoverTarget] = useState(null);
  // BUG #8 FIX: Track mouse tile position for coordinate display
  const [mouseTile, setMouseTile] = useState(null);
  const [showCityDialog, setShowCityDialog] = useState(null), [showUnitView, setShowUnitView] = useState(null);
  const [showCityList, setShowCityList] = useState(false), [showAllUnits, setShowAllUnits] = useState(false), [showPatrolConfirm, setShowPatrolConfirm] = useState(false);
  
  // BUG #6 FIX: Track captured city to show dialog after state update
  const [capturedCityKey, setCapturedCityKey] = useState(null);
  
  // BUG #4 FIX: State for step-by-step auto-movement
  const [autoMovingUnitId, setAutoMovingUnitId] = useState(null);
  const [autoMoveQueue, setAutoMoveQueue] = useState([]); // Queue of unit IDs to auto-move at turn start
  
  // BUG #2 FIX: State for AI turn observations
  const [aiObservations, setAiObservations] = useState([]);
  const [aiCombatEvents, setAiCombatEvents] = useState([]);
  const [showAiSummary, setShowAiSummary] = useState(false);
  
  // BUG #2 FIX: Track if player made contact with AI this turn (for AI phase transition)
  const [playerMadeContact, setPlayerMadeContact] = useState(false);
  
  // BUG #2 FIX: Track player movement observations for AI (fairness)
  const [playerObservations, setPlayerObservations] = useState([]);
  
  // BUG #13: Surrender state
  const [showSurrender, setShowSurrender] = useState(null); // null or { type: 'offer'|'request', message: string }
  
  // Save/Load game state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  
  const containerRef = useRef(null);
  
  const activeUnit = useMemo(() => gameState?.units.find(u => u.id === gameState.activeUnitId) || null, [gameState]);
  const cityCounts = useMemo(() => {
    if (!gameState) return { player: 0, ai: 0, neutral: 0 };
    const cities = Object.values(gameState.cities);
    return {
      player: cities.filter(c => c.owner === 'player').length,
      ai: cities.filter(c => c.owner === 'ai').length,
      neutral: cities.filter(c => c.owner === 'neutral').length
    };
  }, [gameState]);
  
  const unitsWaiting = useMemo(() => {
    if (!gameState) return 0;
    return gameState.units.filter(u => 
      u.owner === 'player' && 
      u.movesLeft > 0 && 
      !u.aboardId &&
      u.status !== STATUS_SENTRY &&
      u.status !== STATUS_USED &&
      u.status !== STATUS_SKIPPED
    ).length;
  }, [gameState]);
  
  const currentVisibility = useMemo(() => {
    return gameState ? calculateVisibility(gameState, 'player') : new Set();
  }, [gameState]);
  
  // BUG #2 FIX: Calculate explored percentage of map
  const exploredPercent = useMemo(() => {
    if (!gameState) return 0;
    const totalTiles = gameState.width * gameState.height;
    return Math.round((exploredTiles.size / totalTiles) * 100);
  }, [gameState, exploredTiles]);
  
  const fog = useMemo(() => {
    return gameState ? buildFogArray(gameState.width, gameState.height, exploredTiles, currentVisibility, turnVisibility) : [];
  }, [gameState, exploredTiles, currentVisibility, turnVisibility]);
  
  const validMoves = useMemo(() => {
    return activeUnit && gameState ? getValidMoves(activeUnit, gameState) : [];
  }, [activeUnit, gameState]);
  
  // NEW: Calculate valid bombard targets when in bombard mode
  const bombardTargets = useMemo(() => {
    if (!bombardMode || !activeUnit || !gameState) return [];
    // BOMBARD FIX: No targets if already bombarded this turn
    if (activeUnit.hasBombarded) return [];
    return getBombardTargets(activeUnit, gameState, fog, FOG_VISIBLE);
  }, [bombardMode, activeUnit, gameState, fog]);
  
  // BUG #8 FIX: Use hoverTarget OR dragTarget for preview
  const previewTarget = hoverTarget || dragTarget;
  const gotoPreview = useMemo(() => { 
    if (!activeUnit || !previewTarget || !gameState) return null; 
    const path = findPath(activeUnit.x, activeUnit.y, previewTarget.x, previewTarget.y, activeUnit, gameState); 
    if (!path || path.length === 0) return null; 
    const spec = UNIT_SPECS[activeUnit.type]; 
    return { path, dist: path.length, turns: Math.ceil(path.length / spec.movement) }; 
  }, [activeUnit, previewTarget, gameState]);
  
  useEffect(() => { if (phase !== PHASE_PLAYING) return; const i = setInterval(() => setBlink(b => !b), 400); return () => clearInterval(i); }, [phase]);
  useEffect(() => { if (gameState) setExploredTiles(prev => updateExploredTiles(prev, currentVisibility)); }, [currentVisibility, gameState]);
  
  // BUG #6 FIX: Show city dialog when a city is captured
  // BUG #2 FIX: Only show dialog if city is actually player-owned (capture succeeded)
  useEffect(() => {
    if (capturedCityKey && gameState) {
      const city = gameState.cities[capturedCityKey];
      if (city && city.owner === 'player') {
        setShowCityDialog(capturedCityKey);
      }
      setCapturedCityKey(null);
    }
  }, [capturedCityKey, gameState]);
  
  const centerOnUnit = useCallback((u) => { if (!gameState || !u) return; const pos = getUnitLocation(u, gameState.units); setViewportX(Math.max(0, Math.min(gameState.width - VIEWPORT_TILES_X, pos.x - Math.floor(VIEWPORT_TILES_X / 2)))); setViewportY(Math.max(0, Math.min(gameState.height - VIEWPORT_TILES_Y, pos.y - Math.floor(VIEWPORT_TILES_Y / 2)))); }, [gameState]);
  
  const advanceToNextUnit = useCallback((state, excludeWaiting = false) => {
    const nextId = findNextUnit(state, state.activeUnitId, excludeWaiting);
    if (nextId) { const nu = state.units.find(u => u.id === nextId); if (nu) centerOnUnit(nu); return { ...state, activeUnitId: nextId }; }
    return state;
  }, [centerOnUnit]);
  
  const handleStartGame = useCallback((mapSize, terrain, difficulty) => {
    const mapData = generateMap(mapSize, terrain, difficulty);
    const newState = createGameState(mapData, mapSize, terrain, difficulty);
    
    // BUG FIX: Initialize AI knowledge with proper start position from first AI city
    const aiCity = Object.values(newState.cities).find(c => c.owner === 'ai');
    const aiStartX = aiCity ? aiCity.x : undefined;
    const aiStartY = aiCity ? aiCity.y : undefined;
    console.log(`[StartGame] AI start position: (${aiStartX},${aiStartY})`);
    
    setGameState(newState); 
    setPhase(PHASE_PLAYING); 
    setExploredTiles(new Set()); 
    setTurnVisibility(new Set()); 
    setAiKnowledge(createAIKnowledge(aiStartX, aiStartY));
    
    const pCity = Object.values(newState.cities).find(c => c.owner === 'player');
    if (pCity) { setViewportX(Math.max(0, pCity.x - Math.floor(VIEWPORT_TILES_X / 2))); setViewportY(Math.max(0, pCity.y - Math.floor(VIEWPORT_TILES_Y / 2))); }
    setMessage('Your turn. Select a unit to move.');
    setAutoMovingUnitId(null);
    setAutoMoveQueue([]);
    setCapturedCityKey(null);
    setBombardMode(false); // Reset bombard mode on new game
  }, []);
  
  // ============================================================================
  // BUG #4 FIX: Execute ONE step of auto-movement with proper fog update
  // Returns { newState, stopped, message } 
  // stopped = true means unit should stop (enemy found, blocked, arrived, etc)
  // ============================================================================
  const executeOneAutoMoveStep = useCallback((state, unitId) => {
    const unit = state.units.find(u => u.id === unitId);
    if (!unit || unit.movesLeft <= 0) {
      return { newState: state, stopped: true, message: null, reason: 'no_moves' };
    }
    
    // Determine target based on gotoPath or patrolPath
    let targetX, targetY;
    let isPatrol = false;
    
    if (unit.gotoPath && unit.gotoPath.length > 0) {
      targetX = unit.gotoPath[0].x;
      targetY = unit.gotoPath[0].y;
      if (DEBUG_GOTO) console.log(`[GOTO-STEP] Unit ${unitId} step toward (${targetX},${targetY}), path remaining: ${unit.gotoPath.length}`);
    } else if (unit.patrolPath && unit.patrolPath.length >= 2) {
      isPatrol = true;
      const nextWaypoint = unit.patrolPath[(unit.patrolIdx + 1) % unit.patrolPath.length];
      const pathToWaypoint = findPath(unit.x, unit.y, nextWaypoint.x, nextWaypoint.y, unit, state);
      if (!pathToWaypoint || pathToWaypoint.length === 0) {
        // At waypoint or blocked
        if (unit.x === nextWaypoint.x && unit.y === nextWaypoint.y) {
          // Arrived at waypoint, advance index
          const newIdx = (unit.patrolIdx + 1) % unit.patrolPath.length;
          const newUnits = state.units.map(u => u.id === unitId ? { ...u, patrolIdx: newIdx } : u);
          return { newState: { ...state, units: newUnits }, stopped: false, message: null, reason: 'waypoint_reached' };
        }
        return { newState: state, stopped: true, message: 'Patrol blocked - no path.', reason: 'blocked' };
      }
      targetX = pathToWaypoint[0].x;
      targetY = pathToWaypoint[0].y;
    } else {
      return { newState: state, stopped: true, message: null, reason: 'no_path' };
    }
    
    // Check for enemy at target - STOP for player intervention
    const enemiesAtTarget = state.units.filter(u => 
      u.x === targetX && u.y === targetY && 
      u.owner !== unit.owner && 
      !u.aboardId
    );
    const cityAtTarget = state.cities[`${targetX},${targetY}`];
    // BUG #1 FIX: Include neutral cities as hostile (not just enemy cities)
    // Original bug: neutral cities were not flagged, so units walked right in
    const isHostileCityAtTarget = cityAtTarget && cityAtTarget.owner !== unit.owner;
    
    if (enemiesAtTarget.length > 0 || isHostileCityAtTarget) {
      if (DEBUG_GOTO) console.log(`[AUTO-MOVE] Unit ${unitId} encountered ${isHostileCityAtTarget ? 'hostile city' : 'enemy'} at (${targetX},${targetY}) - stopping for player`);
      // Keep the path but stop - player can manually attack or press a key to resume
      return { 
        newState: state, 
        stopped: true, 
        message: `${isHostileCityAtTarget && !enemiesAtTarget.length ? 'Hostile city' : 'Enemy'} spotted at (${targetX},${targetY})! Unit awaiting orders.`, 
        reason: 'enemy_spotted' 
      };
    }
    
    // Check if move is valid
    const moves = getValidMoves(unit, state);
    const move = moves.find(m => m.x === targetX && m.y === targetY);
    
    if (!move) {
      if (DEBUG_GOTO) console.log(`[AUTO-MOVE] Unit ${unitId} blocked - target (${targetX},${targetY}) not valid`);
      // Clear path if blocked
      const newUnits = state.units.map(u => 
        u.id === unitId 
          ? { ...u, gotoPath: null, patrolPath: null, status: STATUS_READY }
          : u
      );
      return { 
        newState: { ...state, units: newUnits }, 
        stopped: true, 
        message: isPatrol ? 'Patrol blocked.' : 'GoTo blocked - path obstructed.', 
        reason: 'blocked' 
      };
    }
    
    // Execute the move
    const spec = UNIT_SPECS[unit.type];
    const newUnits = state.units.map(u => {
      if (u.id !== unitId) return u;
      
      const updated = { ...u, x: targetX, y: targetY, movesLeft: u.movesLeft - 1 };
      
      // Update goto path
      if (updated.gotoPath && updated.gotoPath.length > 0) {
        updated.gotoPath = updated.gotoPath.slice(1);
        if (updated.gotoPath.length === 0) {
          updated.gotoPath = null;
          updated.status = STATUS_READY;
          if (DEBUG_GOTO) console.log(`[GOTO-STEP] Unit ${unitId} arrived at destination`);
        }
      }
      
      // Handle fuel
      if (spec.fuel && updated.fuel !== null) {
        updated.fuel = updated.fuel - 1;
        const cityKey = `${updated.x},${updated.y}`;
        const city = state.cities[cityKey];
        
        // BUG #4 FIX: Check for friendly carrier at location (aircraft refuel on carriers like cities)
        const carrierAtLocation = spec.isAir && state.units.find(c => 
          c.x === updated.x && 
          c.y === updated.y && 
          c.id !== updated.id && 
          c.owner === unit.owner && 
          UNIT_SPECS[c.type].carriesAir
        );
        
        if ((city && city.owner === unit.owner) || updated.aboardId || carrierAtLocation) {
          updated.fuel = spec.fuel;
          if (carrierAtLocation) {
            console.log(`[AUTO-MOVE][BUG4] ${spec.name} refueled on carrier at (${updated.x},${updated.y})`);
          }
        }
      }
      
      return updated;
    });

    // If a carrier just moved, refuel any friendly aircraft already at the destination
    if (spec.carriesAir) {
      const aircraftAtDest = newUnits.filter(u =>
        u.x === targetX &&
        u.y === targetY &&
        u.owner === unit.owner &&
        u.id !== unitId &&
        !u.aboardId &&
        UNIT_SPECS[u.type].isAir
      );
      for (const aircraft of aircraftAtDest) {
        const aIdx = newUnits.findIndex(u => u.id === aircraft.id);
        if (aIdx !== -1) {
          const aSpec = UNIT_SPECS[aircraft.type];
          newUnits[aIdx] = { ...newUnits[aIdx], fuel: aSpec.fuel };
          console.log(`[CARRIER][AUTO] Aircraft ${aircraft.id} refueled by carrier arriving at (${targetX},${targetY})`);
        }
      }
    }

    // Check if unit ran out of fuel (crashes)
    const movedUnit = newUnits.find(u => u.id === unitId);
    if (spec.fuel && movedUnit.fuel <= 0) {
      const cityKey = `${movedUnit.x},${movedUnit.y}`;
      const city = state.cities[cityKey];
      const isOnFriendlyCity = city && city.owner === unit.owner;
      
      // BUG #4 FIX: Also check for carrier at crash location
      const carrierAtCrashLoc = spec.isAir && newUnits.find(c => 
        c.x === movedUnit.x && 
        c.y === movedUnit.y && 
        c.id !== movedUnit.id && 
        c.owner === unit.owner && 
        UNIT_SPECS[c.type].carriesAir
      );
      
      if (!isOnFriendlyCity && !movedUnit.aboardId && !carrierAtCrashLoc) {
        // Crash!
        console.log(`[AUTO-MOVE] Unit ${unitId} crashed - out of fuel`);
        const survivingUnits = newUnits.filter(u => u.id !== unitId && u.aboardId !== unitId);
        return {
          newState: { ...state, units: survivingUnits },
          stopped: true,
          message: `${spec.name} crashed - out of fuel!`,
          reason: 'crashed'
        };
      }
    }
    
    // Check if move exhausted
    if (movedUnit.movesLeft <= 0) {
      return { 
        newState: { ...state, units: newUnits }, 
        stopped: true, 
        message: null, 
        reason: 'out_of_moves' 
      };
    }
    
    // Check if arrived at goto destination
    if (!movedUnit.gotoPath && movedUnit.status !== STATUS_PATROL) {
      return {
        newState: { ...state, units: newUnits },
        stopped: true,
        message: 'Arrived at destination.',
        reason: 'arrived'
      };
    }
    
    return { newState: { ...state, units: newUnits }, stopped: false, message: null, reason: 'continue' };
  }, []);
  
  // BUG #9 FIX: Check if any enemies are visible after a move
  const checkForVisibleEnemies = useCallback((state, unitId) => {
    const unit = state.units.find(u => u.id === unitId);
    if (!unit) return null;
    
    // BUG #3 FIX: All units have sight range of 1 (adjacent tiles only)
    const sight = 1;
    
    // Check all tiles within sight range for enemies
    for (let dy = -sight; dy <= sight; dy++) {
      for (let dx = -sight; dx <= sight; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = unit.x + dx;
        const ny = unit.y + dy;
        
        // Check for enemy units
        const enemyUnit = state.units.find(u => 
          u.x === nx && 
          u.y === ny && 
          u.owner !== unit.owner && 
          !u.aboardId
        );
        
        if (enemyUnit) {
          return { x: nx, y: ny, type: 'unit', enemy: enemyUnit };
        }
        
        // Check for enemy city
        // BUG #1 FIX: Also flag neutral cities as hostile (stop for player decision)
        const city = state.cities[`${nx},${ny}`];
        if (city && city.owner !== unit.owner) {
          return { x: nx, y: ny, type: 'city', isNeutral: city.owner === 'neutral' };
        }
      }
    }
    return null;
  }, []);
  
  // BUG #4 FIX: Auto-movement effect with stepped execution
  useEffect(() => {
    if (!autoMovingUnitId || !gameState) return;
    
    const timer = setTimeout(() => {
      const result = executeOneAutoMoveStep(gameState, autoMovingUnitId);
      
      // Update visibility after move
      const newVis = calculateVisibility(result.newState, 'player');
      setTurnVisibility(prev => {
        const s = new Set(prev);
        newVis.forEach(k => s.add(k));
        return s;
      });
      
      // PLAYER OBSERVATION FIX: Record observations during auto-move
      // Check if player unit is adjacent to AI units/cities after this move
      const movedUnit = result.newState.units.find(u => u.id === autoMovingUnitId);
      if (movedUnit) {
        let observedByAI = false;
        
        for (const dir of Object.values(DIRECTIONS)) {
          const ax = movedUnit.x + dir.dx;
          const ay = movedUnit.y + dir.dy;
          
          // Check for AI units
          const aiUnitNearby = result.newState.units.find(u => 
            u.x === ax && u.y === ay && u.owner === 'ai' && !u.aboardId
          );
          if (aiUnitNearby) {
            console.log(`[AUTO-MOVE][OBSERVATION] Player ${movedUnit.type} at (${movedUnit.x},${movedUnit.y}) spotted by AI ${aiUnitNearby.type} at (${ax},${ay})`);
            observedByAI = true;
            setPlayerMadeContact(true);
            break;
          }
          
          // Check for AI cities
          const cityKey = `${ax},${ay}`;
          const cityNearby = result.newState.cities[cityKey];
          if (cityNearby && cityNearby.owner === 'ai') {
            console.log(`[AUTO-MOVE][OBSERVATION] Player ${movedUnit.type} at (${movedUnit.x},${movedUnit.y}) spotted by AI city at (${ax},${ay})`);
            observedByAI = true;
            setPlayerMadeContact(true);
            break;
          }
        }
        
        if (observedByAI) {
          setPlayerObservations(prev => {
            const existingIdx = prev.findIndex(o => o.unitId === movedUnit.id);
            if (existingIdx >= 0) {
              const updated = [...prev];
              updated[existingIdx] = {
                ...updated[existingIdx],
                trail: [...updated[existingIdx].trail, { x: movedUnit.x, y: movedUnit.y }]
              };
              return updated;
            } else {
              return [...prev, {
                unitType: movedUnit.type,
                unitId: movedUnit.id,
                trail: [{ x: movedUnit.x, y: movedUnit.y }]
              }];
            }
          });
        }
      }
      
      setGameState(result.newState);
      
      // BUG #3 FIX: Check for visible enemies AFTER move (sight range 1 = adjacent)
      if (!result.stopped) {
        const enemySighting = checkForVisibleEnemies(result.newState, autoMovingUnitId);
        if (enemySighting) {
          const unit = result.newState.units.find(u => u.id === autoMovingUnitId);
          if (unit && (unit.status === STATUS_GOTO || unit.status === STATUS_PATROL)) {
            console.log(`[AUTO-MOVE] Unit ${autoMovingUnitId} spotted enemy at (${enemySighting.x},${enemySighting.y}) - stopping`);
            
            // BUG #4 FIX: Only interrupt THIS unit, other units keep their objectives
            const interruptedUnits = result.newState.units.map(u => 
              u.id === autoMovingUnitId 
                ? { ...u, gotoPath: null, status: STATUS_READY }
                : u
            );
            setGameState({ ...result.newState, units: interruptedUnits });
            setAutoMovingUnitId(null);
            // BUG #4 FIX: Don't clear queue - other units continue their objectives
            setMessage(`Enemy ${enemySighting.type === 'unit' ? UNIT_SPECS[enemySighting.enemy.type].name : 'city'} spotted at (${enemySighting.x},${enemySighting.y})! Awaiting orders.`);
            
            // Center on the spotted enemy
            setViewportX(Math.max(0, enemySighting.x - Math.floor(VIEWPORT_TILES_X / 2)));
            setViewportY(Math.max(0, enemySighting.y - Math.floor(VIEWPORT_TILES_Y / 2)));
            return;
          }
        }
      }
      
      if (result.stopped) {
        if (result.message) setMessage(result.message);
        
        // Check if there are more units in the queue
        if (autoMoveQueue.length > 0) {
          const [nextId, ...rest] = autoMoveQueue;
          console.log(`[AUTO-MOVE] Moving to next unit in queue: ${nextId}`);
          setAutoMoveQueue(rest);
          setAutoMovingUnitId(nextId);
          
          // Center on next unit
          const nextUnit = result.newState.units.find(u => u.id === nextId);
          if (nextUnit) centerOnUnit(nextUnit);
        } else {
          // No more units to auto-move
          setAutoMovingUnitId(null);
          
          // Find next available unit
          const nextState = advanceToNextUnit(result.newState, true);
          setGameState(nextState);
          
          if (!result.message) {
            setMessage('Your turn.');
          }
        }
      } else {
        // Continue with same unit
        // Center on unit
        const unit = result.newState.units.find(u => u.id === autoMovingUnitId);
        if (unit) centerOnUnit(unit);
      }
    }, 150); // 150ms delay between steps for visibility
    
    return () => clearTimeout(timer);
  }, [autoMovingUnitId, gameState, autoMoveQueue, executeOneAutoMoveStep, advanceToNextUnit, centerOnUnit, checkForVisibleEnemies]);
  
  // ============================================================================
  // BOMBARDMENT HANDLER (NEW)
  // ============================================================================
  const handleBombard = useCallback((targetX, targetY) => {
    if (!activeUnit || !gameState || !bombardMode) return;
    
    const spec = UNIT_SPECS[activeUnit.type];
    if (!spec.canBombard) {
      setMessage('This unit cannot bombard.');
      return;
    }
    
    // BOMBARD FIX: Check if unit has already bombarded this turn
    if (activeUnit.hasBombarded) {
      setMessage('This unit has already bombarded this turn.');
      setBombardMode(false);
      return;
    }
    
    // Verify target is valid
    const target = bombardTargets.find(t => t.x === targetX && t.y === targetY);
    if (!target) {
      setMessage('Invalid bombardment target.');
      return;
    }
    
    console.log(`[BOMBARD] Battleship at (${activeUnit.x},${activeUnit.y}) bombarding (${targetX},${targetY})`);
    
    setGameState(prev => {
      let newUnits = [...prev.units];
      const unitIdx = newUnits.findIndex(u => u.id === activeUnit.id);
      
      if (target.hasEnemy && target.enemyUnit) {
        // Resolve bombardment against enemy
        const result = resolveBombardment(activeUnit, target.enemyUnit);
        
        if (result.defDead) {
          // Enemy destroyed
          newUnits = newUnits.filter(u => u.id !== target.enemyUnit.id);
          setMessage(`Bombardment hit! Enemy ${UNIT_SPECS[target.enemyUnit.type].name} destroyed!`);
        } else if (result.hits > 0) {
          // Enemy damaged
          const defIdx = newUnits.findIndex(u => u.id === target.enemyUnit.id);
          newUnits[defIdx] = { ...newUnits[defIdx], strength: result.defRem };
          setMessage(`Bombardment hit! Enemy ${UNIT_SPECS[target.enemyUnit.type].name} damaged (${result.defRem} remaining).`);
        } else {
          // Missed
          setMessage(`Bombardment missed! (${result.rolls} shots, 0 hits)`);
        }
      } else {
        // No enemy at target - bombardment hits empty square
        const rolls = Math.max(1, Math.ceil(activeUnit.strength * 0.5));
        setMessage(`Bombardment fired at empty square. (${rolls} shots)`);
      }
      
      // BOMBARD FIX: Consume 1 move and set hasBombarded flag
      const newMovesLeft = Math.max(0, newUnits[unitIdx].movesLeft - 1);
      newUnits[unitIdx] = { 
        ...newUnits[unitIdx], 
        movesLeft: newMovesLeft,
        hasBombarded: true,  // Track that unit has bombarded
        status: newMovesLeft === 0 ? STATUS_USED : newUnits[unitIdx].status
      };
      
      // Exit bombard mode
      setBombardMode(false);
      
      // BOMBARD FIX: If unit still has moves, stay on this unit; otherwise advance
      if (newMovesLeft > 0) {
        return { ...prev, units: newUnits };
      } else {
        return advanceToNextUnit({ ...prev, units: newUnits }, true);
      }
    });
  }, [activeUnit, gameState, bombardMode, bombardTargets, advanceToNextUnit]);
  
  const handleMove = useCallback((dx, dy) => {
    if (!activeUnit || !gameState || activeUnit.movesLeft <= 0) return;
    const nx = activeUnit.x + dx, ny = activeUnit.y + dy;
    const move = validMoves.find(m => m.x === nx && m.y === ny);
    if (!move) return;
    
    setGameState(prev => {
      const spec = UNIT_SPECS[activeUnit.type];
      // BUG #10 FIX: Don't use index - find unit by ID and work with IDs throughout
      let newUnits = prev.units.map(u => ({ ...u })); // Deep copy all units
      let newCities = { ...prev.cities };
      let newMap = prev.map.map(row => [...row]);
      
      // Find our unit in the copied array
      const unitIdx = newUnits.findIndex(u => u.id === activeUnit.id);
      if (unitIdx === -1) {
        console.error('[BUG10] Active unit not found in state!');
        return prev;
      }
      let unit = newUnits[unitIdx];
      const startX = unit.x, startY = unit.y;
      
      // BUG #3 FIX: Track whether unit should actually move
      let shouldMove = true;
      let unitDestroyed = false; // BUG #10 FIX: Track if our unit died
      let capturedCity = null;
      
      // BUG #4 FIX: Auto-load tanks when transport DEPARTS from friendly city
      if (spec.carriesTanks && !move.isAttack) {
        const originCityKey = `${startX},${startY}`;
        const originCity = newCities[originCityKey];
        if (originCity && originCity.owner === unit.owner) {
          // Find tanks at origin city that can be loaded
          const tanksHere = newUnits.filter(u => 
            u.x === startX && 
            u.y === startY && 
            u.owner === unit.owner &&
            u.id !== unit.id &&
            !u.aboardId &&
            UNIT_SPECS[u.type].isLand &&
            u.type === 'tank'
          );
          
          // Sort by priority: sentry first, then no moves, then others
          tanksHere.sort((a, b) => {
            if (a.status === STATUS_SENTRY && b.status !== STATUS_SENTRY) return -1;
            if (b.status === STATUS_SENTRY && a.status !== STATUS_SENTRY) return 1;
            if (a.movesLeft === 0 && b.movesLeft > 0) return -1;
            if (b.movesLeft === 0 && a.movesLeft > 0) return 1;
            return 0;
          });
          
          const currentCargo = getCargoCount(unit.id, newUnits);
          const capacity = spec.capacity;
          const spaceAvailable = capacity - currentCargo;
          
          if (spaceAvailable > 0 && tanksHere.length > 0) {
            const toLoad = tanksHere.slice(0, spaceAvailable);
            console.log(`[AUTO-LOAD] Transport ${unit.id} loading ${toLoad.length} tanks on departure from city`);
            setMessage(`Transport loaded ${toLoad.length} tank(s) on departure.`);
            for (const tank of toLoad) {
              const tankIdx = newUnits.findIndex(u => u.id === tank.id);
              if (tankIdx !== -1) {
                newUnits[tankIdx] = { ...newUnits[tankIdx], aboardId: unit.id, status: STATUS_ABOARD };
              }
            }
          }
        }
      }
      
      if (move.isAttack) {
        if (move.isCity) {
          // City attack
          const ck = `${move.x},${move.y}`;
          const attackedCity = prev.cities[ck];
          
          // PLAYER OBSERVATION FIX: Record city attack observation for AI
          // When player attacks AI city, AI "observes" the attacker
          if (attackedCity && attackedCity.owner === 'ai') {
            setPlayerObservations(prev => {
              const existingIdx = prev.findIndex(o => o.unitId === unit.id);
              const combatInfo = { x: unit.x, y: unit.y, action: 'attack_city', target: 'city' };
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  trail: [...updated[existingIdx].trail, combatInfo]
                };
                return updated;
              } else {
                return [...prev, {
                  unitType: unit.type,
                  unitId: unit.id,
                  trail: [{ x: startX, y: startY }, combatInfo]
                }];
              }
            });
            console.log(`[OBSERVATION] AI observed player ${unit.type} attacking city at (${move.x},${move.y})`);
          }
          
          const result = resolveCityAttack(unit); 
          unit.strength = result.attRem;
          
          if (result.cityDead) { 
            newCities[ck] = { ...newCities[ck], owner: 'player', producing: 'tank' };
            newMap[move.y][move.x] = PLAYER_CITY; 
            // Tank becomes garrison - remove from active units
            newUnits = newUnits.filter(u => u.id !== unit.id);
            unitDestroyed = true; // BUG #10 FIX: Mark unit as removed (garrison)
            setMessage('City captured! Tank becomes garrison.'); 
            capturedCity = ck;
            setCapturedCityKey(ck);
            return advanceToNextUnit({ ...prev, units: newUnits, cities: newCities, map: newMap }, true);
          } else {
            shouldMove = false;
            setMessage(`City attack failed. ${unit.strength} strength remaining.`);
          }
          
          if (unit.strength <= 0) { 
            newUnits = newUnits.filter(u => u.id !== unit.id && u.aboardId !== unit.id);
            unitDestroyed = true; // BUG #10 FIX
            setMessage('Your unit was destroyed!'); 
            return advanceToNextUnit({ ...prev, units: newUnits, cities: newCities, map: newMap }, true); 
          }
        } else {
          // Unit combat
          let defenders = newUnits.filter(u => u.x === move.x && u.y === move.y && u.owner !== unit.owner && !u.aboardId);
          
          // BUG #9 FIX: Submarines can only attack naval units
          if (spec.stealth) {
            defenders = defenders.filter(d => UNIT_SPECS[d.type].isNaval);
          }
          
          if (defenders.length > 0) {
            // Pick strongest defender (by current strength)
            defenders.sort((a, b) => b.strength - a.strength);
            const defender = defenders[0];
            console.log(`[COMBAT] Attacking ${defender.type} (strength ${defender.strength}) - strongest of ${defenders.length} potential defenders`);
            
            // PLAYER OBSERVATION FIX: Record combat observation for AI
            // When player attacks AI unit, AI "observes" the attacker
            setPlayerObservations(prev => {
              const existingIdx = prev.findIndex(o => o.unitId === unit.id);
              const combatInfo = { x: unit.x, y: unit.y, action: 'attack', target: defender.type };
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  trail: [...updated[existingIdx].trail, combatInfo]
                };
                return updated;
              } else {
                return [...prev, {
                  unitType: unit.type,
                  unitId: unit.id,
                  trail: [{ x: startX, y: startY }, combatInfo]
                }];
              }
            });
            console.log(`[OBSERVATION] AI observed player ${unit.type} attacking at (${unit.x},${unit.y})`);
            
            const result = resolveCombat(unit, defender, newUnits); 
            unit.strength = result.attRem;
            
            if (result.defDead) {
              // Remove defender and any cargo it was carrying
              newUnits = newUnits.filter(u => u.id !== defender.id && u.aboardId !== defender.id);
              setMessage(`Enemy ${UNIT_SPECS[defender.type].name} destroyed!`); 
              
              const remainingEnemies = newUnits.filter(u => 
                u.x === move.x && u.y === move.y && 
                u.owner !== unit.owner && 
                !u.aboardId
              );
              
              if (remainingEnemies.length > 0) {
                shouldMove = false;
                console.log(`[COMBAT] Defender destroyed but ${remainingEnemies.length} enemies remain - staying put`);
              } else {
                const targetTile = prev.map[move.y][move.x];
                if (spec.isNaval && targetTile !== WATER) {
                  const targetCityKey = `${move.x},${move.y}`;
                  const targetCity = newCities[targetCityKey];
                  const isFriendlyCity = targetCity && targetCity.owner === unit.owner;
                  if (!isFriendlyCity) {
                    shouldMove = false;
                    console.log(`[COMBAT] Naval unit destroyed land unit but can't enter land tile`);
                  }
                }
              }
            } else { 
              shouldMove = false;
              // Update defender in place
              const defIdx = newUnits.findIndex(u => u.id === defender.id);
              if (defIdx !== -1) {
                newUnits[defIdx] = { ...newUnits[defIdx], strength: result.defRem };
              }
              if (result.defDmg > 0) {
                setMessage(`Enemy ${UNIT_SPECS[defender.type].name} damaged (${result.defRem} remaining).`);
              } else {
                setMessage(`Attack missed! Enemy ${UNIT_SPECS[defender.type].name} unharmed.`);
              }
            }
            
            if (unit.strength <= 0) {
              newUnits = newUnits.filter(u => u.id !== unit.id && u.aboardId !== unit.id);
              unitDestroyed = true; // BUG #10 FIX
              setMessage('Your unit was destroyed!');
              return advanceToNextUnit({ ...prev, units: newUnits, cities: newCities, map: newMap }, true); 
            }
          }
        }
        
        // BUG #6 FIX: Multi-attack rules
        // - First attack costs 1 move (for units with 2+ moves)
        // - Second attack (or any attack when already moved/attacked) consumes ALL remaining moves
        const hasAlreadyActed = unit.movesLeft < spec.movement;
        
        if (!hasAlreadyActed && unit.movesLeft > 1) {
          // First action of turn with 2+ moves - just deduct 1 move
          unit.movesLeft -= 1;
          console.log(`[COMBAT] First attack, moves remaining: ${unit.movesLeft}`);
        } else {
          // Second attack OR first attack with only 1 move - consume all moves
          console.log(`[COMBAT] ${hasAlreadyActed ? 'Second' : 'Final'} attack, consuming all moves`);
          unit.movesLeft = 0; 
          unit.status = STATUS_USED;
        }
      }
      
      // BUG #10 FIX: Only process movement if unit wasn't destroyed
      if (!unitDestroyed) {
        if (shouldMove) {
          // BUG #11 FIX: If this is a carrier moving, bring along any fighters at starting position
          // Fighters must NOT be on patrol or goto, and must not be aboard another carrier
          if (spec.carriesAir) {
            const fightersToMove = newUnits.filter(u => 
              u.x === startX && 
              u.y === startY && 
              u.owner === unit.owner &&
              u.id !== unit.id &&
              !u.aboardId &&
              UNIT_SPECS[u.type].isAir &&
              u.status !== STATUS_PATROL &&
              u.status !== STATUS_GOTO
            );
            
            for (const fighter of fightersToMove) {
              const fighterIdx = newUnits.findIndex(u => u.id === fighter.id);
              if (fighterIdx !== -1) {
                // Move fighter with carrier (no fuel cost, no move cost)
                newUnits[fighterIdx] = { 
                  ...newUnits[fighterIdx], 
                  x: move.x, 
                  y: move.y,
                  // Keep status as READY so player can still use it
                  status: STATUS_READY
                };
                console.log(`[CARRIER][BUG11] Fighter ${fighter.id} moved with carrier to (${move.x},${move.y})`);
              }
            }

            // Refuel friendly aircraft already sitting at the carrier's destination
            const aircraftAtDest = newUnits.filter(u =>
              u.x === move.x &&
              u.y === move.y &&
              u.owner === unit.owner &&
              u.id !== unit.id &&
              !u.aboardId &&
              UNIT_SPECS[u.type].isAir
            );
            for (const aircraft of aircraftAtDest) {
              const aIdx = newUnits.findIndex(u => u.id === aircraft.id);
              if (aIdx !== -1) {
                const aSpec = UNIT_SPECS[aircraft.type];
                newUnits[aIdx] = { ...newUnits[aIdx], fuel: aSpec.fuel };
                console.log(`[CARRIER] Aircraft ${aircraft.id} refueled by carrier arriving at (${move.x},${move.y})`);
              }
            }
          }

          unit.x = move.x;
          unit.y = move.y;
          if (!move.isAttack) {
            unit.movesLeft--;
          }
          
          // BUG #2 FIX: Handle disembark - clear aboardId when leaving transport
          if (move.disembark && unit.aboardId) {
            console.log(`[DISEMBARK][BUG2] Unit ${unit.id} disembarking from transport ${unit.aboardId}`);
            unit.aboardId = null;
            unit.status = STATUS_READY;
          }
          
          if (move.boardId) { 
            unit.aboardId = move.boardId; 
            unit.status = STATUS_ABOARD; 
          }
          
          // Handle fuel
          if (spec.fuel && unit.fuel !== null) { 
            unit.fuel--; 
            const cityKey = `${unit.x},${unit.y}`;
            const cityAtLocation = newCities[cityKey];
            const isOnFriendlyCity = cityAtLocation && cityAtLocation.owner === unit.owner;
            
            // BUG #8 FIX: Check for friendly carrier at location (aircraft refuel on carriers like cities)
            const carrierAtLocation = spec.isAir && newUnits.find(u => 
              u.x === unit.x && 
              u.y === unit.y && 
              u.id !== unit.id && 
              u.owner === unit.owner && 
              UNIT_SPECS[u.type].carriesAir
            );
            
            if (isOnFriendlyCity || unit.aboardId || carrierAtLocation) {
              unit.fuel = spec.fuel;
              if (carrierAtLocation) {
                console.log(`[FUEL][BUG8] ${spec.name} refueled on carrier at (${unit.x},${unit.y})`);
              }
            }
            if (unit.fuel <= 0 && !isOnFriendlyCity && !unit.aboardId && !carrierAtLocation) { 
              newUnits = newUnits.filter(u => u.id !== unit.id && u.aboardId !== unit.id);
              unitDestroyed = true;
              setMessage(`${spec.name} crashed!`); 
              return advanceToNextUnit({ ...prev, units: newUnits, cities: newCities, map: newMap }, true); 
            }
          }
        } else {
          console.log(`[COMBAT] Unit staying at (${startX},${startY}) after attack`);
        }
        
        // BUG #10 FIX: Update unit in array by finding its current index (may have shifted)
        const finalIdx = newUnits.findIndex(u => u.id === unit.id);
        if (finalIdx !== -1) {
          newUnits[finalIdx] = unit;
        } else {
          console.error('[BUG10] Unit disappeared from array during move processing!');
        }
        
        // BUG #8 FIX Part 2: Carrier picks up friendly aircraft at destination
        // Aircraft must NOT be on patrol or goto to be picked up
        if (spec.carriesAir && shouldMove) {
          const aircraftHere = newUnits.filter(u => 
            u.x === unit.x && 
            u.y === unit.y && 
            u.owner === unit.owner &&
            u.id !== unit.id &&
            !u.aboardId &&
            UNIT_SPECS[u.type].isAir &&
            u.status !== STATUS_PATROL &&
            u.status !== STATUS_GOTO
          );
          
          const currentCargo = getCargoCount(unit.id, newUnits);
          const capacity = spec.capacity;
          const spaceAvailable = capacity - currentCargo;
          
          if (spaceAvailable > 0 && aircraftHere.length > 0) {
            const toLoad = aircraftHere.slice(0, spaceAvailable);
            console.log(`[AUTO-PICKUP][BUG8] Carrier ${unit.id} picking up ${toLoad.length} aircraft at (${unit.x},${unit.y})`);
            setMessage(`Carrier picked up ${toLoad.length} aircraft.`);
            for (const aircraft of toLoad) {
              const aircraftIdx = newUnits.findIndex(u => u.id === aircraft.id);
              if (aircraftIdx !== -1) {
                newUnits[aircraftIdx] = { ...newUnits[aircraftIdx], aboardId: unit.id, status: STATUS_ABOARD };
              }
            }
          }
        }
      }
      
      const newVis = calculateVisibility({ ...prev, units: newUnits }, 'player');
      setTurnVisibility(p => { const s = new Set(p); newVis.forEach(k => s.add(k)); return s; });
      
      // BUG #2 FIX: Check if player unit is now adjacent to AI units or cities
      // This triggers AI phase transition AND records observation for AI
      if (!unitDestroyed && shouldMove) {
        const checkX = unit.x, checkY = unit.y;
        let madeContact = false;
        let observedByAI = false;
        
        // Check adjacent tiles for AI units or cities
        for (const dir of Object.values(DIRECTIONS)) {
          const ax = checkX + dir.dx, ay = checkY + dir.dy;
          const aiUnitNearby = newUnits.find(u => u.x === ax && u.y === ay && u.owner === 'ai' && !u.aboardId);
          if (aiUnitNearby) {
            console.log(`[CONTACT] Player ${unit.type} at (${checkX},${checkY}) spotted by AI ${aiUnitNearby.type} at (${ax},${ay})`);
            madeContact = true;
            observedByAI = true;
            break;
          }
          // Check for AI cities
          const cityKey = `${ax},${ay}`;
          const cityNearby = newCities[cityKey];
          if (cityNearby && cityNearby.owner === 'ai') {
            console.log(`[CONTACT] Player ${unit.type} at (${checkX},${checkY}) spotted by AI city at (${ax},${ay})`);
            madeContact = true;
            observedByAI = true;
            break;
          }
        }
        
        if (madeContact) {
          setPlayerMadeContact(true);
        }
        
        // BUG #2 FIX: Record observation for AI (equivalent to what player gets)
        if (observedByAI) {
          setPlayerObservations(prev => {
            // Find existing observation for this unit or create new one
            const existingIdx = prev.findIndex(o => o.unitId === unit.id);
            if (existingIdx >= 0) {
              // Extend trail
              const updated = [...prev];
              updated[existingIdx] = {
                ...updated[existingIdx],
                trail: [...updated[existingIdx].trail, { x: checkX, y: checkY }]
              };
              return updated;
            } else {
              // New observation - include starting position if we have it
              return [...prev, {
                unitType: unit.type,
                unitId: unit.id,
                trail: [{ x: startX, y: startY }, { x: checkX, y: checkY }]
              }];
            }
          });
        }
      }
      
      if (!unitDestroyed && unit.movesLeft <= 0) { 
        unit.status = STATUS_USED; 
        // BUG #10 FIX: Update again after status change
        const statusIdx = newUnits.findIndex(u => u.id === unit.id);
        if (statusIdx !== -1) {
          newUnits[statusIdx] = unit;
        }
        return advanceToNextUnit({ ...prev, units: newUnits, cities: newCities, map: newMap }, true); 
      }
      return { ...prev, units: newUnits, cities: newCities, map: newMap };
    });
  }, [activeUnit, gameState, validMoves, advanceToNextUnit]);
  
  const handleEndTurn = useCallback(() => {
    if (!gameState) return;
    setExploredTiles(prev => updateExploredTiles(updateExploredTiles(prev, turnVisibility), currentVisibility));
    setTurnVisibility(new Set());
    setBombardMode(false); // Exit bombard mode on turn end
    
    // Execute AI turn OUTSIDE of setGameState to avoid React Strict Mode double-execution
    let newState = endPlayerTurn(gameState);
    console.log('[Main] Executing AI turn...');
    const aiResult = executeAITurn(newState, aiKnowledge, undefined, playerMadeContact, playerObservations);
    newState = aiResult.state;
    console.log('[Main] AI turn complete');
    
    // Update AI knowledge (outside setGameState)
    setAiKnowledge(aiResult.knowledge);
    
    // Store observations and combat events for display (outside setGameState)
    const hasObservations = aiResult.observations && aiResult.observations.length > 0;
    const hasCombatEvents = aiResult.combatEvents && aiResult.combatEvents.length > 0;
    
    if (hasObservations || hasCombatEvents) {
      console.log(`[Main] ${aiResult.observations?.length || 0} enemy movements observed, ${aiResult.combatEvents?.length || 0} combat events`);
      setAiObservations(aiResult.observations || []);
      setAiCombatEvents(aiResult.combatEvents || []);
      setShowAiSummary(true);
    } else {
      setAiObservations([]);
      setAiCombatEvents([]);
    }
    
    // Reset player contact and observations for next turn
    setPlayerMadeContact(false);
    setPlayerObservations([]);
    
    // BUG #13: Check surrender conditions
    const cities = Object.values(newState.cities);
    const totalCities = cities.length;
    const playerCities = cities.filter(c => c.owner === 'player').length;
    const aiCitiesCount = cities.filter(c => c.owner === 'ai').length;
    const neutralCities = cities.filter(c => c.owner === 'neutral').length;
    
    // AI surrenders if: player has 5x AI cities AND neutral cities can't help AI catch up
    if (aiCitiesCount > 0 && playerCities > aiCitiesCount * 5 && (aiCitiesCount + neutralCities) < playerCities) {
      console.log(`[SURRENDER] AI offers surrender: player ${playerCities}, AI ${aiCitiesCount}, neutral ${neutralCities}`);
      setShowSurrender({
        type: 'ai_surrenders',
        message: 'General, will you accept my surrender?'
      });
    }
    // AI asks player to surrender if: AI controls 70% of cities
    else if (totalCities > 0 && aiCitiesCount / totalCities >= 0.7) {
      console.log(`[SURRENDER] AI demands player surrender: AI controls ${((aiCitiesCount/totalCities)*100).toFixed(0)}% of cities`);
      setShowSurrender({
        type: 'player_surrender',
        message: 'General, you are severely outgunned. Do you wish to surrender?'
      });
    }
    
    const vc = checkVictoryCondition(newState);
    if (vc.status === 'defeat') { 
      setPhase(PHASE_DEFEAT); 
      setGameState(newState);
      return; 
    }
    if (vc.status === 'victory') { 
      setPhase(PHASE_VICTORY); 
      saveToLeaderboard(newState.mapSize, newState.difficulty, newState.turn); 
      setGameState(newState);
      return; 
    }
    
    newState = { ...newState, turn: newState.turn + 1 };
    
    // BUG #4 FIX: Queue units with GoTo/Patrol for auto-move at turn start
    const autoMoveUnits = newState.units.filter(u => 
      u.owner === 'player' && 
      u.movesLeft > 0 && 
      !u.aboardId &&
      (u.status === STATUS_GOTO || u.status === STATUS_PATROL)
    );
    console.log(`[TURN START] Found ${autoMoveUnits.length} units with auto-move orders`);
    
    if (autoMoveUnits.length > 0) {
      // Queue all auto-move units
      const ids = autoMoveUnits.map(u => u.id);
      setAutoMoveQueue(ids.slice(1)); // Rest go in queue
      setAutoMovingUnitId(ids[0]); // Start with first
      setMessage(`Turn ${newState.turn}. Executing auto-moves...`);
    } else {
      const nextId = findNextUnit(newState, null, false);
      if (nextId) { 
        const nu = newState.units.find(u => u.id === nextId); 
        if (nu) centerOnUnit(nu); 
        newState = { ...newState, activeUnitId: nextId }; 
      }
      setMessage(`Turn ${newState.turn}. Your turn.`);
    }
    
    setGameState(newState);
  }, [gameState, currentVisibility, turnVisibility, aiKnowledge, centerOnUnit, playerMadeContact, playerObservations]);
  
  // Resume auto-move for current unit (after enemy spotted)
  const handleResumeAutoMove = useCallback(() => {
    if (!activeUnit || !gameState) return;
    if (activeUnit.status === STATUS_GOTO || activeUnit.status === STATUS_PATROL) {
      if (activeUnit.movesLeft > 0) {
        console.log(`[RESUME] Resuming auto-move for unit ${activeUnit.id}`);
        setAutoMovingUnitId(activeUnit.id);
        setMessage('Resuming movement...');
      }
    }
  }, [activeUnit, gameState]);
  
  // BUG #13: Handle surrender acceptance/rejection
  const handleAcceptSurrender = useCallback(() => {
    if (!showSurrender) return;
    if (showSurrender.type === 'ai_surrenders') {
      // Player accepts AI surrender - show victory message then victory screen
      console.log('[SURRENDER] Player accepted AI surrender');
      setMessage('Then the world is yours.');
      setShowSurrender(null);
      // Small delay to show the message before victory screen
      setTimeout(() => {
        setPhase(PHASE_VICTORY);
        if (gameState) {
          saveToLeaderboard(gameState.mapSize, gameState.difficulty, gameState.turn);
        }
      }, 1500);
    } else if (showSurrender.type === 'player_surrender') {
      // Player surrenders to AI - defeat
      console.log('[SURRENDER] Player surrendered to AI');
      setShowSurrender(null);
      setPhase(PHASE_DEFEAT);
    }
  }, [showSurrender, gameState]);
  
  const handleRejectSurrender = useCallback(() => {
    if (!showSurrender) return;
    if (showSurrender.type === 'ai_surrenders') {
      console.log('[SURRENDER] Player rejected AI surrender - war continues');
      setMessage('You reject their surrender. The war continues!');
    } else {
      console.log('[SURRENDER] Player refuses to surrender - war continues');
      setMessage('You refuse to surrender. Fight on!');
    }
    setShowSurrender(null);
  }, [showSurrender]);
  
  useEffect(() => {
    const handleKey = (e) => {
      if (phase !== PHASE_PLAYING || !gameState) return;
      
      // Don't process keys while auto-moving (except escape)
      if (autoMovingUnitId && e.key.toLowerCase() !== 'escape') return;
      
      const key = e.key.toLowerCase(), numKey = parseInt(e.key);
      if (DIRECTIONS[numKey]) { const { dx, dy } = DIRECTIONS[numKey]; handleMove(dx, dy); return; }
      switch (key) {
        case 'w': if (activeUnit) setGameState(prev => { const i = prev.units.findIndex(u => u.id === activeUnit.id); const nu = [...prev.units]; nu[i] = { ...nu[i], status: STATUS_WAITING, gotoPath: null, patrolPath: null }; return advanceToNextUnit({ ...prev, units: nu }, true); }); break;
        case 'k': if (activeUnit) setGameState(prev => { const i = prev.units.findIndex(u => u.id === activeUnit.id); const nu = [...prev.units]; nu[i] = { ...nu[i], status: STATUS_SKIPPED, gotoPath: null, patrolPath: null }; return advanceToNextUnit({ ...prev, units: nu }, true); }); break;
        case 'n': setGameState(prev => advanceToNextUnit(prev, false)); break;
        case 's': if (activeUnit) { setGameState(prev => { const i = prev.units.findIndex(u => u.id === activeUnit.id); const nu = [...prev.units]; nu[i] = { ...nu[i], status: STATUS_SENTRY, gotoPath: null, patrolPath: null }; return advanceToNextUnit({ ...prev, units: nu }, true); }); setMessage('Unit set to sentry.'); } break;
        case 'g': 
          // If unit has GoTo/Patrol and stopped, 'g' resumes movement
          if (activeUnit && (activeUnit.status === STATUS_GOTO || activeUnit.status === STATUS_PATROL) && activeUnit.movesLeft > 0) {
            handleResumeAutoMove();
            return;
          }
          setGotoMode(!gotoMode); 
          setPatrolMode(false); 
          setBombardMode(false); // Exit bombard mode
          setHoverTarget(null);
          setMessage(gotoMode ? 'GoTo cancelled.' : 'GoTo mode: click destination.'); 
          break;
        case 'p':
          // PATROL FIX: If already in patrol mode with 2+ waypoints, show confirm dialog
          if (patrolMode && patrolWaypoints.length >= 2) {
            setPatrolDistances(calcPatrolDists(patrolWaypoints, activeUnit, gameState));
            setShowPatrolConfirm(true);
            return;
          }
          // If unit has patrol and stopped, 'p' resumes
          if (activeUnit && activeUnit.status === STATUS_PATROL && activeUnit.movesLeft > 0) {
            handleResumeAutoMove();
            return;
          }
          setPatrolMode(!patrolMode); 
          setGotoMode(false); 
          setBombardMode(false); // Exit bombard mode
          setHoverTarget(null);
          if (!patrolMode && activeUnit) { 
            setPatrolWaypoints([{ x: activeUnit.x, y: activeUnit.y }]); 
            setMessage('Patrol mode: click waypoints, then press P again to confirm.'); 
          } else { 
            setPatrolWaypoints([]); 
            setMessage('Patrol cancelled.'); 
          } 
          break;
        // NEW: Bombardment mode toggle
        case 'b':
          if (activeUnit && UNIT_SPECS[activeUnit.type].canBombard && activeUnit.movesLeft > 0) {
            // BOMBARD FIX: Check if already bombarded this turn
            if (activeUnit.hasBombarded) {
              setMessage('This unit has already bombarded this turn.');
              return;
            }
            setBombardMode(!bombardMode);
            setGotoMode(false);
            setPatrolMode(false);
            setPatrolWaypoints([]);
            setHoverTarget(null);
            if (!bombardMode) {
              setMessage('Bombard mode: click visible target at range 2.');
            } else {
              setMessage('Bombard cancelled.');
            }
          } else if (activeUnit && !UNIT_SPECS[activeUnit.type].canBombard) {
            setMessage('This unit cannot bombard.');
          }
          break;
        case 'r':
          // 'R' to resume auto-movement
          handleResumeAutoMove();
          break;
        case 'u': if (activeUnit && (UNIT_SPECS[activeUnit.type].carriesTanks || UNIT_SPECS[activeUnit.type].carriesAir)) { setGameState(prev => { const result = unloadUnit(prev, activeUnit.id); if (result.unloadedCount > 0) setMessage(`Unloaded ${result.unloadedCount} units.`); return result.state; }); } break;
        case 'c': setShowCityList(true); break;
        case 'v': setShowAllUnits(true); break;
        case 'a': if (aiObservations.length > 0) setShowAiSummary(true); break;
        case 'enter':
          // PATROL FIX: Enter in patrol mode with 2+ waypoints confirms patrol
          if (patrolMode && patrolWaypoints.length >= 2) {
            setPatrolDistances(calcPatrolDists(patrolWaypoints, activeUnit, gameState));
            setShowPatrolConfirm(true);
            return;
          }
          handleEndTurn(); 
          break;
        case 'escape': 
          setGotoMode(false); 
          setPatrolMode(false); 
          setBombardMode(false); // Exit bombard mode
          setPatrolWaypoints([]); 
          setHoverTarget(null); 
          setShowCityDialog(null); 
          setShowUnitView(null); 
          setShowCityList(false); 
          setShowAllUnits(false);
          // Stop auto-movement on escape
          if (autoMovingUnitId) {
            setAutoMovingUnitId(null);
            setAutoMoveQueue([]);
            setMessage('Auto-movement cancelled.');
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [phase, gameState, activeUnit, gotoMode, patrolMode, bombardMode, patrolWaypoints, handleMove, handleEndTurn, advanceToNextUnit, autoMovingUnitId, handleResumeAutoMove, aiObservations]);
  
  // BUG #8 FIX: Handle mouse move for goto preview and coordinate display
  const handleTileHover = useCallback((x, y) => {
    setMouseTile({ x, y }); // Always track mouse tile
    if ((gotoMode || patrolMode) && activeUnit) {
      setHoverTarget({ x, y });
    }
  }, [gotoMode, patrolMode, activeUnit]);
  
  const handleTileClick = useCallback((x, y) => {
    if (!gameState) return;
    
    // Don't process clicks while auto-moving
    if (autoMovingUnitId) return;
    
    // NEW: Handle bombardment mode clicks
    if (bombardMode && activeUnit) {
      const target = bombardTargets.find(t => t.x === x && t.y === y);
      if (target) {
        handleBombard(x, y);
      } else {
        setMessage('Invalid target. Must be visible tile at range 2.');
      }
      return;
    }
    
    if (gotoMode && activeUnit) { 
      const path = findPath(activeUnit.x, activeUnit.y, x, y, activeUnit, gameState); 
      if (path?.length > 0) { 
        // BUG #4 FIX: Set goto and start auto-move
        const newState = setUnitGoTo(gameState, activeUnit.id, path);
        setGameState(newState);
        setGotoMode(false); 
        setHoverTarget(null);
        setMessage(`GoTo set: ${path.length} tiles. Moving...`);
        // Start auto-moving
        setAutoMovingUnitId(activeUnit.id);
      } else {
        setMessage('No valid path.'); 
      }
      return; 
    }
    
    if (patrolMode) {
      const newWaypoints = [...patrolWaypoints, { x, y }];
      setPatrolWaypoints(newWaypoints);

      if (activeUnit && newWaypoints.length >= 2) {
        const spec = UNIT_SPECS[activeUnit.type];
        const dists = calcPatrolDists(newWaypoints, activeUnit, gameState);
        if (dists) {
          const segStr = dists.segs.map((d, i) => `WP${i}→WP${i+1}:${d}`).join(', ');
          const estimatedTurns = Math.ceil(dists.total / spec.movement);
          setMessage(`${segStr} | sub:${dists.subtotal} +ret:${dists.returnDist}=Total:${dists.total} (~${estimatedTurns}t). P/Enter to confirm.`);
        }
      }
      return;
    }
    
    if (activeUnit && activeUnit.movesLeft > 0) {
      const move = validMoves.find(m => m.x === x && m.y === y);
      if (move) { handleMove(x - activeUnit.x, y - activeUnit.y); return; }
    }
    const ck = `${x},${y}`; if (gameState.cities[ck]?.owner === 'player') { setShowCityDialog(ck); return; }
    const unitsAt = gameState.units.filter(u => u.x === x && u.y === y && !u.aboardId && (u.owner === 'player' || fog[y]?.[x] === FOG_VISIBLE));
    
    if (unitsAt.length > 0) { 
      setShowUnitView({ x, y }); 
      return; 
    }
  }, [gameState, gotoMode, patrolMode, bombardMode, activeUnit, fog, validMoves, handleMove, patrolWaypoints, autoMovingUnitId, bombardTargets, handleBombard]);
  
  // BUG #4 FIX: Handle patrol confirmation
  const handleConfirmPatrol = useCallback(() => { 
    if (!activeUnit || patrolWaypoints.length < 2 || !gameState) return; 
    
    const newState = setUnitPatrol(gameState, activeUnit.id, patrolWaypoints);
    setGameState(newState);
    setPatrolMode(false); 
    setPatrolWaypoints([]); 
    setShowPatrolConfirm(false);
    setHoverTarget(null);
    setMessage(`Patrol set: ${patrolWaypoints.length} waypoints. Patrolling...`); 
    
    // Start auto-moving
    setAutoMovingUnitId(activeUnit.id);
  }, [activeUnit, patrolWaypoints, gameState]);
  
  const handleMakeActive = useCallback((unitId) => { if (!gameState) return; const u = gameState.units.find(u => u.id === unitId); if (u?.owner === 'player') { setGameState(prev => ({ ...prev, activeUnitId: unitId })); centerOnUnit(u); setShowCityDialog(null); setShowUnitView(null); setShowAllUnits(false); } }, [gameState, centerOnUnit]);
  const handleSelectUnit = useCallback((unit) => { if (!gameState || !unit) return; setViewportX(Math.max(0, Math.min(gameState.width - VIEWPORT_TILES_X, unit.x - Math.floor(VIEWPORT_TILES_X / 2)))); setViewportY(Math.max(0, Math.min(gameState.height - VIEWPORT_TILES_Y, unit.y - Math.floor(VIEWPORT_TILES_Y / 2)))); }, [gameState]);
  const handleSetProduction = useCallback((ck, ut) => { setGameState(prev => setCityProduction(prev, ck, ut)); setMessage(`Production set to ${UNIT_SPECS[ut].name}.`); }, []);
  const handleNavigate = useCallback((x, y) => { if (!gameState) return; setViewportX(Math.max(0, Math.min(gameState.width - VIEWPORT_TILES_X, x))); setViewportY(Math.max(0, Math.min(gameState.height - VIEWPORT_TILES_Y, y))); }, [gameState]);
  const handleSelectCity = useCallback((x, y) => { handleNavigate(x - Math.floor(VIEWPORT_TILES_X / 2), y - Math.floor(VIEWPORT_TILES_Y / 2)); const ck = `${x},${y}`; if (gameState?.cities[ck]?.owner === 'player') setShowCityDialog(ck); setShowCityList(false); }, [handleNavigate, gameState]);
  const handleNewGame = useCallback(() => { setPhase(PHASE_MENU); setGameState(null); }, []);
  
  // Save/Load game handlers
  const handleSaveGame = useCallback(() => {
    setShowSaveDialog(true);
  }, []);
  
  const handleSaveComplete = useCallback(() => {
    setShowSaveDialog(false);
    setMessage('Game saved successfully.');
  }, []);
  
  const handleSaveAndQuit = useCallback(() => {
    setShowSaveDialog(false);
    setPhase(PHASE_MENU);
    setGameState(null);
  }, []);
  
  const handleLoadGame = useCallback((saveData) => {
    console.log('[LoadGame] Loading save:', saveData.filename);
    
    // Restore game state
    setGameState(saveData.gameState);
    
    // Restore explored tiles (convert array back to Set)
    const restoredExplored = new Set(saveData.exploredTiles || []);
    setExploredTiles(restoredExplored);
    
    // Restore AI knowledge - need to convert serialized arrays back to Sets
    const rawAiKnowledge = saveData.aiKnowledge;
    if (rawAiKnowledge) {
      const restoredAiKnowledge = {
        ...rawAiKnowledge,
        // Convert arrays back to Sets (JSON.stringify converts Sets to arrays via our custom serializer)
        exploredTiles: new Set(Array.isArray(rawAiKnowledge.exploredTiles) ? rawAiKnowledge.exploredTiles : []),
        homeIslandTiles: rawAiKnowledge.homeIslandTiles ? new Set(Array.isArray(rawAiKnowledge.homeIslandTiles) ? rawAiKnowledge.homeIslandTiles : []) : null,
        homeIslandCities: new Set(Array.isArray(rawAiKnowledge.homeIslandCities) ? rawAiKnowledge.homeIslandCities : []),
        lostCities: new Set(Array.isArray(rawAiKnowledge.lostCities) ? rawAiKnowledge.lostCities : []),
        knownCities: new Set(Array.isArray(rawAiKnowledge.knownCities) ? rawAiKnowledge.knownCities : []),
        // Also restore island-level Sets (handles old saves where Sets became {} objects)
        islands: (rawAiKnowledge.islands || []).map(island => ({
          ...island,
          tiles: new Set(Array.isArray(island.tiles) ? island.tiles : []),
          cities: new Set(Array.isArray(island.cities) ? island.cities : []),
          coastTiles: new Set(Array.isArray(island.coastTiles) ? island.coastTiles : [])
        }))
      };
      setAiKnowledge(restoredAiKnowledge);
      console.log('[LoadGame] Restored AI knowledge with', restoredAiKnowledge.exploredTiles.size, 'explored tiles');
    } else {
      setAiKnowledge(createAIKnowledge());
    }
    
    // Reset turn visibility (will be recalculated)
    setTurnVisibility(new Set());
    
    // Set phase to playing
    setPhase(PHASE_PLAYING);
    
    // Center on player's first city
    const pCity = Object.values(saveData.gameState.cities).find(c => c.owner === 'player');
    if (pCity) {
      setViewportX(Math.max(0, pCity.x - Math.floor(VIEWPORT_TILES_X / 2)));
      setViewportY(Math.max(0, pCity.y - Math.floor(VIEWPORT_TILES_Y / 2)));
    }
    
    // Reset UI state
    setMessage(`Game loaded: ${saveData.filename}. Turn ${saveData.turn}.`);
    setAutoMovingUnitId(null);
    setAutoMoveQueue([]);
    setBombardMode(false);
    setGotoMode(false);
    setPatrolMode(false);
    setPatrolWaypoints([]);
    setAiObservations([]);
    setAiCombatEvents([]);
    setShowAiSummary(false);
  }, []);
  
  // RENDER
  if (phase === PHASE_MENU) return <MenuScreen onStart={handleStartGame} onLoadGame={handleLoadGame} />;
  if (!gameState) return null;
  
  return (
    <div ref={containerRef} style={{ display: 'flex', gap: '12px', padding: '12px', backgroundColor: COLORS.background, minHeight: '100vh', fontFamily: 'Monaco, monospace', color: COLORS.text }} tabIndex={0}>
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <TurnInfo 
          turn={gameState.turn} 
          phase={phase}
          unitsWaiting={unitsWaiting}
          playerCities={cityCounts.player} 
          aiCities={cityCounts.ai} 
          neutralCities={cityCounts.neutral}
          onEndTurn={handleEndTurn}
          onShowCityList={() => setShowCityList(true)}
          onShowAllUnits={() => setShowAllUnits(true)}
          onShowAiSummary={() => setShowAiSummary(true)}
          onSaveGame={handleSaveGame}
          hasAiObservations={aiObservations.length > 0 || aiCombatEvents.length > 0}
        />
        <UnitInfoPanel unit={activeUnit} units={gameState.units} gameState={gameState} />
        <CommandMenu 
          activeUnit={activeUnit} 
          onCommand={cmd => { 
            const map = { wait: 'w', skip: 'k', next: 'n', sentry: 's', goto: 'g', patrol: 'p', unload: 'u', bombard: 'b' };
            if (map[cmd]) window.dispatchEvent(new KeyboardEvent('keydown', { key: map[cmd] })); 
          }} 
          disabled={!activeUnit || !!autoMovingUnitId} 
          patrolMode={patrolMode}
          bombardMode={bombardMode}
        />
      </div>
      <div style={{ flex: 1 }}>
        <div 
          style={{ position: 'relative', width: VIEWPORT_TILES_X * TILE_WIDTH, height: VIEWPORT_TILES_Y * TILE_HEIGHT, overflow: 'hidden', border: `2px solid ${COLORS.border}` }}
          onMouseLeave={() => setMouseTile(null)}
        >
          {Array.from({ length: VIEWPORT_TILES_Y }).flatMap((_, vy) => Array.from({ length: VIEWPORT_TILES_X }).map((_, vx) => {
            const x = viewportX + vx, y = viewportY + vy;
            if (x >= gameState.width || y >= gameState.height) return null;
            const isValid = validMoves.some(m => m.x === x && m.y === y), isAttack = validMoves.some(m => m.x === x && m.y === y && m.isAttack);
            // NEW: Check if this is a valid bombard target
            const isBombardTarget = bombardMode && bombardTargets.some(t => t.x === x && t.y === y);
            return (
              <Tile 
				map={gameState.map}
                key={`${x}-${y}`} 
                type={gameState.map[y][x]} 
                fogState={fog[y]?.[x] ?? FOG_UNEXPLORED} 
                x={x} 
                y={y} 
                isValidMove={isValid || isBombardTarget} 
                isAttack={isAttack || isBombardTarget} 
                onClick={() => handleTileClick(x, y)} 
                onMouseEnter={() => handleTileHover(x, y)}
                style={{ position: 'absolute', left: vx * TILE_WIDTH, top: vy * TILE_HEIGHT }} 
              />
            );
          }))}
          {(() => {
            const visibleUnits = gameState.units
              .filter(u => !u.aboardId && u.x >= viewportX && u.x < viewportX + VIEWPORT_TILES_X && u.y >= viewportY && u.y < viewportY + VIEWPORT_TILES_Y && (u.owner === 'player' || fog[u.y]?.[u.x] === FOG_VISIBLE))
              .sort((a, b) => (a.id === gameState.activeUnitId ? 1 : 0) - (b.id === gameState.activeUnitId ? 1 : 0));
            // Per-tile stack counts and top unit (last in sorted order wins visually)
            const tileStack = {};
            const tileTop = {};
            for (const u of visibleUnits) {
              const k = `${u.x},${u.y}`;
              tileStack[k] = (tileStack[k] || 0) + 1;
              tileTop[k] = u.id;
            }
            return visibleUnits.map(u => (
              <div key={u.id} style={{ position: 'absolute', left: (u.x - viewportX) * TILE_WIDTH, top: (u.y - viewportY) * TILE_HEIGHT, pointerEvents: 'none' }}>
                <UnitSprite unit={u} isActive={u.id === gameState.activeUnitId} blink={blink} cargoCount={getCargoCount(u.id, gameState.units)} stackCount={tileTop[`${u.x},${u.y}`] === u.id ? tileStack[`${u.x},${u.y}`] : 0} />
              </div>
            ));
          })()}
          {(gotoMode || dragging) && previewTarget && activeUnit && gotoPreview && <GotoLineOverlay sx={getUnitLocation(activeUnit, gameState.units).x} sy={getUnitLocation(activeUnit, gameState.units).y} ex={previewTarget.x} ey={previewTarget.y} vx={viewportX} vy={viewportY} dist={gotoPreview.dist} turns={gotoPreview.turns} />}
          {patrolMode && patrolWaypoints.length > 0 && <PatrolOverlay waypoints={patrolWaypoints} vx={viewportX} vy={viewportY} />}
          {/* BUG #2 FIX: Render observation trails from AI turn */}
          {aiObservations.length > 0 && aiObservations.map((obs, obsIdx) => (
            <svg key={`obs-${obsIdx}`} style={{ position: 'absolute', left: 0, top: 0, width: VIEWPORT_TILES_X * TILE_WIDTH, height: VIEWPORT_TILES_Y * TILE_HEIGHT, pointerEvents: 'none' }}>
              {obs.trail.map((pos, idx) => {
                if (idx === 0) return null;
                const prev = obs.trail[idx - 1];
                const x1 = (prev.x - viewportX + 0.5) * TILE_WIDTH;
                const y1 = (prev.y - viewportY + 0.5) * TILE_HEIGHT;
                const x2 = (pos.x - viewportX + 0.5) * TILE_WIDTH;
                const y2 = (pos.y - viewportY + 0.5) * TILE_HEIGHT;
                return (
                  <g key={idx}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(200, 60, 60, 0.8)" strokeWidth="3" strokeLinecap="round" />
                    {/* Arrow head */}
                    <circle cx={x2} cy={y2} r={4} fill="rgba(200, 60, 60, 0.9)" />
                  </g>
                );
              })}
              {/* Start marker */}
              {obs.trail.length > 0 && (
                <rect 
                  x={(obs.trail[0].x - viewportX) * TILE_WIDTH + 2} 
                  y={(obs.trail[0].y - viewportY) * TILE_HEIGHT + 2} 
                  width={TILE_WIDTH - 4} 
                  height={TILE_HEIGHT - 4} 
                  fill="none" 
                  stroke="rgba(200, 60, 60, 0.9)" 
                  strokeWidth="2" 
                  strokeDasharray="4,2"
                />
              )}
            </svg>
          ))}
        </div>
      </div>
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <MiniMap map={gameState.map} fog={fog} units={gameState.units} width={gameState.width} height={gameState.height} viewportX={viewportX} viewportY={viewportY} onNavigate={handleNavigate} exploredPercent={exploredPercent} />
        {/* BUG #8: Combined messages and coordinates panel - reduced height */}
        <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: COLORS.textMuted }}>Messages</div>
            {mouseTile && (
              <div style={{ fontSize: '9px', color: COLORS.highlight, fontFamily: 'monospace' }}>
                ({mouseTile.x},{mouseTile.y})
              </div>
            )}
          </div>
          <div style={{ fontSize: '10px', color: COLORS.text, lineHeight: 1.4, minHeight: '28px' }}>{message}</div>
        </div>
        <div style={{ backgroundColor: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: '8px', fontSize: '9px', color: COLORS.textMuted }}><div style={{ marginBottom: '4px', fontWeight: '600' }}>Keys:</div><div>W=Wait K=Skip N=Next</div><div>S=Sentry G=GoTo P=Patrol</div><div>U=Unload C=Cities V=Units</div><div>B=Bombard R=Resume A=AI</div><div>Enter=End Turn</div></div>
      </div>
      {showCityDialog && <CityProductionDialog city={gameState.cities[showCityDialog]} cityKey={showCityDialog} map={gameState.map} width={gameState.width} height={gameState.height} units={gameState.units} fogArray={fog} onClose={() => setShowCityDialog(null)} onSetProduction={handleSetProduction} onMakeActive={handleMakeActive} />}
      {showUnitView && <UnitViewDialog x={showUnitView.x} y={showUnitView.y} map={gameState.map} width={gameState.width} height={gameState.height} units={gameState.units} fogArray={fog} onClose={() => setShowUnitView(null)} onMakeActive={handleMakeActive} />}
      {showCityList && <CityListDialog cities={gameState.cities} units={gameState.units} onClose={() => setShowCityList(false)} onSelectCity={handleSelectCity} />}
      {showAllUnits && <AllUnitsListDialog units={gameState.units} map={gameState.map} width={gameState.width} height={gameState.height} fogArray={fog} onClose={() => setShowAllUnits(false)} onSelectUnit={handleSelectUnit} onMakeActive={handleMakeActive} />}
      {showPatrolConfirm && <PatrolConfirmDialog waypoints={patrolWaypoints} segmentDistances={patrolDistances} onConfirm={handleConfirmPatrol} onCancel={() => { setShowPatrolConfirm(false); setPatrolMode(false); setPatrolWaypoints([]); setPatrolDistances(null); }} />}
      {showAiSummary && (aiObservations.length > 0 || aiCombatEvents.length > 0) && (
        <AITurnSummaryDialog 
          observations={aiObservations}
          combatEvents={aiCombatEvents}
          onContinue={() => setShowAiSummary(false)}
          onCenterOn={(pos) => {
            setViewportX(Math.max(0, Math.min(gameState.width - VIEWPORT_TILES_X, pos.x - Math.floor(VIEWPORT_TILES_X / 2))));
            setViewportY(Math.max(0, Math.min(gameState.height - VIEWPORT_TILES_Y, pos.y - Math.floor(VIEWPORT_TILES_Y / 2))));
          }}
        />
      )}
      {showSurrender && (
        <SurrenderDialog 
          message={showSurrender.message}
          onYes={handleAcceptSurrender}
          onNo={handleRejectSurrender}
        />
      )}
      {showSaveDialog && (
        <SaveGameDialog 
          gameState={gameState}
          exploredTiles={exploredTiles}
          aiKnowledge={aiKnowledge}
          onSave={handleSaveComplete}
          onSaveAndQuit={handleSaveAndQuit}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
      {phase === PHASE_VICTORY && <VictoryDialog turn={gameState.turn} mapSize={gameState.mapSize} difficulty={gameState.difficulty} onNewGame={handleNewGame} />}
      {phase === PHASE_DEFEAT && <DefeatDialog onNewGame={handleNewGame} />}
    </div>
  );
}

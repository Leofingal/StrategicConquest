// ============================================================================
// STRATEGIC CONQUEST - AI OBSERVER MODULE
// ============================================================================
// Thin wrapper — delegates entirely to the real AI engine in ai-opponent.js.
// The full pipeline (assignExplorationMissions, assignTacticalMissions,
// executeStepByStepMovements) runs on player units via an owner-swap trick:
// player↔ai owners are swapped so the AI engine drives player units naturally,
// then swapped back to restore the real game state.

export { createObserverKnowledge, executeObserverTurn } from './ai-opponent.js';

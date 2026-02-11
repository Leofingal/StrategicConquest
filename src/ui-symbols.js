// ============================================================================
// STRATEGIC CONQUEST - UI SYMBOLS
// ============================================================================
// Centralized Unicode symbol definitions using escape sequences.
// This prevents UTF-8 encoding corruption when files pass through
// different editors, copy/paste, or Git with encoding mismatches.
//
// USAGE:
//   import { SYMBOLS } from './ui-symbols.js';
//   <button>{SYMBOLS.CLOSE}</button>
//   `Trail: ${points.join(` ${SYMBOLS.ARROW_RIGHT} `)}`
//
// RULE: Never use literal Unicode characters in source files.
//       Always use SYMBOLS.XXX constants from this file.
// ============================================================================

export const SYMBOLS = {
  // Navigation & Movement
  ARROW_RIGHT: '\u2192',   // → movement trails
  ARROW_LEFT:  '\u2190',   // ← navigation
  ARROW_UP:    '\u2191',   // ↑ navigation
  ARROW_DOWN:  '\u2193',   // ↓ navigation

  // Actions & Status
  CLOSE:       '\u00D7',   // × delete/close buttons
  DELETE:      '\u00D7',   // × alias for CLOSE
  CHECK:       '\u2713',   // ✓ success indicators
  CROSS:       '\u2717',   // ✗ failure indicators

  // Ratings & Markers
  STAR_FILLED: '\u2605',   // ★ filled star
  STAR_EMPTY:  '\u2606',   // ☆ empty star

  // Combat
  VS:          'VS',       // VS combat display (plain text, no Unicode needed)

  // Punctuation & Formatting
  BULLET:      '\u2022',   // • list items
  ELLIPSIS:    '\u2026',   // … truncation
  DASH:        '\u2014',   // — em dash
  MULTIPLY:    '\u00D7',   // × multiplication (same as CLOSE glyph)
};

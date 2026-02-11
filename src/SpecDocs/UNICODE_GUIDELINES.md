# Unicode Guidelines for Strategic Conquest

## The Problem

This project has experienced UTF-8 encoding corruption where Unicode symbols like `×`, `→`, `★` become garbled text like `Ãƒâ€"`. This happens when files pass through different text editors, copy/paste operations, or Git with encoding mismatches.

## The Solution

All Unicode symbols used in this project should be defined using **Unicode escape sequences** in the centralized `ui-symbols.js` file.

## How to Use

### 1. Import SYMBOLS

```javascript
import { SYMBOLS } from './ui-symbols.js';
```

### 2. Use in JSX

```jsx
// Delete button
<button onClick={onDelete}>{SYMBOLS.CLOSE}</button>

// Combat display
<div>{SYMBOLS.VS}</div>

// Movement trail
<span>({from.x},{from.y}) {SYMBOLS.ARROW_RIGHT} ({to.x},{to.y})</span>

// Star rating
<span>{SYMBOLS.STAR_FILLED}</span>
```

### 3. Use in Template Literals

```javascript
const trail = points.map(p => `(${p.x},${p.y})`).join(` ${SYMBOLS.ARROW_RIGHT} `);
```

## Available Symbols

| Constant | Character | Unicode | Use Case |
|----------|-----------|---------|----------|
| `ARROW_RIGHT` | → | \u2192 | Movement trails |
| `ARROW_LEFT` | ← | \u2190 | Navigation |
| `CLOSE` / `DELETE` | × | \u00D7 | Delete/close buttons |
| `STAR_FILLED` | ★ | \u2605 | Ratings, markers |
| `STAR_EMPTY` | ☆ | \u2606 | Empty ratings |
| `CHECK` | ✓ | \u2713 | Success indicators |
| `CROSS` | ✗ | \u2717 | Failure indicators |
| `VS` | VS | (text) | Combat display |
| `BULLET` | • | \u2022 | List items |
| `ELLIPSIS` | … | \u2026 | Truncation |

See `ui-symbols.js` for the complete list.

## DO NOT

❌ **Never** use literal Unicode characters directly in source files:
```jsx
// BAD - will get corrupted
<button>×</button>
<span>→</span>
```

❌ **Never** copy/paste special characters from external sources

❌ **Never** type special characters using keyboard shortcuts

## DO

✅ **Always** use the SYMBOLS constants:
```jsx
// GOOD - safe from encoding issues
<button>{SYMBOLS.CLOSE}</button>
<span>{SYMBOLS.ARROW_RIGHT}</span>
```

✅ **Always** import from ui-symbols.js for any special characters

✅ If you need a new symbol, add it to ui-symbols.js with its Unicode escape

## Adding New Symbols

1. Find the Unicode code point (e.g., U+2192 for →)
2. Add to `ui-symbols.js`:
```javascript
NEW_SYMBOL: '\u2192',  // → description
```
3. Use via `SYMBOLS.NEW_SYMBOL`

## Environment Setup (Prevention)

To minimize future encoding issues:

### VS Code Settings
```json
{
  "files.encoding": "utf8",
  "files.autoGuessEncoding": false
}
```

### .editorconfig (project root)
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
```

### Git Config
```bash
git config --global core.autocrlf input
```

## Files Using SYMBOLS

- `ui-components.jsx` - Star markers, unit displays
- `dialog-components.jsx` - Combat VS, delete buttons, movement trails
- Add your file here when using SYMBOLS

## Troubleshooting

If you see garbled characters like `Ãƒâ€"`:
1. Identify the intended character
2. Replace with appropriate `SYMBOLS.XXX` constant
3. If constant doesn't exist, add it to `ui-symbols.js`

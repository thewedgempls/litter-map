# CLAUDE.md

## Architecture

Three files: `litter-map.html` (structure), `litter-map.js` (all logic), `litter-map.css` (styles). Everything intentionally lives in these files with no bundler or framework.

### Data layer (`db` object)
All persistence goes through the `db` object (currently `localStorage`). Never call `localStorage` directly. The migration path to Firestore is documented in the `DATA LAYER` comment block at the top of `litter-map.js` — every `db.*` call maps to a specific Firestore operation.

### Map layers
Three Leaflet layer groups on the map:
- `rl` — report circle markers
- `pl` — pulse rings (green halos on affected reports during cleanup preview)
- `dl` — draw points and route/area preview shapes

### Mode system
`setMode('report' | 'area' | 'route')` switches the entire UI. It sets two CSS variables on `documentElement`:
- `--mode-color` — drives header border, active tab, badge, and Submit button
- `--mode-glow` — used for box-shadow/glow effects

### Dialog system
All in-map dialogs use `L.popup` anchored to a lat/lng — never `window.confirm`/`alert` (blocked in iframe embeds). State is tracked in JS variables (`dialogState`, `dialogReportId`, `currentPopup`, etc.), never in popup DOM. The dark-scrim `#modal-overlay` is used only for the cleanup Submit confirmation.

Dialog state machine rules:
- Any map click outside a marker closes the active dialog
- Clicking a different report while an action dialog is open **replaces** it with the new report's dialog
- Clicking the same report again **toggles** the dialog closed
- Clicking any report while a **confirmation** dialog is open closes the dialog but does NOT open a new one
- "Still Here" and "Mark Cleaned" each require two sequential dialogs: (1) action selector, (2) confirmation

Two known fixes prevent dialog regressions:
- `autoPan` is disabled on the popup during `setContent` calls to prevent Leaflet's pan adjustment from moving the popup under the user's still-active touch
- `suppressDismiss` is set for 150 ms when opening a confirmation popup, so the follow-on synthetic click doesn't immediately close it

### Proximity (`CFG.proximity`)
`CFG.proximity` (5 metres) serves double duty: it's the dedup radius for new report taps (tapping within 5 m of an existing report offers to reset its age) AND the corridor buffer for Route Cleanup (reports within 5 m of the drawn polyline are highlighted and removed on submit).

### Pulse layer diffing
`updateAffected()` diffs `affectedIds` against the currently-rendered pulse rings rather than calling `pl.clearLayers()`. **Never call `pl.clearLayers()` inside the draw/drag loop** — it destroys SVG elements and resets CSS animation phases, making pulse rings start over on every drag frame.

### Undo history
`history` is a stack of `{type:'add'|'drag', ...}` entries. Drag moves push `{type:'drag', idx, from}` in `startDrag()` before modifying anything, so undo can restore the previous position.

## Key constraints

- **No `pl.clearLayers()` in draw/drag loops** — resets pulse animation phases.
- **No `window.confirm`/`alert`** — blocked in iframe embeds; use `L.popup` or `#modal-overlay`.
- **No direct `localStorage` calls** — go through `db` so Firestore migration stays clean.
- **No state in popup DOM** — popup content is rebuilt as HTML strings on each open; all state lives in JS variables.

# Wedge Litter Map

A web app for the [Wedge neighborhood](https://thewedge.org) in Minneapolis, MN. Volunteers and residents use it to report litter across the neighborhood and plan and track clean-up efforts.

## Running the app

No build step required. Open `index.html` directly in a browser (`file://` or a local HTTP server). The app is self-contained: HTML references `litter-map.css` and `litter-map.js`, plus Leaflet 1.9.4 from cdnjs.

CartoDB Voyager tiles work fine when opening locally — the CORS/referrer restriction only affects sandboxed `<iframe>` embeds (e.g. no-code platforms with restrictive CSP).

## Building minified assets

Minified files are written to `docs/` using Terser (JS), clean-css (CSS), and html-minifier-terser (HTML).

```bash
npm install       # first time only
npm run build
```

Output: `docs/litter-map.js`, `docs/litter-map.css`, `docs/index.html`.

## Architecture

Three source files: `index.html` (structure), `litter-map.js` (all logic), `litter-map.css` (styles). Everything intentionally lives in these files with no bundler or framework.

## Brand / design

- **Colors**: teal `#4fbfbc` (report mode), amber `#d97706` (area cleanup), purple `#7c3aed` (route cleanup). Dark text `#1a3534`, body `#6b7c7b`, border `#cce0df`, surface `#f3f8f7`.
- **Fonts**: Bree Serif (headings, popup titles), Open Sans (body/UI). Loaded from Google Fonts.
- **Logo**: hotlink-protected at `thewedge.org`; falls back to inline SVG wedge icon automatically via `onerror`.
- **Wordmark pattern**: lowercase "the", uppercase "WEDGE" in Bree Serif.

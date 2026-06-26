# Wedge Litter Map — Frontend

## Architecture

To keep it simple, there's no bundler or framework for this project. It's just an HTML file, a stylesheet, and some vanilla Javascript. NPM is used solely to produce minified files that are optimized for hosting in production.

## Running the app

Open `index.html` directly in a browser. No need to build anything if you're just debugging.

## Building minified assets

Minified files are written to `docs/` using Terser (JS), clean-css (CSS), and html-minifier-terser (HTML).

```bash
npm install       # first time only
npm run build
```

Output: `docs/litter-map.js`, `docs/litter-map.css`, `docs/index.html`.

## Brand / design

- **Colors**: teal `#4fbfbc` (report mode), amber `#d97706` (area cleanup), purple `#7c3aed` (route cleanup). Dark text `#1a3534`, body `#6b7c7b`, border `#cce0df`, surface `#f3f8f7`.
- **Fonts**: Bree Serif (headings, popup titles), Open Sans (body/UI). Loaded from Google Fonts.
- **Logo**: hotlink-protected at `thewedge.org`; falls back to inline SVG placeholder automatically via `onerror`.

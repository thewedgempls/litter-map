# Wedge Litter Map — Frontend

## Architecture

To keep it simple, there's no bundler or framework for this project. It's just an HTML file, a stylesheet, and some vanilla Javascript. NPM is used solely to produce minified files that are optimized for hosting in production.

## Running the app

Open `index.html` directly in a browser. No need to build anything if you're just debugging.

## Building minified assets

Minified files are written to `dist/` using Terser (JS), clean-css (CSS), and html-minifier-terser (HTML).

```bash
npm install       # first time only
npm run build
```

Output: `dist/litter-map.js`, `dist/litter-map.css`, `dist/index.html`.

## Deployment

The frontend is hosted on GitHub Pages. Deployment is automated via `.github/workflows/deploy-frontend.yml`:

- **Trigger**: any push to `main` that touches `frontend/**`, or manually via `workflow_dispatch`.
- **Build job**: runs `npm ci` and `npm run build`, then uploads `frontend/dist/` as the Pages artifact.
- **Deploy job**: deploys the artifact to the `github-pages` environment.

Only one deployment runs at a time; in-progress deploys are never cancelled (the site is left in a working state).

To deploy manually, go to **Actions → Deploy to GitHub Pages → Run workflow** in the GitHub UI.

## Brand / design

- **Colors**: teal `#4fbfbc` (report mode), amber `#d97706` (area cleanup), purple `#7c3aed` (route cleanup). Dark text `#1a3534`, body `#6b7c7b`, border `#cce0df`, surface `#f3f8f7`.
- **Fonts**: Bree Serif (headings, popup titles), Open Sans (body/UI). Loaded from Google Fonts.
- **Logo**: hotlink-protected at `thewedge.org`; falls back to inline SVG placeholder automatically via `onerror`.

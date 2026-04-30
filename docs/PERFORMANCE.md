# Performance & Asset Optimization

## Lazy Loading
Route-level code splitting is implemented in [App.tsx](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/App.tsx) using `React.lazy()` and `Suspense`.

Additional guideline:
- Prefer lazy loading heavy feature areas (maps, analytics) behind routes and feature toggles.

## Compressed Assets
This project is configured to generate pre-compressed assets (gzip + brotli) during builds via Vite.

Server-side delivery of `.br` / `.gz` should be handled by your production reverse proxy (recommended) or by the Node server when serving `dist/`.

## Images
- Use `loading="lazy"` and `decoding="async"` for non-critical images.
- Prefer SVG for logos and icons when possible.


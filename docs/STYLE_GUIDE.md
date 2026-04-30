# Agri Cloud UI Style Guide (v1)

## Principles
- Minimal surface treatment: clean backgrounds, subtle borders, shallow shadows.
- Clear hierarchy: consistent typography scale and spacing rhythm.
- Accessible by default: visible focus, keyboard navigation, sufficient contrast.
- Responsive layouts: fluid grids, consistent breakpoints, mobile-first decisions.

## Design Tokens
Tokens are defined as CSS variables in [index.css](file:///c:/Users/mohamed.abass.WUSOOM/Downloads/RAK/D/Map/Logo/ESRI/Map/Agri/src/index.css).

### Color
- `--ds-color-bg`: application background
- `--ds-color-surface`: primary surface (cards, panels)
- `--ds-color-surface-2`: secondary surface (hover, subtle fills)
- `--ds-color-text`: primary text
- `--ds-color-text-muted`: secondary text
- `--ds-color-border`: default border
- `--ds-color-primary`: primary action / brand accent
- `--ds-color-danger`: destructive actions
- `--ds-color-info`: links / informational elements

### Radius
- `--ds-radius-sm`: small controls
- `--ds-radius-md`: cards and panels
- `--ds-radius-lg`: modals and large surfaces

### Shadow
- `--ds-shadow-sm`: subtle elevation for cards and sticky bars
- `--ds-shadow-md`: elevated hover states
- `--ds-shadow-lg`: modals

### Spacing
Use `--ds-space-*` tokens as the base spacing rhythm (4/8/12/16/20/24/32).

## Typography
- Font family: `--ds-font-sans`
- Default line-height: `1.5`
- Preferred patterns:
  - Page title: 18–22px, weight 800–900
  - Section title: 13–15px, weight 800–900
  - Body: 13–14px, weight 400–600
  - Helper text: 12–13px, use `--ds-color-text-muted`

## Components (CSS Classes)
These classes are the baseline styling primitives:
- Buttons: `.ds-btn`, `.ds-btn-primary`, `.ds-btn-danger`, `.ds-btn-ghost`
- Inputs: `.ds-input`, `.ds-textarea`, `.ds-label`
- Cards: `.ds-card`, `.ds-card-pad`
- Badges: `.ds-badge`
- Modals: `.ds-modal-overlay`, `.ds-modal`, `.ds-modal-header`, `.ds-modal-body`, `.ds-modal-actions`

## Layout & Responsiveness
- Prefer `minmax(0, 1fr)` in grids to avoid overflow in flex/grid layouts.
- Avoid fixed heights in content; use `min-height: 0` for scrollable flex children.

## Accessibility
- Focus: rely on `:focus-visible` styles (global focus ring in `index.css`).
- Keyboard: dialogs and menus must be reachable and operable without a mouse.
- Color contrast: ensure text meets WCAG AA contrast on backgrounds.
- Motion: animations/transitions honor `prefers-reduced-motion`.


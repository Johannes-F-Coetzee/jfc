# Project Guidelines

## Project structure

- This is a static GitHub Pages site. Keep it dependency-free and use browser-native HTML, CSS, and JavaScript unless a task requires otherwise.
- Workout tracker pages and their shared assets live in `fitness/`. Read `README.md` for setup, data formats, and publishing details.
- Keep configuration and workout data in their existing files (`fitness/config.js` and `fitness/routines.json`); never commit credentials or tokens.

## Code style

- Use two-space indentation, semicolons, double-quoted JavaScript strings.
- ALWAYS use descriptive variable names and NOT ACRONYMS in your code.
- Always use variable names with `camelCase` identifiers and `UPPER_SNAKE_CASE` for module-level constants.
- Keep JavaScript page scripts inside their existing IIFEs with `"use strict"`; prefer `const` and use `let` only for reassigned bindings.
- Always use braces for `if`, `else`, loops, and other control-flow bodies, including single-statement bodies. Keep `else` with its closing brace. Always separate control-flow blocks from surrounding code with blank lines.
- Separate logical blocks with blank lines, but avoid adding blank lines between every statement.
- Always separate return statements from logical blocks with blank lines.
- Keep functions small and focused, and prefer early returns to reduce nesting.
- Preserve the existing HTML conventions: lowercase semantic elements, two-space indentation, and double-quoted attributes. Use kebab-case for CSS classes and custom properties; reuse shared styles in `fitness/styles.css`.
- Reuse nearby helpers and patterns. Use `textContent` for plain text; escape dynamic values when building HTML strings.

## Behavior and validation

- Preserve the static-site architecture, existing local-storage data shapes, form field mappings, and accessibility behavior unless the task explicitly changes them.
- There is no configured build or automated test runner. For JavaScript changes, run `node --check` on the edited scripts and inspect `git diff --check`; for browser behavior, serve the repository locally with `python -m http.server 8000` and test the affected page.
- Keep changes focused, and report any manual verification that could not be performed.

## Responsive Design Instructions

Design and test all pages to work seamlessly across different screen sizes. Use CSS media queries and mobile-first approach to ensure optimal user experience on all devices.

### Phone (Mobile) — Under 640px
- Single-column layout with full-width elements.
- Stack navigation vertically or use collapsible menus.
- Increase touch target sizes (minimum 44×44px for buttons).
- Reduce padding and margins to save screen space.
- Use readable font sizes (minimum 16px for body text).
- Hide non-essential content or move it behind toggles.
- Stack form fields vertically without side-by-side layouts.
- Optimize images for mobile bandwidth (use smaller images or lazy loading).

### Tablet — 640px to 1024px
- Two-column layout where appropriate, or single-column with wider content areas.
- Display compact navigation bars or side navigation sidebars.
- Increase padding and margins moderately for better content spacing.
- Optimize table layouts for touch (wider columns, scroll horizontally if needed).
- Allow some elements to display side-by-side when they fit comfortably.
- Maintain readable font sizes (14px–18px for body text).
- Consider hybrid navigation that adapts between phone and desktop layouts.

### Laptop — 1024px to 1920px
- Multi-column layouts with sidebar navigation or top navigation.
- Display full-featured content areas with adequate whitespace.
- Use standard padding and margins for professional appearance.
- Display tables and grids with full content visible.
- Use larger, more prominent typography and imagery.
- Show optional features and advanced controls.
- Optimize for mouse/keyboard interaction with hover states.

### PC/Desktop — 1920px and above
- Full-width layouts with maximum content width constraints (typically 1200–1400px) to prevent overly long lines.
- Use multi-column layouts, side panels, and modals for content organization.
- Display all content and features without compromise.
- Use generous whitespace and visual hierarchy for clarity.
- Implement hover states, tooltips, and interactive elements.
- Support keyboard shortcuts and accessibility features.
- Consider fixed headers, footers, and sticky navigation.

### General Responsive Best Practices
- Use viewport meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Test all breakpoints using browser DevTools or local testing.
- Ensure touch-friendly interactive elements on mobile devices.
- Use flexible units (%, `em`, `rem`, `vw`) instead of fixed pixel widths where possible.
- Optimize performance: lazy-load images, minimize CSS/JavaScript, use efficient selectors.
- Maintain consistent branding and user experience across all device sizes.
- Always test form submission, navigation, and core functionality on each breakpoint.

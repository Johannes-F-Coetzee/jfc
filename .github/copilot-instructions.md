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

---
type: design-system
scope: ["demo-app/src/components/**", "demo-app/src/styles/**"]
---
# Design system

- All colours come from tokens in `demo-app/src/styles/tokens.css`. No hex values in components.
- Positive deltas use `--color-positive`, negative deltas use `--color-negative`.
  Never rely on colour alone: pair with a sign (+/−) or icon.
- Money is always formatted with `formatMoney` from `components/Table.tsx`.
- Tables: numbers right-aligned, first column left-aligned. Use `Table`, do not build raw tables.
- Locked (read-only) cells use the `.cell-locked` class.
- Text must meet WCAG AA contrast (4.5:1) against its background.

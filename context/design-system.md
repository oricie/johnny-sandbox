---
type: design-system
scope: ["demo-app/src/components/**", "demo-app/src/styles/**"]
---
# Design system

- All colours come from tokens in `demo-app/src/styles/tokens.css`. No hex values in components.
- Severity uses the `--color-sev-*` tokens. Never rely on colour alone: always show the severity word too.
- Use `Table` for lists of records; do not build raw tables. First column left-aligned.
- Use `Badge` for status and severity labels.
- Muted or collapsed rows use `--color-row-muted`.
- Text must meet WCAG AA contrast (4.5:1) against its background.

## Branching Model

- `main`: production-ready, CI-protected
- `dev`: main development branch
- `feature/*`: short-lived branches off `dev` (e.g., `feature/signal-backtest`)
- All changes must go through PRs → `dev`
- Only approved, stable PRs go `dev` → `main`

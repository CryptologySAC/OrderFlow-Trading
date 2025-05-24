![CI](https://github.com/CryptologySAC/OrderFlow-Trading/actions/workflows/ci.yml/badge.svg)

# OrderFlow

Trading signals based on order flow from a live Binance Stream

## Local Requirements

Before pushing any code:

1. Run `yarn check` to validate lint, build, and test.
2. Never commit failing code — all checks must pass.
3. PRs must be reviewed by a teammate.

## Pre-commit Hooks

Hooks are installed via [husky](https://typicode.github.io/husky/).  
They will auto-run `lint`, `test`, and `prettier` before commit/push.

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

## LLM Signal Analysis

Set `LLM_API_KEY` in your environment to enable LLM powered signal explanations.
Optionally override the model with `LLM_MODEL`.

```ts
import { analyzeSignal } from "./src/services/llmSignalAnalyzer";
import { getLoggedSignals } from "./src/services/signalLogger"; // your code

const lastSignal = getLoggedSignals().at(-1);
if (lastSignal) {
    const explanation = await analyzeSignal(lastSignal);
    console.log(explanation);
}
```

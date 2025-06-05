# ExhaustionDetector

## Overview

The `ExhaustionDetector` is a **modular, memory-safe, high-precision TypeScript class** for **real-time detection of exhaustion events** in cryptocurrency orderflow using Binance Spot WebSocket trade and order book data.
It is designed for **intraday and quantitative traders** who want to systematically identify market points where aggressive market orders fully deplete passive liquidity, often signaling imminent reversals, traps, or high-probability moves.

**Key features:**

- **Pure orderflow-based signal generation** (no candles or moving averages)
- **Advanced spoofing detection** to filter out fake liquidity events
- **Adaptive zone sizing, multi-zone logic, passive volume and refill tracking**
- **Price response/confirmation logic** for actionable, not hypothetical, signals
- **Auto-calibration, robust event logging, and research-ready architecture**
- **Plug-in, feature-flag-driven modules via shared `utils.ts`**
- **Supports research into both “exhaustion” and “absorption” with flexible event type**

---

## What Is Exhaustion?

**Exhaustion** is an orderflow event where aggressive market orders on one side (e.g., buy) “clean out” all available passive liquidity on the opposite side (e.g., sell offers disappear, no more ask wall).
The orderbook “runs out” of liquidity, and price often pauses, reverses, or whipsaws as liquidity dries up and market orders can no longer find a match.

- **Bullish exhaustion:** All ask liquidity is taken; buyers “clean out the book” at a local high, often preceding a reversal down.
- **Bearish exhaustion:** All bid liquidity is taken; sellers “clean out the book” at a local low, often preceding a reversal up.

**True exhaustion** signals that a move is likely done—momentum dries up, and a “trap” or inflection point is likely.

---

## What Does the Detector Do?

- **Processes every trade and orderbook update** for your chosen symbol.
- **Clusters trades by price/zone and aggregates aggressive market volume.**
- **Detects exhaustion events:**

    - Large aggressive flow _completely_ removes all passive liquidity at a price/zone (opposite side hits zero).
    - Spoofing (pulled liquidity) is detected and filtered out.

- **Signals “pending” exhaustion** and tracks price response:

    - **Confirms** the event if price reacts favorably by a set number of ticks within a window (and does not retest too deeply).
    - **Invalidates** if price retests/undoes the move or fails to react in time.

- **Logs all signals, confirmations, and invalidations** for later statistical analysis.

---

## Example Usage

```ts
import { ExhaustionDetector } from "./exhaustionDetector.js";
import { SignalLogger } from "./signalLogger.js";

const onExhaustion = (data) => {
    console.log("Exhaustion signal:", data);
};

const logger = new SignalLogger("exhaustion_log.csv");

const detector = new ExhaustionDetector(
    onExhaustion,
    {
        windowMs: 90000,
        minAggVolume: 600,
        pricePrecision: 2,
        zoneTicks: 3,
        minInitialMoveTicks: 12,
        confirmationTimeoutMs: 60000,
        maxRevisitTicks: 5,
        features: {
            spoofingDetection: true,
            adaptiveZone: true,
            passiveHistory: true,
            multiZone: true,
            autoCalibrate: true,
        },
        symbol: "LTCUSDT",
    },
    logger
);

// Feed with trades and depth from Binance Spot
detector.addTrade(tradeMsg);
detector.addDepth(orderBookMsg);
```

---

## Settings & Parameters

| Name                    | Type     | Description                                                         | Typical Value |
| ----------------------- | -------- | ------------------------------------------------------------------- | ------------- |
| `windowMs`              | `number` | Trade lookback window (ms) for detection                            | `90000` (90s) |
| `minAggVolume`          | `number` | Minimum aggressive (market) volume to qualify for exhaustion        | `600`         |
| `pricePrecision`        | `number` | Price rounding decimals                                             | `2`           |
| `zoneTicks`             | `number` | Width (in ticks) for grouping prices into exhaustion bands          | `3`           |
| `eventCooldownMs`       | `number` | Debounce time between signals at the same price/side                | `15000` (15s) |
| `minInitialMoveTicks`   | `number` | Number of ticks price must move (after exhaustion) for confirmation | `12`          |
| `confirmationTimeoutMs` | `number` | Max time to confirm a signal (ms)                                   | `60000` (1m)  |
| `maxRevisitTicks`       | `number` | Max retest distance (in ticks) for invalidation                     | `5`           |
| `features`              | `object` | Enables/disables advanced detection modules (see below)             | See below     |
| `symbol`                | `string` | Instrument symbol (for logging and analytics)                       | `"LTCUSDT"`   |

---

### Feature Flags

| Flag                | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `spoofingDetection` | Detects and ignores signals when passive liquidity is pulled before being exhausted    |
| `adaptiveZone`      | Dynamically adjusts exhaustion band width using volatility (ATR)                       |
| `passiveHistory`    | Tracks historical passive volume for detecting refilled walls                          |
| `multiZone`         | Aggregates exhaustion over a band of neighboring zones                                 |
| `sideOverride`      | Allows custom logic for aggressive/passive side (advanced/research)                    |
| `autoCalibrate`     | Dynamically tunes `minAggVolume` for best detection frequency                          |

---

## How Exhaustion Detection Works

1. **Aggregates recent trades by price/zone** using `windowMs` and `zoneTicks`.
2. **Detects zones where aggressive flow “cleans out” passive liquidity** (opposite side = 0).
3. **Applies all advanced feature modules:**

    - Spoofing detection (pulled liquidity)
    - Passive volume refill, adaptive band width, multi-zone

4. **Signals “pending” exhaustion when conditions are met.**
5. **Tracks price response:**

    - Confirms if price moves favorably (`minInitialMoveTicks`), no deep retest (`maxRevisitTicks`), within `confirmationTimeoutMs`.
    - Invalidates otherwise.

6. **All steps/events are logged for robust backtesting.**

---

## Good Default Settings

| Parameter               | Value | Why                                     |
| ----------------------- | ----- | --------------------------------------- |
| `windowMs`              | 90000 | 1–2 min clusters catch most real events |
| `minAggVolume`          | 600   | Filters noise, not too restrictive      |
| `pricePrecision`        | 2     | Matches tick size for LTCUSDT           |
| `zoneTicks`             | 3     | 2–5 tick bands common for exhaustion    |
| `minInitialMoveTicks`   | 12    | Requires price to move before confirm   |
| `confirmationTimeoutMs` | 60000 | 1 min: actionable, avoids stale         |
| `maxRevisitTicks`       | 5     | Allows minor retest, filters failures   |

---

## Logging & Analytics

- **Every exhaustion event (detected, confirmed, invalidated) is logged** for later analysis and research.
- Use logs to analyze:

    - Hit/fail rates and signal outcomes
    - Optimal thresholds for real edge
    - Price response time and post-event move distribution
    - Manual or automated trade reviews

---

## Practical Trading Advice

- **Use only confirmed signals for manual/automated trading**—avoid acting on raw “detection” without price confirmation.
- **Tune parameters for your market and timescale**—lower for scalping, higher for swing trading.
- **Review logs regularly** and adjust thresholds to maximize edge after fees/slippage.
- **Combine with absorption, CVD/delta, or swing logic** for highest quality setups.

---

## Advanced Notes

- **All memory/state is bounded and auto-managed** via time-aware caches and buffers.
- **Auto-calibration** adapts to live market flow (avoids signal flooding or starvation).
- **Designed for multi-instrument, multi-exchange, and ML/statistical research.**
- **Can be used as a “building block” for composite signal generation.**

---

## Integration & Extension

- Works with the same `utils.ts` as absorption and other detectors.
- Ready for plug-in to dashboards, research notebooks, or trading bots.
- Can be combined with any orderflow, delta, or predictive module for advanced edges.

---

## References & Further Reading

- _Trading Order Flow: How Absorption and Exhaustion Shape Market Turning Points_ (see included PDF)
- _Volume Profile & Footprint Trading for Crypto_ (OrderFlow\.net)
- Binance API Docs: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

---

## Contact

For questions, suggestions, or advanced usage, open an issue or pull request on GitHub.

---

**Exhaustion signals the end of a move—your edge is in detecting real liquidity dry-ups, not just price prints.
Analyze, iterate, and learn from your logs to level up your orderflow trading.**

# AbsorptionDetector

## Overview

The `AbsorptionDetector` is a TypeScript class for **real-time detection of absorption events** in cryptocurrency orderflow, using Binance Spot WebSocket trade and order book data.
It is designed for intraday traders seeking an edge by identifying significant areas where aggressive order flow is absorbed by strong passive liquidity, indicating potential reversals or swing points.

The detector features:

- **Pure orderflow-based signal generation** (no traditional indicators)
- **Advanced spoofing detection** to filter fake walls
- **Price response and confirmation logic** for actionable signals
- **Adaptive zone sizing, multi-zone logic, passive volume tracking**
- **Extensive event logging for backtesting and statistical review**
- **Pluggable, feature-flag-driven architecture** for advanced research and fast iteration

---

## What Is Absorption?

**Absorption** is an orderflow phenomenon where a large passive order (or cluster) in the order book is repeatedly “hit” by aggressive market orders, but is not pulled or canceled—instead, the liquidity absorbs the flow.
This often occurs at round numbers, swing highs/lows, or key support/resistance, and is typically followed by a stall, reversal, or “ignition” move in the opposite direction.

- **Bullish absorption:** Aggressive sells repeatedly hit a large bid wall, but price fails to break down, and eventually bounces.
- **Bearish absorption:** Aggressive buys attack a large ask wall, but price fails to break out, and eventually reverses.

**True absorption** = evidence of a real market participant absorbing orderflow (not spoofing) and often marks key market turning points.

---

## What Does the Detector Do?

- **Watches all trades and orderbook updates** for the selected instrument.
- **Aggregates aggressive market volume** and passive orderbook volume at each price (or zone).
- **Detects absorption events:**

    - High aggressive volume is absorbed by a stable or refilled passive wall at a price/zone.
    - Spoofing (pulling the wall) is detected and filtered out.

- **Signals a “pending” absorption event** and tracks price response:

    - Confirms the event if price moves favorably by a configurable number of ticks within a certain time window (no snap-back).
    - Invalidates if price retests or fails to move quickly enough.

- **Logs every detection, confirmation, and invalidation** for robust statistical analysis.

---

## Usage Example

```ts
import { AbsorptionDetector } from "./absorptionDetector.js";
import { SignalLogger } from "./signalLogger.js";

// Example callback for confirmed absorption
const onAbsorption = (data) => {
    console.log("Absorption signal:", data);
};

const logger = new SignalLogger("signal_log.csv");

const detector = new AbsorptionDetector(
    onAbsorption,
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
            priceResponse: true,
            autoCalibrate: true,
        },
    },
    logger
);

// Feed it trades and depth updates from Binance stream
detector.addTrade(tradeMsg);
detector.addDepth(orderBookMsg);
```

---

## Settings & Parameters

| Name                    | Type     | Description                                                                                          | Typical Value    |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| `windowMs`              | `number` | Time window in ms for aggregating trades for absorption detection.                                   | `90000` (90 sec) |
| `minAggVolume`          | `number` | Minimum aggressive trade volume (sum of market orders) for an absorption to be considered.           | `600`            |
| `pricePrecision`        | `number` | Decimal precision for prices (e.g. `2` for 0.01).                                                    | `2`              |
| `zoneTicks`             | `number` | Price band (in ticks) for grouping absorption.                                                       | `3`              |
| `eventCooldownMs`       | `number` | Minimum time between signals at the same zone/side (debounce).                                       | `15000` (15 sec) |
| `minInitialMoveTicks`   | `number` | Number of ticks price must move (from absorption) in the expected direction to confirm signal.       | `12`             |
| `confirmationTimeoutMs` | `number` | Time window to confirm signal after detection.                                                       | `60000` (1 min)  |
| `maxRevisitTicks`       | `number` | How far price can move back toward/through the absorption price before invalidation (retake filter). | `5`              |
| `features`              | `object` | Enables advanced detection and research features. (See below)                                        | See below        |

---

### **Feature Flags**

| Feature             | Description                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `spoofingDetection` | Detects and ignores events where passive wall is pulled before being hit (filters out fake walls). |
| `adaptiveZone`      | Automatically adjusts zone width based on market volatility (ATR).                                 |
| `passiveHistory`    | Tracks historical changes in passive volume for refill/sustained liquidity detection.              |
| `multiZone`         | Aggregates absorption across multiple neighboring price bands (clusters).                          |
| `priceResponse`     | Requires a fast, directional price response to confirm absorption (filters out non-actionable).    |
| `sideOverride`      | Allows for custom trade side logic (advanced/research).                                            |
| `autoCalibrate`     | Dynamically adjusts `minAggVolume` based on recent signal rates to optimize detection.             |

---

## How Absorption Detection Works

1. **Aggregates recent trades by price/zone** using `windowMs` and `zoneTicks`.
2. **Checks for high aggressive volume at a stable/refilled passive wall.**
3. **Filters out spoofing events** (wall pulls before being hit).
4. **Marks a “pending” absorption** when conditions are met.
5. **Confirms absorption** only if price moves favorably by at least `minInitialMoveTicks` (no snap-back within `maxRevisitTicks`) within `confirmationTimeoutMs`.
6. **Logs every detection and outcome** to file via `SignalLogger`.

---

## Good Default Settings

| Parameter               | Value | Rationale                                                       |
| ----------------------- | ----- | --------------------------------------------------------------- |
| `windowMs`              | 90000 | 1–2 minute clusters common for true absorption                  |
| `minAggVolume`          | 600   | Enough to filter noise, not so high as to miss real events      |
| `pricePrecision`        | 2     | Matches typical tick size for LTCUSDT (0.01)                    |
| `zoneTicks`             | 3     | Absorption typically occurs in tight 2–5 tick bands             |
| `minInitialMoveTicks`   | 12    | Requires \~0.12 move before confirming a signal (trader’s edge) |
| `confirmationTimeoutMs` | 60000 | 1 minute: actionable, avoids dead signals                       |
| `maxRevisitTicks`       | 5     | Allows for shallow retests, filters out failed moves            |

---

## Logging & Analytics

- **Every signal event (detected, confirmed, invalidated) is logged** as a CSV/JSON row for later review.
- Use the logs to analyze:

    - Signal hit rates and fail rates
    - Typical response time/size
    - Which settings produce the highest edge
    - Manual or automated trade review

---

## Practical Trading Advice

- **Never enter after the move is complete**—confirm on early price reaction, not after full target.
- **Tune parameters to maximize after-fee, after-slippage edge**, not just signal frequency.
- **Review logs regularly:** adjust min volume, move, and time thresholds to filter out false or late signals.
- **Visualize signals on your chart:** use the logs to spot the most predictive patterns.

---

## Advanced Notes

- **Dynamic calibration (`autoCalibrate`)**: Adjusts thresholds to prevent signal flooding or drought.
- **Passive refill tracking**: Detects hidden liquidity and iceberg orders.
- **Multi-zone logic**: Captures distributed absorption across a price band.
- **Perfect for research:** Feature flags enable fast A/B testing of detection algorithms.

---

## Integration & Extension

- Can be combined with exhaustion detectors, CVD/Delta confirmation, swing predictors, etc.
- Supports any market and timescale with configurable settings.
- Plug in any logging/output system (CSV, JSON, database).

---

## References & Further Reading

- _Trading Order Flow: How Absorption and Exhaustion Shape Market Turning Points_ (see provided PDF)
- _Volume Profile & Footprint Trading for Crypto_ (OrderFlow\.net)
- Binance API Docs: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

---

## Contact

For questions, improvements, or advanced usage, open an issue or pull request on GitHub.

---

**This detector provides the “engine” for real edge in modern orderflow trading.
Refine, iterate, and study your logs—your next edge is in the data.**
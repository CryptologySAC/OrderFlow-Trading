# AbsorptionDetector

## Overview

The `AbsorptionDetector` is a **modular, memory-efficient, production-ready TypeScript class** for **real-time detection of absorption events** in cryptocurrency orderflow, using Binance Spot WebSocket trade and order book data.
It is designed for **intraday traders and quantitative researchers** who want to systematically identify key areas where aggressive market orders are absorbed by strong passive liquidity, revealing potential swing points and edge opportunities.

**Key features:**

- **Pure orderflow-based detection** (no price or candle indicators)
- **Advanced spoofing detection** (filters fake or pulled walls)
- **Price response/confirmation logic** for actionable, trade-ready signals
- **Adaptive zone sizing, multi-zone bands, refill and passive history**
- **Auto-calibration, robust event logging, and full research telemetry**
- **Pluggable, feature-flag-driven architecture** (via shared `utils.ts` modules)
- **Supports both “absorption” and “exhaustion” detection (when used with correct event type)**

---

## What Is Absorption?

**Absorption** describes an orderflow event where large aggressive market orders are continuously matched by a stable or refilled passive orderbook wall (not cancelled, not pulled).
This typically occurs at round numbers, swing levels, or clear support/resistance—indicating the presence of a real, strong market participant (not a “spoof”) willing to absorb flow.

- **Bullish absorption:** Big sell orders repeatedly hit a large bid wall; price holds and then bounces.
- **Bearish absorption:** Big buy orders attack a large ask wall; price holds and then drops.

**Key property:** Absorption marks _real_ liquidity—often a precursor to reversal, major ignition, or a “fake breakdown/breakout.”

---

## What Does the Detector Do?

- **Ingests live trades and orderbook updates** for your instrument.
- **Aggregates aggressive market volume** and passive liquidity at each price or cluster zone.
- **Detects absorption events:**

    - Large aggressive flow meets a stable or _refilled_ passive wall.
    - Spoofing (walls pulled/cancelled) is detected and filtered out.

- **Signals a “pending” absorption event** and tracks price response:

    - **Confirms** if price reacts favorably (minimum tick move) within a set time window (no deep snap-back).
    - **Invalidates** if price retests/undoes the move or fails to react in time.

- **Logs every step**—detection, confirmation, invalidation—**with all contextual fields** for research/backtesting.

---

## Example Usage

```ts
import { AbsorptionDetector } from "./absorptionDetector.js";
import { SignalLogger } from "./signalLogger.js";

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
            autoCalibrate: true,
        },
        symbol: "LTCUSDT",
    },
    logger
);

// Stream in trades and depth from Binance:
detector.addTrade(tradeMsg);
detector.addDepth(orderBookMsg);
```

---

## Parameters & Settings

| Name                    | Type     | Description                                                                 | Typical Value |
| ----------------------- | -------- | --------------------------------------------------------------------------- | ------------- |
| `windowMs`              | `number` | Trade lookback window (ms) for detection                                    | `90000` (90s) |
| `minAggVolume`          | `number` | Minimum sum of aggressive (market) volume to qualify                        | `600`         |
| `pricePrecision`        | `number` | Price rounding decimals (matches instrument tick)                           | `2`           |
| `zoneTicks`             | `number` | Width (in ticks) for clustering/grouping prices into detection bands        | `3`           |
| `eventCooldownMs`       | `number` | Debounce time between signals at same price/side                            | `15000` (15s) |
| `minInitialMoveTicks`   | `number` | How many ticks price must move favorably (after detection) for confirmation | `12`          |
| `confirmationTimeoutMs` | `number` | Max time to confirm a signal (ms)                                           | `60000` (1m)  |
| `maxRevisitTicks`       | `number` | Max allowed retest distance (in ticks) for invalidation                     | `5`           |
| `features`              | `object` | Enables/disables advanced detection modules (see below)                     | See below     |
| `symbol`                | `string` | Instrument symbol (for logging and analytics)                               | `"LTCUSDT"`   |

---

### Feature Flags

| Flag                | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `spoofingDetection` | Detects and ignores signals when wall is pulled or cancelled (“fake” liquidity) |
| `adaptiveZone`      | Dynamically adjusts zone width (tick band) using real-time volatility (ATR)     |
| `passiveHistory`    | Tracks passive volume over time to spot “refills” (iceberg, hidden liquidity)   |
| `multiZone`         | Aggregates volumes over a band of zones, not just single price                  |
| `sideOverride`      | Allows custom research logic for aggressive/passive side (advanced/research)    |
| `autoCalibrate`     | Dynamically tunes `minAggVolume` to adapt to market regime changes              |

---

## How Absorption Detection Works

1. **Aggregates all recent trades by price/zone** using your time window and price precision.
2. **Detects clusters where large aggressive market orders meet stable/refilled passive walls.**
3. **Applies all active feature modules:**

    - Spoofing detection (history, pulls)
    - Passive refill and adaptive band width
    - Multi-zone (captures distributed liquidity)

4. **Logs and signals “pending” absorptions.**
5. **Tracks price response:**

    - If price moves favorably (by `minInitialMoveTicks`) and doesn’t snap back within `maxRevisitTicks`, within `confirmationTimeoutMs`,
      the event is **confirmed**.
    - If price fails to move or revisits, it is **invalidated**.

6. **All events are logged to file or analytics backend.**

---

## Defaults (Recommended for LTCUSDT Spot)

| Parameter               | Value | Why                                     |
| ----------------------- | ----- | --------------------------------------- |
| `windowMs`              | 90000 | 1–2 minute clusters best for absorption |
| `minAggVolume`          | 600   | Filters out noise, not too restrictive  |
| `pricePrecision`        | 2     | Matches 0.01 tick size                  |
| `zoneTicks`             | 3     | 2–5 tick bands catch most real clusters |
| `minInitialMoveTicks`   | 12    | Ensures edge after fees/slippage        |
| `confirmationTimeoutMs` | 60000 | 1 min: balances speed and reliability   |
| `maxRevisitTicks`       | 5     | Allows for some chop, filters failed    |

---

## Logging & Analytics

- **Every detection, confirmation, and invalidation** is logged (CSV, JSON, or DB).
- Use your logs to analyze:

    - Hit rate, fail rate, post-signal move stats
    - Parameter sensitivity and edge analysis
    - Visualization of signal timing vs. price chart

---

## Practical Trading Advice

- **Enter only on early confirmation, not after full target is hit.**
- **Optimize after-fee/slippage edge**, not just “raw” signal frequency.
- **Tune thresholds for your market regime** (volatile, choppy, etc.).
- **Regularly review log stats and trade journal** to improve signal quality.

---

## Advanced Notes

- **Memory management is fully automatic:** all buffers and histories are time-limited and space-bounded.
- **Auto-calibration adapts to live market regime.**
- **Compatible with all modern event-driven research pipelines (CSV, DB, plot, ML, etc).**
- **Easily extend for multi-instrument, multi-exchange, or cross-signal research.**

---

## Modular and Extensible

- Detector is compatible with the same `utils.ts` modules as `ExhaustionDetector`, `SignalLogger`, etc.
- Drop-in support for other advanced signals: exhaustion, swing prediction, CVD, delta, etc.
- Open for extension with your own research modules.

---

## References & Further Reading

- _Trading Order Flow: How Absorption and Exhaustion Shape Market Turning Points_ (see provided PDF)
- _Volume Profile & Footprint Trading for Crypto_ (OrderFlow\.net)
- Binance API Docs: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

---

## Contact

For questions, improvements, or advanced usage, open an issue or pull request on GitHub.

---

**Absorption detection is your edge engine in modern orderflow trading.
Refine, iterate, and analyze your logs—the data holds the edge.**

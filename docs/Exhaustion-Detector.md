# ExhaustionDetector

## Overview

The `ExhaustionDetector` is a TypeScript class for **real-time detection of exhaustion events** in cryptocurrency orderflow, using Binance Spot WebSocket trade and order book data.
It is designed for intraday traders and researchers seeking to detect market moments where aggressive orderflow runs out, passive liquidity is absent, and a “vacuum” or liquidity cliff forms—often just before a reversal or rapid price move.

The detector features:

- **Pure orderflow-based exhaustion signal generation**
- **Advanced spoofing and refill detection**
- **Zone-based and multi-zone logic**
- **Adaptive zone sizing (ATR-based)**
- **Price response and confirmation logic for actionable signals**
- **Full structured event logging for backtesting and review**
- **A modular, feature-flag-driven architecture for research and rapid iteration**

---

## What Is Exhaustion?

**Exhaustion** in orderflow occurs when aggressive market orders (buy or sell) “clear out” all passive liquidity on the opposite side of the orderbook—creating a “vacuum” that is often filled by a price jump, reversal, or “impulse” move as the market seeks liquidity.

- **Ask-side exhaustion:** Aggressive buys clear the ask book; no more sellers. Price often jumps up or spikes before new offers arrive.
- **Bid-side exhaustion:** Aggressive sells clear the bid book; no more buyers. Price often drops quickly before new bids are posted.

**True exhaustion** is not simply low volume—it is a _sudden_ and _total_ lack of passive liquidity at a key price or zone, immediately following significant aggressive activity.

---

## What Does the Detector Do?

- **Scans all trades and depth updates** for the target instrument in real time.
- **Aggregates aggressive volume by price zone** over a rolling window.
- **Detects exhaustion:**

    - Large aggressive volume is seen at a price/zone, and the _opposite side_ of the orderbook is fully cleared (or nearly so).
    - Optional features filter out spoofing, fake refills, or noise.

- **Signals a “pending” exhaustion event** and tracks price response:

    - Confirms the event if price moves in the expected direction by a configurable number of ticks, without snap-back, within a set time.
    - Invalidates if price revisits the exhaustion level or fails to move quickly enough.

- **Logs every detection, confirmation, and invalidation** for review and research.

---

## Usage Example

```ts
import { ExhaustionDetector } from "./exhaustionDetector.js";
import { SignalLogger } from "./signalLogger.js";

// Callback for confirmed exhaustion
const onExhaustion = (data) => {
    console.log("Exhaustion signal:", data);
};

const logger = new SignalLogger("signal_log.csv");

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
            priceResponse: true,
            sideOverride: true,
            autoCalibrate: true,
        },
    },
    logger
);

// Feed detector trades and orderbook depth messages from Binance
detector.addTrade(tradeMsg);
detector.addDepth(orderBookMsg);
```

---

## Settings & Parameters

| Name                    | Type     | Description                                                          | Typical Value    |
| ----------------------- | -------- | -------------------------------------------------------------------- | ---------------- |
| `windowMs`              | `number` | Rolling time window (ms) for trade aggregation.                      | `90000` (90 sec) |
| `minAggVolume`          | `number` | Minimum aggressive trade volume (sum) for exhaustion detection.      | `600`            |
| `pricePrecision`        | `number` | Decimal precision for prices (e.g., `2` for 0.01 ticks).             | `2`              |
| `zoneTicks`             | `number` | Price band (in ticks) for grouping exhaustion detection.             | `3`              |
| `eventCooldownMs`       | `number` | Minimum time between signals at the same zone/side.                  | `15000` (15 sec) |
| `minInitialMoveTicks`   | `number` | Number of ticks price must move (from exhaustion) to confirm signal. | `12`             |
| `confirmationTimeoutMs` | `number` | Time window to confirm signal after detection.                       | `60000` (1 min)  |
| `maxRevisitTicks`       | `number` | Allowed retest distance (in ticks) before invalidation.              | `5`              |
| `features`              | `object` | Enables advanced detection and research features (see below).        | See below        |

---

### **Feature Flags**

| Feature             | Description                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `spoofingDetection` | Detects and ignores events where passive wall is pulled before exhaustion (filters out fakes).   |
| `adaptiveZone`      | Automatically adjusts zone width based on recent market volatility (ATR).                        |
| `passiveHistory`    | Tracks time-series of passive volume for refill/sustained liquidity detection.                   |
| `multiZone`         | Aggregates exhaustion across neighboring price bands.                                            |
| `priceResponse`     | Requires a directional price response to confirm exhaustion (filters out non-actionable events). |
| `sideOverride`      | Enables advanced/experimental side-detection logic.                                              |
| `autoCalibrate`     | Dynamically adjusts `minAggVolume` based on recent signal frequency to optimize detection.       |

---

## How Exhaustion Detection Works

1. **Aggregates recent trades by price/zone** using `windowMs` and `zoneTicks`.
2. **Checks for high aggressive volume at a zone** and whether the opposite orderbook side is _empty_ (or very thin).
3. **Optional spoofing/refill checks** filter out false positives.
4. **Marks a “pending” exhaustion** when conditions are met.
5. **Confirms exhaustion** only if price moves by at least `minInitialMoveTicks` (without snap-back, within `maxRevisitTicks` and `confirmationTimeoutMs`).
6. **Logs all detections and outcomes** for analytics.

---

## Good Default Settings

| Parameter               | Value | Rationale                                              |
| ----------------------- | ----- | ------------------------------------------------------ |
| `windowMs`              | 90000 | Captures meaningful short-term market sweeps           |
| `minAggVolume`          | 600   | Filters out low-volume noise; tune for asset/liquidity |
| `pricePrecision`        | 2     | 0.01 for LTCUSDT, etc                                  |
| `zoneTicks`             | 3     | Detects exhaustion across a micro-range                |
| `minInitialMoveTicks`   | 12    | Requires real price follow-through for confirmation    |
| `confirmationTimeoutMs` | 60000 | Only act on immediate exhaustion-driven moves          |
| `maxRevisitTicks`       | 5     | Allows minor retest, filters chop                      |

---

## Logging & Analytics

- **All exhaustion events and their outcomes are logged** using the provided `SignalLogger`.
- Logs contain timestamps, signal details, confirmation/invalidation outcomes, and more.
- Use logs to analyze:

    - Signal accuracy and frequency
    - Average response size/time
    - Settings that maximize your edge
    - Edge cases and potential improvements

---

## Practical Trading Advice

- **Enter only after confirmation:** Require immediate price reaction for edge.
- **Review logs frequently:** Adjust thresholds to optimize win rate and minimize chop.
- **Don’t chase late moves:** Exits or timeouts keep you out of “dead” signals.
- **Visualize exhaustion events on your trading chart:** Study post-signal price action.

---

## Advanced Notes

- **Dynamic calibration (`autoCalibrate`)**: Keeps signal frequency stable and optimal.
- **Passive refill tracking**: Prevents false signals from replenished liquidity.
- **Multi-zone aggregation**: Finds exhaustion in “distributed” orderbook holes.
- **Research toggles:** Feature flags enable fast A/B testing of improvements.

---

## Integration & Extension

- Combine with absorption detectors, CVD/Delta logic, swing predictors, and more.
- Adaptable to any market and time scale with parameter tuning.
- Pluggable logging/output for database or analytics stack.

---

## References & Further Reading

- _Trading Order Flow: How Exhaustion Signals Precede Reversals_ (see provided PDF)
- _Volume Profile, Footprint, and Orderbook Trading for Crypto_ (OrderFlow\.net)
- Binance API Docs: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

---

## Contact

For questions, improvements, or research use-cases, open an issue or pull request on GitHub.

---

**The ExhaustionDetector is your edge for finding “liquidity vacuums”—where big moves begin.
Analyze, iterate, and let the data guide your edge.**

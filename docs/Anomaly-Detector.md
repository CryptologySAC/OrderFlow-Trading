# AnomalyDetector

## Overview

The `AnomalyDetector` is an advanced, event-driven TypeScript class for **real-time detection of significant market anomalies** in orderflow and order book data. It processes enriched trade streams and depth snapshots, using robust statistical and microstructure techniques to identify flash crashes, liquidity voids, whale activity, iceberg orders, spoofing, absorption, exhaustion, and more.

**Key Features:**

- **Comprehensive orderflow anomaly detection:** from flash crashes to spoofing, absorption, and momentum ignition.
- **Configurable, research-backed statistical thresholds and rolling windows.**
- **High-resolution, low-latency anomaly emission via Node.js EventEmitter.**
- **Supports custom spoofing detector modules.**
- **Advanced statistical order size tracking and anomaly scoring.**
- **Production-level logging, deduplication, and health assessment.**
- **Pluggable with project infrastructure (`Logger`, `SpoofingDetector`).**

---

## What Is a Market Anomaly?

A **market anomaly** is any market behavior or structural event that is significantly outside normal microstructure patterns—often signaling risk, hidden intent, or potential trading edge.
Examples include:

- **Flash crash:** Sudden large move with extreme z-score.
- **Liquidity void:** Spread and passive depth collapse.
- **Whale activity:** One or more outsized orders well above normal size.
- **Iceberg order:** Hidden size, exposed by repeated refills.
- **Absorption:** Aggressive flow meets persistent passive interest.
- **Exhaustion:** Waning aggressive flow after one-sided moves.
- **Spoofing:** Large visible orders that vanish without execution.

---

## What Does the Detector Do?

- **Processes every enriched trade and best quote update.**
- **Maintains rolling histories of trades, order sizes, and depth.**
- **Runs multi-factor statistical and microstructure anomaly checks:**

    - Flash crash
    - Liquidity void
    - API gap/data loss
    - Extreme volatility
    - Orderbook and flow imbalance
    - Absorption, exhaustion
    - Momentum ignition
    - Whale/iceberg activity
    - Spoofing
    - Order size anomaly

- **Emits detailed `"anomaly"` events** with type, severity, suggested action, and rationale.
- **Tracks recent anomaly events for deduplication and health status.**

---

## Example Usage

```ts
import { AnomalyDetector } from "./anomalyDetector.js";
import { Logger } from "./infrastructure/logger.js";
import { SpoofingDetector } from "./services/spoofingDetector.js";

const logger = new Logger();
const spoofingDetector = new SpoofingDetector(/* ... */);

const detector = new AnomalyDetector({
    windowSize: 1000,
    normalSpreadBps: 10,
    minHistory: 100,
    spoofingDetector,
    logger,
    anomalyCooldownMs: 10_000,
    volumeImbalanceThreshold: 0.7,
    absorptionRatioThreshold: 3.0,
    icebergDetectionWindow: 60_000,
    orderSizeAnomalyThreshold: 3,
    tickSize: 0.01,
});

detector.on("anomaly", (anomaly) => {
    console.warn("Anomaly detected:", anomaly);
});

detector.onEnrichedTrade(enrichedTradeEvent);
detector.updateBestQuotes(bestBid, bestAsk);
```

---

## Settings — Detailed Explanation

Each parameter directly tunes the detector’s statistical or microstructure filters. See below for exact effects and practical tips:

| Setting                     | Type   | Description                                         | Example Value |
| --------------------------- | ------ | --------------------------------------------------- | ------------- |
| `windowSize`                | number | Rolling trade history for stats (count)             | `1000`        |
| `normalSpreadBps`           | number | Normal bid/ask spread in basis points               | `10`          |
| `minHistory`                | number | Minimum trades to start detection                   | `100`         |
| `spoofingDetector`          | object | Injected spoofing module                            | -             |
| `logger`                    | object | Logger instance for diagnostics                     | -             |
| `anomalyCooldownMs`         | number | Minimum ms between same anomaly emits               | `10_000`      |
| `volumeImbalanceThreshold`  | number | Threshold for order book and flow imbalance         | `0.7`         |
| `absorptionRatioThreshold`  | number | Ratio for absorption detection (passive/aggressive) | `3.0`         |
| `icebergDetectionWindow`    | number | ms window for iceberg refill pattern                | `60_000`      |
| `orderSizeAnomalyThreshold` | number | Z-score threshold for order size anomaly            | `3`           |
| `tickSize`                  | number | Price increment for rounding levels                 | `0.01`        |

### Setting Behavior & Rationale

- **windowSize:**
  Number of trades kept for rolling statistical calculations (mean, stddev, flow).
  Too low = noisy; too high = slow response.

- **normalSpreadBps:**
  Baseline bid/ask spread in basis points (1 bp = 0.01%).
  Used to detect liquidity voids.

- **minHistory:**
  Detector only fires after this many trades.
  Prevents false signals during market open or after connection reset.

- **spoofingDetector:**
  External module for passive wall spoof/cancel pattern detection.

- **logger:**
  Logs detected events, errors, and metrics.

- **anomalyCooldownMs:**
  Suppresses duplicate emits of the same anomaly within this interval.

- **volumeImbalanceThreshold:**
  Normalized (\[-1,1]) threshold for book or flow imbalance.
  Higher = only triggers on extreme one-sidedness.

- **absorptionRatioThreshold:**
  Minimum ratio (passive/aggressive) for absorption anomaly.
  Higher = only strong absorption triggers.

- **icebergDetectionWindow:**
  Milliseconds to consider multiple fills at a price as likely iceberg.

- **orderSizeAnomalyThreshold:**
  Number of standard deviations above mean (z-score) to qualify as order size anomaly.

- **tickSize:**
  Rounding unit for prices and levels; must match symbol min tick.

---

## Anomaly Types Emitted

| Type                  | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `flash_crash`         | Sudden price move, 3+ std dev from rolling mean             |
| `liquidity_void`      | Spread or depth collapse                                    |
| `api_gap`             | Missing trades or order book updates                        |
| `extreme_volatility`  | Recent return stddev spikes far above baseline              |
| `spoofing`            | Detected via spoofing detector                              |
| `orderbook_imbalance` | Strong bid/ask book imbalance                               |
| `flow_imbalance`      | Persistent one-sided aggressive flow                        |
| `absorption`          | Aggressive orders meet deep passive without moving price    |
| `exhaustion`          | Diminishing flow after trend/ignition                       |
| `momentum_ignition`   | Burst of one-sided flow after lull                          |
| `iceberg_order`       | Hidden size detected by refill pattern                      |
| `order_size_anomaly`  | Single order far from mean size (large or small)            |
| `whale_activity`      | Cluster of very large orders (above 99th/99.5th percentile) |

---

## How the AnomalyDetector Works

1. **Every trade and order book update is pushed into rolling windows.**
2. **Statistical and microstructure features (mean, stddev, quantiles, imbalance, etc.) are computed.**
3. **Each new event runs the anomaly check pipeline, in order:**

    - Flash crash, liquidity void, API gap, volatility spike
    - Book/flow imbalance, absorption, exhaustion
    - Whale activity, iceberg detection, spoofing, order size anomaly, momentum ignition

4. **If an anomaly is detected:**

    - Emits `"anomaly"` event (global and symbol-specific).
    - Includes severity, affected price range, recommended action, and rationale.
    - Deduplicates events (per type) within the cooldown interval.
    - Logs details for research/backtesting.

---

## Example Anomaly Event

```json
{
    "type": "absorption",
    "severity": "high",
    "detectedAt": 1717082145000,
    "affectedPriceRange": { "min": 81.2, "max": 81.28 },
    "recommendedAction": "fade_rally",
    "details": {
        "confidence": 0.85,
        "absorptionRatio": 5.1,
        "aggressiveVolume": 16,
        "passiveVolume": 82,
        "rationale": {
            "highAggressive": true,
            "tightRange": true,
            "highAbsorptionRatio": true,
            "flowSupportsAbsorption": false
        }
    }
}
```

---

## Market Health Assessment

Call `detector.getMarketHealth()` at any time for a live market quality snapshot:

- **Volatility (rolling stddev)**
- **Spread (basis points)**
- **Flow imbalance**
- **Recent anomaly count and highest severity**
- **Recommended action** (continue, reduce_size, close_positions, pause)

---

## Practical Usage & Tuning Tips

- **Tighten or loosen anomaly filters:** Adjust thresholds for your risk tolerance or market regime.
- **Combine with dashboard/event log** for real-time visualization.
- **Integrate with strategy or risk management:** Pause/cut size on critical or high-severity events.
- **Analyze anomaly log for pattern mining or backtest research.**

---

## Modular & Extensible

- Easily pluggable with project’s logger, orderflow, and downstream event consumers.
- Add custom anomaly logic or tune statistical windows as needed.
- Supports external spoofing detector for advanced manipulation pattern detection.

---

_“Anomaly detection is the first defense against market risk and manipulation—tune, log, and review to maintain edge.”_

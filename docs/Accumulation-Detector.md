# AccumulationDetector

## Overview

The `AccumulationDetector` is a **production-ready, event-driven TypeScript class** for **real-time detection of accumulation events** in cryptocurrency orderflow. It processes live Binance Spot WebSocket trade and order book data to systematically identify price zones where passive resting liquidity absorbs aggressive taker flow over an extended period—a signature of accumulation by strong hands prior to significant price moves.

**Key features:**

* **Pure orderflow-based accumulation detection** (no reliance on candle or price indicators)
* **Side-aware, zone-based tracking** for both buy and sell accumulation
* **Configurable passive/aggressive volume ratio and zone duration**
* **High-precision, memory-efficient rolling windows per zone**
* **Emission of `"accumulation"` events via Node.js EventEmitter for downstream strategies, dashboards, or loggers**
* **Production-level error handling, logging, and research telemetry**
* **Pluggable with common project infrastructure (`Logger`, `MetricsCollector`, `ISignalLogger`)**

---

## What Is Accumulation?

**Accumulation** describes a market regime where significant, sustained passive liquidity absorbs aggressive market orders at a specific price zone for an extended time. This typically indicates that strong hands (institutions or professionals) are quietly accumulating inventory without moving price, anticipating a future breakout.

* **Buy-side accumulation:** Large aggressive selling repeatedly meets deep bid-side liquidity that does not move.
* **Sell-side accumulation (distribution):** Large aggressive buying is absorbed by stable or refilled ask-side liquidity.

**Key property:** Accumulation is often observed before trend reversals, breakout ignition, or the start of large directional moves.

---

## What Does the Detector Do?

* **Processes every enriched trade (with optional passive volume context)**
* **Aggregates aggressive taker flow and latest passive liquidity per price zone/side**
* **Tracks trade frequency, duration, and rolling history for each active zone**
* **Detects accumulation events when:**

  * Passive volume outweighs taker flow by a configurable ratio
  * Accumulation is sustained for a minimum duration (time-in-zone)
  * Recent activity and minimum taker volume thresholds are met
* **Emits a fully contextual `"accumulation"` event** with strength, duration, ratio, and zone data
* **Handles error cases and logs all signal events for research/backtesting**

---

## Example Usage

```ts
import { AccumulationDetector } from "./accumulationDetector.js";
import { Logger } from "./infrastructure/logger.js";
import { MetricsCollector } from "./infrastructure/metricsCollector.js";
import { SignalLogger } from "./services/signalLogger.js";

const logger = new Logger();
const metrics = new MetricsCollector();
const signalLogger = new SignalLogger("accumulation_signals.csv");

const detector = new AccumulationDetector(
    null, // callback is not used; use EventEmitter pattern
    {
        windowMs: 15 * 60_000,    // 15-minute lookback window
        minDurationMs: 5 * 60_000, // 5-minute minimum duration in zone
        zoneSize: 0.02,           // Price zone width (e.g., $0.02)
        minRatio: 1.2,            // Passive/aggressive ratio threshold
        minRecentActivityMs: 60_000,
        minAggVolume: 5,
        trackSide: true,
        pricePrecision: 2,
    },
    logger,
    metrics,
    signalLogger
);

// Listen for accumulation signals:
detector.on("accumulation", (signal) => {
    console.log("Accumulation detected:", signal);
});

// Stream enriched trades into detector:
detector.onEnrichedTrade(enrichedTradeEvent);
```

---

## Detector Settings — Exact Explanation

Each setting in `AccumulationDetector` controls a **specific aspect of how the detector interprets orderflow** to identify real accumulation. Below is a detailed breakdown of each parameter, its exact effect, and practical examples:

| Setting               | Type    | Description                                                | Example Value |
| --------------------- | ------- | ---------------------------------------------------------- | ------------- |
| `windowMs`            | number  | Rolling lookback window for trade volume & timestamps (ms) | `900_000`     |
| `minDurationMs`       | number  | Minimum time (ms) a zone must persist to qualify           | `300_000`     |
| `zoneSize`            | number  | Price width for grouping trades into zones                 | `0.02`        |
| `minRatio`            | number  | Passive/aggressive volume ratio threshold for accumulation | `1.2`         |
| `minRecentActivityMs` | number  | Max staleness allowed for last trade in zone (ms)          | `60_000`      |
| `minAggVolume`        | number  | Minimum total aggressive volume to qualify (per zone)      | `5`           |
| `trackSide`           | boolean | Track bid/ask zones separately                             | `true`        |
| `pricePrecision`      | number  | Number of decimals for zone key rounding                   | `2`           |

### Detailed Setting Behavior

#### 1. `windowMs`

* **Type:** `number` (milliseconds)
* **Purpose:**

  * Sets the **rolling lookback window** for trade volume and timestamps considered when evaluating a zone.
* **Effect:**

  * Only trades within the last `windowMs` (e.g., 900,000 ms = 15 minutes) are used to sum aggressive (taker) volume for a given price zone.
* **Example:**

  * If `windowMs = 900_000`, a large sell that occurred 20 minutes ago is ignored in the ratio; only the last 15 minutes count.

#### 2. `minDurationMs`

* **Type:** `number` (milliseconds)
* **Purpose:**

  * **Minimum time** a price zone must be tracked (from first trade to now) before it can qualify as an accumulation zone.
* **Effect:**

  * Prevents "flash" events from triggering a signal; **accumulation must persist for at least this duration**.
* **Example:**

  * If `minDurationMs = 300_000`, zone must be accumulating for at least 5 minutes.

#### 3. `zoneSize`

* **Type:** `number` (e.g., `0.02`)
* **Purpose:**

  * **Width of each price zone**, in quote currency (e.g., \$0.02 for LTCUSDT).
* **Effect:**

  * Trades are grouped into discrete zones by rounding price. Controls the **granularity of detection**.
* **Example:**

  * If `zoneSize = 0.02`, prices 81.23 and 81.24 will be grouped in the same zone (e.g., 81.24).

#### 4. `minRatio`

* **Type:** `number` (e.g., `1.2`)
* **Purpose:**

  * **Threshold ratio** of passive (resting limit order) volume over aggressive (taker) volume required to call it accumulation.
* **Effect:**

  * Passive volume in the zone must be at least `minRatio` × aggressive volume for a signal.
* **Example:**

  * If `minRatio = 1.2` and aggressive volume = 10, passive must be ≥ 12.

#### 5. `minRecentActivityMs`

* **Type:** `number` (milliseconds)
* **Purpose:**

  * **Maximum staleness** allowed for the last trade in the zone.
* **Effect:**

  * Ensures zone is still “live”; if no trades in the last `minRecentActivityMs`, signal is suppressed.
* **Example:**

  * If `minRecentActivityMs = 60_000`, at least one trade in the last 60 seconds is required for detection.

#### 6. `minAggVolume`

* **Type:** `number` (e.g., `5`)
* **Purpose:**

  * **Minimum total aggressive volume** in the zone (over the window) to qualify.
* **Effect:**

  * Avoids signaling on noise, e.g., very low-volume “accumulation” that isn’t significant.
* **Example:**

  * If `minAggVolume = 5`, need ≥ 5 units (LTC) of aggressive volume in the zone to consider it.

#### 7. `trackSide`

* **Type:** `boolean`
* **Purpose:**

  * Whether to **track accumulation for bid and ask sides separately** (`true`) or aggregate both (`false`).
* **Effect:**

  * If `true`, you can distinguish **buy-side (bid) accumulation** from **sell-side (ask/distribution)**; otherwise, only the combined effect is tracked.
* **Example:**

  * `trackSide = true` → You get separate events for accumulation at bids and asks.

#### 8. `pricePrecision`

* **Type:** `number` (e.g., `2`)
* **Purpose:**

  * **Number of decimals** to round price when creating zone keys.
* **Effect:**

  * Ensures consistency in grouping trades into zones and avoids floating-point errors.
* **Example:**

  * With `pricePrecision = 2`, a price of 81.2367 becomes 81.24.

---

### Setting Summary Table

| Setting               | Controls...                                  | Too Low Means...                | Too High Means...                   |
| --------------------- | -------------------------------------------- | ------------------------------- | ----------------------------------- |
| `windowMs`            | How far back to look for trades in zone      | Too reactive, signals on noise  | Misses recent regime changes        |
| `minDurationMs`       | How long zone must persist to signal         | False/weak signals              | Misses fast/real accumulations      |
| `zoneSize`            | Price step per zone                          | Too granular (noise)            | Too coarse (misses details)         |
| `minRatio`            | Strength of passive over aggressive required | Signals on weak absorption      | Only the strongest, rarest events   |
| `minRecentActivityMs` | Max allowed time since last trade in zone    | Old zones can trigger           | Misses slow/steady accumulations    |
| `minAggVolume`        | Minimum aggressive volume required           | Signals on micro/noise events   | Misses thin market signals          |
| `trackSide`           | Split buy/sell or combine                    | —                               | —                                   |
| `pricePrecision`      | Rounding for zone key                        | Risk of floating point mismatch | Too coarse, possible grouping error |

---

## Defaults (Recommended for LTCUSDT Spot)

| Parameter             | Value  | Rationale                                           |
| --------------------- | ------ | --------------------------------------------------- |
| `windowMs`            | 900000 | Captures multi-minute accumulation phases           |
| `minDurationMs`       | 300000 | 5+ minute holding for credible accumulation         |
| `zoneSize`            | 0.02   | Matches fine-grained order book steps for LTCUSDT   |
| `minRatio`            | 1.2    | Avoids weak/noise absorption, favors clear stacking |
| `minRecentActivityMs` | 60000  | Ensures zone is currently active                    |
| `minAggVolume`        | 5      | Filters out low-volume chop                         |
| `trackSide`           | true   | Enables detection of buy vs. sell accumulation      |
| `pricePrecision`      | 2      | Matches tick size                                   |

---

### Practical Tuning Tips

* **For volatile, active markets:**
  Lower `minDurationMs`, `windowMs`, and `zoneSize` for more sensitivity.
* **For thin, choppy markets:**
  Raise `minAggVolume` and `minRatio` to reduce noise.
* **To catch early, strong accumulation:**
  Lower `minDurationMs` but keep `minRatio` firm.

---

## How Accumulation Detection Works

1. **Aggregates rolling windows of aggressive (taker) volume, trade timestamps, and passive liquidity per price zone and side.**
2. **Updates passive snapshot on every trade using passive volume context (from order book, if available).**
3. **For every trade, checks if:**

   * Passive volume in zone exceeds aggressive flow by the required `minRatio`
   * Accumulation is sustained for at least `minDurationMs`
   * Last trade in zone is recent enough (`minRecentActivityMs`)
   * Taker volume exceeds `minAggVolume`
4. **If all conditions are met, emits an `"accumulation"` event** containing:

   * `isAccumulating` (boolean)
   * `strength` (normalized ratio vs threshold)
   * `duration` (ms)
   * `zone` (price)
   * `ratio` (passive/aggressive)
5. **Cleans up old/inactive zones to maintain memory efficiency.**

---

## Logging & Analytics

* **Every signal event is logged** (if a `SignalLogger` is attached) with full context.
* Use logs to analyze:

  * Accumulation signal frequency and duration
  * Zone and strength distribution
  * Correlation of signals with subsequent price action
  * Parameter tuning for improved edge

---

## Practical Trading Advice

* **Monitor accumulation in context:** Look for signals near range lows (for bullish accumulation) and highs (for distribution).
* **Combine with absorption/exhaustion detection** for swing entries/exits.
* **Avoid trading every signal:** Strongest signals often appear at the end of long, one-sided moves or during tight, choppy phases.
* **Tune parameters for regime:** Adjust window, min ratio, and duration based on volatility and time of day.

---

## Advanced Notes

* **RollingWindow utility** ensures bounded memory use per active zone.
* **Zone keying is adaptive:** Choose `trackSide: false` for simple detection or `true` for bid/ask separation.
* **Compatible with modular project infrastructure:** Integrate with analytics, dashboards, or research pipelines.

---

## Modular and Extensible

* Detector works with the same infrastructure and logger as `AbsorptionDetector`, `ExhaustionDetector`, etc.
* Extendable to alternative instruments or cross-signal research (accumulation + delta, etc.).
* EventEmitter architecture supports real-time or batch processing.

---

## References & Further Reading

* *Trading Order Flow: How Absorption and Accumulation Shape Market Turning Points* (\[see attached PDF])
* *Footprint Charting for Crypto* (OrderFlow\.net)
* Binance API Docs: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

---

## Contact

For questions, enhancements, or custom research, open an issue or pull request on GitHub.

---

**Accumulation detection reveals the silent hand building size in the dark.
Track, log, and review your signals—edge emerges from patient, persistent analysis.**

---

### How to Export to PDF

To export this documentation to PDF:

1. Open this `.md` file in any Markdown viewer/editor (e.g., VSCode, Typora, Obsidian).
2. Use the "Export as PDF" or "Print to PDF" function from your editor.

---

### Checklist

* [x] Overview, features, and usage
* [x] Parameter table and rationale
* [x] Detailed setting explanations
* [x] Detection and signal logic
* [x] Practical trading advice
* [x] Logging and extensibility
* [x] References
* [x] Export/print instructions

---

**Questions / Feedback / Next Steps:**

* Confirm parameter values and adjust defaults if needed for your market.
* Review the event interface for `"accumulation"`—should it include more context?
* Integrate with downstream consumers (dashboard, analytics, strategy).
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

## Parameters & Settings

| Name                  | Type      | Description                                             | Typical Value     |
| --------------------- | --------- | ------------------------------------------------------- | ----------------- |
| `windowMs`            | `number`  | Trade lookback window (ms) for rolling sum              | `900000` (15 min) |
| `minDurationMs`       | `number`  | Minimum zone life to qualify (ms)                       | `300000` (5 min)  |
| `zoneSize`            | `number`  | Price zone width (in quote currency, e.g., \$0.02)      | `0.02`            |
| `minRatio`            | `number`  | Passive/aggressive volume ratio threshold               | `1.2`             |
| `minRecentActivityMs` | `number`  | Max staleness for recent trade in zone (ms)             | `60000` (1 min)   |
| `minAggVolume`        | `number`  | Minimum taker (aggressive) volume to qualify (per zone) | `5`               |
| `trackSide`           | `boolean` | Track bid/ask sides separately                          | `true`            |
| `pricePrecision`      | `number`  | Decimal places for zone rounding                        | `2`               |

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
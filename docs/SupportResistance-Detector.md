# SupportResistanceDetector

## Overview

The `SupportResistanceDetector` is a **TypeScript class** that analyzes live trade data to automatically discover and track intraday support and resistance levels. It operates purely on orderflow, inspecting every `EnrichedTradeEvent` and updating an internal map of levels in real time. The detector is designed for quantitative traders who want a programmatic way to monitor important price levels without relying on classical candle or indicator approaches.

**Key features:**

- Price‑based clustering of recent trades to identify emerging levels
- Strength calculation using touch count, traded volume and rejection activity
- Automatic role‑reversal detection (support becoming resistance and vice versa)
- Time‑bounded level history for memory efficiency
- Emits structured signals and WebSocket events for dashboards or strategies

---

## What Is Support/Resistance?

**Support** is a price area where repeated buying interest prevents the market from dropping lower. **Resistance** is the opposite—selling pressure that caps advances. Orderflow around these areas usually shows repeated "touches" and rejections, often accompanied by elevated traded volume. Monitoring how price interacts with these levels helps traders spot potential reversals and breakouts.

---

## What Does the Detector Do?

- Maintains a rolling history of recent trades (up to 1,000 by default).
- Detects new potential levels by clustering trade prices over the last few minutes.
- Records every touch of an existing level and marks whether the touch looked like a rejection.
- Calculates a normalized **strength** score for each level based on touches, volume and confirmed rejections.
- Detects when a level flips from support to resistance (or vice versa) and logs the event.
- Emits a structured signal once a level's strength and touch count exceed configurable thresholds.
- Periodically removes stale levels that have not been touched within the configured time window.

---

## Example Usage

```ts
import { SupportResistanceDetector } from "./indicators/supportResistanceDetector.js";
import { DetectorFactory } from "./utils/detectorFactory.js";

const onLevel = (signal) => {
    console.log("Support/resistance level:", signal);
};

const detector = DetectorFactory.createSupportResistanceDetector(
    onLevel,
    {
        priceTolerancePercent: 0.05,
        minTouchCount: 3,
        minStrength: 0.6,
    },
    {
        logger, // your Logger instance
        spoofingDetector, // optional spoofing detector
        metricsCollector, // metrics/telemetry
        signalLogger, // optional CSV logger
    }
);

// Feed enriched trades into the detector
stream.on("trade", (trade) => detector.onEnrichedTrade(trade));
```

---

## Settings & Parameters

| Setting                      | Type     | Description                                                                  | Default              |
| ---------------------------- | -------- | ---------------------------------------------------------------------------- | -------------------- |
| `priceTolerancePercent`      | `number` | How close a trade price must be (in percent) to count as touching the level. | `0.05`               |
| `minTouchCount`              | `number` | Minimum number of touches before a level can be signalled.                   | `3`                  |
| `minStrength`                | `number` | Minimum calculated strength (0‑1) required to emit a signal.                 | `0.6`                |
| `timeWindowMs`               | `number` | How long a level is kept without new touches.                                | `5_400_000` (90 min) |
| `volumeWeightFactor`         | `number` | Weight of traded volume when computing strength.                             | `0.3`                |
| `rejectionConfirmationTicks` | `number` | Number of ticks to look ahead to confirm a rejection touch.                  | `5`                  |

The detector settings object also accepts optional `features` flags such as `spoofingDetection`, `adaptiveZone`, `multiZone` and others defined in the common `DetectorFeatures` interface.

---

## How Detection Works

1. **Trade ingestion** – every `EnrichedTradeEvent` is stored in a short history and processed immediately.
2. **Level touch check** – if the trade price is within `priceTolerancePercent` of any known level, the level's touch list is updated and a possible rejection is noted.
3. **New level discovery** – using the last five minutes of trades, prices are clustered to find zones with repeated activity. If a cluster contains at least `minTouchCount` trades it becomes a new level.
4. **Strength update** – each level's strength is recalculated from touch count, total volume traded at that price and how many touches looked like rejections.
5. **Role reversal** – when price moves through a level and begins trading on the other side, the level type flips and a role‑reversal entry is logged.
6. **Signal emission** – once `minTouchCount` and `minStrength` are satisfied, a structured `Detected` signal is emitted and a `supportResistanceLevel` event is broadcast.
7. **Cleanup** – levels not touched for `timeWindowMs` are pruned to keep memory usage bounded.

---

## Logging & Analytics

If a `SignalLogger` is provided, every emitted level is persisted with full metadata (strength, touch count, volume, role reversals, timestamps). Metrics can also be collected via `MetricsCollector` to monitor level counts and detector health.

---

## Practical Trading Advice

- Focus on the strongest levels (high touch count and strength) near recent swing highs/lows.
- Combine detector output with absorption/exhaustion signals for confirmation.
- Adjust `priceTolerancePercent` to match the instrument's typical spread and volatility.
- Review logged data regularly to refine thresholds for your market.

---

## Advanced Notes

- Rejection detection currently uses trade aggressor side as a proxy. In a full implementation you might wait for subsequent trades to confirm the bounce.
- Level IDs are deterministic (`sr_<price*100>`), simplifying correlation with chart annotations.
- The detector is agnostic to exchange—it only requires enriched trade events.
- Works seamlessly with the common infrastructure used by other detectors in this project.

---

## References & Further Reading

- _Technical Analysis of the Financial Markets_ – John J. Murphy
- _Trading Order Flow: Support and Resistance Dynamics_
- Binance API Docs: [https://binance-docs.github.io/apidocs/spot/en/](https://binance-docs.github.io/apidocs/spot/en/)

---

## Contact

For questions or improvements, please open an issue or pull request on GitHub.

---

**Support and resistance levels reveal where real market interest sits. Track them objectively, review your logs, and refine your edge.**

# Config.json Reference Guide

## Overview

This document describes every setting available in `config.json`. Each option controls how the OrderFlow Trading application connects to data streams, processes order book information and manages trading signals. The examples below are based on the default `config.json` shipped with the repository.

---

## Global Settings

| Key               | Description                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nodeEnv`         | Node environment used when running the app (`development` or `production`). Controls logging detail and other env-specific behaviour. |
| `symbol`          | Default trading pair when no `SYMBOL` env variable is specified. Must match one of the entries under `symbols`.                       |
| `httpPort`        | Port for the REST HTTP server. Must be between 1 and 65535.                                                                           |
| `wsPort`          | Port for the WebSocket server used for broadcasting real-time data.                                                                   |
| `alertWebhookUrl` | Optional URL for sending alert notifications (e.g. Discord/Slack webhook). If omitted, alert sending is disabled.                     |
| `alertCooldownMs` | Minimum delay in milliseconds between sending alerts. Prevents webhook spam.                                                          |
| `maxStorageTime`  | Maximum time (ms) to retain trade and depth history in memory. Older data is pruned.                                                  |

---

## Symbol Configuration

Each entry under `symbols` contains settings specific to that trading pair. The example config provides a single symbol `LTCUSDT`. The top level of a symbol contains general behaviour used across multiple modules.

| Key                | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `pricePrecision`   | Number of decimal places used for prices. Determines tick size and rounding for detectors. |
| `windowMs`         | Default rolling window length (ms) for most statistical calculations.                      |
| `bandTicks`        | Width (in ticks) of the preprocessing band used for grouping depth levels.                 |
| `emitDepthMetrics` | When `true`, extra order book metrics are exposed for monitoring/debugging.                |

### dataStream

Settings for the live Binance WebSocket stream.

- `reconnectDelay` – Delay between reconnect attempts in milliseconds.
- `maxReconnectAttempts` – Maximum retries before giving up and throwing an error.
- `depthUpdateSpeed` – Binance update speed (`100ms` or `1000ms`). Faster updates use more bandwidth.
- `enableHeartbeat` – If `true`, a ping is sent periodically to keep the connection alive.
- `heartbeatInterval` – Milliseconds between heartbeat pings.
- `maxBackoffDelay` – Maximum wait time before reconnecting when the stream is unstable.
- `streamHealthTimeout` – Time (ms) to wait for data before considering the stream unhealthy.
- `enableStreamHealthCheck` – Enable automatic health monitoring.
- `reconnectOnHealthFailure` – When enabled, the client reconnects if the health check fails.
- `enableHardReload` – If `true`, the process can restart itself after repeated failures.
- `hardReloadAfterAttempts` – Number of failed reconnects before performing a hard reload.
- `hardReloadCooldownMs` – Cooldown between hard reload attempts.
- `maxHardReloads` – Maximum hard reloads allowed before exiting.
- `hardReloadRestartCommand` – Shell command executed to restart the app after a hard reload.

### orderBookState

Controls how the local order book is maintained.

- `maxLevels` – Maximum number of price levels to keep on each side of the book.
- `maxPriceDistance` – Furthest price distance (as a fraction of price) to track before pruning.
- `pruneIntervalMs` – Interval for periodically removing stale levels.
- `maxErrorRate` – Allowed percentage of mismatched depth updates before resyncing.
- `staleThresholdMs` – Time in ms after which the book is considered stale if no updates are received.

### anomalyDetector

Parameters for detecting unusual behaviour in trades and depth.

- `windowSize` – Number of trade events considered for each analysis window.
- `anomalyCooldownMs` – Cooldown between anomaly alerts.
- `icebergDetectionWindow` – Window (ms) used to spot iceberg orders.
- `volumeImbalanceThreshold` – Ratio of aggressive to passive volume required to flag an anomaly.
- `absorptionRatioThreshold` – Ratio used to identify absorption-style anomalies.
- `normalSpreadBps` – Typical spread in basis points used for baseline comparisons.
- `minHistory` – Minimum number of historical samples before producing signals.
- `orderSizeAnomalyThreshold` – Z-score threshold for unusually large trades.
- `tickSize` – Minimum price increment for calculations.
- `flowWindowMs`, `orderSizeWindowMs` – Optional windows for flow and order-size statistics.
- `volatilityThreshold` – Minimum realized volatility to consider conditions extreme.
- `spreadThresholdBps` – Spread threshold (basis points) for detecting liquidity voids.
- `extremeVolatilityWindowMs` – Window for measuring high volatility periods.
- `liquidityCheckWindowMs` – Window for assessing depth liquidity health.
- `whaleCooldownMs` – Cooldown before reporting repeated whale trades.
- `marketHealthWindowMs` – Window used to gauge overall market health before raising alerts.

### spoofingDetector

- `wallTicks` – Minimum wall width in ticks to monitor.
- `minWallSize` – Minimum size of a wall (in lots/contracts) to be considered.
- `dynamicWallWidth` – When `true`, wall width adapts with volatility.
- `testLogMinSpoof` – Minimum spoof size to log when running in test mode.

### exhaustion

Settings for the ExhaustionDetector (aggressive flow depletion).

- `minAggVolume` – Minimum aggressive volume required to start analysis.
- `threshold` – Confidence level (0‑1) to trigger an exhaustion signal.
- `windowMs` – Lookback window used for volume statistics.
- `zoneTicks` – Width of the detection zone in ticks.
- `eventCooldownMs` – Minimum time between signals for the same zone.
- `maxPassiveRatio` – Maximum ratio of current passive liquidity versus average to still consider exhaustion.
- `pricePrecision` – Number of decimal places for price calculations.
- `moveTicks` – Expected follow‑through move in ticks to confirm the event.
- `confirmationTimeout` – Time to wait for confirmation before discarding the signal.
- `maxRevisitTicks` – Maximum ticks price may revisit the zone before invalidating it.
- `features` – Feature flags enabling advanced logic:
    - `depletionTracking`, `spreadAdjustment`, `spoofingDetection`, `autoCalibrate`, `adaptiveZone`, `multiZone`, `volumeVelocity`, `passiveHistory`.

### absorption

Configuration for the AbsorptionDetector.

- `minAggVolume` – Minimum aggressive volume hitting the wall.
- `threshold` – Confidence score required to emit a signal.
- `windowMs` – Analysis window size in ms.
- `zoneTicks` – Width of the price zone monitored for absorption.
- `eventCooldownMs` – Cooldown between absorption signals from the same zone.
- `minPassiveMultiplier` – Passive volume must exceed aggressive by this multiplier.
- `maxAbsorptionRatio` – Upper bound on the aggressive/passive ratio considered valid.
- `pricePrecision` – Decimal precision for prices.
- `moveTicks` – Required move away from the zone to confirm absorption.
- `confirmationTimeout` – How long to wait for price confirmation in ms.
- `maxRevisitTicks` – Allowed revisit distance before the zone is invalidated.
- `features` – Feature toggles: `spoofingDetection`, `adaptiveZone`, `passiveHistory`, `multiZone`, `autoCalibrate`, `icebergDetection`, `liquidityGradient`, `spreadAdjustment`, `absorptionVelocity`.

### deltaCvdConfirmation

- `windowsSec` – Array of window lengths (seconds) for cumulative volume delta checks.
- `minTradesPerSec` – Minimum trade frequency required for reliable stats.
- `minVolPerSec` – Minimum volume per second to keep calculations meaningful.
- `minZ` – Z-score threshold for confirming flow direction.
- `pricePrecision` – Decimal precision used.
- `volatilityLookbackSec` – Historical window for volatility baseline.
- `priceCorrelationWeight` – Weighting for price correlation in confidence score.
- `volumeConcentrationWeight` – Weighting for volume concentration factor.
- `adaptiveThresholdMultiplier` – Multiplier for adaptive z-score thresholds.
- `maxDivergenceAllowed` – Maximum allowed price/CVD divergence.
- `stateCleanupIntervalSec` – How often to clean old state data.
- `dynamicThresholds` – Use adaptive thresholds based on recent volatility.
- `logDebug` – Enable extra debugging output.

### swingPredictor

- `lookaheadMs` – How far ahead (ms) to evaluate price moves when generating predictions.
- `retraceTicks` – Number of ticks price must retrace for a valid swing.
- `pricePrecision` – Decimal precision.
- `signalCooldownMs` – Cooldown between swing signals.

### accumulationDetector

- `minDurationMs` – Minimum time period for accumulation to be considered.
- `zoneSize` – Price width of the accumulation zone as a percentage.
- `minRatio` – Minimum passive/aggressive ratio to flag accumulation.
- `minRecentActivityMs` – Recent activity requirement to avoid stale zones.
- `minAggVolume` – Minimum aggressive volume before analysis starts.
- `trackSide` – If `true`, accumulation is tracked separately on bid and ask.
- `pricePrecision` – Decimal precision.
- `accumulationThreshold` – Confidence score needed to emit a signal.

### distributionDetector

- `minDurationMs` – Minimum duration for distribution phases.
- `minRatio` – Minimum ratio of selling to buying pressure.
- `minRecentActivityMs` – Recent trade activity requirement.
- `threshold` – Confidence value required to trigger distribution signals.
- `volumeConcentrationWeight` – Weighting factor for how concentrated the volume must be.
- `strengthAnalysis` – Include analysis of order book strength.
- `velocityAnalysis` – Include analysis of trade velocity.
- `symbol` – Symbol to monitor (usually same as top-level symbol).
- `minAggVolume` – Minimum aggressive volume in the window.
- `pricePrecision` – Decimal precision.

### tradesProcessor

- `storageTime` – How long trade data is stored in milliseconds.
- `maxBacklogRetries` – Number of attempts to replay missing trades.
- `backlogBatchSize` – How many trades to request per backlog batch.
- `maxMemoryTrades` – Maximum number of trades kept in memory.
- `saveQueueSize` – Size of the queue used for persisting data to disk.
- `healthCheckInterval` – Interval for checking that the processor is healthy.

### signalManager

- `confidenceThreshold` – Minimum confidence score for any detector signal to be forwarded.
- `signalTimeout` – Time after which an unconfirmed signal is discarded.
- `enableMarketHealthCheck` – When `true`, new signals are suppressed in unhealthy market conditions.
- `enableAlerts` – Master switch for sending alerts via the webhook.

### signalCoordinator

- `maxConcurrentProcessing` – Maximum number of signals processed simultaneously.
- `processingTimeoutMs` – Timeout for each signal processing task.
- `retryAttempts` – How many times a failed task is retried.
- `retryDelayMs` – Wait time between retries.
- `enableMetrics` – Emit processing metrics for monitoring.
- `logLevel` – Verbosity of coordinator logs (`info`, `debug`, etc.).

### orderBookProcessor

- `binSize` – Size of each price bin used when compressing depth data.
- `numLevels` – Number of price levels to maintain per side.
- `maxBufferSize` – Maximum number of depth updates buffered before processing.
- `tickSize` – Minimum tick size used.
- `precision` – Decimal precision for output.

---

## Notes on Tweaking Values

Lowering thresholds (like `minAggVolume` or `threshold`) generally produces more signals but with higher noise. Increasing cooldowns and confirmation requirements results in fewer, higher‑quality alerts at the expense of responsiveness. Each trading pair may require tuning to balance sensitivity and false positives.

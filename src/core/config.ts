// src/core/config.ts
import dotenv from "dotenv";
dotenv.config();
import { readFileSync } from "fs";
import { resolve } from "path";
import { AnomalyDetectorOptions } from "../services/anomalyDetector.js";
import { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import { OrderBookStateOptions } from "../market/orderBookState.js";
import type { ConfigType, AllowedSymbols } from "../types/configTypes.js";
import type { ExhaustionSettings } from "../indicators/exhaustionDetector.js";
import type { AbsorptionSettings } from "../indicators/absorptionDetector.js";
import type { OrderflowPreprocessorOptions } from "../market/orderFlowPreprocessor.js";
import type { DataStreamConfig } from "../trading/dataStreamManager.js";
import type { AccumulationSettings } from "../indicators/interfaces/detectorInterfaces.js";
import type { DeltaCVDConfirmationSettings } from "../indicators/deltaCVDConfirmation.js";
import type { SuperiorFlowSettings } from "../indicators/base/flowDetectorBase.js";
import type { IndividualTradesManagerConfig } from "../data/individualTradesManager.js";
import type { MicrostructureAnalyzerConfig } from "../data/microstructureAnalyzer.js";
import type { TradesProcessorOptions } from "../clients/tradesProcessor.js";
import type { SignalManagerConfig } from "../trading/signalManager.js";
import type { SignalCoordinatorConfig } from "../services/signalCoordinator.js";
import type { OrderBookProcessorOptions } from "../clients/orderBookProcessor.js";
const rawConfig = readFileSync(resolve(process.cwd(), "config.json"), "utf-8");
const cfg: ConfigType = JSON.parse(rawConfig) as ConfigType;

// Resolve symbol from env first then fallback to config
const ENV_SYMBOL = process.env.SYMBOL?.toUpperCase();
const CONFIG_SYMBOL = (ENV_SYMBOL ?? cfg.symbol) as AllowedSymbols;
const SYMBOL_CFG =
    cfg.symbols[CONFIG_SYMBOL as keyof typeof cfg.symbols] ??
    (cfg.symbols as Record<string, unknown>)[cfg.symbol];
const DATASTREAM_CFG = SYMBOL_CFG?.dataStream ?? {};

/**
 * Centralized configuration management
 */

export class Config {
    // Symbol configuration
    static readonly SYMBOL: AllowedSymbols = CONFIG_SYMBOL;
    static readonly PRICE_PRECISION = Number(SYMBOL_CFG?.pricePrecision ?? 2);
    static readonly TICK_SIZE = 1 / Math.pow(10, this.PRICE_PRECISION);
    static readonly MAX_STORAGE_TIME = Number(cfg.maxStorageTime ?? 5_400_000); // 90 minutes
    static readonly WINDOW_MS = Number(SYMBOL_CFG?.windowMs ?? 90000);

    // Server configuration
    static readonly HTTP_PORT = Number(cfg.httpPort ?? 3000);
    static readonly WS_PORT = Number(cfg.wsPort ?? 3001);
    static readonly API_KEY = process.env.API_KEY;
    static readonly API_SECRET = process.env.API_SECRET;
    static readonly NODE_ENV = cfg.nodeEnv ?? "production";
    static readonly ALERT_WEBHOOK_URL = cfg.alertWebhookUrl as
        | string
        | undefined;
    static readonly ALERT_COOLDOWN_MS = Number(cfg.alertCooldownMs ?? 300000);

    static readonly PREPROCESSOR: OrderflowPreprocessorOptions = {
        symbol: Config.SYMBOL,
        pricePrecision: Config.PRICE_PRECISION,
        bandTicks: SYMBOL_CFG?.bandTicks ?? 5,
        tickSize: Config.TICK_SIZE,
        emitDepthMetrics: SYMBOL_CFG?.emitDepthMetrics ?? false,
    };

    static readonly DATASTREAM: DataStreamConfig = {
        symbol: Config.SYMBOL,
        reconnectDelay: DATASTREAM_CFG.reconnectDelay ?? 5000,
        maxReconnectAttempts: DATASTREAM_CFG.maxReconnectAttempts ?? 10,
        depthUpdateSpeed: DATASTREAM_CFG.depthUpdateSpeed ?? "100ms",
        enableHeartbeat: DATASTREAM_CFG.enableHeartbeat ?? true,
        heartbeatInterval: DATASTREAM_CFG.heartbeatInterval ?? 30000,
        maxBackoffDelay: DATASTREAM_CFG.maxBackoffDelay ?? 300000,
        streamHealthTimeout: DATASTREAM_CFG.streamHealthTimeout ?? 60000,
        enableStreamHealthCheck: DATASTREAM_CFG.enableStreamHealthCheck ?? true,
        reconnectOnHealthFailure:
            DATASTREAM_CFG.reconnectOnHealthFailure ?? true,
        enableHardReload: DATASTREAM_CFG.enableHardReload ?? false,
        hardReloadAfterAttempts: DATASTREAM_CFG.hardReloadAfterAttempts ?? 10,
        hardReloadCooldownMs: DATASTREAM_CFG.hardReloadCooldownMs ?? 300000,
        maxHardReloads: DATASTREAM_CFG.maxHardReloads ?? 3,
        hardReloadRestartCommand:
            DATASTREAM_CFG.hardReloadRestartCommand ?? "process.exit",
    };

    static readonly ORDERBOOK_STATE: OrderBookStateOptions = {
        symbol: Config.SYMBOL,
        pricePrecision: Config.PRICE_PRECISION,
        maxLevels: Number(
            cfg.symbols[cfg.symbol].orderBookState?.maxLevels ?? 2000
        ),
        maxPriceDistance: Number(
            cfg.symbols[cfg.symbol].orderBookState?.maxPriceDistance ?? 0.02
        ),
        pruneIntervalMs: Number(
            cfg.symbols[cfg.symbol].orderBookState?.pruneIntervalMs ?? 60000
        ),
        maxErrorRate: Number(
            cfg.symbols[cfg.symbol].orderBookState?.maxErrorRate ?? 5
        ),
        staleThresholdMs: Number(
            cfg.symbols[cfg.symbol].orderBookState?.staleThresholdMs ?? 300_000
        ), // 15 minutes
    };

    static readonly TRADES_PROCESSOR: TradesProcessorOptions = {
        symbol: Config.SYMBOL,
        storageTime: Number(
            cfg.symbols[cfg.symbol].tradesProcessor?.storageTime ??
                Config.MAX_STORAGE_TIME
        ),
        maxBacklogRetries: Number(
            cfg.symbols[cfg.symbol].tradesProcessor?.maxBacklogRetries ?? 3
        ),
        backlogBatchSize: Number(
            cfg.symbols[cfg.symbol].tradesProcessor?.backlogBatchSize ?? 1000
        ),
        maxMemoryTrades: Number(
            cfg.symbols[cfg.symbol].tradesProcessor?.maxMemoryTrades ?? 50000
        ),
        saveQueueSize: Number(
            cfg.symbols[cfg.symbol].tradesProcessor?.saveQueueSize ?? 5000
        ),
        healthCheckInterval: Number(
            cfg.symbols[cfg.symbol].tradesProcessor?.healthCheckInterval ??
                30000
        ),
    };

    static readonly SIGNAL_MANAGER: SignalManagerConfig = {
        confidenceThreshold: Number(
            cfg.symbols[cfg.symbol].signalManager?.confidenceThreshold ?? 0.65
        ),
        signalTimeout: Number(
            cfg.symbols[cfg.symbol].signalManager?.signalTimeout ?? 300000
        ),
        enableMarketHealthCheck:
            cfg.symbols[cfg.symbol].signalManager?.enableMarketHealthCheck ??
            true,
        enableAlerts:
            cfg.symbols[cfg.symbol].signalManager?.enableAlerts ?? true,
    };

    static readonly SIGNAL_COORDINATOR: SignalCoordinatorConfig = {
        maxConcurrentProcessing: Number(
            cfg.symbols[cfg.symbol].signalCoordinator
                ?.maxConcurrentProcessing ?? 5
        ),
        processingTimeoutMs: Number(
            cfg.symbols[cfg.symbol].signalCoordinator?.processingTimeoutMs ??
                30000
        ),
        retryAttempts: Number(
            cfg.symbols[cfg.symbol].signalCoordinator?.retryAttempts ?? 3
        ),
        retryDelayMs: Number(
            cfg.symbols[cfg.symbol].signalCoordinator?.retryDelayMs ?? 1000
        ),
        enableMetrics:
            cfg.symbols[cfg.symbol].signalCoordinator?.enableMetrics ?? true,
        logLevel: cfg.symbols[cfg.symbol].signalCoordinator?.logLevel ?? "info",
    };

    static readonly ORDERBOOK_PROCESSOR: OrderBookProcessorOptions = {
        binSize: Number(
            cfg.symbols[cfg.symbol].orderBookProcessor?.binSize ?? 5
        ),
        numLevels: Number(
            cfg.symbols[cfg.symbol].orderBookProcessor?.numLevels ?? 20
        ),
        maxBufferSize: Number(
            cfg.symbols[cfg.symbol].orderBookProcessor?.maxBufferSize ?? 1000
        ),
        tickSize: Number(
            cfg.symbols[cfg.symbol].orderBookProcessor?.tickSize ??
                Config.TICK_SIZE
        ),
        precision: Number(
            cfg.symbols[cfg.symbol].orderBookProcessor?.precision ??
                Config.PRICE_PRECISION
        ),
    };

    static readonly ABSORPTION_DETECTOR: AbsorptionSettings = {
        symbol: Config.SYMBOL,
        minAggVolume: Number(
            cfg.symbols[cfg.symbol].absorption?.minAggVolume ?? 600
        ),
        absorptionThreshold: Number(
            cfg.symbols[cfg.symbol].absorption?.threshold ?? 0.75
        ),
        windowMs: this.WINDOW_MS,
        zoneTicks: Number(cfg.symbols[cfg.symbol].absorption?.zoneTicks ?? 3),
        eventCooldownMs: Number(
            cfg.symbols[cfg.symbol].absorption?.eventCooldownMs ?? 15000
        ),
        minPassiveMultiplier: Number(
            cfg.symbols[cfg.symbol].absorption?.minPassiveMultiplier ?? 2.0
        ),
        maxAbsorptionRatio: Number(
            cfg.symbols[cfg.symbol].absorption?.maxAbsorptionRatio ?? 0.3
        ),
        pricePrecision: Number(
            cfg.symbols[cfg.symbol].absorption?.pricePrecision ??
                Config.PRICE_PRECISION
        ),
        minInitialMoveTicks: Number(
            cfg.symbols[cfg.symbol].absorption?.moveTicks ?? 12
        ),
        confirmationTimeoutMs: Number(
            cfg.symbols[cfg.symbol].absorption?.confirmationTimeout ?? 60000
        ),
        maxRevisitTicks: Number(
            cfg.symbols[cfg.symbol].absorption?.maxRevisitTicks ?? 5
        ),
        features: {
            spoofingDetection:
                cfg.symbols[cfg.symbol].absorption?.features
                    ?.spoofingDetection ?? false,
            adaptiveZone:
                cfg.symbols[cfg.symbol].absorption?.features?.adaptiveZone ??
                false,
            passiveHistory:
                cfg.symbols[cfg.symbol].absorption?.features?.passiveHistory ??
                false,
            multiZone:
                cfg.symbols[cfg.symbol].absorption?.features?.multiZone ??
                false,
            autoCalibrate:
                cfg.symbols[cfg.symbol].absorption?.features?.autoCalibrate ??
                false,
            icebergDetection:
                cfg.symbols[cfg.symbol].absorption?.features
                    ?.icebergDetection ?? false,
            liquidityGradient:
                cfg.symbols[cfg.symbol].absorption?.features
                    ?.liquidityGradient ?? false,
            spreadAdjustment:
                cfg.symbols[cfg.symbol].absorption?.features
                    ?.spreadAdjustment ?? false,
            absorptionVelocity:
                cfg.symbols[cfg.symbol].absorption?.features
                    ?.absorptionVelocity ?? false,
        },
    };

    static readonly EXHAUSTION_DETECTOR: ExhaustionSettings = {
        symbol: Config.SYMBOL,
        minAggVolume: Number(
            cfg.symbols[cfg.symbol].exhaustion?.minAggVolume ?? 600
        ),
        exhaustionThreshold: Number(
            cfg.symbols[cfg.symbol].exhaustion?.threshold ?? 0.7
        ),
        windowMs: Number(Config.WINDOW_MS ?? 90000),
        zoneTicks: cfg.symbols[cfg.symbol].exhaustion?.zoneTicks ?? 3,
        eventCooldownMs:
            cfg.symbols[cfg.symbol].exhaustion?.eventCooldownMs ?? 15000,
        maxPassiveRatio:
            cfg.symbols[cfg.symbol].exhaustion?.maxPassiveRatio ?? 0.5,
        pricePrecision: Config.PRICE_PRECISION,
        minInitialMoveTicks:
            cfg.symbols[cfg.symbol].exhaustion?.moveTicks ?? 12,
        confirmationTimeoutMs:
            cfg.symbols[cfg.symbol].exhaustion?.confirmationTimeout ?? 60000,
        maxRevisitTicks:
            cfg.symbols[cfg.symbol].exhaustion?.maxRevisitTicks ?? 5,
        features: {
            depletionTracking:
                cfg.symbols[cfg.symbol].exhaustion?.features
                    ?.depletionTracking ?? false,
            spreadAdjustment:
                cfg.symbols[cfg.symbol].exhaustion?.features
                    ?.spreadAdjustment ?? false,
            spoofingDetection:
                cfg.symbols[cfg.symbol].exhaustion?.features
                    ?.spoofingDetection ?? false,
            autoCalibrate:
                cfg.symbols[cfg.symbol].exhaustion?.features?.autoCalibrate ??
                false,
            adaptiveZone:
                cfg.symbols[cfg.symbol].exhaustion?.features?.adaptiveZone ??
                false,
            multiZone:
                cfg.symbols[cfg.symbol].exhaustion?.features?.multiZone ??
                false,
            volumeVelocity:
                cfg.symbols[cfg.symbol].exhaustion?.features?.volumeVelocity ??
                false,
            passiveHistory:
                cfg.symbols[cfg.symbol].exhaustion?.features?.passiveHistory ??
                false,
        },
    };

    static readonly ACCUMULATION_DETECTOR: AccumulationSettings = {
        symbol: Config.SYMBOL,
        windowMs: this.WINDOW_MS,
        minDurationMs:
            cfg.symbols[cfg.symbol].accumulationDetector?.minDurationMs ??
            180_000,
        minRatio: cfg.symbols[cfg.symbol].accumulationDetector?.minRatio ?? 1.2,
        minRecentActivityMs:
            cfg.symbols[cfg.symbol].accumulationDetector?.minRecentActivityMs ??
            60_000,
        minAggVolume:
            cfg.symbols[cfg.symbol].accumulationDetector?.minAggVolume ?? 5,
        accumulationThreshold:
            cfg.symbols[cfg.symbol].accumulationDetector
                ?.accumulationThreshold ?? 0.55,
        pricePrecision: Config.PRICE_PRECISION,
    };

    static readonly DELTACVD_DETECTOR: DeltaCVDConfirmationSettings = {
        symbol: Config.SYMBOL,
        windowsSec: cfg.symbols[cfg.symbol].deltaCvdConfirmation?.windowSec ?? [
            60, 300, 900,
        ],

        minTradesPerSec:
            cfg.symbols[cfg.symbol].deltaCvdConfirmation?.minTradesPerSec ??
            0.5,
        minVolPerSec: Number(
            cfg.symbols[cfg.symbol].deltaCvdConfirmation?.minVolPerSec ?? 20
        ),
        minZ: cfg.symbols[cfg.symbol].deltaCvdConfirmation?.minZ ?? 3,
        pricePrecision: Config.PRICE_PRECISION,
    };

    static readonly DISTRIBUTION_DETECTOR: SuperiorFlowSettings = {
        symbol: Config.SYMBOL,
        windowMs: this.WINDOW_MS,
        minDurationMs:
            cfg.symbols[cfg.symbol].distributionDetector?.minDurationMs ??
            300_000, // 5 minutes
        minRatio: cfg.symbols[cfg.symbol].distributionDetector?.minRatio ?? 1.8, // Higher threshold for distribution
        minRecentActivityMs:
            cfg.symbols[cfg.symbol].distributionDetector?.minRecentActivityMs ??
            60_000,
        threshold:
            cfg.symbols[cfg.symbol].distributionDetector?.threshold ?? 0.65, // Higher confidence threshold
        volumeConcentrationWeight:
            cfg.symbols[cfg.symbol].distributionDetector
                ?.volumeConcentrationWeight ?? 0.2,
        strengthAnalysis:
            cfg.symbols[cfg.symbol].distributionDetector?.strengthAnalysis ??
            true,
        velocityAnalysis:
            cfg.symbols[cfg.symbol].distributionDetector?.velocityAnalysis ??
            false,
        flowDirection: "distribution",
        minAggVolume:
            cfg.symbols[cfg.symbol].distributionDetector?.minAggVolume ?? 8, // Higher volume threshold for distribution
        pricePrecision: Config.PRICE_PRECISION,
    };

    static readonly INDIVIDUAL_TRADES_MANAGER: IndividualTradesManagerConfig = {
        enabled: process.env.INDIVIDUAL_TRADES_ENABLED === "true" || false,

        criteria: {
            minOrderSizePercentile: Number(
                process.env.INDIVIDUAL_TRADES_SIZE_PERCENTILE ?? 95
            ),
            keyLevelsEnabled:
                process.env.INDIVIDUAL_TRADES_KEY_LEVELS === "true" || false,
            anomalyPeriodsEnabled:
                process.env.INDIVIDUAL_TRADES_ANOMALY_PERIODS === "true" ||
                true,
            highVolumePeriodsEnabled:
                process.env.INDIVIDUAL_TRADES_HIGH_VOLUME === "true" || true,
        },

        cache: {
            maxSize: Number(process.env.INDIVIDUAL_TRADES_CACHE_SIZE ?? 10000),
            ttlMs: Number(process.env.INDIVIDUAL_TRADES_CACHE_TTL ?? 300000), // 5 minutes
        },

        rateLimit: {
            maxRequestsPerSecond: Number(
                process.env.INDIVIDUAL_TRADES_RATE_LIMIT ?? 5
            ),
            batchSize: Number(process.env.INDIVIDUAL_TRADES_BATCH_SIZE ?? 100),
        },
    };

    static readonly MICROSTRUCTURE_ANALYZER: MicrostructureAnalyzerConfig = {
        burstThresholdMs: Number(
            process.env.MICROSTRUCTURE_BURST_THRESHOLD ?? 100
        ),
        uniformityThreshold: Number(
            process.env.MICROSTRUCTURE_UNIFORMITY_THRESHOLD ?? 0.2
        ),
        sizingConsistencyThreshold: Number(
            process.env.MICROSTRUCTURE_SIZING_THRESHOLD ?? 0.15
        ),
        persistenceWindowSize: Number(
            process.env.MICROSTRUCTURE_PERSISTENCE_WINDOW ?? 5
        ),
        marketMakingSpreadThreshold: Number(
            process.env.MICROSTRUCTURE_MM_SPREAD_THRESHOLD ?? 0.01
        ),
        icebergSizeRatio: Number(
            process.env.MICROSTRUCTURE_ICEBERG_RATIO ?? 0.8
        ),
        arbitrageTimeThreshold: Number(
            process.env.MICROSTRUCTURE_ARBITRAGE_TIME ?? 50
        ),
    };

    static readonly SPOOFING_DETECTOR: SpoofingDetectorConfig = {
        tickSize: this.TICK_SIZE,
        wallTicks: Number(
            cfg.symbols[cfg.symbol].spoofingDetector?.wallTicks ?? 15
        ),
        minWallSize: Number(
            cfg.symbols[cfg.symbol].spoofingDetector?.minWallSize ?? 50
        ),
        dynamicWallWidth:
            cfg.symbols[cfg.symbol].spoofingDetector?.dynamicWallWidth ?? true,
        testLogMinSpoof: Number(
            cfg.symbols[cfg.symbol].spoofingDetector?.testLogMinSpoof ?? 100
        ),
    };

    static readonly ANOMALY_DETECTOR: AnomalyDetectorOptions = {
        windowSize: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.windowSize ?? 9000
        ),
        anomalyCooldownMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.anomalyCooldownMs ??
                300_000
        ),
        volumeImbalanceThreshold: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.volumeImbalanceThreshold ??
                0.65
        ),
        normalSpreadBps: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.normalSpreadBps ?? 10
        ),
        minHistory: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.minHistory ?? 50
        ),
        tickSize: this.TICK_SIZE,
        flowWindowMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.flowWindowMs ?? 900_000
        ),
        orderSizeWindowMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.orderSizeWindowMs ??
                900_000
        ),
        volatilityThreshold: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.volatilityThreshold ??
                0.005
        ),
        spreadThresholdBps: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.spreadThresholdBps ?? 100
        ),
        extremeVolatilityWindowMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector
                ?.extremeVolatilityWindowMs ?? 900_000
        ),
        liquidityCheckWindowMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.liquidityCheckWindowMs ??
                900_000
        ),
        whaleCooldownMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.whaleCooldownMs ?? 300_000
        ),
        marketHealthWindowMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.marketHealthWindowMs ??
                900_000
        ),
    };

    /**
     * Validate configuration on startup
     */
    static validate(): void {
        if (!this.SYMBOL) {
            throw new Error("Missing SYMBOL configuration");
        }

        if (this.HTTP_PORT < 1 || this.HTTP_PORT > 65535) {
            throw new Error(`Invalid HTTP_PORT: ${this.HTTP_PORT}`);
        }

        if (this.WS_PORT < 1 || this.WS_PORT > 65535) {
            throw new Error(`Invalid WS_PORT: ${this.WS_PORT}`);
        }
    }
}

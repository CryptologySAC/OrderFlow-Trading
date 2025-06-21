// src/core/config.ts
import dotenv from "dotenv";
dotenv.config();
import { readFileSync } from "fs";
import { resolve } from "path";
import { AnomalyDetectorOptions } from "../services/anomalyDetector.js";
import { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import { OrderBookStateOptions } from "../market/orderBookState.js";
import type {
    ConfigType,
    AllowedSymbols,
    ZoneDetectorSymbolConfig,
    EnhancedZoneFormationConfig,
    MarketDataStorageConfig,
} from "../types/configTypes.js";
import type { ZoneDetectorConfig } from "../types/zoneTypes.js";
import type { ExhaustionSettings } from "../indicators/exhaustionDetector.js";
import type { AbsorptionSettings } from "../indicators/absorptionDetector.js";
import type { OrderflowPreprocessorOptions } from "../market/orderFlowPreprocessor.js";
import type { DataStreamConfig } from "../trading/dataStreamManager.js";
import type {
    AccumulationSettings,
    SuperiorFlowSettings,
} from "../indicators/interfaces/detectorInterfaces.js";
import type { DeltaCVDConfirmationSettings } from "../indicators/deltaCVDConfirmation.js";
import type { SupportResistanceConfig } from "../indicators/supportResistanceDetector.js";
import type { IndividualTradesManagerConfig } from "../data/individualTradesManager.js";
import type { MicrostructureAnalyzerConfig } from "../data/microstructureAnalyzer.js";
import type { TradesProcessorOptions } from "../market/processors/tradesProcessor.js";
import type { SignalManagerConfig } from "../trading/signalManager.js";
import type { SignalCoordinatorConfig } from "../services/signalCoordinator.js";
import type { OrderBookProcessorOptions } from "../market/processors/orderBookProcessor.js";
import type { MQTTConfig } from "../types/configTypes.js";
let cfg: ConfigType = JSON.parse(
    readFileSync(resolve(process.cwd(), "config.json"), "utf-8")
) as ConfigType;

let ENV_SYMBOL: string | undefined = process.env.SYMBOL?.toUpperCase();
let CONFIG_SYMBOL: AllowedSymbols = (ENV_SYMBOL ??
    cfg.symbol) as AllowedSymbols;
let SYMBOL_CFG =
    cfg.symbols[CONFIG_SYMBOL as keyof typeof cfg.symbols] ??
    (cfg.symbols as Record<string, unknown>)[cfg.symbol];
let DATASTREAM_CFG: Partial<DataStreamConfig> = SYMBOL_CFG?.dataStream ?? {};
let ZONE_CFG: ZoneDetectorSymbolConfig =
    cfg.zoneDetectors?.[CONFIG_SYMBOL] ?? ({} as ZoneDetectorSymbolConfig);
let ENHANCED_ZONE_CFG: EnhancedZoneFormationConfig =
    cfg.enhancedZoneFormation ?? getDefaultEnhancedZoneFormationConfig();

/**
 * Default enhanced zone formation configuration
 */
function getDefaultEnhancedZoneFormationConfig(): EnhancedZoneFormationConfig {
    return {
        icebergDetection: {
            minSize: 10,
            maxSize: 200,
            priceStabilityTolerance: 0.02,
            sizeConsistencyThreshold: 0.6,
            sideDominanceThreshold: 0.7,
        },
        priceEfficiency: {
            baseImpactRate: 0.0002,
            maxVolumeMultiplier: 5,
            minEfficiencyThreshold: 0.0,
        },
        institutional: {
            minRatio: 0.3,
            sizeThreshold: 50,
            detectionWindow: 15,
        },
        detectorThresholds: {
            accumulation: {
                minScore: 0.75,
                minAbsorptionRatio: 0.75,
                maxAggressiveRatio: 0.35,
                minPriceStability: 0.85,
                minInstitutionalScore: 0.4,
            },
            distribution: {
                minScore: 0.55,
                minSellingRatio: 0.65,
                maxSupportRatio: 0.35,
                minPriceStability: 0.75,
                minInstitutionalScore: 0.3,
            },
        },
        adaptiveThresholds: {
            volatility: {
                high: {
                    accumulation: {
                        minAbsorptionRatio: 0.8,
                        maxAggressiveRatio: 0.25,
                    },
                    distribution: {
                        minSellingRatio: 0.7,
                        maxSupportRatio: 0.3,
                    },
                },
                medium: {
                    accumulation: {
                        minAbsorptionRatio: 0.75,
                        maxAggressiveRatio: 0.35,
                    },
                    distribution: {
                        minSellingRatio: 0.65,
                        maxSupportRatio: 0.35,
                    },
                },
                low: {
                    accumulation: {
                        minAbsorptionRatio: 0.7,
                        maxAggressiveRatio: 0.4,
                    },
                    distribution: {
                        minSellingRatio: 0.6,
                        maxSupportRatio: 0.4,
                    },
                },
            },
        },
    };
}

/**
 * Centralized configuration management
 */

export class Config {
    // Symbol configuration
    static get SYMBOL(): AllowedSymbols {
        return CONFIG_SYMBOL;
    }
    static get PRICE_PRECISION(): number {
        return Number(SYMBOL_CFG?.pricePrecision ?? 2);
    }
    static get TICK_SIZE(): number {
        return 1 / Math.pow(10, Config.PRICE_PRECISION);
    }
    static get MAX_STORAGE_TIME(): number {
        return Number(cfg.maxStorageTime ?? 5_400_000); // 90 minutes
    }
    static get WINDOW_MS(): number {
        return Number(SYMBOL_CFG?.windowMs ?? 90000);
    }

    // Server configuration
    static get HTTP_PORT(): number {
        return Number(cfg.httpPort ?? 3000);
    }
    static get WS_PORT(): number {
        return Number(cfg.wsPort ?? 3001);
    }
    static get MQTT(): MQTTConfig | undefined {
        return cfg.mqtt;
    }
    static get API_KEY(): string | undefined {
        return process.env.API_KEY;
    }
    static get API_SECRET(): string | undefined {
        return process.env.API_SECRET;
    }
    static get LLM_API_KEY(): string | undefined {
        return process.env.LLM_API_KEY;
    }
    static get LLM_MODEL(): string {
        return process.env.LLM_MODEL ?? "gpt-3.5-turbo";
    }
    static get NODE_ENV(): string {
        return cfg.nodeEnv ?? "production";
    }
    static get ALERT_WEBHOOK_URL(): string | undefined {
        return cfg.alertWebhookUrl as string | undefined;
    }
    static get ALERT_COOLDOWN_MS(): number {
        return Number(cfg.alertCooldownMs ?? 300000);
    }

    static get PREPROCESSOR(): OrderflowPreprocessorOptions {
        return {
            symbol: Config.SYMBOL,
            pricePrecision: Config.PRICE_PRECISION,
            quantityPrecision: SYMBOL_CFG?.quantityPrecision ?? 8, // Default 8 decimals for most crypto
            bandTicks: SYMBOL_CFG?.bandTicks ?? 5,
            tickSize: Config.TICK_SIZE,
            largeTradeThreshold: SYMBOL_CFG?.largeTradeThreshold ?? 100,
            maxEventListeners: SYMBOL_CFG?.maxEventListeners ?? 50,
            // Dashboard update configuration
            dashboardUpdateInterval: SYMBOL_CFG?.dashboardUpdateInterval ?? 200, // 200ms = 5 FPS
            maxDashboardInterval: SYMBOL_CFG?.maxDashboardInterval ?? 1000, // Max 1s between updates
            significantChangeThreshold:
                SYMBOL_CFG?.significantChangeThreshold ?? 0.001, // 0.1% price change
        };
    }

    static get DATASTREAM(): DataStreamConfig {
        return {
            symbol: Config.SYMBOL,
            reconnectDelay: DATASTREAM_CFG.reconnectDelay ?? 5000,
            maxReconnectAttempts: DATASTREAM_CFG.maxReconnectAttempts ?? 10,
            depthUpdateSpeed: DATASTREAM_CFG.depthUpdateSpeed ?? "100ms",
            enableHeartbeat: DATASTREAM_CFG.enableHeartbeat ?? true,
            heartbeatInterval: DATASTREAM_CFG.heartbeatInterval ?? 30000,
            maxBackoffDelay: DATASTREAM_CFG.maxBackoffDelay ?? 300000,
            streamHealthTimeout: DATASTREAM_CFG.streamHealthTimeout ?? 60000,
            enableStreamHealthCheck:
                DATASTREAM_CFG.enableStreamHealthCheck ?? true,
            reconnectOnHealthFailure:
                DATASTREAM_CFG.reconnectOnHealthFailure ?? true,
            enableHardReload: DATASTREAM_CFG.enableHardReload ?? false,
            hardReloadAfterAttempts:
                DATASTREAM_CFG.hardReloadAfterAttempts ?? 10,
            hardReloadCooldownMs: DATASTREAM_CFG.hardReloadCooldownMs ?? 300000,
            maxHardReloads: DATASTREAM_CFG.maxHardReloads ?? 3,
            hardReloadRestartCommand:
                DATASTREAM_CFG.hardReloadRestartCommand ?? "process.exit",
        };
    }

    static get ORDERBOOK_STATE(): OrderBookStateOptions {
        return {
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
                cfg.symbols[cfg.symbol].orderBookState?.staleThresholdMs ??
                    300_000
            ), // 15 minutes
        };
    }

    static get TRADES_PROCESSOR(): TradesProcessorOptions {
        return {
            symbol: Config.SYMBOL,
            storageTime: Number(
                cfg.symbols[cfg.symbol].tradesProcessor?.storageTime ??
                    Config.MAX_STORAGE_TIME
            ),
            maxBacklogRetries: Number(
                cfg.symbols[cfg.symbol].tradesProcessor?.maxBacklogRetries ?? 3
            ),
            backlogBatchSize: Number(
                cfg.symbols[cfg.symbol].tradesProcessor?.backlogBatchSize ??
                    1000
            ),
            maxMemoryTrades: Number(
                cfg.symbols[cfg.symbol].tradesProcessor?.maxMemoryTrades ??
                    50000
            ),
            saveQueueSize: Number(
                cfg.symbols[cfg.symbol].tradesProcessor?.saveQueueSize ?? 5000
            ),
            healthCheckInterval: Number(
                cfg.symbols[cfg.symbol].tradesProcessor?.healthCheckInterval ??
                    30000
            ),
        };
    }

    static get SIGNAL_MANAGER(): SignalManagerConfig {
        return {
            confidenceThreshold: Number(
                cfg.symbols[cfg.symbol].signalManager?.confidenceThreshold ??
                    0.65
            ),
            signalTimeout: Number(
                cfg.symbols[cfg.symbol].signalManager?.signalTimeout ?? 300000
            ),
            enableMarketHealthCheck:
                cfg.symbols[cfg.symbol].signalManager
                    ?.enableMarketHealthCheck ?? true,
            enableAlerts:
                cfg.symbols[cfg.symbol].signalManager?.enableAlerts ?? true,
        };
    }

    static get DETECTOR_CONFIDENCE_THRESHOLDS(): Record<string, number> {
        return (
            (cfg.symbols[cfg.symbol].signalManager
                ?.detectorThresholds as Record<string, number>) ?? {
                exhaustion: 0.8,
                cvd_confirmation: 0.7,
                distribution: 0.8,
                distribution_zone: 0.8,
                absorption: 0.85,
                accumulation: 0.95,
                accumulation_zone: 0.95,
            }
        );
    }

    static get DETECTOR_POSITION_SIZING(): Record<string, number> {
        return (
            (cfg.symbols[cfg.symbol].signalManager?.positionSizing as Record<
                string,
                number
            >) ?? {
                exhaustion: 1.0,
                cvd_confirmation: 0.7,
                distribution: 0.7,
                distribution_zone: 0.7,
                absorption: 0.5,
                accumulation: 0.0,
                accumulation_zone: 0.0,
            }
        );
    }

    static get SIGNAL_COORDINATOR(): SignalCoordinatorConfig {
        return {
            maxConcurrentProcessing: Number(
                cfg.symbols[cfg.symbol].signalCoordinator
                    ?.maxConcurrentProcessing ?? 5
            ),
            processingTimeoutMs: Number(
                cfg.symbols[cfg.symbol].signalCoordinator
                    ?.processingTimeoutMs ?? 30000
            ),
            retryAttempts: Number(
                cfg.symbols[cfg.symbol].signalCoordinator?.retryAttempts ?? 3
            ),
            retryDelayMs: Number(
                cfg.symbols[cfg.symbol].signalCoordinator?.retryDelayMs ?? 1000
            ),
            enableMetrics:
                cfg.symbols[cfg.symbol].signalCoordinator?.enableMetrics ??
                true,
            logLevel:
                cfg.symbols[cfg.symbol].signalCoordinator?.logLevel ?? "info",
        };
    }

    static get ORDERBOOK_PROCESSOR(): OrderBookProcessorOptions {
        return {
            binSize: Number(
                cfg.symbols[cfg.symbol].orderBookProcessor?.binSize ?? 5
            ),
            numLevels: Number(
                cfg.symbols[cfg.symbol].orderBookProcessor?.numLevels ?? 20
            ),
            maxBufferSize: Number(
                cfg.symbols[cfg.symbol].orderBookProcessor?.maxBufferSize ??
                    1000
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
    }

    static get ABSORPTION_DETECTOR(): AbsorptionSettings {
        return {
            symbol: Config.SYMBOL,
            minAggVolume: Number(
                cfg.symbols[cfg.symbol].absorption?.minAggVolume ?? 600
            ),
            absorptionThreshold: Number(
                cfg.symbols[cfg.symbol].absorption?.absorptionThreshold ?? 0.75
            ),
            windowMs: this.WINDOW_MS,
            zoneTicks: Number(
                cfg.symbols[cfg.symbol].absorption?.zoneTicks ?? 3
            ),
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
                cfg.symbols[cfg.symbol].absorption?.minInitialMoveTicks ?? 12
            ),
            confirmationTimeoutMs: Number(
                cfg.symbols[cfg.symbol].absorption?.confirmationTimeoutMs ??
                    60000
            ),
            maxRevisitTicks: Number(
                cfg.symbols[cfg.symbol].absorption?.maxRevisitTicks ?? 5
            ),
            features: {
                spoofingDetection:
                    cfg.symbols[cfg.symbol].absorption?.features
                        ?.spoofingDetection ?? false,
                adaptiveZone:
                    cfg.symbols[cfg.symbol].absorption?.features
                        ?.adaptiveZone ?? false,
                passiveHistory:
                    cfg.symbols[cfg.symbol].absorption?.features
                        ?.passiveHistory ?? false,
                multiZone:
                    cfg.symbols[cfg.symbol].absorption?.features?.multiZone ??
                    false,
                autoCalibrate:
                    cfg.symbols[cfg.symbol].absorption?.features
                        ?.autoCalibrate ?? false,
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
    }

    static get EXHAUSTION_DETECTOR(): ExhaustionSettings {
        return {
            symbol: Config.SYMBOL,
            minAggVolume: Number(
                cfg.symbols[cfg.symbol].exhaustion?.minAggVolume ?? 600
            ),
            exhaustionThreshold: Number(
                cfg.symbols[cfg.symbol].exhaustion?.exhaustionThreshold ?? 0.7
            ),
            windowMs: Number(Config.WINDOW_MS ?? 90000),
            zoneTicks: cfg.symbols[cfg.symbol].exhaustion?.zoneTicks ?? 3,
            eventCooldownMs:
                cfg.symbols[cfg.symbol].exhaustion?.eventCooldownMs ?? 15000,
            maxPassiveRatio:
                cfg.symbols[cfg.symbol].exhaustion?.maxPassiveRatio ?? 0.5,
            pricePrecision: Config.PRICE_PRECISION,
            minInitialMoveTicks:
                cfg.symbols[cfg.symbol].exhaustion?.minInitialMoveTicks ?? 12,
            confirmationTimeoutMs:
                cfg.symbols[cfg.symbol].exhaustion?.confirmationTimeoutMs ??
                60000,
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
                    cfg.symbols[cfg.symbol].exhaustion?.features
                        ?.autoCalibrate ?? false,
                adaptiveZone:
                    cfg.symbols[cfg.symbol].exhaustion?.features
                        ?.adaptiveZone ?? false,
                multiZone:
                    cfg.symbols[cfg.symbol].exhaustion?.features?.multiZone ??
                    false,
                volumeVelocity:
                    cfg.symbols[cfg.symbol].exhaustion?.features
                        ?.volumeVelocity ?? false,
                passiveHistory:
                    cfg.symbols[cfg.symbol].exhaustion?.features
                        ?.passiveHistory ?? false,
            },
        };
    }

    static get ACCUMULATION_DETECTOR(): AccumulationSettings {
        return {
            symbol: Config.SYMBOL,
            windowMs: this.WINDOW_MS,
            minDurationMs:
                cfg.symbols[cfg.symbol].accumulationDetector?.minDurationMs ??
                180_000,
            minRatio:
                cfg.symbols[cfg.symbol].accumulationDetector?.minRatio ?? 1.2,
            minRecentActivityMs:
                cfg.symbols[cfg.symbol].accumulationDetector
                    ?.minRecentActivityMs ?? 60_000,
            minAggVolume:
                cfg.symbols[cfg.symbol].accumulationDetector?.minAggVolume ?? 5,
            accumulationThreshold:
                cfg.symbols[cfg.symbol].accumulationDetector
                    ?.accumulationThreshold ?? 0.55,
            pricePrecision: Config.PRICE_PRECISION,
        };
    }

    static get DELTACVD_DETECTOR(): DeltaCVDConfirmationSettings {
        return {
            symbol: Config.SYMBOL,
            windowsSec: cfg.symbols[cfg.symbol].deltaCvdConfirmation
                ?.windowsSec ?? [60, 300, 900],

            minTradesPerSec:
                cfg.symbols[cfg.symbol].deltaCvdConfirmation?.minTradesPerSec ??
                0.5,
            minVolPerSec: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation?.minVolPerSec ?? 20
            ),
            minZ: cfg.symbols[cfg.symbol].deltaCvdConfirmation?.minZ ?? 3,
            volatilityLookbackSec: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.volatilityLookbackSec ?? 3600
            ),
            priceCorrelationWeight: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.priceCorrelationWeight ?? 0.3
            ),
            volumeConcentrationWeight: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.volumeConcentrationWeight ?? 0.2
            ),
            adaptiveThresholdMultiplier: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.adaptiveThresholdMultiplier ?? 1.5
            ),
            maxDivergenceAllowed: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.maxDivergenceAllowed ?? 0.7
            ),
            stateCleanupIntervalSec: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.stateCleanupIntervalSec ?? 300
            ),
            dynamicThresholds:
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.dynamicThresholds ?? false,
            logDebug:
                cfg.symbols[cfg.symbol].deltaCvdConfirmation?.logDebug ?? false,
            pricePrecision: Config.PRICE_PRECISION,

            // Volume surge detection parameters
            volumeSurgeMultiplier: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.volumeSurgeMultiplier ?? 4.0
            ),
            imbalanceThreshold: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.imbalanceThreshold ?? 0.35
            ),
            institutionalThreshold: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.institutionalThreshold ?? 17.8
            ),
            burstDetectionMs: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.burstDetectionMs ?? 1000
            ),
            sustainedVolumeMs: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.sustainedVolumeMs ?? 30000
            ),
            medianTradeSize: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation?.medianTradeSize ??
                    0.6
            ),

            // NEW: Detection mode settings
            detectionMode:
                cfg.symbols[cfg.symbol].deltaCvdConfirmation?.detectionMode ??
                "divergence",
            divergenceThreshold: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.divergenceThreshold ?? 0.3
            ),
            divergenceLookbackSec: Number(
                cfg.symbols[cfg.symbol].deltaCvdConfirmation
                    ?.divergenceLookbackSec ?? 60
            ),
        };
    }

    static get DISTRIBUTION_DETECTOR(): SuperiorFlowSettings {
        return {
            symbol: Config.SYMBOL,
            windowMs: this.WINDOW_MS,
            minDurationMs:
                cfg.symbols[cfg.symbol].distributionDetector?.minDurationMs ??
                300_000, // 5 minutes
            minRatio:
                cfg.symbols[cfg.symbol].distributionDetector?.minRatio ?? 1.8, // Higher threshold for distribution
            minRecentActivityMs:
                cfg.symbols[cfg.symbol].distributionDetector
                    ?.minRecentActivityMs ?? 60_000,
            threshold:
                cfg.symbols[cfg.symbol].distributionDetector?.threshold ?? 0.65, // Higher confidence threshold
            volumeConcentrationWeight:
                cfg.symbols[cfg.symbol].distributionDetector
                    ?.volumeConcentrationWeight ?? 0.2,
            strengthAnalysis:
                cfg.symbols[cfg.symbol].distributionDetector
                    ?.strengthAnalysis ?? true,
            velocityAnalysis:
                cfg.symbols[cfg.symbol].distributionDetector
                    ?.velocityAnalysis ?? false,
            flowDirection: "distribution",
            minAggVolume:
                cfg.symbols[cfg.symbol].distributionDetector?.minAggVolume ?? 8, // Higher volume threshold for distribution
            pricePrecision: Config.PRICE_PRECISION,
        };
    }

    static get ACCUMULATION_ZONE_DETECTOR(): ZoneDetectorConfig {
        const cfgObj = ZONE_CFG?.accumulation ?? {};
        return {
            maxActiveZones: cfgObj.maxActiveZones ?? 3,
            zoneTimeoutMs: cfgObj.zoneTimeoutMs ?? 3_600_000,
            minZoneVolume: cfgObj.minZoneVolume ?? 100,
            maxZoneWidth: cfgObj.maxZoneWidth ?? 0.01,
            minZoneStrength: cfgObj.minZoneStrength ?? 0.5,
            completionThreshold: cfgObj.completionThreshold ?? 0.8,
            strengthChangeThreshold: cfgObj.strengthChangeThreshold ?? 0.15,
            minCandidateDuration: cfgObj.minCandidateDuration ?? 180_000,
            maxPriceDeviation: cfgObj.maxPriceDeviation ?? 0.005,
            minTradeCount: cfgObj.minTradeCount ?? 10,
            minBuyRatio: cfgObj.minBuyRatio ?? 0.65,
        };
    }

    static get DISTRIBUTION_ZONE_DETECTOR(): ZoneDetectorConfig {
        const cfgObj = ZONE_CFG?.distribution ?? {};
        return {
            maxActiveZones: cfgObj.maxActiveZones ?? 3,
            zoneTimeoutMs: cfgObj.zoneTimeoutMs ?? 1_800_000,
            minZoneVolume: cfgObj.minZoneVolume ?? 150,
            maxZoneWidth: cfgObj.maxZoneWidth ?? 0.012,
            minZoneStrength: cfgObj.minZoneStrength ?? 0.45,
            completionThreshold: cfgObj.completionThreshold ?? 0.75,
            strengthChangeThreshold: cfgObj.strengthChangeThreshold ?? 0.12,
            minCandidateDuration: cfgObj.minCandidateDuration ?? 120_000,
            maxPriceDeviation: cfgObj.maxPriceDeviation ?? 0.008,
            minTradeCount: cfgObj.minTradeCount ?? 8,
            minSellRatio: cfgObj.minSellRatio ?? 0.68,
        };
    }

    static get SUPPORT_RESISTANCE_DETECTOR(): SupportResistanceConfig {
        return {
            priceTolerancePercent: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    ?.priceTolerancePercent ?? 0.05
            ), // 0.05% price tolerance
            minTouchCount:
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    ?.minTouchCount ?? 3, // Minimum 3 touches to confirm level
            minStrength: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    ?.minStrength ?? 0.6
            ), // 60% minimum strength to emit
            timeWindowMs: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    ?.timeWindowMs ?? 5_400_000
            ), // 90 minutes time window
            volumeWeightFactor: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    ?.volumeWeightFactor ?? 0.3
            ), // Volume impact on strength
            rejectionConfirmationTicks: Number(
                cfg.symbols[cfg.symbol].supportResistanceDetector
                    ?.rejectionConfirmationTicks ?? 5
            ), // Ticks to confirm rejection
        };
    }

    static get INDIVIDUAL_TRADES_MANAGER(): IndividualTradesManagerConfig {
        return {
            enabled: process.env.INDIVIDUAL_TRADES_ENABLED === "true" || false,

            criteria: {
                minOrderSizePercentile: Number(
                    process.env.INDIVIDUAL_TRADES_SIZE_PERCENTILE ?? 95
                ),
                keyLevelsEnabled:
                    process.env.INDIVIDUAL_TRADES_KEY_LEVELS === "true" ||
                    false,
                anomalyPeriodsEnabled:
                    process.env.INDIVIDUAL_TRADES_ANOMALY_PERIODS === "true" ||
                    true,
                highVolumePeriodsEnabled:
                    process.env.INDIVIDUAL_TRADES_HIGH_VOLUME === "true" ||
                    true,
            },

            cache: {
                maxSize: Number(
                    process.env.INDIVIDUAL_TRADES_CACHE_SIZE ?? 10000
                ),
                ttlMs: Number(
                    process.env.INDIVIDUAL_TRADES_CACHE_TTL ?? 300000
                ), // 5 minutes
            },

            rateLimit: {
                maxRequestsPerSecond: Number(
                    process.env.INDIVIDUAL_TRADES_RATE_LIMIT ?? 5
                ),
                batchSize: Number(
                    process.env.INDIVIDUAL_TRADES_BATCH_SIZE ?? 100
                ),
            },
        };
    }

    static get MICROSTRUCTURE_ANALYZER(): MicrostructureAnalyzerConfig {
        return {
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
    }

    static get SPOOFING_DETECTOR(): SpoofingDetectorConfig {
        return {
            tickSize: this.TICK_SIZE,
            wallTicks: Number(
                cfg.symbols[cfg.symbol].spoofingDetector?.wallTicks ?? 15
            ),
            minWallSize: Number(
                cfg.symbols[cfg.symbol].spoofingDetector?.minWallSize ?? 50
            ),
            dynamicWallWidth:
                cfg.symbols[cfg.symbol].spoofingDetector?.dynamicWallWidth ??
                true,
            testLogMinSpoof: Number(
                cfg.symbols[cfg.symbol].spoofingDetector?.testLogMinSpoof ?? 100
            ),
        };
    }

    static get ANOMALY_DETECTOR(): AnomalyDetectorOptions {
        return {
            windowSize: Number(
                cfg.symbols[cfg.symbol].anomalyDetector?.windowSize ?? 9000
            ),
            anomalyCooldownMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector?.anomalyCooldownMs ??
                    300_000
            ),
            volumeImbalanceThreshold: Number(
                cfg.symbols[cfg.symbol].anomalyDetector
                    ?.volumeImbalanceThreshold ?? 0.65
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
                cfg.symbols[cfg.symbol].anomalyDetector?.spreadThresholdBps ??
                    100
            ),
            extremeVolatilityWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector
                    ?.extremeVolatilityWindowMs ?? 900_000
            ),
            liquidityCheckWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector
                    ?.liquidityCheckWindowMs ?? 900_000
            ),
            whaleCooldownMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector?.whaleCooldownMs ??
                    300_000
            ),
            marketHealthWindowMs: Number(
                cfg.symbols[cfg.symbol].anomalyDetector?.marketHealthWindowMs ??
                    900_000
            ),
        };
    }

    // ✅ Enhanced zone formation configuration (replaces magic numbers)
    static get ENHANCED_ZONE_FORMATION(): EnhancedZoneFormationConfig {
        return ENHANCED_ZONE_CFG;
    }

    // Market Data Storage configuration for backtesting
    static get marketDataStorage(): MarketDataStorageConfig | null {
        return cfg.marketDataStorage || null;
    }

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

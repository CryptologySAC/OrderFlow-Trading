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
import type { SwingPredictorConfig } from "../indicators/swingPredictor.js";

const rawConfig = readFileSync(resolve(process.cwd(), "config.json"), "utf-8");
const cfg: ConfigType = JSON.parse(rawConfig) as ConfigType;

/**
 * Centralized configuration management
 */

export class Config {
    // Symbol configuration
    static readonly SYMBOL: AllowedSymbols = cfg.symbol;
    static readonly PRICE_PRECISION = Number(
        cfg.symbols[cfg.symbol].pricePrecision ?? 2
    );
    static readonly TICK_SIZE = 1 / Math.pow(10, this.PRICE_PRECISION);
    static readonly MAX_STORAGE_TIME = Number(cfg.maxStorageTime ?? 5_400_000); // 90 minutes
    static readonly WINDOW_MS = Number(
        cfg.symbols[cfg.symbol].windowMs ?? 90000
    );

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
        bandTicks: cfg.symbols[cfg.symbol].bandTicks ?? 5,
        tickSize: Config.TICK_SIZE,
        emitDepthMetrics: cfg.symbols[cfg.symbol].emitDepthMetrics ?? false,
    };

    static readonly DATASTREAM: DataStreamConfig = {
        symbol: Config.SYMBOL,
        reconnectDelay:
            cfg.symbols[cfg.symbol].dataStream.reconnectDelay ?? 5000,
        maxReconnectAttempts:
            cfg.symbols[cfg.symbol].dataStream.maxReconnectAttempts ?? 10,
        depthUpdateSpeed:
            cfg.symbols[cfg.symbol].dataStream.depthUpdateSpeed ?? "100ms",
        enableHeartbeat:
            cfg.symbols[cfg.symbol].dataStream.enableHeartbeat ?? true,
        heartbeatInterval:
            cfg.symbols[cfg.symbol].dataStream.heartbeatInterval ?? 30000,
        maxBackoffDelay:
            cfg.symbols[cfg.symbol].dataStream.maxBackoffDelay ?? 300000,
        streamHealthTimeout:
            cfg.symbols[cfg.symbol].dataStream.streamHealthTimeout ?? 60000,
        enableStreamHealthCheck:
            cfg.symbols[cfg.symbol].dataStream.enableStreamHealthCheck ?? true,
        reconnectOnHealthFailure:
            cfg.symbols[cfg.symbol].dataStream.reconnectOnHealthFailure ?? true,
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
            priceResponse:
                cfg.symbols[cfg.symbol].absorption?.features?.priceResponse ??
                false,
            sideOverride:
                cfg.symbols[cfg.symbol].absorption?.features?.sideOverride ??
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
            priceResponse:
                cfg.symbols[cfg.symbol].exhaustion?.features?.priceResponse ??
                false,
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
            sideOverride:
                cfg.symbols[cfg.symbol].exhaustion?.features?.sideOverride ??
                false,
        },
    };

    static readonly ACCUMULATION_DETECTOR: AccumulationSettings = {
        symbol: Config.SYMBOL,
        windowMs: this.WINDOW_MS,
        minDurationMs:
            cfg.symbols[cfg.symbol].accumulationDetector?.minDurationMs ??
            300_000,
        minRatio: cfg.symbols[cfg.symbol].accumulationDetector?.minRatio ?? 1.2,
        minRecentActivityMs:
            cfg.symbols[cfg.symbol].accumulationDetector?.minRecentActivityMs ??
            60_000,
        minAggVolume:
            cfg.symbols[cfg.symbol].accumulationDetector?.minAggVolume ?? 5,
        accumulationThreshold:
            cfg.symbols[cfg.symbol].accumulationDetector
                ?.accumulationThreshold ?? 0.6,
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

    static readonly SWING_PREDICTOR: SwingPredictorConfig = {
        lookaheadMs:
            cfg.symbols[cfg.symbol].swingPredictor?.lookaheadMs ?? 60000,
        retraceTicks:
            cfg.symbols[cfg.symbol].swingPredictor?.retraceTicks ?? 10,
        pricePrecision:
            cfg.symbols[cfg.symbol].swingPredictor?.pricePrecision ??
            Config.PRICE_PRECISION,
        signalCooldownMs:
            cfg.symbols[cfg.symbol].swingPredictor?.signalCooldownMs ?? 300000,
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
            cfg.symbols[cfg.symbol].anomalyDetector?.windowSize ?? 400
        ),
        anomalyCooldownMs: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.anomalyCooldownMs ??
                300_000
        ),
        icebergDetectionWindow: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.icebergDetectionWindow ??
                600_000
        ),
        volumeImbalanceThreshold: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.volumeImbalanceThreshold ??
                0.65
        ),
        absorptionRatioThreshold: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.absorptionRatioThreshold ??
                2.5
        ),
        normalSpreadBps: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.normalSpreadBps ?? 10
        ),
        minHistory: Number(
            cfg.symbols[cfg.symbol].anomalyDetector?.minHistory ?? 50
        ),
        orderSizeAnomalyThreshold: Number(
            cfg.symbols[cfg.symbol].anomalyDetector
                ?.orderSizeAnomalyThreshold ?? 3
        ),
        tickSize: this.TICK_SIZE,
    };

    /**
     * Validate configuration on startup
     */
    static validate(): void {
        //const required = ["symbol"];
        //const missing = required.filter((key) => cfg[key] === undefined);

        //if (missing.length > 0) {
        //    throw new Error(
        //        `Missing required configuration values: ${missing.join(", ")}`
        //    );
        //}

        if (this.HTTP_PORT < 1 || this.HTTP_PORT > 65535) {
            throw new Error(`Invalid HTTP_PORT: ${this.HTTP_PORT}`);
        }

        if (this.WS_PORT < 1 || this.WS_PORT > 65535) {
            throw new Error(`Invalid WS_PORT: ${this.WS_PORT}`);
        }
    }
}

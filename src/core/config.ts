// src/core/config.ts
import dotenv from "dotenv";
dotenv.config();
import { AnomalyDetectorOptions } from "../services/anomalyDetector.js";
import { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
/**
 * Centralized configuration management
 */

export class Config {
    // Symbol configuration
    static readonly SYMBOL = (process.env.SYMBOL ?? "LTCUSDT").toUpperCase();
    static readonly PRICE_PRECISION = parseInt(
        process.env.PRICE_PRECISION ?? "2",
        10
    );
    static readonly TICK_SIZE = 1 / Math.pow(10, this.PRICE_PRECISION);
    static readonly MAX_STORAGE_TIME = parseInt(
        process.env.MAX_STORAGE_TIME ?? "5400000",
        10
    ); // 90 minutes

    // Server configuration
    static readonly HTTP_PORT = parseInt(process.env.PORT ?? "3000", 10);
    static readonly WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
    static readonly WEBHOOK_URL = process.env.WEBHOOK_URL;

    // Exhaustion detector settings
    static readonly EXHAUSTION = {
        MIN_AGG_VOLUME: parseInt(
            process.env.EXHAUSTION_MIN_AGG_VOLUME ?? "600",
            10
        ),
        THRESHOLD: parseFloat(process.env.EXHAUSTION_THRESHOLD ?? "0.75"),
        WINDOW_MS: parseInt(process.env.WINDOW_MS ?? "90000", 10),
        ZONE_TICKS: parseInt(process.env.ZONE_TICKS ?? "3", 10),
        EVENT_COOLDOWN_MS: parseInt(
            process.env.EVENT_COOLDOWN_MS ?? "15000",
            10
        ),
        MAX_PASSIVE_RATIO: parseFloat(
            process.env.EXHAUSTION_MAX_PASSIVE_RATIO ?? "0.5"
        ),
        PRICE_PRECISION: parseInt(process.env.PRICE_PRECISION ?? "2", 10),

        MOVE_TICKS: parseInt(process.env.EXHAUSTION_MOVE_TICKS ?? "12", 10),
        CONFIRMATION_TIMEOUT: parseInt(
            process.env.EXHAUSTION_CONFIRMATION_TIMEOUT ?? "60000",
            10
        ),
        MAX_REVISIT_TICKS: parseInt(
            process.env.EXHAUSTION_MAX_REVISIT_TICKS ?? "5",
            10
        ),
    };

    // Absorption detector settings
    static readonly ABSORPTION = {
        MIN_AGG_VOLUME: parseInt(
            process.env.ABSORPTION_MIN_AGG_VOLUME ?? "600",
            10
        ),
        THRESHOLD: parseFloat(process.env.EXHAUSTION_THRESHOLD ?? "0.75"),
        WINDOW_MS: parseInt(process.env.WINDOW_MS ?? "90000", 10),
        ZONE_TICKS: parseInt(process.env.ZONE_TICKS ?? "3", 10),
        EVENT_COOLDOWN_MS: parseInt(
            process.env.EVENT_COOLDOWN_MS ?? "15000",
            10
        ),
        MIN_PASSIVE_MULTIPLIER: parseFloat(
            process.env.ABSORPTION_MIN_PASSIVE_MULTIPLIER ?? "2.0"
        ),
        MAX_ABSORPTION_RATIO: parseFloat(
            process.env.ABSORPTION_MAX_ABSORPTION_RATIO ?? "0.3"
        ),
        PRICE_PRECISION: parseInt(process.env.PRICE_PRECISION ?? "2", 10),

        MOVE_TICKS: parseInt(process.env.ABSORPTION_MOVE_TICKS ?? "12", 10),
        CONFIRMATION_TIMEOUT: parseInt(
            process.env.ABSORPTION_CONFIRMATION_TIMEOUT ?? "60000",
            10
        ),
        MAX_REVISIT_TICKS: parseInt(
            process.env.ABSORPTION_MAX_REVISIT_TICKS ?? "5",
            10
        ),
    };

    static readonly SPOOFING = {
        TICK_SIZE: parseFloat(process.env.SPOOFING_TICK_SIZE ?? "0.01"),
        WALL_TICKS: parseInt(process.env.SPOOFING_WALL_TICKS ?? "5", 10),
        MIN_WALL_SIZE: parseFloat(process.env.SPOOFING_MIN_WALL_SIZE ?? "100"),
        DYNAMIC_WALL_WIDTH: process.env.SPOOFING_DYNAMIC_WALL_WIDTH === "true",
        TEST_LOG_MIN_SPOOF: parseFloat(
            process.env.SPOOFING_TEST_LOG_MIN_SPOOF ?? "1000"
        ),
    };

    static readonly DELTA_CVD_CONFIRMATION = {
        WINDOW_SEC: parseInt(process.env.WINDOW_MS ?? "90000", 10),
        MIN_WINDOW_TRADES: parseInt(
            process.env.DELTACVD_MIN_WINDOW_TRADES ?? "30",
            10
        ),
        MIN_WINDOW_VOLUME: parseInt(
            process.env.DELTACVD_MIN_WINDOW_VOLUME ?? "20",
            10
        ),
        MIN_RATE_OF_CHANGE: parseFloat(
            process.env.DELTACVD_MIN_RATE_OF_CHANGE ?? "0"
        ), // Use adaptive if 0
        PRICE_PRECISION: parseInt(process.env.PRICE_PRECISION ?? "2", 10),
        DYNAMIC_THRESHOLDS: process.env.DELTACVD_DYNAMIC_THRESHOLDS === "true",
        LOG_DEBUG: process.env.DELTACVD_LOG_DEBUG === "true",
    };

    static readonly SWING_PREDICTOR = {
        LOOKAHEAD_MS: parseInt(process.env.SWING_LOOKAHEAD_MS ?? "60000", 10),
        RETRACE_TICKS: parseInt(process.env.SWING_RETRACE_TICKS ?? "10", 10),
        PRICE_PRECISION: parseInt(process.env.PRICE_PRECISION ?? "2", 10),
        SIGNAL_COOLDOWN_MS: parseInt(
            process.env.SWING_SIGNAL_COOLDOWN_MS ?? "300000",
            10
        ),
    };

    static readonly ACCUMULATION_DETECTOR = {
        WINDOW_MS: parseInt(
            process.env.ACCUMULATION_WINDOW_MS ?? "900_000",
            10
        ),
        MIN_DURATION_MS: parseInt(
            process.env.ACCUMULATION_MIN_DURATION_MS ?? "300_000",
            10
        ),
        ZONE_SIZE: parseFloat(process.env.ACCUMULATION_ZONE_SIZE ?? "0.02"),
        MIN_RATIO: parseFloat(process.env.ACCUMULATION_MIN_RATIO ?? "1.2"),
        MIN_RECENT_ACTIVITY_MS: parseInt(
            process.env.ACCUMULATION_MIN_RECENT_ACTIVITY ?? "60_000",
            10
        ),
        MIN_AGG_VOLUME: parseInt(
            process.env.ACCUMULATION_MIN_AGG_VOLUME ?? "5",
            10
        ),
        TRACK_SIDE: process.env.ACCUMULATION_TRACK_SIDE === "true",
        PRICE_PRECISION: parseInt(process.env.PRICE_PRECISION ?? "2", 10),
    };

    /**
     * Validate configuration on startup
     */
    static validate(): void {
        const requiredEnvVars = ["SYMBOL"];
        const missing = requiredEnvVars.filter(
            (envVar) => !process.env[envVar]
        );

        if (missing.length > 0) {
            throw new Error(
                `Missing required environment variables: ${missing.join(", ")}`
            );
        }

        if (this.HTTP_PORT < 1 || this.HTTP_PORT > 65535) {
            throw new Error(`Invalid HTTP_PORT: ${this.HTTP_PORT}`);
        }

        if (this.WS_PORT < 1 || this.WS_PORT > 65535) {
            throw new Error(`Invalid WS_PORT: ${this.WS_PORT}`);
        }
    }

    // TODO get from .env
    static anomalyDetectorConfig(): AnomalyDetectorOptions {
        return {
            windowSize: 400,
            anomalyCooldownMs: 300_000,
            icebergDetectionWindow: 600_000,
            volumeImbalanceThreshold: 0.65,
            absorptionRatioThreshold: 2.5,
            normalSpreadBps: 10,
            minHistory: 50,
            orderSizeAnomalyThreshold: 3,
            tickSize: 0.01,
        };
    }

    //TODO get from .env
    static spoofingDetectorConfig(): SpoofingDetectorConfig {
        return {
            tickSize: 0.01,
            wallTicks: 15,
            minWallSize: 50,
            dynamicWallWidth: true,
            testLogMinSpoof: 100,
        };
    }
}

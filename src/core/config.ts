// src/core/config.ts

/**
 * Centralized configuration management
 */

export class Config {
    // Symbol configuration
    static readonly SYMBOL = (process.env.SYMBOL ?? "LTCUSDT").toUpperCase();

    // Server configuration
    static readonly HTTP_PORT = parseInt(process.env.PORT ?? "3000", 10);
    static readonly WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
    static readonly WEBHOOK_URL = process.env.WEBHOOK_URL;

    // Exhaustion detector settings
    static readonly EXHAUSTION = {
        WINDOW_MS: parseInt(process.env.EXHAUSTION_WINDOW_MS ?? "90000", 10),
        MIN_AGG_VOLUME: parseInt(
            process.env.EXHAUSTION_MIN_AGG_VOLUME ?? "600",
            10
        ),
        PRICE_PRECISION: parseInt(
            process.env.EXHAUSTION_PRICE_PRECISION ?? "2",
            10
        ),
        ZONE_TICKS: parseInt(process.env.EXHAUSTION_ZONE_TICKS ?? "3", 10),
        EVENT_COOLDOWN_MS: parseInt(
            process.env.EXHAUSTION_EVENT_COOLDOWN_MS ?? "15000",
            10
        ),
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
        WINDOW_MS: parseInt(process.env.ABSORPTION_WINDOW_MS ?? "90000", 10),
        MIN_AGG_VOLUME: parseInt(
            process.env.ABSORPTION_MIN_AGG_VOLUME ?? "600",
            10
        ),
        PRICE_PRECISION: parseInt(
            process.env.ABSORPTION_PRICE_PRECISION ?? "2",
            10
        ),
        ZONE_TICKS: parseInt(process.env.ABSORPTION_ZONE_TICKS ?? "3", 10),
        EVENT_COOLDOWN_MS: parseInt(
            process.env.ABSORPTION_EVENT_COOLDOWN_MS ?? "15000",
            10
        ),
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
}

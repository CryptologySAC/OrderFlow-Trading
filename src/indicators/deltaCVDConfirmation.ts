// src/indicators/deltaCVDConfirmation.ts
import { randomUUID } from "crypto";
import { SpotWebsocketStreams } from "@binance/spot";
import type { TradeData } from "../utils/utils.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";

export interface DeltaCVDConfirmationSettings {
    windowSec?: number; // Rolling window length in seconds (default: 60)
    minWindowTrades?: number; // Minimum trades in window to trigger check (default: 30)
    minWindowVolume?: number; // Minimum volume in window (default: 20)
    minRateOfChange?: number; // Minimum delta CVD rate (adaptive default)
    dynamicThresholds?: boolean; // Adapt thresholds to volatility
    logDebug?: boolean; // Log debugging info
    pricePrecision?: number; // For reporting
}

export type ConfirmCallback = (event: unknown) => void;

export class DeltaCVDConfirmation {
    private readonly trades: TradeData[] = [];
    private readonly cvd: number[] = [];
    private readonly prices: number[] = [];
    private readonly times: number[] = [];
    private readonly settings: Required<DeltaCVDConfirmationSettings>;
    protected readonly logger: Logger;
    protected readonly metricsCollector: MetricsCollector;
    protected readonly signalLogger?: ISignalLogger;
    private readonly callback: ConfirmCallback;

    constructor(
        callback: ConfirmCallback,
        settings: DeltaCVDConfirmationSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        this.callback = callback;
        this.settings = {
            windowSec: settings.windowSec ?? 60,
            minWindowTrades: settings.minWindowTrades ?? 30,
            minWindowVolume: settings.minWindowVolume ?? 20,
            minRateOfChange: settings.minRateOfChange ?? 0, // Use adaptive if 0
            dynamicThresholds: settings.dynamicThresholds ?? true,
            logDebug: settings.logDebug ?? false,
            pricePrecision: settings.pricePrecision ?? 2,
        };

        this.logger = logger;
        this.metricsCollector = metricsCollector;
        this.signalLogger = signalLogger;
        this.logger.info(
            "[DeltaCVDConfirmation] Initialized with settings:",
            this.settings
        );
    }

    /**
     * Add a new trade and evaluate for confirmation.
     */
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        const t: TradeData = {
            price: parseFloat(trade.p ?? "0"),
            quantity: parseFloat(trade.q ?? "0"),
            timestamp: trade.T ?? Date.now(),
            isMakerSell: !!trade.m,
            originalTrade: trade,
        };
        this.trades.push(t);

        // Maintain a rolling window for CVD and prices.
        this.pruneOldTrades();

        const direction = t.isMakerSell ? -1 : 1;
        const newCVD =
            (this.cvd.length ? this.cvd[this.cvd.length - 1] : 0) +
            direction * t.quantity;
        this.cvd.push(newCVD);
        this.prices.push(t.price);
        this.times.push(t.timestamp);

        // Rolling window update
        this.pruneOldArrays();

        // Try confirmation if enough data
        if (this.trades.length < this.settings.minWindowTrades) return;

        this.evaluateWindow();
    }

    private pruneOldTrades(): void {
        const cutoff = Date.now() - this.settings.windowSec * 1000;
        while (this.trades.length && this.trades[0].timestamp < cutoff) {
            this.trades.shift();
        }
    }

    private pruneOldArrays(): void {
        const maxLen = this.trades.length;
        while (this.cvd.length > maxLen) this.cvd.shift();
        while (this.prices.length > maxLen) this.prices.shift();
        while (this.times.length > maxLen) this.times.shift();
    }

    /**
     * Main detection logic for CVD confirmation in window.
     */
    private evaluateWindow(): void {
        try {
            const n = this.trades.length;
            const windowVolume = this.trades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );

            if (windowVolume < this.settings.minWindowVolume) return;

            // Use regression to estimate CVD rate-of-change
            const t0 = this.times[0];
            const tn = this.times[n - 1];
            const cvd0 = this.cvd[0];
            const cvdn = this.cvd[n - 1];

            // Time delta in seconds
            const dt = (tn - t0) / 1000 || 1;
            const dCVD = cvdn - cvd0;
            const rateOfChange = dCVD / dt;

            // Dynamic threshold: X% of window volume per second
            let threshold = this.settings.minRateOfChange;
            if (this.settings.dynamicThresholds) {
                threshold = Math.max(
                    (windowVolume * 0.015) / dt, // 1.5% of vol/sec, can tune
                    this.settings.minRateOfChange
                );
            }

            // Signal direction: up means buy dominance, down means sell
            const direction = rateOfChange > 0 ? "up" : "down";

            // Get latest price and trade
            const price = this.prices[n - 1];
            const time = this.times[n - 1];
            const side = direction === "up" ? "buy" : "sell";

            // Optional: attach meta, e.g. price stddev, mean vol, etc
            const meta = {
                priceStd: this.std(this.prices),
                meanVol: windowVolume / n,
            };

            // --- Confirmations: only fire if rate exceeds threshold
            if (Math.abs(rateOfChange) >= threshold) {
                // By convention, absorption should confirm on CVD *upturn* after sell pressure;
                // exhaustion should confirm on CVD *downturn* after buy pressure.
                // The dashboard/parent should provide which type we're confirming (here, just pass as meta).
                this.callback({
                    type: "cvd_confirmation",
                    time,
                    price,
                    side,
                    rateOfChange,
                    windowVolume,
                    direction,
                    triggerType: "absorption", // Up to integration: pass real type
                    windowTrades: n,
                    meta,
                });
            }

            // Debug output
            if (this.settings.logDebug) {
                this.logger.info("[DeltaCVDConfirmation] Debug:", {
                    price,
                    side,
                    rateOfChange,
                    windowVolume,
                    direction,
                    dt,
                    threshold,
                    n,
                });
            }
        } catch (error) {
            this.handleError(
                error as Error,
                "DeltaCVDConfirmation.evaluateWindow",
                randomUUID()
            );
        }
    }

    /**
     * Handle errors
     */
    protected handleError(
        error: Error,
        context: string,
        correlationId?: string
    ): void {
        this.metricsCollector.incrementMetric("errorsCount");

        const errorContext = {
            context,
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            correlationId: correlationId || randomUUID(),
        };

        this.logger.error(
            `[${context}] ${error.message}`,
            errorContext,
            correlationId
        );
    }

    /**
     * Utility: sample standard deviation
     */
    private std(arr: number[]): number {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const sq = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
        return Math.sqrt(sq);
    }
}

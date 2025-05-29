// src/indicators/deltaCVDConfirmation.ts
import { SpotWebsocketStreams } from "@binance/spot";
import { Detector } from "./base";
import type { TradeData } from "../utils/utils.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type { DeltaCVDConfirmationEvent } from "../types/signalTypes.js";
import type { BaseDetectorSettings } from "./interfaces/detectorInterfaces.js";

export type DeltaCVDConfirmationCallback = (event: unknown) => void;

export interface DeltaCVDConfirmationSettings extends BaseDetectorSettings {
    windowSec: number; // Rolling window length in seconds (default: 60)
    minWindowTrades: number; // Minimum trades in window to trigger check (default: 30)
    minWindowVolume: number; // Minimum volume in window (default: 20)
    minRateOfChange: number; // Minimum delta CVD rate (adaptive default)
    dynamicThresholds: boolean; // Adapt thresholds to volatility
    logDebug: boolean; // Log debugging info
}

export class DeltaCVDConfirmation extends Detector {
    private readonly trades: TradeData[] = [];
    private readonly settings: DeltaCVDConfirmationSettings;

    private lastSignalTime: number = 0;

    constructor(
        private readonly callback: (event: DeltaCVDConfirmationEvent) => void,
        settings: DeltaCVDConfirmationSettings,
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(logger, metricsCollector, signalLogger);
        this.settings = {
            windowSec: settings.windowSec ?? 60,
            minWindowTrades: settings.minWindowTrades ?? 30,
            minWindowVolume: settings.minWindowVolume ?? 20,
            minRateOfChange: settings.minRateOfChange ?? 0.05,
            dynamicThresholds: settings.dynamicThresholds ?? true,
            logDebug: settings.logDebug ?? false,
        } as Required<DeltaCVDConfirmationSettings>;
    }

    // --- Required by Detector interface
    public addTrade(trade: SpotWebsocketStreams.AggTradeResponse): void {
        const normalized: TradeData = {
            price: parseFloat(trade.p ?? "0"),
            quantity: parseFloat(trade.q ?? "0"),
            timestamp: trade.T ?? Date.now(),
            isMakerSell: trade.m || false,
            originalTrade: trade,
        };

        this.trades.push(normalized);

        // Keep trades within window
        const cutoff = Date.now() - this.settings.windowSec * 1000;
        while (this.trades.length && this.trades[0].timestamp < cutoff) {
            this.trades.shift();
        }

        this.detectCVDConfirmation();
    }

    /**
     * Add depth data (not used in this detector, but required by interface).
     * This method must be implemented to satisfy the Detector interface.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public addDepth(_: SpotWebsocketStreams.DiffBookDepthResponse): void {}

    // --- CVD Confirmation Logic ---
    private detectCVDConfirmation(): void {
        const {
            windowSec,
            minWindowTrades,
            minWindowVolume,
            minRateOfChange,
            dynamicThresholds,
            logDebug,
        } = this.settings;

        const now = Date.now();
        const windowStart = now - windowSec * 1000;
        const windowTrades = this.trades.filter(
            (t) => t.timestamp >= windowStart
        );

        if (windowTrades.length < minWindowTrades) {
            if (logDebug)
                this.logger.debug("[DeltaCVD] Not enough trades for analysis");
            return;
        }

        const windowVolume = windowTrades.reduce(
            (sum, t) => sum + t.quantity,
            0
        );
        if (windowVolume < minWindowVolume) {
            if (logDebug)
                this.logger.debug("[DeltaCVD] Not enough volume for analysis");
            return;
        }

        // Compute CVD values in window
        let cvd = 0;
        const cvdSeries: number[] = [];
        for (const t of windowTrades) {
            cvd += t.isMakerSell ? -t.quantity : t.quantity;
            cvdSeries.push(cvd);
        }

        // Compute rate of change (slope)
        const n = cvdSeries.length;
        if (n < 2) return;

        const x = Array.from({ length: n }, (_, i) => i);
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = cvdSeries.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((acc, val, i) => acc + val * cvdSeries[i], 0);
        const sumX2 = x.reduce((acc, val) => acc + val * val, 0);

        const denominator = n * sumX2 - sumX * sumX;
        if (denominator === 0) return;

        const slope = (n * sumXY - sumX * sumY) / denominator;
        const rateOfChange = slope / windowSec; // per second

        // Dynamic threshold: scale to window volatility
        let minROC = minRateOfChange;
        if (dynamicThresholds) {
            const prices = windowTrades.map((t) => t.price);
            const priceStd = Math.sqrt(
                prices.reduce((sum, v) => sum + (v - prices[0]) ** 2, 0) /
                    prices.length
            );
            minROC = Math.max(minROC, priceStd * 0.02); // adjust as needed
        }

        if (logDebug) {
            this.logger.debug("[DeltaCVD] Stats", {
                windowVolume,
                windowTrades: windowTrades.length,
                rateOfChange: rateOfChange.toFixed(4),
                minROC: minROC.toFixed(4),
            });
        }

        if (Math.abs(rateOfChange) < minROC) {
            return;
        }

        // Classify direction and type
        const direction = rateOfChange > 0 ? "up" : "down";
        const lastTrade = windowTrades[windowTrades.length - 1];
        const price = lastTrade.price;

        const event: DeltaCVDConfirmationEvent = {
            type: "cvd_confirmation",
            time: lastTrade.timestamp,
            price: price,
            side: rateOfChange > 0 ? "buy" : "sell",
            rateOfChange,
            windowVolume,
            direction,
            triggerType: "absorption", // TODO: You may want to detect triggerType contextually
            windowTrades: windowTrades.length,
            meta: {
                priceStd: undefined, // Can pass priceStd if computed
                meanVol: windowVolume / windowTrades.length,
            },
        };

        // Throttle signals (prevent flooding)
        if (now - this.lastSignalTime < (this.settings.windowSec * 1000) / 2)
            return;
        this.lastSignalTime = now;

        if (logDebug)
            this.logger.info("[DeltaCVD] Confirmation event", { event });

        // Metrics
        this.metricsCollector.incrementMetric("cvdConfirmations");

        // Optionally log
        if (this.signalLogger) {
            this.signalLogger.logEvent({
                timestamp: new Date().toISOString(),
                type: "cvd_confirmation",
                signalPrice: price,
                side: event.side,
                rateOfChange,
                windowVolume,
                direction,
                windowTrades: windowTrades.length,
                triggerType: event.triggerType,
            });
        }

        // Fire callback
        this.callback(event);
    }
}

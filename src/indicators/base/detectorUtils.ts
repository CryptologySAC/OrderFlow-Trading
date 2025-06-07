// src/indicators/base/detectorUtils.ts
import { SpotWebsocketStreams } from "@binance/spot";
import type { AggressiveTrade } from "../../types/marketEvents.js";
import { randomUUID } from "crypto";

export class DetectorUtils {
    /**
     * Calculate median
     */
    public static calculateMedian(values: number[]): number {
        if (values.length === 0) return 0;

        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        }

        return sorted[mid];
    }

    /**
     * Calculate percentile
     */
    public static calculatePercentile(
        values: number[],
        percentile: number
    ): number {
        if (values.length === 0) return 0;

        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;

        return sorted[Math.max(0, index)];
    }

    /**
     * Calculate mean of numeric array
     */
    public static calculateMean(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    /**
     * Safely divide two numbers, returning a default value if the denominator is 0
     */
    public static safeDivide(
        numerator: number,
        denominator: number,
        defaultValue = 0
    ): number {
        return denominator === 0 ? defaultValue : numerator / denominator;
    }

    /**
     * Calculate standard deviation
     */
    public static calculateStdDev(values: number[]): number {
        if (values.length === 0) return 0;

        const mean = this.calculateMean(values);
        const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
        const variance = this.calculateMean(squaredDiffs);

        return Math.sqrt(variance);
    }

    /**
     * STANDARDIZED zone calculation method - used by all detectors
     * This ensures consistent zone alignment across all detector types
     */
    public static calculateZone(
        price: number,
        zoneTicks: number,
        pricePrecision: number
    ): number {
        const tickSize = Math.pow(10, -pricePrecision);
        const zoneSize = zoneTicks * tickSize;

        // Standardized: Round to zone, then fix precision to avoid floating point issues
        return +(Math.round(price / zoneSize) * zoneSize).toFixed(
            pricePrecision
        );
    }

    /**
     * Check if trade data is valid
     */
    public static isValidTrade(trade: AggressiveTrade): boolean {
        return !!(
            trade.timestamp &&
            trade.price &&
            trade.quantity &&
            trade.price > 0 &&
            trade.quantity > 0
        );
    }

    /**
     * Normalize trade data
     */
    public static normalizeTradeData(
        trade: SpotWebsocketStreams.AggTradeResponse
    ): AggressiveTrade {
        return {
            price: parseFloat(trade.p!),
            quantity: parseFloat(trade.q!),
            timestamp: trade.T!,
            buyerIsMaker: trade.m || false,
            originalTrade: trade,
            pair: trade.s ?? "",
            tradeId: trade.a ? trade.a.toString() : randomUUID(),
        };
    }
}

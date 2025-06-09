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
     * CRITICAL FIX: Standardized zone calculation for all detectors
     * This method was called but not implemented
     */
    public static calculateZone(
        price: number,
        zoneTicks: number,
        pricePrecision: number
    ): number {
        if (price <= 0 || zoneTicks <= 0 || pricePrecision < 0) {
            throw new Error(
                `Invalid zone calculation parameters: price=${price}, zoneTicks=${zoneTicks}, pricePrecision=${pricePrecision}`
            );
        }

        // Use integer arithmetic for financial precision
        const scale = Math.pow(10, pricePrecision);
        const scaledPrice = Math.round(price * scale);
        const scaledTickSize = Math.round(
            Math.pow(10, -pricePrecision) * scale
        );
        const scaledZoneSize = zoneTicks * scaledTickSize;

        // Ensure consistent rounding across all detectors
        const scaledResult =
            Math.round(scaledPrice / scaledZoneSize) * scaledZoneSize;
        return scaledResult / scale;
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
     * Safe division with zero protection
     */
    public static safeDivide(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        if (denominator === 0 || isNaN(denominator) || isNaN(numerator)) {
            return defaultValue;
        }
        return numerator / denominator;
    }

    // ✅ SHOULD USE WELFORD'S ALGORITHM:
    public static calculateStdDev(values: number[]): number {
        if (values.length === 0) return 0;
        if (values.length === 1) return 0;

        // Welford's algorithm for numerical stability
        let mean = 0;
        let m2 = 0;

        for (let i = 0; i < values.length; i++) {
            const delta = values[i] - mean;
            mean += delta / (i + 1);
            const delta2 = values[i] - mean;
            m2 += delta * delta2;
        }

        const variance = m2 / (values.length - 1);
        return Math.sqrt(Math.max(0, variance));
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

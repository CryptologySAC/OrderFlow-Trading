// src/indicators/base/detectorUtils.ts
import { SpotWebsocketStreams } from "@binance/spot";
import type { AggressiveTrade } from "../../types/marketEvents.js";
import { randomUUID } from "crypto";
import { FinancialMath } from "../../utils/financialMath.js";

/**
 * @deprecated This class is being migrated to use FinancialMath for all calculations.
 * Use FinancialMath directly for new code.
 *
 * DetectorUtils now provides wrapper methods that delegate to FinancialMath
 * to maintain backward compatibility while ensuring institutional-grade precision.
 */
export class DetectorUtils {
    /**
     * @deprecated Use FinancialMath.calculateMedian() directly
     */
    public static calculateMedian(values: number[]): number {
        return FinancialMath.calculateMedian(values);
    }

    /**
     * @deprecated Use FinancialMath.calculateZone() directly
     */
    public static calculateZone(
        price: number,
        zoneTicks: number,
        pricePrecision: number
    ): number {
        return FinancialMath.calculateZone(price, zoneTicks, pricePrecision);
    }

    /**
     * @deprecated Use FinancialMath.calculatePercentile() directly
     */
    public static calculatePercentile(
        values: number[],
        percentile: number
    ): number {
        return FinancialMath.calculatePercentile(values, percentile);
    }

    /**
     * @deprecated Use FinancialMath.calculateMean() directly
     */
    public static calculateMean(values: number[]): number {
        return FinancialMath.calculateMean(values);
    }

    /**
     * @deprecated Use FinancialMath.safeDivide() directly
     */
    public static safeDivide(
        numerator: number,
        denominator: number,
        defaultValue: number = 0
    ): number {
        return FinancialMath.safeDivide(numerator, denominator, defaultValue);
    }

    /**
     * @deprecated Use FinancialMath.calculateStdDev() directly
     */
    public static calculateStdDev(values: number[]): number {
        return FinancialMath.calculateStdDev(values);
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

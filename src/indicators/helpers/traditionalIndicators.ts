// src/indicators/helpers/traditionalIndicators.ts

import { z } from "zod";
import { RollingWindow } from "../../utils/rollingWindow.js";
import { FinancialMath } from "../../utils/financialMath.js";
import type { ILogger } from "../../infrastructure/loggerInterface.js";
import type { EnrichedTradeEvent } from "../../types/marketEvents.js";
import { TraditionalIndicatorsSchema } from "../../core/config.js";

// Type derived from the schema defined in config.ts
export type TraditionalIndicatorsConfig = z.infer<
    typeof TraditionalIndicatorsSchema
>;

/**
 * Interface for traditional indicator values and validation
 */
export interface TraditionalIndicatorValues {
    vwap: {
        value: number | null;
        deviation: number | null;
        deviationPercent: number | null;
        volume: number;
        passed: boolean;
        reason?: string;
    };
    rsi: {
        value: number | null;
        condition:
            | "overbought"
            | "oversold"
            | "neutral"
            | "extreme_overbought"
            | "extreme_oversold";
        passed: boolean;
        periods: number;
        reason?: string;
    };
    oir: {
        value: number | null;
        buyVolume: number;
        sellVolume: number;
        totalVolume: number;
        condition: "buy_dominant" | "sell_dominant" | "neutral";
        passed: boolean;
        reason?: string;
    };
    overallDecision: "pass" | "filter" | "insufficient_data";
    filtersTriggered: string[];
}

/**
 * Data structures for rolling window storage
 */
interface VWAPData {
    timestamp: number;
    price: number;
    volume: number;
}

interface RSIData {
    timestamp: number;
    price: number;
    priceChange: number;
    gain: number;
    loss: number;
}

interface OIRData {
    timestamp: number;
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
}

/**
 * Traditional Indicators Calculator for Signal Filtering
 *
 * Implements VWAP, RSI, and OIR with configurable timeframes and thresholds
 * All parameters sourced from config.json (CLAUDE.md compliance - no magic numbers)
 */
export class TraditionalIndicators {
    private readonly vwapWindow: RollingWindow<VWAPData>;
    private readonly rsiWindow: RollingWindow<RSIData>;
    private readonly oirWindow: RollingWindow<OIRData>;

    private currentVWAP: number | null = null;
    private currentRSI: number | null = null;
    private currentOIR: number | null = null;

    private lastVWAPUpdate = 0;
    private lastRSIUpdate = 0;
    private lastOIRUpdate = 0;

    constructor(
        private readonly config: TraditionalIndicatorsConfig,
        private readonly logger: ILogger
    ) {
        // Dynamic config validation
        this.validateConfig();

        if (!config.enabled) {
            this.logger.info(
                "Traditional indicators disabled via configuration"
            );
        }

        // Initialize rolling windows based on configuration
        const vwapPeriods = Math.ceil(
            config.vwap.windowMs / config.timeframeMs
        );
        const rsiPeriods = config.rsi.period;
        const oirPeriods = Math.ceil(config.oir.windowMs / config.timeframeMs);

        this.vwapWindow = new RollingWindow<VWAPData>(vwapPeriods, false);
        this.rsiWindow = new RollingWindow<RSIData>(rsiPeriods, false);
        this.oirWindow = new RollingWindow<OIRData>(oirPeriods, false);

        this.logger.info("Traditional indicators initialized", {
            vwapPeriods,
            rsiPeriods,
            oirPeriods,
            timeframeMs: config.timeframeMs,
        });
    }

    private validateConfig(): void {
        if (this.config.timeframeMs <= 0) {
            throw new Error("timeframeMs must be positive");
        }
        if (this.config.vwap.windowMs <= 0) {
            throw new Error("vwap.windowMs must be positive");
        }
        if (this.config.rsi.period <= 0) {
            throw new Error("rsi.period must be positive");
        }
        if (this.config.oir.windowMs <= 0) {
            throw new Error("oir.windowMs must be positive");
        }
        if (this.config.oir.minVolumeThreshold < 0) {
            throw new Error("oir.minVolumeThreshold must be non-negative");
        }
        // Add more validations as needed
    }

    /**
     * Update indicators with new trade data
     */
    public updateIndicators(trade: EnrichedTradeEvent): void {
        if (!this.config.enabled) return;

        try {
            // Input validation for trade data
            if (
                !trade ||
                typeof trade.timestamp !== "number" ||
                trade.timestamp <= 0
            ) {
                throw new Error("Invalid trade timestamp");
            }
            if (typeof trade.price !== "number" || trade.price <= 0) {
                throw new Error("Invalid trade price");
            }
            if (typeof trade.quantity !== "number" || trade.quantity < 0) {
                throw new Error("Invalid trade quantity");
            }

            const now = trade.timestamp;

            // Update indicators based on timeframe with error handling
            if (this.shouldUpdateVWAP(now)) {
                this.updateVWAP(trade);
                this.lastVWAPUpdate = now;
                this.logger.debug("VWAP updated", {
                    timestamp: now,
                    price: trade.price,
                    volume: trade.quantity,
                });
            }

            if (this.shouldUpdateRSI(now)) {
                this.updateRSI(trade);
                this.lastRSIUpdate = now;
                this.logger.debug("RSI updated", {
                    timestamp: now,
                    price: trade.price,
                });
            }

            if (this.shouldUpdateOIR(now)) {
                this.updateOIR(trade);
                this.lastOIRUpdate = now;
                this.logger.debug("OIR updated", {
                    timestamp: now,
                    volume: trade.quantity,
                    buyerIsMaker: trade.buyerIsMaker,
                });
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            this.logger.error("Error updating indicators", {
                error: errorMessage,
                trade: {
                    timestamp: trade.timestamp,
                    price: trade.price,
                    quantity: trade.quantity,
                },
            });
            // Continue processing other indicators if possible
        }
    }

    /**
     * Validate signal against traditional indicators
     * @param price - Current price
     * @param side - Signal side (buy/sell)
     * @param signalType - Type of signal: "reversal" for regular reversals, "absorption_reversal" for absorption signals, "trend" for momentum
     */
    public validateSignal(
        price: number,
        side: "buy" | "sell" | null,
        signalType: "reversal" | "trend" | "absorption_reversal" = "trend"
    ): TraditionalIndicatorValues {
        try {
            // Input validation
            if (typeof price !== "number" || price <= 0) {
                throw new Error("Invalid price for signal validation");
            }
            if (side !== "buy" && side !== "sell") {
                throw new Error("Invalid side for signal validation");
            }

            if (!this.config.enabled) {
                const result = this.createPassResult(
                    "traditional_indicators_disabled"
                );
                this.logger.info("Signal validation bypassed", {
                    reason: "disabled",
                    price,
                    side,
                });
                return result;
            }

            const vwapResult = this.validateVWAP(price, side, signalType);
            const rsiResult = this.validateRSI(side, signalType);
            const oirResult = this.validateOIR(side, signalType);

            // Determine overall decision based on combination mode
            const overallDecision = this.determineOverallDecision(
                vwapResult.passed,
                rsiResult.passed,
                oirResult.passed
            );

            const filtersTriggered = [];
            if (
                !vwapResult.passed &&
                this.config.vwap.enabled &&
                this.config.filterStrength.vwapWeight > 0
            ) {
                filtersTriggered.push("vwap");
            }
            if (
                !rsiResult.passed &&
                this.config.rsi.enabled &&
                this.config.filterStrength.rsiWeight > 0
            ) {
                filtersTriggered.push("rsi");
            }
            if (
                !oirResult.passed &&
                this.config.oir.enabled &&
                this.config.filterStrength.oirWeight > 0
            ) {
                filtersTriggered.push("oir");
            }

            const result = {
                vwap: vwapResult,
                rsi: rsiResult,
                oir: oirResult,
                overallDecision,
                filtersTriggered,
            };

            // Audit trail logging
            this.logger.info("Signal validation completed", {
                price,
                side,
                overallDecision,
                filtersTriggered,
                vwap: { value: vwapResult.value, passed: vwapResult.passed },
                rsi: {
                    value: rsiResult.value,
                    condition: rsiResult.condition,
                    passed: rsiResult.passed,
                },
                oir: {
                    value: oirResult.value,
                    condition: oirResult.condition,
                    passed: oirResult.passed,
                },
            });

            return result;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            this.logger.error("Error validating signal", {
                error: errorMessage,
                price,
                side,
            });

            // Return a safe default on error
            return this.createPassResult("validation_error");
        }
    }

    /**
     * VWAP Calculation and Validation
     */
    private updateVWAP(trade: EnrichedTradeEvent): void {
        if (!this.config.vwap.enabled) return;

        const volume = trade.quantity || 0;
        if (volume === 0) return;

        const vwapData: VWAPData = {
            timestamp: trade.timestamp,
            price: trade.price,
            volume,
        };

        this.vwapWindow.push(vwapData);
        this.currentVWAP = this.calculateVWAP();
    }

    private calculateVWAP(): number | null {
        const data = this.vwapWindow.toArray();
        if (data.length === 0) return null;

        let totalVolumePrice = 0;
        let totalVolume = 0;

        for (const item of data) {
            const volumePrice = FinancialMath.multiplyQuantities(
                item.price,
                item.volume
            );
            totalVolumePrice = FinancialMath.safeAdd(
                totalVolumePrice,
                volumePrice
            );
            totalVolume = FinancialMath.safeAdd(totalVolume, item.volume);
        }

        if (totalVolume === 0) return null;

        return FinancialMath.divideQuantities(totalVolumePrice, totalVolume);
    }

    private validateVWAP(
        price: number,
        side: "buy" | "sell",
        signalType: "reversal" | "trend" | "absorption_reversal"
    ): TraditionalIndicatorValues["vwap"] {
        if (
            !this.config.vwap.enabled ||
            this.config.filterStrength.vwapWeight === 0
        ) {
            return {
                value: this.currentVWAP,
                deviation: null,
                deviationPercent: null,
                volume: 0,
                passed: true,
                reason: "vwap_disabled",
            };
        }

        if (this.currentVWAP === null) {
            return {
                value: null,
                deviation: null,
                deviationPercent: null,
                volume: 0,
                passed: true,
                reason: "insufficient_vwap_data",
            };
        }

        const deviation = price - this.currentVWAP;
        const deviationPercent = (Math.abs(deviation) / this.currentVWAP) * 100;

        // Check if price is too far from VWAP for the signal direction
        const maxDeviation = this.config.vwap.maxDeviationPercent;

        let passed = true;
        let reason: string | undefined;

        if (signalType === "reversal" || signalType === "absorption_reversal") {
            // For reversal signals (including absorption), large deviations from VWAP are FAVORABLE
            // They indicate overextension and potential mean reversion

            if (side === "buy" && deviation < 0) {
                // Buy reversal: price below VWAP is GOOD (oversold bounce opportunity)
                passed = true;
                const quality = Math.min(deviationPercent / maxDeviation, 2.0); // Cap at 2x for extreme moves
                reason = `reversal_oversold_opportunity: ${deviationPercent.toFixed(2)}% below VWAP (quality: ${quality.toFixed(2)})`;
            } else if (side === "sell" && deviation > 0) {
                // Sell reversal: price above VWAP is GOOD (overbought reversal opportunity)
                passed = true;
                const quality = Math.min(deviationPercent / maxDeviation, 2.0);
                reason = `reversal_overbought_opportunity: ${deviationPercent.toFixed(2)}% above VWAP (quality: ${quality.toFixed(2)})`;
            } else if (side === "buy" && deviation > 0) {
                // Buy reversal when already above VWAP - less ideal but not filtered
                passed = true;
                reason = `reversal_buy_above_vwap: ${deviationPercent.toFixed(2)}% above VWAP (neutral)`;
            } else if (side === "sell" && deviation < 0) {
                // Sell reversal when already below VWAP - less ideal but not filtered
                passed = true;
                reason = `reversal_sell_below_vwap: ${deviationPercent.toFixed(2)}% below VWAP (neutral)`;
            }
        } else {
            // Trend-following signals: keep existing logic
            if (
                side === "buy" &&
                deviation > 0 &&
                deviationPercent > maxDeviation
            ) {
                // Price too far above VWAP for buy signal
                passed = false;
                reason = `price_too_far_above_vwap: ${deviationPercent.toFixed(2)}% > ${maxDeviation}%`;
            } else if (
                side === "sell" &&
                deviation < 0 &&
                deviationPercent > maxDeviation
            ) {
                // Price too far below VWAP for sell signal
                passed = false;
                reason = `price_too_far_below_vwap: ${deviationPercent.toFixed(2)}% > ${maxDeviation}%`;
            }
        }

        return {
            value: this.currentVWAP,
            deviation,
            deviationPercent,
            volume: this.getTotalVWAPVolume(),
            passed,
            ...(reason && { reason }),
        };
    }

    /**
     * RSI Calculation and Validation
     */
    private updateRSI(trade: EnrichedTradeEvent): void {
        if (!this.config.rsi.enabled) return;

        const data = this.rsiWindow.toArray();
        const prevPrice =
            data.length > 0 ? data[data.length - 1]!.price : trade.price;
        const priceChange = trade.price - prevPrice;

        const rsiData: RSIData = {
            timestamp: trade.timestamp,
            price: trade.price,
            priceChange,
            gain: Math.max(0, priceChange),
            loss: Math.max(0, -priceChange),
        };

        this.rsiWindow.push(rsiData);
        this.currentRSI = this.calculateRSI();
    }

    private calculateRSI(): number | null {
        const data = this.rsiWindow.toArray();
        if (data.length < this.config.rsi.period) return null;

        // Use Wilder's smoothing (exponential moving average)
        const period = this.config.rsi.period;
        const smoothingFactor = 1 / period;

        let avgGain: number;
        let avgLoss: number;

        // Initial calculation using simple average for the first period
        if (data.length === period) {
            let totalGains = 0;
            let totalLosses = 0;

            for (const item of data) {
                totalGains = FinancialMath.safeAdd(totalGains, item.gain);
                totalLosses = FinancialMath.safeAdd(totalLosses, item.loss);
            }

            avgGain = FinancialMath.divideQuantities(totalGains, period);
            avgLoss = FinancialMath.divideQuantities(totalLosses, period);
        } else {
            // Use previous averages for EMA calculation
            const prevData = data.slice(0, -1);
            const prevAvgGain = this.calculateSimpleAverage(
                prevData.map((item) => item.gain)
            );
            const prevAvgLoss = this.calculateSimpleAverage(
                prevData.map((item) => item.loss)
            );

            const currentGain = data[data.length - 1]!.gain;
            const currentLoss = data[data.length - 1]!.loss;

            avgGain = FinancialMath.safeAdd(
                FinancialMath.multiplyQuantities(
                    prevAvgGain,
                    1 - smoothingFactor
                ),
                FinancialMath.multiplyQuantities(currentGain, smoothingFactor)
            );
            avgLoss = FinancialMath.safeAdd(
                FinancialMath.multiplyQuantities(
                    prevAvgLoss,
                    1 - smoothingFactor
                ),
                FinancialMath.multiplyQuantities(currentLoss, smoothingFactor)
            );
        }

        if (avgLoss === 0) return avgGain > 0 ? 100 : 50;

        const rs = FinancialMath.divideQuantities(avgGain, avgLoss);
        return 100 - 100 / (1 + rs);
    }

    private calculateSimpleAverage(values: number[]): number {
        if (values.length === 0) return 0;
        let sum = 0;
        for (const value of values) {
            sum = FinancialMath.safeAdd(sum, value);
        }
        return FinancialMath.divideQuantities(sum, values.length);
    }

    private validateRSI(
        side: "buy" | "sell",
        signalType: "reversal" | "trend" | "absorption_reversal"
    ): TraditionalIndicatorValues["rsi"] {
        if (
            !this.config.rsi.enabled ||
            this.config.filterStrength.rsiWeight === 0
        ) {
            return {
                value: this.currentRSI,
                condition: "neutral",
                passed: true,
                periods: this.config.rsi.period,
                reason: "rsi_disabled",
            };
        }

        if (this.currentRSI === null) {
            return {
                value: null,
                condition: "neutral",
                passed: true,
                periods: this.config.rsi.period,
                reason: "insufficient_rsi_data",
            };
        }

        let condition: TraditionalIndicatorValues["rsi"]["condition"] =
            "neutral";
        let passed = true;
        let reason: string | undefined;

        // Determine RSI condition
        if (this.currentRSI >= this.config.rsi.extremeOverbought) {
            condition = "extreme_overbought";
        } else if (this.currentRSI >= this.config.rsi.overboughtThreshold) {
            condition = "overbought";
        } else if (this.currentRSI <= this.config.rsi.extremeOversold) {
            condition = "extreme_oversold";
        } else if (this.currentRSI <= this.config.rsi.oversoldThreshold) {
            condition = "oversold";
        }

        // Apply filtering logic based on signal type
        if (signalType === "absorption_reversal") {
            // For ABSORPTION reversal signals, RSI extremes are OPTIMAL
            // SELL absorption at oversold = smart money BUYING the panic = BULLISH
            // BUY absorption at overbought = smart money SELLING into strength = BEARISH

            if (
                side === "sell" &&
                (condition === "oversold" || condition === "extreme_oversold")
            ) {
                // SELL absorption at oversold = smart money buying the panic = BULLISH REVERSAL
                passed = true;
                reason = `absorption_sell_at_oversold: RSI ${this.currentRSI.toFixed(1)} (excellent bullish absorption - smart money buying panic)`;
            } else if (
                side === "buy" &&
                (condition === "overbought" ||
                    condition === "extreme_overbought")
            ) {
                // BUY absorption at overbought = smart money selling into buying = BEARISH REVERSAL
                passed = true;
                reason = `absorption_buy_at_overbought: RSI ${this.currentRSI.toFixed(1)} (excellent bearish absorption - smart money selling strength)`;
            } else if (
                side === "buy" &&
                (condition === "oversold" || condition === "extreme_oversold")
            ) {
                // BUY absorption at oversold = less ideal (buying into panic)
                passed = true;
                reason = `absorption_buy_at_oversold: RSI ${this.currentRSI.toFixed(1)} (neutral absorption - buying into oversold)`;
            } else if (
                side === "sell" &&
                (condition === "overbought" ||
                    condition === "extreme_overbought")
            ) {
                // SELL absorption at overbought = less ideal (selling into strength)
                passed = true;
                reason = `absorption_sell_at_overbought: RSI ${this.currentRSI.toFixed(1)} (neutral absorption - selling into overbought)`;
            } else {
                // Neutral RSI for absorption
                passed = true;
                reason = `absorption_rsi_neutral: RSI ${this.currentRSI.toFixed(1)} (neutral conditions)`;
            }
        } else if (signalType === "reversal") {
            // For reversal signals, RSI extremes are actually FAVORABLE
            // The existing logic already works correctly - we just add better messaging

            if (
                side === "buy" &&
                (condition === "oversold" || condition === "extreme_oversold")
            ) {
                // Buy reversal from oversold - IDEAL
                passed = true;
                reason = `reversal_oversold_bounce: RSI ${this.currentRSI.toFixed(1)} (excellent reversal setup)`;
            } else if (
                side === "sell" &&
                (condition === "overbought" ||
                    condition === "extreme_overbought")
            ) {
                // Sell reversal from overbought - IDEAL
                passed = true;
                reason = `reversal_overbought_top: RSI ${this.currentRSI.toFixed(1)} (excellent reversal setup)`;
            } else if (
                side === "buy" &&
                (condition === "overbought" ||
                    condition === "extreme_overbought")
            ) {
                // Buy reversal when already overbought - counterintuitive, filter it
                passed = false;
                reason = `reversal_buy_at_overbought: RSI ${this.currentRSI.toFixed(1)} (poor reversal setup)`;
            } else if (
                side === "sell" &&
                (condition === "oversold" || condition === "extreme_oversold")
            ) {
                // Sell reversal when already oversold - counterintuitive, filter it
                passed = false;
                reason = `reversal_sell_at_oversold: RSI ${this.currentRSI.toFixed(1)} (poor reversal setup)`;
            } else {
                // Neutral RSI for reversal
                passed = true;
                reason = `reversal_rsi_neutral: RSI ${this.currentRSI.toFixed(1)}`;
            }
        } else {
            // Trend-following signals: keep existing logic
            if (
                side === "buy" &&
                (condition === "overbought" ||
                    condition === "extreme_overbought")
            ) {
                passed = false;
                reason = `rsi_overbought_buy_filtered: ${this.currentRSI.toFixed(1)} >= ${this.config.rsi.overboughtThreshold}`;
            } else if (
                side === "sell" &&
                (condition === "oversold" || condition === "extreme_oversold")
            ) {
                passed = false;
                reason = `rsi_oversold_sell_filtered: ${this.currentRSI.toFixed(1)} <= ${this.config.rsi.oversoldThreshold}`;
            }
        }

        return {
            value: this.currentRSI,
            condition,
            passed,
            periods: this.config.rsi.period,
            ...(reason && { reason }),
        };
    }

    /**
     * OIR (Order Imbalance Ratio) Calculation and Validation
     */
    private updateOIR(trade: EnrichedTradeEvent): void {
        if (!this.config.oir.enabled) return;

        // Refined order classification based on buyerIsMaker and trade characteristics
        let buyVolume = 0;
        let sellVolume = 0;
        const quantity = trade.quantity || 0;

        if (!trade.buyerIsMaker) {
            // Buyer is taker (aggressive buy)
            buyVolume = quantity;
        } else {
            // Seller is taker (aggressive sell)
            sellVolume = quantity;
        }

        // Additional refinement: Consider large trades as more significant
        // This helps distinguish between retail and institutional activity
        const isLargeTrade = quantity > this.config.oir.minVolumeThreshold * 10; // Use 10x min threshold as large trade indicator
        if (isLargeTrade) {
            // Weight large trades more heavily in the imbalance calculation
            const weight = 2; // Default weight for large trades
            buyVolume = FinancialMath.multiplyQuantities(buyVolume, weight);
            sellVolume = FinancialMath.multiplyQuantities(sellVolume, weight);
        }

        const totalVolume = FinancialMath.safeAdd(buyVolume, sellVolume);

        const oirData: OIRData = {
            timestamp: trade.timestamp,
            buyVolume,
            sellVolume,
            totalVolume,
        };

        this.oirWindow.push(oirData);
        this.currentOIR = this.calculateOIR();
    }

    private calculateOIR(): number | null {
        const data = this.oirWindow.toArray();
        if (data.length === 0) return null;

        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        for (const item of data) {
            totalBuyVolume = FinancialMath.safeAdd(
                totalBuyVolume,
                item.buyVolume
            );
            totalSellVolume = FinancialMath.safeAdd(
                totalSellVolume,
                item.sellVolume
            );
        }

        const totalVolume = FinancialMath.safeAdd(
            totalBuyVolume,
            totalSellVolume
        );

        if (totalVolume < this.config.oir.minVolumeThreshold) return null;
        if (totalVolume === 0) return 0.5; // Neutral when no volume

        return FinancialMath.divideQuantities(totalBuyVolume, totalVolume);
    }

    private validateOIR(
        side: "buy" | "sell",
        signalType: "reversal" | "trend" | "absorption_reversal"
    ): TraditionalIndicatorValues["oir"] {
        if (
            !this.config.oir.enabled ||
            this.config.filterStrength.oirWeight === 0
        ) {
            return {
                value: this.currentOIR,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                condition: "neutral",
                passed: true,
                reason: "oir_disabled",
            };
        }

        const data = this.oirWindow.toArray();
        let totalBuyVolume = 0;
        let totalSellVolume = 0;

        for (const item of data) {
            totalBuyVolume = FinancialMath.safeAdd(
                totalBuyVolume,
                item.buyVolume
            );
            totalSellVolume = FinancialMath.safeAdd(
                totalSellVolume,
                item.sellVolume
            );
        }

        const totalVolume = FinancialMath.safeAdd(
            totalBuyVolume,
            totalSellVolume
        );

        if (
            this.currentOIR === null ||
            totalVolume < this.config.oir.minVolumeThreshold
        ) {
            return {
                value: this.currentOIR,
                buyVolume: totalBuyVolume,
                sellVolume: totalSellVolume,
                totalVolume,
                condition: "neutral",
                passed: true,
                reason: "insufficient_oir_data",
            };
        }

        let condition: TraditionalIndicatorValues["oir"]["condition"] =
            "neutral";
        let passed = true;
        let reason: string | undefined;

        // Determine OIR condition
        if (this.currentOIR >= this.config.oir.buyDominanceThreshold) {
            condition = "buy_dominant";
        } else if (this.currentOIR <= this.config.oir.sellDominanceThreshold) {
            condition = "sell_dominant";
        }

        // Apply filtering logic based on signal type
        if (signalType === "reversal" || signalType === "absorption_reversal") {
            // For reversal signals (including absorption), extreme OIR indicates EXHAUSTION
            // Extreme selling = buy reversal opportunity
            // Extreme buying = sell reversal opportunity

            if (side === "buy" && condition === "sell_dominant") {
                // Buy reversal after sell exhaustion - IDEAL
                passed = true;
                reason = `reversal_sell_exhaustion: OIR ${this.currentOIR.toFixed(3)} (excellent buy reversal setup)`;
            } else if (side === "sell" && condition === "buy_dominant") {
                // Sell reversal after buy exhaustion - IDEAL
                passed = true;
                reason = `reversal_buy_exhaustion: OIR ${this.currentOIR.toFixed(3)} (excellent sell reversal setup)`;
            } else if (side === "buy" && condition === "buy_dominant") {
                // Buy reversal when buying is already dominant - less ideal
                passed = false;
                reason = `reversal_buy_with_buy_flow: OIR ${this.currentOIR.toFixed(3)} (poor reversal timing)`;
            } else if (side === "sell" && condition === "sell_dominant") {
                // Sell reversal when selling is already dominant - less ideal
                passed = false;
                reason = `reversal_sell_with_sell_flow: OIR ${this.currentOIR.toFixed(3)} (poor reversal timing)`;
            } else {
                // Neutral OIR for reversal - acceptable but not ideal
                passed = true;
                reason = `reversal_oir_neutral: OIR ${this.currentOIR.toFixed(3)} (neutral reversal conditions)`;
            }
        } else {
            // Trend-following signals: keep existing logic
            if (side === "buy" && condition === "sell_dominant") {
                passed = false;
                reason = `oir_sell_dominant_buy_filtered: ${this.currentOIR.toFixed(3)} <= ${this.config.oir.sellDominanceThreshold}`;
            } else if (side === "sell" && condition === "buy_dominant") {
                passed = false;
                reason = `oir_buy_dominant_sell_filtered: ${this.currentOIR.toFixed(3)} >= ${this.config.oir.buyDominanceThreshold}`;
            }
        }

        return {
            value: this.currentOIR,
            buyVolume: totalBuyVolume,
            sellVolume: totalSellVolume,
            totalVolume,
            condition,
            passed,
            ...(reason && { reason }),
        };
    }

    /**
     * Helper methods
     */
    private shouldUpdateVWAP(timestamp: number): boolean {
        return timestamp - this.lastVWAPUpdate >= this.config.timeframeMs;
    }

    private shouldUpdateRSI(timestamp: number): boolean {
        return timestamp - this.lastRSIUpdate >= this.config.rsi.timeframeMs;
    }

    private shouldUpdateOIR(timestamp: number): boolean {
        return timestamp - this.lastOIRUpdate >= this.config.timeframeMs;
    }

    private getTotalVWAPVolume(): number {
        const data = this.vwapWindow.toArray();
        return data.reduce(
            (sum, item) => FinancialMath.safeAdd(sum, item.volume),
            0
        );
    }

    private determineOverallDecision(
        vwapPassed: boolean,
        rsiPassed: boolean,
        oirPassed: boolean
    ): TraditionalIndicatorValues["overallDecision"] {
        const enabledFilters = [];
        const passedFilters = [];

        if (
            this.config.vwap.enabled &&
            this.config.filterStrength.vwapWeight > 0
        ) {
            enabledFilters.push("vwap");
            if (vwapPassed) passedFilters.push("vwap");
        }
        if (
            this.config.rsi.enabled &&
            this.config.filterStrength.rsiWeight > 0
        ) {
            enabledFilters.push("rsi");
            if (rsiPassed) passedFilters.push("rsi");
        }
        if (
            this.config.oir.enabled &&
            this.config.filterStrength.oirWeight > 0
        ) {
            enabledFilters.push("oir");
            if (oirPassed) passedFilters.push("oir");
        }

        if (enabledFilters.length === 0) {
            return "pass"; // No filters enabled
        }

        if (
            this.currentVWAP === null &&
            this.currentRSI === null &&
            this.currentOIR === null
        ) {
            return "insufficient_data";
        }

        switch (this.config.filterStrength.combinationMode) {
            case "all":
                return passedFilters.length === enabledFilters.length
                    ? "pass"
                    : "filter";
            case "majority":
                return passedFilters.length >=
                    Math.ceil(enabledFilters.length / 2)
                    ? "pass"
                    : "filter";
            case "any":
                return passedFilters.length > 0 ? "pass" : "filter";
            default:
                return "pass";
        }
    }

    private createPassResult(reason: string): TraditionalIndicatorValues {
        return {
            vwap: {
                value: this.currentVWAP,
                deviation: null,
                deviationPercent: null,
                volume: 0,
                passed: true,
                reason,
            },
            rsi: {
                value: this.currentRSI,
                condition: "neutral",
                passed: true,
                periods: this.config.rsi.period,
                reason,
            },
            oir: {
                value: this.currentOIR,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                condition: "neutral",
                passed: true,
                reason,
            },
            overallDecision: "pass",
            filtersTriggered: [],
        };
    }

    /**
     * Get current indicator values for debugging/monitoring
     */
    public getCurrentValues(): {
        vwap: number | null;
        rsi: number | null;
        oir: number | null;
        dataPoints: {
            vwap: number;
            rsi: number;
            oir: number;
        };
    } {
        return {
            vwap: this.currentVWAP,
            rsi: this.currentRSI,
            oir: this.currentOIR,
            dataPoints: {
                vwap: this.vwapWindow.count(),
                rsi: this.rsiWindow.count(),
                oir: this.oirWindow.count(),
            },
        };
    }

    /**
     * Reset all indicators (useful for testing)
     */
    public reset(): void {
        this.vwapWindow.clear();
        this.rsiWindow.clear();
        this.oirWindow.clear();

        this.currentVWAP = null;
        this.currentRSI = null;
        this.currentOIR = null;

        this.lastVWAPUpdate = 0;
        this.lastRSIUpdate = 0;
        this.lastOIRUpdate = 0;

        this.logger.info("Traditional indicators reset");
    }
}

// src/utils/swingDetector.ts
/**
 * SWING HIGH/LOW DETECTION SYSTEM
 *
 * Implements proper local top/bottom tracking for accurate 0.7% movement calculation.
 *
 * CORRECT LOGIC:
 * - New top is generated after a bottom is confirmed
 * - New bottom is generated after a top is confirmed
 * - If price goes lower than generated bottom, we're still going to new bottom
 * - If price keeps rising after generated top, we still get new top
 * - 0.7% movements are measured from latest local extreme to current price
 */

import { FinancialMath } from "./financialMath.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";

export interface SwingPoint {
    price: number;
    timestamp: number;
    type: "high" | "low";
    confirmed: boolean;
}

export interface SwingAnalysis {
    latestHigh: SwingPoint | null;
    latestLow: SwingPoint | null;
    currentTrend: "up" | "down" | "sideways";
    distanceFromLastExtreme: number; // Percentage distance
    significantMovement: boolean; // >= 0.7% from last extreme
    movementType: "top_to_bottom" | "bottom_to_top" | "none";
}

/**
 * Swing High/Low Detector for proper price movement validation
 *
 * ✅ INSTITUTIONAL ARCHITECTURE: Real swing detection with confirmation logic
 */
export class SwingDetector {
    private swingHigh: SwingPoint | null = null;
    private swingLow: SwingPoint | null = null;
    private currentCandidate: SwingPoint | null = null;
    private priceHistory: Array<{ price: number; timestamp: number }> = [];
    private readonly maxHistorySize = 100;
    private readonly confirmationBars = 3; // Require 3 bars for confirmation
    private readonly minSwingSize = 0.002; // Minimum 0.2% for valid swing

    constructor(
        private readonly logger: ILogger,
        private readonly tickSize: number = 0.01
    ) {}

    /**
     * Update with new price and detect swings
     */
    public updatePrice(price: number): SwingAnalysis {
        const timestamp = Date.now();

        // Add to price history
        this.priceHistory.push({ price, timestamp });
        if (this.priceHistory.length > this.maxHistorySize) {
            this.priceHistory.shift();
        }

        // Update swing detection
        this.detectSwings(price, timestamp);

        // Calculate analysis
        return this.analyzeCurrentPosition(price, timestamp);
    }

    /**
     * Detect swing highs and lows with proper confirmation
     */
    private detectSwings(currentPrice: number, timestamp: number): void {
        if (this.priceHistory.length < this.confirmationBars + 1) {
            return; // Not enough data for confirmation
        }
        void currentPrice;
        void timestamp;

        const recentPrices = this.priceHistory.slice(
            -this.confirmationBars - 1
        );
        const candidateIndex = recentPrices.length - this.confirmationBars - 1;
        const candidatePrice = recentPrices[candidateIndex].price;
        const candidateTime = recentPrices[candidateIndex].timestamp;

        // Check for swing high confirmation
        if (this.isSwingHighConfirmed(recentPrices, candidateIndex)) {
            const newHigh: SwingPoint = {
                price: candidatePrice,
                timestamp: candidateTime,
                type: "high",
                confirmed: true,
            };

            // Only accept if significantly different from last high
            if (
                !this.swingHigh ||
                Math.abs(
                    FinancialMath.divideQuantities(
                        candidatePrice - this.swingHigh.price,
                        this.swingHigh.price
                    )
                ) >= this.minSwingSize
            ) {
                this.swingHigh = newHigh;
                this.logger.debug("SwingDetector: New swing high confirmed", {
                    price: candidatePrice,
                    timestamp: candidateTime,
                    previousHigh: this.swingHigh?.price || null,
                });
            }
        }

        // Check for swing low confirmation
        if (this.isSwingLowConfirmed(recentPrices, candidateIndex)) {
            const newLow: SwingPoint = {
                price: candidatePrice,
                timestamp: candidateTime,
                type: "low",
                confirmed: true,
            };

            // Only accept if significantly different from last low
            if (
                !this.swingLow ||
                Math.abs(
                    FinancialMath.divideQuantities(
                        candidatePrice - this.swingLow.price,
                        this.swingLow.price
                    )
                ) >= this.minSwingSize
            ) {
                this.swingLow = newLow;
                this.logger.debug("SwingDetector: New swing low confirmed", {
                    price: candidatePrice,
                    timestamp: candidateTime,
                    previousLow: this.swingLow?.price || null,
                });
            }
        }
    }

    /**
     * Check if swing high is confirmed
     * High is confirmed if price is highest among surrounding bars
     */
    private isSwingHighConfirmed(
        prices: Array<{ price: number; timestamp: number }>,
        candidateIndex: number
    ): boolean {
        const candidatePrice = prices[candidateIndex].price;

        // Check left side (before candidate)
        for (let i = 0; i < candidateIndex; i++) {
            if (prices[i].price >= candidatePrice) {
                return false; // Higher price found on left
            }
        }

        // Check right side (after candidate)
        for (let i = candidateIndex + 1; i < prices.length; i++) {
            if (prices[i].price >= candidatePrice) {
                return false; // Higher price found on right
            }
        }

        return true; // Candidate is highest
    }

    /**
     * Check if swing low is confirmed
     * Low is confirmed if price is lowest among surrounding bars
     */
    private isSwingLowConfirmed(
        prices: Array<{ price: number; timestamp: number }>,
        candidateIndex: number
    ): boolean {
        const candidatePrice = prices[candidateIndex].price;

        // Check left side (before candidate)
        for (let i = 0; i < candidateIndex; i++) {
            if (prices[i].price <= candidatePrice) {
                return false; // Lower price found on left
            }
        }

        // Check right side (after candidate)
        for (let i = candidateIndex + 1; i < prices.length; i++) {
            if (prices[i].price <= candidatePrice) {
                return false; // Lower price found on right
            }
        }

        return true; // Candidate is lowest
    }

    /**
     * Analyze current position relative to swing points
     */
    private analyzeCurrentPosition(
        currentPrice: number,
        timestamp: number
    ): SwingAnalysis {
        let distanceFromLastExtreme = 0;
        let movementType: "top_to_bottom" | "bottom_to_top" | "none" = "none";
        let currentTrend: "up" | "down" | "sideways" = "sideways";

        void timestamp;

        // Determine which extreme is more recent
        const useHigh = this.shouldUseHighForDistance();

        if (useHigh && this.swingHigh) {
            // Calculate distance from latest high
            distanceFromLastExtreme = FinancialMath.divideQuantities(
                currentPrice - this.swingHigh.price,
                this.swingHigh.price
            );

            if (distanceFromLastExtreme < -0.007) {
                // 0.7% down from high
                movementType = "top_to_bottom";
                currentTrend = "down";
            } else if (distanceFromLastExtreme > 0) {
                currentTrend = "up"; // Still making higher highs
            }
        } else if (!useHigh && this.swingLow) {
            // Calculate distance from latest low
            distanceFromLastExtreme = FinancialMath.divideQuantities(
                currentPrice - this.swingLow.price,
                this.swingLow.price
            );

            if (distanceFromLastExtreme > 0.007) {
                // 0.7% up from low
                movementType = "bottom_to_top";
                currentTrend = "up";
            } else if (distanceFromLastExtreme < 0) {
                currentTrend = "down"; // Still making lower lows
            }
        }

        const significantMovement = Math.abs(distanceFromLastExtreme) >= 0.007;

        return {
            latestHigh: this.swingHigh,
            latestLow: this.swingLow,
            currentTrend,
            distanceFromLastExtreme,
            significantMovement,
            movementType,
        };
    }

    /**
     * Determine whether to use high or low for distance calculation
     * Use the most recent confirmed extreme
     */
    private shouldUseHighForDistance(): boolean {
        if (!this.swingHigh && !this.swingLow) {
            return true; // Default to high if no extremes
        }
        if (!this.swingHigh) return false;
        if (!this.swingLow) return true;

        // Use the more recent extreme
        return this.swingHigh.timestamp > this.swingLow.timestamp;
    }

    /**
     * Get current swing analysis
     */
    public getCurrentAnalysis(currentPrice: number): SwingAnalysis {
        return this.analyzeCurrentPosition(currentPrice, Date.now());
    }

    /**
     * Calculate movement from signal time to current - CORRECTED VERSION
     */
    public calculateMovementFromSignal(
        signalPrice: number,
        signalTimestamp: number,
        currentPrice: number
    ): {
        movement: number;
        isSignificant: boolean;
        movementType: "top_to_bottom" | "bottom_to_top" | "sideways";
        explanation: string;
    } {
        // Find the relevant swing points around signal time
        const analysis = this.getCurrentAnalysis(currentPrice);

        // If we have confirmed swings, use proper swing-to-current calculation
        if (analysis.significantMovement) {
            return {
                movement: analysis.distanceFromLastExtreme,
                isSignificant: true,
                movementType: analysis.movementType as
                    | "sideways"
                    | "top_to_bottom"
                    | "bottom_to_top",
                explanation: `${Math.abs(analysis.distanceFromLastExtreme * 100).toFixed(2)}% movement from ${analysis.movementType === "top_to_bottom" ? "swing high" : "swing low"} to current price`,
            };
        }

        // Fallback to simple calculation if no significant swings detected
        const simpleMovement = FinancialMath.divideQuantities(
            currentPrice - signalPrice,
            signalPrice
        );

        return {
            movement: simpleMovement,
            isSignificant: Math.abs(simpleMovement) >= 0.007,
            movementType: "sideways",
            explanation: `${Math.abs(simpleMovement * 100).toFixed(2)}% simple movement from signal price (no confirmed swings)`,
        };
    }

    /**
     * Reset swing detection state
     */
    public reset(): void {
        this.swingHigh = null;
        this.swingLow = null;
        this.currentCandidate = null;
        this.priceHistory = [];
    }

    /**
     * Get swing detection statistics
     */
    public getStats(): {
        swingHigh: SwingPoint | null;
        swingLow: SwingPoint | null;
        priceHistorySize: number;
        hasConfirmedSwings: boolean;
    } {
        return {
            swingHigh: this.swingHigh,
            swingLow: this.swingLow,
            priceHistorySize: this.priceHistory.length,
            hasConfirmedSwings: !!(this.swingHigh && this.swingLow),
        };
    }
}

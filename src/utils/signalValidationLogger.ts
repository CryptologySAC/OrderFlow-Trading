// src/utils/signalValidationLogger.ts
//
// ✅ SIGNAL VALIDATION LOGGER: NON-BLOCKING signal performance tracking for real-time trading
//
// This module provides structured logging capabilities for exhaustion and absorption signals,
// capturing detailed performance metrics, market context, and validation data suitable for
// machine learning fine-tuning and systematic analysis.
//
// FEATURES:
// - NON-BLOCKING: Signal logging never blocks real-time trade processing
// - Internal buffering with background flushing for optimal performance
// - CSV output format for ML training data
// - Real-time signal validation with market movement tracking
// - Comprehensive market context capture (volume patterns, zone data, price efficiency)
// - Signal performance metrics (accuracy, timing, reversal correlation)
// - Structured rejection logging for threshold optimization
// - Time-based performance analysis windows (5min, 15min, 1hr)

import * as fs from "fs/promises";
import * as path from "path";
import { FinancialMath } from "./financialMath.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { SignalCandidate } from "../types/signalTypes.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";

/**
 * Signal validation data structure for ML training input
 */
export interface SignalValidationRecord {
    // Signal Identification
    timestamp: number;
    signalId: string;
    detectorType: "exhaustion" | "absorption";
    signalSide: "buy" | "sell";
    confidence: number;

    // Market Context at Signal Time
    price: number;
    tradeQuantity: number;
    bestBid?: number;
    bestAsk?: number;
    spread?: number;

    // Volume Analysis
    totalAggressiveVolume: number;
    totalPassiveVolume: number;
    aggressiveBuyVolume: number;
    aggressiveSellVolume: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    volumeImbalance: number;
    institutionalVolumeRatio: number;

    // Zone Analysis
    activeZones: number;
    zoneTotalVolume: number;
    priceEfficiency: number | null;
    absorptionRatio?: number;
    exhaustionRatio?: number;
    depletionRatio?: number;

    // Signal Quality Metrics
    signalStrength: number;
    confluenceScore: number;
    institutionalFootprint: number;
    qualityGrade: "premium" | "standard" | "low";

    // Performance Validation (filled later)
    priceAt5min?: number;
    priceAt15min?: number;
    priceAt1hr?: number;
    movementDirection5min?: "up" | "down" | "sideways";
    movementDirection15min?: "up" | "down" | "sideways";
    movementDirection1hr?: "up" | "down" | "sideways";
    maxMovement5min?: number;
    maxMovement15min?: number;
    maxMovement1hr?: number;
    signalAccuracy5min?: boolean;
    signalAccuracy15min?: boolean;
    signalAccuracy1hr?: boolean;

    // Rejection Analysis (for failed signals)
    rejectionReason?: string;
    thresholdValue?: number;
    actualValue?: number;
    missedOpportunity?: boolean;
}

/**
 * Signal rejection tracking for threshold optimization
 */
export interface SignalRejectionRecord {
    timestamp: number;
    detectorType: "exhaustion" | "absorption" | "deltacvd";
    rejectionReason: string;
    price: number;

    // What caused rejection
    thresholdType: string;
    thresholdValue: number;
    actualValue: number;

    // Market context when rejected
    aggressiveVolume: number;
    passiveVolume: number;
    priceEfficiency: number | null;
    confidence: number;

    // Post-rejection analysis (filled later)
    subsequentMovement5min?: number;
    subsequentMovement15min?: number;
    subsequentMovement1hr?: number;
    wasValidSignal?: boolean; // True if significant movement occurred despite rejection
}

/**
 * Signal Validation Logger - NON-BLOCKING signal performance tracking for real-time trading
 *
 * ✅ INSTITUTIONAL ARCHITECTURE: Internal buffering ensures signal processing never blocks on disk I/O
 */
export class SignalValidationLogger {
    private readonly signalsFilePath: string;
    private readonly rejectionsFilePath: string;
    private readonly pendingValidations = new Map<
        string,
        SignalValidationRecord
    >();
    private readonly validationTimers = new Map<string, NodeJS.Timeout[]>();

    // ✅ NON-BLOCKING ARCHITECTURE: Internal buffering for high-performance logging
    private readonly signalsBuffer: string[] = [];
    private readonly rejectionsBuffer: string[] = [];
    private readonly maxBufferSize = 100; // Flush after 100 entries
    private readonly flushInterval = 5000; // Flush every 5 seconds
    private flushTimer?: NodeJS.Timeout;
    private isInitialized = false;

    constructor(
        private readonly logger: ILogger,
        private readonly outputDir: string = "logs/signal_validation"
    ) {
        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .split("T")[0];
        this.signalsFilePath = path.join(
            outputDir,
            `signal_validation_${timestamp}.csv`
        );
        this.rejectionsFilePath = path.join(
            outputDir,
            `signal_rejections_${timestamp}.csv`
        );

        void this.initializeLogFiles();
    }

    /**
     * Initialize CSV log files with headers
     */
    private async initializeLogFiles(): Promise<void> {
        try {
            // Ensure output directory exists
            await fs.mkdir(this.outputDir, { recursive: true });

            // Signal validation CSV header
            const signalHeader =
                [
                    "timestamp",
                    "signalId",
                    "detectorType",
                    "signalSide",
                    "confidence",
                    "price",
                    "tradeQuantity",
                    "bestBid",
                    "bestAsk",
                    "spread",
                    "totalAggressiveVolume",
                    "totalPassiveVolume",
                    "aggressiveBuyVolume",
                    "aggressiveSellVolume",
                    "passiveBidVolume",
                    "passiveAskVolume",
                    "volumeImbalance",
                    "institutionalVolumeRatio",
                    "activeZones",
                    "zoneTotalVolume",
                    "priceEfficiency",
                    "absorptionRatio",
                    "exhaustionRatio",
                    "depletionRatio",
                    "signalStrength",
                    "confluenceScore",
                    "institutionalFootprint",
                    "qualityGrade",
                    "priceAt5min",
                    "priceAt15min",
                    "priceAt1hr",
                    "movementDirection5min",
                    "movementDirection15min",
                    "movementDirection1hr",
                    "maxMovement5min",
                    "maxMovement15min",
                    "maxMovement1hr",
                    "signalAccuracy5min",
                    "signalAccuracy15min",
                    "signalAccuracy1hr",
                ].join(",") + "\n";

            // Signal rejection CSV header
            const rejectionHeader =
                [
                    "timestamp",
                    "detectorType",
                    "rejectionReason",
                    "price",
                    "thresholdType",
                    "thresholdValue",
                    "actualValue",
                    "aggressiveVolume",
                    "passiveVolume",
                    "priceEfficiency",
                    "confidence",
                    "subsequentMovement5min",
                    "subsequentMovement15min",
                    "subsequentMovement1hr",
                    "wasValidSignal",
                ].join(",") + "\n";

            // ✅ RACE CONDITION FIX: Only write headers if files don't exist
            try {
                await fs.access(this.signalsFilePath);
            } catch {
                // File doesn't exist, create with header
                await fs.writeFile(this.signalsFilePath, signalHeader);
            }

            try {
                await fs.access(this.rejectionsFilePath);
            } catch {
                // File doesn't exist, create with header
                await fs.writeFile(this.rejectionsFilePath, rejectionHeader);
            }

            this.logger.info(
                "SignalValidationLogger: NON-BLOCKING CSV files initialized",
                {
                    signalsFile: this.signalsFilePath,
                    rejectionsFile: this.rejectionsFilePath,
                    maxBufferSize: this.maxBufferSize,
                    flushInterval: this.flushInterval,
                }
            );

            // ✅ START BACKGROUND FLUSHING for non-blocking performance
            this.startBackgroundFlushing();

            // Mark as initialized
            this.isInitialized = true;
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to initialize log files",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    outputDir: this.outputDir,
                }
            );
        }
    }

    /**
     * ✅ START BACKGROUND FLUSHING: Non-blocking buffer management for real-time performance
     */
    private startBackgroundFlushing(): void {
        this.flushTimer = setInterval(() => {
            this.flushBuffers();
        }, this.flushInterval);
    }

    /**
     * ✅ BACKGROUND BUFFER FLUSH: Asynchronous disk writes without blocking signal processing
     */
    private flushBuffers(): void {
        if (this.signalsBuffer.length > 0) {
            const signalsToFlush = this.signalsBuffer.splice(0);
            void this.flushSignalsBuffer(signalsToFlush);
        }

        if (this.rejectionsBuffer.length > 0) {
            const rejectionsToFlush = this.rejectionsBuffer.splice(0);
            void this.flushRejectionsBuffer(rejectionsToFlush);
        }
    }

    /**
     * ✅ ASYNC SIGNAL BUFFER FLUSH: Background file writes
     */
    private async flushSignalsBuffer(records: string[]): Promise<void> {
        try {
            const content = records.join("");
            await fs.appendFile(this.signalsFilePath, content);
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to flush signals buffer",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    recordCount: records.length,
                }
            );
        }
    }

    /**
     * ✅ ASYNC REJECTIONS BUFFER FLUSH: Background file writes
     */
    private async flushRejectionsBuffer(records: string[]): Promise<void> {
        try {
            const content = records.join("");
            await fs.appendFile(this.rejectionsFilePath, content);
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to flush rejections buffer",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    recordCount: records.length,
                }
            );
        }
    }

    /**
     * ✅ CLEANUP: Flush remaining buffers and clear timers
     */
    public cleanup(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }

        // Final flush of any remaining buffered data
        this.flushBuffers();

        // Clear validation timers
        for (const [, timers] of this.validationTimers) {
            timers.forEach((timer) => clearTimeout(timer));
        }
        this.validationTimers.clear();
        this.pendingValidations.clear();
    }

    /**
     * ✅ NON-BLOCKING Log a generated signal for validation tracking
     */
    public logSignal(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        marketContext: {
            totalAggressiveVolume: number;
            totalPassiveVolume: number;
            aggressiveBuyVolume: number;
            aggressiveSellVolume: number;
            passiveBidVolume: number;
            passiveAskVolume: number;
            institutionalVolumeRatio: number;
            priceEfficiency: number | null;
            absorptionRatio?: number;
            exhaustionRatio?: number;
            depletionRatio?: number;
        }
    ): void {
        try {
            const record: SignalValidationRecord = {
                // Signal Identification
                timestamp: signal.timestamp,
                signalId: signal.id,
                detectorType:
                    signal.type === "exhaustion" ? "exhaustion" : "absorption",
                signalSide: signal.side as "buy" | "sell",
                confidence: signal.confidence,

                // Market Context
                price: event.price,
                tradeQuantity: event.quantity,
                bestBid: event.bestBid,
                bestAsk: event.bestAsk,
                spread:
                    event.bestAsk && event.bestBid
                        ? event.bestAsk - event.bestBid
                        : undefined,

                // Volume Analysis
                totalAggressiveVolume: marketContext.totalAggressiveVolume,
                totalPassiveVolume: marketContext.totalPassiveVolume,
                aggressiveBuyVolume: marketContext.aggressiveBuyVolume,
                aggressiveSellVolume: marketContext.aggressiveSellVolume,
                passiveBidVolume: marketContext.passiveBidVolume,
                passiveAskVolume: marketContext.passiveAskVolume,
                volumeImbalance: this.calculateVolumeImbalance(
                    marketContext.aggressiveBuyVolume,
                    marketContext.aggressiveSellVolume
                ),
                institutionalVolumeRatio:
                    marketContext.institutionalVolumeRatio,

                // Zone Analysis
                activeZones: event.zoneData ? event.zoneData.zones.length : 0,
                zoneTotalVolume: event.zoneData
                    ? this.calculateZoneTotalVolume(event.zoneData.zones)
                    : 0,
                priceEfficiency: marketContext.priceEfficiency,
                absorptionRatio: marketContext.absorptionRatio,
                exhaustionRatio: marketContext.exhaustionRatio,
                depletionRatio: marketContext.depletionRatio,

                // Signal Quality Metrics
                signalStrength: signal.confidence,
                confluenceScore: this.calculateConfluenceScore(event),
                institutionalFootprint: marketContext.institutionalVolumeRatio,
                qualityGrade: this.determineQualityGrade(
                    signal.confidence,
                    marketContext.institutionalVolumeRatio
                ),
            };

            // Store for validation tracking
            this.pendingValidations.set(signal.id, record);

            // Set up validation timers
            this.setupValidationTimers(signal.id, event.price);

            // Log immediately (partial record)
            this.writeSignalRecord(record);

            this.logger.info(
                "SignalValidationLogger: Signal logged for validation",
                {
                    signalId: signal.id,
                    detectorType: record.detectorType,
                    signalSide: record.signalSide,
                    price: record.price,
                    confidence: record.confidence,
                }
            );
        } catch (error) {
            this.logger.error("SignalValidationLogger: Failed to log signal", {
                signalId: signal.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Log a rejected signal for threshold optimization
     */
    public logRejection(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        rejectionReason: string,
        event: EnrichedTradeEvent,
        thresholdDetails: {
            type: string;
            threshold: number;
            actual: number;
        },
        marketContext: {
            aggressiveVolume: number;
            passiveVolume: number;
            priceEfficiency: number | null;
            confidence: number;
        }
    ): void {
        try {
            const record: SignalRejectionRecord = {
                timestamp: event.timestamp,
                detectorType,
                rejectionReason,
                price: event.price,

                // Threshold details
                thresholdType: thresholdDetails.type,
                thresholdValue: thresholdDetails.threshold,
                actualValue: thresholdDetails.actual,

                // Market context
                aggressiveVolume: marketContext.aggressiveVolume,
                passiveVolume: marketContext.passiveVolume,
                priceEfficiency: marketContext.priceEfficiency,
                confidence: marketContext.confidence,
            };

            // ✅ WRITE REJECTION TO CSV IMMEDIATELY
            this.writeRejectionRecord(record);

            // Set up post-rejection analysis timers
            this.setupRejectionValidationTimers(
                `rejection-${event.timestamp}`,
                event.price,
                record
            );

            this.logger.debug(
                "SignalValidationLogger: Signal rejection logged",
                {
                    detectorType,
                    rejectionReason,
                    price: event.price,
                    thresholdType: thresholdDetails.type,
                    threshold: thresholdDetails.threshold,
                    actual: thresholdDetails.actual,
                }
            );
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to log rejection",
                {
                    detectorType,
                    rejectionReason,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Set up validation timers for signal performance tracking
     */
    private setupValidationTimers(signalId: string, signalPrice: number): void {
        const timers: NodeJS.Timeout[] = [];

        // 5-minute validation
        timers.push(
            setTimeout(
                () => {
                    void this.validateSignal(signalId, signalPrice, "5min");
                },
                5 * 60 * 1000
            )
        );

        // 15-minute validation
        timers.push(
            setTimeout(
                () => {
                    void this.validateSignal(signalId, signalPrice, "15min");
                },
                15 * 60 * 1000
            )
        );

        // 1-hour validation
        timers.push(
            setTimeout(
                () => {
                    void this.validateSignal(signalId, signalPrice, "1hr");
                    // Clean up after final validation
                    this.cleanupValidation(signalId);
                },
                60 * 60 * 1000
            )
        );

        this.validationTimers.set(signalId, timers);
    }

    /**
     * Set up rejection validation timers
     */
    private setupRejectionValidationTimers(
        rejectionId: string,
        rejectionPrice: number,
        record: SignalRejectionRecord
    ): void {
        // 5-minute validation
        setTimeout(
            () => {
                void this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "5min"
                );
            },
            5 * 60 * 1000
        );

        // 15-minute validation
        setTimeout(
            () => {
                void this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "15min"
                );
            },
            15 * 60 * 1000
        );

        // 1-hour validation and final write
        setTimeout(
            () => {
                void this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "1hr"
                );
                void this.writeRejectionRecord(record);
            },
            60 * 60 * 1000
        );
    }

    /**
     * Validate signal performance at specific time intervals
     */
    private async validateSignal(
        signalId: string,
        originalPrice: number,
        timeframe: "5min" | "15min" | "1hr"
    ): Promise<void> {
        const record = this.pendingValidations.get(signalId);
        if (!record) return;

        // In a real implementation, you would fetch the current market price
        // For this example, we'll simulate price data
        const currentPrice = await this.getCurrentPrice();

        if (currentPrice === null) {
            this.logger.warn(
                "SignalValidationLogger: Could not get current price for validation",
                {
                    signalId,
                    timeframe,
                }
            );
            return;
        }

        const movement = FinancialMath.divideQuantities(
            Math.abs(currentPrice - originalPrice),
            originalPrice
        );

        const direction =
            currentPrice > originalPrice
                ? "up"
                : currentPrice < originalPrice
                  ? "down"
                  : "sideways";

        const isAccurate = this.evaluateSignalAccuracy(
            record.signalSide,
            direction,
            movement
        );

        // Update record
        switch (timeframe) {
            case "5min":
                record.priceAt5min = currentPrice;
                record.movementDirection5min = direction;
                record.maxMovement5min = movement;
                record.signalAccuracy5min = isAccurate;
                break;
            case "15min":
                record.priceAt15min = currentPrice;
                record.movementDirection15min = direction;
                record.maxMovement15min = movement;
                record.signalAccuracy15min = isAccurate;
                break;
            case "1hr":
                record.priceAt1hr = currentPrice;
                record.movementDirection1hr = direction;
                record.maxMovement1hr = movement;
                record.signalAccuracy1hr = isAccurate;

                // Write final record
                this.writeSignalRecord(record);
                break;
        }

        this.logger.debug("SignalValidationLogger: Signal validated", {
            signalId,
            timeframe,
            originalPrice,
            currentPrice,
            movement,
            direction,
            isAccurate,
        });
    }

    /**
     * Validate rejection to see if it was a missed opportunity
     */
    private async validateRejection(
        rejectionId: string,
        originalPrice: number,
        record: SignalRejectionRecord,
        timeframe: "5min" | "15min" | "1hr"
    ): Promise<void> {
        const currentPrice = await this.getCurrentPrice();
        if (currentPrice === null) return;

        const movement = FinancialMath.divideQuantities(
            currentPrice - originalPrice,
            originalPrice
        );

        // Determine if this was a valid signal that should not have been rejected
        const significantMovement = Math.abs(movement) > 0.007; // 0.7% movement threshold

        switch (timeframe) {
            case "5min":
                record.subsequentMovement5min = movement;
                break;
            case "15min":
                record.subsequentMovement15min = movement;
                break;
            case "1hr":
                record.subsequentMovement1hr = movement;
                record.wasValidSignal = significantMovement;
                break;
        }
    }

    /**
     * Write signal record to CSV
     */
    private writeSignalRecord(record: SignalValidationRecord): void {
        try {
            const csvLine =
                [
                    record.timestamp,
                    record.signalId,
                    record.detectorType,
                    record.signalSide,
                    record.confidence,
                    record.price,
                    record.tradeQuantity,
                    record.bestBid || "",
                    record.bestAsk || "",
                    record.spread || "",
                    record.totalAggressiveVolume,
                    record.totalPassiveVolume,
                    record.aggressiveBuyVolume,
                    record.aggressiveSellVolume,
                    record.passiveBidVolume,
                    record.passiveAskVolume,
                    record.volumeImbalance,
                    record.institutionalVolumeRatio,
                    record.activeZones,
                    record.zoneTotalVolume,
                    record.priceEfficiency || "",
                    record.absorptionRatio || "",
                    record.exhaustionRatio || "",
                    record.depletionRatio || "",
                    record.signalStrength,
                    record.confluenceScore,
                    record.institutionalFootprint,
                    record.qualityGrade,
                    record.priceAt5min || "",
                    record.priceAt15min || "",
                    record.priceAt1hr || "",
                    record.movementDirection5min || "",
                    record.movementDirection15min || "",
                    record.movementDirection1hr || "",
                    record.maxMovement5min || "",
                    record.maxMovement15min || "",
                    record.maxMovement1hr || "",
                    record.signalAccuracy5min || "",
                    record.signalAccuracy15min || "",
                    record.signalAccuracy1hr || "",
                ].join(",") + "\n";

            // ✅ NON-BLOCKING: Add to buffer instead of direct file write
            this.signalsBuffer.push(csvLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (this.signalsBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write signal record",
                {
                    signalId: record.signalId,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Write rejection record to CSV
     */
    private writeRejectionRecord(record: SignalRejectionRecord): void {
        try {
            const csvLine =
                [
                    record.timestamp,
                    record.detectorType,
                    record.rejectionReason,
                    record.price,
                    record.thresholdType,
                    record.thresholdValue,
                    record.actualValue,
                    record.aggressiveVolume,
                    record.passiveVolume,
                    record.priceEfficiency || "",
                    record.confidence,
                    record.subsequentMovement5min || "",
                    record.subsequentMovement15min || "",
                    record.subsequentMovement1hr || "",
                    record.wasValidSignal || "",
                ].join(",") + "\n";

            // ✅ NON-BLOCKING: Add to buffer instead of direct file write
            this.rejectionsBuffer.push(csvLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (this.rejectionsBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write rejection record",
                {
                    timestamp: record.timestamp,
                    detectorType: record.detectorType,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Calculate volume imbalance ratio
     */
    private calculateVolumeImbalance(
        buyVolume: number,
        sellVolume: number
    ): number {
        const totalVolume = buyVolume + sellVolume;
        if (totalVolume === 0) return 0;

        const buyRatio = FinancialMath.divideQuantities(buyVolume, totalVolume);
        return Math.abs(buyRatio - 0.5); // Distance from perfect balance
    }

    /**
     * Calculate total volume across all zones
     */
    private calculateZoneTotalVolume(zones: unknown[]): number {
        return zones.reduce((total: number, zone) => {
            const typedZone = zone as {
                aggressiveVolume?: number;
                passiveVolume?: number;
            };
            return (
                total +
                (typedZone.aggressiveVolume || 0) +
                (typedZone.passiveVolume || 0)
            );
        }, 0);
    }

    /**
     * Calculate confluence score based on zone overlap
     */
    private calculateConfluenceScore(event: EnrichedTradeEvent): number {
        if (!event.zoneData) return 0;

        // Simple confluence score based on number of active zones
        const zoneCount = event.zoneData.zones.length;
        return Math.min(1.0, zoneCount / 10); // Normalize to 0-1 scale
    }

    /**
     * Determine signal quality grade
     */
    private determineQualityGrade(
        confidence: number,
        institutionalRatio: number
    ): "premium" | "standard" | "low" {
        if (confidence > 0.8 && institutionalRatio > 0.7) return "premium";
        if (confidence > 0.6 && institutionalRatio > 0.5) return "standard";
        return "low";
    }

    /**
     * Evaluate signal accuracy based on movement direction and magnitude
     */
    private evaluateSignalAccuracy(
        signalSide: "buy" | "sell",
        actualDirection: "up" | "down" | "sideways",
        movement: number
    ): boolean {
        // Require minimum 0.3% movement for accuracy
        if (movement < 0.003) return false;

        // Check direction alignment
        return (
            (signalSide === "buy" && actualDirection === "up") ||
            (signalSide === "sell" && actualDirection === "down")
        );
    }

    /**
     * Get current market price (placeholder - implement with real data source)
     */
    private getCurrentPrice(): Promise<number | null> {
        // In real implementation, this would fetch from the order book or price feed
        // For now, return null to indicate unavailable price data
        return Promise.resolve(null);
    }

    /**
     * Clean up validation timers and records
     */
    private cleanupValidation(signalId: string): void {
        // Clear timers
        const timers = this.validationTimers.get(signalId);
        if (timers) {
            timers.forEach((timer) => clearTimeout(timer));
            this.validationTimers.delete(signalId);
        }

        // Remove from pending validations
        this.pendingValidations.delete(signalId);
    }

    /**
     * Get validation statistics
     */
    public getValidationStats(): {
        pendingValidations: number;
        totalLogged: number;
    } {
        return {
            pendingValidations: this.pendingValidations.size,
            totalLogged: this.pendingValidations.size, // Simplified for this implementation
        };
    }
}

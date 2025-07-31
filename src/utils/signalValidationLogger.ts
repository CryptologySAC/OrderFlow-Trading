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
    detectorType: "exhaustion" | "absorption" | "deltacvd";
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
 * Signal rejection tracking for threshold optimization - ALL PARAMETERS INCLUDED
 */
export interface SignalRejectionRecord {
    timestamp: number;
    detectorType: "exhaustion" | "absorption" | "deltacvd";
    rejectionReason: string;
    price: number;

    // What caused rejection (primary failure)
    thresholdType: string;
    thresholdValue: number;
    actualValue: number;

    // Basic market context
    aggressiveVolume: number;
    passiveVolume: number;
    priceEfficiency: number | null;
    confidence: number;

    // EXHAUSTION: All 20 parameters
    exhaustion_minAggVolume?: number;
    exhaustion_timeWindowIndex?: number;
    exhaustion_exhaustionThreshold?: number;
    exhaustion_eventCooldownMs?: number;
    exhaustion_useStandardizedZones?: boolean;
    exhaustion_enhancementMode?: string;
    exhaustion_minEnhancedConfidenceThreshold?: number;
    exhaustion_depletionVolumeThreshold?: number;
    exhaustion_depletionRatioThreshold?: number;
    exhaustion_enableDepletionAnalysis?: boolean;
    exhaustion_depletionConfidenceBoost?: number;
    exhaustion_varianceReductionFactor?: number;
    exhaustion_alignmentNormalizationFactor?: number;
    exhaustion_passiveVolumeExhaustionRatio?: number;
    exhaustion_aggressiveVolumeExhaustionThreshold?: number;
    exhaustion_aggressiveVolumeReductionFactor?: number;
    exhaustion_passiveRatioBalanceThreshold?: number;
    exhaustion_premiumConfidenceThreshold?: number;
    exhaustion_variancePenaltyFactor?: number;
    exhaustion_ratioBalanceCenterPoint?: number;

    // ABSORPTION: All 23 parameters
    absorption_minAggVolume?: number;
    absorption_timeWindowIndex?: number;
    absorption_eventCooldownMs?: number;
    absorption_priceEfficiencyThreshold?: number;
    absorption_maxAbsorptionRatio?: number;
    absorption_minPassiveMultiplier?: number;
    absorption_passiveAbsorptionThreshold?: number;
    absorption_expectedMovementScalingFactor?: number;
    absorption_contextConfidenceBoostMultiplier?: number;
    absorption_liquidityGradientRange?: number;
    absorption_institutionalVolumeThreshold?: number;
    absorption_institutionalVolumeRatioThreshold?: number;
    absorption_enableInstitutionalVolumeFilter?: boolean;
    absorption_institutionalVolumeBoost?: number;
    absorption_minAbsorptionScore?: number;
    absorption_finalConfidenceRequired?: number;
    absorption_confidenceBoostReduction?: number;
    absorption_maxZoneCountForScoring?: number;
    absorption_minEnhancedConfidenceThreshold?: number;
    absorption_useStandardizedZones?: boolean;
    absorption_enhancementMode?: string;
    absorption_balanceThreshold?: number;
    absorption_confluenceMinZones?: number;
    absorption_confluenceMaxDistance?: number;

    // DELTACVD: All 8 parameters
    deltacvd_minTradesPerSec?: number;
    deltacvd_minVolPerSec?: number;
    deltacvd_signalThreshold?: number;
    deltacvd_eventCooldownMs?: number;
    deltacvd_timeWindowIndex?: number;
    deltacvd_enhancementMode?: string;
    deltacvd_cvdImbalanceThreshold?: number;
    deltacvd_institutionalThreshold?: number;

    // DYNAMIC CALCULATED VALUES - All actual computed values during detection
    calculatedValues?: { [key: string]: number | boolean | string };

    // Post-rejection analysis (filled later)
    subsequentMovement5min?: number;
    subsequentMovement15min?: number;
    subsequentMovement1hr?: number;
    wasValidSignal?: boolean; // True if significant movement occurred despite rejection
}

/**
 * Successful signal parameter values for 90-minute optimization
 */
export interface SuccessfulSignalRecord {
    timestamp: number;
    detectorType: "exhaustion" | "absorption" | "deltacvd";
    price: number;

    // ALL 40+ parameter values from config that allowed this signal to pass
    parameterValues: {
        // EXHAUSTION DETECTOR - ALL PARAMETERS FROM CONFIG
        minAggVolume?: number;
        exhaustionThreshold?: number;
        timeWindowIndex?: number;
        eventCooldownMs?: number;
        useStandardizedZones?: boolean;
        enhancementMode?: string;
        minEnhancedConfidenceThreshold?: number;
        enableDepletionAnalysis?: boolean;
        depletionVolumeThreshold?: number;
        depletionRatioThreshold?: number;
        depletionConfidenceBoost?: number;
        passiveVolumeExhaustionRatio?: number;
        varianceReductionFactor?: number;
        alignmentNormalizationFactor?: number;
        aggressiveVolumeExhaustionThreshold?: number;
        aggressiveVolumeReductionFactor?: number;
        passiveRatioBalanceThreshold?: number;
        premiumConfidenceThreshold?: number;
        variancePenaltyFactor?: number;
        ratioBalanceCenterPoint?: number;

        // ABSORPTION DETECTOR - ALL PARAMETERS FROM CONFIG
        absorptionThreshold?: number;
        priceEfficiencyThreshold?: number;
        maxAbsorptionRatio?: number;
        minPassiveMultiplier?: number;
        passiveAbsorptionThreshold?: number;
        expectedMovementScalingFactor?: number;
        contextConfidenceBoostMultiplier?: number;
        liquidityGradientRange?: number;
        institutionalVolumeThreshold?: number;
        institutionalVolumeRatioThreshold?: number;
        enableInstitutionalVolumeFilter?: boolean;
        institutionalVolumeBoost?: number;
        minAbsorptionScore?: number;
        finalConfidenceRequired?: number;
        confidenceBoostReduction?: number;
        maxZoneCountForScoring?: number;
        balanceThreshold?: number;
        confluenceMinZones?: number;
        confluenceMaxDistance?: number;

        // RUNTIME VALUES (calculated during signal)
        priceEfficiency?: number;
        confidence?: number;
        aggressiveVolume?: number;
        passiveVolume?: number;
        volumeRatio?: number;
        institutionalVolumeRatio?: number;

        // DELTACVD DETECTOR - ALL PARAMETERS FROM CONFIG
        minTradesPerSec?: number;
        minVolPerSec?: number;
        signalThreshold?: number;
        cvdImbalanceThreshold?: number;
        institutionalThreshold?: number;

        // DeltaCVD-specific runtime values
        cvdDivergenceStrength?: number;
        cvdAffectedZones?: number;
        buyVolume?: number;
        sellVolume?: number;
        cvdDelta?: number;
        buyRatio?: number;
        enhancedConfidence?: number;
    };

    // Market context
    marketVolume: number;
    marketSpread: number;
    marketVolatility: number;

    // Post-signal analysis (filled later)
    subsequentMovement5min?: number;
    subsequentMovement15min?: number;
    subsequentMovement90min?: number;
    wasTopOrBottomSignal?: boolean;
    signalQuality?: "top" | "bottom" | "noise";
}

/**
 * Signal Validation Logger - NON-BLOCKING signal performance tracking for real-time trading
 *
 * ✅ INSTITUTIONAL ARCHITECTURE: Internal buffering ensures signal processing never blocks on disk I/O
 */
export class SignalValidationLogger {
    private readonly signalsFilePath: string;
    private readonly rejectionsFilePath: string;
    private readonly successfulSignalsFilePath: string;
    private readonly pendingValidations = new Map<
        string,
        SignalValidationRecord
    >();
    private readonly validationTimers = new Map<string, NodeJS.Timeout[]>();
    private readonly pendingRejections = new Map<
        string,
        SignalRejectionRecord
    >();
    private readonly successfulSignals = new Map<
        string,
        SuccessfulSignalRecord
    >();

    // ✅ NON-BLOCKING ARCHITECTURE: Internal buffering for high-performance logging
    private readonly signalsBuffer: string[] = [];
    private readonly rejectionsBuffer: string[] = [];
    private readonly successfulSignalsBuffer: string[] = [];
    private readonly maxBufferSize = 100; // Flush after 100 entries
    private readonly flushInterval = 5000; // Flush every 5 seconds
    private flushTimer?: NodeJS.Timeout;
    private optimizationTimer?: NodeJS.Timeout;
    private isInitialized = false;

    // Price tracking for validation
    private currentPrice: number | null = null;

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
        this.successfulSignalsFilePath = path.join(
            outputDir,
            `successful_signals_${timestamp}.csv`
        );

        void this.initializeLogFiles();

        // Start 90-minute optimization cycle
        this.start90MinuteOptimization();
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

            // Successful signals CSV header - ALL 40+ PARAMETERS
            const successfulHeader =
                [
                    "timestamp",
                    "detectorType",
                    "price",
                    // EXHAUSTION PARAMETERS
                    "minAggVolume",
                    "exhaustionThreshold",
                    "timeWindowIndex",
                    "eventCooldownMs",
                    "useStandardizedZones",
                    "enhancementMode",
                    "minEnhancedConfidenceThreshold",
                    "enableDepletionAnalysis",
                    "depletionVolumeThreshold",
                    "depletionRatioThreshold",
                    "depletionConfidenceBoost",
                    "passiveVolumeExhaustionRatio",
                    "varianceReductionFactor",
                    "alignmentNormalizationFactor",
                    "aggressiveVolumeExhaustionThreshold",
                    "aggressiveVolumeReductionFactor",
                    "passiveRatioBalanceThreshold",
                    "premiumConfidenceThreshold",
                    "variancePenaltyFactor",
                    "ratioBalanceCenterPoint",
                    // ABSORPTION PARAMETERS
                    "absorptionThreshold",
                    "priceEfficiencyThreshold",
                    "maxAbsorptionRatio",
                    "minPassiveMultiplier",
                    "passiveAbsorptionThreshold",
                    "expectedMovementScalingFactor",
                    "contextConfidenceBoostMultiplier",
                    "liquidityGradientRange",
                    "institutionalVolumeThreshold",
                    "institutionalVolumeRatioThreshold",
                    "enableInstitutionalVolumeFilter",
                    "institutionalVolumeBoost",
                    "minAbsorptionScore",
                    "finalConfidenceRequired",
                    "confidenceBoostReduction",
                    "maxZoneCountForScoring",
                    "balanceThreshold",
                    "confluenceMinZones",
                    "confluenceMaxDistance",
                    // RUNTIME VALUES
                    "priceEfficiency",
                    "confidence",
                    "aggressiveVolume",
                    "passiveVolume",
                    "volumeRatio",
                    "institutionalVolumeRatio",
                    // MARKET CONTEXT
                    "marketVolume",
                    "marketSpread",
                    "marketVolatility",
                    "subsequentMovement5min",
                    "subsequentMovement15min",
                    "subsequentMovement90min",
                    "wasTopOrBottomSignal",
                    "signalQuality",
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

            try {
                await fs.access(this.successfulSignalsFilePath);
            } catch {
                // File doesn't exist, create with header
                await fs.writeFile(
                    this.successfulSignalsFilePath,
                    successfulHeader
                );
            }

            this.logger.info(
                "SignalValidationLogger: NON-BLOCKING CSV files initialized",
                {
                    signalsFile: this.signalsFilePath,
                    rejectionsFile: this.rejectionsFilePath,
                    successfulSignalsFile: this.successfulSignalsFilePath,
                    maxBufferSize: this.maxBufferSize,
                    flushInterval: this.flushInterval,
                    optimizationInterval: "90 minutes",
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

        if (this.successfulSignalsBuffer.length > 0) {
            const successfulToFlush = this.successfulSignalsBuffer.splice(0);
            void this.flushSuccessfulSignalsBuffer(successfulToFlush);
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
     * ✅ ASYNC SUCCESSFUL SIGNALS BUFFER FLUSH: Background file writes
     */
    private async flushSuccessfulSignalsBuffer(
        records: string[]
    ): Promise<void> {
        try {
            const content = records.join("");
            await fs.appendFile(this.successfulSignalsFilePath, content);
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to flush successful signals buffer",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    recordCount: records.length,
                }
            );
        }
    }

    /**
     * Start 90-minute automatic optimization cycle
     */
    private start90MinuteOptimization(): void {
        const optimizationInterval = 90 * 60 * 1000; // 90 minutes in milliseconds

        this.optimizationTimer = setInterval(() => {
            void this.run90MinuteOptimization();
        }, optimizationInterval);

        this.logger.info(
            "SignalValidationLogger: 90-minute optimization started",
            {
                intervalMinutes: 90,
                nextOptimization: new Date(
                    Date.now() + optimizationInterval
                ).toISOString(),
            }
        );
    }

    /**
     * Run 90-minute optimization analysis
     */
    private async run90MinuteOptimization(): Promise<void> {
        try {
            this.logger.info(
                "SignalValidationLogger: Starting 90-minute optimization analysis"
            );

            // Import and run the optimizer
            const { AutomaticParameterOptimizer } = await import(
                "./automaticParameterOptimizer.js"
            );
            const optimizer = new AutomaticParameterOptimizer(
                this.logger,
                this.outputDir
            );

            await optimizer.runOptimization();

            this.logger.info(
                "SignalValidationLogger: 90-minute optimization completed"
            );
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to run 90-minute optimization",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
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

        if (this.optimizationTimer) {
            clearInterval(this.optimizationTimer);
            this.optimizationTimer = undefined;
        }

        // Final flush of any remaining buffered data
        this.flushBuffers();

        // Clear validation timers
        for (const [, timers] of this.validationTimers) {
            timers.forEach((timer) => clearTimeout(timer));
        }
        this.validationTimers.clear();
        this.pendingValidations.clear();
        this.pendingRejections.clear();
        this.successfulSignals.clear();
    }

    /**
     * Update current price for validation calculations
     */
    public updateCurrentPrice(price: number): void {
        this.currentPrice = price;
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
                detectorType: signal.type as
                    | "exhaustion"
                    | "absorption"
                    | "deltacvd",
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
     * Log successful signal parameters for 90-minute optimization
     */
    public logSuccessfulSignal(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        event: EnrichedTradeEvent,
        parameterValues: SuccessfulSignalRecord["parameterValues"],
        marketContext: {
            marketVolume: number;
            marketSpread: number;
            marketVolatility: number;
        }
    ): void {
        try {
            const record: SuccessfulSignalRecord = {
                timestamp: event.timestamp,
                detectorType,
                price: event.price,
                parameterValues,
                marketVolume: marketContext.marketVolume,
                marketSpread: marketContext.marketSpread,
                marketVolatility: marketContext.marketVolatility,
            };

            // Store for validation tracking
            const recordId = `successful-${event.timestamp}-${Math.random()}`;
            this.successfulSignals.set(recordId, record);

            // Set up validation timers for 5min, 15min, and 90min
            this.setupSuccessfulSignalValidationTimers(
                recordId,
                event.price,
                record
            );

            this.logger.debug(
                "SignalValidationLogger: Successful signal parameters logged",
                {
                    detectorType,
                    price: event.price,
                    timestamp: event.timestamp,
                    parameterCount: Object.keys(parameterValues).length,
                }
            );
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to log successful signal",
                {
                    detectorType,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
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
            // ALL CALCULATED VALUES - not config values
            calculatedValues?: { [key: string]: number | boolean | string };
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

                // ALL calculated values from detector
                calculatedValues: marketContext.calculatedValues,
            };

            // Store rejection for later validation
            const rejectionId = `rejection-${event.timestamp}-${Math.random()}`;
            this.pendingRejections.set(rejectionId, record);

            // Write rejection immediately to CSV (with empty movement fields)
            this.writeRejectionRecord(record);

            // Schedule retrospective analysis with validation timers for movement tracking
            this.setupRejectionValidationTimers(
                rejectionId,
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
                    this.validateSignal(signalId, signalPrice, "5min");
                },
                5 * 60 * 1000
            )
        );

        // 15-minute validation
        timers.push(
            setTimeout(
                () => {
                    this.validateSignal(signalId, signalPrice, "15min");
                },
                15 * 60 * 1000
            )
        );

        // 1-hour validation
        timers.push(
            setTimeout(
                () => {
                    this.validateSignal(signalId, signalPrice, "1hr");
                    // Clean up after final validation
                    this.cleanupValidation(signalId);
                },
                60 * 60 * 1000
            )
        );

        this.validationTimers.set(signalId, timers);
    }

    /**
     * Set up successful signal validation timers
     */
    private setupSuccessfulSignalValidationTimers(
        recordId: string,
        signalPrice: number,
        record: SuccessfulSignalRecord
    ): void {
        // 5-minute validation
        setTimeout(
            () => {
                this.validateSuccessfulSignal(
                    recordId,
                    signalPrice,
                    record,
                    "5min"
                );
            },
            5 * 60 * 1000
        );

        // 15-minute validation
        setTimeout(
            () => {
                this.validateSuccessfulSignal(
                    recordId,
                    signalPrice,
                    record,
                    "15min"
                );
            },
            15 * 60 * 1000
        );

        // 90-minute validation and final write (for optimization analysis)
        setTimeout(
            () => {
                this.validateSuccessfulSignal(
                    recordId,
                    signalPrice,
                    record,
                    "90min"
                );
                this.writeSuccessfulSignalRecord(record);
                this.successfulSignals.delete(recordId);
            },
            90 * 60 * 1000
        );
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
                this.validateRejection(
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
                this.validateRejection(
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
                this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "1hr"
                );
            },
            60 * 60 * 1000
        );
    }

    /**
     * Validate signal performance at specific time intervals
     */
    private validateSignal(
        signalId: string,
        originalPrice: number,
        timeframe: "5min" | "15min" | "1hr"
    ): void {
        const record = this.pendingValidations.get(signalId);
        if (!record) return;

        const currentPrice = this.currentPrice;

        if (currentPrice === null) {
            this.logger.warn(
                "SignalValidationLogger: No current price available for validation",
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
     * Validate successful signal to classify as top/bottom or noise
     */
    private validateSuccessfulSignal(
        recordId: string,
        originalPrice: number,
        record: SuccessfulSignalRecord,
        timeframe: "5min" | "15min" | "90min"
    ): void {
        const currentPrice = this.currentPrice;
        if (currentPrice === null) return;

        const movement = FinancialMath.divideQuantities(
            currentPrice - originalPrice,
            originalPrice
        );

        switch (timeframe) {
            case "5min":
                record.subsequentMovement5min = movement;
                break;
            case "15min":
                record.subsequentMovement15min = movement;
                break;
            case "90min":
                record.subsequentMovement90min = movement;

                // Classify signal quality based on 90-minute movement
                const absMovement = Math.abs(movement);
                record.wasTopOrBottomSignal = absMovement >= 0.007; // 0.7% threshold

                if (absMovement >= 0.007) {
                    // Determine if top or bottom signal
                    if (movement >= 0.007) {
                        record.signalQuality = "bottom"; // Price went up = bottom signal
                    } else if (movement <= -0.007) {
                        record.signalQuality = "top"; // Price went down = top signal
                    }
                } else {
                    record.signalQuality = "noise";
                }
                break;
        }
    }

    /**
     * Validate rejection to see if it was a missed opportunity
     */
    private validateRejection(
        rejectionId: string,
        originalPrice: number,
        record: SignalRejectionRecord,
        timeframe: "5min" | "15min" | "1hr"
    ): void {
        const currentPrice = this.currentPrice;
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

                // Write final rejection record and clean up
                this.writeRejectionRecord(record);
                this.pendingRejections.delete(rejectionId);
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
     * Write successful signal record to CSV
     */
    private writeSuccessfulSignalRecord(record: SuccessfulSignalRecord): void {
        try {
            const csvLine =
                [
                    record.timestamp,
                    record.detectorType,
                    record.price,
                    // EXHAUSTION PARAMETERS - ALL 40+ VALUES
                    record.parameterValues.minAggVolume || "",
                    record.parameterValues.exhaustionThreshold || "",
                    record.parameterValues.timeWindowIndex || "",
                    record.parameterValues.eventCooldownMs || "",
                    record.parameterValues.useStandardizedZones || "",
                    record.parameterValues.enhancementMode || "",
                    record.parameterValues.minEnhancedConfidenceThreshold || "",
                    record.parameterValues.enableDepletionAnalysis || "",
                    record.parameterValues.depletionVolumeThreshold || "",
                    record.parameterValues.depletionRatioThreshold || "",
                    record.parameterValues.depletionConfidenceBoost || "",
                    record.parameterValues.passiveVolumeExhaustionRatio || "",
                    record.parameterValues.varianceReductionFactor || "",
                    record.parameterValues.alignmentNormalizationFactor || "",
                    record.parameterValues
                        .aggressiveVolumeExhaustionThreshold || "",
                    record.parameterValues.aggressiveVolumeReductionFactor ||
                        "",
                    record.parameterValues.passiveRatioBalanceThreshold || "",
                    record.parameterValues.premiumConfidenceThreshold || "",
                    record.parameterValues.variancePenaltyFactor || "",
                    record.parameterValues.ratioBalanceCenterPoint || "",
                    // ABSORPTION PARAMETERS - ALL VALUES
                    record.parameterValues.absorptionThreshold || "",
                    record.parameterValues.priceEfficiencyThreshold || "",
                    record.parameterValues.maxAbsorptionRatio || "",
                    record.parameterValues.minPassiveMultiplier || "",
                    record.parameterValues.passiveAbsorptionThreshold || "",
                    record.parameterValues.expectedMovementScalingFactor || "",
                    record.parameterValues.contextConfidenceBoostMultiplier ||
                        "",
                    record.parameterValues.liquidityGradientRange || "",
                    record.parameterValues.institutionalVolumeThreshold || "",
                    record.parameterValues.institutionalVolumeRatioThreshold ||
                        "",
                    record.parameterValues.enableInstitutionalVolumeFilter ||
                        "",
                    record.parameterValues.institutionalVolumeBoost || "",
                    record.parameterValues.minAbsorptionScore || "",
                    record.parameterValues.finalConfidenceRequired || "",
                    record.parameterValues.confidenceBoostReduction || "",
                    record.parameterValues.maxZoneCountForScoring || "",
                    record.parameterValues.balanceThreshold || "",
                    record.parameterValues.confluenceMinZones || "",
                    record.parameterValues.confluenceMaxDistance || "",
                    // RUNTIME VALUES
                    record.parameterValues.priceEfficiency || "",
                    record.parameterValues.confidence || "",
                    record.parameterValues.aggressiveVolume || "",
                    record.parameterValues.passiveVolume || "",
                    record.parameterValues.volumeRatio || "",
                    record.parameterValues.institutionalVolumeRatio || "",
                    // MARKET CONTEXT
                    record.marketVolume,
                    record.marketSpread,
                    record.marketVolatility,
                    record.subsequentMovement5min || "",
                    record.subsequentMovement15min || "",
                    record.subsequentMovement90min || "",
                    record.wasTopOrBottomSignal || "",
                    record.signalQuality || "",
                ].join(",") + "\n";

            // ✅ NON-BLOCKING: Add to buffer instead of direct file write
            this.successfulSignalsBuffer.push(csvLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (this.successfulSignalsBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write successful signal record",
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

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
import type {
    AbsorptionCalculatedValues,
    ExhaustionCalculatedValues,
    DeltaCVDCalculatedValues,
} from "../types/calculatedValuesTypes.js";

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
    tpSlStatus?: "TP" | "SL" | "PENDING" | "NEITHER"; // Target reached or stop loss hit

    // Quality flags
    crossTimeframe?: boolean;
    institutionalVolume?: boolean;
    zoneConfluence?: boolean;
    exhaustionGap?: boolean;
    priceEfficiencyHigh?: boolean;

    // Calculated Values (for CSV output)
    calculatedValues:
        | AbsorptionCalculatedValues
        | ExhaustionCalculatedValues
        | DeltaCVDCalculatedValues;

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
    absorption_liquidityGradientRange?: number;
    absorption_institutionalVolumeThreshold?: number;
    absorption_institutionalVolumeRatioThreshold?: number;
    absorption_enableInstitutionalVolumeFilter?: boolean;
    absorption_minAbsorptionScore?: number;
    absorption_finalConfidenceRequired?: number;
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
    calculatedValues:
        | AbsorptionCalculatedValues
        | ExhaustionCalculatedValues
        | DeltaCVDCalculatedValues;

    // Post-rejection analysis (filled later)
    subsequentMovement5min?: number;
    subsequentMovement15min?: number;
    subsequentMovement1hr?: number;
    wasValidSignal?: boolean; // True if significant movement occurred despite rejection
    tpSlStatus?: "TP" | "SL" | "NEITHER"; // Would have hit target or stop loss

    // Quality flags (what signal had when rejected)
    crossTimeframe?: boolean;
    institutionalVolume?: boolean;
    zoneConfluence?: boolean;
    exhaustionGap?: boolean;
    priceEfficiencyHigh?: boolean;
}

/**
 * Successful signal parameter values for 90-minute optimization
 * INSTITUTIONAL COMPLIANCE: Includes calculatedValues for proper CSV alignment
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
        liquidityGradientRange?: number;
        institutionalVolumeThreshold?: number;
        institutionalVolumeRatioThreshold?: number;
        enableInstitutionalVolumeFilter?: boolean;
        minAbsorptionScore?: number;
        finalConfidenceRequired?: number;
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

    // ✅ CALCULATED VALUES: For proper CSV header alignment
    calculatedValues:
        | AbsorptionCalculatedValues
        | ExhaustionCalculatedValues
        | DeltaCVDCalculatedValues;

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
    tpSlStatus?: "TP" | "SL" | "NEITHER"; // Target reached or stop loss hit

    // Quality flags
    crossTimeframe?: boolean;
    institutionalVolume?: boolean;
    zoneConfluence?: boolean;
    exhaustionGap?: boolean;
    priceEfficiencyHigh?: boolean;
}

/**
 * Signal Validation Logger - NON-BLOCKING signal performance tracking for real-time trading
 *
 * ✅ INSTITUTIONAL ARCHITECTURE: Internal buffering ensures signal processing never blocks on disk I/O
 */
export class SignalValidationLogger {
    // DETECTOR-SPECIFIC FILE PATHS
    private absorptionSignalsFilePath: string;
    private absorptionRejectionsFilePath: string;
    private absorptionSuccessfulFilePath: string;
    private absorptionRejectedMissedFilePath!: string; // Rejected signals that would have been TP

    private exhaustionSignalsFilePath: string;
    private exhaustionRejectionsFilePath: string;
    private exhaustionSuccessfulFilePath: string;
    private exhaustionRejectedMissedFilePath!: string; // Rejected signals that would have been TP

    private deltacvdSignalsFilePath: string;
    private deltacvdRejectionsFilePath: string;
    private deltacvdSuccessfulFilePath: string;
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

    // ✅ NON-BLOCKING ARCHITECTURE: Detector-specific buffering for high-performance logging
    private readonly absorptionSignalsBuffer: string[] = [];
    private readonly absorptionRejectionsBuffer: string[] = [];
    private readonly absorptionSuccessfulBuffer: string[] = [];
    private readonly absorptionRejectedMissedBuffer: string[] = [];

    private readonly exhaustionSignalsBuffer: string[] = [];
    private readonly exhaustionRejectionsBuffer: string[] = [];
    private readonly exhaustionSuccessfulBuffer: string[] = [];
    private readonly exhaustionRejectedMissedBuffer: string[] = [];

    private readonly deltacvdSignalsBuffer: string[] = [];
    private readonly deltacvdRejectionsBuffer: string[] = [];
    private readonly deltacvdSuccessfulBuffer: string[] = [];
    private readonly maxBufferSize = 100; // Flush after 100 entries
    private readonly flushInterval = 5000; // Flush every 5 seconds
    private flushTimer?: NodeJS.Timeout | undefined;
    private optimizationTimer?: NodeJS.Timeout | undefined;
    //private isInitialized = false;

    // Price tracking for validation
    private currentPrice: number | null = null;
    private priceHistory: Map<number, number> = new Map(); // timestamp -> price for stop loss tracking
    private readonly STOP_LOSS_THRESHOLD = 0.0035; // 0.35% stop loss
    private readonly TARGET_THRESHOLD = 0.007; // 0.7% target

    // Daily rotation tracking
    private currentDateString: string;

    constructor(
        private readonly logger: ILogger,
        private readonly outputDir: string = "logs/signal_validation"
    ) {
        this.currentDateString = this.getCurrentDateString();

        // Initialize detector-specific file paths
        this.absorptionSignalsFilePath = "";
        this.absorptionRejectionsFilePath = "";
        this.absorptionSuccessfulFilePath = "";
        this.exhaustionSignalsFilePath = "";
        this.exhaustionRejectionsFilePath = "";
        this.exhaustionSuccessfulFilePath = "";
        this.deltacvdSignalsFilePath = "";
        this.deltacvdRejectionsFilePath = "";
        this.deltacvdSuccessfulFilePath = "";

        this.updateFilePaths();

        void this.initializeLogFiles();

        // Start 90-minute optimization cycle
        this.start90MinuteOptimization();
    }

    /**
     * Get current date string for file naming (YYYY-MM-DD format)
     */
    private getCurrentDateString(): string {
        const [datePart] = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .split("T");
        return datePart!; // Ensure we have a valid date string
    }

    /**
     * Update detector-specific file paths with current date
     */
    private updateFilePaths(): void {
        // Absorption detector files
        this.absorptionSignalsFilePath = path.join(
            this.outputDir,
            `absorption_validation_${this.currentDateString}.csv`
        );
        this.absorptionRejectionsFilePath = path.join(
            this.outputDir,
            `absorption_rejections_${this.currentDateString}.csv`
        );
        this.absorptionSuccessfulFilePath = path.join(
            this.outputDir,
            `absorption_successful_${this.currentDateString}.csv`
        );
        this.absorptionRejectedMissedFilePath = path.join(
            this.outputDir,
            `absorption_rejected_missed_${this.currentDateString}.csv`
        );

        // Exhaustion detector files
        this.exhaustionSignalsFilePath = path.join(
            this.outputDir,
            `exhaustion_validation_${this.currentDateString}.csv`
        );
        this.exhaustionRejectionsFilePath = path.join(
            this.outputDir,
            `exhaustion_rejections_${this.currentDateString}.csv`
        );
        this.exhaustionSuccessfulFilePath = path.join(
            this.outputDir,
            `exhaustion_successful_${this.currentDateString}.csv`
        );
        this.exhaustionRejectedMissedFilePath = path.join(
            this.outputDir,
            `exhaustion_rejected_missed_${this.currentDateString}.csv`
        );

        // DeltaCVD detector files
        this.deltacvdSignalsFilePath = path.join(
            this.outputDir,
            `deltacvd_validation_${this.currentDateString}.csv`
        );
        this.deltacvdRejectionsFilePath = path.join(
            this.outputDir,
            `deltacvd_rejections_${this.currentDateString}.csv`
        );
        this.deltacvdSuccessfulFilePath = path.join(
            this.outputDir,
            `deltacvd_successful_${this.currentDateString}.csv`
        );
    }

    /**
     * Get detector-specific file path
     */
    private getDetectorFilePath(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        fileType: "signals" | "rejections" | "successful" | "rejected_missed"
    ): string {
        switch (detectorType) {
            case "absorption":
                return fileType === "signals"
                    ? this.absorptionSignalsFilePath
                    : fileType === "rejections"
                      ? this.absorptionRejectionsFilePath
                      : fileType === "successful"
                        ? this.absorptionSuccessfulFilePath
                        : this.absorptionRejectedMissedFilePath;
            case "exhaustion":
                return fileType === "signals"
                    ? this.exhaustionSignalsFilePath
                    : fileType === "rejections"
                      ? this.exhaustionRejectionsFilePath
                      : fileType === "successful"
                        ? this.exhaustionSuccessfulFilePath
                        : this.exhaustionRejectedMissedFilePath;
            case "deltacvd":
                return fileType === "signals"
                    ? this.deltacvdSignalsFilePath
                    : fileType === "rejections"
                      ? this.deltacvdRejectionsFilePath
                      : this.deltacvdSuccessfulFilePath;
        }
    }

    /**
     * Get detector-specific buffer
     */
    private getDetectorBuffer(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        fileType: "signals" | "rejections" | "successful" | "rejected_missed"
    ): string[] {
        switch (detectorType) {
            case "absorption":
                return fileType === "signals"
                    ? this.absorptionSignalsBuffer
                    : fileType === "rejections"
                      ? this.absorptionRejectionsBuffer
                      : fileType === "successful"
                        ? this.absorptionSuccessfulBuffer
                        : this.absorptionRejectedMissedBuffer;
            case "exhaustion":
                return fileType === "signals"
                    ? this.exhaustionSignalsBuffer
                    : fileType === "rejections"
                      ? this.exhaustionRejectionsBuffer
                      : fileType === "successful"
                        ? this.exhaustionSuccessfulBuffer
                        : this.exhaustionRejectedMissedBuffer;
            case "deltacvd":
                return fileType === "signals"
                    ? this.deltacvdSignalsBuffer
                    : fileType === "rejections"
                      ? this.deltacvdRejectionsBuffer
                      : this.deltacvdSuccessfulBuffer;
        }
    }

    /**
     * Check if date has changed and rotate files if necessary
     */
    private checkAndRotateFiles(): boolean {
        const newDateString = this.getCurrentDateString();
        if (newDateString !== this.currentDateString) {
            this.logger.info(
                "SignalValidationLogger: Daily rotation detected",
                {
                    oldDate: this.currentDateString,
                    newDate: newDateString,
                    operation: "file_rotation",
                }
            );

            this.currentDateString = newDateString;
            this.updateFilePaths();

            // Initialize new files with headers
            void this.initializeLogFiles();

            return true;
        }
        return false;
    }

    /**
     * Initialize CSV log files with headers
     */
    private async initializeLogFiles(): Promise<void> {
        try {
            // Ensure output directory exists
            await fs.mkdir(this.outputDir, { recursive: true });

            // ✅ DETECTOR-SPECIFIC HEADERS: Create functions for each file type
            const getDetectorSpecificValidationHeader = (
                detectorType: "absorption" | "exhaustion" | "deltacvd"
            ): string => {
                const commonFields = [
                    "timestamp",
                    "signalId",
                    "detectorType",
                    "signalSide",
                    "price",
                ];

                const outcomeFields = [
                    "confidence",
                    "priceAt5min",
                    "priceAt15min",
                    "priceAt1hr",
                    "signalAccuracy5min",
                    "signalAccuracy15min",
                    "signalAccuracy1hr",
                    "TP_SL",
                    "crossTimeframe",
                    "institutionalVolume",
                    "zoneConfluence",
                    "exhaustionGap",
                    "priceEfficiencyHigh",
                ];

                let configParameters: string[] = [];
                switch (detectorType) {
                    case "exhaustion":
                        configParameters = [
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
                            "passiveVolumeExhaustionRatio",
                            "varianceReductionFactor",
                            "alignmentNormalizationFactor",
                            "aggressiveVolumeExhaustionThreshold",
                            "aggressiveVolumeReductionFactor",
                            "passiveRatioBalanceThreshold",
                            "premiumConfidenceThreshold",
                            "variancePenaltyFactor",
                            "ratioBalanceCenterPoint",
                        ];
                        break;
                    case "absorption":
                        configParameters = [
                            "minAggVolume",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "priceEfficiencyThreshold",
                            "maxAbsorptionRatio",
                            "minPassiveMultiplier",
                            "passiveAbsorptionThreshold",
                            "expectedMovementScalingFactor",
                            "liquidityGradientRange",
                            "institutionalVolumeThreshold",
                            "institutionalVolumeRatioThreshold",
                            "enableInstitutionalVolumeFilter",
                            "minAbsorptionScore",
                            "finalConfidenceRequired",
                            "maxZoneCountForScoring",
                            "minEnhancedConfidenceThreshold",
                            "useStandardizedZones",
                            "enhancementMode",
                            "balanceThreshold",
                            "confluenceMinZones",
                            "confluenceMaxDistance",
                        ];
                        break;
                    case "deltacvd":
                        configParameters = [
                            "minTradesPerSec",
                            "minVolPerSec",
                            "signalThreshold",
                            "eventCooldownMs",
                            "enhancementMode",
                            "cvdImbalanceThreshold",
                            "timeWindowIndex",
                            "institutionalThreshold",
                        ];
                        break;
                }
                return (
                    [
                        ...commonFields,
                        ...configParameters,
                        ...outcomeFields,
                    ].join(",") + "\n"
                );
            };

            const getDetectorSpecificRejectionHeader = (
                detectorType: "absorption" | "exhaustion" | "deltacvd"
            ): string => {
                const commonFields = [
                    "timestamp",
                    "detectorType",
                    "rejectionReason",
                    "price",
                    "thresholdType",
                    "thresholdValue",
                    "actualValue",
                ];

                const outcomeFields = [
                    "confidence",
                    "subsequentMovement5min",
                    "subsequentMovement15min",
                    "subsequentMovement1hr",
                    "wasValidSignal",
                    "TP_SL",
                    "crossTimeframe",
                    "institutionalVolume",
                    "zoneConfluence",
                    "exhaustionGap",
                    "priceEfficiencyHigh",
                ];

                let configParameters: string[] = [];
                switch (detectorType) {
                    case "exhaustion":
                        configParameters = [
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
                            "passiveVolumeExhaustionRatio",
                            "varianceReductionFactor",
                            "alignmentNormalizationFactor",
                            "aggressiveVolumeExhaustionThreshold",
                            "aggressiveVolumeReductionFactor",
                            "passiveRatioBalanceThreshold",
                            "premiumConfidenceThreshold",
                            "variancePenaltyFactor",
                            "ratioBalanceCenterPoint",
                        ];
                        break;
                    case "absorption":
                        configParameters = [
                            "minAggVolume",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "priceEfficiencyThreshold",
                            "maxAbsorptionRatio",
                            "minPassiveMultiplier",
                            "passiveAbsorptionThreshold",
                            "expectedMovementScalingFactor",
                            "liquidityGradientRange",
                            "institutionalVolumeThreshold",
                            "institutionalVolumeRatioThreshold",
                            "enableInstitutionalVolumeFilter",
                            "minAbsorptionScore",
                            "finalConfidenceRequired",
                            "maxZoneCountForScoring",
                            "minEnhancedConfidenceThreshold",
                            "useStandardizedZones",
                            "enhancementMode",
                            "balanceThreshold",
                            "confluenceMinZones",
                            "confluenceMaxDistance",
                        ];
                        break;
                    case "deltacvd":
                        configParameters = [
                            "minTradesPerSec",
                            "minVolPerSec",
                            "signalThreshold",
                            "eventCooldownMs",
                            "enhancementMode",
                            "cvdImbalanceThreshold",
                            "timeWindowIndex",
                            "institutionalThreshold",
                        ];
                        break;
                }
                return (
                    [
                        ...commonFields,
                        ...configParameters,
                        ...outcomeFields,
                    ].join(",") + "\n"
                );
            };

            // ✅ DETECTOR-SPECIFIC HEADERS: Only config.json parameters + runtime values
            const getDetectorSpecificSuccessfulHeader = (
                detectorType: "absorption" | "exhaustion" | "deltacvd"
            ): string => {
                const commonFields = ["timestamp", "detectorType", "price"];

                const outcomeFields = [
                    "confidence",
                    "subsequentMovement5min",
                    "subsequentMovement15min",
                    "subsequentMovement1hr",
                    "wasValidSignal",
                    "TP_SL",
                    "crossTimeframe",
                    "institutionalVolume",
                    "zoneConfluence",
                    "exhaustionGap",
                    "priceEfficiencyHigh",
                ];

                let configParameters: string[] = [];

                switch (detectorType) {
                    case "exhaustion":
                        configParameters = [
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
                            "passiveVolumeExhaustionRatio",
                            "varianceReductionFactor",
                            "alignmentNormalizationFactor",
                            "aggressiveVolumeExhaustionThreshold",
                            "aggressiveVolumeReductionFactor",
                            "passiveRatioBalanceThreshold",
                            "premiumConfidenceThreshold",
                            "variancePenaltyFactor",
                            "ratioBalanceCenterPoint",
                        ];
                        break;
                    case "absorption":
                        configParameters = [
                            "minAggVolume",
                            "timeWindowIndex",
                            "eventCooldownMs",
                            "priceEfficiencyThreshold",
                            "maxAbsorptionRatio",
                            "minPassiveMultiplier",
                            "passiveAbsorptionThreshold",
                            "expectedMovementScalingFactor",
                            "liquidityGradientRange",
                            "institutionalVolumeThreshold",
                            "institutionalVolumeRatioThreshold",
                            "enableInstitutionalVolumeFilter",
                            "minAbsorptionScore",
                            "finalConfidenceRequired",
                            "maxZoneCountForScoring",
                            "minEnhancedConfidenceThreshold",
                            "useStandardizedZones",
                            "enhancementMode",
                            "balanceThreshold",
                            "confluenceMinZones",
                            "confluenceMaxDistance",
                        ];
                        break;
                    case "deltacvd":
                        configParameters = [
                            "minTradesPerSec",
                            "minVolPerSec",
                            "signalThreshold",
                            "eventCooldownMs",
                            "enhancementMode",
                            "cvdImbalanceThreshold",
                            "timeWindowIndex",
                            "institutionalThreshold",
                        ];
                        break;
                }

                return (
                    [
                        ...commonFields,
                        ...configParameters,
                        ...outcomeFields,
                    ].join(",") + "\n"
                );
            };

            // ✅ DETECTOR-SPECIFIC FILE INITIALIZATION: Create all 9 detector-specific files
            const detectorTypes: ("absorption" | "exhaustion" | "deltacvd")[] =
                ["absorption", "exhaustion", "deltacvd"];

            for (const detectorType of detectorTypes) {
                // Initialize validation signals file with detector-specific header
                const signalsPath = this.getDetectorFilePath(
                    detectorType,
                    "signals"
                );
                try {
                    await fs.access(signalsPath);
                } catch {
                    const detectorSpecificValidationHeader =
                        getDetectorSpecificValidationHeader(detectorType);
                    await fs.writeFile(
                        signalsPath,
                        detectorSpecificValidationHeader
                    );
                }

                // Initialize rejections file with detector-specific header
                const rejectionsPath = this.getDetectorFilePath(
                    detectorType,
                    "rejections"
                );
                try {
                    await fs.access(rejectionsPath);
                } catch {
                    const detectorSpecificRejectionHeader =
                        getDetectorSpecificRejectionHeader(detectorType);
                    await fs.writeFile(
                        rejectionsPath,
                        detectorSpecificRejectionHeader
                    );
                }

                // Initialize successful signals file with detector-specific header
                const successfulPath = this.getDetectorFilePath(
                    detectorType,
                    "successful"
                );
                try {
                    await fs.access(successfulPath);
                } catch {
                    const detectorSpecificHeader =
                        getDetectorSpecificSuccessfulHeader(detectorType);
                    await fs.writeFile(successfulPath, detectorSpecificHeader);
                }

                // Initialize rejected_missed file for absorption and exhaustion only
                if (
                    detectorType === "absorption" ||
                    detectorType === "exhaustion"
                ) {
                    const rejectedMissedPath = this.getDetectorFilePath(
                        detectorType,
                        "rejected_missed"
                    );
                    try {
                        await fs.access(rejectedMissedPath);
                    } catch {
                        // Use same header as rejections but will only contain signals that would have been TP
                        const rejectedMissedHeader =
                            getDetectorSpecificRejectionHeader(detectorType);
                        await fs.writeFile(
                            rejectedMissedPath,
                            rejectedMissedHeader
                        );
                    }
                }
            }

            this.logger.info(
                "SignalValidationLogger: DETECTOR-SPECIFIC CSV files initialized",
                {
                    detectorTypes: detectorTypes,
                    totalFiles: detectorTypes.length * 3, // 3 files per detector
                    maxBufferSize: this.maxBufferSize,
                    flushInterval: this.flushInterval,
                    optimizationInterval: "90 minutes",
                }
            );

            // ✅ START BACKGROUND FLUSHING for non-blocking performance
            this.startBackgroundFlushing();
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
            // Check for daily rotation before flushing
            this.checkAndRotateFiles();
            this.flushBuffers();
        }, this.flushInterval);
    }

    /**
     * ✅ BACKGROUND BUFFER FLUSH: Asynchronous disk writes without blocking signal processing
     */
    private flushBuffers(): void {
        const detectorTypes: ("absorption" | "exhaustion" | "deltacvd")[] = [
            "absorption",
            "exhaustion",
            "deltacvd",
        ];

        for (const detectorType of detectorTypes) {
            // Flush signals buffer
            const signalsBuffer = this.getDetectorBuffer(
                detectorType,
                "signals"
            );
            if (signalsBuffer.length > 0) {
                const signalsToFlush = signalsBuffer.splice(0);
                void this.flushDetectorBuffer(
                    detectorType,
                    "signals",
                    signalsToFlush
                );
            }

            // Flush rejections buffer
            const rejectionsBuffer = this.getDetectorBuffer(
                detectorType,
                "rejections"
            );
            if (rejectionsBuffer.length > 0) {
                const rejectionsToFlush = rejectionsBuffer.splice(0);
                void this.flushDetectorBuffer(
                    detectorType,
                    "rejections",
                    rejectionsToFlush
                );
            }

            // Flush successful signals buffer
            const successfulBuffer = this.getDetectorBuffer(
                detectorType,
                "successful"
            );
            if (successfulBuffer.length > 0) {
                const successfulToFlush = successfulBuffer.splice(0);
                void this.flushDetectorBuffer(
                    detectorType,
                    "successful",
                    successfulToFlush
                );
            }

            // Flush rejected_missed buffer (only for absorption and exhaustion)
            if (
                detectorType === "absorption" ||
                detectorType === "exhaustion"
            ) {
                const rejectedMissedBuffer = this.getDetectorBuffer(
                    detectorType,
                    "rejected_missed"
                );
                if (rejectedMissedBuffer.length > 0) {
                    const rejectedMissedToFlush =
                        rejectedMissedBuffer.splice(0);
                    void this.flushDetectorBuffer(
                        detectorType,
                        "rejected_missed",
                        rejectedMissedToFlush
                    );
                }
            }
        }
    }

    /**
     * ✅ ASYNC DETECTOR BUFFER FLUSH: Background file writes to detector-specific files
     */
    private async flushDetectorBuffer(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        fileType: "signals" | "rejections" | "successful" | "rejected_missed",
        records: string[]
    ): Promise<void> {
        try {
            const content = records.join("");
            const filePath = this.getDetectorFilePath(detectorType, fileType);
            await fs.appendFile(filePath, content);
        } catch (error) {
            this.logger.error(
                `SignalValidationLogger: Failed to flush ${detectorType} ${fileType} buffer`,
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    recordCount: records.length,
                    detectorType,
                    fileType,
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
        // Store price history for stop loss tracking (keep last 2 hours)
        const now = Date.now();
        this.priceHistory.set(now, price);

        // Clean up old price history (older than 2 hours)
        const cutoff = now - 2 * 60 * 60 * 1000;
        for (const [timestamp] of this.priceHistory) {
            if (timestamp < cutoff) {
                this.priceHistory.delete(timestamp);
            } else {
                break; // Map is ordered by insertion, so we can stop once we hit recent entries
            }
        }
    }

    /**
     * ✅ NON-BLOCKING Log a generated signal for validation tracking
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues for data integrity
     */
    public logSignal(
        signal: SignalCandidate,
        event: EnrichedTradeEvent,
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues,
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
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

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
                bestBid: event.bestBid ?? 0,
                bestAsk: event.bestAsk ?? 0,
                spread:
                    event.bestAsk && event.bestBid
                        ? event.bestAsk - event.bestBid
                        : -1,

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
                absorptionRatio: marketContext.absorptionRatio ?? 0,
                exhaustionRatio: marketContext.exhaustionRatio ?? 0,
                depletionRatio: marketContext.depletionRatio ?? 0,

                // Signal Quality Metrics
                signalStrength: signal.confidence,
                confluenceScore: this.calculateConfluenceScore(event),
                institutionalFootprint: marketContext.institutionalVolumeRatio,
                qualityGrade: this.determineQualityGrade(
                    signal.confidence,
                    marketContext.institutionalVolumeRatio
                ),

                // Quality flags from signal (default to false if not present)
                crossTimeframe: signal.qualityFlags?.crossTimeframe ?? false,
                institutionalVolume:
                    signal.qualityFlags?.institutionalVolume ?? false,
                zoneConfluence: signal.qualityFlags?.zoneConfluence ?? false,
                exhaustionGap: signal.qualityFlags?.exhaustionGap ?? false,
                priceEfficiencyHigh:
                    signal.qualityFlags?.priceEfficiency ?? false,

                // Store calculated values for later use
                calculatedValues: calculatedValues,
            };

            // Store for validation tracking
            this.pendingValidations.set(signal.id, record);

            // Set up validation timers
            this.setupValidationTimers(signal.id, event.price);

            // Log immediately (partial record)
            this.writeSignalRecord(record, calculatedValues);

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
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues interface for data integrity
     */
    public logSuccessfulSignal(
        detectorType: "exhaustion" | "absorption" | "deltacvd",
        event: EnrichedTradeEvent,
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues,
        marketContext: {
            marketVolume: number;
            marketSpread: number;
            marketVolatility: number;
        }
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            // Convert calculatedValues to parameterValues format for CSV output
            const parameterValues: SuccessfulSignalRecord["parameterValues"] =
                this.convertCalculatedValuesToParameterValues(calculatedValues);

            const record: SuccessfulSignalRecord = {
                timestamp: event.timestamp,
                detectorType,
                price: event.price,
                parameterValues,
                calculatedValues, // ✅ Store for CSV alignment
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
     * ✅ Log rejected signal with ALL CALCULATED VALUES
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
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues
    ): void {
        try {
            // Check for daily rotation before logging
            this.checkAndRotateFiles();

            // Use the new calculatedValues parameter directly
            const allCalculatedValues = calculatedValues;

            // Extract basic values for backward compatibility
            const aggressiveVolume =
                "calculatedMinAggVolume" in calculatedValues
                    ? Number(calculatedValues.calculatedMinAggVolume) || 0
                    : 0;
            const passiveVolume = 0; // Not included in new interface
            const priceEfficiency =
                "calculatedPriceEfficiency" in calculatedValues
                    ? Number(calculatedValues.calculatedPriceEfficiency) || 0
                    : 0;
            const confidence =
                "calculatedMinEnhancedConfidence" in calculatedValues
                    ? Number(
                          calculatedValues.calculatedMinEnhancedConfidence
                      ) || 0
                    : 0;

            const record: SignalRejectionRecord = {
                timestamp: event.timestamp,
                detectorType,
                rejectionReason,
                price: event.price,

                // Threshold details
                thresholdType: thresholdDetails.type,
                thresholdValue: thresholdDetails.threshold,
                actualValue: thresholdDetails.actual,

                // Basic market context (still needed for backward compatibility)
                aggressiveVolume,
                passiveVolume,
                priceEfficiency,
                confidence,

                // ✅ ALL CALCULATED VALUES: Every calculation the detector made
                calculatedValues: allCalculatedValues,
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
                this.validateSuccessfulSignal(signalPrice, record, "5min");
            },
            5 * 60 * 1000
        );

        // 15-minute validation
        setTimeout(
            () => {
                this.validateSuccessfulSignal(signalPrice, record, "15min");
            },
            15 * 60 * 1000
        );

        // 90-minute validation and final write (for optimization analysis)
        setTimeout(
            () => {
                this.validateSuccessfulSignal(signalPrice, record, "90min");

                // CRITICAL FIX: Only write to successful file if signal reached TP without hitting SL
                // A signal is only truly successful if it reached the target profit
                if (record.tpSlStatus === "TP") {
                    this.writeSuccessfulSignalRecord(
                        record,
                        record.calculatedValues
                    );
                } else {
                    // Signal hit SL or didn't reach TP - log but don't write to successful file
                    this.logger.info(
                        "Signal did not meet success criteria, not writing to successful file",
                        {
                            signalId: recordId,
                            tpSlStatus: record.tpSlStatus,
                            signalQuality: record.signalQuality,
                            wasTopOrBottomSignal: record.wasTopOrBottomSignal,
                        }
                    );
                }

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

        // 1-hour validation
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

        // 90-minute final validation for rejected_missed tracking
        setTimeout(
            () => {
                this.validateRejection(
                    rejectionId,
                    rejectionPrice,
                    record,
                    "90min"
                );
                // Clean up after final validation
                this.pendingRejections.delete(rejectionId);
            },
            90 * 60 * 1000
        );
    }

    /**
     * Check if signal hit stop loss or target within a timeframe
     */
    private checkSignalOutcome(
        signalTimestamp: number,
        signalPrice: number,
        signalSide: "buy" | "sell",
        endTime: number
    ): { hitStopLoss: boolean; hitTarget: boolean; finalPrice: number | null } {
        const stopLossPrice =
            signalSide === "buy"
                ? signalPrice * (1 - this.STOP_LOSS_THRESHOLD) // Buy signal: stop loss below entry
                : signalPrice * (1 + this.STOP_LOSS_THRESHOLD); // Sell signal: stop loss above entry

        const targetPrice =
            signalSide === "buy"
                ? signalPrice * (1 + this.TARGET_THRESHOLD) // Buy signal: target above entry
                : signalPrice * (1 - this.TARGET_THRESHOLD); // Sell signal: target below entry

        let hitStopLoss = false;
        let hitTarget = false;
        let hitStopLossFirst = false;
        let finalPrice: number | null = null;

        // Check price history from signal time to endTime
        // Track BOTH: if TP was reached AND if SL was hit before TP
        for (const [timestamp, price] of this.priceHistory) {
            if (timestamp <= signalTimestamp) continue;
            if (timestamp > endTime) break;

            finalPrice = price;

            // Check for stop loss hit (only matters if TP not yet reached)
            if (!hitTarget) {
                if (signalSide === "buy" && price <= stopLossPrice) {
                    hitStopLoss = true;
                    hitStopLossFirst = true; // SL hit before TP
                }
                if (signalSide === "sell" && price >= stopLossPrice) {
                    hitStopLoss = true;
                    hitStopLossFirst = true; // SL hit before TP
                }
            }

            // Check for target hit
            if (signalSide === "buy" && price >= targetPrice) {
                hitTarget = true;
                // Don't break - continue to check full timeframe
            }
            if (signalSide === "sell" && price <= targetPrice) {
                hitTarget = true;
                // Don't break - continue to check full timeframe
            }
        }

        // Return whether target was hit and if SL was hit BEFORE target
        hitStopLoss = hitStopLossFirst;

        // If we don't have enough price history, use current price
        if (finalPrice === null) {
            finalPrice = this.currentPrice;
        }

        return { hitStopLoss, hitTarget, finalPrice };
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

        // Calculate timeframe end
        const timeframeMs =
            timeframe === "5min"
                ? 5 * 60 * 1000
                : timeframe === "15min"
                  ? 15 * 60 * 1000
                  : 60 * 60 * 1000;
        const endTime = record.timestamp + timeframeMs;

        // Check if stop loss or target was hit
        const outcome = this.checkSignalOutcome(
            record.timestamp,
            originalPrice,
            record.signalSide,
            endTime
        );

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

        // Signal is accurate only if target hit WITHOUT stop loss
        const isAccurate = outcome.hitTarget && !outcome.hitStopLoss;

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

                // CRITICAL FIX: Proper success list categorization
                // Only signals that reach 0.7% TP within 90 minutes go to success list

                if (outcome.hitTarget) {
                    // Signal reached 0.7% TP within timeframe - goes to success list
                    if (outcome.hitStopLoss) {
                        // Hit 0.35% SL BEFORE reaching TP (but still reached TP later)
                        record.tpSlStatus = "SL";
                    } else {
                        // Reached TP directly without hitting SL first
                        record.tpSlStatus = "TP";
                    }
                    // Write to success/validation file - this signal was successful (reached TP)
                    this.writeSignalRecord(record, record.calculatedValues);
                } else {
                    // Signal did NOT reach 0.7% TP within timeframe
                    // This is a FALSE signal - don't track it in success/validation
                    // Simply don't write it anywhere - it failed to reach TP
                    this.logger.debug(
                        "Signal failed to reach TP within timeframe, not tracking",
                        {
                            signalId: record.signalId,
                            price: record.price,
                            maxMovement: record.maxMovement1hr,
                        }
                    );
                }
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
            hitStopLoss: outcome.hitStopLoss,
            hitTarget: outcome.hitTarget,
        });
    }

    /**
     * Validate successful signal to classify as top/bottom or noise
     */
    private validateSuccessfulSignal(
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

                // Determine signal side based on detector type and movement expectation
                // This is a simplified assumption - you may need to store actual signal side
                const expectedMovement =
                    record.detectorType === "absorption" ? "up" : "down";
                const signalSide = expectedMovement === "up" ? "buy" : "sell";

                // Check if stop loss or target was hit within 90 minutes
                const endTime = record.timestamp + 90 * 60 * 1000;
                const outcome = this.checkSignalOutcome(
                    record.timestamp,
                    originalPrice,
                    signalSide,
                    endTime
                );

                // Signal is only successful if it reached target WITHOUT hitting stop loss
                record.wasTopOrBottomSignal =
                    outcome.hitTarget && !outcome.hitStopLoss;

                // Set TP/SL status
                if (outcome.hitStopLoss) {
                    record.tpSlStatus = "SL";
                    record.signalQuality = "noise"; // Stop loss hit = failed signal
                } else if (outcome.hitTarget) {
                    record.tpSlStatus = "TP";
                    // Determine if top or bottom signal based on movement
                    if (movement >= this.TARGET_THRESHOLD) {
                        record.signalQuality = "bottom"; // Price went up = bottom signal
                    } else if (movement <= -this.TARGET_THRESHOLD) {
                        record.signalQuality = "top"; // Price went down = top signal
                    }
                } else {
                    record.tpSlStatus = "NEITHER";
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
        timeframe: "5min" | "15min" | "1hr" | "90min"
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
            case "1hr":
                record.subsequentMovement1hr = movement;
                // Write regular rejection record at 1hr
                this.writeRejectionRecord(record);
                break;

            case "90min":
                // Final validation to check if this was a missed opportunity
                // Determine what would have happened if signal was not rejected
                // Assume signal direction based on detector type
                const expectedMovement =
                    record.detectorType === "absorption" ? "up" : "down";
                const signalSide = expectedMovement === "up" ? "buy" : "sell";

                // Check if it would have hit target or stop loss within 90 minutes
                const endTime = record.timestamp + 90 * 60 * 1000;
                const outcome = this.checkSignalOutcome(
                    record.timestamp,
                    originalPrice,
                    signalSide,
                    endTime
                );

                // Signal was a missed opportunity if it would have hit target without stop loss
                record.wasValidSignal =
                    outcome.hitTarget && !outcome.hitStopLoss;

                // Set TP/SL status for what would have happened
                if (outcome.hitStopLoss) {
                    record.tpSlStatus = "SL";
                } else if (outcome.hitTarget) {
                    record.tpSlStatus = "TP";
                } else {
                    record.tpSlStatus = "NEITHER";
                }

                // CRITICAL: Write to rejected_missed file if this would have been successful
                // Only for absorption and exhaustion, and only if not rejected for minAggVolume
                if (
                    record.tpSlStatus === "TP" &&
                    (record.detectorType === "absorption" ||
                        record.detectorType === "exhaustion") &&
                    record.rejectionReason !== "Insufficient aggregate volume"
                ) {
                    this.writeRejectedMissedRecord(record);
                    this.logger.info(
                        "Rejected signal would have been successful - logged to rejected_missed",
                        {
                            rejectionId,
                            detectorType: record.detectorType,
                            reason: record.rejectionReason,
                            price: originalPrice,
                            wouldHaveBeenTP: true,
                        }
                    );
                }
                break;
        }
    }

    /**
     * Write signal record to CSV
     */
    private writeSignalRecord(
        record: SignalValidationRecord,
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues
    ): void {
        try {
            const commonFields = [
                record.timestamp,
                record.signalId,
                record.detectorType,
                record.signalSide,
                record.price,
            ];

            let calculatedFields: (string | number | boolean)[] = [];
            switch (record.detectorType) {
                case "deltacvd":
                    const deltacvdValues =
                        calculatedValues as DeltaCVDCalculatedValues;
                    calculatedFields = [
                        deltacvdValues.calculatedMinTradesPerSec,
                        deltacvdValues.calculatedMinVolPerSec,
                        deltacvdValues.calculatedSignalThreshold,
                        deltacvdValues.calculatedEventCooldownMs,
                        deltacvdValues.calculatedEnhancementMode,
                        deltacvdValues.calculatedCvdImbalanceThreshold,
                        deltacvdValues.calculatedTimeWindowIndex,
                        deltacvdValues.calculatedInstitutionalThreshold,
                    ];
                    break;
                case "exhaustion":
                    const exhaustionValues =
                        calculatedValues as ExhaustionCalculatedValues;
                    calculatedFields = [
                        exhaustionValues.calculatedMinAggVolume,
                        exhaustionValues.calculatedExhaustionThreshold,
                        exhaustionValues.calculatedTimeWindowIndex,
                        exhaustionValues.calculatedEventCooldownMs,
                        exhaustionValues.calculatedUseStandardizedZones,
                        exhaustionValues.calculatedEnhancementMode,
                        exhaustionValues.calculatedMinEnhancedConfidenceThreshold,
                        exhaustionValues.calculatedEnableDepletionAnalysis,
                        exhaustionValues.calculatedDepletionVolumeThreshold,
                        exhaustionValues.calculatedDepletionRatioThreshold,
                        exhaustionValues.calculatedPassiveVolumeExhaustionRatio,
                        exhaustionValues.calculatedVarianceReductionFactor,
                        exhaustionValues.calculatedAlignmentNormalizationFactor,
                        exhaustionValues.calculatedAggressiveVolumeExhaustionThreshold,
                        exhaustionValues.calculatedAggressiveVolumeReductionFactor,
                        exhaustionValues.calculatedPassiveRatioBalanceThreshold,
                        exhaustionValues.calculatedPremiumConfidenceThreshold,
                        exhaustionValues.calculatedVariancePenaltyFactor,
                        exhaustionValues.calculatedRatioBalanceCenterPoint,
                    ];
                    break;
                case "absorption":
                    const absorptionValues =
                        calculatedValues as AbsorptionCalculatedValues;
                    calculatedFields = [
                        absorptionValues.calculatedMinAggVolume,
                        absorptionValues.calculatedTimeWindowIndex,
                        absorptionValues.calculatedEventCooldownMs,
                        absorptionValues.calculatedPriceEfficiencyThreshold,
                        absorptionValues.calculatedMaxAbsorptionRatio,
                        absorptionValues.calculatedMinPassiveMultiplier,
                        absorptionValues.calculatedPassiveAbsorptionThreshold,
                        absorptionValues.calculatedExpectedMovementScalingFactor,
                        absorptionValues.calculatedLiquidityGradientRange,
                        absorptionValues.calculatedInstitutionalVolumeThreshold,
                        absorptionValues.calculatedInstitutionalVolumeRatioThreshold,
                        absorptionValues.calculatedEnableInstitutionalVolumeFilter,
                        absorptionValues.calculatedMinAbsorptionScore,
                        absorptionValues.calculatedFinalConfidenceRequired,
                        absorptionValues.calculatedMaxZoneCountForScoring,
                        absorptionValues.calculatedMinEnhancedConfidenceThreshold,
                        absorptionValues.calculatedUseStandardizedZones,
                        absorptionValues.calculatedEnhancementMode,
                        absorptionValues.calculatedBalanceThreshold,
                        absorptionValues.calculatedConfluenceMinZones,
                        absorptionValues.calculatedConfluenceMaxDistance,
                    ];
                    break;
            }

            const outcomeFields = [
                record.confidence,
                record.priceAt5min || "",
                record.priceAt15min || "",
                record.priceAt1hr || "",
                record.signalAccuracy5min !== undefined
                    ? record.signalAccuracy5min
                    : "",
                record.signalAccuracy15min !== undefined
                    ? record.signalAccuracy15min
                    : "",
                record.signalAccuracy1hr !== undefined
                    ? record.signalAccuracy1hr
                    : "",
                record.tpSlStatus || "",
                record.crossTimeframe || false,
                record.institutionalVolume || false,
                record.zoneConfluence || false,
                record.exhaustionGap || false,
                record.priceEfficiencyHigh || false,
            ];

            const csvLine =
                [...commonFields, ...calculatedFields, ...outcomeFields].join(
                    ","
                ) + "\n";

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "signals"
            );
            detectorBuffer.push(csvLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
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
     * ✅ DETECTOR-SPECIFIC CSV formatter for successful signals - explicit field extraction for header alignment
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues parameter with proper typing
     */
    private formatDetectorSpecificSuccessfulSignalCSV(
        record: SuccessfulSignalRecord,
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues
    ): string {
        const commonFields = [
            record.timestamp,
            record.detectorType,
            record.price,
        ];

        const outcomeFields = [
            record.parameterValues.confidence || "",
            record.subsequentMovement5min || "",
            record.subsequentMovement15min || "",
            record.subsequentMovement90min || "", // Map 90min to 1hr header for compatibility
            record.wasTopOrBottomSignal !== undefined
                ? record.wasTopOrBottomSignal
                : "", // Map to wasValidSignal header for compatibility
            record.tpSlStatus || "",
            record.crossTimeframe || false,
            record.institutionalVolume || false,
            record.zoneConfluence || false,
            record.exhaustionGap || false,
            record.priceEfficiencyHigh || false,
        ];

        // ✅ EXPLICIT FIELD EXTRACTION: Match exact header order from getDetectorSpecificSuccessfulHeader
        let configParameters: (string | number | boolean)[] = [];

        switch (record.detectorType) {
            case "exhaustion":
                const exhaustionValues =
                    calculatedValues as ExhaustionCalculatedValues;
                configParameters = [
                    exhaustionValues.calculatedMinAggVolume,
                    exhaustionValues.calculatedExhaustionThreshold,
                    exhaustionValues.calculatedTimeWindowIndex,
                    exhaustionValues.calculatedEventCooldownMs,
                    exhaustionValues.calculatedUseStandardizedZones,
                    exhaustionValues.calculatedEnhancementMode,
                    exhaustionValues.calculatedMinEnhancedConfidenceThreshold,
                    exhaustionValues.calculatedEnableDepletionAnalysis,
                    exhaustionValues.calculatedDepletionVolumeThreshold,
                    exhaustionValues.calculatedDepletionRatioThreshold,
                    exhaustionValues.calculatedPassiveVolumeExhaustionRatio,
                    exhaustionValues.calculatedVarianceReductionFactor,
                    exhaustionValues.calculatedAlignmentNormalizationFactor,
                    exhaustionValues.calculatedAggressiveVolumeExhaustionThreshold,
                    exhaustionValues.calculatedAggressiveVolumeReductionFactor,
                    exhaustionValues.calculatedPassiveRatioBalanceThreshold,
                    exhaustionValues.calculatedPremiumConfidenceThreshold,
                    exhaustionValues.calculatedVariancePenaltyFactor,
                    exhaustionValues.calculatedRatioBalanceCenterPoint,
                ];
                break;
            case "absorption":
                const absorptionValues =
                    calculatedValues as AbsorptionCalculatedValues;
                configParameters = [
                    absorptionValues.calculatedMinAggVolume,
                    absorptionValues.calculatedTimeWindowIndex,
                    absorptionValues.calculatedEventCooldownMs,
                    absorptionValues.calculatedPriceEfficiencyThreshold,
                    absorptionValues.calculatedMaxAbsorptionRatio,
                    absorptionValues.calculatedMinPassiveMultiplier,
                    absorptionValues.calculatedPassiveAbsorptionThreshold,
                    absorptionValues.calculatedExpectedMovementScalingFactor,
                    absorptionValues.calculatedLiquidityGradientRange,
                    absorptionValues.calculatedInstitutionalVolumeThreshold,
                    absorptionValues.calculatedInstitutionalVolumeRatioThreshold,
                    absorptionValues.calculatedEnableInstitutionalVolumeFilter,
                    absorptionValues.calculatedMinAbsorptionScore,
                    absorptionValues.calculatedFinalConfidenceRequired,
                    absorptionValues.calculatedMaxZoneCountForScoring,
                    absorptionValues.calculatedMinEnhancedConfidenceThreshold,
                    absorptionValues.calculatedUseStandardizedZones,
                    absorptionValues.calculatedEnhancementMode,
                    absorptionValues.calculatedBalanceThreshold,
                    absorptionValues.calculatedConfluenceMinZones,
                    absorptionValues.calculatedConfluenceMaxDistance,
                ];
                break;
            case "deltacvd":
                const deltacvdValues =
                    calculatedValues as DeltaCVDCalculatedValues;
                configParameters = [
                    deltacvdValues.calculatedMinTradesPerSec,
                    deltacvdValues.calculatedMinVolPerSec,
                    deltacvdValues.calculatedSignalThreshold,
                    deltacvdValues.calculatedEventCooldownMs,
                    deltacvdValues.calculatedEnhancementMode,
                    deltacvdValues.calculatedCvdImbalanceThreshold,
                    deltacvdValues.calculatedTimeWindowIndex,
                    deltacvdValues.calculatedInstitutionalThreshold,
                ];
                break;
        }

        const allFields = [
            ...commonFields,
            ...configParameters.map(String),
            ...outcomeFields.map(String),
        ];
        return allFields.join(",") + "\n";
    }

    /**
     * Write successful signal record to CSV
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues for proper header alignment
     */
    private writeSuccessfulSignalRecord(
        record: SuccessfulSignalRecord,
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues
    ): void {
        try {
            // ✅ DETECTOR-SPECIFIC CSV LINE: Pass calculatedValues for proper alignment
            const csvLine = this.formatDetectorSpecificSuccessfulSignalCSV(
                record,
                calculatedValues
            );

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "successful"
            );
            detectorBuffer.push(csvLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
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
     * ✅ DETECTOR-SPECIFIC CSV formatter for rejections - explicit field extraction for header alignment
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues parameter with proper typing
     */
    private formatDetectorSpecificRejectionCSV(
        record: SignalRejectionRecord,
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues
    ): string {
        const commonFields = [
            record.timestamp,
            record.detectorType,
            record.rejectionReason,
            record.price,
            record.thresholdType,
            record.thresholdValue,
            record.actualValue,
        ];

        const outcomeFields = [
            record.confidence,
            record.subsequentMovement5min || "",
            record.subsequentMovement15min || "",
            record.subsequentMovement1hr || "",
            record.wasValidSignal !== undefined ? record.wasValidSignal : "",
            record.tpSlStatus || "",
            record.crossTimeframe || false,
            record.institutionalVolume || false,
            record.zoneConfluence || false,
            record.exhaustionGap || false,
            record.priceEfficiencyHigh || false,
        ];

        // ✅ EXPLICIT FIELD EXTRACTION: Match exact header order from getDetectorSpecificRejectionHeader
        let configParameters: (string | number | boolean)[] = [];

        switch (record.detectorType) {
            case "exhaustion":
                const exhaustionValues =
                    calculatedValues as ExhaustionCalculatedValues;
                configParameters = [
                    exhaustionValues.calculatedMinAggVolume,
                    exhaustionValues.calculatedExhaustionThreshold,
                    exhaustionValues.calculatedTimeWindowIndex,
                    exhaustionValues.calculatedEventCooldownMs,
                    exhaustionValues.calculatedUseStandardizedZones,
                    exhaustionValues.calculatedEnhancementMode,
                    exhaustionValues.calculatedMinEnhancedConfidenceThreshold,
                    exhaustionValues.calculatedEnableDepletionAnalysis,
                    exhaustionValues.calculatedDepletionVolumeThreshold,
                    exhaustionValues.calculatedDepletionRatioThreshold,
                    exhaustionValues.calculatedPassiveVolumeExhaustionRatio,
                    exhaustionValues.calculatedVarianceReductionFactor,
                    exhaustionValues.calculatedAlignmentNormalizationFactor,
                    exhaustionValues.calculatedAggressiveVolumeExhaustionThreshold,
                    exhaustionValues.calculatedAggressiveVolumeReductionFactor,
                    exhaustionValues.calculatedPassiveRatioBalanceThreshold,
                    exhaustionValues.calculatedPremiumConfidenceThreshold,
                    exhaustionValues.calculatedVariancePenaltyFactor,
                    exhaustionValues.calculatedRatioBalanceCenterPoint,
                ];
                break;
            case "absorption":
                const absorptionValues =
                    calculatedValues as AbsorptionCalculatedValues;
                configParameters = [
                    absorptionValues.calculatedMinAggVolume,
                    absorptionValues.calculatedTimeWindowIndex,
                    absorptionValues.calculatedEventCooldownMs,
                    absorptionValues.calculatedPriceEfficiencyThreshold,
                    absorptionValues.calculatedMaxAbsorptionRatio,
                    absorptionValues.calculatedMinPassiveMultiplier,
                    absorptionValues.calculatedPassiveAbsorptionThreshold,
                    absorptionValues.calculatedExpectedMovementScalingFactor,
                    absorptionValues.calculatedLiquidityGradientRange,
                    absorptionValues.calculatedInstitutionalVolumeThreshold,
                    absorptionValues.calculatedInstitutionalVolumeRatioThreshold,
                    absorptionValues.calculatedEnableInstitutionalVolumeFilter,
                    absorptionValues.calculatedMinAbsorptionScore,
                    absorptionValues.calculatedFinalConfidenceRequired,
                    absorptionValues.calculatedMaxZoneCountForScoring,
                    absorptionValues.calculatedMinEnhancedConfidenceThreshold,
                    absorptionValues.calculatedUseStandardizedZones,
                    absorptionValues.calculatedEnhancementMode,
                    absorptionValues.calculatedBalanceThreshold,
                    absorptionValues.calculatedConfluenceMinZones,
                    absorptionValues.calculatedConfluenceMaxDistance,
                ];
                break;
            case "deltacvd":
                const deltacvdValues =
                    calculatedValues as DeltaCVDCalculatedValues;
                configParameters = [
                    deltacvdValues.calculatedMinTradesPerSec,
                    deltacvdValues.calculatedMinVolPerSec,
                    deltacvdValues.calculatedSignalThreshold,
                    deltacvdValues.calculatedEventCooldownMs,
                    deltacvdValues.calculatedEnhancementMode,
                    deltacvdValues.calculatedCvdImbalanceThreshold,
                    deltacvdValues.calculatedTimeWindowIndex,
                    deltacvdValues.calculatedInstitutionalThreshold,
                ];
                break;
        }

        const allFields = [
            ...commonFields,
            ...configParameters.map(String),
            ...outcomeFields.map(String),
        ];
        return allFields.join(",") + "\n";
    }

    /**
     * Write rejected_missed record to CSV (rejections that would have been TP)
     * INSTITUTIONAL COMPLIANCE: Only for absorption/exhaustion, excluding minAggVolume rejections
     */
    private writeRejectedMissedRecord(record: SignalRejectionRecord): void {
        try {
            // Only for absorption and exhaustion detectors
            if (
                record.detectorType !== "absorption" &&
                record.detectorType !== "exhaustion"
            ) {
                return;
            }

            // Use same CSV format as rejection records
            const csvLine = this.formatDetectorSpecificRejectionCSV(
                record,
                record.calculatedValues
            );

            // Add to detector-specific rejected_missed buffer
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "rejected_missed"
            );
            detectorBuffer.push(csvLine);

            // Auto-flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
                this.flushBuffers();
            }
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to write rejected_missed record",
                {
                    timestamp: record.timestamp,
                    detectorType: record.detectorType,
                    reason: record.rejectionReason,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Write rejection record to CSV
     * INSTITUTIONAL COMPLIANCE: Uses calculatedValues for proper header alignment
     */
    private writeRejectionRecord(record: SignalRejectionRecord): void {
        try {
            // ✅ DETECTOR-SPECIFIC CSV LINE: Pass calculatedValues for proper alignment
            const csvLine = this.formatDetectorSpecificRejectionCSV(
                record,
                record.calculatedValues
            );

            // ✅ NON-BLOCKING: Add to detector-specific buffer instead of direct file write
            const detectorBuffer = this.getDetectorBuffer(
                record.detectorType,
                "rejections"
            );
            detectorBuffer.push(csvLine);

            // ✅ AUTO-FLUSH: Trigger flush if buffer is full
            if (detectorBuffer.length >= this.maxBufferSize) {
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
     * Convert calculatedValues to parameterValues format for CSV output
     * INSTITUTIONAL COMPLIANCE: Maps calculated values to expected CSV structure
     */
    private convertCalculatedValuesToParameterValues(
        calculatedValues:
            | AbsorptionCalculatedValues
            | ExhaustionCalculatedValues
            | DeltaCVDCalculatedValues
    ): SuccessfulSignalRecord["parameterValues"] {
        const result: SuccessfulSignalRecord["parameterValues"] = {};

        try {
            // Extract common fields that exist across all detector types
            if ("calculatedMinAggVolume" in calculatedValues) {
                result.minAggVolume = calculatedValues.calculatedMinAggVolume;
            }
            if ("calculatedTimeWindowIndex" in calculatedValues) {
                result.timeWindowIndex =
                    calculatedValues.calculatedTimeWindowIndex;
            }
            if ("calculatedEventCooldownMs" in calculatedValues) {
                result.eventCooldownMs =
                    calculatedValues.calculatedEventCooldownMs;
            }
            if ("calculatedEnhancementMode" in calculatedValues) {
                result.enhancementMode =
                    calculatedValues.calculatedEnhancementMode;
            }
            if (
                "calculatedMinEnhancedConfidenceThreshold" in calculatedValues
            ) {
                result.minEnhancedConfidenceThreshold =
                    calculatedValues.calculatedMinEnhancedConfidenceThreshold;
                result.confidence =
                    calculatedValues.calculatedMinEnhancedConfidenceThreshold;
            }

            // Handle Exhaustion-specific fields
            if ("calculatedExhaustionThreshold" in calculatedValues) {
                const exhaustionValues = calculatedValues;
                result.exhaustionThreshold =
                    exhaustionValues.calculatedExhaustionThreshold;
                result.useStandardizedZones =
                    exhaustionValues.calculatedUseStandardizedZones;
                result.enableDepletionAnalysis =
                    exhaustionValues.calculatedEnableDepletionAnalysis;
                result.depletionVolumeThreshold =
                    exhaustionValues.calculatedDepletionVolumeThreshold;
                result.depletionRatioThreshold =
                    exhaustionValues.calculatedDepletionRatioThreshold;
                result.passiveVolumeExhaustionRatio =
                    exhaustionValues.calculatedPassiveVolumeExhaustionRatio;
                result.varianceReductionFactor =
                    exhaustionValues.calculatedVarianceReductionFactor;
                result.alignmentNormalizationFactor =
                    exhaustionValues.calculatedAlignmentNormalizationFactor;
                result.aggressiveVolumeExhaustionThreshold =
                    exhaustionValues.calculatedAggressiveVolumeExhaustionThreshold;
                result.aggressiveVolumeReductionFactor =
                    exhaustionValues.calculatedAggressiveVolumeReductionFactor;
                result.passiveRatioBalanceThreshold =
                    exhaustionValues.calculatedPassiveRatioBalanceThreshold;
                result.premiumConfidenceThreshold =
                    exhaustionValues.calculatedPremiumConfidenceThreshold;
                result.variancePenaltyFactor =
                    exhaustionValues.calculatedVariancePenaltyFactor;
                result.ratioBalanceCenterPoint =
                    exhaustionValues.calculatedRatioBalanceCenterPoint;
            }

            // Handle Absorption-specific fields
            if ("calculatedPriceEfficiencyThreshold" in calculatedValues) {
                const absorptionValues = calculatedValues;
                result.priceEfficiencyThreshold =
                    absorptionValues.calculatedPriceEfficiencyThreshold;
                result.maxAbsorptionRatio =
                    absorptionValues.calculatedMaxAbsorptionRatio;
                result.minPassiveMultiplier =
                    absorptionValues.calculatedMinPassiveMultiplier;
                result.passiveAbsorptionThreshold =
                    absorptionValues.calculatedPassiveAbsorptionThreshold;
                result.expectedMovementScalingFactor =
                    absorptionValues.calculatedExpectedMovementScalingFactor;
                result.liquidityGradientRange =
                    absorptionValues.calculatedLiquidityGradientRange;
                result.institutionalVolumeThreshold =
                    absorptionValues.calculatedInstitutionalVolumeThreshold;
                result.institutionalVolumeRatioThreshold =
                    absorptionValues.calculatedInstitutionalVolumeRatioThreshold;
                result.enableInstitutionalVolumeFilter =
                    absorptionValues.calculatedEnableInstitutionalVolumeFilter;
                result.minAbsorptionScore =
                    absorptionValues.calculatedMinAbsorptionScore;
                result.finalConfidenceRequired =
                    absorptionValues.calculatedFinalConfidenceRequired;
                result.maxZoneCountForScoring =
                    absorptionValues.calculatedMaxZoneCountForScoring;
                result.useStandardizedZones =
                    absorptionValues.calculatedUseStandardizedZones;
                result.balanceThreshold =
                    absorptionValues.calculatedBalanceThreshold;
                result.confluenceMinZones =
                    absorptionValues.calculatedConfluenceMinZones;
                result.confluenceMaxDistance =
                    absorptionValues.calculatedConfluenceMaxDistance;
                result.absorptionThreshold =
                    absorptionValues.calculatedMaxAbsorptionRatio;

                // Set priceEfficiency from threshold for compatibility
                result.priceEfficiency =
                    absorptionValues.calculatedPriceEfficiencyThreshold;
            }

            // Handle DeltaCVD-specific fields
            if ("calculatedMinTradesPerSec" in calculatedValues) {
                const deltacvdValues = calculatedValues;
                result.minTradesPerSec =
                    deltacvdValues.calculatedMinTradesPerSec;
                result.minVolPerSec = deltacvdValues.calculatedMinVolPerSec;
                result.signalThreshold =
                    deltacvdValues.calculatedSignalThreshold;
                result.cvdImbalanceThreshold =
                    deltacvdValues.calculatedCvdImbalanceThreshold;
                result.institutionalThreshold =
                    deltacvdValues.calculatedInstitutionalThreshold;
            }

            return result;
        } catch (error) {
            this.logger.error(
                "SignalValidationLogger: Failed to convert calculatedValues to parameterValues",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return {};
        }
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

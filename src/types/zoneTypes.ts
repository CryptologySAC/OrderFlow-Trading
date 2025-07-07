// src/types/zoneTypes.ts

/**
 * Zone update types for proper type safety
 */
export enum ZoneUpdateType {
    ZONE_CREATED = "zone_created",
    ZONE_UPDATED = "zone_updated",
    ZONE_STRENGTHENED = "zone_strengthened",
    ZONE_WEAKENED = "zone_weakened",
    ZONE_COMPLETED = "zone_completed",
    ZONE_INVALIDATED = "zone_invalidated",
}

/**
 * Zone signal types for trading signals
 */
export enum ZoneSignalType {
    STRENGTHENED = "strengthened",
    COMPLETION = "completion",
    INVALIDATION = "invalidation",
    ENTRY = "entry",
    EXIT = "exit",
}

// NEW: Standardized zone configuration for all detectors
export interface StandardZoneConfig {
    baseTicks: number; // Base zone size in ticks (e.g., 5)
    zoneMultipliers: number[]; // Zone size multipliers [1, 2, 4] for 5, 10, 20 tick zones
    timeWindows: number[]; // Time windows for zone analysis [30s, 60s, 300s]
    adaptiveMode: boolean; // Enable dynamic zone sizing based on market conditions
    volumeThresholds: {
        aggressive: number; // Volume threshold for aggressive classification
        passive: number; // Volume threshold for passive classification
        institutional: number; // Volume threshold for institutional classification
    };
    priceThresholds: {
        tickValue: number; // Value of one tick in price units
        minZoneWidth: number; // Minimum zone width in price units
        maxZoneWidth: number; // Maximum zone width in price units
    };
    performanceConfig: {
        maxZoneHistory: number; // Maximum number of zones to keep in history
        cleanupInterval: number; // Cleanup interval for old zones (ms)
        maxMemoryMB: number; // Maximum memory usage for zone cache
    };
}

// Zone data cache for efficient detector access
export interface ZoneHistory {
    zoneId: string;
    snapshots: ZoneSnapshot[];
    createdAt: number;
    lastAccess: number;
    memoryUsage: number; // Estimated memory usage in bytes
}

// Import ZoneSnapshot from marketEvents to avoid circular dependency
import type { ZoneSnapshot } from "./marketEvents.js";

// Zone event interfaces for enhanced detectors
// Import the actual condition types from signalTypes
import type {
    AccumulationConditions,
    DistributionConditions,
    AccumulationMarketRegime,
    DistributionMarketRegime,
} from "./signalTypes.js";

export interface ZoneVisualizationData {
    id: string;
    type: "accumulation" | "distribution";
    priceRange: {
        center: number;
        min: number;
        max: number;
    };
    strength: number;
    confidence: number;
    volume: number;
    timespan: number;
    lastUpdate: number;
    metadata: {
        buyRatio?: number;
        sellRatio?: number;
        conditions: AccumulationConditions | DistributionConditions;
        marketRegime: AccumulationMarketRegime | DistributionMarketRegime;
    };
}

export interface ZoneUpdateEvent {
    updateType:
        | "zone_created"
        | "zone_updated"
        | "zone_strengthened"
        | "zone_weakened"
        | "zone_completed"
        | "zone_invalidated";
    zone: ZoneVisualizationData;
    significance: number;
    detectorId: string;
    timestamp: number;
}

export interface ZoneSignalEvent {
    signalType: "completion" | "invalidation" | "consumption";
    zone: ZoneVisualizationData;
    actionType: string;
    confidence: number;
    urgency: "high" | "medium" | "low";
    expectedDirection: "up" | "down";
    detectorId: string;
    timestamp: number;
}

export interface TradingZone {
    // Zone identification
    id: string;
    type: "accumulation" | "distribution";
    symbol: string;

    // Zone boundaries and timing
    startTime: number;
    endTime?: number; // When zone completed/invalidated
    priceRange: {
        min: number; // Bottom of zone
        max: number; // Top of zone
        center: number; // Primary accumulation level
        width: number; // Zone width in price points
    };

    // Zone characteristics
    totalVolume: number; // Total volume in zone
    averageOrderSize: number; // Typical order size
    tradeCount: number; // Number of trades in zone
    timeInZone: number; // Duration of zone activity
    intensity: number; // Volume/time ratio

    // Zone quality metrics
    strength: number; // 0-1, how strong is accumulation
    completion: number; // 0-1, how complete is the process
    confidence: number; // 0-1, confidence in zone validity
    significance: "minor" | "moderate" | "major" | "institutional";

    // Zone state
    isActive: boolean; // Still accumulating/distributing
    lastUpdate: number; // Last time zone was updated

    // Zone evolution tracking
    strengthHistory: {
        timestamp: number;
        strength: number;
        volume: number;
    }[];

    // Supporting evidence
    supportingFactors: {
        volumeConcentration: number; // Volume concentrated in zone
        orderSizeProfile: "retail" | "institutional" | "mixed";
        timeConsistency: number; // Consistent activity over time
        priceStability: number; // Price stability within zone
        flowConsistency: number; // Consistent order flow direction
    };
}

export interface ZoneUpdate {
    updateType:
        | "zone_created"
        | "zone_updated"
        | "zone_strengthened"
        | "zone_weakened"
        | "zone_completed"
        | "zone_invalidated";
    zone: TradingZone;
    previousState?: Partial<TradingZone>; // For change tracking
    significance: "low" | "medium" | "high"; // Importance of this update
    timestamp: number;

    // Update-specific data
    changeMetrics?: {
        strengthChange: number; // Change in strength
        volumeAdded: number; // Volume added in this update
        timeProgression: number; // Time progression
        completionChange: number; // Change in completion percentage
    };
}

export interface ZoneSignal {
    signalType:
        | "zone_entry"
        | "zone_strength_change"
        | "zone_completion"
        | "zone_breakout_imminent"
        | "zone_invalidation";
    zone: TradingZone;

    // Signal characteristics
    actionType:
        | "enter_zone"
        | "add_to_zone"
        | "prepare_for_breakout"
        | "exit_zone"
        | "monitor_zone";
    confidence: number;
    urgency: "low" | "medium" | "high";
    timeframe: "immediate" | "short_term" | "medium_term";

    // Zone-specific signal data
    expectedDirection: "up" | "down" | "neutral";
    zoneStrength: number;
    completionLevel: number;
    invalidationLevel: number; // Price that would invalidate zone
    breakoutTarget?: number; // Expected breakout target

    // Risk management
    positionSizing: "light" | "normal" | "heavy"; // Based on zone strength
    stopLossLevel: number; // Zone-based stop loss
    takeProfitLevel?: number; // Zone completion target
}

export interface ZoneDetectionData {
    priceRange: { min: number; max: number; center: number };
    totalVolume: number;
    averageOrderSize: number;
    initialStrength: number;
    confidence: number;
    supportingFactors: TradingZone["supportingFactors"];
}

export interface ZoneAnalysisResult {
    updates: ZoneUpdate[];
    signals: ZoneSignal[];
    activeZones: TradingZone[];
}

export interface ZoneDetectorConfig {
    // Core zone detector configuration
    symbol: string; // Trading symbol
    maxActiveZones: number; // Max concurrent zones per symbol
    zoneTimeoutMs: number; // Max zone lifetime
    minZoneVolume: number; // Minimum volume for valid zone
    maxZoneWidth: number; // Max price width percentage
    minZoneStrength: number; // Minimum strength to emit signals
    completionThreshold: number; // Completion level for zone completion signals
    strengthChangeThreshold: number; // Minimum strength change for signals
    minCandidateDuration: number; // Minimum time to form candidate
    maxPriceDeviation: number; // Maximum price deviation within zone
    minTradeCount: number; // Minimum trades before forming zone
    minBuyRatio: number; // Minimum buy ratio for accumulation
    minSellRatio: number; // Minimum sell ratio for distribution

    // Accumulation-specific configuration from AccumulationSettings
    minDurationMs: number; // Minimum accumulation duration
    minRatio: number; // Min passive/aggressive ratio
    minRecentActivityMs: number; // Trade staleness threshold
    threshold: number; // Confidence threshold (0-1)

    // Zone strength threshold parameters (previously hardcoded)
    priceStabilityThreshold: number; // Price stability threshold for accumulation
    strongZoneThreshold: number; // Strong zone strength threshold
    weakZoneThreshold: number; // Weak zone invalidation threshold

    // Volume surge detection parameters for enhanced zone analysis
    volumeSurgeMultiplier: number; // Volume surge threshold for zone validation
    imbalanceThreshold: number; // Order flow imbalance threshold
    institutionalThreshold: number; // Institutional trade size threshold
    burstDetectionMs: number; // Burst detection window
    sustainedVolumeMs: number; // Sustained volume analysis window
    medianTradeSize: number; // Baseline trade size for volume analysis

    // ✅ CLAUDE.md COMPLIANCE: Business-critical configurable parameters
    pricePrecision: number; // Price precision for zone calculations
    zoneTicks: number; // Price levels that define a zone

    // Enhanced zone formation parameters (business configurable)
    enhancedInstitutionalSizeThreshold: number; // Institutional size threshold
    enhancedIcebergDetectionWindow: number; // Iceberg detection window
    enhancedMinInstitutionalRatio: number; // Min institutional ratio

    // Signal generation parameters (business configurable)
    invalidationPercentBelow: number; // Invalidation percentage below zone
    breakoutTargetPercentAbove: number; // Breakout target percentage above center
    stopLossPercentBelow: number; // Stop loss percentage below zone
    takeProfitPercentAbove: number; // Take profit percentage above center
    completionBreakoutTargetPercent: number; // Higher breakout target on completion
    completionStopLossPercent: number; // Stop loss on completion
    completionConfidenceBoost: number; // Confidence boost on completion

    // NEW: Reference to standardized zone configuration
    useStandardizedZones: boolean; // Whether to use centralized zone data
    preferredZoneSize: 1 | 2 | 4; // Preferred zone multiplier (1=base, 2=2x, 4=4x)

    // Enhanced AccumulationZoneDetector standardized zone integration
    standardizedZoneConfig: {
        minZoneConfluenceCount: number; // Minimum zones overlapping for confluence
        maxZoneConfluenceDistance: number; // Max distance for zone confluence in ticks
        institutionalVolumeThreshold: number; // Threshold for institutional volume detection
        passiveVolumeRatioThreshold: number; // Min passive/aggressive ratio for accumulation
        enableZoneConfluenceFilter: boolean; // Filter signals by zone confluence
        enableInstitutionalVolumeFilter: boolean; // Filter by institutional volume presence
        enableCrossTimeframeAnalysis: boolean; // Analyze across multiple zone timeframes
        confluenceConfidenceBoost: number; // Confidence boost for zone confluence
        institutionalVolumeBoost: number; // Confidence boost for institutional volume
        crossTimeframeBoost: number; // Confidence boost for cross-timeframe confirmation
    };

    // Enhancement control parameters
    minEnhancedConfidenceThreshold: number; // Minimum confidence for enhanced signals
    enhancementSignificanceBoost: boolean; // Whether to boost signal significance
    enhancementMode: "disabled" | "testing" | "production"; // Enhancement mode control

    // CLAUDE.md compliant AccumulationZoneDetectorEnhanced parameters
    enhancementCallFrequency: number; // Frequency of enhancement calls
    highConfidenceThreshold: number; // High confidence signal threshold
    lowConfidenceThreshold: number; // Low confidence signal threshold
    minConfidenceBoostThreshold: number; // Minimum confidence boost threshold
    defaultMinEnhancedConfidenceThreshold: number; // Default minimum enhanced confidence
    confidenceReductionFactor: number; // Confidence reduction factor for filtering
    significanceBoostMultiplier: number; // Significance boost multiplier
    neutralBoostReductionFactor: number; // Neutral boost reduction factor
}

export interface ZoneQueryOptions {
    symbol?: string;
    type?: "accumulation" | "distribution";
    isActive?: boolean;
    minStrength?: number;
    maxAge?: number;
    nearPrice?: {
        price: number;
        tolerance: number;
    };
}

// Enhanced zone types for new detectors
export interface IcebergZoneUpdate {
    updateType: "zone_created" | "zone_updated" | "zone_completed";
    zone: {
        id: string;
        type: "iceberg";
        priceRange: { min: number; max: number };
        strength: number;
        completion: number;
        startTime: number;
        endTime?: number;
        totalVolume: number;
        refillCount: number;
        averagePieceSize: number;
        side: "buy" | "sell";
        institutionalScore: number;
        priceStability: number;
        avgRefillGap: number;
        temporalScore: number;
    };
    significance: "low" | "medium" | "high";
}

export interface HiddenOrderZoneUpdate {
    updateType: "zone_created" | "zone_updated" | "zone_completed";
    zone: {
        id: string;
        type: "hidden_liquidity";
        priceRange: { min: number; max: number };
        strength: number;
        completion: number;
        startTime: number;
        endTime?: number;
        totalVolume: number;
        tradeCount: number;
        averageTradeSize: number;
        side: "buy" | "sell";
        stealthScore: number;
        stealthType:
            | "reserve_order"
            | "stealth_liquidity"
            | "algorithmic_hidden"
            | "institutional_stealth";
        volumeConcentration: number;
        detectionMethod: string;
    };
    significance: "low" | "medium" | "high";
}

export interface SpoofingZoneUpdate {
    updateType: "zone_created" | "zone_updated" | "zone_completed";
    zone: {
        id: string;
        type: "spoofing";
        priceRange: { min: number; max: number };
        strength: number;
        completion: number;
        startTime: number;
        endTime?: number;
        spoofType:
            | "fake_wall"
            | "layering"
            | "ghost_liquidity"
            | "algorithmic"
            | "iceberg_manipulation";
        wallSize: number;
        canceled: number;
        executed: number;
        side: "buy" | "sell";
        confidence: number;
        marketImpact: number;
        cancelTimeMs: number;
    };
    significance: "low" | "medium" | "high";
}

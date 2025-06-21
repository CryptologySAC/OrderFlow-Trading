// src/types/zoneTypes.ts

export interface AccumulationZone {
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
    zone: AccumulationZone;
    previousState?: Partial<AccumulationZone>; // For change tracking
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
    zone: AccumulationZone;

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
    supportingFactors: AccumulationZone["supportingFactors"];
}

export interface ZoneAnalysisResult {
    updates: ZoneUpdate[];
    signals: ZoneSignal[];
    activeZones: AccumulationZone[];
}

export interface ZoneDetectorConfig {
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
    minBuyRatio?: number; // Minimum buy ratio for accumulation
    minSellRatio?: number; // Minimum sell ratio for distribution

    // Volume surge detection parameters for enhanced zone analysis
    volumeSurgeMultiplier?: number; // Volume surge threshold for zone validation
    imbalanceThreshold?: number; // Order flow imbalance threshold
    institutionalThreshold?: number; // Institutional trade size threshold
    burstDetectionMs?: number; // Burst detection window
    sustainedVolumeMs?: number; // Sustained volume analysis window
    medianTradeSize?: number; // Baseline trade size for volume analysis
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

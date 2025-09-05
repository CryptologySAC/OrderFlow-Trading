// ============================================================================
// ORDERBOOK DATA TYPES
// ============================================================================

export interface OrderBookLevel {
    price: number;
    bid: number;
    ask: number;
}

export interface OrderBookData {
    priceLevels: OrderBookLevel[];
    midPrice?: number;
    timestamp?: number;
}

// ============================================================================
// SIGNAL DATA TYPES (from backend/src/types/signalTypes.ts)
// ============================================================================

export type SignalType =
    | "absorption"
    | "exhaustion"
    | "accumulation"
    | "distribution"
    | "deltacvd"
    | "absorption_confirmed"
    | "exhaustion_confirmed"
    | "accumulation_confirmed"
    | "distribution_confirmed"
    | "deltacvd_confirmed"
    | "generic";

export type SignalSide = "buy" | "sell";

export interface Signal {
    id: string;
    type: SignalType;
    time: number;
    price: number;
    side: SignalSide;
    tradeIndex?: number;
    isInvalidated?: boolean;
    stopLoss?: number;
    takeProfit?: number;
    timeframe?: "Daytime" | "Nighttime";
    totalAggressiveVolume?: number;
    passiveVolume?: number;
    refilled?: boolean;
    zone?: number;
    detectorSource?: string;
    confidence?: number;
    confirmations?: string[];
    anomaly?: {
        detected: boolean;
        type?: string;
        severity?: string;
    };
    signalData?: SignalDataUnion;
    signalClassification?: "reversal" | "trend_following" | "unknown";
    phaseContext?: {
        phaseDirection: "UP" | "DOWN" | null;
        phaseAge?: number;
        phaseSize?: number;
    };
}

// Union type for all possible signal data structures
export type SignalDataUnion =
    | AbsorptionSignalData
    | ExhaustionSignalData
    | AccumulationResult
    | DistributionResult
    | DeltaCVDConfirmationResult
    | EnhancedAbsorptionSignalData
    | EnhancedExhaustionSignalData
    | EnhancedDistributionSignalData
    | SwingSignalData
    | FlowSignalData
    | TradingSignalData;

export interface AbsorptionSignalData {
    price: number;
    zone: number;
    side: "buy" | "sell";
    aggressive: number;
    passive: number;
    refilled: boolean;
    confidence: number;
    metrics: Record<string, unknown>;
    meta?: Record<string, unknown>;
}

export interface ExhaustionSignalData {
    price: number;
    side: "buy" | "sell";
    aggressive: number;
    oppositeQty: number;
    avgLiquidity: number;
    spread: number;
    confidence: number;
    spoofed?: boolean;
    passiveHistory?: number[];
    meta?: Record<string, unknown>;
}

export interface AccumulationResult {
    price: number;
    side: "buy" | "sell";
    isAccumulating: boolean;
    strength: number;
    duration: number;
    zone: number;
    ratio: number;
    confidence: number;
    metadata?: Record<string, unknown>;
}

export interface DistributionResult {
    duration: number;
    zone: number;
    ratio?: number;
    sellRatio?: number;
    strength: number;
    isAccumulating?: boolean;
    isDistributing?: boolean;
    price: number;
    side: "sell" | "buy";
    confidence: number;
    metadata: {
        accumulationScore?: number;
        distributionScore?: number;
        conditions: SuperiorFlowConditions;
        marketRegime: MarketRegime;
        statisticalSignificance: number;
        volumeConcentration: number;
        detectorVersion: string;
    };
    priceWeakness?: number;
}

export interface DeltaCVDConfirmationResult {
    price: number;
    side: "buy" | "sell";
    rateOfChange: number;
    windowVolume: number;
    tradesInWindow: number;
    delta?: number;
    slopes: Record<number, number>;
    zScores: Record<number, number>;
    confidence: number;
    metadata?: DeltaCVDConfirmationMetadata;
}

export interface DeltaCVDConfirmationMetadata {
    signalType?: "deltacvd" | "deltacvd_confirmed";
    signalDescription?:
        | "momentum_buy"
        | "momentum_sell"
        | "bullish_divergence"
        | "bearish_divergence";
    cvdAnalysis?: {
        shortestWindowSlope: number;
        shortestWindowZScore: number;
        requiredMinZ: number;
        detectionMode: string;
        passedStatisticalTest: boolean;
    };
    absorptionAnalysis?: {
        type: string;
        strength: number;
        expectedSignal: string;
        cvdMagnitude?: number;
        priceChange?: number;
        alignsWithCVD: boolean;
    } | null;
    qualityMetrics?: {
        cvdStatisticalSignificance: number;
        absorptionConfirmation: boolean;
    };
    confidenceFactors?: ConfidenceFactors;
    priceCorrelations?: Record<number, number>;
    marketRegime?: MarketRegime;
    adaptiveThreshold?: number;
    volumeConcentration?: number;
    majorVolumeLevel?: number | null;
    institutionalZones?: InstitutionalZone[];
    dominantInstitutionalSide?: string;
    cvdWeightedPrice?: number;
    institutionalFlowStrength?: number;
    sampleSizes?: Record<number, number>;
    priceMovement?: {
        absoluteMove: number;
        percentMove: number;
        direction: "up" | "down" | "flat";
    };
    cvdMovement: {
        totalCVD: number;
        normalizedCVD: number;
        direction: "bullish" | "bearish";
    };
    signalFrequency?: number;
    timeToLastSignal?: number;
}

export interface InstitutionalZone {
    priceLevel: number;
    netCVD: number;
    buyVolume: number;
    sellVolume: number;
    firstSeen: number;
    lastUpdate: number;
    strength: number;
    isActive: boolean;
}

export interface ConfidenceFactors {
    zScoreAlignment: number;
    magnitudeStrength: number;
    priceCorrelation: number;
    volumeConcentration: number;
    temporalConsistency: number;
    divergencePenalty: number;
}

export interface SuperiorFlowConditions {
    ratio: number;
    duration: number;
    aggressiveVolume: number;
    relevantPassive: number;
    totalPassive: number;
    strength: number;
    velocity: number;
    priceEffect: number;
    statisticalSignificance: number;
    volumeConcentration: number;
    recentActivity: number;
    tradeCount: number;
    meetsMinDuration: boolean;
    meetsMinRatio: boolean;
    isRecentlyActive: boolean;
    dominantSide: "buy" | "sell";
    sideConfidence: number;
    marketVolatility: number;
    trendStrength: number;
}

export interface MarketRegime {
    volatility: number;
    baselineVolatility: number;
    trendStrength: number;
    volumeNormalization: number;
    lastUpdate?: number;
}

export interface EnhancedAbsorptionSignalData {
    price: number;
    zone: number;
    side: "buy" | "sell";
    aggressive: number;
    passive: number;
    refilled: boolean;
    confidence: number;
    passiveMultiplier: number;
    priceEfficiency: number;
    spreadImpact: number;
    volumeProfile: {
        totalVolume: number;
        institutionalRatio: number;
    };
    metadata: {
        signalType: string;
        timestamp: number;
        institutionalRatio: number;
        enhancementType: string;
        qualityMetrics: {
            absorptionStatisticalSignificance: number;
            institutionalConfirmation: boolean;
            signalPurity: "premium" | "standard";
        };
    };
}

export interface EnhancedExhaustionSignalData {
    price: number;
    side: "buy" | "sell";
    aggressive: number;
    oppositeQty: number;
    avgLiquidity: number;
    spread: number;
    confidence: number;
    exhaustionScore: number;
    depletionRatio: number;
    passiveVolumeRatio: number;
    avgSpread: number;
    volumeImbalance: number;
    spoofed?: boolean;
    metadata: {
        signalType: string;
        timestamp: number;
        enhancementType: string;
        affectedZones: number;
        qualityMetrics: {
            exhaustionStatisticalSignificance: number;
            depletionConfirmation: boolean;
            signalPurity: "premium" | "standard";
        };
    };
}

export interface EnhancedDistributionSignalData {
    duration: number;
    zone: number;
    ratio: number;
    sellRatio: number;
    strength: number;
    isDistributing: boolean;
    price: number;
    side: "sell" | "buy";
    confidence: number;
    metadata: {
        distributionScore: number;
        conditions: DistributionConditions;
        marketRegime: DistributionMarketRegime;
        statisticalSignificance: number;
        volumeConcentration: number;
        detectorVersion: string;
    };
}

export interface DistributionConditions {
    sellRatio: number;
    duration: number;
    aggressiveVolume: number;
    passiveVolume: number;
    totalVolume: number;
    strength: number;
    sellingPressure: number;
    priceResistance: number;
    volumeConcentration: number;
    recentActivity: number;
    tradeCount: number;
    meetsMinDuration: boolean;
    meetsMinRatio: boolean;
    isRecentlyActive: boolean;
    dominantSide: "sell";
    sideConfidence: number;
    distributionEfficiency: number;
}

export interface DistributionMarketRegime {
    volatility: number;
    baselineVolatility: number;
    distributionPressure: number;
    resistanceStrength: number;
    lastUpdate: number;
}

export interface SwingSignalData {
    accumulation: AccumulationResult;
    divergence: DivergenceResult;
    expectedGainPercent: number;
    swingType: "high" | "low";
    strength: number;
    confidence: number;
    supportingSignals?: string[];
    meta?: Record<string, unknown>;
    side: "buy" | "sell";
    price: number;
}

export interface DivergenceResult {
    type: "bullish" | "bearish" | "none";
    strength: number;
    priceSlope: number;
    volumeSlope: number;
}

export interface FlowSignalData {
    divergence?: string;
    accumulation?: string;
    lvn?: number;
    meta?: Record<string, unknown>;
    side: "buy" | "sell";
    confidence: number;
    price: number;
}

export interface TradingSignalData {
    confidence: number;
    confirmations: string[];
    meta: SignalDataUnion;
    anomalyCheck: AnomalyData;
    correlationData?: CorrelationData;
    side: "buy" | "sell";
    price: number;
    positionSize?: number;
}

export interface CorrelationData {
    correlatedSignals: number;
    correlationStrength: number;
}

export interface AnomalyData {
    detected?: boolean;
    anomaly?: MarketAnomaly | null;
    activeAnomalyImpact?: number;
    activeAnomaliesCount?: number;
    opposingAnomalies?: Array<{
        type: string;
        impact: number;
        reasoning: string;
    }>;
    supportingAnomalies?: Array<{
        type: string;
        impact: number;
        reasoning: string;
    }>;
    confidenceAdjustment?: AnomalyImpactFactors;
    marketHealthy?: boolean;
    healthRecommendation?: string;
    criticalIssues?: string[];
    tradingAllowed?: boolean;
    recentAnomalyTypes?: string[];
}

export interface AnomalyImpactFactors {
    originalConfidence: number;
    adjustedConfidence: number;
    finalConfidence: number;
    anomalyType?: string;
    correlationBoost?: number;
    contextBoost?: number;
    healthImpact?: string;
    volatilityRegime: string;
    marketVolatility: number;
    impactFactors: Array<{
        anomalyType: string;
        impact: "positive" | "negative";
        multiplier: number;
        decayedMultiplier: number;
        reasoning: string;
    }>;
}

// ============================================================================
// ANOMALY DATA TYPES (from backend/src/utils/types.ts)
// ============================================================================

export type MarketAnomalyType =
    | "flash_crash"
    | "api_gap"
    | "api_connectivity"
    | "liquidity_void"
    | "extreme_volatility"
    | "spoofing"
    | "layering"
    | "ghost_liquidity"
    | "orderbook_imbalance"
    | "health_check"
    | "flow_imbalance"
    | "absorption"
    | "exhaustion"
    | "momentum_ignition"
    | "iceberg_order"
    | "order_size_anomaly"
    | "whale_activity"
    | "coordinated_activity"
    | "algorithmic_activity"
    | "toxic_flow"
    | "realtime_flash_crash"
    | "realtime_api_gap"
    | "realtime_api_connectivity"
    | "realtime_liquidity_void"
    | "realtime_extreme_volatility"
    | "realtime_spoofing"
    | "realtime_layering"
    | "realtime_ghost_liquidity"
    | "realtime_orderbook_imbalance"
    | "realtime_flow_imbalance"
    | "realtime_whale_activity"
    | "realtime_absorption"
    | "realtime_exhaustion"
    | "realtime_momentum_ignition"
    | "realtime_iceberg_order"
    | "realtime_order_size_anomaly"
    | "hidden_liquidity"
    | "stealth_order"
    | "reserve_order"
    | "algorithmic_stealth"
    | "realtime_hidden_liquidity"
    | "realtime_stealth_order"
    | "realtime_reserve_order"
    | "realtime_algorithmic_stealth";

export type AnomalySeverity = "low" | "medium" | "high" | "critical" | "info";

export type RecommendedAction =
    | "pause"
    | "reduce_size"
    | "close_positions"
    | "continue"
    | "insufficient_data"
    | "caution"
    | "consider_long"
    | "consider_short"
    | "momentum_long"
    | "momentum_short"
    | "fade_rally"
    | "fade_dip"
    | "prepare_reversal"
    | "join_buy_momentum"
    | "join_sell_momentum"
    | "avoid_selling"
    | "avoid_buying"
    | "monitor"
    | "watch_support"
    | "watch_resistance";

export interface MarketAnomaly {
    type: MarketAnomalyType;
    detectedAt: number;
    severity: AnomalySeverity;
    affectedPriceRange: { min: number; max: number };
    recommendedAction: RecommendedAction;
    details: Record<string, unknown>;
}

// ============================================================================
// RSI DATA TYPES
// ============================================================================

export interface RSIDataPoint {
    time: number;
    rsi: number;
}

// ============================================================================
// ZONE DATA TYPES (from backend/src/types/zoneTypes.ts)
// ============================================================================

export type ZoneUpdateType =
    | "zone_created"
    | "zone_updated"
    | "zone_strengthened"
    | "zone_weakened"
    | "zone_completed"
    | "zone_invalidated";

export type ZoneSignalType = "completion" | "invalidation" | "consumption";

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
    startTime: number;
    lastUpdate: number;
    metadata: {
        buyRatio?: number;
        sellRatio?: number;
        conditions: AccumulationConditions | DistributionConditions;
        marketRegime: AccumulationMarketRegime | DistributionMarketRegime;
    };
}

export interface AccumulationConditions {
    ratio: number;
    duration: number;
    aggressiveVolume: number;
    relevantPassive: number;
    totalPassive: number;
    strength: number;
    velocity: number;
    dominantSide: "buy";
    recentActivity: number;
    tradeCount: number;
    meetsMinDuration: boolean;
    meetsMinRatio: boolean;
    isRecentlyActive: boolean;
    accumulationEfficiency: number;
}

export interface AccumulationMarketRegime {
    volatility: number;
    baselineVolatility: number;
    accumulationPressure: number;
    supportStrength: number;
    lastUpdate: number;
}

export interface ZoneUpdateEvent {
    updateType: ZoneUpdateType;
    zone: ZoneVisualizationData;
    significance: number;
    detectorId: string;
    timestamp: number;
}

export interface ZoneSignalEvent {
    signalType: ZoneSignalType;
    zone: ZoneVisualizationData;
    actionType: string;
    confidence: number;
    expectedDirection: "up" | "down";
    detectorId: string;
    timestamp: number;
}

// ============================================================================
// SUPPORT/RESISTANCE DATA TYPES
// ============================================================================

export interface SupportResistanceLevel {
    id: string;
    price: number;
    type: "support" | "resistance";
    strength: number;
    touchCount: number;
    firstDetected: number;
    lastTouched: number;
    volumeAtLevel: number;
    roleReversals?: Array<{
        timestamp: number;
        previousType: "support" | "resistance";
        newType: "support" | "resistance";
    }>;
}

// ============================================================================
// VALIDATION FUNCTIONS - STRICT 100% TYPE SAFETY
// ============================================================================

export function isValidOrderBookData(data: unknown): data is OrderBookData {
    if (!data || typeof data !== "object") return false;
    const ob = data as Record<string, unknown>;

    if (!Array.isArray(ob["priceLevels"])) return false;

    return ob["priceLevels"].every((level: unknown) => {
        if (!level || typeof level !== "object") return false;
        const l = level as Record<string, unknown>;
        return (
            typeof l["price"] === "number" &&
            typeof l["bid"] === "number" &&
            typeof l["ask"] === "number"
        );
    });
}

export function isValidSignalData(data: unknown): data is Signal {
    if (!data || typeof data !== "object") return false;
    const signal = data as Record<string, unknown>;

    const validTypes: SignalType[] = [
        "absorption",
        "exhaustion",
        "accumulation",
        "distribution",
        "deltacvd",
        "absorption_confirmed",
        "exhaustion_confirmed",
        "accumulation_confirmed",
        "distribution_confirmed",
        "deltacvd_confirmed",
        "generic",
    ];

    return (
        typeof signal["id"] === "string" &&
        typeof signal["type"] === "string" &&
        validTypes.includes(signal["type"] as SignalType) &&
        typeof signal["time"] === "number" &&
        typeof signal["price"] === "number" &&
        (signal["side"] === "buy" || signal["side"] === "sell")
    );
}

export function isValidAnomalyData(data: unknown): data is MarketAnomaly {
    if (!data || typeof data !== "object") return false;
    const anomaly = data as Record<string, unknown>;

    const validSeverities: AnomalySeverity[] = [
        "low",
        "medium",
        "high",
        "critical",
        "info",
    ];
    const validActions: RecommendedAction[] = [
        "pause",
        "reduce_size",
        "close_positions",
        "continue",
        "insufficient_data",
        "caution",
        "consider_long",
        "consider_short",
        "momentum_long",
        "momentum_short",
        "fade_rally",
        "fade_dip",
        "prepare_reversal",
        "join_buy_momentum",
        "join_sell_momentum",
        "avoid_selling",
        "avoid_buying",
        "monitor",
        "watch_support",
        "watch_resistance",
    ];

    return !!(
        typeof anomaly["type"] === "string" &&
        typeof anomaly["detectedAt"] === "number" &&
        !!validSeverities.includes(anomaly["severity"] as AnomalySeverity) &&
        typeof anomaly["affectedPriceRange"] === "object" &&
        anomaly["affectedPriceRange"] &&
        typeof (anomaly["affectedPriceRange"] as { min: unknown; max: unknown })
            .min === "number" &&
        typeof (anomaly["affectedPriceRange"] as { min: unknown; max: unknown })
            .max === "number" &&
        !!validActions.includes(
            anomaly["recommendedAction"] as RecommendedAction
        ) &&
        typeof anomaly["details"] === "object"
    );
}

export function isValidRSIData(data: unknown): data is RSIDataPoint {
    if (!data || typeof data !== "object") return false;
    const rsi = data as Record<string, unknown>;

    return (
        typeof rsi["time"] === "number" &&
        typeof rsi["rsi"] === "number" &&
        rsi["rsi"] >= 0 &&
        rsi["rsi"] <= 100
    );
}

export function isValidZoneUpdateData(data: unknown): data is ZoneUpdateEvent {
    if (!data || typeof data !== "object") return false;
    const update = data as Record<string, unknown>;

    const validTypes: ZoneUpdateType[] = [
        "zone_created",
        "zone_updated",
        "zone_strengthened",
        "zone_weakened",
        "zone_completed",
        "zone_invalidated",
    ];

    return !!(
        typeof update["updateType"] === "string" &&
        !!validTypes.includes(update["updateType"] as ZoneUpdateType) &&
        typeof update["zone"] === "object" &&
        update["zone"] &&
        typeof (update["zone"] as { id: unknown }).id === "string" &&
        typeof update["significance"] === "number" &&
        typeof update["detectorId"] === "string" &&
        typeof update["timestamp"] === "number"
    );
}

export function isValidZoneSignalData(data: unknown): data is ZoneSignalEvent {
    if (!data || typeof data !== "object") return false;
    const signal = data as Record<string, unknown>;

    const validTypes: ZoneSignalType[] = [
        "completion",
        "invalidation",
        "consumption",
    ];

    return !!(
        typeof signal["signalType"] === "string" &&
        !!validTypes.includes(signal["signalType"] as ZoneSignalType) &&
        typeof signal["zone"] === "object" &&
        signal["zone"] &&
        typeof signal["actionType"] === "string" &&
        typeof signal["confidence"] === "number" &&
        (signal["expectedDirection"] === "up" ||
            signal["expectedDirection"] === "down") &&
        typeof signal["detectorId"] === "string" &&
        typeof signal["timestamp"] === "number"
    );
}

export function isValidSupportResistanceData(
    data: unknown
): data is SupportResistanceLevel {
    if (!data || typeof data !== "object") return false;
    const level = data as Record<string, unknown>;

    return (
        typeof level["id"] === "string" &&
        typeof level["price"] === "number" &&
        (level["type"] === "support" || level["type"] === "resistance") &&
        typeof level["strength"] === "number" &&
        typeof level["touchCount"] === "number" &&
        typeof level["firstDetected"] === "number" &&
        typeof level["lastTouched"] === "number" &&
        typeof level["volumeAtLevel"] === "number"
    );
}

// ============================================================================
// TYPE GUARDS FOR RUNTIME VALIDATION
// ============================================================================

export function validateAndCastOrderBookData(
    data: unknown
): OrderBookData | null {
    return isValidOrderBookData(data) ? data : null;
}

export function validateAndCastSignalData(data: unknown): Signal | null {
    return isValidSignalData(data) ? data : null;
}

export function validateAndCastAnomalyData(
    data: unknown
): MarketAnomaly | null {
    return isValidAnomalyData(data) ? data : null;
}

export function validateAndCastRSIData(data: unknown): RSIDataPoint | null {
    return isValidRSIData(data) ? data : null;
}

export function validateAndCastZoneUpdateData(
    data: unknown
): ZoneUpdateEvent | null {
    return isValidZoneUpdateData(data) ? data : null;
}

export function validateAndCastZoneSignalData(
    data: unknown
): ZoneSignalEvent | null {
    return isValidZoneSignalData(data) ? data : null;
}

export function validateAndCastSupportResistanceData(
    data: unknown
): SupportResistanceLevel | null {
    return isValidSupportResistanceData(data) ? data : null;
}

// ============================================================================
// UTILITY TYPES FOR TYPE-SAFE DATA HANDLING
// ============================================================================

export interface ValidationResult<T> {
    isValid: boolean;
    data: T | null;
    errors: string[];
}

// ============================================================================
// CHART DATA INTERFACES FOR TYPE-SAFE CHART HANDLING
// ============================================================================

export interface ChartDataPoint {
    x: number; // timestamp
    y: number; // price
    quantity?: number;
    orderType?: "BUY" | "SELL";
}

export interface ChartDataset {
    label: string;
    data: ChartDataPoint[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    pointRadius?: number | number[];
    hoverRadius?: number | number[];
}

export interface ChartOptions {
    responsive?: boolean;
    maintainAspectRatio?: boolean;
    animation?: boolean;
    layout?: {
        padding?:
            | number
            | { top?: number; right?: number; bottom?: number; left?: number };
    };
    scales?: {
        x?: {
            type?: string;
            time?: {
                unit?: string;
                displayFormats?: Record<string, string>;
            };
            min?: number;
            max?: number;
            grid?: {
                display?: boolean;
                color?: string;
                ticks?: { source?: string };
            };
            ticks?: {
                color?: string;
                stepSize?: number;
                precision?: number;
                callback?: (value: unknown, index: number) => string;
            };
        };
        y?: {
            type?: string;
            title?: { display?: boolean; text?: string };
            ticks?: {
                stepSize?: number;
                precision?: number;
                color?: string;
                callback?: (value: unknown, index: number) => string;
            };
            position?: string;
            grace?: number;
            offset?: boolean;
            min?: number;
            max?: number;
            suggestedMin?: number;
            suggestedMax?: number;
            grid?: {
                display?: boolean;
                color?: string;
            };
        };
    };
    plugins?: {
        legend?: {
            display?: boolean;
            position?: string;
            labels?: {
                usePointStyle?: boolean;
                boxWidth?: number;
                boxHeight?: number;
                padding?: number;
                font?: { size?: number };
            };
        };
        tooltip?: {
            callbacks?: {
                label?: (context: unknown) => string;
                title?: (context: unknown[]) => string;
            };
        };
        annotation?: {
            annotations?: Record<string, unknown>;
        };
        zoom?: {
            pan?: {
                enabled?: boolean;
                mode?: string;
                onPanComplete?: (context: unknown) => void;
            };
            zoom?: {
                wheel?: { enabled?: boolean };
                pinch?: { enabled?: boolean };
                mode?: string;
                onZoomComplete?: (context: unknown) => void;
            };
        };
    };
    datasets?: {
        bar?: {
            barPercentage?: number;
            categoryPercentage?: number;
        };
    };
    indexAxis?: string;
}

export interface ChartInstance {
    data: {
        datasets: ChartDataset[];
        labels?: unknown[];
    };
    options: ChartOptions;
    update: (mode?: string) => void;
    resize: () => void;
}

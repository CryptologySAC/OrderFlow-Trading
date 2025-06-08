import { MarketAnomaly } from "../utils/types.js";

export type DetectorResultType =
    | AbsorptionSignalData
    | ExhaustionSignalData
    | AccumulationResult
    | TradingSignalData
    | DeltaCVDConfirmationResult
    | DistributionResult
    | SwingSignalData
    | FlowSignalData;

export type SignalType =
    | "absorption"
    | "exhaustion"
    | "accumulation"
    | "distribution"
    | "absorption_confirmed"
    | "exhaustion_confirmed"
    | "accumulation_confirmed"
    | "distribution_confirmed"
    | "flow"
    | "swingHigh"
    | "swingLow"
    | "cvd_confirmation"
    | "cvd_confirmation_confirmed"
    | "support_resistance_level"
    | "generic";

export type SignalSide = "buy" | "sell";

export interface Signal {
    id: string; // unique for each signal instance
    type: SignalType;
    time: number; // ms since epoch
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
    confidence?: number; // 0..1
    confirmations?: string[]; // detector sources that confirmed
    anomaly?: { detected: boolean; type?: string; severity?: string };
    signalData?: DetectorResultType;
}

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

export interface FlowSignalData {
    divergence?: string;
    accumulation?: string;
    lvn?: number;
    meta?: Record<string, unknown>;
    side: "buy" | "sell";
    confidence: number;
    price: number;
}

export interface DivergenceResult {
    type: "bullish" | "bearish" | "none";
    strength: number;
    priceSlope: number;
    volumeSlope: number;
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

export interface BaseSignalEvent {
    type: SignalType;
    time: number;
    price: number;
    side: "buy" | "sell";
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
    metadata?: Record<string, unknown>;
}

export interface SignalCandidate {
    id: string;
    type: SignalType;
    side: "buy" | "sell";
    confidence: number;
    timestamp: number;
    data: DetectorResultType;
}

export interface ProcessedSignal {
    id: string;
    originalCandidate: SignalCandidate;
    type: SignalType;
    confidence: number;
    timestamp: Date;
    detectorId: string;
    processingMetadata: {
        processedAt: Date;
        processingVersion: string;
        enrichments?: Record<string, unknown>[];
    };
    data: DetectorResultType;
}

// Add these interfaces to your types file

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
    healthImpact?: string;
    impactFactors: Array<{
        anomalyType: string;
        impact: "positive" | "negative" | "neutral";
        multiplier: number;
        decayedMultiplier: number;
        reasoning: string;
    }>;
}

// Update your ConfirmedSignal interface to include these new fields
export interface ConfirmedSignal {
    id: string;
    originalSignals: Array<{
        id: string;
        type: SignalType;
        confidence: number;
        detectorId: string;
        confirmations: Set<string>;
        metadata: DetectorResultType;
    }>;
    confidence: number;
    finalPrice: number;
    confirmedAt: number;
    correlationData: CorrelationData;
    anomalyData: AnomalyData;
}

// Update TradingSignalData to include correlation data
export interface TradingSignalData {
    confidence: number;
    confirmations: string[];
    meta: DetectorResultType;
    anomalyCheck: AnomalyData;
    correlationData?: CorrelationData;
    side: "buy" | "sell";
    price: number;
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

export type MarketRegime = {
    volatility: number;
    baselineVolatility: number;
    trendStrength: number;
    volumeNormalization: number;
    lastUpdate: number;
};

export interface DistributionEvent {
    timestamp: number;
    price: number;
    volume: number;
    bidSizeBefore: number;
    type: "aggressive_sell" | "bid_refill" | "resistance_test";
}

export interface SuperiorFlowConditions {
    // Core metrics
    ratio: number;
    duration: number;
    aggressiveVolume: number;
    relevantPassive: number;
    totalPassive: number;

    // Enhanced analytics
    strength: number;
    velocity: number;
    priceEffect: number;
    statisticalSignificance: number;
    volumeConcentration: number;

    // Timing
    recentActivity: number;
    tradeCount: number;

    // Validation flags
    meetsMinDuration: boolean;
    meetsMinRatio: boolean;
    isRecentlyActive: boolean;

    // Side analysis
    dominantSide: "buy" | "sell";
    sideConfidence: number;

    // Market context
    marketVolatility: number;
    trendStrength: number;
}

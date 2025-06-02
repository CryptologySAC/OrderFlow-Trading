import { MarketAnomaly } from "../utils/types.js";

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
    | "cvd_confirmation";

export type SignalSide = "buy" | "sell";

export type CloseReason =
    | "take_profit"
    | "stop_loss"
    | "opposite_signal"
    | "end_of_data"
    | "invalidated"
    | "exhaustion"
    | "absorption"
    | "delta_divergence"
    | "cvd_slope_reversal"
    | "both"
    | "swing_detection";

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
    closeReason?: CloseReason;
    totalAggressiveVolume?: number;
    passiveVolume?: number;
    refilled?: boolean;
    zone?: number;
    detectorSource?: string;
    confidence?: number; // 0..1
    confirmations?: string[]; // detector sources that confirmed
    anomaly?: { detected: boolean; type?: string; severity?: string };
    signalData?:
        | AbsorptionSignalData
        | ExhaustionSignalData
        | DeltaCVDConfirmationEvent
        | SwingSignalData
        | FlowSignalData
        | TradingSignalData;
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
    supportingSignals?: string[];
    meta?: Record<string, unknown>;
}

export interface FlowSignalData {
    divergence?: string;
    accumulation?: string;
    lvn?: number;
    meta?: Record<string, unknown>;
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

export interface DeltaCVDConfirmationEvent extends BaseSignalEvent {
    rateOfChange: number;
    windowVolume: number;
    direction: "up" | "down";
    triggerType: "absorption" | "exhaustion";
    windowTrades: number;
    meta?: unknown;
    delta?: number;
    slope?: number;
}

export interface SignalCandidate {
    id: string;
    type: SignalType;
    side: "buy" | "sell";
    confidence: number;
    timestamp: number;
    data: AbsorptionSignalData | ExhaustionSignalData | AccumulationResult;
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
        enrichments: Record<string, unknown>[];
    };
    data: AbsorptionSignalData | ExhaustionSignalData | AccumulationResult;
}

// Add these interfaces to your types file

export interface CorrelationData {
    correlatedSignals: number;
    correlationStrength: number;
}

export interface AnomalyData {
    detected: boolean;
    anomaly: MarketAnomaly | null;
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
}

export interface AnomalyImpactFactors {
    originalConfidence: number;
    adjustedConfidence: number;
    finalConfidence: number;
    anomalyType?: string;
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
        metadata:
            | AbsorptionSignalData
            | ExhaustionSignalData
            | AccumulationResult
            | TradingSignalData;
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
    meta:
        | AbsorptionSignalData
        | ExhaustionSignalData
        | AccumulationResult
        | TradingSignalData;
    anomalyCheck: AnomalyData;
    correlationData?: CorrelationData;
}

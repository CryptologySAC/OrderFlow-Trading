import { MarketAnomaly } from "../utils/types.js";

export type SignalType =
    | "absorption"
    | "exhaustion"
    | "absorption_confirmed"
    | "exhaustion_confirmed"
    | "flow"
    | "swingHigh"
    | "swingLow";

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
        | DeltaCVDData
        | SwingSignalData
        | FlowSignalData
        | TradingSignalData;
}

export interface DeltaCVDData {
    delta: number; // delta value for the signal
    slope: number; // slope of the CVD line
}

export interface AbsorptionSignalData {
    absorptionType: "classic" | "relative" | "iceberg" | "other";
    recentAggressive: number;
    rollingZonePassive: number;
    avgPassive: number;
    spoofed?: boolean;
    passiveHistory?: number[];
    meta?: Record<string, unknown>;
}

export interface ExhaustionSignalData {
    exhaustionType: "absolute" | "relative" | "spread" | "extreme";
    recentAggressive: number;
    oppositeQty: number;
    avgLiquidity: number;
    spread: number;
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
    isAccumulating: boolean;
    strength: number;
    duration: number;
    zone: number;
    ratio: number;
}

export interface TradingSignalData {
    confidence: number;
    confirmations: string[];
    meta: Record<string, unknown>;
    anomalyCheck: {
        detected: boolean;
        anomaly?: MarketAnomaly;
    };
}

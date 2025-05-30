// src/utils/types.ts
import {
    AccumulationResult,
    DivergenceResult,
    SwingSignalData,
} from "../types/signalTypes.js";
/* ===========================
   BINANCE SPECIFIC TYPES
   =========================== */

import type { SpotWebsocketStreams } from "@binance/spot";

/**
 * Raw Binance trade structure
 */
export interface BinanceTrade {
    e: string; // Event type
    E: number; // Event time
    s: string; // Symbol
    t: number; // Trade ID
    p: string; // Price
    q: string; // Quantity
    T: number; // Trade time
    m: boolean; // Is buyer maker
    M: boolean; // Is best match
}

/**
 * Binance order book level
 */
export interface BinanceDepthLevel {
    price: string;
    quantity: string;
}

/* ===========================
   CORE DOMAIN TYPES
   =========================== */

/**
 * Normalized trade data used throughout the system
 */
export interface TradeData {
    price: number;
    quantity: number;
    timestamp: number;
    isMakerSell: boolean;
    originalTrade: SpotWebsocketStreams.AggTradeResponse;
}

/**
 * Detected orderflow event with deduplication support
 */
export interface Detected {
    id: string; // Unique identifier for deduplication
    side: "buy" | "sell";
    price: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    passiveVolume?: number;
    zone?: number;
    refilled?: boolean;
    detectedAt: number; // Timestamp for sequencing
    detectorSource: "absorption" | "exhaustion"; // Track source
}

/* ===========================
   SIGNAL MANAGEMENT TYPES
   =========================== */

/**
 * Signal coordination state for cross-confirmation
 */
export interface SignalCoordination {
    pendingSignals: Map<string, PendingSignal>;
    confirmedSignals: Map<string, ConfirmedSignal>;
    lastProcessedTime: number;
}

export interface PendingSignal {
    id: string;
    type: "absorption" | "exhaustion" | "swingHigh" | "swingLow";
    price: number;
    timestamp: number;
    confirmations: Set<string>; // Set of detector names that confirmed
    requiredConfirmations: number;
    expiresAt: number;
    metadata: Record<string, unknown>;
}

export interface ConfirmedSignal {
    id: string;
    originalSignals: PendingSignal[];
    finalPrice: number;
    confirmedAt: number;
    confidence: number;
    executed: boolean;
}

/* ===========================
   STATE MANAGEMENT TYPES
   =========================== */

/**
 * System state snapshot for recovery
 */
export interface SystemState {
    version: number;
    timestamp: number;
    orderBook: {
        lastUpdateId: number;
        snapshot: Map<number, { bid: number; ask: number }>;
    };
    detectors: {
        absorption: DetectorState;
        exhaustion: DetectorState;
        swing: DetectorState;
    };
    activeSignals: SignalCoordination;
}

export interface DetectorState {
    lastSignalTime: number;
    pendingDetections: number;
    configuration: Record<string, unknown>;
}

/* ===========================
   MARKET TIME TYPES
   =========================== */

/**
 * Separate wall clock from market time for backtesting
 */
export interface TimeContext {
    wallTime: number; // System time
    marketTime: number; // Market data time
    mode: "realtime" | "backtest" | "replay";
    speed: number; // Replay speed multiplier
}

/* ===========================
   BUFFER MANAGEMENT TYPES
   =========================== */

/**
 * Buffer overflow protection configuration
 */
export interface BufferConfig {
    maxSize: number;
    overflowStrategy: "drop_oldest" | "drop_newest" | "block";
    warningThreshold: number; // Percentage full to trigger warning
    flushInterval?: number; // Auto-flush to storage
}

/* ===========================
   ERROR & RECOVERY TYPES
   =========================== */

/**
 * Market anomaly detection
 */
export interface MarketAnomaly {
    type:
        | "flash_crash"
        | "api_gap"
        | "liquidity_void"
        | "extreme_volatility"
        | "spoofing"
        | "orderbook_imbalance"
        | "health_check";
    detectedAt: number;
    severity: "low" | "medium" | "high" | "critical" | "info";
    affectedPriceRange: { min: number; max: number };
    recommendedAction:
        | "pause"
        | "reduce_size"
        | "close_positions"
        | "continue"
        | "insufficient_data"
        | "caution";
}

/* ===========================
   EXISTING TYPES (organized)
   =========================== */

export interface PlotTrade {
    time: number;
    price: number;
    quantity: number;
    orderType: "BUY" | "SELL";
    symbol: string;
    tradeId: number;
}

export interface Trade {
    e: string;
    E: number;
    s: string;
    t: number;
    p: string;
    q: string;
    T: number;
    m: boolean;
    M: boolean;
}

export interface AbsorptionLabel {
    time: number;
    price: number;
    label: string;
}

export interface Detected {
    side: "buy" | "sell";
    price: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    totalAggressiveVolume: number;
    passiveVolume?: number;
    zone?: number;
    refilled?: boolean;
}

export interface VolumeBin {
    buyVol: number;
    sellVol: number;
    lastUpdate: number;
}

export interface SwingPoint {
    tradeId: number;
    price: number;
    timeStamp: number;
}

export enum HighLow {
    HIGH = 1,
    LOW = -1,
}

/**
 * Alert message structure for webhooks and notifications
 */
export interface AlertMessage {
    type: "swing_entry" | "swing_exit" | "risk_alert";
    symbol: string;
    price: number;
    side: "buy" | "sell";
    confidence: number;
    targets: {
        breakeven: number;
        profit1: number;
        profit2: number;
        stopLoss: number;
    };
    reasoning: string[];
    timestamp: string;
}

/**
 * Trade execution tracking
 */
export interface TradeExecution {
    id: string;
    signalId: string;
    entryPrice: number;
    entryTime: number;
    side: "buy" | "sell";
    size: number;
    status: "open" | "partial" | "closed";
    exitPrice?: number;
    exitTime?: number;
    pnl?: number;
    pnlPercent?: number;
}

/**
 * Performance metrics for strategy evaluation
 */
export interface PerformanceMetrics {
    totalTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
    recoveryFactor: number;
}

/**
 * Market regime classification
 */
export interface MarketRegime {
    type: "trending_up" | "trending_down" | "ranging" | "volatile";
    strength: number; // 0-1
    duration: number; // milliseconds
    lastUpdate: number;
}

/**
 * Risk management parameters
 */
export interface RiskParameters {
    maxPositionSize: number; // in USDT
    maxDailyLoss: number; // in USDT
    maxOpenPositions: number;
    riskPerTrade: number; // percentage of capital
    correlationLimit: number; // max correlation between positions
}

/**
 * Signal quality metrics
 */
export interface SignalQuality {
    confidence: number; // 0-1
    confirmations: number;
    strength: number; // 0-1
    expectedRiskReward: number;
    historicalWinRate?: number;
}

/**
 * Volume profile data point
 */
export interface VolumeProfileLevel {
    price: number;
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    percentOfTotal: number;
}

/**
 * Order book imbalance metrics
 */
export interface OrderBookImbalance {
    ratio: number; // bid/ask ratio
    percentile: number; // historical percentile
    trend: "increasing" | "decreasing" | "stable";
    significance: number; // 0-1
}

/**
 * Configuration for swing trading strategy
 */
export interface SwingTradingConfig {
    targetPercent: number;
    stopLossPercent: number;
    breakEvenTriggerPercent: number;
    trailingStopPercent?: number;
    partialTakePercent?: number;
    minConfirmations: number;
    maxHoldingPeriod: number; // milliseconds
    allowedTradingHours?: {
        start: number; // hour in UTC
        end: number;
    };
}

/**
 * Backtesting configuration
 */
export interface BacktestConfig {
    startDate: Date;
    endDate: Date;
    initialCapital: number;
    commissionRate: number;
    slippage: number; // percentage
    strategy: SwingTradingConfig;
}

/**
 * Real-time monitoring metrics
 */
export interface MonitoringMetrics {
    systemHealth: "healthy" | "degraded" | "critical";
    dataLatency: number; // milliseconds
    signalsGenerated: number;
    activePositions: number;
    dailyPnL: number;
    connectionStatus: {
        websocket: boolean;
        database: boolean;
        alerts: boolean;
    };
}

/**
 * Signal context for debugging and analysis
 */
export interface SignalContext {
    triggerPrice: number;
    triggerTime: number;
    marketConditions: {
        spread: number;
        volatility: number;
        volume24h: number;
        trendStrength: number;
    };
    indicatorValues: {
        accumulation: AccumulationResult;
        divergence: DivergenceResult;
        volumeProfile: {
            poc: number;
            valueAreaHigh: number;
            valueAreaLow: number;
        };
    };
}

/**
 * Trade lifecycle events
 */
export type TradeEvent =
    | { type: "signal_generated"; data: SignalContext }
    | { type: "entry_triggered"; data: TradeExecution }
    | { type: "stop_moved"; data: { tradeId: string; newStop: number } }
    | {
          type: "partial_exit";
          data: { tradeId: string; percent: number; price: number };
      }
    | { type: "trade_closed"; data: TradeExecution };

/**
 * WebSocket message types for real-time updates
 */
export interface SwingSignalMessage {
    type: "swing_signal";
    data: {
        signal: SwingSignalData;
        quality: SignalQuality;
        context: SignalContext;
    };
    timestamp: number;
}

/**
 * Database schema types
 */
export interface SignalRecord {
    id: string;
    timestamp: number;
    symbol: string;
    type: string;
    price: number;
    data: SwingSignalData;
    quality: SignalQuality;
    executed: boolean;
    executionId?: string;
}

export interface TradeRecord {
    id: string;
    signalId: string;
    entryTime: number;
    entryPrice: number;
    exitTime?: number;
    exitPrice?: number;
    side: "buy" | "sell";
    size: number;
    commission: number;
    pnl?: number;
    pnlPercent?: number;
    exitReason?: string;
}

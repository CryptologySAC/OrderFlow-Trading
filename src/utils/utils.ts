import { SpotWebsocketStreams } from "@binance/spot";
import { ISignalLogger } from "../services/signalLogger.js";

/**
 * Utility to parse boolean-like environment strings.
 */
export function parseBool(
    val: string | undefined,
    defaultValue = false
): boolean {
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === "true";
}

/**
 * Interface for a pending orderflow detection (absorption or exhaustion).
 */
export interface PendingDetection {
    time: number;
    price: number;
    side: "buy" | "sell";
    zone: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    aggressive: number;
    passive: number; // Enforced as number, not number | null
    refilled: boolean;
    confirmed: boolean;
    status?: "pending" | "confirmed" | "invalidated";
}

/**
 * Generic, exchange-agnostic trade interface.
 */
export interface TradeData {
    price: number;
    quantity: number;
    timestamp: number;
    isMakerSell: boolean;
    originalTrade: SpotWebsocketStreams.AggTradeResponse;
}

/**
 * Interface for orderbook price level.
 */
export interface DepthLevel {
    bid: number;
    ask: number;
}

/**
 * Circular buffer with iterator support for efficient trade storage.
 */
export class CircularBuffer<T> implements Iterable<T> {
    private buffer: T[] = [];
    private head = 0;
    private size = 0;

    constructor(private capacity: number) {}

    add(item: T): void {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
    }

    getAll(): T[] {
        if (this.size === 0) return [];
        const result: T[] = [];
        let start = this.size < this.capacity ? 0 : this.head;
        for (let i = 0; i < this.size; i++) {
            result.push(this.buffer[(start + i) % this.capacity]);
        }
        return result;
    }

    filter(predicate: (item: T) => boolean): T[] {
        return this.getAll().filter(predicate);
    }

    clear(): void {
        this.size = 0;
        this.head = 0;
    }

    get length(): number {
        return this.size;
    }

    /**
     * Allow use in for-of and spread operator.
     */
    [Symbol.iterator](): Iterator<T> {
        return this.getAll()[Symbol.iterator]();
    }

    /**
     * Random-access by relative index (0 = oldest, length-1 = newest).
     */
    at(index: number): T | undefined {
        if (index < 0 || index >= this.size) return undefined;
        let start = this.size < this.capacity ? 0 : this.head;
        return this.buffer[(start + index) % this.capacity];
    }
}

/**
 * Time-aware cache for automatic cleanup.
 */
export class TimeAwareCache<K, V> {
    private cache = new Map<K, { value: V; timestamp: number }>();
    private lastCleanup = Date.now();
    private readonly cleanupInterval = 60000; // 1 minute

    constructor(private ttl: number) {}

    set(key: K, value: V): void {
        this.cache.set(key, { value, timestamp: Date.now() });
        this.maybeCleanup();
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }

    has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    delete(key: K): void {
        this.cache.delete(key);
    }

    /**
     * Manual cleanup for explicit testing/maintenance.
     */
    forceCleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
        this.lastCleanup = now;
    }

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupInterval) return;
        this.forceCleanup();
    }

    size(): number {
        return this.cache.size;
    }
}

/**
 * Spoofing detection module for orderbook wall changes.
 */
export class SpoofingDetector {
    private passiveChangeHistory = new TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >(300000); // 5 minutes TTL

    /**
     * Track changes in passive (limit) orderbook at price level.
     */
    trackPassiveChange(price: number, bid: number, ask: number): void {
        const now = Date.now();
        let history = this.passiveChangeHistory.get(price) || [];
        history.push({ time: now, bid, ask });
        if (history.length > 10) history = history.slice(-10);
        this.passiveChangeHistory.set(price, history);
    }

    /**
     * Detect spoofing (fake wall pull) at given price/side.
     */
    wasSpoofed(
        price: number,
        side: "buy" | "sell",
        tradeTime: number
    ): boolean {
        const hist = this.passiveChangeHistory.get(price);
        if (!hist || hist.length < 2) return false;
        for (let i = hist.length - 2; i >= 0; i--) {
            const curr = hist[i + 1];
            const prev = hist[i];
            if (curr.time > tradeTime) continue;
            const delta =
                side === "buy" ? prev.ask - curr.ask : prev.bid - curr.bid;
            const base = side === "buy" ? prev.ask : prev.bid;
            if (
                base > 0 &&
                delta / base > 0.6 &&
                curr.time - prev.time < 1200
            ) {
                console.log(
                    "[SpoofingDetector] Spoofing detected at price:",
                    price
                );
                return true;
            }
            if (curr.time < tradeTime - 2000) break;
        }
        return false;
    }
}

/**
 * Adaptive zone size calculation (ATR-based).
 */
export class AdaptiveZoneCalculator {
    private priceWindow: number[] = [];
    private rollingATR = 0;
    private readonly atrLookback: number;

    constructor(atrLookback = 30) {
        this.atrLookback = atrLookback;
    }

    /**
     * Push latest trade price for ATR calculation.
     */
    updatePrice(price: number): void {
        this.priceWindow.push(price);
        if (this.priceWindow.length > this.atrLookback) {
            this.priceWindow.shift();
        }
        if (this.priceWindow.length > 2) {
            let sum = 0;
            for (let i = 1; i < this.priceWindow.length; i++) {
                sum += Math.abs(this.priceWindow[i] - this.priceWindow[i - 1]);
            }
            this.rollingATR = sum / (this.priceWindow.length - 1);
        }
    }

    /**
     * Get current adaptive zone width in ticks.
     */
    getAdaptiveZoneTicks(pricePrecision: number): number {
        const tick = 1 / Math.pow(10, pricePrecision);
        return Math.max(
            1,
            Math.min(10, Math.round((this.rollingATR / tick) * 2))
        );
    }

    getATR(): number {
        return this.rollingATR;
    }
}

/**
 * Tracks passive orderbook volume over time for refill logic.
 */
export class PassiveVolumeTracker {
    private passiveVolumeHistory = new TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >(900000); // 15 minutes TTL
    private lastSeenPassive = new TimeAwareCache<number, DepthLevel>(300000); // 5 minutes TTL

    /**
     * Update historical passive volume at price level.
     */
    updatePassiveVolume(price: number, bid: number, ask: number): void {
        let history = this.passiveVolumeHistory.get(price) || [];
        history.push({ time: Date.now(), bid, ask });
        if (history.length > 30) history = history.slice(-30);
        this.passiveVolumeHistory.set(price, history);
        this.lastSeenPassive.set(price, { bid, ask });
    }

    /**
     * Detects sustained refill of passive volume (iceberg/hiding).
     */
    hasPassiveRefilled(
        price: number,
        side: "buy" | "sell",
        windowMs = 15000
    ): boolean {
        const history = this.passiveVolumeHistory.get(price);
        if (!history || history.length < 3) return false;
        let refills = 0;
        let prev = side === "buy" ? history[0].ask : history[0].bid;
        for (const snap of history) {
            const qty = side === "buy" ? snap.ask : snap.bid;
            if (qty > prev * 1.15) refills++;
            prev = qty;
        }
        const now = Date.now();
        return refills >= 3 && now - history[0].time < windowMs;
    }

    /**
     * Checks if passive liquidity was refilled vs last seen.
     */
    checkRefillStatus(
        price: number,
        side: "buy" | "sell",
        currentPassive: number
    ): boolean {
        const lastLevel = this.lastSeenPassive.get(price);
        if (!lastLevel) return false;
        const previousQty = side === "buy" ? lastLevel.ask : lastLevel.bid;
        return currentPassive >= previousQty * 0.9;
    }
}

/**
 * Simple auto-calibrator for min volume thresholds.
 */
export class AutoCalibrator {
    private lastCalibrated = Date.now();
    private signalHistory: number[] = [];

    recordSignal(): void {
        this.signalHistory.push(Date.now());
    }

    shouldCalibrate(): boolean {
        const now = Date.now();
        return now - this.lastCalibrated >= 15 * 60 * 1000; // 15 minutes
    }

    calibrate(currentMinVolume: number): number {
        if (!this.shouldCalibrate()) return currentMinVolume;
        this.lastCalibrated = Date.now();
        const now = Date.now();
        this.signalHistory = this.signalHistory.filter(
            (t) => now - t < 30 * 60 * 1000
        );
        const recentSignals = this.signalHistory.length;
        if (recentSignals > 10) {
            const newVolume = Math.round(currentMinVolume * 1.2);
            console.log(
                "[AutoCalibrator] Too many signals, raising minAggVolume to",
                newVolume
            );
            return newVolume;
        } else if (recentSignals < 2) {
            const newVolume = Math.max(1, Math.round(currentMinVolume * 0.85));
            console.log(
                "[AutoCalibrator] Too few signals, lowering minAggVolume to",
                newVolume
            );
            return newVolume;
        }
        return currentMinVolume;
    }
}

/**
 * Manages confirmation/invalidation for pending signals.
 */
export class PriceConfirmationManager {
    private pendingDetections: PendingDetection[] = [];

    addPendingDetection(detection: PendingDetection): void {
        detection.status = "pending";
        this.pendingDetections.push(detection);
    }

    processPendingConfirmations(
        currentPrice: number,
        pricePrecision: number,
        minInitialMoveTicks: number,
        maxRevisitTicks: number,
        confirmationTimeoutMs: number,
        logger?: ISignalLogger,
        symbol?: string,
        eventType: "absorption" | "exhaustion" = "absorption"
    ): PendingDetection[] {
        const tick = 1 / Math.pow(10, pricePrecision);
        const now = Date.now();
        const confirmedDetections: PendingDetection[] = [];
        this.pendingDetections.forEach((abs) => {
            if (abs.status === "confirmed" || abs.status === "invalidated")
                return;
            const moveTicks = Math.abs(currentPrice - abs.price) / tick;

            // Confirmation
            if (
                (abs.side === "buy" &&
                    currentPrice >= abs.price + minInitialMoveTicks * tick) ||
                (abs.side === "sell" &&
                    currentPrice <= abs.price - minInitialMoveTicks * tick)
            ) {
                abs.confirmed = true;
                abs.status = "confirmed";
                confirmedDetections.push(abs);
                if (logger && symbol) {
                    logger.logEvent({
                        timestamp: new Date(now).toISOString(),
                        type: eventType,
                        symbol,
                        signalPrice: abs.price,
                        side: abs.side,
                        aggressiveVolume: abs.aggressive,
                        passiveVolume: abs.passive,
                        zone: abs.zone,
                        refilled: abs.refilled,
                        confirmed: true,
                        confirmationTime: new Date(now).toISOString(),
                        moveSizeTicks: moveTicks,
                        moveTimeMs: now - abs.time,
                        entryRecommended: true,
                    });
                }
                console.log(
                    `[PriceConfirmation] ${eventType} confirmed by price response at`,
                    abs.price
                );
                return;
            }

            // Invalidate by price revisit
            if (
                (abs.side === "buy" &&
                    currentPrice <= abs.price - maxRevisitTicks * tick) ||
                (abs.side === "sell" &&
                    currentPrice >= abs.price + maxRevisitTicks * tick)
            ) {
                abs.confirmed = false;
                abs.status = "invalidated";
                if (logger && symbol) {
                    logger.logEvent({
                        timestamp: new Date(now).toISOString(),
                        type: eventType,
                        symbol,
                        signalPrice: abs.price,
                        side: abs.side,
                        aggressiveVolume: abs.aggressive,
                        passiveVolume: abs.passive,
                        zone: abs.zone,
                        refilled: abs.refilled,
                        confirmed: false,
                        invalidationTime: new Date(now).toISOString(),
                        invalidationReason: `Price revisited ${eventType} level`,
                        outcome: "fail",
                    });
                }
                console.log(
                    `[PriceConfirmation] ${eventType} invalidated by price revisit at`,
                    abs.price
                );
                return;
            }

            // Timeout
            if (now - abs.time > confirmationTimeoutMs) {
                abs.confirmed = false;
                abs.status = "invalidated";
                if (logger && symbol) {
                    logger.logEvent({
                        timestamp: new Date(now).toISOString(),
                        type: eventType,
                        symbol,
                        signalPrice: abs.price,
                        side: abs.side,
                        aggressiveVolume: abs.aggressive,
                        passiveVolume: abs.passive,
                        zone: abs.zone,
                        refilled: abs.refilled,
                        confirmed: false,
                        invalidationTime: new Date(now).toISOString(),
                        invalidationReason: "Timeout (no move)",
                        outcome: "fail",
                    });
                }
                console.log(
                    `[PriceConfirmation] ${eventType} invalidated by timeout at`,
                    abs.price
                );
                return;
            }
        });
        // Remove processed detections
        this.pendingDetections = this.pendingDetections.filter(
            (abs) =>
                abs.status === "pending" &&
                now - abs.time < confirmationTimeoutMs
        );
        return confirmedDetections;
    }

    getPendingCount(): number {
        return this.pendingDetections.length;
    }
}

/**
 * Type guard for backlog request shape.
 */
export function isValidBacklogRequest(
    obj: unknown
): obj is { type: "backlog"; data?: { amount?: string | number } } {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "type" in obj &&
        (obj as { type: unknown }).type === "backlog"
    );
}

// utils.ts - Add profit calculation
export function calculateProfitTarget(
    entryPrice: number,
    side: "buy" | "sell",
    targetPercent: number = 0.015, // 1.5% default
    commissionRate: number = 0.001 // 0.1% per side
): number {
    const grossTarget = targetPercent + commissionRate * 2; // Cover round-trip

    if (side === "buy") {
        return entryPrice * (1 + grossTarget);
    } else {
        return entryPrice * (1 - grossTarget);
    }
}

export function calculateBreakeven(
    entryPrice: number,
    side: "buy" | "sell",
    commissionRate: number = 0.001
): number {
    const totalCommission = commissionRate * 2; // Round-trip

    if (side === "buy") {
        return entryPrice * (1 + totalCommission);
    } else {
        return entryPrice * (1 - totalCommission);
    }
}

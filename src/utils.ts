import { SpotWebsocketStreams } from "@binance/spot";
import { ISignalLogger } from "./signalLogger.js";

export function parseBool(
    val: string | undefined,
    defaultValue = false
): boolean {
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === "true";
}

export interface PendingDetection {
    time: number;
    price: number;
    side: "buy" | "sell";
    zone: number;
    trades: SpotWebsocketStreams.AggTradeResponse[];
    aggressive: number;
    passive: number | null;
    refilled: boolean;
    confirmed: boolean;
}

// Generic trade interface for exchange-agnostic support
export interface TradeData {
    price: number;
    quantity: number;
    timestamp: number;
    isMakerSell: boolean;
    originalTrade: SpotWebsocketStreams.AggTradeResponse;
}

export interface DepthLevel {
    bid: number;
    ask: number;
}

// Circular buffer for efficient trade storage
export class CircularBuffer<T> {
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
}

// Time-aware cache for automatic cleanup
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

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupInterval) return;

        this.lastCleanup = now;
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
    }

    size(): number {
        return this.cache.size;
    }
}

// Spoofing detection module
export class SpoofingDetector {
    private passiveChangeHistory = new TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >(300000); // 5 minutes TTL

    trackPassiveChange(price: number, bid: number, ask: number): void {
        const now = Date.now();
        let history = this.passiveChangeHistory.get(price) || [];

        history.push({ time: now, bid, ask });
        if (history.length > 10) {
            history = history.slice(-10);
        }

        this.passiveChangeHistory.set(price, history);
    }

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

// Adaptive zone calculation module
export class AdaptiveZoneCalculator {
    private priceWindow: number[] = [];
    private rollingATR = 0;
    private readonly atrLookback: number;

    constructor(atrLookback = 30) {
        this.atrLookback = atrLookback;
    }

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

export class PassiveVolumeTracker {
    private passiveVolumeHistory = new TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >(900000); // 15 minutes TTL
    private lastSeenPassive = new TimeAwareCache<number, DepthLevel>(300000); // 5 minutes TTL

    updatePassiveVolume(price: number, bid: number, ask: number): void {
        let history = this.passiveVolumeHistory.get(price) || [];
        history.push({ time: Date.now(), bid, ask });

        if (history.length > 30) {
            history = history.slice(-30);
        }

        this.passiveVolumeHistory.set(price, history);
        this.lastSeenPassive.set(price, { bid, ask });
    }

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

// Auto-calibration module
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

        // Clean old signals (last 30 minutes)
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

export class PriceConfirmationManager {
    private pendingDetections: PendingDetection[] = [];

    addPendingDetection(detection: PendingDetection): void {
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
            if (abs.confirmed) return;

            const moveTicks = Math.abs(currentPrice - abs.price) / tick;

            // Check for confirmation
            if (
                (abs.side === "buy" &&
                    currentPrice >= abs.price + minInitialMoveTicks * tick) ||
                (abs.side === "sell" &&
                    currentPrice <= abs.price - minInitialMoveTicks * tick)
            ) {
                abs.confirmed = true;
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

            // Check for invalidation by price revisit
            if (
                (abs.side === "buy" &&
                    currentPrice <= abs.price - maxRevisitTicks * tick) ||
                (abs.side === "sell" &&
                    currentPrice >= abs.price + maxRevisitTicks * tick)
            ) {
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

            // Check for timeout
            if (now - abs.time > confirmationTimeoutMs) {
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

        // Remove processed absorptions
        this.pendingDetections = this.pendingDetections.filter(
            (abs) => !abs.confirmed && now - abs.time < confirmationTimeoutMs
        );

        return confirmedDetections;
    }

    getPendingCount(): number {
        return this.pendingDetections.length;
    }
}

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

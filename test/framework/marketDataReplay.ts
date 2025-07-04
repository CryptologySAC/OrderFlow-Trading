// test/framework/marketDataReplay.ts

/**
 * Market Data Replay Framework
 *
 * Provides realistic market data replay capabilities for integration testing.
 * Supports historical trade data replay with proper timing and order book simulation.
 */

import { EventEmitter } from "events";
import type {
    EnrichedTradeEvent,
    PassiveLevel,
} from "../../src/types/marketEvents.js";
import type { ILogger } from "../../src/infrastructure/loggerInterface.js";

export interface MarketDataSnapshot {
    timestamp: number;
    trade?: {
        id: string;
        price: number;
        quantity: number;
        buyerIsMaker: boolean;
        timestamp: number;
    };
    orderBook?: {
        bids: Array<{ price: number; quantity: number }>;
        asks: Array<{ price: number; quantity: number }>;
        timestamp: number;
    };
}

export interface MarketScenario {
    name: string;
    description: string;
    symbol: string;
    startTime: number;
    endTime: number;
    expectedEvents: Array<{
        type:
            | "absorption"
            | "exhaustion"
            | "accumulation"
            | "distribution"
            | "deltaCVD";
        expectedTime: number;
        expectedPrice: number;
        expectedSide: "buy" | "sell";
        minimumConfidence: number;
        description: string;
    }>;
    data: MarketDataSnapshot[];
}

export interface ReplayOptions {
    speed: number; // 1.0 = real-time, 10.0 = 10x speed
    startTime?: number;
    endTime?: number;
    enableOrderBook: boolean;
    enableTiming: boolean; // If false, events are fired as fast as possible
}

export interface ReplayMetrics {
    startTime: number;
    endTime?: number;
    eventsProcessed: number;
    tradesProcessed: number;
    orderBookUpdates: number;
    averageLatency: number;
    maxLatency: number;
    memoryUsage: {
        start: number;
        current: number;
        peak: number;
    };
}

/**
 * Market Data Replay Engine
 *
 * Replays historical market data with realistic timing and order book simulation.
 * Designed for comprehensive integration testing of trading algorithms.
 */
export class MarketDataReplay extends EventEmitter {
    private scenario: MarketScenario | null = null;
    private isReplaying = false;
    private replayStartTime = 0;
    private currentDataIndex = 0;
    private metrics: ReplayMetrics;
    private logger: ILogger;

    constructor(logger: ILogger) {
        super();
        this.logger = logger;
        this.metrics = this.initializeMetrics();
    }

    /**
     * Load a market scenario for replay
     */
    public loadScenario(scenario: MarketScenario): void {
        this.scenario = scenario;
        this.currentDataIndex = 0;
        this.logger.info("Market scenario loaded", {
            component: "MarketDataReplay",
            scenarioName: scenario.name,
            dataPoints: scenario.data.length,
            timeRange: {
                start: scenario.startTime,
                end: scenario.endTime,
                duration: scenario.endTime - scenario.startTime,
            },
        });
    }

    /**
     * Start replaying the loaded scenario
     */
    public async startReplay(options: ReplayOptions): Promise<void> {
        if (!this.scenario) {
            throw new Error("No scenario loaded. Call loadScenario() first.");
        }

        if (this.isReplaying) {
            throw new Error("Replay already in progress");
        }

        this.isReplaying = true;
        this.replayStartTime = Date.now();
        this.metrics = this.initializeMetrics();
        this.currentDataIndex = 0;

        this.logger.info("Starting market data replay", {
            component: "MarketDataReplay",
            scenario: this.scenario.name,
            options,
            expectedEvents: this.scenario.expectedEvents.length,
        });

        this.emit("replayStart", {
            scenario: this.scenario.name,
            options,
            expectedDataPoints: this.scenario.data.length,
        });

        try {
            if (options.enableTiming) {
                await this.replayWithTiming(options);
            } else {
                await this.replayFastForward(options);
            }
        } catch (error) {
            this.logger.error("Replay failed", {
                component: "MarketDataReplay",
                error: error instanceof Error ? error.message : String(error),
                dataIndex: this.currentDataIndex,
            });
            this.emit("replayError", error);
            throw error;
        } finally {
            this.isReplaying = false;
            this.finalizeMetrics();
            this.emit("replayComplete", this.metrics);
        }
    }

    /**
     * Stop the current replay
     */
    public stopReplay(): void {
        if (this.isReplaying) {
            this.isReplaying = false;
            this.finalizeMetrics();
            this.logger.info("Market data replay stopped", {
                component: "MarketDataReplay",
                metrics: this.metrics,
            });
            this.emit("replayStopped", this.metrics);
        }
    }

    /**
     * Get current replay metrics
     */
    public getMetrics(): ReplayMetrics {
        return {
            ...this.metrics,
            memoryUsage: {
                ...this.metrics.memoryUsage,
                current: process.memoryUsage().heapUsed,
            },
        };
    }

    /**
     * Replay with realistic timing between events
     */
    private async replayWithTiming(options: ReplayOptions): Promise<void> {
        if (!this.scenario) return;

        const filteredData = this.filterDataByTimeRange(options);
        let lastEventTime = filteredData[0]?.timestamp || Date.now();

        for (let i = 0; i < filteredData.length && this.isReplaying; i++) {
            const snapshot = filteredData[i];
            this.currentDataIndex = i;

            // Calculate delay based on real-time differences and replay speed
            const realTimeDelta = snapshot.timestamp - lastEventTime;
            const replayDelay = Math.max(0, realTimeDelta / options.speed);

            if (replayDelay > 0) {
                await this.sleep(replayDelay);
            }

            await this.processSnapshot(snapshot);
            lastEventTime = snapshot.timestamp;

            // Update metrics periodically
            if (i % 100 === 0) {
                this.updateMetrics();
            }
        }
    }

    /**
     * Replay without timing delays (as fast as possible)
     */
    private async replayFastForward(options: ReplayOptions): Promise<void> {
        if (!this.scenario) return;

        const filteredData = this.filterDataByTimeRange(options);

        for (let i = 0; i < filteredData.length && this.isReplaying; i++) {
            const snapshot = filteredData[i];
            this.currentDataIndex = i;

            await this.processSnapshot(snapshot);

            // Update metrics periodically
            if (i % 1000 === 0) {
                this.updateMetrics();
                // Allow event loop to process
                await this.sleep(0);
            }
        }
    }

    /**
     * Process a single market data snapshot
     */
    private async processSnapshot(snapshot: MarketDataSnapshot): Promise<void> {
        const processingStart = performance.now();

        try {
            // Process trade data
            if (snapshot.trade) {
                const enrichedTrade = this.createEnrichedTradeEvent(snapshot);
                this.emit("trade", enrichedTrade);
                this.metrics.tradesProcessed++;
            }

            // Process order book data
            if (snapshot.orderBook) {
                this.emit("orderBook", snapshot.orderBook);
                this.metrics.orderBookUpdates++;
            }

            this.metrics.eventsProcessed++;

            // Track latency
            const processingTime = performance.now() - processingStart;
            this.updateLatencyMetrics(processingTime);
        } catch (error) {
            this.logger.error("Failed to process snapshot", {
                component: "MarketDataReplay",
                snapshot,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Create EnrichedTradeEvent from market data snapshot
     */
    private createEnrichedTradeEvent(
        snapshot: MarketDataSnapshot
    ): EnrichedTradeEvent {
        if (!snapshot.trade || !this.scenario) {
            throw new Error(
                "Invalid snapshot or scenario for trade event creation"
            );
        }

        // Create basic trade event
        const baseEvent: EnrichedTradeEvent = {
            tradeId: snapshot.trade.id,
            price: snapshot.trade.price,
            quantity: snapshot.trade.quantity,
            buyerIsMaker: snapshot.trade.buyerIsMaker,
            timestamp: snapshot.trade.timestamp,
            pair: this.scenario.symbol,

            // Add enriched data (can be enhanced with actual order book analysis)
            zonePassiveBidVolume: 0,
            zonePassiveAskVolume: 0,
            depthSnapshot: snapshot.orderBook
                ? this.createDepthSnapshot(snapshot.orderBook)
                : undefined,
        };

        return baseEvent;
    }

    /**
     * Create depth snapshot from order book data
     */
    private createDepthSnapshot(
        orderBook: NonNullable<MarketDataSnapshot["orderBook"]>
    ): Map<number, PassiveLevel> {
        const depthSnapshot = new Map<number, PassiveLevel>();

        // Process bids
        orderBook.bids.forEach((bid) => {
            depthSnapshot.set(bid.price, {
                bid: bid.quantity,
                ask: 0,
                addedBid: 0,
                consumedBid: 0,
                addedAsk: 0,
                consumedAsk: 0,
            });
        });

        // Process asks (merge with bids if same price level exists)
        orderBook.asks.forEach((ask) => {
            const existing = depthSnapshot.get(ask.price);
            if (existing) {
                existing.ask = ask.quantity;
            } else {
                depthSnapshot.set(ask.price, {
                    bid: 0,
                    ask: ask.quantity,
                    addedBid: 0,
                    consumedBid: 0,
                    addedAsk: 0,
                    consumedAsk: 0,
                });
            }
        });

        return depthSnapshot;
    }

    /**
     * Filter data by time range if specified
     */
    private filterDataByTimeRange(
        options: ReplayOptions
    ): MarketDataSnapshot[] {
        if (!this.scenario) return [];

        let data = this.scenario.data;

        if (options.startTime) {
            data = data.filter(
                (snapshot) => snapshot.timestamp >= options.startTime!
            );
        }

        if (options.endTime) {
            data = data.filter(
                (snapshot) => snapshot.timestamp <= options.endTime!
            );
        }

        return data.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Initialize replay metrics
     */
    private initializeMetrics(): ReplayMetrics {
        const initialMemory = process.memoryUsage().heapUsed;
        return {
            startTime: Date.now(),
            eventsProcessed: 0,
            tradesProcessed: 0,
            orderBookUpdates: 0,
            averageLatency: 0,
            maxLatency: 0,
            memoryUsage: {
                start: initialMemory,
                current: initialMemory,
                peak: initialMemory,
            },
        };
    }

    /**
     * Update latency tracking metrics
     */
    private updateLatencyMetrics(latency: number): void {
        this.metrics.maxLatency = Math.max(this.metrics.maxLatency, latency);

        // Update rolling average
        const totalEvents = this.metrics.eventsProcessed;
        this.metrics.averageLatency =
            (this.metrics.averageLatency * (totalEvents - 1) + latency) /
            totalEvents;
    }

    /**
     * Update general metrics
     */
    private updateMetrics(): void {
        const currentMemory = process.memoryUsage().heapUsed;
        this.metrics.memoryUsage.current = currentMemory;
        this.metrics.memoryUsage.peak = Math.max(
            this.metrics.memoryUsage.peak,
            currentMemory
        );
    }

    /**
     * Finalize metrics when replay completes
     */
    private finalizeMetrics(): void {
        this.metrics.endTime = Date.now();
        this.updateMetrics();

        this.logger.info("Replay metrics finalized", {
            component: "MarketDataReplay",
            metrics: this.metrics,
            duration: this.metrics.endTime - this.metrics.startTime,
            eventsPerSecond:
                this.metrics.eventsProcessed /
                ((this.metrics.endTime - this.metrics.startTime) / 1000),
        });
    }

    /**
     * Sleep utility for timing delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Market Scenario Builder
 *
 * Provides utilities for creating realistic market scenarios for testing.
 */
export class MarketScenarioBuilder {
    /**
     * Create an accumulation scenario
     */
    public static createAccumulationScenario(): MarketScenario {
        const basePrice = 65.5;
        const startTime = Date.now() - 300000; // 5 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Generate accumulation pattern: consistent buying pressure with price stability
        for (let i = 0; i < 100; i++) {
            const timestamp = startTime + i * 3000; // Every 3 seconds
            const price = basePrice + (Math.random() - 0.5) * 0.02; // Small price variance
            const quantity = 20 + Math.random() * 80; // 20-100 LTC trades
            const buyerIsMaker = Math.random() > 0.7; // 70% selling pressure (accumulation)

            data.push({
                timestamp,
                trade: {
                    id: `trade_${i}`,
                    price,
                    quantity,
                    buyerIsMaker,
                    timestamp,
                },
            });
        }

        return {
            name: "Institutional Accumulation",
            description:
                "Large institution accumulating position with price stability despite selling pressure",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 300000,
            expectedEvents: [
                {
                    type: "accumulation",
                    expectedTime: startTime + 150000, // Middle of scenario
                    expectedPrice: basePrice,
                    expectedSide: "buy",
                    minimumConfidence: 0.7,
                    description: "Accumulation zone formation expected",
                },
            ],
            data,
        };
    }

    /**
     * Create an exhaustion scenario
     */
    public static createExhaustionScenario(): MarketScenario {
        const basePrice = 66.0;
        const startTime = Date.now() - 180000; // 3 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Generate exhaustion pattern: increasing buy pressure leading to liquidity depletion
        for (let i = 0; i < 60; i++) {
            const timestamp = startTime + i * 3000;
            const priceIncrease = i * 0.01; // Gradual price increase
            const price = basePrice + priceIncrease;
            const quantity = 30 + i * 2; // Increasing trade sizes
            const buyerIsMaker = Math.random() > 0.8; // 80% buying pressure

            data.push({
                timestamp,
                trade: {
                    id: `exhaustion_${i}`,
                    price,
                    quantity,
                    buyerIsMaker,
                    timestamp,
                },
                orderBook: {
                    bids: [
                        {
                            price: price - 0.01,
                            quantity: Math.max(10, 100 - i),
                        },
                    ], // Decreasing liquidity
                    asks: [
                        {
                            price: price + 0.01,
                            quantity: Math.max(5, 50 - i * 0.8),
                        },
                    ],
                    timestamp,
                },
            });
        }

        return {
            name: "Liquidity Exhaustion",
            description:
                "Progressive liquidity depletion leading to exhaustion reversal",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 180000,
            expectedEvents: [
                {
                    type: "exhaustion",
                    expectedTime: startTime + 150000,
                    expectedPrice: basePrice + 0.5,
                    expectedSide: "sell", // Expect reversal
                    minimumConfidence: 0.8,
                    description:
                        "Ask-side exhaustion expected near end of pattern",
                },
            ],
            data,
        };
    }

    /**
     * Create a volume surge scenario for absorption testing
     */
    public static createVolumeSurgeScenario(): MarketScenario {
        const basePrice = 64.8;
        const startTime = Date.now() - 120000; // 2 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Normal trading for first half
        for (let i = 0; i < 30; i++) {
            const timestamp = startTime + i * 2000;
            const price = basePrice + (Math.random() - 0.5) * 0.01;
            const quantity = 5 + Math.random() * 15; // Normal volume

            data.push({
                timestamp,
                trade: {
                    id: `normal_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.5,
                    timestamp,
                },
            });
        }

        // Volume surge for second half with price efficiency test
        for (let i = 30; i < 60; i++) {
            const timestamp = startTime + i * 2000;
            const price = basePrice + (Math.random() - 0.5) * 0.005; // Reduced price movement
            const quantity = 80 + Math.random() * 120; // 4x volume surge

            data.push({
                timestamp,
                trade: {
                    id: `surge_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.3, // More selling pressure
                    timestamp,
                },
            });
        }

        return {
            name: "Volume Surge Absorption",
            description:
                "High volume surge with minimal price movement indicating absorption",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 120000,
            expectedEvents: [
                {
                    type: "absorption",
                    expectedTime: startTime + 90000,
                    expectedPrice: basePrice,
                    expectedSide: "buy",
                    minimumConfidence: 0.85,
                    description:
                        "Price efficiency absorption expected during volume surge",
                },
            ],
            data,
        };
    }

    /**
     * Create a flash crash scenario with aggressive selling followed by absorption
     */
    public static createFlashCrashScenario(): MarketScenario {
        const basePrice = 66.2;
        const startTime = Date.now() - 240000; // 4 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Phase 1: Normal trading (60 seconds)
        for (let i = 0; i < 20; i++) {
            const timestamp = startTime + i * 3000;
            const price = basePrice + (Math.random() - 0.5) * 0.01;
            const quantity = 8 + Math.random() * 12;

            data.push({
                timestamp,
                trade: {
                    id: `normal_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.5,
                    timestamp,
                },
            });
        }

        // Phase 2: Flash crash - aggressive selling (30 seconds)
        for (let i = 20; i < 30; i++) {
            const timestamp = startTime + i * 3000;
            const crashProgress = (i - 20) / 10; // 0 to 1 progress
            const price = basePrice - crashProgress * 0.15; // Drop $0.15
            const quantity = 150 + Math.random() * 200; // Large sell orders

            data.push({
                timestamp,
                trade: {
                    id: `crash_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.85, // 85% selling pressure
                    timestamp,
                },
                orderBook: {
                    bids: [
                        {
                            price: price - 0.01,
                            quantity: Math.max(5, 50 - (i - 20) * 4),
                        },
                        {
                            price: price - 0.02,
                            quantity: Math.max(3, 30 - (i - 20) * 2),
                        },
                    ],
                    asks: [
                        { price: price + 0.01, quantity: 200 + (i - 20) * 50 },
                        { price: price + 0.02, quantity: 150 + (i - 20) * 30 },
                    ],
                    timestamp,
                },
            });
        }

        // Phase 3: Institutional absorption - buying the dip (90 seconds)
        for (let i = 30; i < 60; i++) {
            const timestamp = startTime + i * 3000;
            const absorptionProgress = (i - 30) / 30; // 0 to 1 progress
            const price = basePrice - 0.15 + absorptionProgress * 0.08; // Partial recovery
            const quantity = 80 + Math.random() * 120; // Institutional size

            data.push({
                timestamp,
                trade: {
                    id: `absorption_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.25, // 75% buying pressure
                    timestamp,
                },
            });
        }

        return {
            name: "Flash Crash with Institutional Absorption",
            description:
                "Sudden price drop followed by institutional buying and absorption",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 240000,
            expectedEvents: [
                {
                    type: "exhaustion",
                    expectedTime: startTime + 90000, // During crash
                    expectedPrice: basePrice - 0.12,
                    expectedSide: "sell",
                    minimumConfidence: 0.8,
                    description:
                        "Sell-side exhaustion expected during flash crash",
                },
                {
                    type: "absorption",
                    expectedTime: startTime + 150000, // During recovery
                    expectedPrice: basePrice - 0.08,
                    expectedSide: "buy",
                    minimumConfidence: 0.85,
                    description:
                        "Institutional absorption during price recovery",
                },
            ],
            data,
        };
    }

    /**
     * Create a manipulation scenario with spoof orders and fake breakouts
     */
    public static createManipulationScenario(): MarketScenario {
        const basePrice = 65.75;
        const startTime = Date.now() - 360000; // 6 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Phase 1: Setup - normal trading (120 seconds)
        for (let i = 0; i < 40; i++) {
            const timestamp = startTime + i * 3000;
            const price = basePrice + (Math.random() - 0.5) * 0.015;
            const quantity = 10 + Math.random() * 20;

            data.push({
                timestamp,
                trade: {
                    id: `setup_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.5,
                    timestamp,
                },
            });
        }

        // Phase 2: Manipulation attempt - fake breakout with spoof orders (60 seconds)
        for (let i = 40; i < 60; i++) {
            const timestamp = startTime + i * 3000;
            const manipulationProgress = (i - 40) / 20;
            const price = basePrice + manipulationProgress * 0.05; // Fake upward move

            // Alternating pattern: small real trades and large spoof orders
            const isRealTrade = i % 3 !== 0;
            const quantity = isRealTrade
                ? 5 + Math.random() * 10
                : 300 + Math.random() * 500;

            data.push({
                timestamp,
                trade: {
                    id: `manip_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.7, // Fake buying pressure
                    timestamp,
                },
                orderBook: {
                    bids: [
                        // Large fake bid orders that will be cancelled
                        {
                            price: price - 0.01,
                            quantity: isRealTrade ? 50 : 1000,
                        },
                        {
                            price: price - 0.02,
                            quantity: isRealTrade ? 30 : 800,
                        },
                    ],
                    asks: [
                        {
                            price: price + 0.01,
                            quantity: 20 + Math.random() * 30,
                        },
                        {
                            price: price + 0.02,
                            quantity: 15 + Math.random() * 25,
                        },
                    ],
                    timestamp,
                },
            });
        }

        // Phase 3: Manipulation failure - real selling pressure emerges (120 seconds)
        for (let i = 60; i < 100; i++) {
            const timestamp = startTime + i * 3000;
            const failureProgress = (i - 60) / 40;
            const price = basePrice + 0.05 - failureProgress * 0.08; // Price collapse
            const quantity = 40 + Math.random() * 80; // Real selling volume

            data.push({
                timestamp,
                trade: {
                    id: `failure_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.8, // Heavy selling
                    timestamp,
                },
            });
        }

        return {
            name: "Market Manipulation with Failed Breakout",
            description:
                "Attempted price manipulation followed by genuine selling pressure",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 360000,
            expectedEvents: [
                {
                    type: "absorption",
                    expectedTime: startTime + 180000, // During manipulation
                    expectedPrice: basePrice + 0.03,
                    expectedSide: "buy",
                    minimumConfidence: 0.7, // Lower confidence due to manipulation
                    description:
                        "Potential false absorption during manipulation phase",
                },
                {
                    type: "exhaustion",
                    expectedTime: startTime + 280000, // During failure
                    expectedPrice: basePrice - 0.02,
                    expectedSide: "sell",
                    minimumConfidence: 0.85,
                    description: "Genuine exhaustion as manipulation fails",
                },
            ],
            data,
        };
    }

    /**
     * Create a complex multi-phase scenario with multiple signal types
     */
    public static createComplexMarketScenario(): MarketScenario {
        const basePrice = 64.9;
        const startTime = Date.now() - 480000; // 8 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Phase 1: Accumulation phase (120 seconds)
        for (let i = 0; i < 40; i++) {
            const timestamp = startTime + i * 3000;
            const price = basePrice + (Math.random() - 0.5) * 0.008; // Very tight range
            const quantity = 15 + Math.random() * 25;

            data.push({
                timestamp,
                trade: {
                    id: `accum_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.65, // 65% selling into accumulation
                    timestamp,
                },
            });
        }

        // Phase 2: Breakout with volume surge (60 seconds)
        for (let i = 40; i < 60; i++) {
            const timestamp = startTime + i * 3000;
            const breakoutProgress = (i - 40) / 20;
            const price = basePrice + breakoutProgress * 0.06; // $0.06 breakout
            const quantity = 100 + Math.random() * 150; // High volume breakout

            data.push({
                timestamp,
                trade: {
                    id: `breakout_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.8, // Strong buying
                    timestamp,
                },
            });
        }

        // Phase 3: Failed breakout and exhaustion (60 seconds)
        for (let i = 60; i < 80; i++) {
            const timestamp = startTime + i * 3000;
            const failureProgress = (i - 60) / 20;
            const price = basePrice + 0.06 - failureProgress * 0.04; // Pullback
            const quantity = 80 + Math.random() * 120;

            data.push({
                timestamp,
                trade: {
                    id: `failure_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.75, // Continued selling
                    timestamp,
                },
            });
        }

        // Phase 4: Support test and absorption (120 seconds)
        for (let i = 80; i < 120; i++) {
            const timestamp = startTime + i * 3000;
            const supportLevel = basePrice + 0.01; // Near original level
            const price = supportLevel + (Math.random() - 0.5) * 0.006; // Testing support
            const quantity = 60 + Math.random() * 100;

            data.push({
                timestamp,
                trade: {
                    id: `support_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.4, // Mixed but buying bias
                    timestamp,
                },
            });
        }

        return {
            name: "Complex Multi-Phase Market Cycle",
            description:
                "Complete market cycle: accumulation → breakout → failure → support test",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 480000,
            expectedEvents: [
                {
                    type: "accumulation",
                    expectedTime: startTime + 60000,
                    expectedPrice: basePrice,
                    expectedSide: "buy",
                    minimumConfidence: 0.75,
                    description: "Accumulation zone during tight range trading",
                },
                {
                    type: "absorption",
                    expectedTime: startTime + 150000,
                    expectedPrice: basePrice + 0.03,
                    expectedSide: "buy",
                    minimumConfidence: 0.8,
                    description: "Volume absorption during breakout attempt",
                },
                {
                    type: "exhaustion",
                    expectedTime: startTime + 240000,
                    expectedPrice: basePrice + 0.02,
                    expectedSide: "sell",
                    minimumConfidence: 0.85,
                    description: "Exhaustion as breakout fails",
                },
                {
                    type: "absorption",
                    expectedTime: startTime + 360000,
                    expectedPrice: basePrice + 0.01,
                    expectedSide: "buy",
                    minimumConfidence: 0.9,
                    description: "Strong absorption at support retest",
                },
            ],
            data,
        };
    }

    /**
     * Create a high-frequency trading scenario with micro-movements
     */
    public static createHighFrequencyScenario(): MarketScenario {
        const basePrice = 65.4;
        const startTime = Date.now() - 90000; // 1.5 minutes ago
        const data: MarketDataSnapshot[] = [];

        // Generate high-frequency data (500ms intervals)
        for (let i = 0; i < 180; i++) {
            const timestamp = startTime + i * 500; // Every 500ms
            const microMovement = Math.sin(i / 10) * 0.001; // Small oscillations
            const price =
                basePrice + microMovement + (Math.random() - 0.5) * 0.0005;
            const quantity = 1 + Math.random() * 5; // Small HFT sizes

            data.push({
                timestamp,
                trade: {
                    id: `hft_${i}`,
                    price,
                    quantity,
                    buyerIsMaker: Math.random() > 0.5,
                    timestamp,
                },
            });

            // Occasionally inject larger institutional trades
            if (i % 20 === 0) {
                data.push({
                    timestamp: timestamp + 100,
                    trade: {
                        id: `inst_${i}`,
                        price: price + (Math.random() - 0.5) * 0.002,
                        quantity: 50 + Math.random() * 100,
                        buyerIsMaker: Math.random() > 0.6,
                        timestamp: timestamp + 100,
                    },
                });
            }
        }

        return {
            name: "High-Frequency Trading Environment",
            description:
                "Dense HFT activity with occasional institutional trades",
            symbol: "LTCUSDT",
            startTime,
            endTime: startTime + 90000,
            expectedEvents: [
                {
                    type: "deltaCVD",
                    expectedTime: startTime + 45000,
                    expectedPrice: basePrice,
                    expectedSide: "buy",
                    minimumConfidence: 0.6,
                    description: "CVD signals in high-frequency environment",
                },
            ],
            data,
        };
    }
}

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AbsorptionDetector } from "../src/indicators/absorptionDetector";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import { OrderBookState } from "../src/market/orderBookState";
import type { AggressiveTrade } from "../src/types/marketEvents";
import type { ILogger } from "../src/infrastructure/loggerInterface";

describe("AbsorptionDetector - Spoofing Detection", () => {
    let detector: AbsorptionDetector;
    let logger: ILogger;
    let metrics: MetricsCollector;
    let spoofingDetector: SpoofingDetector;
    let orderBook: OrderBookState;
    let mockCallback: vi.MockedFunction<any>;

    beforeEach(() => {
        mockCallback = vi.fn();
        logger = new WorkerLogger();
        metrics = new MetricsCollector();
        spoofingDetector = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
            wasSpoofed: vi.fn().mockReturnValue(false),
            trackPassiveChange: vi.fn(),
        } as any;
        orderBook = {
            getLevel: vi.fn().mockReturnValue({ bid: 100, ask: 100 }),
            getCurrentSpread: vi.fn().mockReturnValue({ spread: 0.01 }),
        } as any;

        detector = new AbsorptionDetector(
            "test-absorption",
            {
                windowMs: 60000,
                minAggVolume: 100,
                absorptionThreshold: 0.7,
                pricePrecision: 2,
                features: {
                    spoofingDetection: true,
                },
            },
            orderBook,
            logger,
            spoofingDetector,
            metrics
        );

        // Register callback manually since constructor doesn't take it anymore
        detector.on("signal", mockCallback);
    });

    it("should detect absorption spoofing patterns", () => {
        const baseTimestamp = Date.now();
        const price = 100.5;

        // Create uniform trades at exact intervals with similar volumes (spoofing pattern)
        const spoofingTrades: AggressiveTrade[] = [];
        for (let i = 0; i < 5; i++) {
            spoofingTrades.push({
                price,
                quantity: 50.1 + i * 0.02, // Very similar volumes
                timestamp: baseTimestamp + i * 500, // Uniform 500ms intervals
                originalTrade: {
                    a: i,
                    p: price.toString(),
                    q: (50.1 + i * 0.02).toString(),
                    f: i,
                    l: i,
                    T: baseTimestamp + i * 500,
                    m: false,
                    M: true,
                },
            });
        }

        // Add trades to detector's internal trade list
        spoofingTrades.forEach((trade) => {
            (detector as any).addTrade({
                price: trade.price,
                quantity: trade.quantity,
                timestamp: trade.timestamp,
                tradeId: trade.originalTrade.a,
                buyerIsMaker: trade.originalTrade.m,
            });
        });

        // Test the spoofing detection method directly
        const isSpoofing = (detector as any).detectAbsorptionSpoofing(
            price,
            "buy",
            1000, // Large aggressive volume
            baseTimestamp + 4 * 500
        );

        expect(isSpoofing).toBe(true);
    });

    it("should not flag normal trading patterns as spoofing", () => {
        const baseTimestamp = Date.now();
        const price = 100.5;

        // Create normal trading pattern with varied timing and volumes
        const normalTrades: AggressiveTrade[] = [
            {
                price,
                quantity: 45.2,
                timestamp: baseTimestamp,
                originalTrade: {
                    a: 1,
                    p: price.toString(),
                    q: "45.2",
                    f: 1,
                    l: 1,
                    T: baseTimestamp,
                    m: false,
                    M: true,
                },
            },
            {
                price,
                quantity: 67.8,
                timestamp: baseTimestamp + 1200, // Irregular timing
                originalTrade: {
                    a: 2,
                    p: price.toString(),
                    q: "67.8",
                    f: 2,
                    l: 2,
                    T: baseTimestamp + 1200,
                    m: false,
                    M: true,
                },
            },
            {
                price,
                quantity: 23.5,
                timestamp: baseTimestamp + 2800, // Irregular timing
                originalTrade: {
                    a: 3,
                    p: price.toString(),
                    q: "23.5",
                    f: 3,
                    l: 3,
                    T: baseTimestamp + 2800,
                    m: false,
                    M: true,
                },
            },
            {
                price,
                quantity: 89.1,
                timestamp: baseTimestamp + 5500, // Irregular timing
                originalTrade: {
                    a: 4,
                    p: price.toString(),
                    q: "89.1",
                    f: 4,
                    l: 4,
                    T: baseTimestamp + 5500,
                    m: false,
                    M: true,
                },
            },
        ];

        // Add trades to detector's internal trade list
        normalTrades.forEach((trade) => {
            (detector as any).addTrade({
                price: trade.price,
                quantity: trade.quantity,
                timestamp: trade.timestamp,
                tradeId: trade.originalTrade.a,
                buyerIsMaker: trade.originalTrade.m,
            });
        });

        // Test the spoofing detection method
        const isSpoofing = (detector as any).detectAbsorptionSpoofing(
            price,
            "buy",
            200, // Reasonable aggressive volume
            baseTimestamp + 5500
        );

        expect(isSpoofing).toBe(false);
    });

    it("should handle insufficient trade data gracefully", () => {
        const baseTimestamp = Date.now();
        const price = 100.5;

        // Only 2 trades (less than minimum of 3)
        const fewTrades: AggressiveTrade[] = [
            {
                price,
                quantity: 50.0,
                timestamp: baseTimestamp,
                originalTrade: {
                    a: 1,
                    p: price.toString(),
                    q: "50.0",
                    f: 1,
                    l: 1,
                    T: baseTimestamp,
                    m: false,
                    M: true,
                },
            },
            {
                price,
                quantity: 50.0,
                timestamp: baseTimestamp + 500,
                originalTrade: {
                    a: 2,
                    p: price.toString(),
                    q: "50.0",
                    f: 2,
                    l: 2,
                    T: baseTimestamp + 500,
                    m: false,
                    M: true,
                },
            },
        ];

        fewTrades.forEach((trade) => {
            (detector as any).addTrade({
                price: trade.price,
                quantity: trade.quantity,
                timestamp: trade.timestamp,
                tradeId: trade.originalTrade.a,
                buyerIsMaker: trade.originalTrade.m,
            });
        });

        const isSpoofing = (detector as any).detectAbsorptionSpoofing(
            price,
            "buy",
            1000,
            baseTimestamp + 500
        );

        expect(isSpoofing).toBe(false);
    });
});

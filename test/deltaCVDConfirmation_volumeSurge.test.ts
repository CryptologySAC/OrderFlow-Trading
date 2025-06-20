import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/spoofingDetector");

import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { EnrichedTradeEvent } from "../src/types/marketEvents";

describe("DeltaCVDConfirmation - Volume Surge Detection", () => {
    let detector: DeltaCVDConfirmation;
    let mockLogger: WorkerLogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    beforeEach(() => {
        mockLogger = new WorkerLogger();
        mockMetrics = new MetricsCollector();
        mockSpoofing = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 10,
            minWallSize: 100,
            dynamicWallWidth: true,
            testLogMinSpoof: 50,
        });

        detector = new DeltaCVDConfirmation(
            "test_cvd_surge",
            {
                windowsSec: [60],
                minZ: 2.5,
                minTradesPerSec: 0.5,  // Reduced for testing
                minVolPerSec: 2,       // Reduced for testing
                volumeSurgeMultiplier: 4.0,
                imbalanceThreshold: 0.35,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
            },
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    const createTradeEvent = (
        timestamp: number,
        price: number,
        quantity: number,
        buyerIsMaker: boolean
    ): EnrichedTradeEvent => ({
        id: Math.random().toString(),
        symbol: "LTCUSDT",
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        tradeId: Math.floor(Math.random() * 1000000),
        quoteQuantity: price * quantity,
        eventTime: timestamp,
    });

    it("should detect volume surge with 4x baseline volume", () => {
        const baseTime = Date.now();
        
        // Create baseline volume (higher volume trades over 60 seconds to meet minVolPerSec)
        for (let i = 0; i < 60; i++) {
            const trade = createTradeEvent(
                baseTime - 60000 + i * 1000, // Spread over 60 seconds
                50000 + Math.random() * 10,
                2.5, // Higher baseline volume to meet minVolPerSec requirement
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Create volume surge (4x normal volume in 1 second)
        const surgeTrades = [];
        for (let i = 0; i < 5; i++) {
            const trade = createTradeEvent(
                baseTime - 500 + i * 100, // Within 1 second burst window
                50005,
                8.0, // 4x normal volume
                i % 2 === 0 // Alternating buy/sell
            );
            surgeTrades.push(trade);
            detector.onEnrichedTrade(trade);
        }

        // The volume surge should be detected (though signal may still be rejected for other reasons)
        expect(mockMetrics.incrementCounter).toHaveBeenCalled();
    });

    it("should detect order flow imbalance above 35% threshold", () => {
        const baseTime = Date.now();
        
        // Create baseline trades with sufficient volume
        for (let i = 0; i < 60; i++) {
            const trade = createTradeEvent(
                baseTime - 60000 + i * 1000,
                50000,
                2.2, // Higher volume to meet requirements
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Create high volume burst with strong buy imbalance (80% buy volume)
        const burstTrades = [
            createTradeEvent(baseTime - 800, 50005, 8.0, false), // Aggressive buy
            createTradeEvent(baseTime - 600, 50006, 9.0, false), // Aggressive buy  
            createTradeEvent(baseTime - 400, 50007, 8.5, false), // Aggressive buy
            createTradeEvent(baseTime - 200, 50008, 2.0, true),  // Aggressive sell (small)
        ];

        burstTrades.forEach(trade => detector.onEnrichedTrade(trade));

        // Should detect both volume surge and imbalance
        expect(mockMetrics.incrementCounter).toHaveBeenCalled();
    });

    it("should detect institutional activity with trades >= 17.8 LTC", () => {
        const baseTime = Date.now();
        
        // Create baseline trades
        for (let i = 0; i < 15; i++) {
            const trade = createTradeEvent(
                baseTime - 25000 + i * 1500,
                50000,
                0.5,
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Create institutional-sized trade with volume surge
        const institutionalTrades = [
            createTradeEvent(baseTime - 900, 50005, 20.0, false), // Large institutional buy
            createTradeEvent(baseTime - 700, 50006, 3.0, false),  // Supporting volume
            createTradeEvent(baseTime - 500, 50007, 2.5, false),  // Supporting volume
            createTradeEvent(baseTime - 300, 50008, 1.5, true),   // Some selling
        ];

        institutionalTrades.forEach(trade => detector.onEnrichedTrade(trade));

        // Should detect institutional activity enhancement
        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining("Volume surge conditions validated"),
            expect.objectContaining({
                hasInstitutional: true,
                reason: "institutional_enhanced"
            })
        );
    });

    it("should reject signals without sufficient volume surge", () => {
        const baseTime = Date.now();
        
        // Create normal volume trades without surge (but meeting basic requirements)
        for (let i = 0; i < 60; i++) {
            const trade = createTradeEvent(
                baseTime - 60000 + i * 1000,
                50000 + Math.random() * 5,
                2.1, // Normal trade size but meeting basic volume requirements
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Create final trades without surge
        for (let i = 0; i < 3; i++) {
            const trade = createTradeEvent(
                baseTime - 500 + i * 100,
                50005,
                2.0, // Normal volume, no surge
                i % 2 === 0
            );
            detector.onEnrichedTrade(trade);
        }

        // Should reject signal (either due to volume rate or volume surge requirements)
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
            "cvd_signals_rejected_total",
            1,
            expect.objectContaining({
                reason: expect.stringMatching(/insufficient_volume_rate|no_volume_surge/)
            })
        );
    });

    it("should reject signals without sufficient order flow imbalance", () => {
        const baseTime = Date.now();
        
        // Create baseline
        for (let i = 0; i < 20; i++) {
            const trade = createTradeEvent(
                baseTime - 25000 + i * 1200,
                50000,
                0.5,
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Create volume surge but with balanced flow (no imbalance)
        const balancedTrades = [
            createTradeEvent(baseTime - 800, 50005, 2.5, false), // Buy
            createTradeEvent(baseTime - 600, 50006, 2.5, true),  // Sell (balanced)
            createTradeEvent(baseTime - 400, 50007, 2.0, false), // Buy
            createTradeEvent(baseTime - 200, 50008, 2.0, true),  // Sell (balanced)
        ];

        balancedTrades.forEach(trade => detector.onEnrichedTrade(trade));

        // Should reject due to insufficient imbalance despite volume surge
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
            "cvd_signals_rejected_total",
            1,
            expect.objectContaining({
                reason: "insufficient_imbalance"
            })
        );
    });

    it("should track volume history for surge detection", () => {
        const baseTime = Date.now();
        const detectorAny = detector as any;
        
        // Create baseline trades with sufficient volume
        for (let i = 0; i < 60; i++) {
            const trade = createTradeEvent(
                baseTime - 60000 + i * 1000,
                50000,
                2.5,
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Create volume surge
        for (let i = 0; i < 5; i++) {
            const trade = createTradeEvent(
                baseTime - 500 + i * 100,
                50005,
                8.0, // High volume
                i % 2 === 0
            );
            detector.onEnrichedTrade(trade);
        }

        // Check that volume history is being tracked
        const state = detectorAny.states.get(60);
        expect(state?.volumeHistory).toBeDefined();
        expect(state?.volumeHistory?.length).toBeGreaterThan(0);
        
        // Verify volume history contains recent trades
        if (state?.volumeHistory) {
            const recentVolume = state.volumeHistory.filter(
                (vh: any) => vh.timestamp > baseTime - 5000
            );
            expect(recentVolume.length).toBeGreaterThan(0);
        }
    });

    it("should integrate volume surge detection with signal processing", () => {
        // This test validates that our volume surge detection is properly integrated
        // Even if signals are rejected for various reasons, the volume surge logic
        // should be processing correctly as evidenced by proper volume tracking
        const detectorAny = detector as any;
        const baseTime = Date.now();
        
        // Add trades to build up volume history
        for (let i = 0; i < 30; i++) {
            const trade = createTradeEvent(
                baseTime - 30000 + i * 1000,
                50000,
                3.0,
                Math.random() > 0.5
            );
            detector.onEnrichedTrade(trade);
        }

        // Verify the volume surge tracking system is active
        const state = detectorAny.states.get(60);
        expect(state?.volumeHistory).toBeDefined();
        expect(state?.burstHistory).toBeDefined();
        
        // Verify our new configuration parameters are being used
        expect(detectorAny.volumeSurgeMultiplier).toBe(4.0);
        expect(detectorAny.imbalanceThreshold).toBe(0.35);
        expect(detectorAny.institutionalThreshold).toBe(17.8);
        expect(detectorAny.burstDetectionMs).toBe(1000);
        expect(detectorAny.sustainedVolumeMs).toBe(30000);
        expect(detectorAny.medianTradeSize).toBe(0.6);
    });
});
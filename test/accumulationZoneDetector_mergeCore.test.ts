import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies BEFORE imports
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/trading/zoneManager", () => {
    return {
        ZoneManager: vi.fn().mockImplementation(() => {
            const mockZones = new Map();
            let zoneIdCounter = 0;

            return {
                zones: mockZones,
                createZone: vi
                    .fn()
                    .mockImplementation(
                        (type, symbol, trade, zoneDetection) => {
                            const zoneId = `${type}_${symbol}_${Date.now()}`;
                            const zone = {
                                id: zoneId,
                                type: type,
                                symbol: symbol,
                                startTime: trade.timestamp,
                                priceRange: {
                                    min:
                                        zoneDetection.priceRange?.min ||
                                        trade.price,
                                    max:
                                        zoneDetection.priceRange?.max ||
                                        trade.price,
                                    center: trade.price,
                                    width: 0.01,
                                },
                                totalVolume: zoneDetection.totalVolume || 0,
                                averageOrderSize:
                                    zoneDetection.averageOrderSize || 0,
                                tradeCount: zoneDetection.tradeCount || 1,
                                timeInZone: 0,
                                intensity: zoneDetection.intensity || 0,
                                strength: zoneDetection.initialStrength || 0.5,
                                completion: zoneDetection.completion || 0.8,
                                confidence: zoneDetection.confidence || 0.6,
                                significance: "moderate",
                                isActive: true,
                                lastUpdate: trade.timestamp,
                                strengthHistory: [],
                                supportingFactors:
                                    zoneDetection.supportingFactors || {},
                                endTime: null,
                            };
                            mockZones.set(zoneId, zone);
                            // Zone created successfully
                            return zone;
                        }
                    ),
                getActiveZones: vi.fn().mockImplementation((symbol) => {
                    const activeZones = Array.from(mockZones.values()).filter(
                        (zone) => {
                            if (symbol && zone.symbol !== symbol) {
                                return false;
                            }
                            return zone.isActive;
                        }
                    );
                    // Return filtered active zones
                    return activeZones;
                }),
                getZonesNearPrice: vi
                    .fn()
                    .mockImplementation((symbol, price, tolerance) => {
                        return Array.from(mockZones.values()).filter((zone) => {
                            if (zone.symbol !== symbol) return false;
                            const priceRange = zone.priceRange;
                            if (!priceRange) return false;
                            const minPrice =
                                priceRange.center * (1 - tolerance);
                            const maxPrice =
                                priceRange.center * (1 + tolerance);
                            return (
                                price >= minPrice &&
                                price <= maxPrice &&
                                zone.isActive
                            );
                        });
                    }),
                updateZone: vi.fn().mockImplementation((zoneId, trade) => {
                    const zone = mockZones.get(zoneId);
                    if (zone) {
                        zone.lastUpdate = trade.timestamp;
                        zone.totalVolume += trade.quantity || 0;
                        zone.tradeCount = (zone.tradeCount || 0) + 1;
                        if (zone.priceRange && trade.price) {
                            zone.priceRange.min = Math.min(
                                zone.priceRange.min,
                                trade.price
                            );
                            zone.priceRange.max = Math.max(
                                zone.priceRange.max,
                                trade.price
                            );
                            zone.priceRange.center =
                                (zone.priceRange.min + zone.priceRange.max) / 2;
                        }
                        return {
                            updateType: "zone_updated",
                            zone: zone,
                            significance: "medium",
                            timestamp: trade.timestamp,
                        };
                    }
                    return null;
                }),
                expandZoneRange: vi.fn().mockImplementation((zoneId, price) => {
                    const zone = mockZones.get(zoneId);
                    if (zone && zone.priceRange) {
                        zone.priceRange.min = Math.min(
                            zone.priceRange.min,
                            price
                        );
                        zone.priceRange.max = Math.max(
                            zone.priceRange.max,
                            price
                        );
                        zone.priceRange.center =
                            (zone.priceRange.min + zone.priceRange.max) / 2;
                        return true;
                    }
                    return false;
                }),
                on: vi.fn(),
                emit: vi.fn(),
                clearAllZones: () => mockZones.clear(),
            };
        }),
    };
});

import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ZoneDetectorConfig } from "../src/types/zoneTypes.js";

describe("AccumulationZoneDetector - Core Merge Functionality", () => {
    let detector: AccumulationZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;

    beforeEach(() => {
        // Clear zone manager between tests using the mock helper
        vi.clearAllMocks();

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn().mockImplementation((message, data) => {
                // Log zone formation debug to understand why first zone fails
                if (
                    message.includes("checkForZoneFormation") ||
                    message.includes("Starting candidate loop") ||
                    message.includes("Processing candidate") ||
                    message.includes("After candidate loop") ||
                    message.includes("Best candidate selected") ||
                    message.includes("About to create zone") ||
                    message.includes("Zone creation result") ||
                    message.includes("Zone created successfully") ||
                    message.includes("Zone formation complete") ||
                    message.includes("Checking zone invalidation") ||
                    message.includes("Zone invalidated") ||
                    message.includes("Evaluating candidate") ||
                    message.includes("failed") ||
                    message.includes("rejected") ||
                    message.includes("Creating zone detection data") ||
                    message.includes("Created new candidate") ||
                    message.includes("About to call") ||
                    message.includes("returned") ||
                    message.includes("New zone created") ||
                    message.includes("best candidate") ||
                    message.includes("institutional") ||
                    message.includes("Checking for nearby zones") ||
                    message.includes("Attempting merge") ||
                    message.includes("Merged candidate") ||
                    message.includes("nearby zones") ||
                    message.includes("merge") ||
                    message.includes("invalidation") ||
                    message.includes("invalidated") ||
                    message.includes("willInvalidate")
                ) {
                    console.log(
                        `[DEBUG] ${message}`,
                        JSON.stringify(data, null, 2)
                    );
                }
            }),
        } as ILogger;

        mockMetrics = new MetricsCollector();

        // Use highly permissive config to test merge logic specifically
        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 60000, // 1 minute - reduced for faster testing
            minZoneVolume: 100, // Reduced from 200 to allow zone formation
            minTradeCount: 3, // Reduced from 6 to allow reliable zone formation
            maxPriceDeviation: 0.05, // 5% - more permissive for testing
            minZoneStrength: 0.05, // VERY LOW: Even lower for test zone formation
            strengthChangeThreshold: 0.15,
            minSellRatio: 0.4, // 40% sell ratio - more permissive than 50%
        };

        detector = new AccumulationZoneDetector(
            "test-merge-core",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );

        // Clear any existing zones from previous tests
        // Zones are cleared by vi.clearAllMocks() above
    });

    describe("Zone Merge Logic Validation", () => {
        it("should properly update existing zone when merge occurs", () => {
            const baseTime = 1000000; // Fixed timestamp to avoid Date.now() inconsistencies
            const basePrice = 50000;

            // Step 1: Create first zone with concentrated trades at same price
            const firstZoneTrades = createConcentratedTrades(
                basePrice,
                baseTime,
                20, // More trades for better institutional scoring
                0.8
            );
            firstZoneTrades.forEach((trade) => detector.analyze(trade));

            // Trigger first zone formation after sufficient duration
            // Trades span 57 seconds (19 * 3s), so we need to wait a bit more
            const zone1Trigger = createTrade(
                basePrice,
                baseTime + 61000, // 61 seconds after first trade, candidate exists for 61s
                true,
                100
            );
            const result1 = detector.analyze(zone1Trigger);

            // Verify first zone created - check activeZones not result.updates
            const zonesAfterFirst = detector.getActiveZones();
            console.log("Zones after first trigger:", zonesAfterFirst.length);
            console.log("Result1 updates:", result1.updates.length);
            console.log(
                "Zone1 trigger timestamp:",
                zone1Trigger.timestamp,
                "Base time:",
                baseTime
            );

            // Debug: List all candidates
            const candidates = (detector as any).candidates;
            console.log("Candidates after first trigger:");
            for (const [price, candidate] of candidates) {
                console.log(
                    `  Price ${price}: startTime=${candidate.startTime}, volume=${candidate.totalVolume}, trades=${candidate.trades.length}`
                );
            }

            expect(zonesAfterFirst).toHaveLength(1);
            const firstZone = zonesAfterFirst[0];
            expect(firstZone).toBeDefined();
            expect(firstZone.type).toBe("accumulation");

            const initialVolume = firstZone.totalVolume;
            const initialZoneId = firstZone.id;
            console.log(
                "First zone created - ID:",
                initialZoneId,
                "Volume:",
                initialVolume
            );

            // Step 2: Create overlapping candidate at nearby price (within 1% tolerance)
            const overlappingPrice = basePrice + 300; // 0.6% of 50000, within 1% tolerance
            const overlappingTrades = createConcentratedTrades(
                overlappingPrice,
                baseTime + 65000, // Start after first zone formation
                15, // More trades for better zone formation
                0.75
            );
            overlappingTrades.forEach((trade) => detector.analyze(trade));

            // Calculate expected additional volume
            const candidateVolume = overlappingTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const triggerVolume = 80;

            // Trigger merge by trying to form overlapping zone
            // Overlapping trades span 42 seconds (14 * 3s), need 60s+ duration
            const mergeTrigger = createTrade(
                overlappingPrice,
                baseTime + 65000 + 61000, // 61s after overlapping candidate start
                true,
                triggerVolume
            );
            const mergeResult = detector.analyze(mergeTrigger);

            // Debug: Check what the merge result contains
            console.log("Merge result updates:", mergeResult.updates.length);
            console.log("Merge result signals:", mergeResult.signals.length);
            console.log(
                "Merge result activeZones:",
                mergeResult.activeZones.length
            );

            // Step 3: Validate merge behavior
            const activeZones = detector.getActiveZones();
            console.log(
                "Active zones after merge attempt:",
                activeZones.length
            );
            if (activeZones.length === 0) {
                console.log(
                    "No active zones found. Checking zone manager state..."
                );
                const allZones = (detector as any).zoneManager.getZones();
                console.log("Total zones in manager:", allZones.length);
                allZones.forEach((zone: any, index: number) => {
                    console.log(
                        `Zone ${index}: symbol=${zone.symbol}, isActive=${zone.isActive}, id=${zone.id}`
                    );
                });
            }

            // Should still have exactly one zone (merged, not two separate)
            expect(activeZones).toHaveLength(1);

            const finalZone = activeZones[0];

            // Validate zone properties after merge
            expect(finalZone.id).toBe(initialZoneId); // Same zone ID (existing zone updated)
            expect(finalZone.totalVolume).toBeGreaterThan(initialVolume); // Volume increased
            expect(finalZone.type).toBe("accumulation"); // Still accumulation type

            // Validate merge was logged
            expect(mockLogger.debug).toHaveBeenCalledWith(
                "Merged candidate with existing zone",
                expect.objectContaining({
                    component: "AccumulationZoneDetector",
                    existingZoneId: initialZoneId,
                    candidateVolume: expect.any(Number),
                    mergedTrades: expect.any(Number),
                })
            );
        });

        it("should create new zone when no overlapping zones exist", () => {
            const baseTime = 2000000; // Fixed timestamp to avoid Date.now() inconsistencies
            const basePrice = 50000;

            // Create zone at one price level
            const trades1 = createConcentratedTrades(
                basePrice,
                baseTime,
                12,
                0.8
            );
            trades1.forEach((trade) => detector.analyze(trade));

            const zone1Trigger = createTrade(
                basePrice,
                baseTime + 65000, // 65 seconds > 60 second requirement
                true,
                100
            );
            const result1 = detector.analyze(zone1Trigger);

            console.log("=== STEP 1: Creating first zone at", basePrice, "===");
            console.log(
                "Candidates before first zone:",
                (detector as any).getCandidateCount()
            );
            console.log("Result1 updates:", result1.updates.length);
            console.log(
                "Active zones after first:",
                detector.getActiveZones().length
            );
            console.log(
                "Candidates after first zone creation:",
                (detector as any).getCandidateCount()
            );

            // Create second zone at very distant price (outside any tolerance)
            const distantPrice = basePrice + 5000; // 10% away, well outside 1% merge tolerance
            console.log(
                "=== STEP 2: Creating second zone at",
                distantPrice,
                "==="
            );

            const trades2 = createConcentratedTrades(
                distantPrice,
                baseTime + 70000,
                12,
                0.8
            );
            trades2.forEach((trade) => detector.analyze(trade));
            console.log(
                "Candidates after second trades:",
                (detector as any).getCandidateCount()
            );

            const zone2Trigger = createTrade(
                distantPrice,
                baseTime + 255000, // 255s gives second candidate sufficient duration
                true,
                100
            );
            const result2 = detector.analyze(zone2Trigger);

            console.log("Result2 updates:", result2.updates.length);
            console.log(
                "Active zones after second:",
                detector.getActiveZones().length
            );
            console.log(
                "Candidates after second zone creation:",
                (detector as any).getCandidateCount()
            );

            const activeZones = detector.getActiveZones();
            activeZones.forEach((zone, i) => {
                console.log(
                    `Zone ${i}: ID=${zone.id}, center=${zone.priceRange.center}`
                );
            });

            // Should create second zone (no merge due to distance)
            expect(activeZones).toHaveLength(2);

            // Validate zones are distinct
            const prices = activeZones.map((z) => z.priceRange.center);
            expect(Math.abs(prices[0] - prices[1])).toBeGreaterThan(500); // Confirm they're far apart
        });

        it("should handle merge errors gracefully", () => {
            const baseTime = 3000000; // Fixed timestamp to avoid Date.now() inconsistencies
            const basePrice = 50000;

            // Create initial zone
            const trades1 = createConcentratedTrades(
                basePrice,
                baseTime,
                12,
                0.8
            );
            trades1.forEach((trade) => detector.analyze(trade));

            const zone1Trigger = createTrade(
                basePrice,
                baseTime + 65000, // 65 seconds > 60 second requirement
                true,
                100
            );
            detector.analyze(zone1Trigger);

            // Mock mergeWithExistingZone to simulate failure during merge
            const detectorAny = detector as any;
            const originalMergeWithExistingZone =
                detectorAny.mergeWithExistingZone;
            detectorAny.mergeWithExistingZone = vi.fn(() => {
                throw new Error("Simulated zone update failure");
            });

            // Create overlapping candidate
            const overlappingTrades = createConcentratedTrades(
                basePrice + 200,
                baseTime + 70000,
                10,
                0.8
            );
            overlappingTrades.forEach((trade) => detector.analyze(trade));

            // Trigger merge (should fail gracefully)
            // Second candidate started at +130000, needs 120s duration, so trigger at +255000
            const mergeTrigger = createTrade(
                basePrice + 200,
                baseTime + 135000, // 135s gives second candidate 65s duration
                true,
                80
            );
            const result = detector.analyze(mergeTrigger);

            // Should handle error gracefully
            expect(result).toBeDefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                "Failed to merge candidate with existing zone",
                expect.objectContaining({
                    error: "Simulated zone update failure",
                })
            );

            // Restore original function
            detectorAny.mergeWithExistingZone = originalMergeWithExistingZone;
        });

        it("should validate zone state consistency after merge", () => {
            const baseTime = 4000000; // Fixed timestamp to avoid Date.now() inconsistencies
            const basePrice = 50000;

            // Create first zone with known volume characteristics
            const firstTrades = createConcentratedTrades(
                basePrice,
                baseTime,
                15,
                0.85
            ); // High sell ratio
            firstTrades.forEach((trade) => detector.analyze(trade));

            const trigger1 = createTrade(
                basePrice,
                baseTime + 125000,
                true,
                120
            );
            detector.analyze(trigger1);

            const initialZone = detector.getActiveZones()[0];
            const initialVolume = initialZone.totalVolume;
            const initialStrength = initialZone.strength;

            // Create overlapping candidate with additional volume
            const overlappingTrades = createConcentratedTrades(
                basePrice + 150,
                baseTime + 70000,
                8,
                0.75
            );
            const overlappingVolume = overlappingTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );

            overlappingTrades.forEach((trade) => detector.analyze(trade));

            // Trigger merge
            const triggerVolume = 90;
            const mergeTrigger = createTrade(
                basePrice + 150,
                baseTime + 255000, // 255s gives second candidate sufficient duration
                true,
                triggerVolume
            );
            detector.analyze(mergeTrigger);

            // Validate final zone state
            const finalZone = detector.getActiveZones()[0];

            // Volume should include all sources
            expect(finalZone.totalVolume).toBeGreaterThanOrEqual(
                initialVolume + overlappingVolume + triggerVolume * 0.8 // Allow some tolerance
            );

            // Zone should maintain or improve strength (more data = better signal)
            expect(finalZone.strength).toBeGreaterThanOrEqual(
                initialStrength * 0.9
            ); // Allow slight degradation

            // Type should remain accumulation
            expect(finalZone.type).toBe("accumulation");
            expect(finalZone.confidence).toBeGreaterThan(0);
        });
    });
});

// Helper functions optimized for zone creation
function createTrade(
    price: number,
    timestamp: number,
    buyerIsMaker: boolean,
    quantity: number = 80
): EnrichedTradeEvent {
    return {
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        pair: "BTCUSDT",
        tradeId: `trade_${timestamp}_${Math.random()}`,
        originalTrade: {} as any,
        passiveBidVolume: buyerIsMaker ? quantity : 0,
        passiveAskVolume: buyerIsMaker ? 0 : quantity,
        zonePassiveBidVolume: 0,
        zonePassiveAskVolume: 0,
    };
}

function createConcentratedTrades(
    exactPrice: number,
    startTime: number,
    count: number,
    sellRatio: number
): EnrichedTradeEvent[] {
    const trades: EnrichedTradeEvent[] = [];

    // Calculate how many trades should be sells to meet ratio
    const sellCount = Math.ceil(count * sellRatio);
    const buyCount = count - sellCount;

    // Create realistic institutional-sized trades over time
    // IMPORTANT: Use EXACT same price for all trades to ensure they go to same candidate
    // The AccumulationZoneDetector groups trades by exact price level
    for (let i = 0; i < sellCount; i++) {
        const timestamp = startTime + i * 3000; // 3 second intervals for realism
        const quantity = 80 + Math.random() * 40; // 80-120 institutional sizes (larger)
        trades.push(createTrade(exactPrice, timestamp, true, quantity)); // buyerIsMaker=true = sell
    }

    for (let i = 0; i < buyCount; i++) {
        const timestamp = startTime + (sellCount + i) * 3000;
        const quantity = 80 + Math.random() * 40; // 80-120 institutional sizes (larger)
        trades.push(createTrade(exactPrice, timestamp, false, quantity)); // buyerIsMaker=false = buy
    }

    return trades;
}

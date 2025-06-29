import { vi } from "vitest";

// Mock AccumulationZoneDetector following CLAUDE.md requirements
export class AccumulationZoneDetector {
    private mockCandidates = new Map();
    private mockZones = new Map();
    private mockConfig: any;

    constructor(
        id: string,
        symbol: string,
        config: any,
        logger: any,
        metricsCollector: any
    ) {
        this.mockConfig = config;
    }

    // Core detection method - returns ZoneAnalysisResult
    analyze = vi.fn().mockImplementation((trade: any) => {
        // Mock logic to simulate zone formation based on test requirements
        const result = {
            updates: [],
            signals: [],
            activeZones: [],
        };

        // Simple mock logic: if we have enough trades with right characteristics, form zone
        if (this.shouldFormZone(trade)) {
            result.signals.push({
                type: "accumulation_zone_formed",
                zone: {
                    id: "mock-zone-1",
                    type: "accumulation",
                    symbol: trade.pair,
                    startTime: trade.timestamp - 300000, // 5 minutes ago
                    priceRange: {
                        min: trade.price - 0.01,
                        max: trade.price + 0.01,
                        center: trade.price,
                        width: 0.02,
                    },
                    totalVolume: 1500,
                    tradeCount: 20,
                    strength: 0.8,
                    confidence: 0.7,
                    significance: "high",
                },
                confidence: 0.8,
                timestamp: trade.timestamp,
            });
        }

        return result;
    });

    private shouldFormZone(trade: any): boolean {
        // Mock zone formation logic - can be overridden in tests
        return false; // Default to no zone formation
    }

    // Event emission methods
    emit = vi.fn();
    on = vi.fn();
    off = vi.fn();

    // Utility methods
    destroy = vi.fn();
    getHealthStatus = vi.fn().mockReturnValue({ isHealthy: true });

    // Test helper methods
    setMockZoneFormation(shouldForm: boolean) {
        this.shouldFormZone = vi.fn().mockReturnValue(shouldForm);
    }
}

// Export default for ES modules
export default { AccumulationZoneDetector };

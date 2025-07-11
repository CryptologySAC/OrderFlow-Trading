// __mocks__/src/market/orderFlowPreprocessor.ts
import { vi } from "vitest";
import type { IOrderflowPreprocessor } from "../../../src/market/orderFlowPreprocessor.js";

export const createMockOrderflowPreprocessor = (): IOrderflowPreprocessor => {
    return {
        handleDepth: vi.fn(),
        handleAggTrade: vi.fn(),
        getStats: vi.fn(() => ({
            processedTrades: 0,
            processedDepthUpdates: 0,
            bookMetrics: {} as any,
        })),
        findZonesNearPrice: vi.fn((zones, price, distance) => {
            // Mock implementation: return zones that are within distance of price
            if (!zones || zones.length === 0) return [];

            return zones.filter((zone) => {
                const priceDiff = Math.abs(zone.priceLevel - price);
                // Use tick-based distance (distance * 0.01 for LTCUSDT tick size)
                const maxDistance = distance * 0.01;
                return priceDiff <= maxDistance;
            });
        }),
        calculateZoneRelevanceScore: vi.fn(() => 0.5),
        findMostRelevantZone: vi.fn(() => null),
    };
};

// Default mock export
export default createMockOrderflowPreprocessor();

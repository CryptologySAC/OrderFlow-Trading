// __mocks__/src/market/orderBookState.ts
import { vi } from "vitest";
import type { IOrderBookState } from "../../../src/market/orderBookState.js";

export const createMockOrderBookState = (): IOrderBookState =>
    ({
        updateDepth: vi.fn(),
        getLevel: vi.fn().mockReturnValue({
            price: 89.0,
            bid: 10.5,
            ask: 12.3,
            timestamp: Date.now(),
        }),
        getBestBid: vi.fn().mockReturnValue(88.99),
        getBestAsk: vi.fn().mockReturnValue(89.01),
        getSpread: vi.fn().mockReturnValue(0.02),
        getMidPrice: vi.fn().mockReturnValue(89.0),
        sumBand: vi.fn().mockReturnValue({ bid: 10.5, ask: 12.3, levels: 10 }),
        snapshot: vi.fn(() => {
            const snapshot = new Map([
                [
                    88.99,
                    { price: 88.99, bid: 10.5, ask: 0, timestamp: Date.now() },
                ],
                [
                    89.01,
                    { price: 89.01, bid: 0, ask: 12.3, timestamp: Date.now() },
                ],
                [
                    89.02,
                    { price: 89.02, bid: 0, ask: 8.7, timestamp: Date.now() },
                ],
                [
                    88.98,
                    { price: 88.98, bid: 15.2, ask: 0, timestamp: Date.now() },
                ],
            ]);
            console.log(
                "DEBUG: Mock snapshot called, returning size:",
                snapshot.size
            );
            return snapshot;
        }),
        getDepthMetrics: vi.fn().mockReturnValue({
            totalLevels: 100,
            bidLevels: 50,
            askLevels: 50,
            totalBidVolume: 1000,
            totalAskVolume: 1000,
            imbalance: 0,
        }),
        shutdown: vi.fn(),
        recover: vi.fn().mockResolvedValue(undefined),
        getHealth: vi.fn().mockReturnValue({
            status: "healthy",
            initialized: true,
            lastUpdateMs: Date.now(),
            circuitBreakerOpen: false,
            errorRate: 0,
            bookSize: 100,
            spread: 0.02,
            midPrice: 89.0,
            details: {
                bidLevels: 50,
                askLevels: 50,
                totalBidVolume: 1000,
                totalAskVolume: 1000,
                staleLevels: 0,
                memoryUsageMB: 10,
            },
        }),
        onStreamConnected: vi.fn(),
        onStreamDisconnected: vi.fn(),
    }) as any;

// Default mock export
export default createMockOrderBookState();

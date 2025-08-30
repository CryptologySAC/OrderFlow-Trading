// Mock for TraditionalIndicators
import { vi } from "vitest";
import type { TraditionalIndicatorValues } from "../../../../src/indicators/helpers/traditionalIndicators.js";

export class MockTraditionalIndicators {
    public validateSignal = vi.fn(
        (
            price: number,
            side: "buy" | "sell",
            signalType: "reversal" | "trend" | "absorption_reversal" = "trend"
        ): TraditionalIndicatorValues => {
            // Return a passing traditional indicator result by default
            return {
                vwap: {
                    value: price + 0.1,
                    deviation: 0.1,
                    deviationPercent: 0.1,
                    volume: 1000,
                    passed: true,
                },
                rsi: {
                    value: 50,
                    condition: "neutral" as const,
                    passed: true,
                    periods: 14,
                },
                oir: {
                    value: 0.5,
                    buyVolume: 500,
                    sellVolume: 500,
                    totalVolume: 1000,
                    condition: "neutral" as const,
                    passed: true,
                },
                overallDecision: "pass" as const,
                filtersTriggered: [],
            };
        }
    );

    public update = vi.fn();
    public cleanup = vi.fn();
}

export function createMockTraditionalIndicators(): MockTraditionalIndicators {
    return new MockTraditionalIndicators();
}

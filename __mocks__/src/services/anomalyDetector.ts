import { vi } from "vitest";

export class AnomalyDetector {
    constructor(...args: any[]) {
        // Mock constructor that ignores all parameters
    }

    getMarketHealth = vi.fn().mockReturnValue({
        isHealthy: true,
        recommendation: "continue",
        criticalIssues: [],
        recentAnomalyTypes: [],
        volatilityRatio: 1.0,
        highestSeverity: "low",
        metrics: {
            volatility: 0.5,
            spreadBps: 1.0,
            flowImbalance: 0.0,
            lastUpdateAge: 0,
        },
    });

    detectAnomalies = vi.fn().mockReturnValue([]);
    getActiveAnomalies = vi.fn().mockReturnValue([]);
    updateWithTrade = vi.fn();
}

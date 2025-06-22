import { vi } from "vitest";

export class IcebergDetector {
    constructor(...args: any[]) {
        // Mock constructor that ignores all parameters
    }

    onEnrichedTrade = vi.fn();
    getStatus = vi.fn().mockReturnValue("Active: 0 candidates, 0 completed (avg confidence: 0.0%)");
    markSignalConfirmed = vi.fn();
    getActiveCandidates = vi.fn().mockReturnValue([]);
    getCompletedIcebergs = vi.fn().mockReturnValue([]);
    getStatistics = vi.fn().mockReturnValue({
        activeCandidates: 0,
        completedIcebergs: 0,
        avgConfidence: 0,
        avgInstitutionalScore: 0,
        totalVolumeDetected: 0,
    });
    setAnomalyDetector = vi.fn();
    emit = vi.fn();
    on = vi.fn();
    once = vi.fn();
    off = vi.fn();
    removeListener = vi.fn();
    removeAllListeners = vi.fn();
    listenerCount = vi.fn().mockReturnValue(0);
    listeners = vi.fn().mockReturnValue([]);
}
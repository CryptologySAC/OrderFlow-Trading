import { vi } from "vitest";

export class HiddenOrderDetector {
    constructor(...args: any[]) {
        // Mock constructor that ignores all parameters
    }

    onEnrichedTrade = vi.fn();
    getStatus = vi.fn().mockReturnValue("Active: 0 candidates, 0 detected (avg stealth: 0.0%)");
    markSignalConfirmed = vi.fn();
    getActiveCandidates = vi.fn().mockReturnValue([]);
    getDetectedHiddenOrders = vi.fn().mockReturnValue([]);
    getStatistics = vi.fn().mockReturnValue({
        activeCandidates: 0,
        detectedHiddenOrders: 0,
        avgStealthScore: 0,
        avgConfidence: 0,
        totalVolumeDetected: 0,
        detectionsByType: {},
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
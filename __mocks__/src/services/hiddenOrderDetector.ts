import { vi } from "vitest";

export class HiddenOrderDetector {
    constructor(...args: any[]) {
        // Mock constructor that ignores all parameters
    }

    onEnrichedTrade = vi.fn();
    getStatus = vi
        .fn()
        .mockReturnValue("Detected: 0 hidden orders (avg hidden: 0.0)");
    markSignalConfirmed = vi.fn();
    getDetectedHiddenOrders = vi.fn().mockReturnValue([]);
    getStatistics = vi.fn().mockReturnValue({
        totalHiddenOrders: 0,
        avgHiddenVolume: 0,
        avgHiddenPercentage: 0,
        avgConfidence: 0,
        totalHiddenVolumeDetected: 0,
        detectionsByConfidence: {
            high: 0,
            medium: 0,
            low: 0,
        },
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

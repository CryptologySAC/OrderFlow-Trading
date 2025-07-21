import { vi } from "vitest";

export class SpoofingDetector {
    constructor(...args: any[]) {
        // Mock constructor that ignores all parameters
    }

    trackOrderPlacement = vi.fn();
    trackOrderCancellation = vi.fn();
    trackPassiveChange = vi.fn();
    wasSpoofed = vi.fn().mockReturnValue(false);
    detectSpoofingPatterns = vi.fn().mockReturnValue([]);
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

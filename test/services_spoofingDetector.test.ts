import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector";

describe("services/SpoofingDetector", () => {
    let detector: SpoofingDetector;
    beforeEach(() => {
        vi.useFakeTimers();
        detector = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 1,
            minWallSize: 10,
        });
    });

    it("detects spoofing when wall pulled", () => {
        const now = Date.now();
        detector.trackPassiveChange(100, 0, 20);
        vi.setSystemTime(now + 100);
        detector.trackPassiveChange(100, 0, 2);
        const res = detector.wasSpoofed(100, "buy", now + 200, () => 0);
        expect(res).toBe(true);
    });
});

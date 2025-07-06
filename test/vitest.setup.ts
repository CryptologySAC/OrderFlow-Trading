// test/vitest.setup.ts
import { EventEmitter } from "events";
import { vi, beforeEach, afterEach } from "vitest";

// Increase default max listeners for complex test scenarios
EventEmitter.defaultMaxListeners = 20;

// Global test setup
beforeEach(() => {
    // Clear all timers before each test
    vi.clearAllTimers();
});

// Global test cleanup
afterEach(() => {
    // Restore real timers after each test
    vi.useRealTimers();

    // Clear all mocks to prevent test interference
    vi.clearAllMocks();

    // Force garbage collection if available
    if (global.gc) {
        global.gc();
    }

    // Clear any remaining intervals/timeouts
    if (typeof clearInterval !== "undefined") {
        // Clear all known intervals (this is a safety net)
        const highestId = setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
            clearTimeout(i);
            clearInterval(i);
        }
    }
});

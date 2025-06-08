// Test script to validate object pool memory leak fix
import { SharedPools } from "./src/utils/objectPool.js";
import { BaseDetector } from "./src/indicators/base/baseDetector.js";
import { RollingWindow } from "./src/utils/rollingWindow.js";

// Mock detector for testing
class TestDetector extends BaseDetector {
    protected readonly detectorType = "test" as const;

    protected onEnrichedTradeSpecific(): void {
        // Mock implementation
    }

    protected getSignalType() {
        return "test" as const;
    }

    // Expose protected method for testing
    public testPoolAwarePush(zoneHistory: RollingWindow<any>, sample: any) {
        return this.pushToZoneHistoryWithPoolCleanup(zoneHistory, sample);
    }

    // Expose protected cleanup for testing
    public testCleanup() {
        return this.cleanupOldZoneData();
    }
}

async function testMemoryLeakFix() {
    console.log("🧪 Testing Object Pool Memory Leak Fix...");

    const sharedPools = SharedPools.getInstance();

    // Get initial pool stats
    const initialStats = sharedPools.getStats();
    console.log("📊 Initial Pool Stats:", initialStats);

    // Create test detector and rolling window
    const mockLogger = {
        info: () => {},
        debug: () => {},
        error: () => {},
        warn: () => {},
    } as any;
    const mockSpoofingDetector = {} as any;
    const mockMetricsCollector = {
        incrementMetric: () => {},
        updateMetric: () => {},
        recordHistogram: () => {},
        incrementCounter: () => {},
    } as any;

    const detector = new TestDetector(
        "test",
        () => {},
        {},
        mockLogger,
        mockSpoofingDetector,
        mockMetricsCollector
    );

    const zoneHistory = new RollingWindow(5, false); // Small window for testing

    console.log("🔄 Testing pool-aware push with window overflow...");

    // Fill the window beyond capacity to test eviction
    for (let i = 0; i < 10; i++) {
        const sample = sharedPools.zoneSamples.acquire();
        sample.bid = i;
        sample.ask = i * 2;
        sample.total = i * 3;
        sample.timestamp = Date.now() + i;

        console.log(
            `   Adding sample ${i}, pool size before: ${sharedPools.zoneSamples.size()}`
        );
        detector.testPoolAwarePush(zoneHistory, sample);
        console.log(
            `   Pool size after: ${sharedPools.zoneSamples.size()}, window count: ${zoneHistory.count()}`
        );
    }

    // Check final pool stats
    const finalStats = sharedPools.getStats();
    console.log("📊 Final Pool Stats:", finalStats);

    // Verify that objects were properly returned to pool
    const poolGrowth = finalStats.zoneSamples - initialStats.zoneSamples;
    console.log(`📈 Pool size change: ${poolGrowth}`);

    // Cleanup test
    console.log("🧹 Testing cleanup...");
    detector.testCleanup();

    const cleanupStats = sharedPools.getStats();
    console.log("📊 Post-cleanup Pool Stats:", cleanupStats);

    // Validate results
    if (zoneHistory.count() <= 5) {
        console.log("✅ Rolling window size properly maintained");
    } else {
        console.log("❌ Rolling window size exceeded limit");
    }

    if (poolGrowth >= 0) {
        console.log("✅ No pool objects leaked during overflow");
    } else {
        console.log("❌ Pool objects may have leaked");
    }

    console.log("🏁 Memory leak fix test completed!");
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testMemoryLeakFix().catch(console.error);
}

export { testMemoryLeakFix };

// Debug script to understand DeltaCVD SELL signal issue
import { DeltaCVDConfirmation } from "./src/indicators/deltaCVDConfirmation";

// Mock the dependencies
const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    child: () => mockLogger,
};

const mockSpoofing = {
    validateTrade: () => ({ isValid: true }),
};

const mockMetrics = {
    updateMetric: () => {},
    incrementCounter: (name, count, tags) => {
        console.log(`METRICS: ${name} +${count}`, tags);
    },
    recordDuration: () => {},
    recordTiming: () => {},
    getMetrics: () => ({}),
    resetMetrics: () => {},
};

const createVolumeConfig = () => ({
    enableDepthAnalysis: true,
    volumeSurgeMultiplier: 1.5,
    burstDetectionMs: 1000,
    sustainedVolumeMs: 50000,
    medianTradeSize: 0.6,
    imbalanceThreshold: 0.05,
});

const createTradeEvent = (
    price,
    quantity,
    buyerIsMaker,
    timestamp,
    bidQty,
    askQty
) => ({
    symbol: "LTCUSDT",
    price,
    quantity,
    timestamp,
    buyerIsMaker,
    passive: { bidQty, askQty },
    exchange: "binance",
    eventTime: timestamp,
    side: buyerIsMaker ? "sell" : "buy",
});

// Create detector with identical config to working BUY test
const detector = new DeltaCVDConfirmation(
    "debug_sell_test",
    {
        windowsSec: [60],
        minZ: 1.0,
        minTradesPerSec: 0.1,
        minVolPerSec: 0.5,
        detectionMode: "momentum",
        baseConfidenceRequired: 0.2,
        finalConfidenceRequired: 0.3,
        usePassiveVolume: true,
        ...createVolumeConfig(),
    },
    mockLogger,
    mockSpoofing,
    mockMetrics
);

let emittedSignals = [];
detector.on("signalCandidate", (signal) => {
    console.log("🎯 SIGNAL EMITTED:", signal.side, signal.confidence);
    emittedSignals.push(signal);
});

const baseTime = Date.now();
const basePrice = 89.0;

console.log("=== CREATING SELL PRESSURE PATTERN ===");

// Use EXACT same pattern as working BUY test but inverted
const strongSellingTrades = [];

// Phase 1: Build statistical baseline with 50+ trades over 45 seconds
for (let i = 0; i < 50; i++) {
    const timeOffset = baseTime - 45000 + i * 900; // 45 seconds, 900ms apart
    const priceVariation = basePrice + Math.sin(i * 0.2) * 0.01; // Small price variation
    const isSell = i % 3 !== 0; // 67% sell, 33% buy for slight negative CVD
    const quantity = 1.0 + Math.random() * 0.5; // 1.0-1.5 baseline size

    const trade = createTradeEvent(
        priceVariation,
        quantity,
        isSell, // buyerIsMaker = isSell for correct SELL pressure
        timeOffset,
        15 + Math.random() * 5, // 15-20 baseline passive volume
        15 + Math.random() * 5
    );
    strongSellingTrades.push(trade);
}

// Phase 2: Build strong directional CVD over 10 seconds
for (let i = 50; i < 70; i++) {
    const timeOffset = baseTime - 10000 + (i - 50) * 500; // Last 10 seconds
    const priceDecrement = basePrice - (i - 50) * 0.0005; // Gradual price fall
    const quantity = 2.0 + (i - 50) * 0.1; // Increasing trade sizes

    const trade = createTradeEvent(
        priceDecrement,
        quantity,
        true, // All aggressive sells for strong negative CVD
        timeOffset,
        20, // Normal passive volume
        20
    );
    strongSellingTrades.push(trade);
}

// Phase 3: MASSIVE volume surge in last 1 second
for (let i = 70; i < 75; i++) {
    const trade = createTradeEvent(
        basePrice - (i - 65) * 0.001, // Continuing price fall
        100.0, // MASSIVE aggressive trades for clear volume surge
        true, // All market sells (strong sell pressure)
        baseTime - 1000 + (i - 70) * 200, // Last 1 second
        2, // Minimal passive volume for strong imbalance
        2
    );
    strongSellingTrades.push(trade);
}

console.log(`Created ${strongSellingTrades.length} trades`);
console.log("Processing trades...");

// Process all trades
strongSellingTrades.forEach((trade, i) => {
    detector.onEnrichedTrade(trade);
    if (i % 10 === 0) {
        console.log(`Processed ${i + 1}/${strongSellingTrades.length} trades`);
    }
});

console.log(`=== FINAL RESULTS ===`);
console.log(`Signals emitted: ${emittedSignals.length}`);
console.log(`Signal details:`, emittedSignals);

// Check detector state
const state = detector.getDetailedState();
console.log(`CVD windows: ${state.states.length}`);
if (state.states.length > 0) {
    const windowState = state.states[0];
    console.log(`Trades in window: ${windowState.trades.length}`);
    console.log(`Volume history: ${windowState.volumeHistory.length}`);
}

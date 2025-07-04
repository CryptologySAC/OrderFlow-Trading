import * as config from "./dist/core/config.js";

// Get all static methods and getters
const descriptors = Object.getOwnPropertyDescriptors(config.Config);
const methods = Object.keys(descriptors).filter(
    (name) =>
        name !== "length" &&
        name !== "name" &&
        name !== "prototype" &&
        name !== "constructor"
);

console.log("Available Config methods:");
methods.sort().forEach((method) => console.log(` - ${method}`));
console.log(`\nTotal methods: ${methods.length}`);

// Expected methods from test
const expectedMethods = [
    "SYMBOL",
    "PRICE_PRECISION",
    "TICK_SIZE",
    "MAX_STORAGE_TIME",
    "WINDOW_MS",
    "HTTP_PORT",
    "WS_PORT",
    "MQTT",
    "API_KEY",
    "API_SECRET",
    "LLM_API_KEY",
    "LLM_MODEL",
    "NODE_ENV",
    "ALERT_WEBHOOK_URL",
    "ALERT_COOLDOWN_MS",
    "PREPROCESSOR",
    "DATASTREAM",
    "ORDERBOOK_STATE",
    "TRADES_PROCESSOR",
    "SIGNAL_MANAGER",
    "DETECTOR_CONFIDENCE_THRESHOLDS",
    "DETECTOR_POSITION_SIZING",
    "SIGNAL_COORDINATOR",
    "ORDERBOOK_PROCESSOR",
    "UNIVERSAL_ZONE_CONFIG",
    "EXHAUSTION_CONFIG",
    "ABSORPTION_CONFIG",
    "DELTACVD_CONFIG",
    "ACCUMULATION_CONFIG",
    "DISTRIBUTION_CONFIG",
    "DISTRIBUTION_DETECTOR",
    "ABSORPTION_DETECTOR",
    "EXHAUSTION_DETECTOR",
    "DELTACVD_DETECTOR",
    "ACCUMULATION_DETECTOR",
    "DISTRIBUTION_ZONE_DETECTOR",
    "SUPPORT_RESISTANCE_DETECTOR",
    "INDIVIDUAL_TRADES_MANAGER",
    "MICROSTRUCTURE_ANALYZER",
    "SPOOFING_DETECTOR",
    "ANOMALY_DETECTOR",
    "ICEBERG_DETECTOR",
    "HIDDEN_ORDER_DETECTOR",
    "ENHANCED_ZONE_FORMATION",
    "marketDataStorage",
    "validate",
];

console.log("\nMissing methods:");
const missing = expectedMethods.filter((method) => !methods.includes(method));
missing.forEach((method) => console.log(` - ${method}`));

console.log("\nExtra methods (in Config but not in expected):");
const extra = methods.filter((method) => !expectedMethods.includes(method));
extra.forEach((method) => console.log(` - ${method}`));

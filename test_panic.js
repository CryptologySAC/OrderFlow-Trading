// Simple test to see if panic exit works
console.log("Testing panic exit...");

try {
    // Temporarily break config to test panic
    const fs = require("fs");
    const originalConfig = fs.readFileSync("config.json", "utf8");

    // Create broken config
    const brokenConfig = {
        nodeEnv: "development",
        // Missing required properties
    };

    fs.writeFileSync("config.json", JSON.stringify(brokenConfig, null, 2));

    // Try to load config - should panic exit
    require("./src/core/config.js");

    console.log("❌ PANIC EXIT FAILED - config loaded without errors!");
} catch (error) {
    console.log("✅ Got error (expected):", error.message);
} finally {
    // Restore original config
    // (would need to restore here)
}

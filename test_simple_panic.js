// Test if panic exit works
import fs from "fs";

async function testPanicExit() {
    console.log("Testing panic exit validation...");

    // Remove a required property from config temporarily
    const configPath = "./config.json";
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    // Save original and create broken version
    const originalSymbol = config.symbol;
    delete config.symbol; // Remove required property

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log("Config broken - removed 'symbol' property");
    console.log("Now testing if config validation panics...");

    // Try to import config module
    try {
        const configModule = await import("./src/core/config.js");
        console.log("❌ FAIL: Config loaded without panic!");
    } catch (error) {
        if (error.code === "ERR_MODULE_NOT_FOUND") {
            console.log("⚠️  Module not found - need to compile first");
        } else {
            console.log("✅ SUCCESS: Got expected error:", error.message);
        }
    } finally {
        // Restore original config
        config.symbol = originalSymbol;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log("Restored original config");
    }
}

testPanicExit();

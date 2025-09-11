// Simple test to load the Rust bindings
try {
    const bindings = require("./target/release/index.node");
    console.log("✅ Rust bindings loaded successfully!");
    console.log("Available functions:", Object.keys(bindings));

    // Test a simple function
    const result = bindings.price_to_int(123.456789);
    console.log("price_to_int(123.456789) =", result);
} catch (error) {
    console.error("❌ Failed to load Rust bindings:", error.message);
    console.error("Error details:", error);
}

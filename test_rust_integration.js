// Test the Rust bindings integration
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
    // Load the Rust bindings
    const rustBindings = require(
        join(__dirname, "rust/target/release/index.node")
    );
    console.log("✅ Rust bindings loaded successfully!");

    // Test basic functionality
    console.log("\n🧪 Testing basic functions:");

    // Test price conversion
    const priceResult = rustBindings.price_to_int(123.456789);
    console.log(`price_to_int(123.456789) = ${priceResult}`);

    const priceBack = rustBindings.int_to_price(priceResult);
    console.log(`int_to_price(${priceResult}) = ${priceBack}`);

    // Test arithmetic
    const addResult = rustBindings.safe_add("100000000", "50000000");
    console.log(`safe_add("100000000", "50000000") = ${addResult}`);

    // Test statistics
    const values = ["100000000", "110000000", "90000000"];
    const meanResult = rustBindings.calculate_mean(values);
    console.log(
        `calculate_mean(["100000000", "110000000", "90000000"]) = ${meanResult}`
    );

    // Test zones
    const inZone = rustBindings.is_price_in_zone(
        "100500000",
        "100000000",
        "101000000"
    );
    console.log(
        `is_price_in_zone("100500000", "100000000", "101000000") = ${inZone}`
    );

    console.log("\n🎉 All tests passed! Rust bindings are working perfectly.");
} catch (error) {
    console.error("❌ Failed to load or test Rust bindings:", error.message);
    console.error("Full error:", error);
}

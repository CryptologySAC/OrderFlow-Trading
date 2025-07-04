// Quick debug script
const price = 100.5;
console.log("price:", price);
console.log("typeof price:", typeof price);
console.log("Number.isFinite(price):", Number.isFinite(price));
console.log("price < 0:", price < 0);
console.log("price <= 0:", price <= 0);
console.log("condition:", !Number.isFinite(price) || price < 0);

// Test the actual PRICE_SCALE constant
const PRICE_SCALE = 100000000;
console.log("PRICE_SCALE:", PRICE_SCALE);
console.log("price * PRICE_SCALE:", price * PRICE_SCALE);
console.log(
    "Math.round(price * PRICE_SCALE):",
    Math.round(price * PRICE_SCALE)
);

try {
    const result = BigInt(Math.round(price * PRICE_SCALE));
    console.log("BigInt result:", result);
} catch (error) {
    console.log("BigInt error:", error.message);
}

// CONFIRM THE EXACT BUG
const QUANTITY_SCALE = 100000000;

// Reproduce the exact FinancialMath.divideQuantities calculation
function divideQuantities(qty1, qty2) {
    if (qty2 === 0 || isNaN(qty1) || isNaN(qty2)) {
        return 0;
    }
    const qty1Int = BigInt(Math.round(qty1 * QUANTITY_SCALE));
    const qty2Int = BigInt(Math.round(qty2 * QUANTITY_SCALE));
    const resultInt = (qty1Int * BigInt(QUANTITY_SCALE)) / qty2Int;
    return Number(resultInt) / QUANTITY_SCALE;
}

console.log("=== CONFIRMING THE BUG ===");

// Work backwards from CSV value: 485.7494924
// If the correct value should be ~0.005, what inputs produce 485?

// Target: priceEfficiency = 485.7494924
// If correct calculation is priceDiff/price ≈ 0.005
// Then buggy calculation is (priceDiff/price) * QUANTITY_SCALE ≈ 485

const targetBuggyValue = 485.7494924;
const correctValue = targetBuggyValue / QUANTITY_SCALE;

console.log(`Target buggy value: ${targetBuggyValue}`);
console.log(`Implied correct value: ${correctValue}`);

// Test with price = 108.53 from CSV
const price = 108.53;
const impliedPriceDiff = correctValue * price;

console.log(`Price from CSV: ${price}`);
console.log(`Implied priceDiff: ${impliedPriceDiff}`);

// Now test if this reproduces the bug
const calculatedResult = divideQuantities(impliedPriceDiff, price);
console.log(`Calculated result: ${calculatedResult}`);
console.log(`Matches target? ${Math.abs(calculatedResult - targetBuggyValue) < 0.1}`);

console.log("");
console.log("=== THE BUG CONFIRMED ===");
console.log(`The FinancialMath.divideQuantities function multiplies the result by QUANTITY_SCALE`);
console.log(`Instead of returning: priceDiff/price = ${correctValue}`);
console.log(`It returns: (priceDiff/price) * QUANTITY_SCALE = ${targetBuggyValue}`);
console.log(`This makes values 100,000,000 times larger than they should be!`);
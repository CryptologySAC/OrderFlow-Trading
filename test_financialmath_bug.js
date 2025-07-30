// Test the exact FinancialMath.divideQuantities calculation
const QUANTITY_SCALE = 100000000; // 8 decimal places

function divideQuantitiesBuggy(qty1, qty2) {
    if (qty2 === 0 || isNaN(qty1) || isNaN(qty2)) {
        return 0;
    }
    const qty1Int = BigInt(Math.round(qty1 * QUANTITY_SCALE));
    const qty2Int = BigInt(Math.round(qty2 * QUANTITY_SCALE));
    const resultInt = (qty1Int * BigInt(QUANTITY_SCALE)) / qty2Int; // BUG: Double scaling!
    return Number(resultInt) / QUANTITY_SCALE;
}

function divideQuantitiesCorrect(qty1, qty2) {
    if (qty2 === 0 || isNaN(qty1) || isNaN(qty2)) {
        return 0;
    }
    const qty1Int = BigInt(Math.round(qty1 * QUANTITY_SCALE));
    const qty2Int = BigInt(Math.round(qty2 * QUANTITY_SCALE));
    const resultInt = qty1Int / qty2Int; // CORRECT: No extra scaling
    return Number(resultInt);
}

// Test the bug: extra QUANTITY_SCALE makes result 100M times larger
console.log("=== TESTING FINANCIALMATH BUG ===");
console.log(`QUANTITY_SCALE = ${QUANTITY_SCALE}`);
console.log("");

// Test case: priceDiff=0.5, event.price=108.5 (should give ~0.0046)
const priceDiff = 0.5;
const eventPrice = 108.5;

console.log(`Input: priceDiff=${priceDiff}, eventPrice=${eventPrice}`);
console.log(`Expected result: ${priceDiff / eventPrice} = ${priceDiff / eventPrice}`);
console.log("");

// Manual calculation of the bug
const qty1Int = BigInt(Math.round(priceDiff * QUANTITY_SCALE));
const qty2Int = BigInt(Math.round(eventPrice * QUANTITY_SCALE));
console.log(`qty1Int = ${qty1Int}`);
console.log(`qty2Int = ${qty2Int}`);

const buggyResultInt = (qty1Int * BigInt(QUANTITY_SCALE)) / qty2Int;
const correctResultInt = qty1Int / qty2Int;

console.log(`buggyResultInt = ${buggyResultInt}`);
console.log(`correctResultInt = ${correctResultInt}`);

const buggyResult = Number(buggyResultInt) / QUANTITY_SCALE;
const correctResult = Number(correctResultInt) / QUANTITY_SCALE;

console.log(`Final buggy result: ${buggyResult}`);
console.log(`Final correct result: ${correctResult}`);
console.log(`Bug multiplier: ${buggyResult / correctResult}`);

// Check if this explains the 485 values
console.log("");
console.log("=== CHECKING 485 VALUES ===");
console.log("If priceDiff/eventPrice should be ~0.005, but we get 485:");
console.log(`485 / 0.005 = ${485 / 0.005} (should be close to QUANTITY_SCALE)`);
console.log(`QUANTITY_SCALE = ${QUANTITY_SCALE}`);
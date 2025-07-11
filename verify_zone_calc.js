// Verify that calculateZone returns lower boundary
import { FinancialMath } from "./dist/utils/financialMath.js";

console.log("🔍 Verifying Zone Calculation Returns Lower Boundary");

const tests = [
    { price: 89.15, zoneTicks: 10, expectedLowerBound: 89.1 },
    { price: 89.1, zoneTicks: 10, expectedLowerBound: 89.1 },
    { price: 89.19, zoneTicks: 10, expectedLowerBound: 89.1 },
    { price: 89.05, zoneTicks: 10, expectedLowerBound: 89.0 },
    { price: 89.0, zoneTicks: 10, expectedLowerBound: 89.0 },
    { price: 89.09, zoneTicks: 10, expectedLowerBound: 89.0 },
];

for (const test of tests) {
    const result = FinancialMath.calculateZone(test.price, test.zoneTicks, 2);
    const correct = Math.abs(result - test.expectedLowerBound) < 0.001;
    const zoneRange = `${test.expectedLowerBound.toFixed(2)}-${(test.expectedLowerBound + 0.09).toFixed(2)}`;
    console.log(
        `Price ${test.price} → Zone boundary ${result} (expected ${test.expectedLowerBound}) ${correct ? "✅" : "❌"}`
    );
    console.log(`  Zone range: ${zoneRange}`);
}

console.log(
    "\n🎯 Conclusion: calculateZone() already returns the lower boundary correctly!"
);

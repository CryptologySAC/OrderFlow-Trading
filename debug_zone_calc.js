// Test zone calculation directly
import { FinancialMath } from "./dist/utils/financialMath.js";

console.log("🧮 Zone Calculation Debug");

const tests = [
    { price: 89.1, expected: 89.1 },
    { price: 89.15, expected: 89.1 },
    { price: 89.05, expected: 89.0 },
    { price: 89.0, expected: 89.0 },
    { price: 89.19, expected: 89.1 },
    { price: 89.2, expected: 89.2 },
];

for (const test of tests) {
    const result = FinancialMath.calculateZone(test.price, 10, 2);
    const correct = result === test.expected;
    console.log(
        `Price ${test.price} → Zone ${result} (expected ${test.expected}) ${correct ? "✅" : "❌"}`
    );
}

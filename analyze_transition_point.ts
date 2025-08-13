#!/usr/bin/env node
/**
 * Analyzes the critical transition point between exhaustion TP and absorption signal
 * to determine if this represents two separate swings or phases of one swing
 */

// Key timestamps from the data:
const exhaustionLastTP = new Date("2025-08-12T19:18:00-05:00").getTime(); // Last exhaustion signal time
const absorptionSignal = new Date("2025-08-12T19:48:14-05:00").getTime(); // First absorption signal

// Key price levels:
const exhaustionTPLevel = 130.38; // Approximate TP level for exhaustion signals (~0.7% from $131.26)
const absorptionSignalPrice = 130.89; // Absorption signal price
const absorptionTPLevel = 129.97; // Absorption TP level (~0.7% from $130.89)

console.log("=".repeat(80));
console.log("TRANSITION POINT ANALYSIS");
console.log("=".repeat(80));

console.log(`
Key Timeline:
- 19:18:00: Last exhaustion signals around $131.26
- 19:18:00-19:48:14: 30-minute gap (critical transition period)
- 19:48:14: Absorption signals at $130.89
- 20:24:23: Final low at $129.59

Price Levels:
- Exhaustion signal prices: ~$131.26
- Exhaustion TP target: ~$130.38 (0.7% down from $131.26)
- Absorption signal price: $130.89
- Absorption TP target: ~$129.97 (0.7% down from $130.89)
- Actual final low: $129.59
`);

const timeDiffMinutes = (absorptionSignal - exhaustionLastTP) / (60 * 1000);
const priceGap = exhaustionTPLevel - absorptionSignalPrice;

console.log("Critical Analysis:");
console.log(`- Time gap: ${timeDiffMinutes} minutes`);
console.log(
    `- Price gap: $${Math.abs(priceGap).toFixed(2)} (Absorption ${priceGap > 0 ? "BELOW" : "ABOVE"} exhaustion TP)`
);
console.log();

if (Math.abs(priceGap) < 0.1 && timeDiffMinutes < 10) {
    console.log("🟢 LIKELY SAME SWING: Small price gap and short time window");
    console.log("   - Absorption signal too close to exhaustion TP");
    console.log("   - Suggests system should have waited for more separation");
} else if (Math.abs(priceGap) > 0.3 || timeDiffMinutes > 20) {
    console.log(
        "🟡 LIKELY SEPARATE PHASES: Significant separation in time/price"
    );
    console.log("   - Exhaustion caught initial drop");
    console.log("   - Market consolidated/bounced");
    console.log("   - Absorption caught continuation");
} else {
    console.log("🟠 BORDERLINE CASE: Moderate separation");
    console.log("   - Could be argued either way");
    console.log("   - Depends on intrabar price action during gap");
}

console.log();
console.log("What we need to determine:");
console.log("1. Did price bounce/consolidate between 19:18-19:48?");
console.log("2. Was there a clear reversal that justified new entry?");
console.log("3. Or was this continuous downward pressure?");

console.log(`
If price action 19:18-19:48 showed:
- Bounce back above $130.50+ → Two separate swings (TP correct)
- Sideways consolidation $130.40-130.90 → New phase entry (acceptable)
- Continuous drop below $130.40 → Same swing (TP premature)
`);

console.log("Current evidence:");
console.log(
    `- Absorption signaled at $130.89 (${(priceGap * -1).toFixed(2)} ABOVE exhaustion TP)`
);
console.log("- This suggests price BOUNCED after exhaustion TP");
console.log("- If true, absorption caught a legitimate new leg down");
console.log();
console.log(
    "CONCLUSION: Price gap suggests TWO PHASES, not one continuous swing"
);

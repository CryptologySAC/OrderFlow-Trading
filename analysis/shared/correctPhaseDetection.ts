/**
 * CORRECT Phase Detection Based on Pure Price Movement
 * A phase is a movement >0.35% in one direction with possible interruptions <0.35%
 */

export interface PricePoint {
    timestamp: number;
    price: number;
}

export interface CorrectPhase {
    id: number;
    direction: "UP" | "DOWN";
    startTime: number;
    endTime: number;
    startPrice: number;
    endPrice: number;
    sizePercent: number;
    highPrice: number;
    lowPrice: number;
    highTime: number;
    lowTime: number;
}

const PHASE_THRESHOLD = 0.0035; // 0.35% minimum phase size

/**
 * Simple phase detection: track highs/lows, close phase on 0.35% contra move
 * Fixed version that creates continuous phases with correct directions
 */
export function createCorrectPhases(
    priceData: Map<number, number>
): CorrectPhase[] {
    if (priceData.size < 2) return [];

    const pricePoints: PricePoint[] = Array.from(priceData.entries())
        .map(([timestamp, price]) => ({ timestamp, price }))
        .sort((a, b) => a.timestamp - b.timestamp);

    const phases: CorrectPhase[] = [];
    let phaseId = 1;

    // Start first phase from first price point
    let phaseStartTime = pricePoints[0].timestamp;
    let phaseStartPrice = pricePoints[0].price;
    let high = pricePoints[0].price;
    let low = pricePoints[0].price;
    let highTime = pricePoints[0].timestamp;
    let lowTime = pricePoints[0].timestamp;

    // Track whether extremes were reached after phase start
    let highReachedAfterStart = false;
    let lowReachedAfterStart = false;

    // Single forward loop through all price points
    for (let i = 1; i < pricePoints.length; i++) {
        const currentPrice = pricePoints[i].price;
        const currentTime = pricePoints[i].timestamp;

        // Update highs and lows for current phase
        if (currentPrice > high) {
            high = currentPrice;
            highTime = currentTime;
            highReachedAfterStart = true; // Price went UP to create new high
        }
        if (currentPrice < low) {
            low = currentPrice;
            lowTime = currentTime;
            lowReachedAfterStart = true; // Price went DOWN to create new low
        }

        // Check for 0.35% contra moves - only from extremes we actually reached
        const downMove = highReachedAfterStart
            ? (high - currentPrice) / high
            : 0;
        const upMove = lowReachedAfterStart ? (currentPrice - low) / low : 0;

        if (downMove > PHASE_THRESHOLD || upMove > PHASE_THRESHOLD) {
            // Phase closes - determine direction by which move triggered the reversal
            // If downMove triggered: we went UP to high, then reversed DOWN = UP phase
            // If upMove triggered: we went DOWN to low, then reversed UP = DOWN phase
            const direction: "UP" | "DOWN" =
                downMove > PHASE_THRESHOLD ? "UP" : "DOWN";

            // Phase ends at the extreme point
            const phaseEndTime = direction === "UP" ? highTime : lowTime;
            const phaseEndPrice = direction === "UP" ? high : low;

            const sizePercent =
                Math.abs(phaseEndPrice - phaseStartPrice) / phaseStartPrice;

            phases.push({
                id: phaseId++,
                direction,
                startTime: phaseStartTime,
                endTime: phaseEndTime,
                startPrice: phaseStartPrice,
                endPrice: phaseEndPrice,
                sizePercent,
                highPrice: high,
                lowPrice: low,
                highTime,
                lowTime,
            });

            // Next phase starts at the same extreme point where previous phase ended
            phaseStartTime = phaseEndTime;
            phaseStartPrice = phaseEndPrice;

            // Reset highs/lows for new phase, starting from the extreme point
            high = phaseEndPrice;
            low = phaseEndPrice;
            highTime = phaseEndTime;
            lowTime = phaseEndTime;

            // Reset flags - no extremes reached yet in new phase
            highReachedAfterStart = false;
            lowReachedAfterStart = false;

            // Update with current price if it's beyond the extreme
            if (currentPrice > high) {
                high = currentPrice;
                highTime = currentTime;
                highReachedAfterStart = true;
            }
            if (currentPrice < low) {
                low = currentPrice;
                lowTime = currentTime;
                lowReachedAfterStart = true;
            }
        }
    }

    return phases;
}

/**
 * Print correct phase summary
 */
export function printCorrectPhaseSummary(phases: CorrectPhase[]): void {
    console.log("\n📊 CORRECT PHASE SUMMARY (Price-Based):");
    console.log(
        "================================================================================"
    );
    for (const phase of phases) {
        const direction_emoji = phase.direction === "UP" ? "↑" : "↓";
        console.log(
            `   Phase #${phase.id}: ${phase.direction} ${direction_emoji} $${phase.startPrice.toFixed(2)} → $${phase.endPrice.toFixed(2)} (${(phase.sizePercent * 100).toFixed(2)}%)`
        );
        console.log(
            `     Range: $${phase.lowPrice.toFixed(2)} - $${phase.highPrice.toFixed(2)}`
        );
        console.log(
            `     Time: ${new Date(phase.startTime).toLocaleTimeString()} → ${new Date(phase.endTime).toLocaleTimeString()}`
        );
    }
}

export interface ProfitTarget {
    price: number;
    percentGain: number;
    netGain: number;
}

export function calculateProfitTarget(
    entryPrice: number,
    side: "buy" | "sell",
    targetPercent = 0.015,
    commissionRate = 0.001
): ProfitTarget {
    // Use BigInt arithmetic for precise financial calculations (12 decimal places)
    const SCALE = 1000000000000n; // 10^12 for high precision

    // Convert to BigInt with proper precision
    const scaledEntryPrice = BigInt(Math.round(entryPrice * Number(SCALE)));
    const scaledTargetPercent = BigInt(
        Math.round(targetPercent * Number(SCALE))
    );
    const scaledCommissionRate = BigInt(
        Math.round(commissionRate * Number(SCALE))
    );

    // Calculate gross target including double commission
    const grossTarget = scaledTargetPercent + scaledCommissionRate * 2n;

    // Calculate target price with precise BigInt arithmetic
    const scaledPrice =
        side === "buy"
            ? (scaledEntryPrice * (SCALE + grossTarget)) / SCALE
            : (scaledEntryPrice * (SCALE - grossTarget)) / SCALE;

    // Convert back to number with precision preservation
    const price = Number(scaledPrice) / Number(SCALE);
    const percentGain = targetPercent;
    const netGain =
        Number(scaledTargetPercent - scaledCommissionRate * 2n) / Number(SCALE);

    return { price, percentGain, netGain };
}

export function calculateBreakeven(
    entryPrice: number,
    side: "buy" | "sell",
    commissionRate = 0.001
): number {
    // Use BigInt arithmetic for precise financial calculations (12 decimal places)
    const SCALE = 1000000000000n; // 10^12 for high precision

    // Convert to BigInt with proper precision
    const scaledEntryPrice = BigInt(Math.round(entryPrice * Number(SCALE)));
    const scaledCommissionRate = BigInt(
        Math.round(commissionRate * Number(SCALE))
    );
    const totalCommission = scaledCommissionRate * 2n;

    // Calculate breakeven with precise BigInt arithmetic
    const scaledResult =
        side === "buy"
            ? (scaledEntryPrice * (SCALE + totalCommission)) / SCALE
            : (scaledEntryPrice * (SCALE - totalCommission)) / SCALE;

    // Convert back to number with precision preservation
    return Number(scaledResult) / Number(SCALE);
}

export function calculatePositionSize(
    capital: number,
    signalStrength: number, // 0-1
    maxRiskPercent = 0.02
): number {
    // Use BigInt arithmetic for precise financial calculations (12 decimal places)
    const SCALE = 1000000000000n; // 10^12 for high precision

    // Convert to BigInt with proper precision
    const scaledCapital = BigInt(Math.round(capital * Number(SCALE)));
    const scaledMaxRiskPercent = BigInt(
        Math.round(maxRiskPercent * Number(SCALE))
    );
    const scaledSignalStrength = BigInt(
        Math.round(signalStrength * Number(SCALE))
    );

    // Scale position size based on signal strength with precise arithmetic
    const riskAdjusted = (scaledMaxRiskPercent * scaledSignalStrength) / SCALE;
    const scaledResult = (scaledCapital * riskAdjusted) / SCALE;

    // Convert back to number with precision preservation
    return Number(scaledResult) / Number(SCALE);
}

export function calculateStopLoss(
    entryPrice: number,
    side: "buy" | "sell",
    stopPercent = 0.02
): number {
    // Use BigInt arithmetic for precise financial calculations (12 decimal places)
    const SCALE = 1000000000000n; // 10^12 for high precision

    // Convert to BigInt with proper precision
    const scaledEntryPrice = BigInt(Math.round(entryPrice * Number(SCALE)));
    const scaledStopPercent = BigInt(Math.round(stopPercent * Number(SCALE)));

    // Calculate stop loss with precise BigInt arithmetic
    const scaledResult =
        side === "buy"
            ? (scaledEntryPrice * (SCALE - scaledStopPercent)) / SCALE
            : (scaledEntryPrice * (SCALE + scaledStopPercent)) / SCALE;

    // Convert back to number with precision preservation
    return Number(scaledResult) / Number(SCALE);
}

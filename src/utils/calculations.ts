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
    const grossTarget = targetPercent + commissionRate * 2;

    const price =
        side === "buy"
            ? entryPrice * (1 + grossTarget)
            : entryPrice * (1 - grossTarget);

    const percentGain = targetPercent;
    const netGain = targetPercent - commissionRate * 2;

    return { price, percentGain, netGain };
}

export function calculateBreakeven(
    entryPrice: number,
    side: "buy" | "sell",
    commissionRate = 0.001
): number {
    const totalCommission = commissionRate * 2;

    return side === "buy"
        ? entryPrice * (1 + totalCommission)
        : entryPrice * (1 - totalCommission);
}

export function calculatePositionSize(
    capital: number,
    signalStrength: number, // 0-1
    maxRiskPercent = 0.02
): number {
    // Scale position size based on signal strength
    const riskAdjusted = maxRiskPercent * signalStrength;
    return capital * riskAdjusted;
}

export function calculateStopLoss(
    entryPrice: number,
    side: "buy" | "sell",
    stopPercent = 0.02
): number {
    return side === "buy"
        ? entryPrice * (1 - stopPercent)
        : entryPrice * (1 + stopPercent);
}

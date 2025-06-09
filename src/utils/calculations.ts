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
    // Use integer arithmetic for financial precision (8 decimal places)
    const scale = 100000000;
    const scaledEntryPrice = Math.round(entryPrice * scale);
    const scaledTargetPercent = Math.round(targetPercent * scale);
    const scaledCommissionRate = Math.round(commissionRate * scale);

    const grossTarget = scaledTargetPercent + scaledCommissionRate * 2;

    const scaledPrice =
        side === "buy"
            ? Math.round((scaledEntryPrice * (scale + grossTarget)) / scale)
            : Math.round((scaledEntryPrice * (scale - grossTarget)) / scale);

    const price = scaledPrice / scale;
    const percentGain = targetPercent;
    const netGain = (scaledTargetPercent - scaledCommissionRate * 2) / scale;

    return { price, percentGain, netGain };
}

export function calculateBreakeven(
    entryPrice: number,
    side: "buy" | "sell",
    commissionRate = 0.001
): number {
    // Use integer arithmetic for financial precision (8 decimal places)
    const scale = 100000000;
    const scaledEntryPrice = Math.round(entryPrice * scale);
    const scaledCommissionRate = Math.round(commissionRate * scale);
    const totalCommission = scaledCommissionRate * 2;

    const scaledResult =
        side === "buy"
            ? Math.round((scaledEntryPrice * (scale + totalCommission)) / scale)
            : Math.round(
                  (scaledEntryPrice * (scale - totalCommission)) / scale
              );

    return scaledResult / scale;
}

export function calculatePositionSize(
    capital: number,
    signalStrength: number, // 0-1
    maxRiskPercent = 0.02
): number {
    // Use integer arithmetic for financial precision (8 decimal places)
    const scale = 100000000;
    const scaledCapital = Math.round(capital * scale);
    const scaledMaxRiskPercent = Math.round(maxRiskPercent * scale);
    const scaledSignalStrength = Math.round(signalStrength * scale);

    // Scale position size based on signal strength
    const riskAdjusted = Math.round(
        (scaledMaxRiskPercent * scaledSignalStrength) / scale
    );
    const scaledResult = Math.round((scaledCapital * riskAdjusted) / scale);

    return scaledResult / scale;
}

export function calculateStopLoss(
    entryPrice: number,
    side: "buy" | "sell",
    stopPercent = 0.02
): number {
    // Use integer arithmetic for financial precision (8 decimal places)
    const scale = 100000000;
    const scaledEntryPrice = Math.round(entryPrice * scale);
    const scaledStopPercent = Math.round(stopPercent * scale);

    const scaledResult =
        side === "buy"
            ? Math.round(
                  (scaledEntryPrice * (scale - scaledStopPercent)) / scale
              )
            : Math.round(
                  (scaledEntryPrice * (scale + scaledStopPercent)) / scale
              );

    return scaledResult / scale;
}

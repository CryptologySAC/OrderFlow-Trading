export const calculateBreakeven = vi
    .fn<(price: number, side: "buy" | "sell") => number>()
    .mockReturnValue(0);
export const calculateProfitTarget = vi
    .fn<
        (
            price: number,
            side: "buy" | "sell",
            targetPercent?: number
        ) => { price: number; percentGain: number; netGain: number }
    >()
    .mockReturnValue({ price: 0, percentGain: 0, netGain: 0 });
export default { calculateBreakeven, calculateProfitTarget };
export const __esModule = true;

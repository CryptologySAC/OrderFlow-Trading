import { Signal, VolumeBin, PlotTrade } from "./interfaces";

export class OrderFlowAnalyzer {
    private absorptionWindow: number; // seconds
    private priceRange: number; // percentage (e.g., 0.003 = 0.3%)
    private minLargeOrder: number; // LTC
    private volumeWindow: number; // milliseconds
    private confirmThreshold: number; // percentage (e.g., 0.0025 = 0.25%)
    private confirmationWindow: number; // milliseconds (5 minutes)
    private symbol: string; // e.g., "LTCUSDT"
    private priceBins: Map<number, VolumeBin> = new Map(); // Volume heat map
    private signals: Signal[] = []; // Confirmed signals
    private pendingSignals: Signal[] = []; // Signals awaiting confirmation
    private recentTrades: PlotTrade[] = []; // Trades within absorptionWindow
    private callback?: (signal: Signal) => void;

    constructor(
        absorptionWindow: number = 4,
        priceRange: number = 0.003,
        minLargeOrder: number = 55,
        volumeWindow: number = 20 * 60 * 1000,
        confirmThreshold: number = 0.0025,
        symbol: string = "LTCUSDT",
        callback?: (signal: Signal) => void
    ) {
        this.absorptionWindow = absorptionWindow;
        this.priceRange = priceRange;
        this.minLargeOrder = minLargeOrder;
        this.volumeWindow = volumeWindow;
        this.confirmThreshold = confirmThreshold;
        this.confirmationWindow = 5 * 60 * 1000; // 5 minutes in milliseconds
        this.symbol = symbol;
        this.callback = callback;
    }

    public processTrade(trade: PlotTrade): void {
        if (trade.symbol !== this.symbol) return; // Filter by symbol
        this.updateRecentTrades(trade);
        this.updateVolumeHeatMap(trade);
        this.detectAbsorption(trade);
        this.checkPendingSignals(trade.time);
    }

    private updateRecentTrades(trade: PlotTrade): void {
        const currentTime = trade.time;
        // Remove trades older than absorptionWindow
        while (
            this.recentTrades.length &&
            currentTime - this.recentTrades[0].time >
                this.absorptionWindow * 1000
        ) {
            this.recentTrades.shift();
        }
        this.recentTrades.push(trade);
    }

    private updateVolumeHeatMap(trade: PlotTrade): void {
        const binPrice = Math.round(trade.price / 0.001) * 0.001;
        let bin = this.priceBins.get(binPrice);
        if (!bin) {
            bin = { buyVol: 0, sellVol: 0, lastUpdate: trade.time };
            this.priceBins.set(binPrice, bin);
        }
        // Reset volumes if outside volumeWindow
        if (trade.time - bin.lastUpdate > this.volumeWindow) {
            bin.buyVol = 0;
            bin.sellVol = 0;
        }
        // Update volumes
        if (trade.orderType === "BUY") {
            bin.buyVol += trade.quantity;
        } else {
            bin.sellVol += trade.quantity;
        }
        bin.lastUpdate = trade.time;
    }

    private detectAbsorption(trade: PlotTrade): void {
        if (trade.quantity >= this.minLargeOrder) {
            const opposingTrades = this.recentTrades.filter(
                (t) => t.orderType !== trade.orderType && t.quantity <= 0.5
            );
            if (opposingTrades.length) {
                const priceMin = trade.price * (1 - this.priceRange);
                const priceMax = trade.price * (1 + this.priceRange);
                if (
                    opposingTrades.every(
                        (t) => t.price >= priceMin && t.price <= priceMax
                    )
                ) {
                    const signal: Signal = {
                        type: trade.orderType === "BUY" ? "SELL" : "BUY",
                        time: trade.time,
                        price: trade.price,
                        quantity: trade.quantity,
                        status: "pending",
                        tradeIndex: trade.tradeId,
                    };
                    if (this.isNearHighVolume(trade.price)) {
                        const absorptionType =
                            signal.type === "BUY"
                                ? "Sell Absorption (BUY signal)"
                                : "Buy Absorption (SELL signal)";
                        console.log(
                            `${absorptionType} at ${new Date(signal.time).toISOString()}, ` +
                                `Price: ${signal.price.toFixed(2)}, Quantity: ${signal.quantity.toFixed(2)} LTC`
                        );
                        this.pendingSignals.push(signal);
                        if (this.callback) {
                            this.callback(signal);
                        }
                    }
                }
            }
        }
    }

    private checkPendingSignals(currentTime: number): void {
        const currentTimeMs = currentTime;
        while (
            this.pendingSignals.length &&
            currentTimeMs >=
                this.pendingSignals[0].time + this.confirmationWindow
        ) {
            const signal = this.pendingSignals.shift()!;
            // Get trades within the 5-minute confirmation window
            const confirmationTrades = this.recentTrades.filter(
                (t) =>
                    t.time > signal.time &&
                    t.time <= signal.time + this.confirmationWindow
            );
            const maxPrice = confirmationTrades.length
                ? Math.max(...confirmationTrades.map((t) => t.price))
                : signal.price;
            const minPrice = confirmationTrades.length
                ? Math.min(...confirmationTrades.map((t) => t.price))
                : signal.price;
            let isConfirmed = false;
            if (signal.type === "BUY") {
                // Buy signal (sell absorption): expect price to rise
                if (maxPrice >= signal.price * (1 + this.confirmThreshold)) {
                    isConfirmed = true;
                }
            } else {
                // Sell signal (buy absorption): expect price to fall
                if (minPrice <= signal.price * (1 - this.confirmThreshold)) {
                    isConfirmed = true;
                }
            }
            signal.status = isConfirmed ? "confirmed" : "invalidated";
            const absorptionType =
                signal.type === "BUY"
                    ? "Sell Absorption (BUY signal)"
                    : "Buy Absorption (SELL signal)";
            console.log(
                `${signal.status.charAt(0).toUpperCase() + signal.status.slice(1)}: ` +
                    `${absorptionType} at ${new Date(signal.time + this.confirmationWindow).toISOString()}, ` +
                    `Price: ${signal.price.toFixed(2)}, Quantity: ${signal.quantity.toFixed(2)} LTC`
            );
            if (isConfirmed) {
                this.signals.push(signal);
            }
            if (this.callback) {
                this.callback(signal);
            }
        }
    }

    private isNearHighVolume(price: number): boolean {
        const binPrice = Math.round(price / 0.001) * 0.001;
        const bin = this.priceBins.get(binPrice);
        if (bin) {
            const totalVol = bin.buyVol + bin.sellVol;
            const threshold = this.getTopVolumeThreshold();
            return totalVol >= threshold;
        }
        return false;
    }

    private getTopVolumeThreshold(): number {
        const volumes = Array.from(this.priceBins.values()).map(
            (bin) => bin.buyVol + bin.sellVol
        );
        if (!volumes.length) return 0;
        // Calculate 90th percentile
        volumes.sort((a, b) => a - b);
        const index = Math.floor(0.9 * volumes.length);
        return volumes[index] || 0;
    }

    public getSignals(): Signal[] {
        return [...this.signals];
    }
}

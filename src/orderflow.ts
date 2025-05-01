import { Signal, VolumeBin, PlotTrade } from "./interfaces";

export class OrderFlowAnalyzer {
    private absorptionWindow: number; // seconds
    private priceRange: number; // percentage
    private minLargeOrder: number; // LTC
    private volumeWindow: number; // milliseconds
    private confirmThreshold: number; // percentage
    private defaultStopLoss: number; // percentage (0.005)
    private invalidStopLoss: number; // percentage (0.001 if invalidated)
    private takeProfit: number; // percentage
    private confirmationWindow: number; // milliseconds (5 minutes)
    private invalidationWindow: number; // milliseconds (5 seconds)
    private symbol: string; // e.g., "LTCUSDT"
    private priceBins: Map<number, VolumeBin> = new Map();
    private signals: Signal[] = [];
    private pendingSignals: Signal[] = [];
    private recentTrades: PlotTrade[] = [];
    private activeTrades: { [timeframe: string]: Signal | null } = {
        Daytime: null,
        Nighttime: null
    }; // Track active trade per timeframe
    private callback?: (signal: Signal) => void;

    constructor(
        absorptionWindow: number = 10, // Optimal from backtest
        priceRange: number = 0.005,
        minLargeOrder: number = 70,
        volumeWindow: number = 20 * 60 * 1000,
        confirmThreshold: number = 0.004, // Optimal from backtest
        defaultStopLoss: number = 0.005,
        takeProfit: number = 0.025,
        symbol: string = "LTCUSDT",
        callback?: (signal: Signal) => void
    ) {
        this.absorptionWindow = absorptionWindow;
        this.priceRange = priceRange;
        this.minLargeOrder = minLargeOrder;
        this.volumeWindow = volumeWindow;
        this.confirmThreshold = confirmThreshold;
        this.defaultStopLoss = defaultStopLoss;
        this.invalidStopLoss = 0.001; // Tighter stop loss for invalidated signals
        this.takeProfit = takeProfit;
        this.confirmationWindow = 5 * 60 * 1000; // 5 minutes
        this.invalidationWindow = 5 * 1000; // 5 seconds
        this.symbol = symbol;
        this.callback = callback;
    }

    public processTrade(trade: PlotTrade): void {
        if (trade.symbol !== this.symbol) return;
        this.updateRecentTrades(trade);
        this.updateVolumeHeatMap(trade);
        const timeframe = this.getTimeframe(trade.time);
        this.detectAbsorption(trade, timeframe);
        this.checkPendingSignals(trade.time);
    }

    private updateRecentTrades(trade: PlotTrade): void {
        const currentTime = trade.time;
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
        if (trade.time - bin.lastUpdate > this.volumeWindow) {
            bin.buyVol = 0;
            bin.sellVol = 0;
        }
        if (trade.orderType === "BUY") {
            bin.buyVol += trade.quantity;
        } else {
            bin.sellVol += trade.quantity;
        }
        bin.lastUpdate = trade.time;
    }

    private detectAbsorption(trade: PlotTrade, timeframe: "Daytime" | "Nighttime"): void {
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
                    const signalType =
                        trade.orderType === "BUY"
                            ? "sell_absorption" // Buy signal
                            : "buy_absorption"; // Sell signal
                    const isInvalidated = this.checkInvalidation(
                        trade.time,
                        trade.price,
                        signalType === "sell_absorption"
                    );
                    const stopLossPercent = isInvalidated
                        ? this.invalidStopLoss
                        : this.defaultStopLoss;
                    const stopLossPrice =
                        signalType === "buy_absorption"
                            ? trade.price * (1 + stopLossPercent) // Sell: stop loss above entry
                            : trade.price * (1 - stopLossPercent); // Buy: stop loss below entry
                    const takeProfitPrice =
                        signalType === "buy_absorption"
                            ? trade.price * (1 - this.takeProfit) // Sell: take profit below entry
                            : trade.price * (1 + this.takeProfit); // Buy: take profit above entry
                    const signal: Signal = {
                        type: signalType,
                        time: trade.time,
                        price: trade.price,
                        tradeIndex: trade.tradeId,
                        isInvalidated,
                        stopLoss: stopLossPrice,
                        takeProfit: takeProfitPrice,
                        timeframe,
                    };
                    if (this.isNearHighVolume(trade.price)) {
                        // Check for opposite signal to close active trade
                        const activeTrade = this.activeTrades[timeframe];
                        if (
                            activeTrade &&
                            ((activeTrade.type === "sell_absorption" &&
                                signalType === "buy_absorption") ||
                                (activeTrade.type === "buy_absorption" &&
                                    signalType === "sell_absorption"))
                        ) {
                            const returnVal =
                                signalType === "sell_absorption"
                                    ? trade.price / activeTrade.price - 1
                                    : activeTrade.price / trade.price - 1;
                            activeTrade.closeReason =
                                returnVal > 0 ? "take_profit" : "stop_loss";
                            this.signals.push(activeTrade);
                            //if (this.callback) {
                            //    this.callback(activeTrade);
                           // }
                            this.activeTrades[timeframe] = null;
                        }
                        // Only generate new signal if no conflicting active trade
                        if (!this.activeTrades[timeframe]) {
                            console.log(
                                `${signalType} at ${new Date(signal.time).toISOString()}, ` +
                                    `Price: ${signal.price.toFixed(2)}, ` +
                                    `Quantity: ${trade.quantity.toFixed(2)} LTC, ` +
                                    `Timeframe: ${signal.timeframe}, ` +
                                    `Stop Loss: ${signal.stopLoss.toFixed(2)}, ` +
                                    `Take Profit: ${signal.takeProfit.toFixed(2)}, ` +
                                    `Invalidated: ${signal.isInvalidated}`
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
    }

    private checkInvalidation(signalTime: number, signalPrice: number, isBuySignal: boolean): boolean {
        let buyVolume = 0;
        let sellVolume = 0;
        let minPrice = signalPrice;
        let maxPrice = signalPrice;
        for (const trade of this.recentTrades) {
            if (
                signalTime < trade.time &&
                trade.time <= signalTime + this.invalidationWindow
            ) {
                if (trade.orderType === "BUY") {
                    buyVolume += trade.quantity;
                } else {
                    sellVolume += trade.quantity;
                }
                minPrice = Math.min(minPrice, trade.price);
                maxPrice = Math.max(maxPrice, trade.price);
            }
        }
        if (isBuySignal) {
            const volumeCondition = sellVolume > 2 * buyVolume && sellVolume > 0;
            const priceCondition = minPrice <= signalPrice * (1 - 0.002);
            return volumeCondition || priceCondition;
        } else {
            const volumeCondition = buyVolume > 2 * sellVolume && buyVolume > 0;
            const priceCondition = maxPrice >= signalPrice * (1 + 0.002);
            return volumeCondition || priceCondition;
        }
    }

    private checkPendingSignals(currentTime: number): void {
        while (
            this.pendingSignals.length &&
            currentTime >=
                this.pendingSignals[0].time + this.confirmationWindow
        ) {
            const signal = this.pendingSignals.shift()!;
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
            if (signal.type === "sell_absorption") {
                // Buy signal: expect price to rise
                if (maxPrice >= signal.price * (1 + this.confirmThreshold)) {
                    isConfirmed = true;
                }
            } else {
                // Sell signal: expect price to fall
                if (minPrice <= signal.price * (1 - this.confirmThreshold)) {
                    isConfirmed = true;
                }
            }
            signal.closeReason = isConfirmed ? undefined : "invalidated";
            console.log(
                `${isConfirmed ? "Confirmed" : "Invalidated"}: ` +
                    `${signal.type} at ${new Date(signal.time + this.confirmationWindow).toISOString()}, ` +
                    `Price: ${signal.price.toFixed(2)}, ` +
                    `Timeframe: ${signal.timeframe}`
            );
            if (isConfirmed) {
                this.activeTrades[signal.timeframe] = signal;
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
        volumes.sort((a, b) => a - b);
        const index = Math.floor(0.9 * volumes.length);
        return volumes[index] || 0;
    }

    private getTimeframe(timestamp: number): "Daytime" | "Nighttime" {
        const date = new Date(timestamp);
        // Convert to Lima time (UTC-5)
        const limaOffset = -5 * 60; // UTC-5 in minutes
        const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
        const limaMinutes = (utcMinutes + limaOffset + 24 * 60) % (24 * 60);
        const limaHour = Math.floor(limaMinutes / 60);
        return limaHour >= 6 && limaHour < 22 ? "Daytime" : "Nighttime";
    }

    public getSignals(): Signal[] {
        return [...this.signals];
    }

    // Method to close active trade (e.g., for end of data or external call)
    public closeActiveTrade(
        exitPrice: number,
        exitTime: number,
        tradeIndex: number,
        timeframe: "Daytime" | "Nighttime",
        reason: "take_profit" | "stop_loss" | "end_of_data"
    ): void {
        const activeTrade = this.activeTrades[timeframe];
        if (activeTrade) {
            activeTrade.closeReason = reason;
            activeTrade.price = exitPrice; // Update exit price
            activeTrade.time = exitTime; // Update exit time
            activeTrade.tradeIndex = tradeIndex;
            this.signals.push(activeTrade);
            if (this.callback) {
                this.callback(activeTrade);
            }
            this.activeTrades[timeframe] = null;
        }
    }
}
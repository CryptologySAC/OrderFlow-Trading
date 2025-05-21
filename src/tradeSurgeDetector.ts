import { SpotWebsocketAPI } from "@binance/spot";

// Interface for surge/absorption data emitted to the dashboard
interface SurgeData {
    buySellRatio: number;
    isAbsorbed: boolean;
    surgePriceRange: { start: number; end: number };
    surgeHigh: number;
    currentPrice: number;
}


export class TradeSurgeDetector { 

    private consolidationRange: { start: number; end: number; buyVolume: number; sellVolume: number; totalVolume: number; trades: { price: number; quantity: number; isBuy: boolean }[] } = {
        start: 0,
        end: 0,
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
        trades: []
    };
    private outsideRangeVolume: { above: number; below: number } = { above: 0, below: 0 };
    private burstWindow: { buyVolume: number; sellVolume: number; totalVolume: number; delta: number; high: number; trades: { price: number; quantity: number; isBuy: boolean }[] } = {
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
        delta: 0,
        high: 0,
        trades: []
    };
    private recentVolumes: { volume: number; timestamp: number }[] = [];
    private recentPrices: { price: number; timestamp: number }[] = [];
    private lastTradePrice: number = 0;
    private readonly rollingWindowMinutes: number = 15; // 15-minute rolling window
    private buySellRatio: number = 0;
    private isAbsorbed: boolean = false;
    private surgePriceRange: { start: number; end: number } = { start: 0, end: 0 };
    private surgeHigh: number = 0;
    private surgeDetected: boolean = false;
    private binSize: number = 0.1; // Bin size for consolidation range

    // constructor() {

    // }

    public addTrade(trade: SpotWebsocketAPI.TradesAggregateResponseResultInner) {
        this.processTradeUpdate(trade);
    }

    private calculateAdaptiveParameters(avgMarketDepth: number): { burstVolumeWindow: number; absorptionVolume: number; deltaThreshold: number; sharpDropThreshold: number; breakoutPriceThreshold: number; breakoutVolumeThreshold: number } {
        // Calculate average volume over the last 15 minutes
        const now = Date.now();
        const cutoffTime = now - (this.rollingWindowMinutes * 60 * 1000);
        this.recentVolumes = this.recentVolumes.filter(v => v.timestamp >= cutoffTime);
        const totalVolume = this.recentVolumes.reduce((sum, v) => sum + v.volume, 0);

        // Calculate price volatility over the last 15 minutes
        this.recentPrices = this.recentPrices.filter(p => p.timestamp >= cutoffTime);
        const priceHigh = Math.max(...this.recentPrices.map(p => p.price), this.lastTradePrice);
        const priceLow = Math.min(...this.recentPrices.map(p => p.price), this.lastTradePrice);
        const priceRange = priceHigh - priceLow;
        const volatility = priceRange / this.lastTradePrice || 0;

        // Adjust volume parameters based on volatility
        let volumeAdjustmentFactor = 1.0;
        if (volatility > 0.005) { // Volatility > 0.5%
            volumeAdjustmentFactor = 1.2; // Increase by 20%
        } else if (volatility < 0.002) { // Volatility < 0.2%
            volumeAdjustmentFactor = 0.8; // Decrease by 20%
        }

        // Adaptive parameters
        const baseBurstVolumeWindow = (totalVolume * 0.05) * volumeAdjustmentFactor;
        const burstVolumeWindow = Math.round(baseBurstVolumeWindow / 50) * 50 || 50;
        const baseAbsorptionVolume = (totalVolume * 0.025) * volumeAdjustmentFactor;
        const absorptionVolume = Math.round(baseAbsorptionVolume / 25) * 25 || 25;
        const deltaThreshold = Math.round(avgMarketDepth * 0.20) || 500;
        const sharpDropThreshold = this.lastTradePrice * 0.0025;
        const breakoutPriceThreshold = this.lastTradePrice * 0.005;
        const baseBreakoutVolumeThreshold = (totalVolume * 0.10) * volumeAdjustmentFactor;
        const breakoutVolumeThreshold = Math.round(baseBreakoutVolumeThreshold / 100) * 100 || 100;

        return {
            burstVolumeWindow,
            absorptionVolume,
            deltaThreshold,
            sharpDropThreshold,
            breakoutPriceThreshold,
            breakoutVolumeThreshold
        };
    }

    private processTradeUpdate(trade: SpotWebsocketAPI.TradesAggregateResponseResultInner): void {
        if (!trade || !trade.p || !trade.q) {
            throw new Error("Invalid trade data");
        }

        const price = parseFloat(trade.p);
        const quantity = parseFloat(trade.q);
        const isBuy = !trade.m;
        const timestamp = Date.now();

        // Update last trade price
        this.lastTradePrice = price;

        // Update recent volumes and prices for adaptive parameters
        this.recentVolumes.push({ volume: quantity, timestamp });
        this.recentPrices.push({ price, timestamp });
        const cutoffTime = timestamp - (this.rollingWindowMinutes * 60 * 1000);
        this.recentVolumes = this.recentVolumes.filter(v => v.timestamp >= cutoffTime);
        this.recentPrices = this.recentPrices.filter(p => p.timestamp >= cutoffTime);

        // Update consolidation range
        if (this.consolidationRange.trades.length === 0) {
            const binStart = Math.floor(price * 10) / 10;
            const binEnd = binStart + this.binSize;
            this.consolidationRange.start = binStart;
            this.consolidationRange.end = binEnd;
        }
        this.consolidationRange.trades.push({ price, quantity, isBuy });
        this.consolidationRange.start = Math.min(this.consolidationRange.start, Math.floor(price * 10) / 10);
        this.consolidationRange.end = Math.max(this.consolidationRange.end, Math.ceil(price * 10) / 10);
        this.consolidationRange.totalVolume += quantity;
        if (isBuy) this.consolidationRange.buyVolume += quantity;
        else this.consolidationRange.sellVolume += quantity;

        // Track outside range volume
        if (price >= this.consolidationRange.end) {
            this.outsideRangeVolume.above += quantity;
        } else if (price < this.consolidationRange.start) {
            this.outsideRangeVolume.below += quantity;
        }

        // Fetch average market depth from external source (e.g., OrderBookProcessor via shared state or API call)
        // For this example, assume avgMarketDepth is passed or hardcoded; in practice, it should be dynamically fetched
        const avgMarketDepth = 8500; // Placeholder value based on prior example

        // Calculate adaptive parameters
        const params = this.calculateAdaptiveParameters(avgMarketDepth);

        // Check for breakout
        if ((price >= this.consolidationRange.end + params.breakoutPriceThreshold && this.outsideRangeVolume.above >= params.breakoutVolumeThreshold) ||
            (price < this.consolidationRange.start - params.breakoutPriceThreshold && this.outsideRangeVolume.below >= params.breakoutVolumeThreshold)) {
            const binStart = Math.floor(price * 10) / 10;
            const binEnd = binStart + this.binSize;
            this.consolidationRange = {
                start: binStart,
                end: binEnd,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                trades: [{ price, quantity, isBuy }]
            };
            this.outsideRangeVolume = { above: 0, below: 0 };
            this.surgeDetected = false;
            this.isAbsorbed = false;
            this.buySellRatio = 0;
            this.surgePriceRange = { start: binStart, end: binEnd };
            this.surgeHigh = price;
            if (isBuy) this.consolidationRange.buyVolume += quantity;
            else this.consolidationRange.sellVolume += quantity;
            this.consolidationRange.totalVolume += quantity;
        }

        // Burst detection within consolidation range
        this.burstWindow.trades.push({ price, quantity, isBuy });
        this.burstWindow.totalVolume += quantity;
        if (isBuy) {
            this.burstWindow.buyVolume += quantity;
            this.burstWindow.delta += quantity;
        } else {
            this.burstWindow.sellVolume += quantity;
            this.burstWindow.delta -= quantity;
        }
        this.burstWindow.high = Math.max(this.burstWindow.high, price);

        // Maintain burst window
        while (this.burstWindow.totalVolume > params.burstVolumeWindow && this.burstWindow.trades.length > 0) {
            const oldestTrade = this.burstWindow.trades.shift()!;
            this.burstWindow.totalVolume -= oldestTrade.quantity;
            if (oldestTrade.isBuy) {
                this.burstWindow.buyVolume -= oldestTrade.quantity;
                this.burstWindow.delta -= oldestTrade.quantity;
            } else {
                this.burstWindow.sellVolume -= oldestTrade.quantity;
                this.burstWindow.delta += oldestTrade.quantity;
            }
            this.burstWindow.high = Math.max(...this.burstWindow.trades.map(t => t.price), 0);
        }

        // Check for surge (volume burst)
        if (this.burstWindow.delta >= params.deltaThreshold && !this.surgeDetected) {
            this.buySellRatio = this.burstWindow.sellVolume > 0 ? this.burstWindow.buyVolume / this.burstWindow.sellVolume : this.burstWindow.buyVolume > 0 ? Infinity : 0;
            this.surgeDetected = this.buySellRatio > 3.5;
            this.surgePriceRange = { start: this.consolidationRange.start, end: this.consolidationRange.end };
            this.surgeHigh = this.burstWindow.high;
        }

        // Absorption check after surge
        if (this.surgeDetected && !this.isAbsorbed) {
            let postSurgeVolume = 0;
            let postSurgeHigh = this.surgeHigh;
            let postSurgeBuyVolume = 0;
            let postSurgeSellVolume = 0;
            let index = this.consolidationRange.trades.length - 1;
            while (index >= 0 && postSurgeVolume < params.absorptionVolume) {
                const t = this.consolidationRange.trades[index];
                postSurgeVolume += t.quantity;
                if (t.isBuy) postSurgeBuyVolume += t.quantity;
                else postSurgeSellVolume += t.quantity;
                postSurgeHigh = Math.max(postSurgeHigh, t.price);
                // Check for sharp drop
                if (index > 0) {
                    const prevTrade = this.consolidationRange.trades[index - 1];
                    const priceDrop = prevTrade.price - t.price;
                    if (priceDrop >= params.sharpDropThreshold && postSurgeSellVolume > postSurgeBuyVolume) {
                        this.isAbsorbed = true;
                        break;
                    }
                }
                index--;
            }
            if (postSurgeHigh <= this.surgeHigh) {
                this.isAbsorbed = true;
            }
        }
    }
        // this.emitSurgeDataToAll();
        public emitSurgeData(client: WebSocket): void {
        const surgeData: SurgeData = {
            buySellRatio: this.buySellRatio,
            isAbsorbed: this.isAbsorbed,
            surgePriceRange: this.surgePriceRange,
            surgeHigh: this.surgeHigh,
            currentPrice: this.lastTradePrice
        };
        client.send(JSON.stringify(surgeData));
    
    }
    

}
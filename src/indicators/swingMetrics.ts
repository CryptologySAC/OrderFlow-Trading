import { TradeData } from "../utils/utils.js";

export interface VolumeProfile {
    buy: number;
    sell: number;
    timestamp: number;
}

export interface VolumeNodes {
    poc: number;
    hvn: number[];
    lvn: number[];
}

export class SwingMetrics {
    private readonly volumeProfile = new Map<number, VolumeProfile>();
    private readonly priceRangePercent = 0.02;
    private readonly binSize = 0.1; // 0.1 USDT bins
    private readonly retentionMs = 1800000; // 30 minutes

    public addTrade(trade: TradeData): void {
        const priceLevel =
            Math.round(trade.price / this.binSize) * this.binSize;
        const aggressorIsBuy = !trade.buyerIsMaker;
        const existing = this.volumeProfile.get(priceLevel);

        if (existing) {
            if (aggressorIsBuy) {
                existing.buy += trade.quantity;
            } else {
                existing.sell += trade.quantity;
            }
            existing.timestamp = trade.timestamp;
        } else {
            this.volumeProfile.set(priceLevel, {
                buy: aggressorIsBuy ? trade.quantity : 0,
                sell: aggressorIsBuy ? 0 : trade.quantity,
                timestamp: trade.timestamp,
            });
        }

        this.cleanup();
    }

    public getVolumeNodes(currentPrice: number): VolumeNodes {
        const range = currentPrice * this.priceRangePercent;
        const minPrice = currentPrice - range;
        const maxPrice = currentPrice + range;

        const nodesInRange: Array<{ price: number; volume: number }> = [];

        for (const [price, profile] of this.volumeProfile) {
            if (price >= minPrice && price <= maxPrice) {
                nodesInRange.push({
                    price,
                    volume: profile.buy + profile.sell,
                });
            }
        }

        if (nodesInRange.length === 0) {
            return { poc: currentPrice, hvn: [], lvn: [] };
        }

        nodesInRange.sort((a, b) => b.volume - a.volume);

        const poc = nodesInRange[0].price;
        const totalVolume = nodesInRange.reduce((sum, n) => sum + n.volume, 0);
        const avgVolume = totalVolume / nodesInRange.length;

        const hvn = nodesInRange
            .filter((n) => n.volume > avgVolume * 1.5)
            .map((n) => n.price);

        const lvn = nodesInRange
            .filter((n) => n.volume < avgVolume * 0.5)
            .map((n) => n.price);

        return { poc, hvn, lvn };
    }

    public getStats(): { levels: number; oldestEntry: number } {
        let oldest = Date.now();
        for (const profile of this.volumeProfile.values()) {
            if (profile.timestamp < oldest) {
                oldest = profile.timestamp;
            }
        }
        return {
            levels: this.volumeProfile.size,
            oldestEntry: oldest,
        };
    }

    private cleanup(): void {
        const cutoff = Date.now() - this.retentionMs;
        const toDelete: number[] = [];

        for (const [price, profile] of this.volumeProfile) {
            if (profile.timestamp < cutoff) {
                toDelete.push(price);
            }
        }

        for (const price of toDelete) {
            this.volumeProfile.delete(price);
        }
    }
}

import { Signal } from "./interfaces";
import { SpotWebsocketAPI } from "@binance/spot";

interface Trade {
    tradeTimeMs: number; // Timestamp in milliseconds
    quantity: number;
    isBuyerMaker: boolean;
    sizeLabel75: string;
}

interface FlowMetrics {
    net_volume: number;
    start_time_ms: number | null;
    end_time_ms: number | null;
    imbalance_ratio: number;
    pressure: number;
    reversal_volume: number;
    trade_intensity: number;
    total_lt_volume: number;
}

class ShpFlowDetector {
    private trades: Trade[] = [];
    private signalCallback: (signal: Signal) => void;
    private readonly flowWindowSeconds: number;
    private readonly maxFlowPeriodSeconds: number;
    private readonly reversalWindowSeconds: number;
    private readonly proximityWindowSeconds: number;
    private minVolume: number;
    private minNetVolume: number;
    private volumeWindow: { startTimeMs: number; endTimeMs: number; volume: number }[] = [];
    private lastThresholdUpdateMs: number | null = null;
    private lastVolumeUpdateMs: number | null = null;
    private pendingTradeVolume: number = 0;
    private readonly THRESHOLD_UPDATE_INTERVAL_MS: number = 5 * 60 * 1000; // 5 minutes
    private readonly VOLUME_UPDATE_INTERVAL_MS: number = 1000; // Update every 1 second
    private readonly VOLUME_LOOKBACK_HOURS: number = 24;
    private readonly WINDOW_SECONDS: number = 60;

    constructor(
        signalCallback: (signal: Signal) => void,
        flowWindowSeconds: number = 60,
        maxFlowPeriodSeconds: number = 120,
        reversalWindowSeconds: number = 15,
        proximityWindowSeconds: number = 10
    ) {
        this.signalCallback = signalCallback;
        this.flowWindowSeconds = flowWindowSeconds;
        this.maxFlowPeriodSeconds = maxFlowPeriodSeconds;
        this.reversalWindowSeconds = reversalWindowSeconds;
        this.proximityWindowSeconds = proximityWindowSeconds;
        // Initialize with default values; will be updated dynamically
        this.minVolume = 50;
        this.minNetVolume = 37.5;
    }

    public addTrade(trade: SpotWebsocketAPI.TradesAggregateResponseResultInner): void {
        // Validate trade
        if ((trade.q ?? 0 ) as number < 0) {
            throw new Error("Trade quantity must be non-negative");
        }
        if (this.trades.length > 0 && (trade.T ?? 0 ) as number < this.trades[this.trades.length - 1].tradeTimeMs) {
            throw new Error("Trades must be added in chronological order");
        }

        // Add the new trade to the internal array
        let processedTrade: Trade = {
            tradeTimeMs: (trade.T ?? 0) as number,
            quantity: (trade.q ?? 0) as number,
            isBuyerMaker: trade.m ?? false,
            sizeLabel75: "75-100" // Placeholder; actual logic to determine this should be implemented
        }
        this.trades.push(processedTrade);

        // Prune old trades to maintain a sliding window
        const windowEndMs = processedTrade.tradeTimeMs;
        const overallWindowStartMs = windowEndMs - (this.maxFlowPeriodSeconds + this.reversalWindowSeconds) * 1000;
        while (this.trades.length > 0 && this.trades[0].tradeTimeMs < overallWindowStartMs) {
            this.trades.shift();
        }

        // Update volume window for threshold calculation
        this.updateVolumeWindow(processedTrade);

        // Update minVolume and minNetVolume periodically
        if (!this.lastThresholdUpdateMs || 
            (windowEndMs - this.lastThresholdUpdateMs) >= this.THRESHOLD_UPDATE_INTERVAL_MS) {
            this.updateThresholds(windowEndMs);
            this.lastThresholdUpdateMs = windowEndMs;
        }

        // Process the trade for potential signals
        this.checkShpFlow(windowEndMs);
    }

    private updateVolumeWindow(trade: Trade): void {
        const windowEndMs = trade.tradeTimeMs;
        this.pendingTradeVolume += trade.quantity;

        if (!this.lastVolumeUpdateMs || 
            (windowEndMs - this.lastVolumeUpdateMs) >= this.VOLUME_UPDATE_INTERVAL_MS) {
            const windowStartMs = windowEndMs - this.WINDOW_SECONDS * 1000;
            const lastWindow = this.volumeWindow.length > 0 ? this.volumeWindow[this.volumeWindow.length - 1] : null;
            if (lastWindow && lastWindow.startTimeMs === windowStartMs) {
                lastWindow.volume += this.pendingTradeVolume;
            } else {
                this.volumeWindow.push({
                    startTimeMs: windowStartMs,
                    endTimeMs: windowEndMs,
                    volume: this.pendingTradeVolume
                });
            }
            this.pendingTradeVolume = 0;
            this.lastVolumeUpdateMs = windowEndMs;

            // Prune old windows
            const lookbackStartMs = windowEndMs - this.VOLUME_LOOKBACK_HOURS * 60 * 60 * 1000;
            while (this.volumeWindow.length > 0 && this.volumeWindow[0].endTimeMs < lookbackStartMs) {
                this.volumeWindow.shift();
            }
        }
    }

    private quickSelect(arr: number[], k: number): number {
        if (arr.length === 0) return 50; // Default value
        const pivot = arr[Math.floor(Math.random() * arr.length)];
        const left: number[] = [];
        const right: number[] = [];
        const equal: number[] = [];
        for (const val of arr) {
            if (val < pivot) left.push(val);
            else if (val > pivot) right.push(val);
            else equal.push(val);
        }
        if (k < left.length) return this.quickSelect(left, k);
        if (k < left.length + equal.length) return pivot;
        return this.quickSelect(right, k - left.length - equal.length);
    }

    private updateThresholds(windowEndMs: number): void {
        const lookbackStartMs = windowEndMs - this.VOLUME_LOOKBACK_HOURS * 60 * 60 * 1000;
        const relevantWindows = this.volumeWindow.filter(w => 
            w.endTimeMs <= windowEndMs && w.endTimeMs >= lookbackStartMs
        );
        const volumes = relevantWindows.map(w => w.volume);
        if (volumes.length === 0) {
            this.minVolume = 50;
            this.minNetVolume = 37.5;
            return;
        }
        const index = Math.floor(volumes.length * 0.9);
        this.minVolume = this.quickSelect([...volumes], index) || 50;
        this.minNetVolume = this.minVolume * 0.75;
    }

    private checkShpFlow(windowEndMs: number): void {
        // Define overall window: 120 seconds for flow + 15 seconds for reversal
        const overallWindowStartMs = windowEndMs - (this.maxFlowPeriodSeconds + this.reversalWindowSeconds) * 1000;
        const overallWindowTrades = this.trades.filter(t => 
            t.tradeTimeMs >= overallWindowStartMs && t.tradeTimeMs <= windowEndMs
        );

        if (overallWindowTrades.length === 0) {
            return;
        }

        // Define flow window search range (last 120 seconds before windowEndMs)
        const flowSearchEndMs = windowEndMs;
        const flowSearchStartMs = windowEndMs - this.maxFlowPeriodSeconds * 1000;

        // Initialize variables to track the strongest flow
        let maxBuyFlow: FlowMetrics = {
            net_volume: -Infinity,
            start_time_ms: null,
            end_time_ms: null,
            imbalance_ratio: 0.0,
            pressure: 0.0,
            reversal_volume: 0.0,
            trade_intensity: 0.0,
            total_lt_volume: 0.0
        };
        let maxSellFlow: FlowMetrics = {
            net_volume: -Infinity,
            start_time_ms: null,
            end_time_ms: null,
            imbalance_ratio: 0.0,
            pressure: 0.0,
            reversal_volume: 0.0,
            trade_intensity: 0.0,
            total_lt_volume: 0.0
        };

        // Scan for the strongest 60-second flow window within the last 120 seconds
        let currentStartMs = flowSearchStartMs;
        const windowData: Array<{
            start_time_ms: number;
            end_time_ms: number;
            net_buy_volume: number;
            net_sell_volume: number;
            buy_sell_ratio: number;
            sell_buy_ratio: number;
            total_lt_volume: number;
        }> = [];

        while (currentStartMs <= flowSearchEndMs - this.flowWindowSeconds * 1000) {
            const currentEndMs = currentStartMs + this.flowWindowSeconds * 1000;
            const flowTrades = overallWindowTrades.filter(t => 
                t.tradeTimeMs >= currentStartMs && t.tradeTimeMs < currentEndMs
            );

            if (flowTrades.length === 0) {
                currentStartMs += 1000; // Increment by 1 second
                continue;
            }

            // Compute volume metrics in a single pass
            let buyLtVolume = 0;
            let sellLtVolume = 0;
            let numLtTrades = 0;
            let totalLtVolume = 0;
            for (const t of flowTrades) {
                if (t.sizeLabel75 === '75-100') {
                    if (!t.isBuyerMaker) {
                        buyLtVolume += t.quantity;
                    } else {
                        sellLtVolume += t.quantity;
                    }
                    numLtTrades++;
                    totalLtVolume += t.quantity;
                }
            }
            const netBuyingVolume = buyLtVolume - sellLtVolume;
            const netSellingVolume = sellLtVolume - buyLtVolume;

            // Compute buy/sell imbalance ratio
            const buySellRatio = sellLtVolume > 0 ? buyLtVolume / sellLtVolume : Number.MAX_SAFE_INTEGER;
            const sellBuyRatio = buyLtVolume > 0 ? sellLtVolume / buyLtVolume : Number.MAX_SAFE_INTEGER;

            // Compute trade intensity
            const meanLtVolume = numLtTrades > 0 ? totalLtVolume / numLtTrades : 0.0;
            const tradeIntensity = numLtTrades * meanLtVolume;
            const normalizedTradeIntensity = tradeIntensity / this.flowWindowSeconds;

            // Store window data for cumulative pressure
            windowData.push({
                start_time_ms: currentStartMs,
                end_time_ms: currentEndMs,
                net_buy_volume: netBuyingVolume,
                net_sell_volume: netSellingVolume,
                buy_sell_ratio: buySellRatio,
                sell_buy_ratio: sellBuyRatio,
                total_lt_volume: buyLtVolume + sellLtVolume
            });

            // Update strongest buying flow
            if (buyLtVolume >= this.minVolume && netBuyingVolume >= this.minNetVolume) {
                if (netBuyingVolume > maxBuyFlow.net_volume) {
                    maxBuyFlow = {
                        net_volume: netBuyingVolume,
                        start_time_ms: currentStartMs,
                        end_time_ms: currentEndMs,
                        imbalance_ratio: buySellRatio,
                        trade_intensity: normalizedTradeIntensity,
                        total_lt_volume: buyLtVolume + sellLtVolume,
                        pressure: 0.0,
                        reversal_volume: 0.0
                    };
                }
            }

            // Update strongest selling flow
            if (sellLtVolume >= this.minVolume && netSellingVolume >= this.minNetVolume) {
                if (netSellingVolume > maxSellFlow.net_volume) {
                    maxSellFlow = {
                        net_volume: netSellingVolume,
                        start_time_ms: currentStartMs,
                        end_time_ms: currentEndMs,
                        imbalance_ratio: sellBuyRatio,
                        trade_intensity: normalizedTradeIntensity,
                        total_lt_volume: buyLtVolume + sellLtVolume,
                        pressure: 0.0,
                        reversal_volume: 0.0
                    };
                }
            }

            currentStartMs += 1000; // Increment by 1 second
        }

        // Compute cumulative pressure for both flows in a single pass
        let buyPressure = 0.0;
        let sellPressure = 0.0;
        if (windowData.length > 0) {
            for (const window of windowData) {
                const timeInterval = (window.end_time_ms - window.start_time_ms) / 1000;
                if (maxBuyFlow.start_time_ms !== null && window.start_time_ms >= maxBuyFlow.start_time_ms - 60 * 1000) {
                    buyPressure += window.net_buy_volume * timeInterval;
                }
                if (maxSellFlow.start_time_ms !== null && window.start_time_ms >= maxSellFlow.start_time_ms - 60 * 1000) {
                    sellPressure += window.net_sell_volume * timeInterval;
                }
            }
            if (maxBuyFlow.start_time_ms !== null) maxBuyFlow.pressure = buyPressure;
            if (maxSellFlow.start_time_ms !== null) maxSellFlow.pressure = sellPressure;
        }

        // Check for reversal and compute post-reversal net volume
        const patterns: string[] = [];
        if (maxBuyFlow.start_time_ms !== null || maxSellFlow.start_time_ms !== null) {
            const flowEndMs = maxBuyFlow.start_time_ms !== null ? maxBuyFlow.end_time_ms! : maxSellFlow.end_time_ms!;
            const reversalStartMs = flowEndMs;
            const reversalEndMs = reversalStartMs + this.reversalWindowSeconds * 1000;
            const reversalTrades = overallWindowTrades.filter(t => 
                t.tradeTimeMs >= reversalStartMs && t.tradeTimeMs <= reversalEndMs
            );

            const proximityStartMs = Math.min(
                maxBuyFlow.start_time_ms !== null ? maxBuyFlow.start_time_ms : Infinity,
                maxSellFlow.start_time_ms !== null ? maxSellFlow.start_time_ms : Infinity
            ) - this.proximityWindowSeconds * 1000;
            const proximityEndMs = flowEndMs + this.proximityWindowSeconds * 1000;
            const proximityTrades = overallWindowTrades.filter(t => 
                t.tradeTimeMs >= proximityStartMs && t.tradeTimeMs <= proximityEndMs
            );
            const hasLtProximity = proximityTrades.some(t => t.sizeLabel75 === '75-100');

            if (hasLtProximity) {
                if (maxBuyFlow.start_time_ms !== null) {
                    const hasReversal = reversalTrades.some(t => 
                        t.sizeLabel75 === '75-100' && t.isBuyerMaker
                    );
                    if (hasReversal) {
                        let postReversalBuy = 0;
                        let postReversalSell = 0;
                        for (const t of reversalTrades) {
                            if (t.sizeLabel75 === '75-100') {
                                if (!t.isBuyerMaker) {
                                    postReversalBuy += t.quantity;
                                } else {
                                    postReversalSell += t.quantity;
                                }
                            }
                        }
                        maxBuyFlow.reversal_volume = postReversalBuy - postReversalSell;
                        patterns.push("ImbalanceFlowBuys-SignificantSell");
                    }
                }
                if (maxSellFlow.start_time_ms !== null) {
                    const hasReversal = reversalTrades.some(t => 
                        t.sizeLabel75 === '75-100' && !t.isBuyerMaker
                    );
                    if (hasReversal) {
                        let postReversalBuy = 0;
                        let postReversalSell = 0;
                        for (const t of reversalTrades) {
                            if (t.sizeLabel75 === '75-100') {
                                if (!t.isBuyerMaker) {
                                    postReversalBuy += t.quantity;
                                } else {
                                    postReversalSell += t.quantity;
                                }
                            }
                        }
                        maxSellFlow.reversal_volume = postReversalBuy - postReversalSell;
                        patterns.push("ImbalanceFlowSells-SignificantBuy");
                    }
                }
            }
        }

        // Determine the flow window to return (based on detected patterns)
        if (patterns.length === 0) {
            return;
        }
        let activeFlow: FlowMetrics | null = null;
        if (patterns[0] === "ImbalanceFlowBuys-SignificantSell") {
            activeFlow = maxBuyFlow;
        } else if (patterns[0] === "ImbalanceFlowSells-SignificantBuy") {
            activeFlow = maxSellFlow;
        }

        if (!activeFlow) {
            return;
        }

        // Emit the signal via callback
        const signal: Signal = {
            type: "flow",
            time: windowEndMs, // Timestamp in milliseconds
        };
        this.signalCallback(signal);
    }
}

export { ShpFlowDetector, Trade, Signal };
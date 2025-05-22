/*

import { BinanceDataFeed } from "./binance";
import { Storage } from "./storage";
import { OrderBookProcessor } from "./orderBookProcessor";
import { SpotWebsocketStreams, SpotWebsocketAPI } from "@binance/spot";
import dotenv from "dotenv";
import { PlotTrade, Signal } from "./interfaces";
import { Server } from "ws";
import { OrderFlowAnalyzer } from "./orderflow";
// import { ShpFlowDetector } from "./shp-flow-detector";

dotenv.config();

export class BinanceStream {
    private readonly binanceFeed: BinanceDataFeed;
    private readonly symbol: string;
    private readonly storageTime: number;
    private readonly storage: Storage;
    private readonly orderBookProcessor: OrderBookProcessor;
    private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        [];
    // private readonly lastFeedState: FeedState;
    private thresholdTime: number;
    private readonly orderFlowAnalyzer: OrderFlowAnalyzer;
    private readonly wsPort: number = (process.env.WS_PORT ?? 3001) as number;
    private readonly BroadCastWebSocket: Server;
    // private readonly shpFlowDetector: ShpFlowDetector;

    constructor() {
        // Initialize the Binance stream client
        this.binanceFeed = new BinanceDataFeed();
        this.orderBookProcessor = new OrderBookProcessor();
        this.symbol = process.env.SYMBOL ?? "ltcusdt"; // Default to ltcusdt if not provided
        this.storage = new Storage();
        this.storageTime = (process.env.MAX_STORAGE_TIME ??
            1000 * 60 * 90) as number; // 90 mins in ms

        // this.lastFeedState = this.storage.getLastFeedState();
        this.thresholdTime = Date.now() - this.storageTime; // >
        // this.lastFeedState.lastAggregatedTradeTime
        //    ? Date.now() - this.storageTime
        //    : this.lastFeedState.lastAggregatedTradeTime; // Max 24 hours or what is last stored
        this.orderFlowAnalyzer = new OrderFlowAnalyzer(
            10,
            0.005,
            70,
            20 * 60 * 1000,
            0.004,
            0.005,
            0.025,
            "LTCUSDT",
            (signal) => {
                console.log(signal); // this.broadcastSignal(signal);
            }
        );
        // this.shpFlowDetector = new ShpFlowDetector((signal) => {
        // this.broadcastSignal(signal);
        // });
        this.BroadCastWebSocket = new Server({ port: this.wsPort });

        this.BroadCastWebSocket.on("connection", (ws) => {
            console.log("Client connected");

            ws.on("close", () => console.log("Client disconnected"));
            ws.on("message", (message) => {
                try {
                    const request = JSON.parse(message.toString());
                    if (request.type === "ping") {
                        ws.send(JSON.stringify({ type: "pong" }));
                    }
                    if (request.type === "backlog") {
                        const amount: number = (request.data.amount ??
                            1000) as number;
                        console.log("Backlog request received: ", amount);
                        let backlog = this.requestBacklog(amount);
                        backlog = backlog.reverse(); // set the order to the oldest trade first
                        ws.send(
                            JSON.stringify({
                                type: "backlog",
                                data: backlog /*, signals: backLogSignals * /,
                                now: Date.now(),
                            })
                        );
                    }
                } catch (err) {
                    console.error("Invalid message format", err);
                }
            });
        });
    }

    private async fillBacklog() {
        console.log(
            "Requesting backlog for %s hours",
            this.storageTime / 3600000
        );
        try {
            while (this.thresholdTime < Date.now()) {
                const aggregatedTrades: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                    await this.binanceFeed.fetchAggTradesByTime(
                        this.symbol,
                        this.thresholdTime
                    );
                aggregatedTrades.forEach(
                    (
                        trade: SpotWebsocketAPI.TradesAggregateResponseResultInner
                    ) => {
                        if (
                            trade.T !== undefined &&
                            trade.T > this.thresholdTime
                        ) {
                            this.thresholdTime = trade.T;
                            this.storage.saveAggregatedTrade(
                                trade,
                                this.symbol
                            );
                            // this.shpFlowDetector.addTrade(trade);
                        }
                    }
                );

                if (aggregatedTrades.length < 10) {
                    throw new Error("No more trades available");
                }
                console.log(
                    "THRESHOLD TIME: %s (now: %s, diff: %s)",
                    this.thresholdTime,
                    Date.now(),
                    Date.now() - this.thresholdTime
                );
            }
        } catch (error) {
            console.warn("Backlog filled:", error);
        }
    }

    private requestBacklog(amount: number): PlotTrade[] {
        const backLog: PlotTrade[] = [];
        this.aggTradeTemp = this.storage.getLatestAggregatedTrades(
            amount,
            this.symbol
        );
        this.aggTradeTemp.forEach(
            (trade: SpotWebsocketAPI.TradesAggregateResponseResultInner) => {
                const plotTrade: PlotTrade = {
                    time: trade.T !== undefined ? trade.T : 0, // Millisecond precision
                    price: trade.p !== undefined ? parseFloat(trade.p) : 0,
                    quantity: trade.q !== undefined ? parseFloat(trade.q) : 0,
                    orderType: trade.m ? "SELL" : "BUY",
                    symbol: this.symbol,
                    tradeId: trade.a !== undefined ? trade.a : 0,
                };
                backLog.push(plotTrade);
            }
        );
        return backLog;
    }

    private async getTrades() {
        const connection = await this.binanceFeed.connectToStreams();

        connection.on("close", async () => {
            this.getTrades();
        });

        try {
            const streamAggTrade = connection.aggTrade({ symbol: this.symbol });
            const streamDepth = connection.diffBookDepth({
                symbol: this.symbol,
                updateSpeed: "1000ms",
            });

            streamDepth.on(
                "message",
                (data: SpotWebsocketStreams.DiffBookDepthResponse) => {
                    const processedData: SpotWebsocketAPI.DepthResponseResult =
                        {
                            lastUpdateId: data.u,
                            bids: data.b,
                            asks: data.a,
                        };
                    this.orderBookProcessor.processWebSocketUpdate(
                        processedData
                    );
                }
            );

            streamAggTrade.on(
                "message",
                (data: SpotWebsocketStreams.AggTradeResponse) => {
                    // console.info(data);
                    const plotTrade: PlotTrade = {
                        time: data.T !== undefined ? data.T : 0, // Millisecond precision
                        price: data.p !== undefined ? parseFloat(data.p) : 0,
                        quantity: data.q !== undefined ? parseFloat(data.q) : 0,
                        orderType: data.m ? "SELL" : "BUY",
                        symbol: this.symbol,
                        tradeId: data.a !== undefined ? data.a : 0,
                    };

                    this.storage.saveAggregatedTrade(data, this.symbol);
                    this.orderFlowAnalyzer.processTrade(plotTrade);

                    try {
                        // Broadcast trade to all connected clients
                        this.BroadCastWebSocket.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(
                                    JSON.stringify({
                                        type: "trade",
                                        data: plotTrade,
                                        now: Date.now(),
                                    })
                                );
                            }
                        });
                    } catch (error) {
                        console.error("Error broadcasting trade:", error);
                    }
                }
            );
        } catch (error) {
            console.error("Error connecting to streams:", error);
        }
    }

    public async broadcastSignal(signal: Signal) {
        console.log("Broadcasting signal:", signal);
        // Send the signal to the webhook URL
        const webhookUrl = process.env.WEBHOOK_URL;
        if (webhookUrl) {
            const message = {
                type:
                    signal.type === "buy_absorption"
                        ? "Sell signal"
                        : "Buy signal",
                time: signal.time,
                price: signal.price,
                takeProfit: signal.takeProfit,
                stopLoss: signal.stopLoss,
                label: signal.closeReason,
            };
            await this.sendWebhookMessage(webhookUrl, message);
        } else {
            console.warn("No webhook URL provided");
        }
        // Send the signal to the connected clients
        this.BroadCastWebSocket.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(
                    JSON.stringify({
                        type: "signal",
                        data: signal,
                        now: Date.now(),
                    })
                );
            }
        });
    }

    private async sendWebhookMessage(
        webhookUrl: string,
        message: object
    ): Promise<void> {
        try {
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(message),
            });

            if (!response.ok) {
                throw new Error(
                    `Webhook request failed: ${response.status} ${response.statusText}`
                );
            }

            console.log("Webhook message sent successfully");
        } catch (error) {
            console.error("Error sending webhook message:", error);
        }
    }

    public async main() {
        try {
            await this.fillBacklog();
            await this.orderBookProcessor.fetchInitialOrderBook();
            await this.getTrades();
        } catch (error) {
            console.error("Error in main function:", error);
        }
    }
}

*/

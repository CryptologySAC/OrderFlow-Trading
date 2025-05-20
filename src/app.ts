import { BinanceDataFeed } from "./binance";
import { Storage } from "./storage";
import { SpotWebsocketStreams, SpotWebsocketAPI } from "@binance/spot";
import dotenv from "dotenv";
import {
    PlotTrade,
    // FeedState /*, MarketOrder, OrderType /*, AbsorptionLabel */,
    Signal,
} from "./interfaces";
import express from "express";
import path from "path";
import { Server } from "ws";
import { OrderFlowAnalyzer } from "./orderflow";
import { OrderBook } from "./orderBook";
import { ShpFlowDetector } from "./shp-flow-detector";

dotenv.config();

export class BinanceStream {
    private readonly binanceFeed: BinanceDataFeed;
    private readonly symbol: string;
    private readonly storageTime: number;
    private readonly storage: Storage;
    private aggTradeTemp: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
        [];
    // private readonly lastFeedState: FeedState;
    private thresholdTime: number;
    private readonly orderFlowAnalyzer: OrderFlowAnalyzer;
    private readonly app: express.Application;
    // private readonly port: number = (process.env.PORT ?? 3000) as number;
    private readonly wsPort: number = (process.env.WS_PORT ?? 3001) as number;
    private readonly BroadCastWebSocket: Server;
    private readonly shpFlowDetector: ShpFlowDetector;
    private orderBook: OrderBook = new OrderBook({
        lastUpdateId: 0,
        bids: [],
        asks: [],
    }); // Initialize with empty order book

    constructor() {
        // Initialize the Binance stream client
        this.binanceFeed = new BinanceDataFeed();
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
        this.shpFlowDetector = new ShpFlowDetector((signal) => {
            this.broadcastSignal(signal);
        });
        this.app = express();
        this.BroadCastWebSocket = new Server({ port: this.wsPort });

        this.BroadCastWebSocket.on("connection", (ws) => {
            console.log("Client connected");
            let backlog = this.requestBacklog();
            backlog = backlog.reverse(); // set the order to the oldest trade first
            ws.send(
                JSON.stringify({
                    type: "backlog",
                    data: backlog /*, signals: backLogSignals */,
                })
            );
            ws.send(
                JSON.stringify({
                    type: "orderbook",
                    data: this.orderBook.getOrderBook(),
                })
            );
            ws.on("close", () => console.log("Client disconnected"));
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
                            this.shpFlowDetector.addTrade(trade);
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
        } finally {
            // Start the webstream connection
            await this.getTrades();
        }
    }

    private async fillOrderBook() {
        try {
            const orderBookInitial: SpotWebsocketAPI.DepthResponseResult =
                await this.binanceFeed.fetchOrderBookDepth(this.symbol);
            this.orderBook = new OrderBook(orderBookInitial);
        } catch (error) {
            console.warn("OrderBook filled:", error);
        }
    }

    private requestBacklog(): PlotTrade[] {
        const backLog: PlotTrade[] = [];
        this.aggTradeTemp = this.storage.getLatestAggregatedTrades(
            20000,
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
        const connection: SpotWebsocketStreams.WebsocketStreamsConnection =
            await this.binanceFeed.connectToStreams();
        try {
            const streamAggTrade = connection.aggTrade({ symbol: this.symbol });
            /*const streamDepth = connection.diffBookDepth({ symbol: this.symbol, updateSpeed: "100ms"})

            streamDepth.on(
                "message",
                (data: SpotWebsocketStreams.DiffBookDepthResponse) => {
                    this.orderBook.updateOrderBook(data);
                    //let orderBook = this.binanceFeed.processOrderBook(data);
                    //const currentPrice = parseFloat(orderBook.asks[0]?.price || '0'); // Approximate current price
                    //const topAsksQty = orderBook.asks
                     //   .filter(level => parseFloat(level.price) <= currentPrice * 1.005)
                     //   .reduce((sum, level) => sum + parseFloat(level.quantity), 0);
                    //const topBidsQty = orderBook.bids
                     //   .filter(level => parseFloat(level.price) >= currentPrice * 0.995)
                     //   .reduce((sum, level) => sum + parseFloat(level.quantity), 0);

                    // Assume some external logic tracks the Sell Volume Surge signal
                    //const hasSellVolumeSurge = true; // Replace with actual signal detection
                    //if (hasSellVolumeSurge && topAsksQty >= 1.5 * topBidsQty) {
                    //    console.log('Confirmed Sell Volume Surge with order book: high ask quantity detected!');
                    //}     
                    
                    
                    try {
                        // Broadcast trade to all connected clients
                        this.wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(
                                    JSON.stringify({
                                        type: "orderbook",
                                        data: this.orderBook.getOrderBook(),
                                    })
                                );
                            }
                        });
                    } catch (error) {
                        console.error("Error broadcasting trade:", error);
                    }
                    
                }
            );
            */
            streamAggTrade.on(
                "message",
                (data: SpotWebsocketStreams.AggTradeResponse) => {
                    console.info(data);
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

    private async broadcastSignal(signal: Signal) {
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
        this.app.use(express.static(path.join(__dirname, "../public")));

        // this.app.listen(this.port, () => {
        //    console.log(`Server running at http://localhost:${this.port}`);
        // });

        try {
            await this.fillOrderBook();
            await this.fillBacklog();
        } catch (error) {
            console.error("Error in main function:", error);
        }
    }
}

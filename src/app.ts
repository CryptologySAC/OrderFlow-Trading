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
    private readonly port: number = 3000;
    private readonly wss: Server;

    constructor() {
        // Initialize the Binance stream client
        this.binanceFeed = new BinanceDataFeed();
        this.symbol = process.env.SYMBOL ?? "ltcusdt"; // Default to ltcusdt if not provided
        this.storage = new Storage();
        this.storageTime = (process.env.MAX_STORAGE_TIME ??
            1000 * 60 * 60 * 24 * 90) as number; // 24 hrs in ms

        // this.lastFeedState = this.storage.getLastFeedState();
        this.thresholdTime = Date.now() - this.storageTime; // >
        // this.lastFeedState.lastAggregatedTradeTime
        //    ? Date.now() - this.storageTime
        //    : this.lastFeedState.lastAggregatedTradeTime; // Max 24 hours or what is last stored
        this.orderFlowAnalyzer = new OrderFlowAnalyzer(
            4,
            0.003,
            55,
            20 * 60 * 1000,
            0.0015,
            "LTCUSDT",
            (signal) => {
                this.broadcastSignal(signal);
            }
        );
        this.app = express();
        this.wss = new Server({ port: 3001 });

        this.wss.on("connection", (ws) => {
            console.log("Client connected");
            let backlog = this.requestBacklog();
            backlog = backlog.reverse(); // set the order to the oldest trade first
            ws.send(
                JSON.stringify({
                    type: "backlog",
                    data: backlog /*, signals: backLogSignals */,
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
            // const streamTrade = connection.trade({ symbol})

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
                        this.wss.clients.forEach((client) => {
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
        this.wss.clients.forEach((client) => {
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

    public async main() {
        this.app.use(express.static(path.join(__dirname, "../public")));

        this.app.listen(this.port, () => {
            console.log(`Server running at http://localhost:${this.port}`);
        });

        try {
            await this.fillBacklog();
        } catch (error) {
            console.error("Error in main function:", error);
        }
    }
}

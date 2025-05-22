import express from "express";
import path from "path";
import { Server } from "ws";
import { SpotWebsocketStreams } from "@binance/spot";

import { TradesProcessor } from "./tradesProcessor";
import { BinanceDataFeed } from "./binance";
import { OrderBookProcessor } from "./orderBookProcessor";
import { Signal, WebSocketMessage } from "./interfaces";

export class OrderFlowDashboard {
    private readonly symbol: string = (
        process.env.SYMBOL ?? "LTCUSDT"
    ).toUpperCase();
    private readonly httpServer: express.Application = express();
    private readonly httpPort: number = (process.env.PORT ?? 3000) as number;
    private readonly binanceFeed: BinanceDataFeed;
    private readonly tradesProcessor: TradesProcessor;
    private readonly orderBookProcessor: OrderBookProcessor;

    private readonly wsPort: number = (process.env.WS_PORT ?? 3001) as number;
    private readonly BroadCastWebSocket: Server;

    constructor() {
        this.binanceFeed = new BinanceDataFeed("LTCUSDT");
        this.orderBookProcessor = new OrderBookProcessor();
        this.tradesProcessor = new TradesProcessor();

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
                        let backlog =
                            this.tradesProcessor.requestBacklog(amount);
                        backlog = backlog.reverse(); // set the order to the oldest trade first
                        ws.send(
                            JSON.stringify({
                                type: "backlog",
                                data: backlog /*, signals: backLogSignals */,
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

    private async startWebServer() {
        this.httpServer.use(express.static(path.join(__dirname, "../public")));
        this.httpServer.listen(this.httpPort, () => {
            console.log(`Server running at http://localhost:${this.httpPort}`);
        });
    }

    private async preloadTrades() {
        try {
            await this.tradesProcessor.fillBacklog();
        } catch (error) {
            console.error("Error preloading trades:", error);
        }
    }

    private async fetchInitialOrderBook() {
        try {
            this.orderBookProcessor.fetchInitialOrderBook();
        } catch (error) {
            console.error("Error preloading Order book:", error);
        }
    }

    private async broadcastMessage(message: WebSocketMessage) {
        try {
            // Broadcast trade to all connected clients
            this.BroadCastWebSocket.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(message));
                }
            });
        } catch (error) {
            console.error(error);
        }
    }

    private async getFromBinanceAPI() {
        const connection = await this.binanceFeed.connectToStreams();

        connection.on("close", async () => {
            this.getFromBinanceAPI();
        });

        try {
            const streamAggTrade = connection.aggTrade({ symbol: this.symbol });
            const streamDepth = connection.diffBookDepth({
                symbol: this.symbol,
                updateSpeed: "1000ms",
            });

            streamDepth.on(
                "message",
                async (data: SpotWebsocketStreams.DiffBookDepthResponse) => {
                    const message: WebSocketMessage =
                        this.orderBookProcessor.processWebSocketUpdate(data);
                    await this.broadcastMessage(message);
                }
            );

            streamAggTrade.on(
                "message",
                async (data: SpotWebsocketStreams.AggTradeResponse) => {
                    try {
                        const processedData: WebSocketMessage =
                            this.tradesProcessor.addTrade(data);
                        await this.broadcastMessage(processedData);
                    } catch (error) {
                        console.error("Error broadcasting trade:", error);
                    }
                }
            );
        } catch (error) {
            console.error("Error connecting to streams:", error);
        }
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

    public async startDashboard() {
        try {
            await this.startWebServer();

            // Load up our data concurrently
            const preloadTrades = this.preloadTrades();
            const fetchInitialOrderBook = this.fetchInitialOrderBook();
            const getFromBinanceAPI = this.getFromBinanceAPI();
            await Promise.all([
                preloadTrades,
                fetchInitialOrderBook,
                getFromBinanceAPI,
            ]);
            console.log("Order Flow Dashboard started successfully.");
        } catch (error) {
            console.error("Error starting Order Flow Dashboard:", error);
        }
    }
}

const processor = new OrderFlowDashboard();
processor
    .startDashboard()
    .catch((err) => console.error("Failed to start processor:", err));

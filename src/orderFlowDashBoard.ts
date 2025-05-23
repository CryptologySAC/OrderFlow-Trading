import express from "express";
import path from "path";
import { WebSocket, Server as WebSocketServer } from "ws";
import { SpotWebsocketStreams } from "@binance/spot";
import { TradesProcessor } from "./tradesProcessor";
import { BinanceDataFeed } from "./binance";
import { OrderBookProcessor } from "./orderBookProcessor";
import { Signal, WebSocketMessage } from "./interfaces";
import { Storage } from "./storage";
import { AbsorptionDetector } from "./absorptionDetector";

export class OrderFlowDashboard {
    private readonly intervalMs: number = 10 * 60 * 1000; // 10 minutes
    private readonly symbol: string = (
        process.env.SYMBOL ?? "LTCUSDT"
    ).toUpperCase();
    private readonly httpServer: express.Application = express();
    private readonly httpPort: number = parseInt(
        process.env.PORT ?? "3000",
        10
    );
    private readonly wsPort: number = parseInt(
        process.env.WS_PORT ?? "3001",
        10
    );
    private readonly BroadCastWebSocket: WebSocketServer;

    private readonly binanceFeed: BinanceDataFeed;
    private readonly tradesProcessor: TradesProcessor;
    private readonly orderBookProcessor: OrderBookProcessor;
    private readonly absorptionDetector: AbsorptionDetector;

    constructor() {
        this.binanceFeed = new BinanceDataFeed();
        this.orderBookProcessor = new OrderBookProcessor();
        this.tradesProcessor = new TradesProcessor();
        this.absorptionDetector = new AbsorptionDetector((detected) =>
            console.log(`Absorption DETECTED: ${detected}`)
        );

        this.BroadCastWebSocket = new WebSocketServer({ port: this.wsPort });

        this.BroadCastWebSocket.on("connection", (ws) => {
            console.log("Client connected");

            ws.on("close", () => console.log("Client disconnected"));

            ws.on("message", (message) => {
                try {
                    const request = JSON.parse(message.toString());
                    if (
                        typeof request !== "object" ||
                        typeof request.type !== "string"
                    ) {
                        throw new Error("Invalid request structure");
                    }

                    if (request.type === "ping") {
                        ws.send(
                            JSON.stringify({ type: "pong", now: Date.now() })
                        );
                    }

                    if (request.type === "backlog") {
                        const amount: number = parseInt(
                            request.data?.amount ?? "1000",
                            10
                        );
                        console.log("Backlog request received:", amount);
                        let backlog =
                            this.tradesProcessor.requestBacklog(amount);
                        backlog = backlog.reverse(); // Oldest trade first
                        ws.send(
                            JSON.stringify({
                                type: "backlog",
                                data: backlog,
                                now: Date.now(),
                            })
                        );
                    }
                } catch (err) {
                    console.warn("Invalid message format", err);
                }
            });
        });

        this.broadcastMessage = this.broadcastMessage.bind(this);
    }

    private async startWebServer() {
        const publicPath = path.join(__dirname, "../public");
        console.log("Serving static files from:", publicPath);
        this.httpServer.use(express.static(publicPath));
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
            console.error("Error preloading order book:", error);
        }
    }

    private sendToClients(message: WebSocketMessage) {
        this.BroadCastWebSocket.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }

    private async broadcastMessage(message: WebSocketMessage) {
        try {
            this.sendToClients(message);
        } catch (error) {
            console.error("Error broadcasting message:", error);
        }
    }

    private async getFromBinanceAPI() {
        const connection = await this.binanceFeed.connectToStreams();

        connection.on("close", async () => {
            console.log("Stream closed. Attempting reconnect in 5s...");
            setTimeout(() => this.getFromBinanceAPI(), 5000);
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
                    this.absorptionDetector.addDepth(data);
                    const message: WebSocketMessage =
                        this.orderBookProcessor.processWebSocketUpdate(data);
                    await this.broadcastMessage(message);
                }
            );

            streamAggTrade.on(
                "message",
                async (data: SpotWebsocketStreams.AggTradeResponse) => {
                    try {
                        this.absorptionDetector.addTrade(data);
                        const processedData: WebSocketMessage =
                            this.tradesProcessor.addTrade(data);
                        await this.broadcastMessage(processedData);
                    } catch (error) {
                        console.error("Error broadcasting trade:", error);
                    }
                }
            );
        } catch (error) {
            console.error("Error connecting to Binance streams:", error);
        }
    }

    private async sendWebhookMessage(webhookUrl: string, message: object) {
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

        this.sendToClients({
            type: "signal",
            data: signal,
            now: Date.now(),
        });
    }

    private purgeDatabase() {
        const storage: Storage = new Storage();
        const intervalId = setInterval(() => {
            console.log(
                `[${new Date().toISOString()}] Starting scheduled purge...`
            );
            try {
                storage.purgeOldEntries();
            } catch (error) {
                console.error(
                    `[${new Date().toISOString()}] Scheduled purge failed: ${(error as Error).message}`
                );
            }
        }, this.intervalMs);

        process.on("SIGINT", () => {
            console.log("Stopping timer...");
            clearInterval(intervalId);
            process.exit();
        });
    }

    public async startDashboard() {
        try {
            await this.startWebServer();

            const preloadTrades = this.preloadTrades();
            const fetchInitialOrderBook = this.fetchInitialOrderBook();
            const getFromBinanceAPI = this.getFromBinanceAPI();

            await Promise.all([
                preloadTrades,
                fetchInitialOrderBook,
                getFromBinanceAPI,
            ]);

            this.purgeDatabase();
            console.log("Order Flow Dashboard started successfully.");
        } catch (error) {
            console.error("Error starting Order Flow Dashboard:", error);
        }
    }
}

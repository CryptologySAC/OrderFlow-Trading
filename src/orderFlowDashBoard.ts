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
import { ExhaustionDetector } from "./exhaustionDetector";
import { DeltaCVDConfirmation } from "./deltaCVDCOnfirmation";
import { SwingPredictor, SwingPrediction } from "./swingPredictor";

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
    private readonly exhaustionDetector: ExhaustionDetector;
    private readonly deltaCVDConfirmation: DeltaCVDConfirmation;

    private swingPredictor = new SwingPredictor({
        lookaheadMs: 60000,
        retraceTicks: 5,
        pricePrecision: 2,
        signalCooldownMs: 10000,
        onSwingPredicted: this.handleSwingPrediction.bind(this),
    });

    constructor() {
        this.binanceFeed = new BinanceDataFeed();
        this.orderBookProcessor = new OrderBookProcessor();
        this.tradesProcessor = new TradesProcessor();

        this.exhaustionDetector = new ExhaustionDetector(
            (data) => {
                void this.onExhaustionDetected(data).catch((err) =>
                    console.error("Exhaustion callback failed:", err)
                );
            },
            {
                windowMs: 30000, // Rolling window (e.g., 90 seconds)
                minAggVolume: 300, // Minimum LTC volume
                pricePrecision: 2, // LTCUSDT uses 2 decimals
                zoneTicks: 5, // Cluster size for zone detection
            }
        );
        this.absorptionDetector = new AbsorptionDetector(
            (data) => {
                void this.onAbsorptionDetected(data).catch((err) =>
                    console.error("Absorption callback failed:", err)
                );
            }, // callback
            {
                windowMs: 30000, // 90 seconds window
                minAggVolume: 300, // Minimum aggressive volume for detection
                pricePrecision: 2, // Use 2 decimals for LTCUSDT
                zoneTicks: 5, // Zone covers 3 price ticks
            }
        );
        this.deltaCVDConfirmation = new DeltaCVDConfirmation(
            (confirmed) => {
                const confirmedSignal: Signal = {
                    type: `${confirmed.confirmedType}_confirmed` as Signal["type"],
                    time: confirmed.time,
                    price: confirmed.price,
                    takeProfit: confirmed.price * 1.01,
                    stopLoss: confirmed.price * 0.99,
                    closeReason: confirmed.reason,
                };

                this.swingPredictor.onSignal(confirmedSignal);
                void this.broadcastSignal(confirmedSignal);
            },
            {
                lookback: 90,
                cvdLength: 20,
                slopeThreshold: 0.08,
                deltaThreshold: 30,
            }
        );

        this.BroadCastWebSocket = new WebSocketServer({ port: this.wsPort });

        this.BroadCastWebSocket.on("connection", (ws) => {
            console.log("Client connected");

            ws.on("close", () => console.log("Client disconnected"));

            ws.on("message", (message) => {
                try {
                    let request: { type: string; data?: unknown };
                    let raw: string;

                    if (typeof message === "string") {
                        raw = message;
                    } else if (message instanceof Buffer) {
                        raw = message.toString();
                    } else {
                        throw new Error("Unexpected message format");
                    }

                    const parsed: unknown = JSON.parse(raw);

                    if (!this.isWebSocketRequest(parsed)) {
                        throw new Error("Invalid request");
                    }

                    request = parsed;
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

                    if (
                        request.type === "backlog" &&
                        this.isBacklogRequest(request)
                    ) {
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

    private isWebSocketRequest(
        obj: unknown
    ): obj is { type: string; data?: unknown } {
        return (
            typeof obj === "object" &&
            obj !== null &&
            "type" in obj &&
            typeof (obj as { type: unknown }).type === "string"
        );
    }

    private isBacklogRequest(
        request: unknown
    ): request is { type: "backlog"; data: { amount: string } } {
        if (
            typeof request !== "object" ||
            request === null ||
            !("type" in request) ||
            !("data" in request)
        ) {
            return false;
        }

        const req = request as {
            type: unknown;
            data: unknown;
        };

        return (
            req.type === "backlog" &&
            typeof req.data === "object" &&
            req.data !== null &&
            "amount" in req.data &&
            typeof (req.data as { amount: unknown }).amount === "string"
        );
    }

    private startWebServer(): void {
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
            await this.orderBookProcessor.fetchInitialOrderBook();
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

    private broadcastMessage(message: WebSocketMessage): void {
        try {
            this.sendToClients(message);
        } catch (error) {
            console.error("Error broadcasting message:", error);
        }
    }

    private async getFromBinanceAPI() {
        const connection = await this.binanceFeed.connectToStreams();

        connection.on("close", (): void => {
            try {
                console.log("Stream closed. Attempting reconnect in 5s...");
                setTimeout(() => {
                    void this.getFromBinanceAPI().catch((err) => {
                        console.error("Reconnection failed:", err);
                    });
                }, 5000);
            } catch (err) {
                console.error("Error reconnecting to Binance API:", err);
            }
        });

        try {
            const streamAggTrade = connection.aggTrade({ symbol: this.symbol });
            const streamDepth = connection.diffBookDepth({
                symbol: this.symbol,
                updateSpeed: "100ms",
            });

            streamDepth.on(
                "message",
                (data: SpotWebsocketStreams.DiffBookDepthResponse): void => {
                    try {
                        this.absorptionDetector.addDepth(data);
                        this.exhaustionDetector.addDepth(data);
                        const message: WebSocketMessage =
                            this.orderBookProcessor.processWebSocketUpdate(
                                data
                            );
                        this.broadcastMessage(message);
                    } catch (error) {
                        console.error("Error broadcasting depth:", error);
                    }
                }
            );

            streamAggTrade.on(
                "message",
                (data: SpotWebsocketStreams.AggTradeResponse): void => {
                    try {
                        this.absorptionDetector.addTrade(data);
                        this.exhaustionDetector.addTrade(data);
                        this.deltaCVDConfirmation.addTrade(data);
                        this.swingPredictor.onPrice(
                            parseFloat(data.p ?? "0"),
                            data.T ?? Date.now()
                        );
                        const processedData: WebSocketMessage =
                            this.tradesProcessor.addTrade(data);
                        this.broadcastMessage(processedData);
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
                type: signal.type,
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

    private async onExhaustionDetected(detected: {
        side: "buy" | "sell";
        price: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
        totalAggressiveVolume: number;
    }) {
        const time = Date.now();
        const signal: Signal = {
            time,
            price: detected.price,
            type: "exhaustion",
            takeProfit:
                detected.price + (detected.side === "buy" ? -0.005 : 0.005), // example TP/SL logic
            stopLoss:
                detected.price + (detected.side === "buy" ? 0.005 : -0.005),
            closeReason: "exhaustion",
        };

        console.log(
            `Exhaustion DETECTED: ${JSON.stringify(detected, null, 2)}`
        );
        await this.broadcastSignal(signal);
        this.deltaCVDConfirmation.confirmSignal(
            "exhaustion",
            detected.price,
            time
        );
    }

    private async onAbsorptionDetected(detected: {
        side: "buy" | "sell";
        price: number;
        trades: SpotWebsocketStreams.AggTradeResponse[];
        totalAggressiveVolume: number;
    }) {
        const time = Date.now();
        const signal: Signal = {
            time,
            price: detected.price,
            type: "absorption",
            takeProfit:
                detected.price + (detected.side === "buy" ? -0.005 : 0.005), // example TP/SL logic
            stopLoss:
                detected.price + (detected.side === "buy" ? 0.005 : -0.005),
            closeReason: "absorption",
        };
        console.log(
            `Absorption DETECTED: ${JSON.stringify(detected, null, 2)}`
        );
        await this.broadcastSignal(signal);
        this.deltaCVDConfirmation.confirmSignal(
            "absorption",
            detected.price,
            time
        );
    }

    private handleSwingPrediction(prediction: SwingPrediction): void {
        void this.broadcastSignal(prediction);
    }

    public async startDashboard() {
        try {
            this.startWebServer();

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

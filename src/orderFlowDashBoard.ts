import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import express from "express";
import * as path from "node:path";
import * as ws from "ws";
import { SpotWebsocketStreams } from "@binance/spot";
import { TradesProcessor } from "./tradesProcessor.js";
import { BinanceDataFeed } from "./binance.js";
import { OrderBookProcessor } from "./orderBookProcessor.js";
import { Signal, WebSocketMessage, Detected } from "./interfaces.js";
import { Storage } from "./storage.js";
import { AbsorptionDetector } from "./absorptionDetector.js";
import { ExhaustionDetector } from "./exhaustionDetector.js";
import { DeltaCVDConfirmation } from "./deltaCVDCOnfirmation.js";
import { SwingPredictor, SwingPrediction } from "./swingPredictor.js";
import { parseBool } from "./utils.js";

import { EventEmitter } from "events";
EventEmitter.defaultMaxListeners = 20;

type WS = ws.WebSocket;
interface WSRequest {
    type: string;
    data?: unknown;
}
type WSHandler = (ws: WS, data?: unknown) => void | Promise<void>;

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
    private readonly BroadCastWebSocket: ws.WebSocketServer;
    private readonly storage: Storage;
    private readonly binanceFeed: BinanceDataFeed;
    private readonly tradesProcessor: TradesProcessor;
    private readonly orderBookProcessor: OrderBookProcessor;
    private readonly absorptionDetector: AbsorptionDetector;
    private readonly exhaustionDetector: ExhaustionDetector;
    private readonly deltaCVDConfirmation: DeltaCVDConfirmation;

    private swingPredictor = new SwingPredictor({
        lookaheadMs: 10000,
        retraceTicks: 1,
        pricePrecision: 2,
        signalCooldownMs: 1000,
        onSwingPredicted: this.handleSwingPrediction.bind(this),
    });

    private readonly absorptionSettings = {
        windowMs: parseInt(process.env.ABSORPTION_WINDOW_MS ?? "90000", 10),
        minAggVolume: parseInt(
            process.env.ABSORPTION_MIN_AGG_VOLUME ?? "600",
            10
        ),
        pricePrecision: parseInt(
            process.env.ABSORPTION_PRICE_PRECISION ?? "2",
            10
        ),
        zoneTicks: parseInt(process.env.ABSORPTION_ZONE_TICKS ?? "3", 10),
        eventCooldownMs: parseInt(
            process.env.ABSORPTION_EVENT_COOLDOWN_MS ?? "15000",
            10
        ),
        minInitialMoveTicks: parseInt(
            process.env.ABSORPTION_MOVE_TICKS ?? "12",
            10
        ), // Minimum ticks for initial move to consider absorption
        confirmationTimeoutMs: parseInt(
            process.env.ABSORPTION_CONFIRMATION_TIMEOUT ?? "60000",
            10
        ), // How long to wait for confirmation
        maxRevisitTicks: parseInt(
            process.env.ABSORPTION_MAX_REVISIT_TICKS ?? "5",
            10
        ),
        features: {
            spoofingDetection: parseBool(
                process.env.ABSORPTION_SPOOFING_DETECTION,
                true
            ),
            adaptiveZone: parseBool(process.env.ABSORPTION_ADAPTIVE_ZONE, true),
            passiveHistory: parseBool(
                process.env.ABSORPTION_PASSIVE_HISTORY,
                true
            ),
            multiZone: parseBool(process.env.ABSORPTION_MULTI_ZONE, true),
            priceResponse: parseBool(
                process.env.ABSORPTION_PRICE_RESPONSE,
                true
            ),
            sideOverride: parseBool(
                process.env.ABSORPTION_SIDE_OVERRIDE,
                false
            ),
            autoCalibrate: parseBool(
                process.env.ABSORPTION_AUTO_CALIBRATE,
                true
            ),
        },
    };

    private wsHandlers: Record<string, WSHandler> = {
        ping: (ws) => {
            ws.send(JSON.stringify({ type: "pong", now: Date.now() }));
        },
        backlog: (ws, data) => {
            let amount = 1000;
            if (data && typeof data === "object" && "amount" in data) {
                const rawAmount = (data as { amount?: string | number }).amount;
                amount = parseInt(rawAmount as string, 10);
                if (
                    !Number.isInteger(amount) ||
                    amount <= 0 ||
                    amount > 100000
                ) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Invalid backlog amount",
                        })
                    );
                    return;
                }
            }
            let backlog = this.tradesProcessor.requestBacklog(amount);
            backlog = backlog.reverse();
            ws.send(
                JSON.stringify({
                    type: "backlog",
                    data: backlog,
                    now: Date.now(),
                })
            );
        },
        // Add more handlers as needed
    };

    private handleWSMessage(ws: WS, message: ws.RawData) {
        let raw: string;
        try {
            if (typeof message === "string") raw = message;
            else if (message instanceof Buffer) raw = message.toString();
            else throw new Error("Unexpected message format");

            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || !("type" in parsed))
                throw new Error("Invalid message shape");

            const { type, data } = parsed as WSRequest;
            const handler = this.wsHandlers[type];
            if (!handler) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Unknown request type",
                    })
                );
                return;
            }

            Promise.resolve(handler(ws, data)).catch((err) => {
                // Local log with stack for ops/debugging
                console.error(`[WS handler error] type=${type}`, err);
                // Only message to client, never stack
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: (err as Error).message,
                    })
                );
            });
        } catch (err) {
            // Local log
            console.error("[WS message parse error]", err);
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: (err as Error).message,
                })
            );
        }
    }

    constructor(
        private delayFn: (cb: () => void, ms: number) => unknown = setTimeout
    ) {
        this.storage = new Storage();
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
            this.absorptionSettings
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
                //void this.broadcastSignal(confirmedSignal);
            },
            {
                lookback: 90,
                cvdLength: 20,
                slopeThreshold: 0.08,
                deltaThreshold: 30,
            }
        );

        this.BroadCastWebSocket = new ws.WebSocketServer({ port: this.wsPort });
        this.BroadCastWebSocket.on("connection", (ws) => {
            console.log("Client connected");
            ws.on("close", () => console.log("Client disconnected"));
            ws.on("message", (message) => this.handleWSMessage(ws, message));
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
    ): request is { type: "backlog"; data: { amount?: string } } {
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

        return req.type === "backlog" &&
            typeof req.data === "object" &&
            req.data !== null &&
            "amount" in req.data
            ? typeof (req.data as { amount: unknown }).amount === "string" ||
                  typeof (req.data as { amount: unknown }).amount ===
                      "number" ||
                  typeof (req.data as { amount: unknown }).amount ===
                      "undefined"
            : true;
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
                this.delayFn(() => {
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
            console.log("CAUGHT IN getFromBinanceAPI", error); // add this
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
        const intervalId = setInterval(() => {
            console.log(
                `[${new Date().toISOString()}] Starting scheduled purge...`
            );
            try {
                this.storage.purgeOldEntries();
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

    private async onExhaustionDetected(detected: Detected) {
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

        //console.log(
        //    `Exhaustion DETECTED: ${JSON.stringify(detected, null, 2)}`
        //);
        if (time < 0) {
            // REMOVE THIS
            await this.broadcastSignal(signal);
            this.deltaCVDConfirmation.confirmSignal(
                "exhaustion",
                detected.price,
                time
            );
        }
    }

    private async onAbsorptionDetected(detected: Detected) {
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

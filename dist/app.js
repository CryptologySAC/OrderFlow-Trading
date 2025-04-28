"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceStream = void 0;
const binance_1 = require("./binance");
const storage_1 = require("./storage");
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const ws_1 = require("ws");
const orderflow_1 = require("./orderflow");
dotenv_1.default.config();
class BinanceStream {
    binanceFeed;
    symbol;
    storageTime;
    storage;
    aggTradeTemp = [];
    // private readonly lastFeedState: FeedState;
    thresholdTime;
    orderFlowAnalyzer;
    app;
    port = 3000;
    wss;
    constructor() {
        // Initialize the Binance stream client
        this.binanceFeed = new binance_1.BinanceDataFeed();
        this.symbol = process.env.SYMBOL ?? "ltcusdt"; // Default to ltcusdt if not provided
        this.storage = new storage_1.Storage();
        this.storageTime = (process.env.MAX_STORAGE_TIME ??
            1000 * 60 * 60 * 24 * 90); // 24 hrs in ms
        // this.lastFeedState = this.storage.getLastFeedState();
        this.thresholdTime = Date.now() - this.storageTime; // >
        // this.lastFeedState.lastAggregatedTradeTime
        //    ? Date.now() - this.storageTime
        //    : this.lastFeedState.lastAggregatedTradeTime; // Max 24 hours or what is last stored
        this.orderFlowAnalyzer = new orderflow_1.OrderFlowAnalyzer(4, 0.003, 55, 20 * 60 * 1000, 0.0015, "LTCUSDT", (signal) => {
            this.broadcastSignal(signal);
        });
        this.app = (0, express_1.default)();
        this.wss = new ws_1.Server({ port: 3001 });
        this.wss.on("connection", (ws) => {
            console.log("Client connected");
            let backlog = this.requestBacklog();
            backlog = backlog.reverse(); // set the order to the oldest trade first
            ws.send(JSON.stringify({
                type: "backlog",
                data: backlog /*, signals: backLogSignals */,
            }));
            ws.on("close", () => console.log("Client disconnected"));
        });
    }
    async fillBacklog() {
        console.log("Requesting backlog for %s hours", this.storageTime / 3600000);
        try {
            while (this.thresholdTime < Date.now()) {
                const aggregatedTrades = await this.binanceFeed.fetchAggTradesByTime(this.symbol, this.thresholdTime);
                aggregatedTrades.forEach((trade) => {
                    if (trade.T !== undefined &&
                        trade.T > this.thresholdTime) {
                        this.thresholdTime = trade.T;
                        this.storage.saveAggregatedTrade(trade, this.symbol);
                    }
                });
                if (aggregatedTrades.length < 10) {
                    throw new Error("No more trades available");
                }
                console.log("THRESHOLD TIME: %s (now: %s, diff: %s)", this.thresholdTime, Date.now(), Date.now() - this.thresholdTime);
            }
        }
        catch (error) {
            console.warn("Backlog filled:", error);
        }
        finally {
            // Start the webstream connection
            await this.getTrades();
        }
    }
    requestBacklog() {
        const backLog = [];
        this.aggTradeTemp = this.storage.getLatestAggregatedTrades(20000, this.symbol);
        this.aggTradeTemp.forEach((trade) => {
            const plotTrade = {
                time: trade.T !== undefined ? trade.T : 0, // Millisecond precision
                price: trade.p !== undefined ? parseFloat(trade.p) : 0,
                quantity: trade.q !== undefined ? parseFloat(trade.q) : 0,
                orderType: trade.m ? "SELL" : "BUY",
                symbol: this.symbol,
                tradeId: trade.a !== undefined ? trade.a : 0,
            };
            backLog.push(plotTrade);
        });
        return backLog;
    }
    async getTrades() {
        const connection = await this.binanceFeed.connectToStreams();
        try {
            const streamAggTrade = connection.aggTrade({ symbol: this.symbol });
            // const streamTrade = connection.trade({ symbol})
            streamAggTrade.on("message", (data) => {
                console.info(data);
                const plotTrade = {
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
                            client.send(JSON.stringify({
                                type: "trade",
                                data: plotTrade,
                            }));
                        }
                    });
                }
                catch (error) {
                    console.error("Error broadcasting trade:", error);
                }
            });
        }
        catch (error) {
            console.error("Error connecting to streams:", error);
        }
    }
    async broadcastSignal(signal) {
        console.log("Broadcasting signal:", signal);
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "signal",
                    data: signal,
                }));
            }
        });
    }
    async main() {
        this.app.use(express_1.default.static(path_1.default.join(__dirname, "../public")));
        this.app.listen(this.port, () => {
            console.log(`Server running at http://localhost:${this.port}`);
        });
        try {
            await this.fillBacklog();
        }
        catch (error) {
            console.error("Error in main function:", error);
        }
    }
}
exports.BinanceStream = BinanceStream;
//# sourceMappingURL=app.js.map
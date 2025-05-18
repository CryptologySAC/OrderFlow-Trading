import WebSocket from 'ws';
import axios from 'axios';
import dotenv from "dotenv";

import {
    Spot,
    SPOT_WS_STREAMS_PROD_URL,
    //SPOT_WS_API_PROD_URL,
    SpotWebsocketStreams,
    SpotWebsocketAPI,
} from "@binance/spot";

import {
    ConfigurationWebsocketStreams,
    //ConfigurationWebsocketAPI,
    //WebsocketApiRateLimit,
    //WebsocketApiResponse,
} from "@binance/common";

dotenv.config();

// Interface for order book data (matching dashboard format)
interface OrderBookData {
    priceLevels: { price: number; bid: number; ask: number }[];
    ratio: number;
    supportPercent: number;
    askStable: boolean;
    bidStable: boolean;
    direction: { type: 'Down' | 'Up' | 'Stable'; probability: number };
}

// Interface for Binance REST API order book snapshot
interface BinanceOrderBookSnapshot {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
}

class OrderBookProcessor {
    //private readonly streamClient: Spot;
    //private readonly apiClient: Spot;
    private readonly configurationWebsocketStreams: ConfigurationWebsocketStreams =
        {
            wsURL: SPOT_WS_STREAMS_PROD_URL,
            compression: true,
            mode: "pool",
            poolSize: 2,
        };

    //private readonly configurationWebsocketAPI: ConfigurationWebsocketAPI = {
    //    apiKey: process.env.API_KEY ?? "",
    //    apiSecret: process.env.API_SECRET ?? "",
    //    wsURL: SPOT_WS_API_PROD_URL,
    //};
    private readonly streamClient: Spot;
    private readonly symbol: string;


    //private binanceWs: WebSocket | null = null;
    private serverWs: WebSocket.Server;
    private orderBook: { bids: Map<number, number>; asks: Map<number, number> } = {
        bids: new Map(),
        asks: new Map()
    };
    private lastUpdateId: number = 0;
    private askVolumeHistory: number[] = []; // For stability check (last 3 updates)
    private bidVolumeHistory: number[] = []; // For stability check (last 3 updates)
    private readonly binSize: number = 0.10; // 0.10 USDT bins
    private readonly numLevels: number = 5; // Top 5 bid/ask levels

    constructor(symbol:string="LTCUSDT") {
        this.streamClient = new Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });
        //this.apiClient = new Spot({
        //    configurationWebsocketAPI: this.configurationWebsocketAPI,
        //});

        this.symbol = symbol;

        // Initialize WebSocket server for browser clients (port 8080)
        this.serverWs = new WebSocket.Server({ port: 8080 });
        this.serverWs.on('connection', (ws) => {
            console.log('Browser client connected');
            // Send initial order book data on connection
            this.emitOrderBook(ws);
            ws.on('close', () => console.log('Browser client disconnected'));
        });
    }

    private async connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection> {
        const connection: SpotWebsocketStreams.WebsocketStreamsConnection =
            await this.streamClient.websocketStreams.connect();
        return connection;
    }

    // Start the order book processor
    public async start(): Promise<void> {
        try {
            // Fetch initial snapshot
            await this.fetchInitialOrderBook();
            // Connect to Binance WebSocket
            //await this.fetchOrderBookDepth(this.symbol);

            const connection: SpotWebsocketStreams.WebsocketStreamsConnection =
                await this.connectToStreams();
            const streamDepth = connection.diffBookDepth({ symbol: this.symbol, updateSpeed: "100ms"})
            streamDepth.on(
                "message",
                (response: SpotWebsocketStreams.DiffBookDepthResponse) => {
                    const data: SpotWebsocketAPI.DepthResponseResult = {
                        lastUpdateId: response.u,
                        bids: response.b,
                        asks: response.a,
                    }
                    //console.info(data);
                    this.processWebSocketUpdate(data);
                }
            );

        } catch (error) {
            console.error('Error starting OrderBookProcessor:', error);
            // Retry after 5 seconds
            setTimeout(() => this.start(), 5000);
        }
    }

    // Fetch initial order book snapshot via REST API
    private async fetchInitialOrderBook(): Promise<void> {
        const url = 'https://api.binance.com/api/v3/depth?symbol=LTCUSDT&limit=1000';
        try {
            const response = await axios.get<BinanceOrderBookSnapshot>(url);
            const snapshot = response.data;

            // Update lastUpdateId
            this.lastUpdateId = snapshot.lastUpdateId;

            // Populate order book
            snapshot.bids.forEach(([price, qty]) => {
                const priceNum = parseFloat(price);
                const qtyNum = parseFloat(qty);
                if (qtyNum > 0) this.orderBook.bids.set(priceNum, qtyNum);
            });
            snapshot.asks.forEach(([price, qty]) => {
                const priceNum = parseFloat(price);
                const qtyNum = parseFloat(qty);
                if (qtyNum > 0) this.orderBook.asks.set(priceNum, qtyNum);
            });

            console.log('Initial order book snapshot loaded:', this.lastUpdateId);
            // Emit initial order book to clients
            this.emitOrderBookToAll();
        } catch (error) {
            console.error('Error fetching initial order book:', error);
            throw error;
        }
    }    

    /**
     * Fetches aggregated trades by time range to fill gaps.
     * /
    private async fetchOrderBookDepth(
        symbol: string,
    ): Promise<void> {
        let connection;
        try {
            connection = await this.apiClient.websocketAPI.connect();
            const config: SpotWebsocketAPI.DepthRequest = {
                symbol,
                limit: 5000,
            };

            const response: WebsocketApiResponse<SpotWebsocketAPI.DepthResponse> =
                await connection.depth(config);
            const rateLimits: WebsocketApiRateLimit[] = response.rateLimits!;
            console.log("fetchOrderBookDepth() rate limits:", rateLimits);

            const data: SpotWebsocketAPI.DepthResponseResult =
                response.data as SpotWebsocketAPI.DepthResponseResult;
                console.log(
                    "fetchOrderBookDepth() bids response:",
                    data && data.bids  ? data.bids.length : "no bids"
                );
                console.log(
                    "fetchOrderBookDepth() asks response:",
                    data && data.asks  ? data.asks.length : "no asks"
                );


                this.processWebSocketUpdate(data);
        } catch (error) {
            console.error("fetchOrderBookDepth() error:", error);
        } finally {
            await connection!.disconnect();
        }
    }
    */

    // Process WebSocket update from Binance
    private processWebSocketUpdate(update: SpotWebsocketAPI.DepthResponseResult): void {
        // Ignore updates that are older than the last snapshot
        if ((update.lastUpdateId ?? -1) as number <= this.lastUpdateId) { 
            console.error('Received outdated update: %s | %s', update.lastUpdateId, this.lastUpdateId);
            return;
        }

        // Apply updates only if they are in sequence
        //if ((update.lastUpdateId ?? -1) as number <= this.lastUpdateId + 1 && (update.lastUpdateId ?? -1) as number >= this.lastUpdateId + 1) {
            this.lastUpdateId = (update.lastUpdateId ?? -1) as number;

            // Update bids
            if (update.bids && update.bids.length > 0) {
                update.bids.forEach(([price, qty]) => {
                    const priceNum = parseFloat(price);
                    const qtyNum = parseFloat(qty);
                    if (qtyNum === 0) {
                        this.orderBook.bids.delete(priceNum);
                    } else {
                        this.orderBook.bids.set(priceNum, qtyNum);
                    }
                });
            }

            // Update asks
            if (update.asks && update.asks.length > 0) {
                update.asks.forEach(([price, qty]) => {
                    const priceNum = parseFloat(price);
                    const qtyNum = parseFloat(qty);
                    if (qtyNum === 0) {
                        this.orderBook.asks.delete(priceNum);
                    } else {
                        this.orderBook.asks.set(priceNum, qtyNum);
                    }
                });
            }

            // Emit updated order book to clients
            this.emitOrderBookToAll();
        //} else {
        //    console.error('Received out-of-sequence update: %s | %s', update.lastUpdateId, this.lastUpdateId);
            // Optionally, handle re-syncing the order book here
            // For example, you could fetch a fresh snapshot and reprocess it
        //}
    }

    // Emit order book to all connected browser clients
    private emitOrderBookToAll(): void {
        this.serverWs.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                this.emitOrderBook(client);
            }
        });
    }

    // Emit processed order book to a single client
    private emitOrderBook(client: WebSocket): void {
        const processedData = this.processOrderBook();
        client.send(JSON.stringify(processedData));
        console.log('Order book data sent to client:', processedData);
    }

    // Process order book into dashboard-compatible format
    private processOrderBook(): OrderBookData {
        // Calculate current price (midpoint of best bid/ask)
        const bestBid = Math.max(...Array.from(this.orderBook.bids.keys()));
        const bestAsk = Math.min(...Array.from(this.orderBook.asks.keys()));
        const currentPrice = (bestBid + bestAsk) / 2;

        // Aggregate into 0.10 USDT bins, top 5 levels
        const priceLevels: { price: number; bid: number; ask: number }[] = [];
        for (let i = -this.numLevels; i < this.numLevels; i++) {
            const price = Math.round(currentPrice * 100 + i * 10) / 100; // 0.10 USDT bins
            const binStart = Math.floor(price * 10) / 10;
            const binEnd = binStart + this.binSize;

            // Sum bid volumes in bin
            let bidVolume = 0;
            for (const [p, qty] of this.orderBook.bids) {
                if (p >= binStart && p < binEnd) {
                    bidVolume += qty;
                }
            }

            // Sum ask volumes in bin
            let askVolume = 0;
            for (const [p, qty] of this.orderBook.asks) {
                if (p >= binStart && p < binEnd) {
                    askVolume += qty;
                }
            }

            priceLevels.push({ price: binStart, bid: bidVolume, ask: askVolume });
        }

        // Calculate total ask and bid volumes for top 5 levels
        const totalAsk = priceLevels.slice(this.numLevels).reduce((sum, level) => sum + level.ask, 0);
        const totalBid = priceLevels.slice(0, this.numLevels).reduce((sum, level) => sum + level.bid, 0);

        // Calculate metrics
        const ratio = totalAsk / (totalBid || 1);
        const supportPercent = (totalBid / (totalAsk || 1)) * 100;

        // Update volume history for stability check (last 3 updates)
        this.askVolumeHistory.push(totalAsk);
        this.bidVolumeHistory.push(totalBid);
        if (this.askVolumeHistory.length > 3) this.askVolumeHistory.shift();
        if (this.bidVolumeHistory.length > 3) this.bidVolumeHistory.shift();

        // Check stability (no >20% reduction)
        const askStable = this.askVolumeHistory.length < 3 || 
            this.askVolumeHistory.every((vol, idx) => idx === 0 || vol >= this.askVolumeHistory[idx - 1] * 0.8);
        const bidStable = this.bidVolumeHistory.length < 3 || 
            this.bidVolumeHistory.every((vol, idx) => idx === 0 || vol >= this.bidVolumeHistory[idx - 1] * 0.8);

        // Calculate direction
        let direction: { type: 'Down' | 'Up' | 'Stable'; probability: number };
        if (ratio > 2 && supportPercent < 50 && askStable) {
            direction = { type: 'Down', probability: 70 };
        } else if (ratio < 0.5 && supportPercent > 75 && bidStable) {
            direction = { type: 'Up', probability: 65 };
        } else {
            direction = { type: 'Stable', probability: 80 };
        }

        return {
            priceLevels,
            ratio,
            supportPercent,
            askStable,
            bidStable,
            direction
        };
    }
}

// Start the processor
const processor = new OrderBookProcessor();
processor.start().catch(err => console.error('Failed to start processor:', err));
import {
    Spot,
    SPOT_WS_STREAMS_PROD_URL,
    SPOT_WS_API_PROD_URL,
    SpotWebsocketStreams,
    SpotWebsocketAPI,
} from "@binance/spot";
import {
    ConfigurationWebsocketStreams,
    ConfigurationWebsocketAPI,
    WebsocketApiRateLimit,
    WebsocketApiResponse,
} from "@binance/common";
import dotenv from "dotenv";
import { OrderBookLevel, OrderBook } from "./interfaces";

dotenv.config();

export class BinanceDataFeed {
    private readonly streamClient: Spot;
    private readonly apiClient: Spot;
    private readonly configurationWebsocketStreams: ConfigurationWebsocketStreams =
        {
            wsURL: SPOT_WS_STREAMS_PROD_URL,
            compression: true,
            mode: "pool",
            poolSize: 2,
        };

    private readonly configurationWebsocketAPI: ConfigurationWebsocketAPI = {
        apiKey: process.env.API_KEY ?? "",
        apiSecret: process.env.API_SECRET ?? "",
        wsURL: SPOT_WS_API_PROD_URL,
    };

    private readonly symbol: string;

    // In-memory order book state
    private readonly orderBook: { [symbol: string]: OrderBook } = {};

    constructor(symbol: string = "ltcusdt") {
        this.streamClient = new Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });
        this.apiClient = new Spot({
            configurationWebsocketAPI: this.configurationWebsocketAPI,
        });

        this.orderBook[symbol] = {
            lastUpdateId: 0,
            bids: [],
            asks: [],
        };

        this.symbol = symbol;
    }

    public async connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection> {
        const connection: SpotWebsocketStreams.WebsocketStreamsConnection =
            await this.streamClient.websocketStreams.connect();
        return connection;
    }

    public async tradesAggregate(
        symbol: string,
        limit: number,
        fromId: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        let connection;

        try {
            connection = await this.apiClient.websocketAPI.connect();
            let config: SpotWebsocketAPI.TradesAggregateRequest;
            if (fromId > 0) {
                config = {
                    symbol,
                    limit,
                    fromId,
                };
            } else {
                config = {
                    symbol,
                    limit,
                };
            }

            const response: WebsocketApiResponse<SpotWebsocketAPI.TradesAggregateResponse> =
                await connection.tradesAggregate(config);

            const rateLimits: WebsocketApiRateLimit[] = response.rateLimits!;
            console.log("tradesAggregate() rate limits:", rateLimits);

            const data: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                response.data as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
            console.log(
                "tradesAggregate() response:",
                data ? data.length : "no results"
            );

            return data;
        } catch (error) {
            console.error("tradesAggregate() error:", error);
        } finally {
            await connection!.disconnect();
        }

        return [];
    }

    /**
     * Fetches aggregated trades by time range to fill gaps.
     */
    public async fetchAggTradesByTime(
        symbol: string,
        startTime: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        let connection;
        try {
            connection = await this.apiClient.websocketAPI.connect();
            const config: SpotWebsocketAPI.TradesAggregateRequest = {
                symbol,
                startTime,
                limit: 1000,
            };

            const response: WebsocketApiResponse<SpotWebsocketAPI.TradesAggregateResponse> =
                await connection.tradesAggregate(config);
            const rateLimits: WebsocketApiRateLimit[] = response.rateLimits!;
            console.log("fetchAggTradesByTime() rate limits:", rateLimits);

            const data: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                response.data as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
            console.log(
                "fetchAggTradesByTime() response:",
                data ? data.length : "no results"
            );

            return data;
        } catch (error) {
            console.error("tradesAggregate() error:", error);
        } finally {
            await connection!.disconnect();
        }
        return [];
    }

    /**
     * Fetches aggregated trades by time range to fill gaps.
     */
    public async fetchOrderBookDepth(
        symbol: string
    ): Promise<SpotWebsocketAPI.DepthResponseResult> {
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
                data && data.bids ? data.bids.length : "no bids"
            );
            console.log(
                "fetchOrderBookDepth() asks response:",
                data && data.asks ? data.asks.length : "no asks"
            );

            return data;
        } catch (error) {
            console.error("fetchOrderBookDepth() error:", error);
        } finally {
            await connection!.disconnect();
        }
        return {
            lastUpdateId: 0,
            bids: [],
            asks: [],
        };
    }

    public processOrderBook(
        obData: SpotWebsocketStreams.DiffBookDepthResponse
    ): OrderBook {
        const orderBook = this.orderBook[this.symbol];

        // Skip updates if the event's final update ID is not newer
        if ((obData.u ?? 0) <= orderBook.lastUpdateId) {
            return orderBook;
        }

        // Update the lastUpdateId
        orderBook.lastUpdateId = obData.u ?? 0;

        // Update bids
        if (obData.b !== undefined) {
            orderBook.bids = this.updateOrderBookLevels(
                orderBook.bids,
                obData.b
            );
            orderBook.bids = orderBook.bids.filter(
                (level) => parseFloat(level.quantity) > 0
            );
            orderBook.bids.sort(
                (a, b) => parseFloat(b.price) - parseFloat(a.price)
            ); // Sort descending
        }

        // Update asks
        if (obData.a !== undefined) {
            orderBook.asks = this.updateOrderBookLevels(
                orderBook.asks,
                obData.a
            );
            orderBook.asks = orderBook.asks.filter(
                (level) => parseFloat(level.quantity) > 0
            );
            orderBook.asks.sort(
                (a, b) => parseFloat(a.price) - parseFloat(b.price)
            ); // Sort ascending
        }

        return orderBook;
    }

    public processInitialOrderBook(
        obData: SpotWebsocketAPI.DepthResponseResult
    ): OrderBook {
        const orderBook = this.orderBook[this.symbol];

        // Skip updates if the event's final update ID is not newer
        if ((obData.lastUpdateId ?? 0) <= orderBook.lastUpdateId) {
            return orderBook;
        }

        // Update the lastUpdateId
        orderBook.lastUpdateId = obData.lastUpdateId ?? 0;

        // Update bids
        if (obData.bids !== undefined) {
            orderBook.bids = this.updateOrderBookLevels(
                orderBook.bids,
                obData.bids
            );
            orderBook.bids = orderBook.bids.filter(
                (level) => parseFloat(level.quantity) > 0
            );
            orderBook.bids.sort(
                (a, b) => parseFloat(b.price) - parseFloat(a.price)
            ); // Sort descending
        }

        // Update asks
        if (obData.asks !== undefined) {
            orderBook.asks = this.updateOrderBookLevels(
                orderBook.asks,
                obData.asks
            );
            orderBook.asks = orderBook.asks.filter(
                (level) => parseFloat(level.quantity) > 0
            );
            orderBook.asks.sort(
                (a, b) => parseFloat(a.price) - parseFloat(b.price)
            ); // Sort ascending
        }

        return orderBook;
    }

    /**
     * Updates order book levels (bids or asks) with new data from the stream.
     * @param levels Current levels (bids or asks).
     * @param updates Updates from the stream.
     * @returns Updated levels.
     */
    private updateOrderBookLevels(
        levels: OrderBookLevel[],
        updates: string[][]
    ): OrderBookLevel[] {
        const levelMap: { [price: string]: string } = {};

        // Initialize current levels into a map
        for (const level of levels) {
            levelMap[level.price] = level.quantity;
        }

        // Apply updates
        for (const [price, quantity] of updates) {
            levelMap[price] = quantity;
        }

        // Convert back to array format
        const updatedLevels: OrderBookLevel[] = [];
        for (const price in levelMap) {
            if (levelMap.hasOwnProperty(price)) {
                updatedLevels.push({
                    price,
                    quantity: levelMap[price],
                });
            }
        }

        return updatedLevels;
    }
}

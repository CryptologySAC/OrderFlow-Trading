"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceDataFeed = void 0;
const spot_1 = require("@binance/spot");
const dotenv_1 = __importDefault(require("dotenv"));
// import { Trade, AggregatedTrade } from './interfaces';
dotenv_1.default.config();
class BinanceDataFeed {
    streamClient;
    apiClient;
    configurationWebsocketStreams = {
        // apiKey: process.env.API_KEY; "Uiavf9Y6ThQmWYPPzCaPPkFOnixSbjz5W95VhULs8dIL6plxlri35vXwWn4KHX07",
        // apiSecret: process.env.API_SECRET; "rDOi9GBzE5qi1QDn8iwBclNE48IvuwfKhkbBPeoeuXF6iyMB7gY1oVOpijGyBTxD",
        wsURL: spot_1.SPOT_WS_STREAMS_PROD_URL,
        compression: true,
        mode: "pool",
        poolSize: 2,
    };
    configurationWebsocketAPI = {
        apiKey: process.env.API_KEY ?? "",
        apiSecret: process.env.API_SECRET ?? "",
        wsURL: spot_1.SPOT_WS_API_PROD_URL,
    };
    constructor() {
        this.streamClient = new spot_1.Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });
        this.apiClient = new spot_1.Spot({
            configurationWebsocketAPI: this.configurationWebsocketAPI,
        });
    }
    async connectToStreams() {
        const connection = await this.streamClient.websocketStreams.connect();
        return connection;
    }
    async tradesAggregate(symbol, limit, fromId) {
        let connection;
        try {
            connection = await this.apiClient.websocketAPI.connect();
            let config;
            if (fromId > 0) {
                config = {
                    symbol,
                    limit,
                    fromId,
                };
            }
            else {
                config = {
                    symbol,
                    limit,
                };
            }
            const response = await connection.tradesAggregate(config);
            const rateLimits = response.rateLimits;
            console.log("tradesAggregate() rate limits:", rateLimits);
            const data = response.data;
            console.log("tradesAggregate() response:", data ? data.length : "no results");
            return data;
        }
        catch (error) {
            console.error("tradesAggregate() error:", error);
        }
        finally {
            await connection.disconnect();
        }
        return [];
    }
    /**
     * Fetches aggregated trades by time range to fill gaps.
     */
    async fetchAggTradesByTime(symbol, startTime) {
        let connection;
        try {
            connection = await this.apiClient.websocketAPI.connect();
            const config = {
                symbol,
                startTime,
                limit: 1000,
            };
            const response = await connection.tradesAggregate(config);
            const rateLimits = response.rateLimits;
            console.log("fetchAggTradesByTime() rate limits:", rateLimits);
            const data = response.data;
            console.log("fetchAggTradesByTime() response:", data ? data.length : "no results");
            return data;
        }
        catch (error) {
            console.error("tradesAggregate() error:", error);
        }
        finally {
            await connection.disconnect();
        }
        return [];
    }
}
exports.BinanceDataFeed = BinanceDataFeed;
//# sourceMappingURL=binance.js.map
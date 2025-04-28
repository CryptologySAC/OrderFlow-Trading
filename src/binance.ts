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
// import { Trade, AggregatedTrade } from './interfaces';

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

    constructor() {
        this.streamClient = new Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });
        this.apiClient = new Spot({
            configurationWebsocketAPI: this.configurationWebsocketAPI,
        });
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
}

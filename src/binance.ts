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
    Logger,
    LogLevel,
} from "@binance/common";

import dotenv from "dotenv";

dotenv.config();

export class BinanceDataFeed {
    private readonly streamClient: Spot;
    private readonly apiClient: Spot;
    logger: Logger = Logger.getInstance();

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
        this.logger.setMinLogLevel(LogLevel.WARN);
        this.streamClient = new Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });

        this.apiClient = new Spot({
            configurationWebsocketAPI: this.configurationWebsocketAPI,
        });
    }

    /**
     * Connect to the Binance Spot Websocket Streams
     * @returns Promise<SpotWebsocketStreams.WebsocketStreamsConnection>
     */
    public async connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection> {
        try {
            const connection: SpotWebsocketStreams.WebsocketStreamsConnection =
                await this.streamClient.websocketStreams.connect();
            return connection;
        } catch (error) {
            throw error;
        }
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
            throw new Error(`tradesAggregate() ${error}`);
        } finally {
            await connection!.disconnect();
        }
    }

    /**
     * Fetches aggregated trades by time range to fill gaps.
     * @param symbol
     * @param startTime
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

            rateLimits.forEach((rateLimit) => {
                if (rateLimit.count > rateLimit.limit) {
                    throw new Error("Rate limits Reached");
                }
            });

            const data: SpotWebsocketAPI.TradesAggregateResponseResultInner[] =
                response.data as SpotWebsocketAPI.TradesAggregateResponseResultInner[];

            return data;
        } catch (error) {
            throw new Error(`fetchAggTradesByTime() ${error}`);
        } finally {
            await connection!.disconnect();
        }
    }
}

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
    private readonly logger: Logger;

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
        this.logger = Logger.getInstance();
        this.logger.setMinLogLevel(LogLevel.WARN);

        this.streamClient = new Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });

        this.apiClient = new Spot({
            configurationWebsocketAPI: this.configurationWebsocketAPI,
        });
    }

    public async connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection> {
        try {
            return await this.streamClient.websocketStreams.connect();
        } catch (error) {
            this.logger.error(`connectToStreams() failed: ${error}`);
            throw error;
        }
    }

    public async tradesAggregate(
        symbol: string,
        limit: number,
        fromId?: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        const config: SpotWebsocketAPI.TradesAggregateRequest = {
            symbol,
            limit,
            ...(fromId ? { fromId } : {}),
        };

        return this.executeWithApiConnection(config, "tradesAggregate");
    }

    public async fetchAggTradesByTime(
        symbol: string,
        startTime: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        const config: SpotWebsocketAPI.TradesAggregateRequest = {
            symbol,
            startTime,
            limit: 1000,
        };

        return this.executeWithApiConnection(config, "fetchAggTradesByTime");
    }

    private async executeWithApiConnection(
        config: SpotWebsocketAPI.TradesAggregateRequest,
        contextLabel: string
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        let connection;

        try {
            connection = await this.apiClient.websocketAPI.connect();
            const response: WebsocketApiResponse<SpotWebsocketAPI.TradesAggregateResponse> =
                await connection.tradesAggregate(config);

            const rateLimits: WebsocketApiRateLimit[] =
                response.rateLimits ?? [];
            this.logRateLimits(rateLimits, contextLabel);

            rateLimits.forEach((limit) => {
                if (limit.count > limit.limit) {
                    throw new Error(`[${contextLabel}] Rate limit exceeded`);
                }
            });

            const data =
                response.data as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
            this.logger.info(
                `[${contextLabel}] Received ${data?.length ?? 0} records`
            );

            return data;
        } catch (error) {
            this.logger.error(
                `[${contextLabel}] Error: ${error instanceof Error ? error.stack : error}`
            );
            throw new Error(`[${contextLabel}] ${error}`);
        } finally {
            await connection?.disconnect();
        }
    }

    private logRateLimits(
        rateLimits: WebsocketApiRateLimit[],
        context: string,
        warningThreshold = 0.8
    ): void {
        if (!rateLimits.length) {
            this.logger.info(`[${context}] No rate limits reported`);
            return;
        }

        for (const limit of rateLimits) {
            const usageRatio = limit.count / limit.limit;
            const msg = `[${context}] Rate Limit: type=${limit.rateLimitType}, interval=${limit.interval}, count=${limit.count}, limit=${limit.limit}`;

            if (usageRatio >= warningThreshold) {
                this.logger.warn(
                    `${msg} ⚠️ HIGH USAGE (${(usageRatio * 100).toFixed(1)}%)`
                );
            } else {
                this.logger.info(msg);
            }
        }
    }
}

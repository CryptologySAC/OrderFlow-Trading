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
    //WebsocketApiResponse,
    Logger,
    LogLevel,
} from "@binance/common";
import { ProductionUtils } from "./productionUtils.js";

// --- Error Types ---
export class BinanceApiError extends Error {
    constructor(
        public context: string,
        public originalError: unknown
    ) {
        super(
            `[${context}] ${originalError instanceof Error ? originalError.message : String(originalError)}`
        );
        this.name = "BinanceApiError";
    }
}

export class BinanceRateLimitError extends BinanceApiError {
    constructor(context: string, rateLimitType: string) {
        super(context, `Rate limit exceeded for ${rateLimitType}`);
        this.name = "BinanceRateLimitError";
    }
}

export class BinanceConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BinanceConfigurationError";
    }
}

export interface IBinanceDataFeed {
    connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection>;
    tradesAggregate(
        symbol: string,
        limit: number,
        fromId?: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]>;
    fetchAggTradesByTime(
        symbol: string,
        startTime: number,
        endTime: number,
        limit: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]>;
    getTrades(
        symbol: string,
        fromId: number,
        limit: number
    ): Promise<SpotWebsocketAPI.TradesHistoricalResponseResultInner[]>;
    getDepthSnapshot(
        symbol: string,
        limit?: number
    ): Promise<SpotWebsocketAPI.DepthResponseResult>;
    disconnect(): Promise<void>;
}

export class BinanceDataFeed implements IBinanceDataFeed {
    private readonly streamClient: Spot;
    private readonly apiClient: Spot;
    private readonly logger: Logger;
    private apiConnection?: SpotWebsocketAPI.WebsocketAPIConnection;
    private streamConnection?: SpotWebsocketStreams.WebsocketStreamsConnection;

    private readonly configurationWebsocketStreams: ConfigurationWebsocketStreams =
        {
            wsURL: SPOT_WS_STREAMS_PROD_URL,
            compression: true,
            mode: "pool",
            poolSize: 2,
        };

    private readonly configurationWebsocketAPI: ConfigurationWebsocketAPI = {
        apiKey: process.env["API_KEY"] ?? "",
        apiSecret: process.env["API_SECRET"] ?? "",
        wsURL: SPOT_WS_API_PROD_URL,
    };

    constructor() {
        this.validateConfiguration();

        this.logger = Logger.getInstance();
        this.logger.setMinLogLevel(LogLevel.INFO);

        this.streamClient = new Spot({
            configurationWebsocketStreams: this.configurationWebsocketStreams,
        });
        this.apiClient = new Spot({
            configurationWebsocketAPI: this.configurationWebsocketAPI,
        });
    }

    private validateConfiguration() {
        const { API_KEY, API_SECRET } = process.env;
        if (!API_KEY || !API_SECRET) {
            throw new BinanceConfigurationError(
                "Missing required API credentials: API_KEY and API_SECRET must be set"
            );
        }
        if (API_KEY.length < 10 || API_SECRET.length < 10) {
            throw new BinanceConfigurationError(
                "API_KEY and API_SECRET must look valid"
            );
        }
    }

    public async connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection> {
        try {
            if (this.streamConnection) return this.streamConnection;
            this.streamConnection =
                await this.streamClient.websocketStreams.connect();
            return this.streamConnection;
        } catch (error) {
            this.logger.error(
                `connectToStreams() failed: ${JSON.stringify(error)}`
            );
            throw new BinanceApiError("connectToStreams", error);
        }
    }

    private async getApiConnection(): Promise<SpotWebsocketAPI.WebsocketAPIConnection> {
        if (!this.apiConnection) {
            this.apiConnection = await this.apiClient.websocketAPI.connect();
        }
        return this.apiConnection;
    }

    // --- Public Data Methods ---
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
        const result = await this.executeWithRetry(() =>
            this.executeWithApiConnection(config, "tradesAggregate")
        );

        return result;
    }

    public async fetchAggTradesByTime(
        symbol: string,
        startTime: number,
        endTime: number,
        limit: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        const config: SpotWebsocketAPI.TradesAggregateRequest = {
            symbol,
            startTime,
            endTime,
            limit,
        };

        this.logger.info(
            `[fetchAggTradesByTime] Requesting trades for ${symbol}`,
            {
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                requestedDurationMinutes: (
                    (endTime - startTime) /
                    60000
                ).toFixed(2),
                limit,
                rawStartTime: startTime,
                rawEndTime: endTime,
            }
        );

        const result = await this.executeWithRetry(() =>
            this.executeWithApiConnection(config, "fetchAggTradesByTime")
        );

        this.logger.info(
            `[fetchAggTradesByTime] Received ${result.length} trades`,
            {
                symbol,
                tradesReceived: result.length,
                requestedLimit: limit,
                firstTradeTime:
                    result.length > 0
                        ? new Date(result[0]!.T || 0).toISOString()
                        : "N/A",
                lastTradeTime:
                    result.length > 0
                        ? new Date(
                              result[result.length - 1]!.T || 0
                          ).toISOString()
                        : "N/A",
                timeSpanMinutes:
                    result.length > 1
                        ? (
                              ((result[result.length - 1]!.T || 0) -
                                  (result[0]!.T || 0)) /
                              60000
                          ).toFixed(2)
                        : "N/A",
            }
        );

        return result;
    }

    public async getTrades(
        symbol: string,
        fromId: number,
        limit: number
    ): Promise<SpotWebsocketAPI.TradesHistoricalResponseResultInner[]> {
        const config: SpotWebsocketAPI.TradesHistoricalRequest = {
            symbol,
            fromId,
            limit,
        };

        const result = await this.executeWithRetry(() =>
            this.executeWithTradesConnection(config, "getTrades")
        );

        return result;
    }

    public async getDepthSnapshot(
        symbol: string,
        limit = 1000
    ): Promise<SpotWebsocketAPI.DepthResponseResult> {
        const config: SpotWebsocketAPI.DepthRequest = { symbol, limit };
        const result = await this.executeWithRetry(() =>
            this.executeWithDepthConnection(config, "getDepthSnapshot")
        );
        return result;
    }

    // --- Internal Helpers ---
    private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: Error | null = null;
        const maxRetries = 3;
        let backoff = 1000;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                if (
                    error instanceof BinanceRateLimitError &&
                    attempt < maxRetries
                ) {
                    this.logger.warn(
                        `Rate limit hit, backoff ${backoff}ms, attempt ${attempt}/${maxRetries}`
                    );
                    await ProductionUtils.sleep(backoff);
                    backoff *= 2;
                } else if (attempt === maxRetries) {
                    throw lastError;
                } else {
                    await ProductionUtils.sleep(backoff);
                }
            }
        }
        throw lastError!;
    }

    private async executeWithApiConnection(
        config: SpotWebsocketAPI.TradesAggregateRequest,
        contextLabel: string
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        try {
            const connection = await this.getApiConnection();
            const response = await connection.tradesAggregate(config);
            this.handleApiRateLimit(
                (response.rateLimits ??
                    []) as unknown as WebsocketApiRateLimit[],
                contextLabel
            );
            return this.validateTradeData(response.data);
        } catch (error) {
            this.logger.error(
                `[${contextLabel}] API error: ${JSON.stringify(error)}`
            );
            throw new BinanceApiError(contextLabel, error);
        }
    }

    private async executeWithTradesConnection(
        config: SpotWebsocketAPI.TradesHistoricalRequest,
        contextLabel: string
    ): Promise<SpotWebsocketAPI.TradesHistoricalResponseResultInner[]> {
        try {
            const connection = await this.getApiConnection();
            const response = await connection.tradesHistorical(config);
            this.handleApiRateLimit(
                (response.rateLimits ??
                    []) as unknown as WebsocketApiRateLimit[],
                contextLabel
            );
            return this.validateHistoricalTradeData(response.data.result);
        } catch (error) {
            this.logger.error(
                `[${contextLabel}] API error: ${JSON.stringify(error)}`
            );
            throw new BinanceApiError(contextLabel, error);
        }
    }

    private async executeWithDepthConnection(
        config: SpotWebsocketAPI.DepthRequest,
        contextLabel: string
    ): Promise<SpotWebsocketAPI.DepthResponseResult> {
        try {
            const connection = await this.getApiConnection();
            const response = await connection.depth(config);
            this.handleApiRateLimit(
                (response.rateLimits ??
                    []) as unknown as WebsocketApiRateLimit[],
                contextLabel
            );
            return this.validateDepthSnapshot(
                response.data as SpotWebsocketAPI.DepthResponseResult
            );
        } catch (error) {
            this.logger.error(
                `[${contextLabel}] API error: ${JSON.stringify(error)}`
            );
            throw new BinanceApiError(contextLabel, error);
        }
    }

    private handleApiRateLimit(
        rateLimits: WebsocketApiRateLimit[],
        context: string
    ) {
        for (const limit of rateLimits) {
            const usage = limit.count / limit.limit;
            if (usage >= 1.0) {
                throw new BinanceRateLimitError(context, limit.rateLimitType);
            }
            if (usage >= 0.9) {
                this.logger.warn(
                    `[${context}] Approaching rate limit: ${(usage * 100).toFixed(1)}%`
                );
            }
        }
    }

    private validateTradeData(
        data: unknown
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner[] {
        if (!Array.isArray(data)) {
            throw new Error("Invalid trade data format: expected array");
        }
        // Optionally add deeper per-item validation here
        return data as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
    }

    private validateHistoricalTradeData(
        data: unknown
    ): SpotWebsocketAPI.TradesHistoricalResponseResultInner[] {
        if (!Array.isArray(data)) {
            throw new Error("Invalid trade data format: expected array");
        }
        return data as SpotWebsocketAPI.TradesHistoricalResponseResultInner[];
    }

    private validateDepthSnapshot(
        data: unknown
    ): SpotWebsocketAPI.DepthResponseResult {
        if (!data || typeof data !== "object")
            throw new Error("Invalid depth snapshot format");
        const snap = data as SpotWebsocketAPI.DepthResponseResult;
        if (
            typeof snap.lastUpdateId !== "number" ||
            !Array.isArray(snap.bids) ||
            !Array.isArray(snap.asks)
        ) {
            throw new Error("Malformed depth snapshot");
        }
        return snap;
    }

    // --- Disconnects all resources ---
    public async disconnect(): Promise<void> {
        try {
            if (this.apiConnection) {
                await this.apiConnection.disconnect();
                this.apiConnection = undefined;
            }
            if (this.streamConnection) {
                await this.streamConnection.disconnect();
                this.streamConnection = undefined;
            }
            this.logger.info("BinanceDataFeed disconnected and cleaned up");
        } catch (error) {
            this.logger.error(
                `Error during disconnect: ${JSON.stringify(error)}`
            );
            throw new BinanceApiError("disconnect", error);
        }
    }
}

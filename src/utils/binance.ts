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

// --- Generic Cache Utility ---
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

class TimedCache<T> {
    private cache = new Map<string, CacheEntry<T>>();

    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.timestamp + entry.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key: string, data: T, ttlMs: number) {
        this.cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
    }

    clear() {
        this.cache.clear();
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.timestamp + entry.ttl) {
                this.cache.delete(key);
            }
        }
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
        startTime: number
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
    private cache = new TimedCache<unknown>();
    private readonly defaultCacheTtlMs = 5000; // 5s default cache for all endpoints

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
        this.validateConfiguration();

        this.logger = Logger.getInstance();
        this.logger.setMinLogLevel(LogLevel.WARN);

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
        const cacheKey = `tradesAggregate-${symbol}-${limit}-${fromId ?? ""}`;
        const cached = this.cache.get(cacheKey) as
            | SpotWebsocketAPI.TradesAggregateResponseResultInner[]
            | null;
        if (cached) {
            this.logger.info(`[tradesAggregate] Cache hit for ${symbol}`);
            return cached;
        }
        const config: SpotWebsocketAPI.TradesAggregateRequest = {
            symbol,
            limit,
            ...(fromId ? { fromId } : {}),
        };
        const result = await this.executeWithRetry(() =>
            this.executeWithApiConnection(config, "tradesAggregate")
        );
        this.cache.set(cacheKey, result, this.defaultCacheTtlMs);
        return result;
    }

    public async fetchAggTradesByTime(
        symbol: string,
        startTime: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        const cacheKey = `fetchAggTradesByTime-${symbol}-${startTime}`;
        const cached = this.cache.get(cacheKey) as
            | SpotWebsocketAPI.TradesAggregateResponseResultInner[]
            | null;
        if (cached) {
            this.logger.info(`[fetchAggTradesByTime] Cache hit for ${symbol}`);
            return cached;
        }
        const config: SpotWebsocketAPI.TradesAggregateRequest = {
            symbol,
            startTime,
            limit: 1000,
        };
        const result = await this.executeWithRetry(() =>
            this.executeWithApiConnection(config, "fetchAggTradesByTime")
        );
        this.cache.set(cacheKey, result, this.defaultCacheTtlMs);
        return result;
    }

    public async getTrades(
        symbol: string,
        fromId: number,
        limit: number
    ): Promise<SpotWebsocketAPI.TradesHistoricalResponseResultInner[]> {
        const cacheKey = `getTrades-${symbol}-${fromId}-${limit}`;
        const cached = this.cache.get(cacheKey) as
            | SpotWebsocketAPI.TradesHistoricalResponseResultInner[]
            | null;
        if (cached) {
            this.logger.info(`[getTrades] Cache hit for ${symbol}`);
            return cached;
        }

        const config: SpotWebsocketAPI.TradesHistoricalRequest = {
            symbol,
            fromId,
            limit,
        };

        const result = await this.executeWithRetry(() =>
            this.executeWithTradesConnection(config, "getTrades")
        );

        this.cache.set(cacheKey, result, this.defaultCacheTtlMs);
        return result;
    }

    public async getDepthSnapshot(
        symbol: string,
        limit = 1000
    ): Promise<SpotWebsocketAPI.DepthResponseResult> {
        const cacheKey = `depthSnapshot-${symbol}-${limit}`;
        const cached = this.cache.get(
            cacheKey
        ) as SpotWebsocketAPI.DepthResponseResult | null;
        if (cached) {
            this.logger.info(`[getDepthSnapshot] Cache hit for ${symbol}`);
            return cached;
        }
        const config: SpotWebsocketAPI.DepthRequest = { symbol, limit };
        const result = await this.executeWithRetry(() =>
            this.executeWithDepthConnection(config, "getDepthSnapshot")
        );
        this.cache.set(cacheKey, result, 2000); // shorter cache for depth
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
                    await this.sleep(backoff);
                    backoff *= 2;
                } else if (attempt === maxRetries) {
                    throw lastError;
                } else {
                    await this.sleep(backoff);
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

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
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
            this.cache.clear();
            this.logger.info("BinanceDataFeed disconnected and cleaned up");
        } catch (error) {
            this.logger.error(
                `Error during disconnect: ${JSON.stringify(error)}`
            );
            throw new BinanceApiError("disconnect", error);
        }
    }
}

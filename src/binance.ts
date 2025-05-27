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

// Custom Error Types
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

// Cache interfaces
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

// Using Binance SDK types for depth response
interface DepthSnapshot {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
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

    // Cache management
    private cache = new Map<string, CacheEntry<unknown>>();
    private readonly defaultCacheTtlMs = 5000; // 5 seconds default TTL

    // Rate limit management
    private rateLimitBackoffMs = 1000;
    private readonly maxRetries = 3;

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

    private validateConfiguration(): void {
        if (!process.env.API_KEY || !process.env.API_SECRET) {
            throw new BinanceConfigurationError(
                "Missing required API credentials: API_KEY and API_SECRET must be set"
            );
        }

        if (
            process.env.API_KEY.length < 10 ||
            process.env.API_SECRET.length < 10
        ) {
            throw new BinanceConfigurationError(
                "Invalid API credentials: API_KEY and API_SECRET appear to be too short"
            );
        }
    }

    public async connectToStreams(): Promise<SpotWebsocketStreams.WebsocketStreamsConnection> {
        try {
            if (this.streamConnection) {
                return this.streamConnection;
            }

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

    public async tradesAggregate(
        symbol: string,
        limit: number,
        fromId?: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        const cacheKey = this.getCacheKey("tradesAggregate", {
            symbol,
            limit,
            fromId,
        });
        const cached =
            this.getFromCache<
                SpotWebsocketAPI.TradesAggregateResponseResultInner[]
            >(cacheKey);

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

        this.setCache(cacheKey, result, this.defaultCacheTtlMs);
        return result;
    }

    public async fetchAggTradesByTime(
        symbol: string,
        startTime: number
    ): Promise<SpotWebsocketAPI.TradesAggregateResponseResultInner[]> {
        const cacheKey = this.getCacheKey("fetchAggTradesByTime", {
            symbol,
            startTime,
        });
        const cached =
            this.getFromCache<
                SpotWebsocketAPI.TradesAggregateResponseResultInner[]
            >(cacheKey);

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

        this.setCache(cacheKey, result, this.defaultCacheTtlMs);
        return result;
    }

    public async getDepthSnapshot(
        symbol: string,
        limit: number = 1000
    ): Promise<SpotWebsocketAPI.DepthResponseResult> {
        const cacheKey = this.getCacheKey("depthSnapshot", { symbol, limit });
        const cached = this.getFromCache<DepthSnapshot>(cacheKey);

        if (cached) {
            this.logger.info(`[getDepthSnapshot] Cache hit for ${symbol}`);
            return cached;
        }

        const config: SpotWebsocketAPI.DepthRequest = {
            symbol,
            limit,
        };

        const result = await this.executeWithRetry(() =>
            this.executeWithDepthConnection(config, "getDepthSnapshot")
        );

        this.setCache(cacheKey, result, 2000); // 2 second TTL for depth data
        return result;
    }

    private validateDepthSnapshot(
        data: SpotWebsocketAPI.DepthResponseResult
    ): DepthSnapshot {
        if (!data || typeof data !== "object") {
            throw new Error("Invalid depth snapshot format: not an object");
        }

        if (typeof data.lastUpdateId !== "number") {
            throw new Error(
                "Invalid depth snapshot: missing or invalid lastUpdateId"
            );
        }

        if (!Array.isArray(data.bids) || !Array.isArray(data.asks)) {
            throw new Error(
                "Invalid depth snapshot: bids and asks must be arrays"
            );
        }

        // Type-safe validation for bid/ask format
        const validateOrders = (
            orders: unknown,
            type: string
        ): [string, string][] => {
            if (!Array.isArray(orders)) {
                throw new Error(`Invalid ${type} orders: must be an array`);
            }

            const validatedOrders: [string, string][] = [];

            orders.forEach((order: unknown, index: number) => {
                if (!Array.isArray(order) || order.length !== 2) {
                    throw new Error(
                        `Invalid ${type} order at index ${index}: must be [price, quantity] array`
                    );
                }
                if (
                    typeof order[0] !== "string" ||
                    typeof order[1] !== "string"
                ) {
                    throw new Error(
                        `Invalid ${type} order at index ${index}: price and quantity must be strings`
                    );
                }
                validatedOrders.push([order[0], order[1]]);
            });

            return validatedOrders;
        };

        const validatedBids = validateOrders(data.bids, "bid");
        const validatedAsks = validateOrders(data.asks, "ask");

        return {
            lastUpdateId: data.lastUpdateId,
            bids: validatedBids,
            asks: validatedAsks,
        };
    }

    private validateTradeData(
        data: unknown
    ): SpotWebsocketAPI.TradesAggregateResponseResultInner[] {
        if (!Array.isArray(data)) {
            throw new Error("Invalid trade data format: expected array");
        }

        // Type-safe validation with proper typing
        data.forEach((item: unknown, index: number) => {
            if (!item || typeof item !== "object") {
                throw new Error(
                    `Invalid trade data at index ${index}: expected object`
                );
            }
        });

        // Safe type assertion after validation
        return data as SpotWebsocketAPI.TradesAggregateResponseResultInner[];
    }

    private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                if (
                    error instanceof BinanceRateLimitError &&
                    attempt < this.maxRetries
                ) {
                    const backoffTime =
                        this.rateLimitBackoffMs * Math.pow(2, attempt - 1);
                    this.logger.warn(
                        `Rate limit hit, backing off for ${backoffTime}ms (attempt ${attempt}/${this.maxRetries})`
                    );
                    await this.sleep(backoffTime);
                    continue;
                }

                if (attempt === this.maxRetries) {
                    throw lastError;
                }

                // For other errors, wait a shorter time before retry
                await this.sleep(1000 * attempt);
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
            const response: WebsocketApiResponse<SpotWebsocketAPI.TradesAggregateResponse> =
                await connection.tradesAggregate(config);

            const rateLimits: WebsocketApiRateLimit[] =
                response.rateLimits ?? [];
            this.logRateLimits(rateLimits, contextLabel);
            await this.handleRateLimit(rateLimits, contextLabel);

            const data = this.validateTradeData(response.data);
            this.logger.info(
                `[${contextLabel}] Received ${data?.length ?? 0} records`
            );

            return data;
        } catch (error) {
            this.logger.error(
                `[${contextLabel}] Error: ${error instanceof Error ? error.stack : JSON.stringify(error)}`
            );
            throw new BinanceApiError(contextLabel, error);
        }
    }

    private async executeWithDepthConnection(
        config: SpotWebsocketAPI.DepthRequest,
        contextLabel: string
    ): Promise<DepthSnapshot> {
        try {
            const connection = await this.getApiConnection();
            const response: WebsocketApiResponse<SpotWebsocketAPI.DepthResponse> =
                await connection.depth(config);

            const rateLimits: WebsocketApiRateLimit[] =
                response.rateLimits ?? [];
            this.logRateLimits(rateLimits, contextLabel);
            await this.handleRateLimit(rateLimits, contextLabel);
            if (!response.data) {
                throw new Error(
                    `Invalid response format for depth snapshot: ${JSON.stringify(response.data)}`
                );
            }
            const data = this.validateDepthSnapshot(
                response.data as SpotWebsocketAPI.DepthResponseResult
            );
            this.logger.info(
                `[${contextLabel}] Received depth snapshot for ${config.symbol}: ${data.bids.length} bids, ${data.asks.length} asks`
            );

            return data;
        } catch (error) {
            this.logger.error(
                `[${contextLabel}] Error: ${error instanceof Error ? error.stack : JSON.stringify(error)}`
            );
            throw new BinanceApiError(contextLabel, error);
        }
    }

    private async handleRateLimit(
        rateLimits: WebsocketApiRateLimit[],
        context: string
    ): Promise<void> {
        for (const limit of rateLimits) {
            const usageRatio = limit.count / limit.limit;

            if (usageRatio >= 1.0) {
                throw new BinanceRateLimitError(context, limit.rateLimitType);
            }

            if (usageRatio >= 0.9) {
                // Proactive backoff when approaching limit
                const backoffTime = this.rateLimitBackoffMs;
                this.logger.warn(
                    `[${context}] Approaching rate limit (${(usageRatio * 100).toFixed(1)}%), backing off for ${backoffTime}ms`
                );
                await this.sleep(backoffTime);
            }
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

    // Cache management methods
    private getCacheKey(
        method: string,
        params: Record<string, unknown>
    ): string {
        return `${method}-${JSON.stringify(params)}`;
    }

    private getFromCache<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        const now = Date.now();
        if (now > entry.timestamp + entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data as T;
    }

    private setCache<T>(key: string, data: T, ttlMs: number): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: ttlMs,
        });

        // Cleanup old entries periodically
        if (this.cache.size > 1000) {
            this.cleanupCache();
        }
    }

    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.timestamp + entry.ttl) {
                this.cache.delete(key);
            }
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

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

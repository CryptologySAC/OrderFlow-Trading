// src/infrastructure/apiConnectivityMonitor.ts

import { EventEmitter } from "events";
import { ILogger } from "./loggerInterface.ts";
import type { IWorkerMetricsCollector } from "../multithreading/shared/workerInterfaces.ts";

export interface ConnectivityStatus {
    isHealthy: boolean;
    tradeStreamHealth: StreamStatus;
    depthStreamHealth: StreamStatus;
    apiSyncHealth: ApiSyncStatus;
    lastIssueDetected?: ConnectivityIssue;
    connectivityScore: number; // 0-1 score of overall API health
}

export interface StreamStatus {
    isActive: boolean;
    lastMessageAt: number;
    messageCount: number;
    averageInterval: number;
    isStale: boolean;
    staleDurationMs: number;
}

export interface ApiSyncStatus {
    isInSync: boolean;
    tradeLag: number; // ms behind depth updates
    depthLag: number; // ms behind trade updates
    asymmetricDetected: boolean;
    asymmetricType?: "trades_only" | "depth_only" | "neither";
    syncScore: number; // 0-1 sync quality
}

export interface ConnectivityIssue {
    type: ConnectivityIssueType;
    severity: "low" | "medium" | "high" | "critical";
    detectedAt: number;
    description: string;
    affectedStreams: string[];
    suggestedAction: string;
}

export type ConnectivityIssueType =
    | "websocket_disconnected"
    | "trades_stream_stale"
    | "depth_stream_stale"
    | "asymmetric_streaming" // One stream works, other doesn't
    | "both_streams_stale"
    | "api_rate_limited"
    | "message_corruption"
    | "sync_drift";

export interface ApiConnectivityConfig {
    // Staleness detection
    tradeStaleThresholdMs: number; // How long without trades = stale
    depthStaleThresholdMs: number; // How long without depth = stale

    // Asymmetric detection
    asymmetricDetectionMs: number; // How long one works while other doesn't

    // Sync monitoring
    maxAllowedLagMs: number; // Max acceptable lag between streams
    syncCheckIntervalMs: number; // How often to check sync

    // Health scoring
    healthCheckIntervalMs: number;
    minHealthyScore: number; // Below this = unhealthy

    // Issue detection
    issueThrottleMs: number; // Don't repeat same issue within this time
}

export class ApiConnectivityMonitor extends EventEmitter {
    private readonly logger: ILogger;
    private readonly metricsCollector: IWorkerMetricsCollector;
    private readonly config: ApiConnectivityConfig;

    // Stream tracking
    private tradeStreamStatus: StreamStatus;
    private depthStreamStatus: StreamStatus;
    private webSocketConnected = false;

    // Sync tracking
    private lastTradeTimestamp = 0;
    private lastDepthTimestamp = 0;
    private syncHistory: Array<{
        time: number;
        tradeLag: number;
        depthLag: number;
    }> = [];

    // Issue tracking
    private recentIssues = new Map<ConnectivityIssueType, number>();
    private currentStatus: ConnectivityStatus;

    // Timers
    private healthCheckTimer?: NodeJS.Timeout;
    private syncCheckTimer?: NodeJS.Timeout;

    constructor(
        config: ApiConnectivityConfig,
        logger: ILogger,
        metricsCollector: IWorkerMetricsCollector
    ) {
        super();
        this.config = config;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        // Initialize stream status
        this.tradeStreamStatus = this.createEmptyStreamStatus();
        this.depthStreamStatus = this.createEmptyStreamStatus();

        // Initialize connectivity status
        this.currentStatus = this.createInitialStatus();

        this.logger.info("ApiConnectivityMonitor initialized", { config });
        this.startMonitoring();
    }

    /**
     * Report that WebSocket connection state changed
     */
    public onWebSocketStateChange(connected: boolean): void {
        this.webSocketConnected = connected;

        if (!connected) {
            this.detectIssue({
                type: "websocket_disconnected",
                severity: "critical",
                detectedAt: Date.now(),
                description: "WebSocket connection to Binance API is down",
                affectedStreams: ["trades", "depth"],
                suggestedAction:
                    "Check network connectivity and Binance API status",
            });
        }

        this.logger.info("WebSocket state changed", { connected });
        this.updateHealth();
    }

    /**
     * Report that a trade message was received
     */
    public onTradeMessage(timestamp: number): void {
        this.updateStreamStatus(this.tradeStreamStatus, timestamp);
        this.lastTradeTimestamp = timestamp;
        this.checkAsymmetricStreaming();
    }

    /**
     * Report that a depth message was received
     */
    public onDepthMessage(timestamp: number): void {
        this.updateStreamStatus(this.depthStreamStatus, timestamp);
        this.lastDepthTimestamp = timestamp;
        this.checkAsymmetricStreaming();
    }

    /**
     * Get current connectivity status
     */
    public getStatus(): ConnectivityStatus {
        return { ...this.currentStatus };
    }

    /**
     * Stop monitoring
     */
    public stop(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        if (this.syncCheckTimer) {
            clearInterval(this.syncCheckTimer);
        }
        this.logger.info("ApiConnectivityMonitor stopped");
    }

    private startMonitoring(): void {
        // Health check timer
        this.healthCheckTimer = setInterval(() => {
            this.updateHealth();
        }, this.config.healthCheckIntervalMs);

        // Sync check timer
        this.syncCheckTimer = setInterval(() => {
            this.checkStreamSync();
        }, this.config.syncCheckIntervalMs);
    }

    private updateStreamStatus(status: StreamStatus, timestamp: number): void {
        const now = Date.now();

        // Update basic stats
        status.lastMessageAt = timestamp;
        status.messageCount++;
        status.isActive = true;

        // Calculate average interval
        if (status.messageCount > 1) {
            const intervals = this.syncHistory
                .slice(-10) // Use last 10 intervals
                .map((h) => h.time);

            if (intervals.length > 1) {
                const totalInterval =
                    intervals[intervals.length - 1] - intervals[0];
                status.averageInterval = totalInterval / (intervals.length - 1);
            }
        }

        // Check if stale
        status.staleDurationMs = Math.max(0, now - timestamp);
        const staleThreshold =
            status === this.tradeStreamStatus
                ? this.config.tradeStaleThresholdMs
                : this.config.depthStaleThresholdMs;

        status.isStale = status.staleDurationMs > staleThreshold;
    }

    private checkAsymmetricStreaming(): void {
        const now = Date.now();
        const tradeRecent =
            now - this.tradeStreamStatus.lastMessageAt <
            this.config.asymmetricDetectionMs;
        const depthRecent =
            now - this.depthStreamStatus.lastMessageAt <
            this.config.asymmetricDetectionMs;

        let asymmetricType:
            | "trades_only"
            | "depth_only"
            | "neither"
            | undefined;

        if (tradeRecent && !depthRecent) {
            asymmetricType = "trades_only";
        } else if (!tradeRecent && depthRecent) {
            asymmetricType = "depth_only";
        } else if (!tradeRecent && !depthRecent) {
            asymmetricType = "neither";
        }

        if (asymmetricType && asymmetricType !== "neither") {
            this.detectIssue({
                type: "asymmetric_streaming",
                severity: "high",
                detectedAt: now,
                description: `Only ${asymmetricType.replace("_", " ")} functioning, other stream appears down`,
                affectedStreams:
                    asymmetricType === "trades_only" ? ["depth"] : ["trades"],
                suggestedAction:
                    "Check Binance API stream subscriptions and network connectivity",
            });
        }
    }

    private checkStreamSync(): void {
        const now = Date.now();

        // Calculate lag between streams
        const tradeLag = Math.abs(
            this.lastTradeTimestamp - this.lastDepthTimestamp
        );
        const depthLag = tradeLag; // Same value, different perspective

        // Add to sync history
        this.syncHistory.push({ time: now, tradeLag, depthLag });
        if (this.syncHistory.length > 50) {
            this.syncHistory.shift();
        }

        // Check for excessive lag
        if (tradeLag > this.config.maxAllowedLagMs) {
            this.detectIssue({
                type: "sync_drift",
                severity: "medium",
                detectedAt: now,
                description: `Stream sync drift detected: ${tradeLag}ms lag between trade and depth streams`,
                affectedStreams: ["trades", "depth"],
                suggestedAction:
                    "Monitor for continued drift, may indicate API performance issues",
            });
        }
    }

    private updateHealth(): void {
        // Update stream staleness
        this.checkStreamStaleness();

        // Calculate sync status
        const apiSyncHealth = this.calculateSyncHealth();

        // Calculate overall connectivity score
        const connectivityScore = this.calculateConnectivityScore();

        // Update status
        this.currentStatus = {
            isHealthy:
                connectivityScore >= this.config.minHealthyScore &&
                this.webSocketConnected,
            tradeStreamHealth: { ...this.tradeStreamStatus },
            depthStreamHealth: { ...this.depthStreamStatus },
            apiSyncHealth,
            connectivityScore,
            lastIssueDetected: this.currentStatus.lastIssueDetected,
        };

        // Emit status change if health changed
        const wasHealthy = this.currentStatus.isHealthy;
        if (wasHealthy !== this.currentStatus.isHealthy) {
            if (this.currentStatus.isHealthy) {
                this.emit("healthy", this.currentStatus);
                this.logger.info("API connectivity healthy", {
                    score: connectivityScore,
                });
            } else {
                this.emit("unhealthy", this.currentStatus);
                this.logger.warn("API connectivity unhealthy", {
                    score: connectivityScore,
                    webSocketConnected: this.webSocketConnected,
                    tradeStale: this.tradeStreamStatus.isStale,
                    depthStale: this.depthStreamStatus.isStale,
                });
            }
        }

        // Update metrics
        this.metricsCollector.recordGauge(
            "api.connectivity.score",
            connectivityScore
        );
        this.metricsCollector.recordGauge(
            "api.connectivity.healthy",
            this.currentStatus.isHealthy ? 1 : 0
        );
        this.metricsCollector.recordGauge(
            "api.sync.lag_ms",
            apiSyncHealth.tradeLag
        );
    }

    private checkStreamStaleness(): void {
        const now = Date.now();

        // Check trade stream staleness
        if (this.tradeStreamStatus.isStale && this.tradeStreamStatus.isActive) {
            this.detectIssue({
                type: "trades_stream_stale",
                severity: "high",
                detectedAt: now,
                description: `Trade stream stale for ${this.tradeStreamStatus.staleDurationMs}ms`,
                affectedStreams: ["trades"],
                suggestedAction:
                    "Check trade stream subscription and Binance API connectivity",
            });
        }

        // Check depth stream staleness
        if (this.depthStreamStatus.isStale && this.depthStreamStatus.isActive) {
            this.detectIssue({
                type: "depth_stream_stale",
                severity: "high",
                detectedAt: now,
                description: `Depth stream stale for ${this.depthStreamStatus.staleDurationMs}ms`,
                affectedStreams: ["depth"],
                suggestedAction:
                    "Check depth stream subscription and Binance API connectivity",
            });
        }

        // Check if both streams are stale
        if (this.tradeStreamStatus.isStale && this.depthStreamStatus.isStale) {
            this.detectIssue({
                type: "both_streams_stale",
                severity: "critical",
                detectedAt: now,
                description: "Both trade and depth streams are stale",
                affectedStreams: ["trades", "depth"],
                suggestedAction:
                    "Check WebSocket connection and Binance API status",
            });
        }
    }

    private calculateSyncHealth(): ApiSyncStatus {
        const tradeLag = Math.abs(
            this.lastTradeTimestamp - this.lastDepthTimestamp
        );
        const isInSync = tradeLag <= this.config.maxAllowedLagMs;

        // Determine asymmetric status
        const now = Date.now();
        const tradeRecent =
            now - this.tradeStreamStatus.lastMessageAt <
            this.config.asymmetricDetectionMs;
        const depthRecent =
            now - this.depthStreamStatus.lastMessageAt <
            this.config.asymmetricDetectionMs;

        let asymmetricDetected = false;
        let asymmetricType:
            | "trades_only"
            | "depth_only"
            | "neither"
            | undefined;

        if (tradeRecent && !depthRecent) {
            asymmetricDetected = true;
            asymmetricType = "trades_only";
        } else if (!tradeRecent && depthRecent) {
            asymmetricDetected = true;
            asymmetricType = "depth_only";
        }

        // Calculate sync score (0-1)
        const maxLag = this.config.maxAllowedLagMs;
        const syncScore = asymmetricDetected
            ? 0
            : Math.max(0, 1 - tradeLag / maxLag);

        return {
            isInSync,
            tradeLag,
            depthLag: tradeLag,
            asymmetricDetected,
            asymmetricType,
            syncScore,
        };
    }

    private calculateConnectivityScore(): number {
        let score = 1.0;

        // WebSocket connection (40% weight)
        if (!this.webSocketConnected) {
            score -= 0.4;
        }

        // Trade stream health (25% weight)
        if (this.tradeStreamStatus.isStale) {
            score -= 0.25;
        }

        // Depth stream health (25% weight)
        if (this.depthStreamStatus.isStale) {
            score -= 0.25;
        }

        // Sync health (10% weight)
        const syncHealth = this.calculateSyncHealth();
        score -= (1 - syncHealth.syncScore) * 0.1;

        return Math.max(0, score);
    }

    private detectIssue(issue: ConnectivityIssue): void {
        // Check if we should throttle this issue type
        const lastReported = this.recentIssues.get(issue.type);
        if (
            lastReported &&
            Date.now() - lastReported < this.config.issueThrottleMs
        ) {
            return; // Skip, too recent
        }

        // Record the issue
        this.recentIssues.set(issue.type, issue.detectedAt);
        this.currentStatus.lastIssueDetected = issue;

        // Log and emit
        this.logger.warn("API connectivity issue detected", {
            type: issue.type,
            severity: issue.severity,
            description: issue.description,
            affectedStreams: issue.affectedStreams,
        });

        this.emit("connectivityIssue", issue);
        this.metricsCollector.incrementCounter(
            `api.connectivity.issue.${issue.type}`
        );
    }

    private createEmptyStreamStatus(): StreamStatus {
        return {
            isActive: false,
            lastMessageAt: 0,
            messageCount: 0,
            averageInterval: 0,
            isStale: false,
            staleDurationMs: 0,
        };
    }

    private createInitialStatus(): ConnectivityStatus {
        return {
            isHealthy: false,
            tradeStreamHealth: this.createEmptyStreamStatus(),
            depthStreamHealth: this.createEmptyStreamStatus(),
            apiSyncHealth: {
                isInSync: false,
                tradeLag: 0,
                depthLag: 0,
                asymmetricDetected: false,
                syncScore: 0,
            },
            connectivityScore: 0,
        };
    }
}

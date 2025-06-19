// src/utils/detectorFactory.ts
import { randomUUID } from "crypto";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { BaseDetector } from "../indicators/base/baseDetector.js";
import {
    AbsorptionDetector,
    AbsorptionSettings,
} from "../indicators/absorptionDetector.js";
import {
    ExhaustionDetector,
    ExhaustionSettings,
} from "../indicators/exhaustionDetector.js";
import {
    DeltaCVDConfirmation,
    DeltaCVDConfirmationSettings,
} from "../indicators/deltaCVDConfirmation.js";
import {
    SupportResistanceDetector,
    SupportResistanceConfig,
} from "../indicators/supportResistanceDetector.js";

import type {
    BaseDetectorSettings,
    DetectorStats,
} from "../indicators/interfaces/detectorInterfaces.js";
import { SignalType } from "../types/signalTypes.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { Config } from "../core/config.js";

import { AccumulationZoneDetector } from "../indicators/accumulationZoneDetector.js";
import { DistributionZoneDetector } from "../indicators/distributionZoneDetector.js";
import { ZoneDetectorConfig } from "../types/zoneTypes.js";
import { IOrderBookState } from "../market/orderBookState";

/**
 * Production detector factory with monitoring, validation, and lifecycle management
 */
export class DetectorFactory {
    private static readonly instances = new Map<
        string,
        BaseDetector | AccumulationZoneDetector | DistributionZoneDetector
    >();
    private static readonly healthChecks = new Map<string, HealthChecker>();
    private static globalConfig: ProductionConfig = {
        maxDetectors: 10,
        healthCheckIntervalMs: 30000,
        autoRestartOnFailure: true,
        maxRestartAttempts: 3,
        circuitBreakerEnabled: true,
        performanceMonitoring: true,
        memoryThresholdMB: 1500,
    };
    /**
     * Static dependencies for the factory
     */
    private static dependencies: DetectorDependencies | null = null;

    /**
     * Initialize factory with dependencies (call this once at startup)
     */
    public static initialize(deps: DetectorDependencies): void {
        this.dependencies = deps;
    }

    /**
     * Create production-ready absorption detector
     */
    public static createAbsorptionDetector(
        settings: AbsorptionSettings,
        orderBook: IOrderBookState,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AbsorptionDetector {
        const id = options.id || `absorption-${Date.now()}`;

        // 🚨 CRITICAL FIX: Validate orderBook since it should be initialized by now
        if (!orderBook) {
            throw new Error(
                `DetectorFactory.createAbsorptionDetector: orderBook is unexpectedly null for detector ${id}. This indicates an initialization order bug.`
            );
        }

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "absorption"
        ) as BaseDetectorSettings;

        const detector = new AbsorptionDetector(
            id,
            productionSettings,
            orderBook,
            dependencies.logger,
            dependencies.spoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created AbsorptionDetector`,
            {
                id,
                settings: productionSettings,
                features: productionSettings.features,
            }
        );

        return detector;
    }

    /**
     * Create production-ready exhaustion detector
     */
    public static createExhaustionDetector(
        settings: ExhaustionSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): ExhaustionDetector {
        const id = options.id || `exhaustion-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "exhaustion"
        ) as BaseDetectorSettings;

        const detector = new ExhaustionDetector(
            id,
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created ExhaustionDetector`,
            {
                id,
                settings: productionSettings,
                features: productionSettings.features,
            }
        );

        return detector;
    }

    /**
     * Create production-ready accumulation detector
     */
    public static createAccumulationDetector(
        settings: ZoneDetectorConfig,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AccumulationZoneDetector {
        const id = options.id || `accumulation-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "accumulation"
        ) as ZoneDetectorConfig;

        const detector = new AccumulationZoneDetector(
            id,
            Config.SYMBOL,
            Config.ACCUMULATION_ZONE_DETECTOR,
            dependencies.logger,
            dependencies.metricsCollector
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created AccumulationDetector`,
            {
                id,
                settings: productionSettings,
            }
        );

        return detector;
    }

    /**
     * Create production-ready accumulation detector
     */
    public static createDistributionDetector(
        settings: ZoneDetectorConfig,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): DistributionZoneDetector {
        const id = options.id || `distribution-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "distribution"
        ) as ZoneDetectorConfig;

        const detector = new DistributionZoneDetector(
            id,
            Config.SYMBOL,
            Config.DISTRIBUTION_ZONE_DETECTOR,
            dependencies.logger,
            dependencies.metricsCollector
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created DistributionDetector`,
            {
                id,
                settings: productionSettings,
            }
        );

        return detector;
    }

    /**
     * Create production-ready support/resistance detector
     */
    public static createSupportResistanceDetector(
        settings: Partial<SupportResistanceConfig>,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): SupportResistanceDetector {
        const id = options.id || `support_resistance-${Date.now()}`;

        this.validateCreationLimits();

        const productionSettings: SupportResistanceConfig = {
            priceTolerancePercent: 0.05,
            minTouchCount: 3,
            minStrength: 0.6,
            timeWindowMs: 5400000, // 90 minutes
            volumeWeightFactor: 0.3,
            rejectionConfirmationTicks: 5,
            ...settings,
        };

        const detector = new SupportResistanceDetector(
            id,
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created SupportResistanceDetector`,
            {
                id,
                settings: productionSettings,
            }
        );

        return detector;
    }

    /**
     * Create production-ready accumulation detector
     */
    public static createDeltaCVDConfirmationDetector(
        settings: DeltaCVDConfirmationSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): DeltaCVDConfirmation {
        const id = options.id || `cvd_confirmation-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "cvd_confirmation"
        ) as BaseDetectorSettings;

        const detector = new DeltaCVDConfirmation(
            id,
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created Delta CVD Confirmation`,
            {
                id,
                settings: productionSettings,
                features: productionSettings.features,
            }
        );

        return detector;
    }

    /**
     * Get all available detector types and their configurations
     */
    public static getAvailableDetectors(): Array<{
        type: string;
        config: Record<string, unknown>;
    }> {
        return [
            { type: "absorption", config: {} },
            { type: "exhaustion", config: {} },
            { type: "accumulation", config: {} },
            { type: "distribution", config: {} },
            { type: "cvd_confirmation", config: {} },
            { type: "support_resistance", config: {} },
        ];
    }

    /**
     * Get metadata for a detector type
     */
    public static getDetectorMetadata(type: string): {
        supportedSignalTypes: string[];
        priority: number;
        enabled: boolean;
    } {
        const metadata: Record<
            string,
            {
                supportedSignalTypes: SignalType[];
                priority: number;
                enabled: boolean;
            }
        > = {
            absorption: {
                supportedSignalTypes: ["absorption"],
                priority: 100,
                enabled: true,
            },
            exhaustion: {
                supportedSignalTypes: ["exhaustion"],
                priority: 90,
                enabled: true,
            },
            accumulation: {
                supportedSignalTypes: ["accumulation"],
                priority: 70,
                enabled: true,
            },
            distribution: {
                supportedSignalTypes: ["distribution"],
                priority: 70,
                enabled: true,
            },
            cvd_confirmation: {
                supportedSignalTypes: ["cvd_confirmation"],
                priority: 50,
                enabled: true,
            },
            support_resistance: {
                supportedSignalTypes: ["support_resistance_level"],
                priority: 40,
                enabled: false,
            },
        };

        return (
            metadata[type] || {
                supportedSignalTypes: [],
                priority: 5,
                enabled: false,
            }
        );
    }

    /**
     * Get detector by ID
     */
    public static getDetector(
        id: string
    ):
        | BaseDetector
        | AccumulationZoneDetector
        | DistributionZoneDetector
        | undefined {
        return this.instances.get(id);
    }

    /**
     * Get all active detectors
     */
    public static getAllDetectors(): Map<
        string,
        BaseDetector | AccumulationZoneDetector | DistributionZoneDetector
    > {
        return new Map(this.instances);
    }

    /**
     * Destroy detector and cleanup resources
     */
    public static destroyDetector(id: string): boolean {
        const detector = this.instances.get(id);
        const healthCheck = this.healthChecks.get(id);

        if (!detector) {
            return false;
        }

        try {
            // Stop health checking
            if (healthCheck) {
                healthCheck.stop();
                this.healthChecks.delete(id);
            }

            // Cleanup detector
            if (
                "cleanup" in detector &&
                typeof detector.cleanup === "function"
            ) {
                detector.cleanup();
            }
            this.instances.delete(id);

            detector.logger?.info(`[DetectorFactory] Destroyed detector ${id}`);
            return true;
        } catch (error) {
            detector.logger?.error(
                `[DetectorFactory] Error destroying detector ${id}`,
                { error }
            );
            return false;
        }
    }

    /**
     * Destroy all detectors
     */
    public static destroyAll(): void {
        const ids = Array.from(this.instances.keys());
        for (const id of ids) {
            this.destroyDetector(id);
        }
    }

    /**
     * Get factory statistics
     */
    public static getFactoryStats(): FactoryStats {
        const detectorStats = new Map<string, DetectorStats>();
        const healthStats = new Map<string, HealthStatus>();

        for (const [id, detector] of this.instances) {
            if (
                "getStats" in detector &&
                typeof detector.getStats === "function"
            ) {
                detectorStats.set(id, detector.getStats());
            }
        }

        for (const [id, healthChecker] of this.healthChecks) {
            healthStats.set(id, healthChecker.getStatus());
        }

        return {
            totalDetectors: this.instances.size,
            maxDetectors: this.globalConfig.maxDetectors,
            detectorStats,
            healthStats,
            memoryUsageMB: this.getMemoryUsage(),
            uptime: Date.now(),
        };
    }

    /**
     * Update global configuration
     */
    public static updateGlobalConfig(config: Partial<ProductionConfig>): void {
        this.globalConfig = { ...this.globalConfig, ...config };
    }

    /**
     * Restart detector (useful for error recovery)
     */
    public static async restartDetector(
        id: string,
        maxAttempts: number = 3
    ): Promise<boolean> {
        const correlationId = randomUUID();

        try {
            const detector = this.instances.get(id);
            if (!detector) {
                this.dependencies?.logger.warn(
                    "Detector not found for restart",
                    {
                        component: "DetectorFactory",
                        operation: "restartDetector",
                        detectorId: id,
                    },
                    correlationId
                );
                return false;
            }

            const healthChecker = this.healthChecks.get(id);
            if (!healthChecker) {
                detector.logger.warn(
                    "Health checker not found for detector restart",
                    {
                        component: "DetectorFactory",
                        operation: "restartDetector",
                        detectorId: id,
                    },
                    correlationId
                );
                return false;
            }

            detector.logger.info(
                "Starting detector restart",
                {
                    component: "DetectorFactory",
                    operation: "restartDetector",
                    detectorId: id,
                    maxAttempts,
                },
                correlationId
            );

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    // Stop current instance
                    if (
                        "cleanup" in detector &&
                        typeof detector.cleanup === "function"
                    ) {
                        detector.cleanup();
                    }

                    // Wait a bit before restart
                    await new Promise((resolve) =>
                        setTimeout(resolve, 1000 * attempt)
                    );

                    // Health checker will handle the restart
                    healthChecker.triggerRestart();

                    detector.logger.info(
                        "Detector restarted successfully",
                        {
                            component: "DetectorFactory",
                            operation: "restartDetector",
                            detectorId: id,
                            attempt,
                        },
                        correlationId
                    );
                    return true;
                } catch (error) {
                    detector.logger.error(
                        "Restart attempt failed",
                        {
                            component: "DetectorFactory",
                            operation: "restartDetector",
                            detectorId: id,
                            attempt,
                            maxAttempts,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            stack:
                                error instanceof Error
                                    ? error.stack
                                    : undefined,
                        },
                        correlationId
                    );

                    if (attempt === maxAttempts) {
                        detector.logger.error(
                            "Failed to restart detector after all attempts",
                            {
                                component: "DetectorFactory",
                                operation: "restartDetector",
                                detectorId: id,
                                maxAttempts,
                            },
                            correlationId
                        );
                        return false;
                    }
                }
            }

            return false;
        } catch (error) {
            this.dependencies?.logger.error(
                "Error in detector restart process",
                {
                    component: "DetectorFactory",
                    operation: "restartDetector",
                    detectorId: id,
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                correlationId
            );
            return false;
        }
    }

    // Private methods

    private static validateCreationLimits(): void {
        if (this.instances.size >= this.globalConfig.maxDetectors) {
            throw new Error(
                `Maximum detector limit reached (${this.globalConfig.maxDetectors})`
            );
        }
    }

    private static validateProductionConfig(
        settings: BaseDetectorSettings | ZoneDetectorConfig
    ): void {
        const errors: string[] = [];

        if ("symbol" in settings && !settings.symbol) {
            errors.push("symbol is required in production");
        }

        if (
            "windowMs" in settings &&
            settings.windowMs &&
            settings.windowMs < 5000 &&
            Config.NODE_ENV === "production"
        ) {
            errors.push("windowMs should be at least 5000ms in production");
        }

        if (
            "minAggVolume" in settings &&
            settings.minAggVolume &&
            settings.minAggVolume < 50 &&
            Config.NODE_ENV === "production"
        ) {
            errors.push("minAggVolume should be at least 50 in production");
        }

        if (
            "eventCooldownMs" in settings &&
            settings.eventCooldownMs &&
            settings.eventCooldownMs < 1000 &&
            Config.NODE_ENV === "production"
        ) {
            errors.push(
                "eventCooldownMs should be at least 1000ms in production"
            );
        }

        if (errors.length > 0) {
            throw new Error(
                `Production config validation failed: ${errors.join(", ")}`
            );
        }
    }

    private static applyProductionDefaults(
        settings: BaseDetectorSettings | ZoneDetectorConfig,
        detectorType: SignalType
    ): BaseDetectorSettings | ZoneDetectorConfig {
        //TODO
        if (
            detectorType === "absorption" ||
            detectorType === "exhaustion" ||
            detectorType === "cvd_confirmation"
        ) {
            const detectorSettings = settings as BaseDetectorSettings;
            const baseDefaults: BaseDetectorSettings = {
                windowMs: 90000,
                minAggVolume: 500,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 15000,
                minInitialMoveTicks: 10,
                confirmationTimeoutMs: 60000,
                maxRevisitTicks: 5,

                // Production-specific defaults
                features: {
                    spoofingDetection: true,
                    adaptiveZone: true,
                    passiveHistory: true,
                    multiZone: true,
                    autoCalibrate: true,
                    ...detectorSettings.features,
                },
            };

            // Type-specific defaults
            if (detectorType === "absorption") {
                return {
                    ...baseDefaults,
                    ...settings,
                    features: {
                        ...baseDefaults.features,
                        icebergDetection: true,
                        liquidityGradient: true,
                        absorptionVelocity: false,
                        layeredAbsorption: false,
                        ...detectorSettings.features,
                    },
                };
            }

            if (detectorType === "exhaustion") {
                return {
                    ...baseDefaults,
                    features: {
                        ...baseDefaults.features,
                        depletionTracking: true,
                        spreadAdjustment: true,
                        volumeVelocity: false,
                    },
                    ...detectorSettings,
                };
            }

            if (detectorType === "cvd_confirmation") {
                return {
                    ...baseDefaults,
                    ...detectorSettings,
                };
            }
            return { ...baseDefaults, ...detectorSettings };
        } else {
            //TODO if (detectorType === "accumulation") {

            //}

            return {
                ...settings,
            } as ZoneDetectorConfig;
        }
    }

    private static registerDetector(
        id: string,
        detector:
            | BaseDetector
            | AccumulationZoneDetector
            | DistributionZoneDetector,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions
    ): void {
        this.instances.set(id, detector);

        // Setup health checking if enabled
        if (this.globalConfig.performanceMonitoring) {
            const healthChecker = new HealthChecker(
                id,
                detector,
                dependencies,
                {
                    intervalMs: this.globalConfig.healthCheckIntervalMs,
                    autoRestart: this.globalConfig.autoRestartOnFailure,
                    maxRestartAttempts: this.globalConfig.maxRestartAttempts,
                    memoryThresholdMB: this.globalConfig.memoryThresholdMB,
                }
            );

            this.healthChecks.set(id, healthChecker);
            healthChecker.start();
        }

        // Setup custom monitoring if provided
        if (options.customMonitoring) {
            options.customMonitoring(detector, dependencies.metricsCollector);
        }
    }

    private static getMemoryUsage(): number {
        if (typeof process !== "undefined" && process.memoryUsage) {
            return process.memoryUsage().heapUsed / 1024 / 1024; // MB
        }
        return 0;
    }
}

/**
 * Health checker for individual detectors
 */
class HealthChecker {
    private interval: NodeJS.Timeout | null = null;
    private isRunning = false;
    private restartCount = 0;
    private lastHealthCheck = 0;
    private errorCount = 0;

    constructor(
        private readonly detectorId: string,
        private readonly detector:
            | BaseDetector
            | AccumulationZoneDetector
            | DistributionZoneDetector,
        private readonly dependencies: DetectorDependencies,
        private readonly config: HealthCheckConfig
    ) {}

    public start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.interval = setInterval(() => {
            this.performHealthCheck();
        }, this.config.intervalMs);

        this.dependencies.logger.debug(
            `[HealthChecker] Started for ${this.detectorId}`
        );
    }

    public stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        this.dependencies.logger.debug(
            `[HealthChecker] Stopped for ${this.detectorId}`
        );
    }

    public getStatus(): HealthStatus {
        return {
            isHealthy: this.errorCount < 5,
            lastCheckTime: this.lastHealthCheck,
            errorCount: this.errorCount,
            restartCount: this.restartCount,
            isRunning: this.isRunning,
        };
    }

    public triggerRestart(): void {
        if (this.restartCount >= this.config.maxRestartAttempts) {
            this.dependencies.logger.error(
                `[HealthChecker] Max restart attempts reached for ${this.detectorId}`
            );
            return;
        }

        this.restartCount++;
        this.dependencies.logger.info(
            `[HealthChecker] Triggering restart ${this.restartCount} for ${this.detectorId}`
        );
    }

    private performHealthCheck(): void {
        this.lastHealthCheck = Date.now();

        try {
            //TODO implement getStats and cleanup in zne detectors
            if (
                "getStats" in this.detector &&
                typeof this.detector.getStats === "function"
            ) {
                const stats = this.detector.getStats();
                const memoryUsage = DetectorFactory["getMemoryUsage"]();

                // Check memory usage
                if (memoryUsage > this.config.memoryThresholdMB) {
                    this.dependencies.logger.warn(
                        `[HealthChecker] High memory usage for ${this.detectorId}`,
                        {
                            memoryUsageMB: memoryUsage,
                            threshold: this.config.memoryThresholdMB,
                        }
                    );
                }

                // Report metrics
                this.dependencies.metricsCollector.recordGauge(
                    `detector.${this.detectorId}.trades_buffer`,
                    stats.tradesInBuffer
                );
                this.dependencies.metricsCollector.recordGauge(
                    `detector.${this.detectorId}.depth_levels`,
                    stats.depthLevels
                );
                this.dependencies.metricsCollector.recordGauge(
                    `detector.${this.detectorId}.memory_usage`,
                    memoryUsage
                );

                // Reset error count on successful check
                this.errorCount = 0;
            }
        } catch (error) {
            this.errorCount++;
            this.dependencies.logger.error(
                `[HealthChecker] Health check failed for ${this.detectorId}`,
                { error, errorCount: this.errorCount }
            );

            // Auto-restart if enabled and threshold reached
            if (this.config.autoRestart && this.errorCount >= 5) {
                this.triggerRestart();
                this.errorCount = 0; // Reset after restart attempt
            }
        }
    }
}

// Type definitions
// Enhanced type definitions
export interface DetectorSuite {
    absorption: AbsorptionDetector;
    exhaustion: ExhaustionDetector;
    accumulation: AccumulationZoneDetector;
    distribution: DistributionZoneDetector;
    cvd_confirmation: DeltaCVDConfirmation;
}

export interface DetectorDependencies {
    logger: ILogger;
    spoofingDetector: SpoofingDetector;
    metricsCollector: IMetricsCollector;
    signalLogger?: ISignalLogger;
}

export interface DetectorFactoryOptions {
    id?: string;
    customMonitoring?: (
        detector:
            | BaseDetector
            | AccumulationZoneDetector
            | DistributionZoneDetector,
        metrics: IMetricsCollector
    ) => void;
}

export interface ProductionConfig {
    maxDetectors: number;
    healthCheckIntervalMs: number;
    autoRestartOnFailure: boolean;
    maxRestartAttempts: number;
    circuitBreakerEnabled: boolean;
    performanceMonitoring: boolean;
    memoryThresholdMB: number;
}

export interface HealthCheckConfig {
    intervalMs: number;
    autoRestart: boolean;
    maxRestartAttempts: number;
    memoryThresholdMB: number;
}

export interface HealthStatus {
    isHealthy: boolean;
    lastCheckTime: number;
    errorCount: number;
    restartCount: number;
    isRunning: boolean;
}

export interface FactoryStats {
    totalDetectors: number;
    maxDetectors: number;
    detectorStats: Map<string, DetectorStats>;
    healthStats: Map<string, HealthStatus>;
    memoryUsageMB: number;
    uptime: number;
}

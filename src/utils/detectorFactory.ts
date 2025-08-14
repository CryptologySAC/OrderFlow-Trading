// src/utils/detectorFactory.ts
import { randomUUID } from "crypto";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import { AbsorptionDetectorEnhanced } from "../indicators/absorptionDetectorEnhanced.js";
import { ExhaustionDetectorEnhanced } from "../indicators/exhaustionDetectorEnhanced.js";
import { DeltaCVDDetectorEnhanced } from "../indicators/deltaCVDDetectorEnhanced.js";

import type {
    DetectorStats,
    IBaseDetector,
} from "../indicators/interfaces/detectorInterfaces.js";
import { SignalType } from "../types/signalTypes.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { Config } from "../core/config.js";

import { AccumulationZoneDetectorEnhanced } from "../indicators/accumulationZoneDetectorEnhanced.js";
import { DistributionDetectorEnhanced } from "../indicators/distributionDetectorEnhanced.js";
import type { IOrderflowPreprocessor } from "../market/orderFlowPreprocessor.js";
import { SignalValidationLogger } from "./signalValidationLogger.js";

/**
 * Production detector factory with monitoring, validation, and lifecycle management
 */
export class DetectorFactory {
    private static readonly instances = new Map<string, IBaseDetector>();
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
     * Create production-ready absorption detector (standalone enhanced)
     */
    public static createAbsorptionDetector(
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AbsorptionDetectorEnhanced {
        const id = options.id || `absorption-${Date.now()}`;

        this.validateCreationLimits();

        const productionSettings = Config.ABSORPTION_DETECTOR;

        // Always use enhanced detector - standalone architecture
        const detector = new AbsorptionDetectorEnhanced(
            id,
            productionSettings,
            dependencies.preprocessor,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.signalValidationLogger,
            dependencies.signalLogger
        );

        dependencies.logger.info(
            `[DetectorFactory] Created Standalone AbsorptionDetectorEnhanced`,
            {
                id,
            }
        );

        this.registerDetector(id, detector, dependencies, options);

        return detector;
    }

    /**
     * Create production-ready exhaustion detector with enhanced zone capabilities
     */
    public static createExhaustionDetector(
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): ExhaustionDetectorEnhanced {
        const id = options.id || `exhaustion-${Date.now()}`;

        this.validateCreationLimits();

        const productionSettings = Config.EXHAUSTION_DETECTOR;

        // Always use enhanced detector - originals are deprecated
        const detector = new ExhaustionDetectorEnhanced(
            id,
            productionSettings,
            dependencies.preprocessor,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.signalLogger,
            dependencies.signalValidationLogger
        );

        dependencies.logger.info(
            `[DetectorFactory] Created Enhanced ExhaustionDetector (deprecated originals)`,
            {
                id,
                settings: productionSettings,
            }
        );

        this.registerDetector(id, detector, dependencies, options);

        return detector;
    }

    /**
     * Create production-ready accumulation detector
     */
    public static createAccumulationDetector(
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AccumulationZoneDetectorEnhanced {
        const id = options.id || `accumulation-${Date.now()}`;

        this.validateCreationLimits();

        const productionSettings = Config.ACCUMULATION_DETECTOR;

        // Always use enhanced detector - originals are deprecated
        const detector = new AccumulationZoneDetectorEnhanced(
            id,
            productionSettings,
            dependencies.preprocessor,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        dependencies.logger.info(
            `[DetectorFactory] Created Enhanced AccumulationDetector (deprecated originals)`,
            {
                id,
                enhancementMode: productionSettings.enhancementMode,
            }
        );

        this.registerDetector(id, detector, dependencies, options);

        return detector;
    }

    /**
     * Create production-ready distribution detector with enhanced zone capabilities
     */
    public static createDistributionDetector(
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): DistributionDetectorEnhanced {
        const id = options.id || `distribution-${Date.now()}`;

        this.validateCreationLimits();

        const productionSettings = Config.DISTRIBUTION_DETECTOR;

        // Always use enhanced detector - originals are deprecated
        const detector = new DistributionDetectorEnhanced(
            id,
            productionSettings,
            dependencies.preprocessor,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        dependencies.logger.info(
            `[DetectorFactory] Created Enhanced DistributionDetector (deprecated originals)`,
            {
                id,
                settings: productionSettings,
                enhancementMode: productionSettings.enhancementMode,
            }
        );

        this.registerDetector(id, detector, dependencies, options);

        return detector;
    }

    /**
     * Create production-ready Delta CVD detector with enhanced zone capabilities
     */
    public static createDeltaCVDConfirmationDetector(
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): DeltaCVDDetectorEnhanced {
        const id = options.id || `cvd_confirmation-${Date.now()}`;

        this.validateCreationLimits();

        const productionSettings = Config.DELTACVD_DETECTOR;

        // Always use enhanced detector - originals are deprecated
        const detector = new DeltaCVDDetectorEnhanced(
            id,
            productionSettings,
            dependencies.preprocessor,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.signalValidationLogger,
            dependencies.signalLogger
        );

        dependencies.logger.info(
            `[DetectorFactory] Created Enhanced DeltaCVDDetector (deprecated originals)`,
            {
                id,
                enhancementMode: productionSettings.enhancementMode,
            }
        );

        this.registerDetector(id, detector, dependencies, options);

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
                supportedSignalTypes: ["deltacvd"],
                priority: 50,
                enabled: true,
            },
            support_resistance: {
                supportedSignalTypes: ["generic"],
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
    public static getDetector(id: string): IBaseDetector | undefined {
        return this.instances.get(id);
    }

    /**
     * Get all active detectors
     */
    public static getAllDetectors(): Map<string, IBaseDetector> {
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

            // Cleanup detector if it supports cleanup
            if (
                "cleanup" in detector &&
                typeof detector.cleanup === "function"
            ) {
                (detector as { cleanup: () => void }).cleanup();
            }
            this.instances.delete(id);

            // Safe logger access - guaranteed by IDetector interface
            detector.logger.info(`[DetectorFactory] Destroyed detector ${id}`);
            return true;
        } catch (error) {
            // Safe logger access - guaranteed by IDetector interface
            detector.logger.error(
                `[DetectorFactory] Error destroying detector ${id}`,
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
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
                const stats = (
                    detector as { getStats: () => DetectorStats }
                ).getStats();
                detectorStats.set(id, stats);
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
                // Safe logger access - guaranteed by IDetector interface
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
                        (detector as { cleanup: () => void }).cleanup();
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
                    }

                    if (attempt === maxAttempts) {
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

    private static registerDetector(
        id: string,
        detector: IBaseDetector,
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
        private readonly detector: IBaseDetector,
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
            //TODO implement getStats and cleanup in zone detectors
            if (
                "getStats" in this.detector &&
                typeof this.detector.getStats === "function"
            ) {
                const stats = (
                    this.detector as { getStats: () => DetectorStats }
                ).getStats();
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
    absorption: AbsorptionDetectorEnhanced;
    exhaustion: ExhaustionDetectorEnhanced;
    accumulation: AccumulationZoneDetectorEnhanced;
    distribution: DistributionDetectorEnhanced;
    cvd_confirmation: DeltaCVDDetectorEnhanced;
}

export interface DetectorDependencies {
    logger: ILogger;
    spoofingDetector: SpoofingDetector;
    metricsCollector: IMetricsCollector;
    signalLogger: ISignalLogger;
    preprocessor: IOrderflowPreprocessor;
    signalValidationLogger: SignalValidationLogger;
}

export interface DetectorFactoryOptions {
    id?: string;
    customMonitoring?: (
        detector: IBaseDetector,
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

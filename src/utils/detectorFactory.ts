// src/utils/detectorFactory.ts
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
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
import { DistributionDetector } from "../indicators/distributionDetector.js";
import { SuperiorFlowSettings } from "../indicators/base/flowDetectorBase.js";

import type {
    DetectorCallback,
    BaseDetectorSettings,
    DetectorStats,
    AccumulationSettings,
} from "../indicators/interfaces/detectorInterfaces.js";
import { AccumulationDetector } from "../indicators/accumulationDetector.js";
import { SignalType } from "../types/signalTypes.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";

/**
 * Production detector factory with monitoring, validation, and lifecycle management
 */
export class DetectorFactory {
    private static readonly instances = new Map<string, BaseDetector>();
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
        callback: DetectorCallback,
        settings: AbsorptionSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AbsorptionDetector {
        const id = options.id || `absorption-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "absorption"
        );

        const detector = new AbsorptionDetector(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
            productionSettings,
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
        callback: DetectorCallback,
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
        );

        const detector = new ExhaustionDetector(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
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
        callback: DetectorCallback,
        settings: AccumulationSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AccumulationDetector {
        const id = options.id || `accumulation-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "accumulation"
        );

        const detector = new AccumulationDetector(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created AccumulationDetector`,
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
    public static createDistributionDetector(
        callback: DetectorCallback,
        settings: SuperiorFlowSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): DistributionDetector {
        const id = options.id || `distribution-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "distribution"
        );

        const detector = new DistributionDetector(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created DistributionDetector`,
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
    public static createDeltaCVDConfirmationDetector(
        callback: DetectorCallback,
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
        );

        const detector = new DeltaCVDConfirmation(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
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
     * Create all three detectors as a suite
     */
    public static createDetectorSuite(
        callback: DetectorCallback,
        baseSettings: BaseDetectorSettings,
        dependencies: DetectorDependencies,
        options: {
            absorption?: Partial<AbsorptionSettings>;
            exhaustion?: Partial<ExhaustionSettings>;
            accumulation?: Partial<AccumulationSettings>;
            cvd_confirmation?: Partial<DeltaCVDConfirmationSettings>;
            idPrefix?: string;
        } = {}
    ): DetectorSuite {
        const prefix = options.idPrefix || baseSettings.symbol || "suite";

        const absorptionDetector = this.createAbsorptionDetector(
            callback,
            { ...baseSettings, ...options.absorption },
            dependencies,
            { id: `${prefix}-absorption` }
        );

        const exhaustionDetector = this.createExhaustionDetector(
            callback,
            { ...baseSettings, ...options.exhaustion },
            dependencies,
            { id: `${prefix}-exhaustion` }
        );

        const accumulationDetector = this.createAccumulationDetector(
            callback,
            { ...baseSettings, ...options.accumulation },
            dependencies,
            { id: `${prefix}-accumulation` }
        );

        const deltaCVDDetector = this.createDeltaCVDConfirmationDetector(
            callback,
            { ...baseSettings, ...options.accumulation },
            dependencies,
            { id: `${prefix}-cvd_confirmation` }
        );

        dependencies.logger.info(`[DetectorFactory] Created detector suite`, {
            prefix,
            detectors: [
                "absorption",
                "exhaustion",
                "accumulation",
                "cvd_confirmation",
            ],
        });

        return {
            absorption: absorptionDetector,
            exhaustion: exhaustionDetector,
            accumulation: accumulationDetector,
            cvd_confirmation: deltaCVDDetector,
        };
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
        ];
    }

    /**
     * Create a detector instance by type (for SignalCoordinator)
     */
    public static create(
        type: string,
        config: Record<string, unknown>
    ): BaseDetector {
        if (!this.dependencies) {
            throw new Error(
                "DetectorFactory not initialized. Call DetectorFactory.initialize() first."
            );
        }

        const callback: DetectorCallback = (signal) => {
            // Default callback - will be overridden by coordinator
            void signal;
        };

        const baseSettings = config as BaseDetectorSettings;

        switch (type) {
            case "absorption":
                return this.createAbsorptionDetector(
                    callback,
                    baseSettings as AbsorptionSettings,
                    this.dependencies
                );
            case "exhaustion":
                return this.createExhaustionDetector(
                    callback,
                    baseSettings as ExhaustionSettings,
                    this.dependencies
                );
            case "accumulation":
                return this.createAccumulationDetector(
                    callback,
                    baseSettings as AccumulationSettings,
                    this.dependencies
                );
            case "distribution":
                return this.createDistributionDetector(
                    callback,
                    baseSettings as SuperiorFlowSettings,
                    this.dependencies
                );
            case "cvd_confirmation":
                return this.createDeltaCVDConfirmationDetector(
                    callback,
                    baseSettings as DeltaCVDConfirmationSettings,
                    this.dependencies
                );
            default:
                throw new Error(`Unknown detector type: ${type}`);
        }
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
     * Create generic detector with type safety
     */
    public static createDetector<T extends BaseDetector>(
        DetectorClass: DetectorConstructor<T>,
        callback: DetectorCallback,
        settings: BaseDetectorSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): T {
        const id =
            options.id || `${DetectorClass.name.toLowerCase()}-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        const productionSettings = this.applyProductionDefaults(
            settings,
            "generic"
        );

        const detector = new DetectorClass(
            this.wrapCallback(callback, id, dependencies.logger),
            productionSettings,
            dependencies.logger,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created ${DetectorClass.name}`,
            {
                id,
                settings: productionSettings,
            }
        );

        return detector;
    }

    /**
     * Get detector by ID
     */
    public static getDetector(id: string): BaseDetector | undefined {
        return this.instances.get(id);
    }

    /**
     * Get all active detectors
     */
    public static getAllDetectors(): Map<string, BaseDetector> {
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
            detector.cleanup();
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
            detectorStats.set(id, detector.getStats());
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
        const detector = this.instances.get(id);
        if (!detector) {
            return false;
        }

        const healthChecker = this.healthChecks.get(id);
        if (!healthChecker) {
            return false;
        }

        detector.logger.info(`[DetectorFactory] Restarting detector ${id}`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Stop current instance
                detector.cleanup();

                // Wait a bit before restart
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * attempt)
                );

                // Health checker will handle the restart
                healthChecker.triggerRestart();

                detector.logger.info(
                    `[DetectorFactory] Detector ${id} restarted successfully`
                );
                return true;
            } catch (error) {
                detector.logger.error(
                    `[DetectorFactory] Restart attempt ${attempt} failed for ${id}`,
                    { error }
                );

                if (attempt === maxAttempts) {
                    detector.logger.error(
                        `[DetectorFactory] Failed to restart detector ${id} after ${maxAttempts} attempts`
                    );
                    return false;
                }
            }
        }

        return false;
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
        settings: BaseDetectorSettings
    ): void {
        const errors: string[] = [];

        if (!settings.symbol) {
            errors.push("symbol is required in production");
        }

        if (settings.windowMs && settings.windowMs < 5000) {
            errors.push("windowMs should be at least 5000ms in production");
        }

        if (settings.minAggVolume && settings.minAggVolume < 50) {
            errors.push("minAggVolume should be at least 50 in production");
        }

        if (settings.eventCooldownMs && settings.eventCooldownMs < 1000) {
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
        settings: BaseDetectorSettings,
        detectorType: SignalType
    ): BaseDetectorSettings {
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
                priceResponse: true,
                sideOverride: false,
                autoCalibrate: true,
                ...settings.features,
            },
        };

        // Type-specific defaults
        if (detectorType === "absorption") {
            return {
                ...baseDefaults,
                features: {
                    ...baseDefaults.features,
                    icebergDetection: true,
                    liquidityGradient: true,
                    absorptionVelocity: false,
                    layeredAbsorption: false,
                },
                ...settings,
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
                ...settings,
            };
        }

        if (detectorType === "cvd_confirmation") {
            return {
                ...baseDefaults,
                ...settings,
            };
        }

        if (detectorType === "accumulation") {
            return {
                ...baseDefaults,
                // Accumulation-specific defaults
                minDurationMs: 300000, // 5 minutes
                minRatio: 1.5,
                minRecentActivityMs: 60000,
                accumulationThreshold: 0.6,
                features: {
                    ...baseDefaults.features,
                    sideTracking: true,
                    durationWeighting: true,
                    volumeVelocity: false,
                    strengthAnalysis: true,
                },
                ...settings,
            } as AccumulationSettings;
        }

        return { ...baseDefaults, ...settings };
    }

    private static wrapCallback(
        originalCallback: DetectorCallback,
        detectorId: string,
        logger: Logger
    ): DetectorCallback {
        return (signal) => {
            try {
                // Add factory metadata
                const enhancedSignal = {
                    ...signal,
                    factoryId: detectorId,
                    factoryTimestamp: Date.now(),
                };

                originalCallback(enhancedSignal);

                // Record successful signal
                logger.debug(
                    `[DetectorFactory] Signal processed for ${detectorId}`,
                    {
                        signalId: signal.id,
                        price: signal.price,
                        side: signal.side,
                    }
                );
            } catch (error) {
                logger.error(
                    `[DetectorFactory] Callback error for ${detectorId}`,
                    { error }
                );
                // Don't throw - just log the error to prevent detector crash
            }
        };
    }

    private static registerDetector(
        id: string,
        detector: BaseDetector,
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
        private readonly detector: BaseDetector,
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
    accumulation: AccumulationDetector;
    cvd_confirmation: DeltaCVDConfirmation;
}

export interface DetectorDependencies {
    logger: Logger;
    spoofingDetector: SpoofingDetector;
    metricsCollector: MetricsCollector;
    signalLogger?: ISignalLogger;
}

export interface DetectorFactoryOptions {
    id?: string;
    customMonitoring?: (
        detector: BaseDetector,
        metrics: MetricsCollector
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

type DetectorConstructor<T extends BaseDetector> = new (
    callback: DetectorCallback,
    settings: BaseDetectorSettings,
    logger: Logger,
    metricsCollector: MetricsCollector,
    signalLogger?: ISignalLogger
) => T;

// Usage example:
/*
import { DetectorFactory } from './utils/detectorFactory.js';

// Create dependencies
const dependencies = {
    logger: new Logger(),
    metricsCollector: new MetricsCollector(),
    signalLogger: new SignalLogger(),
};

// Create absorption detector
const absorptionDetector = DetectorFactory.createAbsorptionDetector(
    (signal) => {
        console.log('Absorption signal:', signal);
    },
    {
        symbol: 'BTCUSDT',
        windowMs: 90000,
        minAggVolume: 1000,
        absorptionThreshold: 0.75,
        features: {
            icebergDetection: true,
            liquidityGradient: true,
            priceResponse: true,
        },
    },
    dependencies,
    { id: 'btc-absorption-main' }
);

// Create exhaustion detector
const exhaustionDetector = DetectorFactory.createExhaustionDetector(
    (signal) => {
        console.log('Exhaustion signal:', signal);
    },
    {
        symbol: 'BTCUSDT',
        windowMs: 90000,
        minAggVolume: 1000,
        exhaustionThreshold: 0.7,
        features: {
            depletionTracking: true,
            spreadAdjustment: true,
            priceResponse: true,
        },
    },
    dependencies,
    { id: 'btc-exhaustion-main' }
);

// Monitor factory health
setInterval(() => {
    const stats = DetectorFactory.getFactoryStats();
    console.log('Factory stats:', stats);
}, 60000);

// Cleanup on exit
process.on('SIGINT', () => {
    DetectorFactory.destroyAll();
    process.exit(0);
});
*/

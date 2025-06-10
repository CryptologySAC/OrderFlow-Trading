// Enhanced DetectorFactory with Worker Thread Integration
import { Worker } from "worker_threads";
import { EventEmitter } from "events";
import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
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
//import { Config } from "../core/config.js";

// Import your existing types and dependencies
import type {
    DetectorCallback,
    BaseDetectorSettings,
    DetectorStats,
    Detected,
} from "../indicators/interfaces/detectorInterfaces.js";
import { SignalType } from "../types/signalTypes.js";
import { EnrichedTradeEvent } from "../types/marketEvents.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import { TradeData } from "../utils/utils.js";

// ====================================================================
// ENHANCED DETECTOR FACTORY WITH WORKER SUPPORT
// ====================================================================

export interface WorkerDetectorConfig {
    useWorkers: boolean;
    workerMode: "hybrid" | "full_separation" | "disabled";
    criticalDetectorsInWorkers: string[]; // ['absorption', 'exhaustion']
    maxWorkers: number;
    workerHealthCheckMs: number;
    workerRestartAttempts: number;
}

export interface WorkerMessage {
    type: string;
    data?: WorkerMessageData;
    workerId?: string;
    timestamp?: number;
    detectorId?: string;
}

interface WorkerMessageData {
    message?: string;
    dependencies?: DetectorDependencies | null;
    detectorTypes?: string[];
    detectorType?: string;
    detectorId?: string;
    options?: DetectorFactoryOptions;
    settings?: BaseDetectorSettings;
    tradeData?: TradeData;
    detector?: unknown;
}

export interface DetectorWorkerProxy {
    id: string;
    type: string;
    workerId: string;
    isInWorker: boolean;
    lastActivity: number;
    messagesSent: number;
    messagesReceived: number;
    latency: number;
    errors: number;
}

/**
 * Enhanced DetectorFactory with Worker Thread Support
 * Maintains full backward compatibility while adding worker capabilities
 */
export class EnhancedDetectorFactory extends EventEmitter {
    private static instance: EnhancedDetectorFactory | null = null;

    // Existing factory data (preserved)
    private static readonly instances = new Map<
        string,
        BaseDetector | DetectorWorkerProxy
    >();
    private static readonly healthChecks = new Map<string, HealthChecker>();
    private static dependencies: DetectorDependencies | null = null;
    private static globalConfig: ProductionConfig = {
        maxDetectors: 10,
        healthCheckIntervalMs: 30000,
        autoRestartOnFailure: true,
        maxRestartAttempts: 3,
        circuitBreakerEnabled: true,
        performanceMonitoring: true,
        memoryThresholdMB: 1500,
    };

    // New worker management
    private workers = new Map<string, Worker>();
    private workerProxies = new Map<string, DetectorWorkerProxy>();
    private workerConfig: WorkerDetectorConfig = {
        useWorkers: false,
        workerMode: "disabled",
        criticalDetectorsInWorkers: ["absorption", "exhaustion"],
        maxWorkers: 3,
        workerHealthCheckMs: 10000,
        workerRestartAttempts: 3,
    };

    private isInitialized = false;
    private coordinatorStats = {
        workersCreated: 0,
        workersRestarted: 0,
        messagesRouted: 0,
        avgWorkerLatency: 0,
    };

    private constructor() {
        super();
        this.setupErrorHandling();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): EnhancedDetectorFactory {
        if (!this.instance) {
            this.instance = new EnhancedDetectorFactory();
        }
        return this.instance;
    }

    /**
     * Initialize factory with dependencies and worker configuration
     */
    public static initialize(
        deps: DetectorDependencies,
        workerConfig?: Partial<WorkerDetectorConfig>
    ): void {
        this.dependencies = deps;

        const factory = this.getInstance();
        if (workerConfig) {
            factory.workerConfig = { ...factory.workerConfig, ...workerConfig };
        }

        if (factory.workerConfig.useWorkers) {
            void factory.initializeWorkers();
        }

        factory.isInitialized = true;
        deps.logger.info("[EnhancedDetectorFactory] ✅ Initialized", {
            useWorkers: factory.workerConfig.useWorkers,
            workerMode: factory.workerConfig.workerMode,
            criticalDetectors: factory.workerConfig.criticalDetectorsInWorkers,
        });
    }

    /**
     * Create absorption detector (enhanced with worker support)
     */
    public static createAbsorptionDetector(
        callback: DetectorCallback,
        settings: AbsorptionSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AbsorptionDetector | DetectorWorkerProxy {
        const factory = this.getInstance();
        const id = options.id || `absorption-${Date.now()}`;

        // Validate creation limits
        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        // Check if this detector should run in a worker
        if (factory.shouldUseWorker("absorption")) {
            return factory.createWorkerDetector(
                "absorption",
                id,
                callback,
                settings,
                dependencies,
                options
            );
        }

        // Create traditional in-process detector
        return this.createInProcessAbsorptionDetector(
            callback,
            settings,
            dependencies,
            options
        );
    }

    /**
     * Create exhaustion detector (enhanced with worker support)
     */
    public static createExhaustionDetector(
        callback: DetectorCallback,
        settings: ExhaustionSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): ExhaustionDetector | DetectorWorkerProxy {
        const factory = this.getInstance();
        const id = options.id || `exhaustion-${Date.now()}`;

        this.validateCreationLimits();
        this.validateProductionConfig(settings);

        if (factory.shouldUseWorker("exhaustion")) {
            return factory.createWorkerDetector(
                "exhaustion",
                id,
                callback,
                settings,
                dependencies,
                options
            );
        }

        return this.createInProcessExhaustionDetector(
            callback,
            settings,
            dependencies,
            options
        );
    }

    /**
     * Create detector by type with automatic worker placement
     */
    public static create(
        type: string,
        config: Record<string, unknown>
    ): BaseDetector | DetectorWorkerProxy {
        if (!this.dependencies) {
            throw new Error(
                "DetectorFactory not initialized. Call initialize() first."
            );
        }

        const callback: DetectorCallback = (signal) => {
            // Default callback - will be enhanced by coordinator
            this.getInstance().emit("signal", signal);
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
            // Add other detector types here...
            default:
                throw new Error(`Unknown detector type: ${type}`);
        }
    }

    // ====================================================================
    // WORKER MANAGEMENT METHODS
    // ====================================================================

    private initializeWorkers(): void {
        if (!EnhancedDetectorFactory.dependencies) {
            throw new Error("Dependencies not set");
        }

        EnhancedDetectorFactory.dependencies.logger.info(
            "[EnhancedDetectorFactory] 🧵 Initializing workers..."
        );

        try {
            if (this.workerConfig.workerMode === "hybrid") {
                void this.createHybridWorkers();
            } else if (this.workerConfig.workerMode === "full_separation") {
                void this.createFullSeparationWorkers();
            }

            this.setupWorkerMonitoring();
            EnhancedDetectorFactory.dependencies.logger.info(
                "[EnhancedDetectorFactory] ✅ Workers initialized successfully"
            );
        } catch (error) {
            EnhancedDetectorFactory.dependencies.logger.error(
                "[EnhancedDetectorFactory] ❌ Worker initialization failed",
                { error }
            );
            throw error;
        }
    }

    private createHybridWorkers(): void {
        // Create 3-thread hybrid setup as designed earlier
        const workerConfigs = [
            {
                id: "absorption-worker",
                script: "./workers/absorptionWorker.js",
                detectors: ["absorption"],
            },
            {
                id: "exhaustion-worker",
                script: "./workers/exhaustionWorker.js",
                detectors: ["exhaustion"],
            },
            {
                id: "everything-else-worker",
                script: "./workers/everythingElseWorker.js",
                detectors: [
                    "volume",
                    "iceberg",
                    "support_resistance",
                    "cvd_confirmation",
                ],
            },
        ];

        for (const config of workerConfigs) {
            void this.createWorker(config.id, config.script, config.detectors);
        }
    }

    private createFullSeparationWorkers(): void {
        // One worker per detector type
        const detectorTypes = [
            "absorption",
            "exhaustion",
            "volume",
            "iceberg",
            "support_resistance",
        ];

        for (const detectorType of detectorTypes) {
            const workerId = `${detectorType}-worker`;
            const script = `./workers/${detectorType}Worker.js`;
            void this.createWorker(workerId, script, [detectorType]);
        }
    }

    private createWorker(
        workerId: string,
        scriptPath: string,
        detectorTypes: string[]
    ): void {
        try {
            const worker = new Worker(scriptPath, {
                workerData: {
                    workerId,
                    detectorTypes,
                    config: this.workerConfig,
                    globalConfig: EnhancedDetectorFactory.globalConfig,
                    startTime: Date.now(),
                },
            });

            this.workers.set(workerId, worker);
            this.coordinatorStats.workersCreated++;

            // Setup worker event handlers
            worker.on("message", (message: WorkerMessage) => {
                this.handleWorkerMessage(workerId, message);
            });

            worker.on("error", (error) => {
                this.handleWorkerError(workerId, error);
            });

            worker.on("exit", (code) => {
                this.handleWorkerExit(workerId, code);
            });

            // Send initialization message
            this.sendToWorker(workerId, {
                type: "INITIALIZE",
                data: {
                    dependencies: EnhancedDetectorFactory.dependencies,
                    detectorTypes,
                },
            });

            EnhancedDetectorFactory.dependencies?.logger.info(
                `[EnhancedDetectorFactory] ✅ Created worker ${workerId}`
            );
        } catch (error) {
            EnhancedDetectorFactory.dependencies?.logger.error(
                `[EnhancedDetectorFactory] ❌ Failed to create worker ${workerId}`,
                { error }
            );
            throw error;
        }
    }

    private handleWorkerMessage(
        workerId: string,
        message: WorkerMessage
    ): void {
        this.coordinatorStats.messagesRouted++;

        if (!EnhancedDetectorFactory.dependencies) return;

        switch (message.type) {
            case "READY":
                EnhancedDetectorFactory.dependencies.logger.info(
                    `[EnhancedDetectorFactory] ✅ Worker ${workerId} ready`
                );
                this.emit("workerReady", workerId);
                break;

            case "SIGNAL":
                this.handleWorkerSignal(
                    workerId,
                    message.data as WorkerMessageData
                );
                break;

            case "METRICS":
                this.updateWorkerMetrics(workerId, message.data);
                break;

            case "ERROR":
                EnhancedDetectorFactory.dependencies.logger.error(
                    `[EnhancedDetectorFactory] ❌ Worker ${workerId} error`,
                    { message }
                );
                break;

            case "HEALTH_CHECK":
                this.updateWorkerHealth(workerId, message.data);
                break;

            default:
                EnhancedDetectorFactory.dependencies.logger.debug(
                    `[EnhancedDetectorFactory] Unknown message from ${workerId}`,
                    { message }
                );
        }
    }

    private handleWorkerSignal(
        workerId: string,
        signalData: WorkerMessageData
    ): void {
        // Find the detector proxy that generated this signal
        const proxy = Array.from(this.workerProxies.values()).find(
            (p) => p.workerId === workerId && p.type === signalData.detector
        );

        if (proxy) {
            proxy.messagesReceived++;
            proxy.lastActivity = Date.now();

            // Emit signal for external consumption
            this.emit("signal", {
                ...signalData,
                detectorId: proxy.id,
                workerId: workerId,
                isFromWorker: true,
            });
        }

        EnhancedDetectorFactory.dependencies?.logger.debug(
            `[EnhancedDetectorFactory] 🎯 Signal from worker ${workerId}`,
            { signalData }
        );
    }

    private shouldUseWorker(detectorType: string): boolean {
        return (
            this.workerConfig.useWorkers &&
            this.workerConfig.criticalDetectorsInWorkers.includes(
                detectorType
            ) &&
            this.workerConfig.workerMode !== "disabled"
        );
    }

    private createWorkerDetector(
        detectorType: string,
        id: string,
        callback: DetectorCallback,
        settings: BaseDetectorSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions
    ): DetectorWorkerProxy {
        // Find appropriate worker for this detector type
        const workerId = this.findWorkerForDetector(detectorType);

        if (!workerId) {
            throw new Error(
                `No worker available for detector type: ${detectorType}`
            );
        }

        // Create detector proxy
        const proxy: DetectorWorkerProxy = {
            id,
            type: detectorType,
            workerId,
            isInWorker: true,
            lastActivity: Date.now(),
            messagesSent: 0,
            messagesReceived: 0,
            latency: 0,
            errors: 0,
        };

        this.workerProxies.set(id, proxy);
        EnhancedDetectorFactory.instances.set(id, proxy);

        // Send detector creation message to worker
        this.sendToWorker(workerId, {
            type: "CREATE_DETECTOR",
            data: {
                detectorId: id,
                detectorType,
                settings,
                options,
            },
        });

        // Setup callback routing
        this.on("signal", (signal: Detected) => {
            if (signal.id === id) {
                callback(signal);
            }
        });

        dependencies.logger.info(
            `[EnhancedDetectorFactory] Created ${detectorType} detector in worker`,
            {
                id,
                workerId,
                settings,
            }
        );

        return proxy;
    }

    private findWorkerForDetector(detectorType: string): string | null {
        // Map detector types to workers based on configuration
        if (this.workerConfig.workerMode === "hybrid") {
            switch (detectorType) {
                case "absorption":
                    return "absorption-worker";
                case "exhaustion":
                    return "exhaustion-worker";
                default:
                    return "everything-else-worker";
            }
        } else if (this.workerConfig.workerMode === "full_separation") {
            return `${detectorType}-worker`;
        }

        return null;
    }

    private sendToWorker(workerId: string, message: WorkerMessage): void {
        const worker = this.workers.get(workerId);
        if (!worker) {
            EnhancedDetectorFactory.dependencies?.logger.error(
                `[EnhancedDetectorFactory] Worker ${workerId} not found`
            );
            return;
        }

        message.timestamp = Date.now();
        worker.postMessage(message);

        // Update proxy stats
        this.workerProxies.forEach((proxy) => {
            if (proxy.workerId === workerId) {
                proxy.messagesSent++;
            }
        });
    }

    // ====================================================================
    // BACKWARD COMPATIBILITY - EXISTING FACTORY METHODS
    // ====================================================================

    private static createInProcessAbsorptionDetector(
        callback: DetectorCallback,
        settings: AbsorptionSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): AbsorptionDetector {
        const id = options.id || `absorption-${Date.now()}`;

        const productionSettings = this.applyProductionDefaults(
            settings,
            "absorption"
        );

        const detector = new AbsorptionDetector(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector as SpoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created in-process AbsorptionDetector`,
            {
                id,
                settings: productionSettings,
            }
        );

        return detector;
    }

    private static createInProcessExhaustionDetector(
        callback: DetectorCallback,
        settings: ExhaustionSettings,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions = {}
    ): ExhaustionDetector {
        const id = options.id || `exhaustion-${Date.now()}`;

        const productionSettings = this.applyProductionDefaults(
            settings,
            "exhaustion"
        );

        const detector = new ExhaustionDetector(
            id,
            this.wrapCallback(callback, id, dependencies.logger),
            productionSettings,
            dependencies.logger,
            dependencies.spoofingDetector as SpoofingDetector,
            dependencies.metricsCollector,
            dependencies.signalLogger
        );

        this.registerDetector(id, detector, dependencies, options);

        dependencies.logger.info(
            `[DetectorFactory] Created in-process ExhaustionDetector`,
            {
                id,
                settings: productionSettings,
            }
        );

        return detector;
    }

    // ====================================================================
    // ENHANCED MANAGEMENT METHODS
    // ====================================================================

    /**
     * Send trade data to appropriate detector (worker or in-process)
     */
    public static sendTradeData(
        detectorId: string,
        tradeData: EnrichedTradeEvent
    ): void {
        const instance = this.instances.get(detectorId);

        if (!instance) {
            this.dependencies?.logger.warn(
                `[EnhancedDetectorFactory] Detector ${detectorId} not found`
            );
            return;
        }

        if ("isInWorker" in instance && instance.isInWorker) {
            // Send to worker
            const factory = this.getInstance();
            factory.sendToWorker(instance.workerId, {
                type: "PROCESS_TRADE",
                data: { detectorId, tradeData },
            });
        } else {
            // Send to in-process detector
            const detector = instance as BaseDetector;
            if ("onEnrichedTrade" in detector) {
                detector.onEnrichedTrade(tradeData);
            }
        }
    }

    /**
     * Get enhanced factory statistics including worker metrics
     */
    public static getEnhancedFactoryStats(): EnhancedFactoryStats {
        const factory = this.getInstance();
        const baseStats = this.getFactoryStats();

        return {
            ...baseStats,
            workerStats: {
                workersActive: factory.workers.size,
                workersCreated: factory.coordinatorStats.workersCreated,
                workersRestarted: factory.coordinatorStats.workersRestarted,
                messagesRouted: factory.coordinatorStats.messagesRouted,
                avgWorkerLatency: factory.coordinatorStats.avgWorkerLatency,
                workerProxies: Array.from(factory.workerProxies.values()),
            },
            configuration: {
                useWorkers: factory.workerConfig.useWorkers,
                workerMode: factory.workerConfig.workerMode,
                criticalDetectors:
                    factory.workerConfig.criticalDetectorsInWorkers,
            },
        };
    }

    /**
     * Shutdown all workers and cleanup
     */
    public static async shutdown(): Promise<void> {
        const factory = this.getInstance();

        EnhancedDetectorFactory.dependencies?.logger.info(
            "[EnhancedDetectorFactory] 🛑 Shutting down..."
        );

        // Terminate all workers
        const shutdownPromises = Array.from(factory.workers.entries()).map(
            async ([workerId, worker]) => {
                EnhancedDetectorFactory.dependencies?.logger.info(
                    `[EnhancedDetectorFactory] Terminating worker ${workerId}`
                );
                await worker.terminate();
            }
        );

        await Promise.all(shutdownPromises);

        // Cleanup traditional detectors
        this.destroyAll();

        factory.workers.clear();
        factory.workerProxies.clear();

        EnhancedDetectorFactory.dependencies?.logger.info(
            "[EnhancedDetectorFactory] ✅ Shutdown complete"
        );
    }

    // ====================================================================
    // PRESERVED EXISTING METHODS (unchanged)
    // ====================================================================

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
        // ... your existing validation logic
        void settings;
    }

    private static applyProductionDefaults(
        settings: BaseDetectorSettings,
        detectorType: SignalType
    ): BaseDetectorSettings {
        // ... your existing defaults logic
        void detectorType;
        return settings;
    }

    private static wrapCallback(
        originalCallback: DetectorCallback,
        detectorId: string,
        logger: WorkerLogger
    ): DetectorCallback {
        // ... your existing callback wrapping logic
        void detectorId;
        void logger;

        return originalCallback;
    }

    private static registerDetector(
        id: string,
        detector: BaseDetector,
        dependencies: DetectorDependencies,
        options: DetectorFactoryOptions
    ): void {
        // ... your existing registration logic
        void id;
        void detector;
        void dependencies;
        void options;
    }

    public static getFactoryStats(): FactoryStats {
        // ... your existing stats logic
        return {} as FactoryStats;
    }

    public static destroyAll(): void {
        // ... your existing cleanup logic
    }

    // Additional helper methods...
    private setupErrorHandling(): void {
        process.on("uncaughtException", (error) => {
            EnhancedDetectorFactory.dependencies?.logger.error(
                "[EnhancedDetectorFactory] Uncaught exception",
                { error }
            );
        });
    }

    private setupWorkerMonitoring(): void {
        setInterval(() => {
            this.checkWorkerHealth();
        }, this.workerConfig.workerHealthCheckMs);
    }

    private checkWorkerHealth(): void {
        // Implement worker health checking
        this.workers.forEach((worker, workerId) => {
            this.sendToWorker(workerId, { type: "HEALTH_CHECK" });
        });
    }

    private handleWorkerError(workerId: string, error: Error): void {
        EnhancedDetectorFactory.dependencies?.logger.error(
            `[EnhancedDetectorFactory] Worker ${workerId} error`,
            { error }
        );
        this.coordinatorStats.workersRestarted++;
    }

    private handleWorkerExit(workerId: string, code: number): void {
        if (code !== 0) {
            EnhancedDetectorFactory.dependencies?.logger.error(
                `[EnhancedDetectorFactory] Worker ${workerId} crashed`,
                { code }
            );
            // Implement restart logic
        }
    }

    private updateWorkerMetrics(workerId: string, metrics: unknown): void {
        // Update worker performance metrics
        void workerId;
        void metrics;
    }

    private updateWorkerHealth(workerId: string, healthData: unknown): void {
        // Update worker health status
        void workerId;
        void healthData;
    }
}

// ====================================================================
// TYPE DEFINITIONS
// ====================================================================

export interface EnhancedFactoryStats extends FactoryStats {
    workerStats: {
        workersActive: number;
        workersCreated: number;
        workersRestarted: number;
        messagesRouted: number;
        avgWorkerLatency: number;
        workerProxies: DetectorWorkerProxy[];
    };
    configuration: {
        useWorkers: boolean;
        workerMode: string;
        criticalDetectors: string[];
    };
}

// Import your existing types
export interface DetectorDependencies {
    logger: WorkerLogger;
    spoofingDetector: unknown;
    metricsCollector: MetricsCollector;
    signalLogger?: ISignalLogger;
}

export interface DetectorFactoryOptions {
    id?: string;
    customMonitoring?: (detector: unknown, metrics: MetricsCollector) => void;
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

export interface FactoryStats {
    totalDetectors: number;
    maxDetectors: number;
    detectorStats: Map<string, DetectorStats>;
    healthStats: Map<string, unknown>;
    memoryUsageMB: number;
    uptime: number;
}

class HealthChecker {
    // Your existing HealthChecker implementation
}

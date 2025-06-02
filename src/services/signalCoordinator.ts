import { EventEmitter } from "events";
import {
    SignalCandidate,
    SignalType,
    ProcessedSignal,
} from "../types/signalTypes.js";
import { SignalLogger } from "./signalLogger.js";
import { BaseDetector } from "../indicators/base/baseDetector.js";
import { SignalManager } from "../trading/signalManager.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import type {
    ProcessingJob,
    DetectorRegisteredEvent,
    SignalQueuedEvent,
    SignalProcessedEvent,
    SignalFailedEvent,
    DetectorErrorEvent,
} from "../utils/types.js";

export interface SignalCoordinatorConfig {
    maxConcurrentProcessing: number;
    processingTimeoutMs: number;
    retryAttempts: number;
    retryDelayMs: number;
    enableMetrics: boolean;
    logLevel: string;
}

interface DetectorRegistration {
    detector: BaseDetector;
    signalTypes: SignalType[];
    priority: number;
    enabled: boolean;
    factoryManaged: boolean;
}

/**
 * SignalCoordinator - Central hub for signal processing pipeline
 *
 * Responsibilities:
 * - Listen to detector events and coordinate signal processing
 * - Manage processing queue with priority and concurrency controls
 * - Handle retries, timeouts, and error recovery
 * - Centralized logging and metrics collection
 * - Route processed signals to SignalManager
 */
export class SignalCoordinator extends EventEmitter {
    private readonly logger: Logger;
    private readonly signalLogger: SignalLogger;
    private readonly signalManager: SignalManager;
    private readonly metricsCollector: MetricsCollector;
    private readonly config: SignalCoordinatorConfig;

    // Detector management
    private readonly detectors = new Map<string, DetectorRegistration>();
    private readonly processingQueue: ProcessingJob[] = [];
    private readonly activeJobs = new Map<string, ProcessingJob>();

    // State management
    private isRunning = false;
    private processingInterval: NodeJS.Timeout | null = null;
    private readonly shutdownPromises: Promise<void>[] = [];

    constructor(
        config: Partial<SignalCoordinatorConfig> = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger: SignalLogger,
        signalManager: SignalManager
    ) {
        super();

        this.config = {
            maxConcurrentProcessing: 10,
            processingTimeoutMs: 30000,
            retryAttempts: 3,
            retryDelayMs: 1000,
            enableMetrics: true,
            logLevel: "info",
            ...config,
        };

        this.logger = logger;
        this.signalLogger = signalLogger;
        this.signalManager = signalManager;
        this.metricsCollector = metricsCollector;

        this.setupEventHandlers();
        this.initializeMetrics();

        this.logger.info("SignalCoordinator initialized", {
            component: "SignalCoordinator",
            config: this.config,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Register a detector manually (for non-factory detectors)
     */
    public registerDetector(
        detector: BaseDetector,
        signalTypes: SignalType[],
        priority: number = 5,
        enabled: boolean = true
    ): void {
        const detectorId = detector.getId();

        if (this.detectors.has(detectorId)) {
            this.logger.warn(
                "Detector already registered, updating configuration",
                {
                    component: "SignalCoordinator",
                    operation: "registerDetector",
                    detectorId,
                    signalTypes,
                    priority,
                    enabled,
                }
            );
        }

        const registration: DetectorRegistration = {
            detector,
            signalTypes,
            priority,
            enabled,
            factoryManaged: false,
        };

        this.detectors.set(detectorId, registration);

        // Listen to detector events
        detector.on("signalCandidate", (candidate: SignalCandidate) => {
            this.handleSignalCandidate(candidate, detector);
        });

        detector.on("error", (error: Error) => {
            this.handleDetectorError(error, detector);
        });

        detector.on("statusChange", (status: string) => {
            this.logger.info("Detector status changed", {
                component: "SignalCoordinator",
                operation: "detectorStatusChange",
                detectorId,
                status,
                factoryManaged: false,
                timestamp: new Date().toISOString(),
            });
        });

        this.logger.info("Manual detector registered successfully", {
            component: "SignalCoordinator",
            operation: "registerDetector",
            detectorId,
            signalTypes,
            priority,
            enabled,
            timestamp: new Date().toISOString(),
        });

        this.emit("detectorRegistered", {
            detectorId,
            signalTypes,
            priority,
            enabled,
            factoryManaged: false,
        } as DetectorRegisteredEvent);
    }

    /**
     * Get detector information including factory status
     */
    public getDetectorInfo(): Array<{
        id: string;
        signalTypes: SignalType[];
        priority: number;
        enabled: boolean;
        factoryManaged: boolean;
        status: string;
    }> {
        return Array.from(this.detectors.entries()).map(
            ([id, registration]) => ({
                id,
                signalTypes: registration.signalTypes,
                priority: registration.priority,
                enabled: registration.enabled,
                factoryManaged: registration.factoryManaged,
                status: registration.detector.getStatus
                    ? registration.detector.getStatus()
                    : "unknown",
            })
        );
    }
    /**
     * Unregister a detector
     */
    public unregisterDetector(detectorId: string): void {
        const registration = this.detectors.get(detectorId);
        if (!registration) {
            this.logger.warn("Attempted to unregister unknown detector", {
                component: "SignalCoordinator",
                operation: "unregisterDetector",
                detectorId,
            });
            return;
        }

        // Remove event listeners
        registration.detector.removeAllListeners();

        // Cancel any active jobs for this detector
        this.cancelDetectorJobs(detectorId);

        this.detectors.delete(detectorId);

        this.logger.info("Detector unregistered", {
            component: "SignalCoordinator",
            operation: "unregisterDetector",
            detectorId,
            factoryManaged: registration.factoryManaged,
            timestamp: new Date().toISOString(),
        });

        this.emit("detectorUnregistered", {
            detectorId,
            factoryManaged: registration.factoryManaged,
            enabled: registration.enabled,
            priority: registration.priority,
            signalTypes: registration.signalTypes,
        } as DetectorRegisteredEvent);
    }

    /**
     * Start the signal coordinator
     */
    public start(): void {
        if (this.isRunning) {
            this.logger.warn("SignalCoordinator already running");
            return;
        }

        this.isRunning = true;

        // Start processing loop
        this.processingInterval = setInterval(() => {
            this.processQueue();
        }, 100); // Process queue every 100ms

        this.logger.info("SignalCoordinator started", {
            component: "SignalCoordinator",
            operation: "start",
            registeredDetectors: Array.from(this.detectors.keys()),
            config: this.config,
            timestamp: new Date().toISOString(),
        });

        this.emit("started");
    }

    /**
     * Stop the signal coordinator gracefully
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.logger.info("Stopping SignalCoordinator...", {
            component: "SignalCoordinator",
            operation: "stop",
        });
        this.isRunning = false;

        // Clear processing interval
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }

        // Wait for active jobs to complete (with timeout)
        const activeJobPromises = Array.from(this.activeJobs.values()).map(
            (job) => this.waitForJobCompletion(job.id, 5000)
        );

        try {
            await Promise.allSettled([
                ...activeJobPromises,
                ...this.shutdownPromises,
            ]);
        } catch (error) {
            this.logger.error("Error during shutdown", {
                component: "SignalCoordinator",
                operation: "stop",
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Clear remaining jobs
        this.processingQueue.length = 0;
        this.activeJobs.clear();

        this.logger.info("SignalCoordinator stopped", {
            component: "SignalCoordinator",
            operation: "stop",
        });
        this.emit("stopped");
    }

    /**
     * Get coordinator status and statistics
     */
    public getStatus(): {
        isRunning: boolean;
        registeredDetectors: number;
        queueSize: number;
        activeJobs: number;
        config: SignalCoordinatorConfig;
    } {
        return {
            isRunning: this.isRunning,
            registeredDetectors: this.detectors.size,
            queueSize: this.processingQueue.length,
            activeJobs: this.activeJobs.size,
            config: this.config,
        };
    }

    /**
     * Handle signal candidate from detector
     */
    private handleSignalCandidate(
        candidate: SignalCandidate,
        detector: BaseDetector
    ): void {
        const detectorId = detector.getId();
        const registration = this.detectors.get(detectorId);

        if (!registration || !registration.enabled) {
            this.logger.debug("Ignoring signal from disabled detector", {
                component: "SignalCoordinator",
                operation: "handleSignalCandidate",
                detectorId,
                signalType: candidate.type,
            });
            return;
        }

        // Validate signal type
        if (!registration.signalTypes.includes(candidate.type)) {
            this.logger.warn("Detector emitted unsupported signal type", {
                component: "SignalCoordinator",
                operation: "handleSignalCandidate",
                detectorId,
                signalType: candidate.type,
                supportedTypes: registration.signalTypes,
            });
            return;
        }

        // Create processing job
        const job: ProcessingJob = {
            id: `${detectorId}_${candidate.id}_${Date.now()}`,
            candidate,
            detector,
            startTime: Date.now(),
            retryCount: 0,
            priority: registration.priority,
        };

        // Add to queue with priority sorting
        this.processingQueue.push(job);
        this.processingQueue.sort((a, b) => b.priority - a.priority);

        // Update metrics
        if (this.config.enableMetrics) {
            this.metricsCollector.incrementCounter(
                "signal_coordinator_signals_received_total",
                1,
                {
                    detector_id: detectorId,
                    signal_type: candidate.type,
                    priority: registration.priority.toString(),
                }
            );
            this.metricsCollector.setGauge(
                "signal_coordinator_queue_size",
                this.processingQueue.length
            );
        }

        this.logger.debug("Signal candidate queued for processing", {
            component: "SignalCoordinator",
            operation: "handleSignalCandidate",
            jobId: job.id,
            detectorId,
            signalType: candidate.type,
            priority: registration.priority,
            queueSize: this.processingQueue.length,
        });

        this.emit("signalQueued", {
            job,
            queueSize: this.processingQueue.length,
        } as SignalQueuedEvent);
    }

    /**
     * Process the signal queue
     */
    private processQueue(): void {
        if (!this.isRunning || this.processingQueue.length === 0) {
            return;
        }

        // Process signals up to max concurrent limit
        const availableSlots =
            this.config.maxConcurrentProcessing - this.activeJobs.size;
        const jobsToProcess = this.processingQueue.splice(0, availableSlots);

        for (const job of jobsToProcess) {
            void this.processSignal(job);
        }

        // Update queue size metric
        if (this.config.enableMetrics) {
            this.metricsCollector.setGauge(
                "signal_coordinator_queue_size",
                this.processingQueue.length
            );
        }
    }

    /**
     * Process individual signal
     */
    private async processSignal(job: ProcessingJob): Promise<void> {
        const { id, candidate, detector } = job;
        const detectorId = detector.getId();

        this.activeJobs.set(id, job);

        if (this.config.enableMetrics) {
            this.metricsCollector.setGauge(
                "signal_coordinator_active_jobs",
                this.activeJobs.size
            );
        }

        this.logger.debug("Processing signal", {
            component: "SignalCoordinator",
            operation: "processSignal",
            jobId: id,
            detectorId,
            signalType: candidate.type,
            retryCount: job.retryCount,
        });

        const startTime = Date.now();
        let processingError: Error | null = null;

        try {
            // Set processing timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(
                        new Error(
                            `Processing timeout after ${this.config.processingTimeoutMs}ms`
                        )
                    );
                }, this.config.processingTimeoutMs);
            });

            // Process the signal
            const processingPromise = this.processSignalCandidate(
                candidate,
                detector
            );

            const processedSignal = await Promise.race([
                processingPromise,
                timeoutPromise,
            ]);

            // Log the processed signal
            this.signalLogger.logProcessedSignal(processedSignal, {
                detectorId,
                processingTimeMs: Date.now() - startTime,
                retryCount: job.retryCount,
                jobId: id,
            });

            // Forward to SignalManager
            this.signalManager.handleProcessedSignal(processedSignal);

            // Update metrics
            if (this.config.enableMetrics) {
                this.metricsCollector.incrementCounter(
                    "signal_coordinator_signals_processed_total",
                    1,
                    {
                        detector_id: detectorId,
                        signal_type: candidate.type,
                        status: "success",
                    }
                );
                this.metricsCollector.recordHistogram(
                    "signal_coordinator_processing_duration_seconds",
                    (Date.now() - startTime) / 1000,
                    {
                        detector_id: detectorId,
                        signal_type: candidate.type,
                    }
                );
            }

            this.logger.info("Signal processed successfully", {
                component: "SignalCoordinator",
                operation: "processSignal",
                jobId: id,
                detectorId,
                signalType: candidate.type,
                signalId: processedSignal.id,
                processingTimeMs: Date.now() - startTime,
            });

            this.emit("signalProcessed", {
                job,
                processedSignal,
                processingTimeMs: Date.now() - startTime,
            } as SignalProcessedEvent);
        } catch (error) {
            processingError = error as Error;
            this.handleProcessingError(job, processingError);
        } finally {
            // Clean up active job
            this.activeJobs.delete(id);
            if (this.config.enableMetrics) {
                this.metricsCollector.setGauge(
                    "signal_coordinator_active_jobs",
                    this.activeJobs.size
                );
            }
        }
    }

    /**
     * Process signal candidate - core processing logic
     */
    private async processSignalCandidate(
        candidate: SignalCandidate,
        detector: BaseDetector
    ): Promise<ProcessedSignal> {
        // This is where the actual signal processing happens
        // For now, we'll create a basic processed signal
        // In a real implementation, this might involve complex analysis

        const processedSignal: ProcessedSignal = {
            id: `processed_${candidate.id}`,
            originalCandidate: candidate,
            type: candidate.type,
            confidence: candidate.confidence,
            timestamp: new Date(),
            detectorId: detector.getId(),
            processingMetadata: {
                processedAt: new Date(),
                processingVersion: "1.0.0",
                enrichments: [],
            },
            data: candidate.data,
        };

        // Simulate some processing time
        await new Promise((resolve) => setTimeout(resolve, 10));

        return processedSignal;
    }

    /**
     * Handle processing errors with retry logic
     */
    private handleProcessingError(job: ProcessingJob, error: Error): void {
        const { id, candidate, detector, retryCount } = job;
        const detectorId = detector.getId();

        this.logger.error("Signal processing failed", {
            component: "SignalCoordinator",
            operation: "handleProcessingError",
            jobId: id,
            detectorId,
            signalType: candidate.type,
            retryCount,
            error: error.message,
            stack: error.stack,
        });

        // Update error metrics
        if (this.config.enableMetrics) {
            this.metricsCollector.incrementCounter(
                "signal_coordinator_errors_total",
                1,
                {
                    detector_id: detectorId,
                    signal_type: candidate.type,
                    error_type: error.constructor.name,
                }
            );
        }

        // Log processing error
        this.signalLogger.logProcessingError(candidate, error, {
            detectorId,
            retryCount,
            jobId: id,
        });

        // Retry logic
        if (retryCount < this.config.retryAttempts) {
            const retryJob: ProcessingJob = {
                ...job,
                retryCount: retryCount + 1,
                startTime: Date.now(),
            };

            // Add delay before retry
            setTimeout(
                () => {
                    if (this.isRunning) {
                        this.processingQueue.unshift(retryJob); // Add to front for priority

                        if (this.config.enableMetrics) {
                            this.metricsCollector.incrementCounter(
                                "signal_coordinator_retries_total",
                                1,
                                {
                                    detector_id: detectorId,
                                    signal_type: candidate.type,
                                    retry_count: retryJob.retryCount.toString(),
                                }
                            );
                        }

                        this.logger.info("Retrying signal processing", {
                            component: "SignalCoordinator",
                            operation: "handleProcessingError",
                            jobId: id,
                            detectorId,
                            signalType: candidate.type,
                            retryCount: retryJob.retryCount,
                        });
                    }
                },
                this.config.retryDelayMs * Math.pow(2, retryCount)
            ); // Exponential backoff
        } else {
            // Max retries exceeded
            this.logger.error("Signal processing failed permanently", {
                component: "SignalCoordinator",
                operation: "handleProcessingError",
                jobId: id,
                detectorId,
                signalType: candidate.type,
                maxRetries: this.config.retryAttempts,
                finalError: error.message,
            });

            if (this.config.enableMetrics) {
                this.metricsCollector.incrementCounter(
                    "signal_coordinator_signals_processed_total",
                    1,
                    {
                        detector_id: detectorId,
                        signal_type: candidate.type,
                        status: "failed",
                    }
                );
            }

            this.emit("signalFailed", { job, error } as SignalFailedEvent);
        }
    }

    /**
     * Handle detector errors
     */
    private handleDetectorError(error: Error, detector: BaseDetector): void {
        const detectorId = detector.getId();

        this.logger.error("Detector error", {
            component: "SignalCoordinator",
            operation: "handleDetectorError",
            detectorId,
            error: error.message,
            stack: error.stack,
        });

        if (this.config.enableMetrics) {
            this.metricsCollector.incrementCounter(
                "signal_coordinator_errors_total",
                1,
                {
                    detector_id: detectorId,
                    signal_type: "detector_error",
                    error_type: error.constructor.name,
                }
            );
        }

        this.emit("detectorError", { detectorId, error } as DetectorErrorEvent);
    }

    /**
     * Cancel all jobs for a specific detector
     */
    private cancelDetectorJobs(detectorId: string): void {
        // Remove from queue
        const queueBefore = this.processingQueue.length;
        this.processingQueue.splice(
            0,
            this.processingQueue.length,
            ...this.processingQueue.filter(
                (job) => job.detector.getId() !== detectorId
            )
        );

        // Cancel active jobs (they will complete but won't be retried)
        const cancelledJobs: string[] = [];
        for (const [jobId, job] of this.activeJobs.entries()) {
            if (job.detector.getId() === detectorId) {
                cancelledJobs.push(jobId);
            }
        }

        this.logger.info("Cancelled detector jobs", {
            component: "SignalCoordinator",
            operation: "cancelDetectorJobs",
            detectorId,
            queueRemoved: queueBefore - this.processingQueue.length,
            activeCancelled: cancelledJobs.length,
        });
    }

    /**
     * Wait for job completion with timeout
     */
    private waitForJobCompletion(
        jobId: string,
        timeoutMs: number
    ): Promise<void> {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (!this.activeJobs.has(jobId)) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);

            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, timeoutMs);
        });
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        // Handle uncaught errors
        this.on("error", (error: Error) => {
            this.logger.error("SignalCoordinator error", {
                component: "SignalCoordinator",
                operation: "errorHandler",
                error: error.message,
                stack: error.stack,
            });
        });

        // Graceful shutdown handling
        process.on("SIGTERM", () => {
            this.logger.info("Received SIGTERM, shutting down gracefully", {
                component: "SignalCoordinator",
                operation: "shutdown",
            });
            void this.stop();
        });

        process.on("SIGINT", () => {
            this.logger.info("Received SIGINT, shutting down gracefully", {
                component: "SignalCoordinator",
                operation: "shutdown",
            });
            void this.stop();
        });
    }

    /**
     * Initialize metrics with MetricsCollector
     */
    private initializeMetrics(): void {
        if (!this.config.enableMetrics) {
            return;
        }

        // Initialize counters
        this.metricsCollector.createCounter(
            "signal_coordinator_signals_received_total",
            "Total number of signal candidates received",
            ["detector_id", "signal_type", "priority"]
        );

        this.metricsCollector.createCounter(
            "signal_coordinator_signals_processed_total",
            "Total number of signals processed",
            ["detector_id", "signal_type", "status"]
        );

        this.metricsCollector.createCounter(
            "signal_coordinator_retries_total",
            "Total number of signal processing retries",
            ["detector_id", "signal_type", "retry_count"]
        );

        this.metricsCollector.createCounter(
            "signal_coordinator_errors_total",
            "Total number of processing errors",
            ["detector_id", "signal_type", "error_type"]
        );

        // Initialize histograms
        this.metricsCollector.createHistogram(
            "signal_coordinator_processing_duration_seconds",
            "Time spent processing signals",
            ["detector_id", "signal_type"],
            [0.1, 0.5, 1, 2, 5, 10, 30]
        );

        // Initialize gauges
        this.metricsCollector.createGauge(
            "signal_coordinator_queue_size",
            "Current number of signals in processing queue"
        );

        this.metricsCollector.createGauge(
            "signal_coordinator_active_jobs",
            "Current number of actively processing signals"
        );

        this.logger.debug("SignalCoordinator metrics initialized", {
            component: "SignalCoordinator",
            operation: "initializeMetrics",
            enableMetrics: this.config.enableMetrics,
        });
    }
}

import FastPriorityQueue from "fastpriorityqueue";
import { ulid } from "ulid";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import {
    SignalCandidate,
    ProcessedSignal,
    SignalType,
} from "../types/signalTypes.js";
import { BaseDetector } from "../indicators/base/baseDetector.js";
import { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { ProductionUtils } from "../utils/productionUtils.js";
import { SignalManager } from "../trading/signalManager.js";
import { ThreadManager } from "../multithreading/threadManager.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import type {
    DetectorErrorEvent,
    DetectorRegisteredEvent,
    ProcessingJob,
    SignalFailedEvent,
    SignalProcessedEvent,
    SignalQueuedEvent,
} from "../utils/types.js";

/**
 * Priority queue wrapper so we can expose size quickly while keeping the
 * FastPriorityQueue internals encapsulated.
 */
class ProcessingJobQueue {
    private readonly pq = new FastPriorityQueue<ProcessingJob>(
        (a, b) => a.priority > b.priority
    );

    /** current queue size */
    public get size(): number {
        return this.pq.size;
    }

    /** enqueue a job */
    public push(job: ProcessingJob): void {
        this.pq.add(job);
    }

    /** dequeue a job (highest priority first) */
    public pop(): ProcessingJob | undefined {
        return this.pq.poll();
    }

    /** remove all jobs for a detector (used on unregister) */
    public removeByDetector(detectorId: string): number {
        const jobs: ProcessingJob[] = [];
        let removed = 0;

        while (!this.pq.isEmpty()) {
            const j = this.pq.poll()!;
            if (j.detector.getId() === detectorId) removed++;
            else jobs.push(j);
        }
        jobs.forEach((j) => this.pq.add(j));
        return removed;
    }

    /** clear queue */
    public clear(): void {
        while (!this.pq.isEmpty()) this.pq.poll();
    }

    /** iterator helper */
    public *drain(limit: number): Generator<ProcessingJob> {
        for (let i = 0; i < limit && !this.pq.isEmpty(); i += 1) {
            yield this.pq.poll()!;
        }
    }
}

/* -------------------------------------------------------------------------- */

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
 * SignalCoordinator – central hub orchestrating detectors → queue → processor.
 */
export class SignalCoordinator extends EventEmitter {
    private readonly logger: ILogger;
    private readonly signalLogger: ISignalLogger;
    private readonly signalManager: SignalManager;
    private readonly threadManager: ThreadManager;
    private readonly metrics: MetricsCollector;
    private readonly cfg: SignalCoordinatorConfig;

    /* detector registry */
    private readonly detectors = new Map<string, DetectorRegistration>();

    /* new priority queue implementation */
    private readonly queue = new ProcessingJobQueue();

    /* active processing slots */
    private readonly active = new Map<string, ProcessingJob>();

    /* runtime */
    private isRunning = false;
    private processingTick: NodeJS.Timeout | null = null;
    private readonly shutdownPromises: Promise<void>[] = [];
    private readonly processListeners = new Map<string, () => void>();
    private readonly errorHandler = (err: Error) =>
        this.logger.error("SignalCoordinator error", { err });

    constructor(
        partialCfg: Partial<SignalCoordinatorConfig>,
        logger: ILogger,
        metricsCollector: MetricsCollector,
        signalLogger: ISignalLogger,
        signalManager: SignalManager,
        threadManager: ThreadManager
    ) {
        super();

        this.cfg = {
            maxConcurrentProcessing: 10,
            processingTimeoutMs: 30_000,
            retryAttempts: 3,
            retryDelayMs: 1_000,
            enableMetrics: true,
            logLevel: "info",
            ...partialCfg,
        };

        this.logger = logger;
        this.metrics = metricsCollector;
        this.signalLogger = signalLogger;
        this.signalManager = signalManager;
        this.threadManager = threadManager;

        this.setupEventHandlers();
        this.initializeMetrics();

        this.logger.info("SignalCoordinator initialised", {
            component: "SignalCoordinator",
            cfg: this.cfg,
        });
    }

    /* ---------------------------------------------------------------------- */
    /*  DETECTOR REGISTRATION                                                 */
    /* ---------------------------------------------------------------------- */

    public registerDetector(
        detector: BaseDetector,
        signalTypes: SignalType[],
        priority = 5,
        enabled = true
    ): void {
        const detectorId = detector.getId();

        const registration: DetectorRegistration = {
            detector,
            signalTypes,
            priority,
            enabled,
            factoryManaged: false,
        };
        this.detectors.set(detectorId, registration);

        /* listen to detector events */
        detector.on("signalCandidate", (c: SignalCandidate) =>
            this.onSignalCandidate(c, detector)
        );
        detector.on("error", (err: Error) =>
            this.handleDetectorError(err, detector)
        );

        this.logger.info("Detector registered", {
            detectorId,
            priority,
            signalTypes,
        });

        this.emit("detectorRegistered", {
            detectorId,
            signalTypes,
            priority,
            enabled,
            factoryManaged: false,
        } as DetectorRegisteredEvent);
    }

    public unregisterDetector(detectorId: string): void {
        const reg = this.detectors.get(detectorId);
        if (!reg) return;

        reg.detector.removeAllListeners();
        const removed = this.queue.removeByDetector(detectorId);
        this.detectors.delete(detectorId);

        this.logger.info("Detector unregistered", {
            detectorId,
            queuedJobsRemoved: removed,
        });

        this.emit("detectorUnregistered", {
            detectorId,
            priority: reg.priority,
            enabled: reg.enabled,
            factoryManaged: reg.factoryManaged,
            signalTypes: reg.signalTypes,
        } as DetectorRegisteredEvent);
    }

    /* ---------------------------------------------------------------------- */
    /*  LIFECYCLE                                                             */
    /* ---------------------------------------------------------------------- */

    public async start(): Promise<void> {
        const correlationId = randomUUID();

        try {
            if (this.isRunning) return;
            this.isRunning = true;

            /* restore any jobs left in the DB from a previous run */
            const restoreQueuedJobs: ProcessingJob[] =
                (await this.threadManager.callStorage(
                    "restoreQueuedJobs"
                )) as ProcessingJob[];
            for (const j of restoreQueuedJobs) {
                this.queue.push(j);
            }

            this.processingTick = setInterval(
                () => void this.processQueue(),
                100
            );

            this.logger.info(
                "SignalCoordinator started",
                {
                    component: "SignalCoordinator",
                    operation: "start",
                    restoredJobs: restoreQueuedJobs.length,
                },
                correlationId
            );
            this.emit("started");
        } catch (error) {
            this.isRunning = false;
            this.logger.error(
                "Failed to start SignalCoordinator",
                {
                    component: "SignalCoordinator",
                    operation: "start",
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                correlationId
            );
            throw error;
        }
    }

    public async stop(): Promise<void> {
        const correlationId = randomUUID();

        try {
            if (!this.isRunning) return;
            this.isRunning = false;

            if (this.processingTick) {
                clearInterval(this.processingTick);
                this.processingTick = null;
            }

            /* wait for active jobs */
            const waiters = [...this.active.values()].map((j) =>
                this.waitForCompletion(j.id, 5_000)
            );
            const results = await Promise.allSettled([
                ...waiters,
                ...this.shutdownPromises,
            ]);

            // Log any failed shutdowns
            const failures = results.filter(
                (r) => r.status === "rejected"
            ).length;
            if (failures > 0) {
                this.logger.warn(
                    "Some shutdown operations failed",
                    {
                        component: "SignalCoordinator",
                        operation: "stop",
                        failedOperations: failures,
                        totalOperations: results.length,
                    },
                    correlationId
                );
            }

            /* cleanup */
            this.active.clear();
            this.queue.clear();

            this.logger.info(
                "SignalCoordinator stopped",
                {
                    component: "SignalCoordinator",
                    operation: "stop",
                },
                correlationId
            );
            this.emit("stopped");
        } catch (error) {
            this.logger.error(
                "Error during SignalCoordinator shutdown",
                {
                    component: "SignalCoordinator",
                    operation: "stop",
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                correlationId
            );
            throw error;
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  SIGNAL HANDLING                                                       */
    /* ---------------------------------------------------------------------- */

    private onSignalCandidate(
        candidate: SignalCandidate,
        detector: BaseDetector
    ): void {
        const reg = this.detectors.get(detector.getId());
        if (!reg || !reg.enabled) return;

        // Track signal candidates received by type
        this.metrics.incrementCounter(
            "signal_coordinator_signals_received_total",
            1,
            {
                detector_id: detector.getId(),
                signal_type: candidate.type,
                priority: reg.priority.toString(),
            }
        );
        // Also track per-type totals for easier stats aggregation
        this.metrics.incrementCounter(
            `signal_coordinator_signals_received_total_${candidate.type}`,
            1
        );

        if (!reg.signalTypes.includes(candidate.type)) {
            this.logger.warn("Unsupported signalType from detector", {
                detectorId: detector.getId(),
                got: candidate.type,
                allowed: reg.signalTypes,
            });
            return;
        }

        const job: ProcessingJob = {
            id: ulid(),
            candidate,
            detector,
            startTime: Date.now(),
            retryCount: 0,
            priority: reg.priority,
        };

        this.queue.push(job);
        void this.threadManager.callStorage("enqueueJob", job);
        this.metrics.setGauge("signal_coordinator_queue_size", this.queue.size);

        this.emit("signalQueued", {
            job,
            queueSize: this.queue.size,
        } as SignalQueuedEvent);
    }

    private async processQueue(): Promise<void> {
        const correlationId = randomUUID();

        try {
            if (!this.isRunning) return;
            const slots = this.cfg.maxConcurrentProcessing - this.active.size;
            if (slots <= 0) return;

            /* if the in-memory queue is drained, refill from persistent storage */
            if (this.queue.size === 0) {
                try {
                    const jobs = (await this.threadManager.callStorage(
                        "dequeueJobs",
                        slots
                    )) as ProcessingJob[];
                    for (const j of jobs) {
                        this.queue.push(j);
                    }
                } catch (error) {
                    this.logger.error(
                        "Failed to dequeue jobs from storage",
                        {
                            component: "SignalCoordinator",
                            operation: "processQueue",
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
                    return; // Skip processing this cycle if storage fails
                }
            }
            if (this.queue.size === 0) return;

            for (const job of this.queue.drain(slots)) {
                void this.processJob(job);
            }
            this.metrics.setGauge(
                "signal_coordinator_queue_size",
                this.queue.size
            );
        } catch (error) {
            this.logger.error(
                "Error in processQueue",
                {
                    component: "SignalCoordinator",
                    operation: "processQueue",
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                correlationId
            );
        }
    }

    private async processJob(job: ProcessingJob): Promise<void> {
        this.active.set(job.id, job);
        this.metrics.setGauge(
            "signal_coordinator_active_jobs",
            this.active.size
        );

        const { detector, candidate } = job;
        const detectorId = detector.getId();
        const start = Date.now();

        try {
            const timeout = new Promise<never>((_, rej) =>
                setTimeout(
                    () =>
                        rej(
                            new Error(
                                `Timeout ${this.cfg.processingTimeoutMs} ms`
                            )
                        ),
                    this.cfg.processingTimeoutMs
                )
            );

            const processed = await Promise.race([
                this.processSignalCandidate(candidate, detector),
                timeout,
            ]);

            if (this.signalLogger.logProcessedSignal) {
                this.signalLogger.logProcessedSignal(processed, {
                    detectorId,
                    jobId: job.id,
                    processingMs: Date.now() - start,
                    retry: job.retryCount,
                });
            }
            const confirmed =
                this.signalManager.handleProcessedSignal(processed);

            if (confirmed) {
                const data = processed.data as unknown as Record<
                    string,
                    unknown
                >;
                let zone = 0;
                if (typeof data === "object" && data !== null) {
                    if ("zone" in data && typeof data.zone === "number") {
                        zone = data.zone;
                    } else if (
                        "price" in data &&
                        typeof data.price === "number"
                    ) {
                        zone = data.price;
                    }
                }

                let side: "buy" | "sell" = "buy";
                if (
                    typeof data === "object" &&
                    data !== null &&
                    "side" in data &&
                    (data.side === "buy" || data.side === "sell")
                ) {
                    side = data.side;
                }

                detector.markSignalConfirmed(zone, side);
            }

            this.metrics.incrementCounter(
                "signal_coordinator_signals_processed_total",
                1,
                {
                    detector_id: detectorId,
                    signal_type: candidate.type,
                    ok: "1",
                }
            );
            // Per-type processed counter
            this.metrics.incrementCounter(
                `signal_coordinator_signals_processed_total_${candidate.type}`,
                1
            );
            this.metrics.recordHistogram(
                "signal_coordinator_processing_duration_seconds",
                (Date.now() - start) / 1_000,
                { detector_id: detectorId, signal_type: candidate.type }
            );

            this.emit("signalProcessed", {
                job,
                processedSignal: processed,
                processingTimeMs: Date.now() - start,
            } as SignalProcessedEvent);
        } catch (err) {
            this.handleProcessingError(job, err as Error);
        } finally {
            this.active.delete(job.id);
            await this.threadManager.callStorage("markJobCompleted", job.id);
            this.metrics.setGauge(
                "signal_coordinator_active_jobs",
                this.active.size
            );
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  CORE PROCESSING (still placeholder)                                   */
    /* ---------------------------------------------------------------------- */

    private async processSignalCandidate(
        candidate: SignalCandidate,
        detector: BaseDetector
    ): Promise<ProcessedSignal> {
        await ProductionUtils.sleep(10); // TODO: real logic
        return {
            id: `proc_${ulid()}`,
            originalCandidate: candidate,
            type: candidate.type,
            confidence: candidate.confidence,
            timestamp: new Date(),
            detectorId: detector.getId(),
            processingMetadata: {
                processedAt: new Date(),
                processingVersion: "2.0.0",
            },
            data: candidate.data,
        };
    }

    /* ---------------------------------------------------------------------- */
    /*  ERROR HANDLING / RETRY                                                */
    /* ---------------------------------------------------------------------- */

    private handleProcessingError(job: ProcessingJob, err: Error): void {
        const { detector, candidate } = job;
        const detectorId = detector.getId();

        if (this.signalLogger.logProcessingError) {
            this.signalLogger.logProcessingError(candidate, err, {
                detectorId,
                jobId: job.id,
                retry: job.retryCount,
            });
        }

        const metricsLabels = {
            detector_id: detectorId,
            signal_type: candidate.type,
        };
        this.metrics.incrementCounter("signal_coordinator_errors_total", 1, {
            ...metricsLabels,
            error: err.name,
        });

        if (job.retryCount < this.cfg.retryAttempts) {
            const retryJob: ProcessingJob = {
                ...job,
                retryCount: job.retryCount + 1,
                startTime: Date.now(),
            };
            setTimeout(
                () => {
                    this.queue.push(retryJob);
                    void this.threadManager.callStorage("enqueueJob", retryJob);
                },
                this.cfg.retryDelayMs * 2 ** job.retryCount
            );
            this.metrics.incrementCounter(
                "signal_coordinator_retries_total",
                1,
                { ...metricsLabels, retry: retryJob.retryCount.toString() }
            );
            this.logger.warn("Retrying job", {
                jobId: job.id,
                retry: retryJob.retryCount,
            });
        } else {
            this.logger.error("Job failed permanently", {
                jobId: job.id,
                detectorId,
                error: err.message,
            });
            this.emit("signalFailed", {
                job,
                error: err,
            } as SignalFailedEvent);
        }
    }

    private handleDetectorError(err: Error, detector: BaseDetector): void {
        const detectorId = detector.getId();
        this.logger.error("Detector error", { detectorId, err: err.message });
        this.metrics.incrementCounter("signal_coordinator_errors_total", 1, {
            detector_id: detectorId,
            signal_type: "detector_error",
        });
        this.emit("detectorError", {
            detectorId,
            error: err,
        } as DetectorErrorEvent);
    }

    /* ---------------------------------------------------------------------- */
    /*  UTILITIES                                                             */
    /* ---------------------------------------------------------------------- */

    private waitForCompletion(jobId: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                if (!this.active.has(jobId)) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
            setTimeout(() => {
                clearInterval(interval);
                resolve();
            }, timeoutMs);
        });
    }

    private setupEventHandlers(): void {
        this.on("error", this.errorHandler);

        ["SIGTERM", "SIGINT"].forEach((sig) => {
            const handler = () => {
                this.logger.info(`${sig} received – shutting down…`);
                void this.stop();
            };
            this.processListeners.set(sig, handler);
            process.on(sig, handler);
        });
    }

    private initializeMetrics(): void {
        if (!this.cfg.enableMetrics) return;

        this.metrics.createCounter(
            "signal_coordinator_signals_processed_total",
            "Total processed signals",
            ["detector_id", "signal_type", "ok"]
        );
        this.metrics.createCounter(
            "signal_coordinator_signals_received_total",
            "Signal candidates received",
            ["detector_id", "signal_type", "priority"]
        );
        this.metrics.createCounter(
            "signal_coordinator_retries_total",
            "Signal processing retries",
            ["detector_id", "signal_type", "retry"]
        );
        this.metrics.createCounter(
            "signal_coordinator_errors_total",
            "Processing errors",
            ["detector_id", "signal_type", "error"]
        );
        this.metrics.createGauge(
            "signal_coordinator_queue_size",
            "Queue length"
        );
        this.metrics.createGauge(
            "signal_coordinator_active_jobs",
            "Concurrent jobs"
        );
        this.metrics.createHistogram(
            "signal_coordinator_processing_duration_seconds",
            "Job processing time",
            ["detector_id", "signal_type"],
            [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]
        );
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
     * Get coordinator status and statistics
     */
    public getStatus(): {
        isRunning: boolean;
        registeredDetectors: number;
        queueSize: number;
        activeJobs: number;
    } {
        return {
            isRunning: this.isRunning,
            registeredDetectors: this.detectors.size,
            queueSize: this.queue.size,
            activeJobs: this.active.size,
        };
    }

    /**
     * Cleanup event listeners and internal state
     */
    public async cleanup(): Promise<void> {
        await this.stop();

        for (const reg of this.detectors.values()) {
            reg.detector.removeAllListeners();
        }
        this.detectors.clear();

        for (const [sig, handler] of this.processListeners) {
            process.off(sig, handler);
        }
        this.processListeners.clear();

        this.off("error", this.errorHandler);
        this.removeAllListeners();

        this.logger.info("SignalCoordinator cleanup completed");
    }
}

// src/infrastructure/recoveryManager.ts

import { EventEmitter } from "events";
import { spawn } from "child_process";
import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "./metricsCollector.js";
import { ProductionUtils } from "../utils/productionUtils.js";

export interface HardReloadEvent {
    reason: string;
    component: string;
    attempts: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

export interface RecoveryManagerConfig {
    enableHardReload: boolean;
    hardReloadCooldownMs: number;
    maxHardReloads: number;
    hardReloadRestartCommand: string;
}

export class RecoveryManager extends EventEmitter {
    private readonly logger: WorkerLogger;
    private readonly metricsCollector: MetricsCollector;
    private readonly config: RecoveryManagerConfig;

    private hardReloadCount = 0;
    private lastHardReloadTime = 0;
    private isHardReloadInProgress = false;

    constructor(
        config: RecoveryManagerConfig,
        logger: WorkerLogger,
        metricsCollector: MetricsCollector
    ) {
        super();
        this.config = config;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        this.logger.info("[RecoveryManager] Initialized", {
            enableHardReload: config.enableHardReload,
            cooldownMs: config.hardReloadCooldownMs,
            maxHardReloads: config.maxHardReloads,
        });
    }

    /**
     * Request a hard reload of the system
     */
    public requestHardReload(event: HardReloadEvent): boolean {
        if (!this.config.enableHardReload) {
            this.logger.warn(
                "[RecoveryManager] Hard reload requested but disabled",
                {
                    reason: event.reason,
                    component: event.component,
                }
            );
            return false;
        }

        if (this.isHardReloadInProgress) {
            this.logger.warn(
                "[RecoveryManager] Hard reload already in progress",
                {
                    reason: event.reason,
                    component: event.component,
                }
            );
            return false;
        }

        // Check cooldown period
        const now = Date.now();
        const timeSinceLastReload = now - this.lastHardReloadTime;
        if (
            this.lastHardReloadTime > 0 &&
            timeSinceLastReload < this.config.hardReloadCooldownMs
        ) {
            this.logger.warn(
                "[RecoveryManager] Hard reload in cooldown period",
                {
                    reason: event.reason,
                    component: event.component,
                    timeSinceLastReload,
                    cooldownMs: this.config.hardReloadCooldownMs,
                }
            );
            return false;
        }

        // Check max hard reload limit
        if (this.hardReloadCount >= this.config.maxHardReloads) {
            this.logger.error(
                "[RecoveryManager] Max hard reloads exceeded, giving up",
                {
                    reason: event.reason,
                    component: event.component,
                    hardReloadCount: this.hardReloadCount,
                    maxHardReloads: this.config.maxHardReloads,
                }
            );
            this.emit("hardReloadLimitExceeded", {
                ...event,
                hardReloadCount: this.hardReloadCount,
            });
            return false;
        }

        this.lastHardReloadTime = Date.now();
        void this.executeHardReload(event);
        return true;
    }

    /**
     * Execute the hard reload process
     */
    private async executeHardReload(event: HardReloadEvent): Promise<void> {
        this.isHardReloadInProgress = true;
        this.hardReloadCount++;

        this.logger.error("[RecoveryManager] Initiating hard reload", {
            reason: event.reason,
            component: event.component,
            attempts: event.attempts,
            hardReloadCount: this.hardReloadCount,
            maxHardReloads: this.config.maxHardReloads,
        });

        this.metricsCollector.incrementCounter("recovery.hardReload.initiated");
        this.metricsCollector.recordGauge(
            "recovery.hardReload.count",
            this.hardReloadCount
        );

        // Emit pre-restart event for graceful cleanup
        this.emit("hardReloadStarting", {
            ...event,
            hardReloadCount: this.hardReloadCount,
        });

        // Give components time to clean up
        await ProductionUtils.sleep(2000);

        try {
            if (this.config.hardReloadRestartCommand === "process.exit") {
                // For simple process restart (let process manager handle restart)
                this.logger.error(
                    "[RecoveryManager] Executing process.exit() for hard reload"
                );
                process.exit(1);
            } else {
                // For custom restart command
                await this.executeRestartCommand(event);
            }
        } catch (error) {
            this.logger.error("[RecoveryManager] Hard reload failed", {
                error: error instanceof Error ? error.message : String(error),
                command: this.config.hardReloadRestartCommand,
            });
            this.metricsCollector.incrementCounter(
                "recovery.hardReload.failed"
            );
            this.isHardReloadInProgress = false;
        }
    }

    /**
     * Execute custom restart command
     */
    private async executeRestartCommand(event: HardReloadEvent): Promise<void> {
        const command = this.config.hardReloadRestartCommand;
        const [cmd, ...args] = command.split(" ");

        this.logger.info("[RecoveryManager] Executing restart command", {
            command,
            reason: event.reason,
        });

        return new Promise((resolve, reject) => {
            const child = spawn(cmd, args, {
                stdio: "pipe",
                detached: true,
            });

            let output = "";
            let errorOutput = "";

            child.stdout?.on("data", (data: unknown) => {
                output += String(data);
            });

            child.stderr?.on("data", (data: unknown) => {
                errorOutput += String(data);
            });

            child.on("error", (error) => {
                this.logger.error("[RecoveryManager] Restart command error", {
                    error: error.message,
                    command,
                });
                reject(error);
            });

            child.on("exit", (code) => {
                if (code === 0) {
                    this.logger.info(
                        "[RecoveryManager] Restart command completed",
                        {
                            command,
                            output: output.trim(),
                        }
                    );
                    resolve();
                } else {
                    this.logger.error(
                        "[RecoveryManager] Restart command failed",
                        {
                            command,
                            exitCode: code,
                            output: output.trim(),
                            errorOutput: errorOutput.trim(),
                        }
                    );
                    reject(
                        new Error(
                            `Restart command failed with exit code ${code}`
                        )
                    );
                }
            });

            // Detach the child process so it can continue after this process exits
            child.unref();
        });
    }

    /**
     * Get recovery statistics
     */
    public getStats() {
        return {
            hardReloadCount: this.hardReloadCount,
            lastHardReloadTime: this.lastHardReloadTime,
            isHardReloadInProgress: this.isHardReloadInProgress,
            config: this.config,
        };
    }

    /**
     * Reset hard reload counter (for testing or manual reset)
     */
    public resetHardReloadCount(): void {
        this.hardReloadCount = 0;
        this.lastHardReloadTime = 0;
        this.logger.info("[RecoveryManager] Hard reload counter reset");
    }
}

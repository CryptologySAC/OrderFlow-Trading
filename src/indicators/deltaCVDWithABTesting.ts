// src/indicators/deltaCVDWithABTesting.ts

import {
    DeltaCVDConfirmation,
    type DeltaCVDConfirmationSettings,
} from "./deltaCVDConfirmation.js";
import { DeltaCVDABMonitor } from "../analysis/deltaCVDABMonitor.js";
import {
    DeltaCVDTestProfile,
    TEST_PROFILE_CONFIGS,
} from "../backtesting/deltaCVDABTestFramework.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";
import type { IOrderBookState } from "../market/orderBookState.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";

/**
 * Extended settings for A/B testing
 */
export interface DeltaCVDWithABTestingSettings
    extends DeltaCVDConfirmationSettings {
    enableABTesting?: boolean;
    abTestProfile?: DeltaCVDTestProfile;
    abTestUserId?: string;
    abTestMonitor?: DeltaCVDABMonitor;
}

/**
 * DeltaCVD detector with integrated A/B testing support
 * Allows real-time performance comparison of different configurations
 */
export class DeltaCVDWithABTesting extends DeltaCVDConfirmation {
    private readonly abTestingEnabled: boolean;
    private readonly abTestProfile: DeltaCVDTestProfile | null;
    private readonly abTestUserId: string | null;
    private readonly abMonitor: DeltaCVDABMonitor | null;
    private processingStartTime: number = 0;

    constructor(
        id: string,
        settings: DeltaCVDWithABTestingSettings,
        orderBook: IOrderBookState,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger
    ) {
        // Apply A/B test configuration if enabled
        let effectiveSettings = settings;

        if (settings.enableABTesting && settings.abTestProfile) {
            const profileConfig = TEST_PROFILE_CONFIGS[settings.abTestProfile];
            effectiveSettings = { ...settings, ...profileConfig };

            logger.info("DeltaCVD A/B testing enabled", {
                detectorId: id,
                profile: settings.abTestProfile,
                userId: settings.abTestUserId,
                config: profileConfig,
            });
        }

        const spoofingDetector = {
            checkSpoof: () => ({ isSpoofed: false, confidence: 0 }),
        } as unknown as import("../services/spoofingDetector.js").SpoofingDetector;

        super(
            id,
            effectiveSettings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        this.abTestingEnabled = settings.enableABTesting || false;
        this.abTestProfile = settings.abTestProfile || null;
        this.abTestUserId = settings.abTestUserId || null;
        this.abMonitor = settings.abTestMonitor || null;
    }

    /**
     * Override detect method to track A/B testing metrics
     */
    public processMarketEvent(trade: EnrichedTradeEvent): void {
        if (this.abTestingEnabled && this.abMonitor && this.abTestProfile) {
            this.processingStartTime = Date.now();
        }

        try {
            super.processMarketEvent(trade);

            if (this.abTestingEnabled && this.abMonitor && this.abTestProfile) {
                const processingTime = Date.now() - this.processingStartTime;
                this.abMonitor.recordPerformance(
                    this.abTestProfile,
                    processingTime,
                    undefined,
                    false
                );
            }
        } catch (error) {
            if (this.abTestingEnabled && this.abMonitor && this.abTestProfile) {
                const processingTime = Date.now() - this.processingStartTime;
                this.abMonitor.recordPerformance(
                    this.abTestProfile,
                    processingTime,
                    undefined,
                    true
                );
            }
            throw error;
        }
    }

    /**
     * Override signal emission to track A/B testing metrics
     */
    protected emitSignal(signal: SignalCandidate): void {
        super.emit("signal", signal);

        // Record signal in A/B monitor
        if (this.abTestingEnabled && this.abMonitor && this.abTestProfile) {
            const processingTime = Date.now() - this.processingStartTime;
            this.abMonitor.recordPerformance(
                this.abTestProfile,
                processingTime,
                signal,
                false
            );
        }

        // Add A/B test metadata to signal if enabled
        if (this.abTestingEnabled && this.abTestProfile) {
            (
                signal as SignalCandidate & { abTestMetadata?: unknown }
            ).abTestMetadata = {
                profile: this.abTestProfile,
                userId: this.abTestUserId,
                timestamp: Date.now(),
            };
        }
    }

    /**
     * Get current A/B test configuration
     */
    public getABTestConfig(): {
        enabled: boolean;
        profile: DeltaCVDTestProfile | null;
        userId: string | null;
        config: Partial<DeltaCVDConfirmationSettings> | null;
    } {
        return {
            enabled: this.abTestingEnabled,
            profile: this.abTestProfile,
            userId: this.abTestUserId,
            config: this.abTestProfile
                ? TEST_PROFILE_CONFIGS[this.abTestProfile]
                : null,
        };
    }

    /**
     * Factory method to create A/B test instances
     */
    public static createWithABTesting(
        id: string,
        baseSettings: DeltaCVDConfirmationSettings,
        orderBook: IOrderBookState,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger: ISignalLogger,
        abMonitor: DeltaCVDABMonitor,
        userId: string
    ): DeltaCVDWithABTesting {
        // Assign profile based on monitor's allocation strategy
        const profile = abMonitor.assignProfile(userId);

        const settings: DeltaCVDWithABTestingSettings = {
            ...baseSettings,
            enableABTesting: true,
            abTestProfile: profile,
            abTestUserId: userId,
            abTestMonitor: abMonitor,
        };

        return new DeltaCVDWithABTesting(
            id,
            settings,
            orderBook,
            logger,
            metricsCollector,
            signalLogger
        );
    }

    /**
     * Get performance metrics for this instance
     */
    public getPerformanceMetrics(): {
        profile: DeltaCVDTestProfile | null;
        avgProcessingTime: number;
        signalCount: number;
        errorCount: number;
    } | null {
        if (!this.abTestingEnabled || !this.abMonitor || !this.abTestProfile) {
            return null;
        }

        const status = this.abMonitor.getStatus();
        const performance = status.profiles.get(this.abTestProfile);

        if (!performance) {
            return null;
        }

        return {
            profile: this.abTestProfile,
            avgProcessingTime:
                performance.processingTimes.length > 0
                    ? performance.processingTimes.reduce((a, b) => a + b, 0) /
                      performance.processingTimes.length
                    : 0,
            signalCount: performance.signalCount,
            errorCount: performance.errors,
        };
    }
}

// src/trading/signalManager.ts

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { Signal, TradingSignalData } from "../types/signalTypes.js";
import type {
    Detected,
    ConfirmedSignal,
    MarketAnomaly,
} from "../utils/types.js";
import { SignalCoordinator } from "../services/signalCoordinator.js";
import { AnomalyDetector } from "../services/anomalyDetector.js";
import { AlertManager } from "../alerts/alertManager.js";
import { Logger } from "../infrastructure/logger.js";
import {
    calculateProfitTarget,
    calculateStopLoss,
} from "../utils/calculations.js";

/**
 * Manages trading signal generation and processing
 */
export class SignalManager extends EventEmitter {
    constructor(
        private readonly signalCoordinator: SignalCoordinator,
        private readonly anomalyDetector: AnomalyDetector,
        private readonly alertManager: AlertManager,
        private readonly logger: Logger
    ) {
        super();
        this.setupSignalHandlers();
    }

    /**
     * Setup signal confirmation handlers
     */
    private setupSignalHandlers(): void {
        this.signalCoordinator.on(
            "signal_confirmed",
            (signal: ConfirmedSignal) => {
                void this.handleConfirmedSignal(signal).catch((error) => {
                    this.logger.error("Error handling confirmed signal", {
                        error,
                    });
                });
            }
        );
    }

    /**
     * Process absorption detection
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    public async processAbsorption(detected: Detected): Promise<void> {
        const correlationId = randomUUID();

        const signalId = this.signalCoordinator.submitSignal(
            "absorption",
            detected.price,
            "absorption_detector",
            {
                volume: detected.totalAggressiveVolume,
                side: detected.side,
                passiveVolume: detected.passiveVolume,
                zone: detected.zone,
                refilled: detected.refilled,
            }
        );

        if (signalId) {
            this.logger.info(
                "Absorption signal submitted",
                { signalId, price: detected.price },
                correlationId
            );
        }
    }

    /**
     * Process exhaustion detection
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    public async processExhaustion(detected: Detected): Promise<void> {
        const correlationId = randomUUID();

        const signalId = this.signalCoordinator.submitSignal(
            "exhaustion",
            detected.price,
            "exhaustion_detector",
            {
                volume: detected.totalAggressiveVolume,
                side: detected.side,
                passiveVolume: detected.passiveVolume,
                zone: detected.zone,
                refilled: detected.refilled,
            }
        );

        if (signalId) {
            this.logger.info(
                "Exhaustion signal submitted",
                { signalId, price: detected.price },
                correlationId
            );
        }
    }

    /**
     * Handle confirmed signals from coordinator
     */
    private async handleConfirmedSignal(
        signal: ConfirmedSignal
    ): Promise<void> {
        this.logger.info("[SignalManager] handleConfirmedSignal", {
            signalId: signal.id,
            price: signal.finalPrice,
        });
        const correlationId = randomUUID();

        try {
            // Check for market anomalies
            const anomaly = this.checkMarketAnomaly(signal.finalPrice);

            if (anomaly && anomaly?.severity === "critical") {
                this.logger.warn(
                    "Signal rejected due to market anomaly",
                    { anomaly, signalId: signal.id },
                    correlationId
                );
                return;
            }

            // Generate trading signal
            const tradingSignal = this.createTradingSignal(signal, anomaly);

            // Send alerts and emit signal
            await this.alertManager.sendAlert(tradingSignal);
            this.emit("signal_generated", tradingSignal);

            this.logger.info(
                "Confirmed signal processed",
                { signalId: signal.id, price: signal.finalPrice },
                correlationId
            );
        } catch (error) {
            this.logger.error(
                "Failed to process confirmed signal",
                { error, signalId: signal.id },
                correlationId
            );
        }
    }

    /**
     * Check for market anomalies
     */
    private checkMarketAnomaly(price: number): MarketAnomaly | null {
        const marketHealth = this.anomalyDetector.getMarketHealth();
        if (marketHealth.isHealthy || !marketHealth.highestSeverity) {
            return null;
        }

        const marketAnomaly: MarketAnomaly = {
            affectedPriceRange: { min: price, max: price },
            detectedAt: Date.now(),
            severity: marketHealth.highestSeverity,
            recommendedAction: marketHealth.recommendation,
            type: "health_check",
        };

        return marketAnomaly;
    }

    /**
     * Create trading signal from confirmed signal
     */
    private createTradingSignal(
        confirmedSignal: ConfirmedSignal,
        anomaly: MarketAnomaly | null
    ): Signal {
        const originalSignal = confirmedSignal.originalSignals[0];
        if (!originalSignal) {
            throw new Error('No original signal found');
        }

        const signalType = originalSignal.type;
        const side: "buy" | "sell" =
            signalType === "exhaustion" ? "sell" : "buy";

        const profitTarget = calculateProfitTarget(
            confirmedSignal.finalPrice,
            side
        );
        const stopLoss = calculateStopLoss(confirmedSignal.finalPrice, side);

        const signalData: TradingSignalData = {
            confidence: confirmedSignal.confidence,
            confirmations: Array.from(originalSignal.confirmations),
            meta: originalSignal.metadata,
            anomalyCheck: anomaly
                ? {
                      detected: true,
                      anomaly,
                  }
                : { detected: false },
        };

        const signal: Signal = {
            id: confirmedSignal.id,
            side,
            time: confirmedSignal.confirmedAt,
            price: confirmedSignal.finalPrice,
            type:
                signalType === "absorption"
                    ? "absorption_confirmed"
                    : signalType === "exhaustion"
                      ? "exhaustion_confirmed"
                      : "flow",
            takeProfit: profitTarget.price,
            stopLoss,
            closeReason: "swing_detection",
            signalData,
        };

        return signal;
    }
}

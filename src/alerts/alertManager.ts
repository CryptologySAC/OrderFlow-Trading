// src/alerts/alertManager.ts
import { Signal, SwingSignalData } from "../types/signalTypes.js";
import { AlertMessage } from "../utils/types.js";
import {
    calculateBreakeven,
    calculateProfitTarget,
} from "../utils/calculations.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";

export class AlertManager {
    private lastAlertTime = 0;
    private readonly cooldownMs: number;
    private readonly logger: ILogger;

    constructor(
        private readonly webhookUrl: string | undefined,
        cooldownMs = 300000, // 5 minutes default
        logger: ILogger
    ) {
        this.cooldownMs = cooldownMs;
        this.logger = logger;
    }

    public async sendAlert(signal: Signal): Promise<void> {
        const now = Date.now();

        if (now - this.lastAlertTime < this.cooldownMs) {
            this.logger?.info("Alert skipped due to cooldown", {
                component: "AlertManager",
                operation: "sendAlert",
                cooldownMs: this.cooldownMs,
                timeSinceLastAlert: now - this.lastAlertTime,
            });
            return;
        }

        const alert = this.formatAlert(signal);

        // Log trading alert
        this.logger.info("🚨 TRADING ALERT 🚨", {
            component: "AlertManager",
            operation: "sendAlert",
            alertType: alert.type,
            symbol: alert.symbol,
            price: alert.price,
            side: alert.side,
            confidence: alert.confidence,
            targets: alert.targets,
            reasoning: alert.reasoning,
        });

        // Webhook alert if configured
        if (this.webhookUrl) {
            try {
                await this.sendWebhook(alert);
            } catch (error) {
                this.logger.error("[AlertManager] Webhook failed:", { error });
            }
        }

        this.lastAlertTime = now;
    }

    private formatAlert(signal: Signal): AlertMessage {
        const side: "buy" | "sell" =
            signal.type === "absorption" ||
            signal.type === "absorption_confirmed" ||
            signal.type === "flow"
                ? "buy"
                : "sell";

        const breakeven = calculateBreakeven(signal.price, side);
        const profit1 = calculateProfitTarget(signal.price, side, 0.01); // 1%
        const profit2 = calculateProfitTarget(signal.price, side, 0.02); // 2%

        const reasoning: string[] = [];

        // Type-safe access to signalData
        if (signal.signalData && typeof signal.signalData === "object") {
            const data = signal.signalData as SwingSignalData;

            if (data.accumulation?.isAccumulating) {
                reasoning.push("Accumulation detected");
            }

            if (data.divergence?.type === "bullish") {
                reasoning.push("Bullish divergence");
            }

            if (data.divergence?.type === "bearish") {
                reasoning.push("Bearish divergence");
            }
        }

        return {
            type: "swing_entry",
            symbol: "LTCUSDT",
            price: signal.price,
            side,
            confidence: 0.7, // Calculate based on signal strength
            targets: {
                breakeven,
                profit1: profit1.price,
                profit2: profit2.price,
                stopLoss: signal.stopLoss || signal.price * 0.98,
            },
            reasoning,
            timestamp: new Date().toISOString(),
        };
    }

    private async sendWebhook(alert: AlertMessage): Promise<void> {
        if (!this.webhookUrl) {
            throw new Error("Webhook URL not configured");
        }

        const response = await fetch(this.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(alert),
        });

        if (!response.ok) {
            throw new Error(`Webhook failed: ${response.statusText}`);
        }
    }
}

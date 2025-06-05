/**
 * Comprehensive analysis of how each anomaly type impacts signal confidence
 * and trading decisions for Mean Reversion, Momentum, and Breakout signals.
 */

export interface AnomalySignalImpact {
    meanReversion: {
        impact: "positive" | "negative" | "neutral";
        multiplier: number; // 0.1-2.0 (confidence adjustment)
        reasoning: string;
    };
    momentum: {
        impact: "positive" | "negative" | "neutral";
        multiplier: number;
        reasoning: string;
    };
    breakout: {
        impact: "positive" | "negative" | "neutral";
        multiplier: number;
        reasoning: string;
    };
    timeDecay: number; // How quickly impact fades (minutes)
    priceRangeMultiplier: number; // How much to expand affected price range
}

/**
 * Complete anomaly impact matrix for all signal types
 */
export const ANOMALY_SIGNAL_IMPACT_MATRIX: Record<string, AnomalySignalImpact> =
    {
        // === REGIME SHIFT ANOMALIES ===

        flash_crash: {
            meanReversion: {
                impact: "positive",
                multiplier: 1.8,
                reasoning:
                    "Flash crashes create extreme oversold conditions that typically revert quickly. High probability mean reversion setup.",
            },
            momentum: {
                impact: "negative",
                multiplier: 0.2,
                reasoning:
                    "Flash crashes break momentum trends. Momentum signals are unreliable during crash conditions.",
            },
            breakout: {
                impact: "negative",
                multiplier: 0.1,
                reasoning:
                    "Flash crashes invalidate support/resistance levels. Breakouts during crashes are false signals.",
            },
            timeDecay: 15, // Quick recovery expected
            priceRangeMultiplier: 3.0,
        },

        extreme_volatility: {
            meanReversion: {
                impact: "positive",
                multiplier: 1.4,
                reasoning:
                    "High volatility creates overshoots that tend to revert. More mean reversion opportunities.",
            },
            momentum: {
                impact: "negative",
                multiplier: 0.6,
                reasoning:
                    "Extreme volatility creates whipsaws and false momentum signals. Reduces momentum reliability.",
            },
            breakout: {
                impact: "negative",
                multiplier: 0.5,
                reasoning:
                    "High volatility creates false breakouts and noise. Reduces breakout signal quality.",
            },
            timeDecay: 30,
            priceRangeMultiplier: 2.0,
        },

        // === LIQUIDITY ANOMALIES ===

        liquidity_void: {
            meanReversion: {
                impact: "negative",
                multiplier: 0.3,
                reasoning:
                    "Low liquidity prevents efficient mean reversion. Wide spreads reduce reversion probability.",
            },
            momentum: {
                impact: "negative",
                multiplier: 0.4,
                reasoning:
                    "Liquidity voids create choppy price action. Momentum signals become unreliable.",
            },
            breakout: {
                impact: "negative",
                multiplier: 0.2,
                reasoning:
                    "Low liquidity causes false breakouts due to wide spreads. Very unreliable breakout conditions.",
            },
            timeDecay: 10, // Usually resolves quickly
            priceRangeMultiplier: 2.5,
        },

        api_gap: {
            meanReversion: {
                impact: "neutral",
                multiplier: 0.8,
                reasoning:
                    "Data gaps create uncertainty but don't necessarily affect mean reversion mechanics.",
            },
            momentum: {
                impact: "negative",
                multiplier: 0.5,
                reasoning:
                    "Missing data breaks momentum calculations and trend analysis. Reduces signal reliability.",
            },
            breakout: {
                impact: "negative",
                multiplier: 0.4,
                reasoning:
                    "Data gaps can miss key support/resistance tests. Breakout signals become unreliable.",
            },
            timeDecay: 5, // Temporary technical issue
            priceRangeMultiplier: 1.5,
        },

        // === LARGE PLAYER ANOMALIES ===

        whale_activity: {
            meanReversion: {
                impact: "negative",
                multiplier: 0.6,
                reasoning:
                    "Whale orders can push price further than normal. Mean reversion may take longer or fail.",
            },
            momentum: {
                impact: "positive",
                multiplier: 1.6,
                reasoning:
                    "Whale activity often creates or confirms strong momentum moves. Enhances momentum signal quality.",
            },
            breakout: {
                impact: "positive",
                multiplier: 1.5,
                reasoning:
                    "Whale orders can trigger and validate breakouts. Large size provides breakout conviction.",
            },
            timeDecay: 60, // Whale impact can last longer
            priceRangeMultiplier: 2.0,
        },

        // === FLOW ANOMALIES ===

        momentum_ignition: {
            meanReversion: {
                impact: "negative",
                multiplier: 0.4,
                reasoning:
                    "Momentum ignition signals start of strong trends. Mean reversion signals counter to this are dangerous.",
            },
            momentum: {
                impact: "positive",
                multiplier: 1.8,
                reasoning:
                    "Momentum ignition is the ideal setup for momentum signals. Confirms and enhances momentum trades.",
            },
            breakout: {
                impact: "positive",
                multiplier: 1.7,
                reasoning:
                    "Momentum ignition often triggers breakouts and provides follow-through. Excellent for breakout signals.",
            },
            timeDecay: 45, // Momentum can sustain
            priceRangeMultiplier: 2.5,
        },

        flow_imbalance: {
            meanReversion: {
                impact: "negative",
                multiplier: 0.7,
                reasoning:
                    "Strong flow imbalance suggests continued directional pressure. Reduces mean reversion probability.",
            },
            momentum: {
                impact: "positive",
                multiplier: 1.4,
                reasoning:
                    "Flow imbalance confirms directional momentum. Enhances momentum signal conviction.",
            },
            breakout: {
                impact: "positive",
                multiplier: 1.3,
                reasoning:
                    "Flow imbalance can drive breakouts and provide follow-through. Supports breakout signals.",
            },
            timeDecay: 30,
            priceRangeMultiplier: 1.5,
        },

        orderbook_imbalance: {
            meanReversion: {
                impact: "neutral",
                multiplier: 0.9,
                reasoning:
                    "Orderbook imbalance shows potential direction but doesn't necessarily negate mean reversion.",
            },
            momentum: {
                impact: "positive",
                multiplier: 1.3,
                reasoning:
                    "Orderbook imbalance often precedes momentum moves. Provides early momentum signal confirmation.",
            },
            breakout: {
                impact: "positive",
                multiplier: 1.2,
                reasoning:
                    "Orderbook imbalance can indicate breakout potential. Mild positive impact on breakout signals.",
            },
            timeDecay: 20,
            priceRangeMultiplier: 1.2,
        },

        // === SIZE ANOMALIES ===

        order_size_anomaly: {
            meanReversion: {
                impact: "neutral",
                multiplier: 0.95,
                reasoning:
                    "Order size anomalies indicate unusual activity but don't clearly favor mean reversion.",
            },
            momentum: {
                impact: "neutral",
                multiplier: 1.05,
                reasoning:
                    "Large orders might indicate institutional activity. Slight positive bias for momentum.",
            },
            breakout: {
                impact: "positive",
                multiplier: 1.1,
                reasoning:
                    "Large unusual orders can trigger breakouts. Mild positive impact on breakout signals.",
            },
            timeDecay: 15,
            priceRangeMultiplier: 1.2,
        },
    };

/**
 * Calculate adjusted confidence based on active anomalies and signal type
 */
export function calculateAnomalyAdjustedConfidence(
    baseConfidence: number,
    signalType: "meanReversion" | "momentum" | "breakout",
    activeAnomalies: { type: string; detectedAt: number; severity: string }[],
    currentTime: number = Date.now()
): {
    adjustedConfidence: number;
    impactFactors: Array<{
        anomalyType: string;
        impact: "positive" | "negative" | "neutral";
        multiplier: number;
        decayedMultiplier: number;
        reasoning: string;
    }>;
} {
    let confidence = baseConfidence;
    const impactFactors: Array<{
        anomalyType: string;
        impact: "positive" | "negative" | "neutral";
        multiplier: number;
        decayedMultiplier: number;
        reasoning: string;
    }> = [];

    for (const anomaly of activeAnomalies) {
        const impactConfig = ANOMALY_SIGNAL_IMPACT_MATRIX[anomaly.type];
        if (!impactConfig) continue;

        const signalImpact = impactConfig[signalType];
        const minutesElapsed = (currentTime - anomaly.detectedAt) / 60000;

        // Apply time decay
        const decayFactor = Math.max(
            0.1,
            1 - minutesElapsed / impactConfig.timeDecay
        );
        let decayedMultiplier = 1 + (signalImpact.multiplier - 1) * decayFactor;

        // Apply severity adjustment
        const severityMultiplier =
            anomaly.severity === "critical"
                ? 1.2
                : anomaly.severity === "high"
                  ? 1.0
                  : 0.8;
        decayedMultiplier = 1 + (decayedMultiplier - 1) * severityMultiplier;

        confidence *= decayedMultiplier;

        impactFactors.push({
            anomalyType: anomaly.type,
            impact: signalImpact.impact,
            multiplier: signalImpact.multiplier,
            decayedMultiplier,
            reasoning: signalImpact.reasoning,
        });
    }

    return {
        adjustedConfidence: Math.max(0.1, Math.min(1.0, confidence)),
        impactFactors,
    };
}

/**
 * Get signal-specific anomaly filtering recommendations
 */
export function getAnomalyFilteringRules(): Record<
    string,
    {
        meanReversion: { block: boolean; reason: string };
        momentum: { block: boolean; reason: string };
        breakout: { block: boolean; reason: string };
    }
> {
    return {
        flash_crash: {
            meanReversion: {
                block: false,
                reason: "Flash crashes create excellent mean reversion opportunities",
            },
            momentum: {
                block: true,
                reason: "Momentum is unreliable during flash crash conditions",
            },
            breakout: {
                block: true,
                reason: "Breakouts during flash crashes are false signals",
            },
        },
        liquidity_void: {
            meanReversion: {
                block: true,
                reason: "Wide spreads prevent efficient mean reversion",
            },
            momentum: {
                block: true,
                reason: "Low liquidity creates choppy, unreliable momentum",
            },
            breakout: {
                block: true,
                reason: "Liquidity voids cause false breakouts",
            },
        },
        momentum_ignition: {
            meanReversion: {
                block: true,
                reason: "Strong momentum opposes mean reversion",
            },
            momentum: {
                block: false,
                reason: "Momentum ignition is ideal for momentum signals",
            },
            breakout: {
                block: false,
                reason: "Momentum ignition often triggers valid breakouts",
            },
        },
    };
}

/**
 * Summary of anomaly impacts by signal type
 */
export const ANOMALY_IMPACT_SUMMARY = {
    MEAN_REVERSION_POSITIVE: [
        "flash_crash", // Extreme oversold conditions
        "extreme_volatility", // More reversion opportunities
    ],

    MEAN_REVERSION_NEGATIVE: [
        "liquidity_void", // Wide spreads prevent reversion
        "whale_activity", // Can push price further
        "momentum_ignition", // Strong trend opposing reversion
        "flow_imbalance", // Continued directional pressure
    ],

    MOMENTUM_POSITIVE: [
        "whale_activity", // Large orders create/confirm momentum
        "momentum_ignition", // Ideal momentum setup
        "flow_imbalance", // Confirms directional momentum
        "orderbook_imbalance", // Precedes momentum moves
    ],

    MOMENTUM_NEGATIVE: [
        "flash_crash", // Breaks momentum trends
        "extreme_volatility", // Creates whipsaws
        "liquidity_void", // Choppy price action
    ],

    BREAKOUT_POSITIVE: [
        "whale_activity", // Can trigger valid breakouts
        "momentum_ignition", // Provides breakout follow-through
        "flow_imbalance", // Drives breakouts
        "orderbook_imbalance", // Indicates breakout potential
    ],

    BREAKOUT_NEGATIVE: [
        "flash_crash", // Invalidates support/resistance
        "extreme_volatility", // False breakouts and noise
        "liquidity_void", // False breaks due to wide spreads
    ],
};

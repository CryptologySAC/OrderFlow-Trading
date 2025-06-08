// src/indicators/marketRegimeDetector.ts

import { RollingWindow } from "../utils/rollingWindow.js";

export interface MarketRegime {
    volatility: "low" | "medium" | "high";
    trend: "bullish" | "bearish" | "sideways";
    liquidity: "thin" | "normal" | "thick";
    session: "asian" | "london" | "ny" | "overlap" | "quiet";
}

export interface AdaptiveThresholds {
    depletionLevels: {
        extreme: number;
        high: number;
        moderate: number;
    };
    scores: {
        extreme: number;
        high: number;
        moderate: number;
    };
    passiveRatioLevels: {
        severeDepletion: number;
        moderateDepletion: number;
        someDepletion: number;
    };
    minimumConfidence: number;
    lastUpdated: number;

    absorptionLevels: {
        strong: number; // Strong absorption ratio
        moderate: number; // Moderate absorption ratio
        weak: number; // Weak absorption ratio
    };
    absorptionScores: {
        strong: number; // Score for strong absorption
        moderate: number; // Score for moderate absorption
        weak: number; // Score for weak absorption
    };
    volumeThresholds: {
        highVolume: number; // High volume multiplier
        mediumVolume: number; // Medium volume multiplier
        lowVolume: number; // Low volume multiplier
    };
    consistencyRequirement: number;
}

class MarketRegimeDetector {
    private readonly atrWindow = new RollingWindow<number>(20);
    private readonly volumeWindow = new RollingWindow<number>(50);
    private readonly priceWindow = new RollingWindow<number>(100);
    private readonly spreadWindow = new RollingWindow<number>(30);

    detectCurrentRegime(): MarketRegime {
        const volatility = this.detectVolatilityRegime();
        const trend = this.detectTrendRegime();
        const liquidity = this.detectLiquidityRegime();
        const session = this.detectTradingSession();

        return { volatility, trend, liquidity, session };
    }

    private detectVolatilityRegime(): "low" | "medium" | "high" {
        if (this.atrWindow.count() < 10) return "medium";

        const currentATR =
            this.atrWindow
                .toArray()
                .slice(-5)
                .reduce((a, b) => a + b, 0) / 5;
        const historicalATR = this.atrWindow.average();
        const volatilityRatio = currentATR / historicalATR;

        if (volatilityRatio < 0.7) return "low";
        if (volatilityRatio > 1.5) return "high";
        return "medium";
    }

    private detectTrendRegime(): "bullish" | "bearish" | "sideways" {
        if (this.priceWindow.count() < 20) return "sideways";

        const prices = this.priceWindow.toArray();
        const recentPrices = prices.slice(-10);
        const earlierPrices = prices.slice(-20, -10);

        const recentAvg =
            recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
        const earlierAvg =
            earlierPrices.reduce((a, b) => a + b, 0) / earlierPrices.length;

        const trendStrength = (recentAvg - earlierAvg) / earlierAvg;

        if (trendStrength > 0.01) return "bullish";
        if (trendStrength < -0.01) return "bearish";
        return "sideways";
    }

    private detectLiquidityRegime(): "thin" | "normal" | "thick" {
        if (this.volumeWindow.count() < 10 || this.spreadWindow.count() < 10)
            return "normal";

        const currentVolume =
            this.volumeWindow
                .toArray()
                .slice(-5)
                .reduce((a, b) => a + b, 0) / 5;
        const avgVolume = this.volumeWindow.average();
        const volumeRatio = currentVolume / avgVolume;

        const currentSpread =
            this.spreadWindow
                .toArray()
                .slice(-5)
                .reduce((a, b) => a + b, 0) / 5;
        const avgSpread = this.spreadWindow.average();
        const spreadRatio = currentSpread / avgSpread;

        // High volume + low spread = thick liquidity
        if (volumeRatio > 1.3 && spreadRatio < 0.8) return "thick";
        // Low volume + high spread = thin liquidity
        if (volumeRatio < 0.7 && spreadRatio > 1.2) return "thin";
        return "normal";
    }

    private detectTradingSession():
        | "asian"
        | "london"
        | "ny"
        | "overlap"
        | "quiet" {
        const hour = new Date().getUTCHours();

        // Major session overlaps (highest liquidity)
        if ((hour >= 8 && hour <= 10) || (hour >= 13 && hour <= 15))
            return "overlap";

        // Asian session
        if (hour >= 0 && hour <= 8) return "asian";

        // London session
        if (hour >= 8 && hour <= 16) return "london";

        // NY session
        if (hour >= 13 && hour <= 21) return "ny";

        // Quiet periods
        return "quiet";
    }

    updateMarketData(price: number, volume: number, spread: number): void {
        this.priceWindow.push(price);
        this.volumeWindow.push(volume);
        this.spreadWindow.push(spread);

        // Calculate ATR if we have enough price data
        if (this.priceWindow.count() >= 2) {
            const prices = this.priceWindow.toArray();
            const atr = Math.abs(
                prices[prices.length - 1] - prices[prices.length - 2]
            );
            this.atrWindow.push(atr);
        }
    }
}

export class AdaptiveThresholdCalculator {
    private baseThresholds: AdaptiveThresholds = {
        depletionLevels: { extreme: 20, high: 10, moderate: 5 },
        scores: { extreme: 0.35, high: 0.25, moderate: 0.15 },
        passiveRatioLevels: {
            severeDepletion: 0.2,
            moderateDepletion: 0.4,
            someDepletion: 0.6,
        },
        minimumConfidence: 0.5,
        lastUpdated: Date.now(),

        absorptionLevels: {
            strong: 3.0, // Aggressive vol is 3x passive vol
            moderate: 2.0, // Aggressive vol is 2x passive vol
            weak: 1.5, // Aggressive vol is 1.5x passive vol
        },
        absorptionScores: {
            strong: 0.4, // High confidence score
            moderate: 0.25, // Medium confidence score
            weak: 0.15, // Low confidence score
        },
        volumeThresholds: {
            highVolume: 1.5, // 1.5x average volume = high
            mediumVolume: 1.0, // 1.0x average volume = medium
            lowVolume: 0.7, // 0.7x average volume = low
        },
        consistencyRequirement: 0.6,
    };

    private readonly regimeDetector = new MarketRegimeDetector();
    private readonly performanceTracker = new Map<
        string,
        { signals: number; profitable: number }
    >();

    detectCurrentRegime(): MarketRegime {
        return this.regimeDetector.detectCurrentRegime();
    }

    getPerformanceTracker(): Map<
        string,
        { signals: number; profitable: number }
    > {
        return new Map(this.performanceTracker);
    }

    resetPerformanceTracking(): void {
        this.performanceTracker.clear();
    }

    getBaseThresholds(): AdaptiveThresholds {
        return { ...this.baseThresholds };
    }

    updateBaseThresholds(newBaseThresholds: Partial<AdaptiveThresholds>): void {
        this.baseThresholds = {
            ...this.baseThresholds,
            ...newBaseThresholds,
            lastUpdated: Date.now(),
        };
    }

    calculateAdaptiveThresholds(
        historicalPerformance: Map<string, number>,
        recentSignalCount: number
    ): AdaptiveThresholds {
        const regime = this.regimeDetector.detectCurrentRegime();
        const adaptationFactors = this.calculateAdaptationFactors(
            regime,
            historicalPerformance,
            recentSignalCount
        );

        return {
            depletionLevels: {
                extreme:
                    this.baseThresholds.depletionLevels.extreme *
                    adaptationFactors.depletion,
                high:
                    this.baseThresholds.depletionLevels.high *
                    adaptationFactors.depletion,
                moderate:
                    this.baseThresholds.depletionLevels.moderate *
                    adaptationFactors.depletion,
            },
            scores: {
                extreme:
                    this.baseThresholds.scores.extreme *
                    adaptationFactors.scoring,
                high:
                    this.baseThresholds.scores.high * adaptationFactors.scoring,
                moderate:
                    this.baseThresholds.scores.moderate *
                    adaptationFactors.scoring,
            },
            passiveRatioLevels: {
                severeDepletion:
                    this.baseThresholds.passiveRatioLevels.severeDepletion *
                    adaptationFactors.passive,
                moderateDepletion:
                    this.baseThresholds.passiveRatioLevels.moderateDepletion *
                    adaptationFactors.passive,
                someDepletion:
                    this.baseThresholds.passiveRatioLevels.someDepletion *
                    adaptationFactors.passive,
            },
            minimumConfidence: Math.max(
                0.3,
                this.baseThresholds.minimumConfidence *
                    adaptationFactors.confidence
            ),
            lastUpdated: Date.now(),

            absorptionLevels: {
                strong:
                    this.baseThresholds.absorptionLevels.strong *
                    adaptationFactors.absorption,
                moderate:
                    this.baseThresholds.absorptionLevels.moderate *
                    adaptationFactors.absorption,
                weak:
                    this.baseThresholds.absorptionLevels.weak *
                    adaptationFactors.absorption,
            },
            absorptionScores: {
                strong:
                    this.baseThresholds.absorptionScores.strong *
                    adaptationFactors.scoring,
                moderate:
                    this.baseThresholds.absorptionScores.moderate *
                    adaptationFactors.scoring,
                weak:
                    this.baseThresholds.absorptionScores.weak *
                    adaptationFactors.scoring,
            },
            volumeThresholds: {
                highVolume:
                    this.baseThresholds.volumeThresholds.highVolume *
                    adaptationFactors.volume,
                mediumVolume:
                    this.baseThresholds.volumeThresholds.mediumVolume *
                    adaptationFactors.volume,
                lowVolume:
                    this.baseThresholds.volumeThresholds.lowVolume *
                    adaptationFactors.volume,
            },
            consistencyRequirement: Math.max(
                0.4,
                Math.min(
                    0.8,
                    this.baseThresholds.consistencyRequirement *
                        adaptationFactors.consistency
                )
            ),
        };
    }

    private calculateAdaptationFactors(
        regime: MarketRegime,
        historicalPerformance: Map<string, number>,
        recentSignalCount: number
    ): {
        depletion: number;
        scoring: number;
        passive: number;
        confidence: number;
        absorption: number;
        volume: number;
        consistency: number;
    } {
        let depletionFactor = 1.0;
        let scoringFactor = 1.0;
        let passiveFactor = 1.0;
        let confidenceFactor = 1.0;
        let absorptionFactor = 1.0;
        let volumeFactor = 1.0;
        let consistencyFactor = 1.0;

        // Volatility adjustments
        switch (regime.volatility) {
            case "high":
                depletionFactor *= 0.7; // Lower thresholds in high vol
                scoringFactor *= 1.2; // Higher scores needed
                confidenceFactor *= 1.3; // Higher confidence required
                absorptionFactor *= 0.8; // NEW: Easier absorption in high vol
                consistencyFactor *= 0.9;
                break;
            case "low":
                depletionFactor *= 1.3; // Higher thresholds in low vol
                scoringFactor *= 0.8; // Lower scores acceptable
                confidenceFactor *= 0.9; // Lower confidence acceptable
                absorptionFactor *= 1.2; // NEW: Harder absorption in low vol
                consistencyFactor *= 1.1;
                break;
        }

        // Liquidity adjustments
        switch (regime.liquidity) {
            case "thin":
                depletionFactor *= 0.8; // Easier to deplete thin liquidity
                scoringFactor *= 1.1;
                confidenceFactor *= 1.2;
                absorptionFactor *= 0.7; // NEW: Much easier absorption in thin liquidity
                volumeFactor *= 0.8;
                break;
            case "thick":
                depletionFactor *= 1.2; // Harder to deplete thick liquidity
                scoringFactor *= 0.9;
                confidenceFactor *= 0.95;
                absorptionFactor *= 1.4; // NEW: Much harder absorption in thick liquidity
                volumeFactor *= 1.3; // NEW: Higher volume requirements
                consistencyFactor *= 1.2;
                break;
        }

        // Session adjustments
        switch (regime.session) {
            case "quiet":
                depletionFactor *= 0.9; // Lower activity = easier depletion
                confidenceFactor *= 1.1; // Be more cautious in quiet periods
                absorptionFactor *= 0.9; // NEW: Easier in quiet periods
                volumeFactor *= 0.8;
                break;
            case "overlap":
                depletionFactor *= 1.1; // Higher activity = harder depletion
                confidenceFactor *= 0.95; // More confidence in active periods
                absorptionFactor *= 1.1; // NEW: Harder during overlaps
                volumeFactor *= 1.2;
                break;
        }

        switch (regime.trend) {
            case "bullish":
                absorptionFactor *= 0.9; // Easier to absorb selling pressure
                break;
            case "bearish":
                absorptionFactor *= 0.9; // Easier to absorb buying pressure
                break;
            case "sideways":
                absorptionFactor *= 1.1; // Harder to absorb in ranging markets
                consistencyFactor *= 1.1; // Need more consistent patterns
                break;
        }

        // Performance-based adjustments
        const recentPerformance =
            historicalPerformance.get(
                `${regime.volatility}_${regime.liquidity}`
            ) ?? 0.5;
        if (recentPerformance < 0.4) {
            // Poor recent performance - be more conservative
            scoringFactor *= 1.2;
            confidenceFactor *= 1.2;
        } else if (recentPerformance > 0.7) {
            // Good recent performance - be more aggressive
            scoringFactor *= 0.9;
            confidenceFactor *= 0.95;
        }

        // Signal frequency adjustments
        if (recentSignalCount > 10) {
            // Too many signals - raise thresholds
            scoringFactor *= 1.15;
            confidenceFactor *= 1.1;
        } else if (recentSignalCount < 2) {
            // Too few signals - lower thresholds slightly
            scoringFactor *= 0.95;
        }

        return {
            depletion: Math.max(0.5, Math.min(2.0, depletionFactor)),
            scoring: Math.max(0.7, Math.min(1.5, scoringFactor)),
            passive: Math.max(0.8, Math.min(1.3, passiveFactor)),
            confidence: Math.max(0.8, Math.min(1.4, confidenceFactor)),
            absorption: Math.max(0.6, Math.min(1.6, absorptionFactor)),
            volume: Math.max(0.7, Math.min(1.4, volumeFactor)),
            consistency: Math.max(0.8, Math.min(1.3, consistencyFactor)),
        };
    }

    updateMarketData(price: number, volume: number, spread: number): void {
        this.regimeDetector.updateMarketData(price, volume, spread);
    }

    recordSignalPerformance(regime: string, profitable: boolean): void {
        const stats = this.performanceTracker.get(regime) ?? {
            signals: 0,
            profitable: 0,
        };
        stats.signals++;
        if (profitable) stats.profitable++;
        this.performanceTracker.set(regime, stats);
    }
}

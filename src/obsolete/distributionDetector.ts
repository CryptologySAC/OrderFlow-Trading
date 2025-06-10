import {
    FlowDetectorBase,
    SuperiorZoneFlowData,
    SuperiorFlowConditions,
    SignalCreationParams,
} from "../indicators/base/flowDetectorBase.js";
import { DetectorUtils } from "../indicators/base/detectorUtils.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { DistributionResult } from "../types/signalTypes.js";

/**
 * Superior Distribution Detector V2
 */
export class DistributionDetector extends FlowDetectorBase {
    protected readonly detectorType = "distribution" as const;
    protected readonly flowDirection = "distribution" as const;

    protected getDefaultMinRatio(): number {
        return 1.8; // Higher threshold for distribution
    }

    protected getDefaultThreshold(): number {
        return 0.65; // Higher confidence threshold for distribution
    }

    protected getRequiredTradeSide(): "buy" | "sell" {
        return "sell"; // Distribution requires aggressive selling
    }

    protected getRelevantPassiveSide(event: EnrichedTradeEvent): number {
        return event.zonePassiveBidVolume || 0; // For distribution, sellers hit bids
    }

    protected calculateDirectionalRatio(
        aggressive: number,
        relevantPassive: number
    ): number {
        // For distribution: aggressive sells vs relevant passive bids
        return relevantPassive > 0 ? aggressive / relevantPassive : 0;
    }

    protected calculatePriceEffect(zoneData: SuperiorZoneFlowData): number {
        // For distribution: price should show weakness despite buying interest
        if (zoneData.priceCount < 2) return 0;

        // Calculate price weakness - negative mean change indicates weakness
        const avgPriceChange = zoneData.priceRollingMean;
        const weaknessFromTrend =
            avgPriceChange <= 0 ? Math.abs(avgPriceChange) * 100 : 0;

        // High variance during distribution can also indicate weakness/uncertainty
        const priceVariance = DetectorUtils.safeDivide(
            zoneData.priceRollingVar,
            zoneData.priceCount - 1,
            0
        );
        const instabilityScore = Math.min(1, Math.sqrt(priceVariance) * 10);

        return Math.min(1, weaknessFromTrend * 0.7 + instabilityScore * 0.3);
    }

    protected validateFlowSpecificConditions(
        conditions: SuperiorFlowConditions
    ): boolean {
        // Distribution must show price weakness
        return conditions.priceEffect > 0.3;
    }

    protected getSignalSide(): "buy" | "sell" {
        return "sell"; // Distribution signals are bearish
    }

    protected getSignalType() {
        return this.detectorType;
    }

    protected createFlowSignal(
        params: SignalCreationParams
    ): DistributionResult {
        return {
            duration: params.conditions.duration,
            zone: params.zone,
            sellRatio: params.conditions.ratio,
            strength: params.conditions.strength,
            priceWeakness: params.conditions.priceEffect,
            isDistributing: params.conditions.isRecentlyActive,
            price: params.price,
            side: params.side,
            confidence: params.score,
            metadata: {
                distributionScore: params.score,
                conditions: params.conditions,
                marketRegime: params.marketRegime,
                statisticalSignificance:
                    params.conditions.statisticalSignificance,
                volumeConcentration: params.conditions.volumeConcentration,
                detectorVersion: "2.0-superior",
            },
        };
    }
}

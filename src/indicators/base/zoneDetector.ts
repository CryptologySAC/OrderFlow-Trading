import { Detector } from "./detectorEnrichedTrade.js";
import { EnrichedTradeEvent } from "../../types/marketEvents.js";
import { WorkerLogger } from "../../multithreading/workerLogger";
import { MetricsCollector } from "../../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../../infrastructure/signalLoggerInterface.js";
import { ZoneManager } from "../../trading/zoneManager.js";
import {
    ZoneAnalysisResult,
    ZoneDetectorConfig,
} from "../../types/zoneTypes.js";
import { Config } from "../../orderFlowDashBoard.js";

export abstract class ZoneDetector extends Detector {
    protected readonly config: ZoneDetectorConfig;
    protected readonly zoneManager: ZoneManager;

    constructor(
        id: string,
        config: Partial<ZoneDetectorConfig>,
        detectorType: "accumulation" | "distribution",
        logger: WorkerLogger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);

        let zoneTimeoutMs = config.zoneTimeoutMs ?? 1800000; // 30 minutes (shorter than accumulation)
        let maxZoneWidth = config.maxZoneWidth ?? 0.012; // 1.2% (slightly wider than accumulation)
        let completionThreshold = 0.75; // Lower threshold for distribution
        if (detectorType === "accumulation") {
            zoneTimeoutMs = 3600000; // 1 hour
            maxZoneWidth = 0.01;
            completionThreshold = 0.85;
        }
        this.config = {
            maxActiveZones: config.maxActiveZones ?? 3,
            zoneTimeoutMs,
            minZoneVolume: config.minZoneVolume ?? 150,
            maxZoneWidth,
            minZoneStrength: config.minZoneStrength ?? 0.45,
            completionThreshold,
            strengthChangeThreshold: config.strengthChangeThreshold ?? 0.12,
            minCandidateDuration: config.minCandidateDuration ?? 120000,
            maxPriceDeviation: config.maxPriceDeviation ?? 0.008,
            minTradeCount: config.minTradeCount ?? 8,
            minSellRatio:
                config.minSellRatio ??
                Config.ENHANCED_ZONE_FORMATION.detectorThresholds.distribution
                    .minSellingRatio,
        };

        this.zoneManager = new ZoneManager(
            this.config,
            this.logger,
            this.metricsCollector
        );
    }

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        this.analyze(event);
    }

    public abstract analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult;
}

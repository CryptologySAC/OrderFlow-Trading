import { EnrichedTradeEvent } from "../../types/marketEvents.ts";
import type { ILogger } from "../../infrastructure/loggerInterface.ts";
import type { IMetricsCollector } from "../../infrastructure/metricsCollectorInterface.ts";
import { ISignalLogger } from "../../infrastructure/signalLoggerInterface.ts";
import { ZoneManager } from "../../trading/zoneManager.ts";
import { ZoneAnalysisResult } from "../../types/zoneTypes.ts";
// ZoneDetector now uses universal zone config from Config.UNIVERSAL_ZONE_CONFIG
import { Config } from "../../core/config.ts";
import { Detector } from "./detectorEnrichedTrade.ts";

export abstract class ZoneDetector extends Detector {
    protected readonly config: typeof Config.UNIVERSAL_ZONE_CONFIG;
    protected readonly zoneManager: ZoneManager;

    constructor(
        id: string,
        detectorType: "accumulation" | "distribution",
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);

        // Get universal zone config - shared by all zone detectors
        this.config = Config.UNIVERSAL_ZONE_CONFIG;

        this.zoneManager = new ZoneManager(
            this.config,
            this.logger,
            this.metricsCollector
        );
    }

    public onEnrichedTrade(event: EnrichedTradeEvent): void {
        this.analyze(event);
    }

    public getStatus(): string {
        return "unknown";
    }

    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        // Zone detectors don't use cooldown tracking in the same way as BaseDetector
        // This is a no-op for zone detectors
        void zone;
        void side;
    }

    public abstract analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult;
}

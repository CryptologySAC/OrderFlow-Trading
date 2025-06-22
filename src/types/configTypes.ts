export type AllowedSymbols = "LTCUSDT";
import type { ZoneDetectorConfig } from "./zoneTypes.js";
import type { DeltaCVDConfirmationSettings } from "../indicators/deltaCVDConfirmation.js";
import type { ExhaustionSettings } from "../indicators/exhaustionDetector.js";
import type { AbsorptionSettings } from "../indicators/absorptionDetector.js";
import type { SupportResistanceConfig } from "../indicators/supportResistanceDetector.js";
import type { TradesProcessorOptions } from "../market/processors/tradesProcessor.js";
import type { SignalManagerConfig } from "../trading/signalManager.js";
import type { SignalCoordinatorConfig } from "../services/signalCoordinator.js";
import type { OrderBookProcessorOptions } from "../market/processors/orderBookProcessor.js";
import type { DataStreamConfig } from "../trading/dataStreamManager.js";
import type { AnomalyDetectorOptions } from "../services/anomalyDetector.js";
import type { SpoofingDetectorConfig } from "../services/spoofingDetector.js";
import type { IcebergDetectorConfig } from "../services/icebergDetector.js";
import type { HiddenOrderDetectorConfig } from "../services/hiddenOrderDetector.js";
import type { OrderBookStateOptions } from "../market/orderBookState.js";
import type {
    AccumulationSettings,
    SuperiorFlowSettings,
} from "../indicators/interfaces/detectorInterfaces.js";

export interface MQTTConfig {
    url: string;
    username?: string;
    password?: string;
    statsTopic?: string;
    clientId?: string;
    keepalive?: number;
    connectTimeout?: number;
    reconnectPeriod?: number;
}

export interface MarketDataStorageConfig {
    enabled: boolean;
    dataDirectory: string;
    format: "csv" | "jsonl" | "both";
    maxFileSize: number;
    depthLevels: number;
    rotationHours: number;
    compressionEnabled: boolean;
    monitoringInterval: number;
}

export interface ConfigType {
    nodeEnv: string;
    symbol: AllowedSymbols;
    symbols: {
        LTCUSDT: SymbolConfig;
    };
    httpPort: number;
    wsPort: number;
    mqtt?: MQTTConfig;
    alertWebhookUrl: string;
    alertCooldownMs: number;
    maxStorageTime: number;
    marketDataStorage?: MarketDataStorageConfig;
    zoneDetectors?: Record<string, ZoneDetectorSymbolConfig>;
    // ✅ Enhanced zone formation configuration
    enhancedZoneFormation?: EnhancedZoneFormationConfig;
}

type SymbolConfig = {
    pricePrecision: number;
    quantityPrecision?: number; // Quantity decimal places (XRP: 2, BNB: 3, ADA: 6, DOGE/SOL: 4-6, default: 8)
    windowMs: number;
    bandTicks: number;
    largeTradeThreshold?: number; // Threshold for large trades requiring full depth snapshot
    maxEventListeners?: number; // EventEmitter memory management
    // Dashboard update configuration for performance optimization
    dashboardUpdateInterval?: number; // Dashboard update frequency in ms (default: 200ms = 5 FPS)
    maxDashboardInterval?: number; // Maximum time between dashboard updates (default: 1000ms)
    significantChangeThreshold?: number; // Price change threshold for immediate updates (default: 0.001 = 0.1%)
    dataStream?: DataStreamConfig;
    orderBookState: OrderBookStateOptions;
    tradesProcessor?: TradesProcessorOptions;
    signalManager?: SignalManagerConfig;
    signalCoordinator?: SignalCoordinatorConfig;
    orderBookProcessor?: OrderBookProcessorOptions;
    emitDepthMetrics?: boolean;
    anomalyDetector?: AnomalyDetectorOptions;
    spoofingDetector?: SpoofingDetectorConfig;
    icebergDetector?: Partial<IcebergDetectorConfig>;
    hiddenOrderDetector?: Partial<HiddenOrderDetectorConfig>;
    exhaustion?: ExhaustionSettings;
    absorption?: AbsorptionSettings;
    deltaCvdConfirmation?: DeltaCVDConfirmationSettings;
    accumulationDetector?: AccumulationSettings;
    distributionDetector?: SuperiorFlowSettings;
    supportResistanceDetector?: SupportResistanceConfig;
};

// All type definitions now imported from their respective source files

export type ZoneDetectorSymbolConfig = {
    accumulation?: Partial<ZoneDetectorConfig>;
    distribution?: Partial<ZoneDetectorConfig>;
};

/**
 * Enhanced zone formation configuration constants to replace magic numbers
 */
export interface EnhancedZoneFormationConfig {
    // Iceberg detection thresholds
    icebergDetection: {
        minSize: number; // Minimum trade size to consider for iceberg patterns
        maxSize: number; // Maximum trade size to consider for iceberg patterns
        priceStabilityTolerance: number; // Price stability tolerance (e.g., 0.02 = 2%)
        sizeConsistencyThreshold: number; // Minimum consistency for iceberg detection (e.g., 0.6 = 60%)
        sideDominanceThreshold: number; // Minimum side dominance for iceberg (e.g., 0.7 = 70%)
    };

    // Price efficiency calculation
    priceEfficiency: {
        baseImpactRate: number; // Base price impact rate per 1000 units (e.g., 0.0002 = 0.02%)
        maxVolumeMultiplier: number; // Maximum volume multiplier (e.g., 5)
        minEfficiencyThreshold: number; // Minimum efficiency threshold
    };

    // Institutional detection thresholds
    institutional: {
        minRatio: number; // Minimum institutional ratio (e.g., 0.3 = 30%)
        sizeThreshold: number; // Institutional size threshold (e.g., 50-100)
        detectionWindow: number; // Detection window size (e.g., 15-20)
    };

    // Detector scoring thresholds - CENTRALIZED!
    detectorThresholds: {
        accumulation: {
            minScore: number; // Minimum score for accumulation zones (e.g., 0.75)
            minAbsorptionRatio: number; // Minimum sell absorption ratio (e.g., 0.75)
            maxAggressiveRatio: number; // Maximum aggressive buying ratio (e.g., 0.35)
            minPriceStability: number; // Minimum price stability (e.g., 0.85)
            minInstitutionalScore: number; // Minimum institutional score (e.g., 0.4)
        };
        distribution: {
            minScore: number; // Minimum score for distribution zones (e.g., 0.55)
            minSellingRatio: number; // Minimum aggressive selling ratio (e.g., 0.65)
            maxSupportRatio: number; // Maximum support buying ratio (e.g., 0.35)
            minPriceStability: number; // Minimum price stability (e.g., 0.75)
            minInstitutionalScore: number; // Minimum institutional score (e.g., 0.3)
        };
    };

    // Adaptive thresholds by market regime
    adaptiveThresholds: {
        volatility: {
            high: {
                accumulation: {
                    minAbsorptionRatio: number;
                    maxAggressiveRatio: number;
                };
                distribution: {
                    minSellingRatio: number;
                    maxSupportRatio: number;
                };
            };
            medium: {
                accumulation: {
                    minAbsorptionRatio: number;
                    maxAggressiveRatio: number;
                };
                distribution: {
                    minSellingRatio: number;
                    maxSupportRatio: number;
                };
            };
            low: {
                accumulation: {
                    minAbsorptionRatio: number;
                    maxAggressiveRatio: number;
                };
                distribution: {
                    minSellingRatio: number;
                    maxSupportRatio: number;
                };
            };
        };
    };
}

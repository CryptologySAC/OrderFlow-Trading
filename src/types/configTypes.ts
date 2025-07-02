export type AllowedSymbols = "LTCUSDT";
import type { DeltaCVDEnhancedSettings } from "../indicators/deltaCVDDetectorEnhanced.js";
import type { ExhaustionEnhancedSettings } from "../indicators/exhaustionDetectorEnhanced.js";
import type { AbsorptionEnhancedSettings } from "../indicators/absorptionDetectorEnhanced.js";
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
import type { SuperiorFlowSettings } from "../indicators/interfaces/detectorInterfaces.js";
import type { AccumulationEnhancedSettings } from "../indicators/accumulationZoneDetectorEnhanced.js";
import type { DistributionEnhancedSettings } from "../indicators/distributionDetectorEnhanced.js";

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
    symbols: Record<string, SymbolConfig>;
    httpPort: number;
    wsPort: number;
    mqtt?: MQTTConfig;
    alertWebhookUrl: string;
    alertCooldownMs: number;
    maxStorageTime: number;
    marketDataStorage?: MarketDataStorageConfig;
    zoneDetectors: Record<string, ZoneDetectorSymbolConfig>;
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
    exhaustion: ExhaustionEnhancedSettings;
    absorption: AbsorptionEnhancedSettings;
    deltaCvdConfirmation: DeltaCVDEnhancedSettings;
    accumulationDetector: AccumulationEnhancedSettings;
    distributionDetector?: SuperiorFlowSettings;
    supportResistanceDetector?: SupportResistanceConfig;
};

// All type definitions now imported from their respective source files

export type ZoneDetectorSymbolConfig = {
    accumulation: AccumulationEnhancedSettings;
    distribution: DistributionEnhancedSettings;
};

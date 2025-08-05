export type AllowedSymbols = "LTCUSDT";

export interface MQTTConfig {
    url: string;
    username?: string | undefined;
    password?: string | undefined;
    statsTopic?: string | undefined;
    clientId?: string | undefined;
    keepalive?: number | undefined;
    connectTimeout?: number | undefined;
    reconnectPeriod?: number | undefined;
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

// ConfigType, SymbolConfig, and ZoneDetectorSymbolConfig removed - unused dead code
// Zod schemas in config.ts are now the source of truth for configuration types

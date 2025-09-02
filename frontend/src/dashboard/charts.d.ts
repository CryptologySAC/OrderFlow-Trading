// Type declarations for charts.js

export declare function scheduleTradesChartUpdate(): void;
export declare function scheduleOrderBookUpdate(): void;
export declare function updateYAxisBounds(): void;
export declare function updateTimeAnnotations(
    latestTime: number,
    activeRange: number
): void;
export declare function updateRSITimeAnnotations(
    latestTime: number,
    activeRange: number
): void;
export declare function createTrade(
    x: number,
    y: number,
    quantity: number,
    orderType: string
): unknown;
export declare function buildSignalLabel(signal: unknown): string;
export declare function isValidTrade(trade: unknown): boolean;
export declare function initializeTradesChart(
    ctx: CanvasRenderingContext2D
): unknown;
export declare function initializeRSIChart(
    ctx: CanvasRenderingContext2D
): unknown;
export declare function safeUpdateRSIChart(rsiData: unknown[]): boolean;
export declare function initializeOrderBookChart(
    ctx: CanvasRenderingContext2D
): unknown;
export declare function updateOrderBookBarColors(theme: string): void;
export declare function updateOrderBookDisplay(data: unknown): void;
export declare function addAnomalyChartLabel(anomaly: unknown): void;
export declare function handleSupportResistanceLevel(levelData: unknown): void;
export declare function checkSupportResistanceBreaches(
    tradePrice: number,
    tradeTime: number
): void;
export declare function cleanupOldSupportResistanceLevels(): void;
export declare function handleZoneUpdate(updateData: unknown): void;
export declare function handleZoneSignal(signalData: unknown): void;
export declare function cleanupOldZones(): void;

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
): any;
export declare function buildSignalLabel(signal: any): string;
export declare function isValidTrade(trade: any): boolean;
export declare function initializeTradesChart(
    ctx: CanvasRenderingContext2D
): any;
export declare function initializeRSIChart(ctx: CanvasRenderingContext2D): any;
export declare function safeUpdateRSIChart(rsiData: any[]): boolean;
export declare function initializeOrderBookChart(
    ctx: CanvasRenderingContext2D
): any;
export declare function updateOrderBookBarColors(theme: string): void;
export declare function updateOrderBookDisplay(data: any): void;
export declare function addAnomalyChartLabel(anomaly: any): void;
export declare function handleSupportResistanceLevel(levelData: any): void;
export declare function checkSupportResistanceBreaches(
    tradePrice: number,
    tradeTime: number
): void;
export declare function cleanupOldSupportResistanceLevels(): void;
export declare function handleZoneUpdate(updateData: any): void;
export declare function handleZoneSignal(signalData: any): void;
export declare function cleanupOldZones(): void;

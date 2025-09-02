// Type declarations for websocket.ts

export declare class TradeWebSocket {
    constructor(config: {
        url: string;
        maxTrades?: number;
        maxReconnectAttempts?: number;
        reconnectDelay?: number;
        pingInterval?: number;
        pongWait?: number;
        onMessage?: (message: any) => void;
        onBacklog?: (data: any[]) => void;
        onReconnectFail?: () => void;
        onTimeout?: () => void;
    });
    connect(): void;
    disconnect(): void;
    send(message: any): void;
    isConnected(): boolean;
}

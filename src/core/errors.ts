// src/core/errors.ts

/**
 * Custom error types for the trading system
 */

export class SignalProcessingError extends Error {
    constructor(
        message: string,
        public readonly context: Record<string, unknown>,
        public readonly correlationId?: string
    ) {
        super(message);
        this.name = "SignalProcessingError";
    }
}

export class WebSocketError extends Error {
    constructor(
        message: string,
        public readonly clientId: string,
        public readonly correlationId?: string
    ) {
        super(message);
        this.name = "WebSocketError";
    }
}

export class ConnectionError extends Error {
    constructor(
        message: string,
        public readonly service: string,
        public readonly correlationId?: string
    ) {
        super(message);
        this.name = "ConnectionError";
    }
}

import pino from "pino";

export const logger = pino({
    name: "Binance Large Order Streamer",
    safe: true,
    transport: {
        target: "pino-pretty",
    },
});

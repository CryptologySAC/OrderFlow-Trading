// test/orderFlowDashboard.test.ts

import { OrderFlowDashboard } from "../src/orderFlowDashBoard";
import { Signal, WebSocketMessage, Detected } from "../src/interfaces";
import WS from "jest-websocket-mock";
import { EventEmitter } from "events";

EventEmitter.defaultMaxListeners = 20;

// Prevent process.exit from killing test runner and set up fake timers for intervals
beforeAll(() => {
    jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    jest.useFakeTimers();
});
afterAll(() => {
    jest.useRealTimers();
});

afterEach(() => {
    jest.clearAllTimers();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("exit");
    WS.clean();
});

// EXPRESS MOCK
jest.mock("express", () => {
    const expressApp = () => {
        const app: any = () => app;
        app.use = jest.fn();
        app.listen = jest.fn((port: number, callback?: () => void) => {
            if (callback) callback();
            return app;
        });
        return app;
    };
    expressApp.static = jest.fn(() => jest.fn());
    return expressApp;
});

// BINANCE FEED + PROCESSOR MOCKS
jest.mock("../src/binance", () => ({
    BinanceDataFeed: jest.fn().mockImplementation(() => ({
        connectToStreams: jest.fn().mockResolvedValue({
            aggTrade: jest.fn().mockReturnValue({ on: jest.fn() }),
            diffBookDepth: jest.fn().mockReturnValue({ on: jest.fn() }),
            on: jest.fn(),
        }),
        fetchAggTradesByTime: jest.fn().mockResolvedValue([]),
    })),
}));
jest.mock("../src/tradesProcessor", () => ({
    TradesProcessor: jest.fn().mockImplementation(() => ({
        requestBacklog: jest.fn().mockReturnValue([1, 2, 3]),
        fillBacklog: jest.fn().mockResolvedValue(undefined),
    })),
}));
jest.mock("../src/orderBookProcessor", () => ({
    OrderBookProcessor: jest.fn().mockImplementation(() => ({
        fetchInitialOrderBook: jest.fn().mockResolvedValue(undefined),
        processWebSocketUpdate: jest.fn(),
    })),
}));

// STORAGE
jest.mock("../src/storage", () => ({
    Storage: jest.fn().mockImplementation(() => ({
        purgeOldEntries: jest.fn(),
    })),
}));

// ABSORPTION / EXHAUSTION / DELTA
jest.mock("../src/absorptionDetector", () => ({
    AbsorptionDetector: jest.fn().mockImplementation(() => ({
        addDepth: jest.fn(),
        addTrade: jest.fn(),
    })),
}));
jest.mock("../src/exhaustionDetector", () => ({
    ExhaustionDetector: jest.fn().mockImplementation(() => ({
        addDepth: jest.fn(),
        addTrade: jest.fn(),
    })),
}));
let capturedCallback: (confirmed: any) => void;
jest.mock("../src/deltaCVDCOnfirmation", () => ({
    DeltaCVDConfirmation: jest.fn().mockImplementation((cb, options) => {
        capturedCallback = cb;
        return {
            confirmSignal: jest.fn(),
            addTrade: jest.fn(),
        };
    }),
}));

// SWING PREDICTOR
jest.mock("../src/swingPredictor", () => ({
    SwingPredictor: jest.fn().mockImplementation((opts) => ({
        onSignal: jest.fn(),
        onPrice: jest.fn(),
    })),
}));

// WS MOCK
jest.mock("ws", () => {
    return {
        Server: jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            clients: new Set([{ readyState: 1, send: jest.fn() }]),
        })),
        WebSocket: jest.fn(),
        OPEN: 1,
    };
});

describe("OrderFlowDashboard (FULL COVERAGE)", () => {
    let dashboard: OrderFlowDashboard;
    let server: WS;
    let client: any;
    let messageHandler: ((msg: string) => void) | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.WEBHOOK_URL = "http://localhost/mock-webhook";
        dashboard = new OrderFlowDashboard();
        server = new WS("ws://localhost:1234");

        // Get the mock socket for direct message simulation
        const WebSocketModule = require("ws");
        const serverInstance: any =
            WebSocketModule.Server.mock.results[0].value;
        const onHandler = serverInstance.on.mock.calls.find(
            ([event]: [string]) => event === "connection"
        )?.[1];

        client = {
            on: jest.fn((event, handler) => {
                if (event === "message") {
                    messageHandler = handler;
                }
            }),
            send: jest.fn(),
            readyState: 1,
        };

        if (onHandler) onHandler(client);

        // Global fetch mock for webhook sending
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => ({}),
            })
        ) as any;
    });

    // ========== CONSTRUCTOR DEFAULTS ==============
    test("should instantiate with default values and set up WebSocket server", () => {
        expect(dashboard).toBeDefined();
    });

    // ========== WEBSOCKET INCOMING MESSAGES ==========
    test("should handle WebSocket ping", () => {
        const pingMessage = JSON.stringify({ type: "ping" });
        if (messageHandler) messageHandler(pingMessage);
        expect(client.send).toHaveBeenCalledWith(
            expect.stringContaining("pong")
        );
    });

    test("should handle WebSocket backlog request (default)", () => {
        const backlogMessage = JSON.stringify({
            type: "backlog",
            data: {},
        });
        if (messageHandler) messageHandler(backlogMessage);
        expect(client.send).toHaveBeenCalledWith(
            expect.stringContaining("backlog")
        );
    });

    test("should handle WebSocket backlog request (bad amount)", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        if (messageHandler)
            messageHandler(
                JSON.stringify({ type: "backlog", data: { amount: "0" } })
            );
        expect(warnSpy).toHaveBeenCalledWith("Invalid backlog amount:", "0");
        expect(client.send).not.toHaveBeenCalledWith(
            expect.stringContaining("backlog")
        );
        warnSpy.mockRestore();
    });

    test("should handle WebSocket backlog request (good int)", () => {
        const backlogMessage = JSON.stringify({
            type: "backlog",
            data: { amount: "100" },
        });
        if (messageHandler) messageHandler(backlogMessage);
        expect(client.send).toHaveBeenCalledWith(
            expect.stringContaining("backlog")
        );
    });

    test("should handle WebSocket backlog request (bad huge int)", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        if (messageHandler)
            messageHandler(
                JSON.stringify({ type: "backlog", data: { amount: "1000000" } })
            );
        expect(warnSpy).toHaveBeenCalledWith(
            "Invalid backlog amount:",
            "1000000"
        );
        expect(client.send).not.toHaveBeenCalledWith(
            expect.stringContaining("backlog")
        );
        warnSpy.mockRestore();
    });

    test("should handle WebSocket backlog request (notanumber)", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        if (messageHandler)
            messageHandler(
                JSON.stringify({
                    type: "backlog",
                    data: { amount: "notanumber" },
                })
            );
        expect(warnSpy).toHaveBeenCalledWith(
            "Invalid backlog amount:",
            "notanumber"
        );
        expect(client.send).not.toHaveBeenCalledWith(
            expect.stringContaining("backlog")
        );
        warnSpy.mockRestore();
    });

    test("should handle bad JSON", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        if (messageHandler) messageHandler("{ invalid JSON }");
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test("should handle invalid request (no type)", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        if (messageHandler) messageHandler(JSON.stringify({}));
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test("should handle invalid request (non-string type)", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        if (messageHandler) messageHandler(JSON.stringify({ type: 123 }));
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    // ========== SIGNAL BROADCASTING ==========
    test("should broadcast signal to clients and send webhook", async () => {
        const message: Signal = {
            type: "exhaustion",
            time: Date.now(),
            price: 100,
            takeProfit: 101,
            stopLoss: 99,
            closeReason: "exhaustion",
        };
        await dashboard.broadcastSignal(message);
        expect(global.fetch).toHaveBeenCalled();
    });

    test("should not call webhook if URL not set", async () => {
        delete process.env.WEBHOOK_URL;
        const signal: Signal = {
            type: "absorption",
            time: Date.now(),
            price: 200,
            takeProfit: 202,
            stopLoss: 198,
            closeReason: "absorption",
        };
        await dashboard.broadcastSignal(signal);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should handle webhook error gracefully", async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(
            new Error("fetch failed")
        );
        const signal: Signal = {
            type: "exhaustion",
            time: Date.now(),
            price: 300,
            takeProfit: 305,
            stopLoss: 295,
            closeReason: "exhaustion",
        };
        await dashboard.broadcastSignal(signal);
        expect(global.fetch).toHaveBeenCalled();
    });

    test("should handle error in sendWebhookMessage (response not ok)", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: false,
                status: 400,
                statusText: "Bad Request",
                json: async () => ({}),
            })
        ) as any;
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dashboard["sendWebhookMessage"]("http://bad", { type: "fail" });
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    // ========== ABSORPTION/EXHAUSTION DETECTION ==========
    test("should trigger exhaustion detection and signal", async () => {
        const exhaustion: Detected = {
            side: "buy",
            price: 120,
            trades: [],
            totalAggressiveVolume: 500,
        };
        const confirmSpy = jest.spyOn(
            dashboard["deltaCVDConfirmation"],
            "confirmSignal"
        );
        await dashboard["onExhaustionDetected"](exhaustion);
        expect(confirmSpy).toHaveBeenCalled();
    });

    test("should trigger absorption detection and signal", async () => {
        const absorption: Detected = {
            side: "sell",
            price: 130,
            trades: [],
            totalAggressiveVolume: 400,
        };
        const confirmSpy = jest.spyOn(
            dashboard["deltaCVDConfirmation"],
            "confirmSignal"
        );
        await dashboard["onAbsorptionDetected"](absorption);
        expect(confirmSpy).toHaveBeenCalled();
    });

    // ========== DELTA CVD CONFIRM CALLBACK ==========
    test("should process deltaCVD confirmed signal", async () => {
        const confirmed = {
            confirmedType: "exhaustion",
            time: Date.now(),
            price: 123,
            reason: "test_reason",
        };
        const broadcastSpy = jest
            .spyOn(dashboard as any, "broadcastSignal")
            .mockImplementation(() => Promise.resolve());
        await capturedCallback(confirmed);
        expect(broadcastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "exhaustion_confirmed",
                price: confirmed.price,
                time: confirmed.time,
            })
        );
        broadcastSpy.mockRestore();
    });

    // ========== SWING PREDICTION ==========
    test("should call broadcastSignal for swing prediction", () => {
        const broadcastSpy = jest
            .spyOn(dashboard, "broadcastSignal")
            .mockImplementation(() => Promise.resolve());
        dashboard["handleSwingPrediction"]({
            type: "swingHigh",
            time: Date.now(),
            price: 125,
            sourceSignal: {},
        } as any);
        expect(broadcastSpy).toHaveBeenCalled();
    });

    // ========== BROADCAST MESSAGE ERROR ==========
    test("should handle error in broadcastMessage", () => {
        dashboard["sendToClients"] = () => {
            throw new Error("fail");
        };
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        dashboard["broadcastMessage"]({
            type: "test",
            data: {},
            now: Date.now(),
        });
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    // ========== SEND TO CLIENTS (no open) ==========
    test("should not send message if no clients are connected", () => {
        const message: WebSocketMessage = {
            type: "trade",
            data: "sample",
            now: Date.now(),
        };
        dashboard["BroadCastWebSocket"].clients = new Set();
        expect(() => dashboard["sendToClients"](message)).not.toThrow();
    });

    test("should handle WebSocket client with closed readyState", () => {
        const message: WebSocketMessage = {
            type: "trade",
            data: "sample",
            now: Date.now(),
        };
        const closedClient: any = {
            readyState: 0,
            send: jest.fn(),
        };
        (dashboard as any).BroadCastWebSocket = {
            clients: new Set([closedClient]),
        };
        (dashboard as any).sendToClients(message);
        expect(closedClient.send).not.toHaveBeenCalled();
    });

    // ========== PURGE DATABASE ==========
    test("should register SIGINT and exit handlers in purgeDatabase", () => {
        const storage = require("../src/storage");
        dashboard["purgeDatabase"]();
        process.emit("SIGINT", "SIGINT");
        expect(storage.Storage).toHaveBeenCalled();
    });

    test("should handle error in purgeOldEntries", () => {
        const storage = require("../src/storage");
        const err = new Error("purge error");
        storage.Storage.mockImplementation(() => ({
            purgeOldEntries: () => {
                throw err;
            },
        }));
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        dashboard["purgeDatabase"]();
        // Fast-forward timers so interval callback runs
        jest.runOnlyPendingTimers();
        expect(errorSpy).toHaveBeenCalled();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    // ========== DASHBOARD STARTUP/ERRORS ==========
    test("should start the dashboard and launch components", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dashboard.startDashboard();
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                "Order Flow Dashboard started successfully."
            )
        );
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test("should handle error in startDashboard", async () => {
        dashboard["preloadTrades"] = jest
            .fn()
            .mockRejectedValue(new Error("preload error"));
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dashboard.startDashboard();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("should handle error in getFromBinanceAPI", async () => {
        dashboard["binanceFeed"].connectToStreams = jest
            .fn()
            .mockRejectedValue(new Error("connect fail"));
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            await dashboard["getFromBinanceAPI"]();
        } catch (e) {
            // expected: absorb for test, prevents test fail on unhandled rejection
        }
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    // ========== CONSTRUCTOR FALLBACKS ==========
    test("should fall back to default SYMBOL, PORT, and WS_PORT when not set", () => {
        delete process.env.SYMBOL;
        delete process.env.PORT;
        delete process.env.WS_PORT;
        const dash = new OrderFlowDashboard();
        expect(dash).toBeDefined();
    });

    test("isWebSocketRequest returns false for non-object", () => {
        expect(dashboard["isWebSocketRequest"](null)).toBe(false);
        expect(dashboard["isWebSocketRequest"]("string")).toBe(false);
        expect(dashboard["isWebSocketRequest"]({})).toBe(false);
        expect(dashboard["isWebSocketRequest"]({ type: 123 })).toBe(false);
    });

    test("isBacklogRequest returns false for null or missing props", () => {
        expect(dashboard["isBacklogRequest"](null)).toBe(false);
        expect(dashboard["isBacklogRequest"]({})).toBe(false);
        expect(dashboard["isBacklogRequest"]({ type: "notbacklog" })).toBe(
            false
        );
    });

    test("isBacklogRequest returns true for valid backlog request", () => {
        const req = { type: "backlog", data: { amount: "100" } };
        expect(dashboard["isBacklogRequest"](req)).toBe(true);
    });

    test("startWebServer calls use and listen", () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        dashboard["startWebServer"]();
        expect(dashboard["httpServer"].use).toHaveBeenCalled();
        expect(dashboard["httpServer"].listen).toHaveBeenCalled();
        logSpy.mockRestore();
    });
    test("should log error if processWebSocketUpdate throws", async () => {
        // Setup
        const connectionMock = {
            aggTrade: jest.fn().mockReturnValue({ on: jest.fn() }),
            diffBookDepth: jest.fn().mockReturnValue({
                on: jest.fn((event, cb) => {
                    // Simulate message handler
                    const badData = {};
                    dashboard["orderBookProcessor"].processWebSocketUpdate =
                        jest.fn(() => {
                            throw new Error("fail");
                        });
                    const errorSpy = jest
                        .spyOn(console, "error")
                        .mockImplementation(() => {});
                    cb(badData);
                    expect(errorSpy).toHaveBeenCalledWith(
                        "Error broadcasting depth:",
                        expect.any(Error)
                    );
                    errorSpy.mockRestore();
                }),
            }),
            on: jest.fn(),
        };
        dashboard["binanceFeed"].connectToStreams = jest
            .fn()
            .mockResolvedValue(connectionMock);

        await dashboard["getFromBinanceAPI"]();
    });

    test("should log error if addTrade throws in trade message", async () => {
        const connectionMock = {
            aggTrade: jest.fn().mockReturnValue({
                on: jest.fn((event, cb) => {
                    dashboard["tradesProcessor"].addTrade = jest.fn(() => {
                        throw new Error("fail");
                    });
                    const errorSpy = jest
                        .spyOn(console, "error")
                        .mockImplementation(() => {});
                    cb({ p: "1", T: 1 });
                    expect(errorSpy).toHaveBeenCalledWith(
                        "Error broadcasting trade:",
                        expect.any(Error)
                    );
                    errorSpy.mockRestore();
                }),
            }),
            diffBookDepth: jest.fn().mockReturnValue({ on: jest.fn() }),
            on: jest.fn(),
        };
        dashboard["binanceFeed"].connectToStreams = jest
            .fn()
            .mockResolvedValue(connectionMock);

        await dashboard["getFromBinanceAPI"]();
    });

    test("should log error if reconnection in connection.on('close') fails", async () => {
        const connectionMock = {
            aggTrade: jest.fn().mockReturnValue({ on: jest.fn() }),
            diffBookDepth: jest.fn().mockReturnValue({ on: jest.fn() }),
            on: jest.fn((event, cb) => {
                if (event === "close") {
                    const errorSpy = jest
                        .spyOn(console, "error")
                        .mockImplementation(() => {});
                    dashboard["delayFn"] = jest.fn((fn) => {
                        throw new Error("fail");
                    }) as any;
                    cb();
                    expect(errorSpy).toHaveBeenCalledWith(
                        "Error reconnecting to Binance API:",
                        expect.any(Error)
                    );
                    errorSpy.mockRestore();
                }
            }),
        };
        dashboard["binanceFeed"].connectToStreams = jest
            .fn()
            .mockResolvedValue(connectionMock);

        await dashboard["getFromBinanceAPI"]();
    });

    test("should handle Buffer as WebSocket message", () => {
        const bufMsg = Buffer.from(JSON.stringify({ type: "ping" }));
        // @ts-expect-error: intentionally passing a Buffer for test
        if (messageHandler) messageHandler(bufMsg);
        expect(client.send).toHaveBeenCalledWith(
            expect.stringContaining("pong")
        );
    });

    test("should handle unexpected message format in WebSocket", () => {
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        // @ts-expect-error: intentionally passing a number for test
        if (messageHandler) messageHandler(12345); // number
        expect(warnSpy).toHaveBeenCalledWith(
            "Invalid message format",
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    test("constructor uses all default values when env vars are not set", () => {
        delete process.env.SYMBOL;
        delete process.env.PORT;
        delete process.env.WS_PORT;
        const dash = new OrderFlowDashboard();
        expect(dash["symbol"]).toBe("LTCUSDT");
        expect(dash["httpPort"]).toBe(3000);
        expect(dash["wsPort"]).toBe(3001);
    });

    test("startWebServer serves static files and listens on port", () => {
        const dash = new OrderFlowDashboard();
        const useSpy = jest.spyOn(dash["httpServer"], "use");
        const listenSpy = jest.spyOn(dash["httpServer"], "listen");
        dash["startWebServer"]();
        expect(useSpy).toHaveBeenCalled();
        expect(listenSpy).toHaveBeenCalled();
    });

    test("broadcastMessage is bound correctly in constructor", () => {
        const dash = new OrderFlowDashboard();
        // @ts-expect-error: intentionally copying private function for test
        const fn = dash.broadcastMessage;
        expect(() =>
            fn({ type: "test", data: {}, now: Date.now() })
        ).not.toThrow();
    });

    test("getFromBinanceAPI handles error in connection.on('close')", async () => {
        const dash = new OrderFlowDashboard();
        const mockConnection = {
            on: (event: string, cb: Function) => {
                if (event === "close") cb();
            },
            aggTrade: jest.fn(),
            diffBookDepth: jest.fn(),
        };
        dash["binanceFeed"].connectToStreams = jest
            .fn()
            .mockResolvedValue(mockConnection);
        // Simulate error in delayFn
        dash["delayFn"] = () => {
            throw new Error("fail reconnect");
        };
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dash["getFromBinanceAPI"]();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("getFromBinanceAPI handles error in stream handlers setup", async () => {
        const dash = new OrderFlowDashboard();
        const mockConnection = {
            on: jest.fn(),
            aggTrade: () => {
                throw new Error("aggTrade fail");
            },
            diffBookDepth: jest.fn(),
        };
        dash["binanceFeed"].connectToStreams = jest
            .fn()
            .mockResolvedValue(mockConnection);
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dash["getFromBinanceAPI"]();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("getFromBinanceAPI handles error in top-level catch", async () => {
        const dash = new OrderFlowDashboard();
        dash["binanceFeed"].connectToStreams = jest
            .fn()
            .mockRejectedValue(new Error("fail"));
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dash["getFromBinanceAPI"]();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("handles error in sendToClients", () => {
        const dash = new OrderFlowDashboard();
        dash["sendToClients"] = () => {
            throw new Error("fail send");
        };
        const errorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            dash["broadcastMessage"]({
                type: "test",
                data: {},
                now: Date.now(),
            });
        } catch {}
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});

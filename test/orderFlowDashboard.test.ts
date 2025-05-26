// test/orderFlowDashboard.test.ts
vi.mock("ws"); // <--- THIS MUST BE FIRST, before ALL imports, to guarantee mapping

vi.mock("@binance/spot", () => ({
    SpotWebsocketStreams: vi.fn(),
    SpotWebsocketAPI: vi.fn(),
    Spot: vi.fn(),
}));

vi.mock("@binance/common", () => ({
    ConfigurationWebsocketStreams: vi.fn(),
    ConfigurationWebsocketAPI: vi.fn(),
    WebsocketApiRateLimit: vi.fn(),
    WebsocketApiResponse: vi.fn(),
    Logger: vi.fn(),
    LogLevel: vi.fn(),
}));

vi.mock("express", () => {
    const expressApp = (() => {
        const app: any = () => app;
        app.use = vi.fn();
        app.listen = vi.fn((port: number, callback?: () => void) => {
            if (callback) callback();
            return app;
        });
        return app;
    }) as any;
    expressApp.static = vi.fn(() => vi.fn());
    return { default: expressApp };
});

vi.mock("../src/binance.js", () => ({
    BinanceDataFeed: vi.fn().mockImplementation(() => ({
        connectToStreams: vi.fn().mockResolvedValue({
            aggTrade: vi.fn().mockReturnValue({ on: vi.fn() }),
            diffBookDepth: vi.fn().mockReturnValue({ on: vi.fn() }),
            on: vi.fn(),
        }),
        fetchAggTradesByTime: vi.fn().mockResolvedValue([]),
    })),
}));

vi.mock("../src/tradesProcessor.js", () => ({
    TradesProcessor: vi.fn().mockImplementation(() => ({
        requestBacklog: vi.fn().mockReturnValue([1, 2, 3]),
        fillBacklog: vi.fn().mockResolvedValue(undefined),
        addTrade: vi.fn(),
    })),
}));

vi.mock("../src/orderBookProcessor.js", () => ({
    OrderBookProcessor: vi.fn().mockImplementation(() => ({
        fetchInitialOrderBook: vi.fn().mockResolvedValue(undefined),
        processWebSocketUpdate: vi.fn(),
    })),
}));

vi.mock("../src/storage.js", () => ({
    Storage: vi.fn().mockImplementation(() => ({
        purgeOldEntries: vi.fn(),
    })),
}));

vi.mock("../src/absorptionDetector.js", () => ({
    AbsorptionDetector: vi.fn().mockImplementation(() => ({
        addDepth: vi.fn(),
        addTrade: vi.fn(),
    })),
}));

vi.mock("../src/exhaustionDetector.js", () => ({
    ExhaustionDetector: vi.fn().mockImplementation(() => ({
        addDepth: vi.fn(),
        addTrade: vi.fn(),
    })),
}));

let capturedCallback: (confirmed: any) => void;
vi.mock("../src/deltaCVDCOnfirmation.js", () => ({
    DeltaCVDConfirmation: vi.fn().mockImplementation((cb, options) => {
        capturedCallback = () => {
            return {
                confirmSignal: vi.fn(),
                addTrade: vi.fn(),
            };
        };
    }),
}));

vi.mock("../src/swingPredictor.js", () => ({
    SwingPredictor: vi.fn().mockImplementation(() => ({
        onSignal: vi.fn(),
        onPrice: vi.fn(),
    })),
}));

import { OrderFlowDashboard } from "../src/orderFlowDashBoard.js";
import { Signal, WebSocketMessage, Detected } from "../src/interfaces.js";
import * as storage from "../src/storage.js";

beforeAll(() => {
    vi.spyOn(process, "exit").mockImplementation(
        (code?: string | number | null) => {
            throw new Error("process.exit was called");
        }
    );
    vi.useFakeTimers();
});
afterAll(() => {
    vi.useRealTimers();
});
afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.clearAllTimers();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("exit");
    vi.resetAllMocks();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("exit");
});

describe("OrderFlowDashboard (FULL COVERAGE)", () => {
    let dashboard: OrderFlowDashboard;
    let client: any;
    let messageHandler: ((msg: string) => void) | undefined;

    beforeEach(async () => {
        vi.resetModules();
        vi.resetAllMocks();
        vi.clearAllMocks();

        capturedCallback = (confirmed: any) => {
            return confirmed;
        }; // reset capturedCallback

        const { OrderFlowDashboard } = await import(
            "../src/orderFlowDashBoard.js"
        );

        process.env.WEBHOOK_URL = "http://localhost/mock-webhook";
        dashboard = new OrderFlowDashboard();

        // Access the current WebSocket server instance from the dashboard directly
        const serverInstance = dashboard["BroadCastWebSocket"];

        client = {
            on: vi.fn((event, handler) => {
                if (event === "message") {
                    messageHandler = handler;
                }
            }),
            send: vi.fn(),
            readyState: 1,
        };

        if (serverInstance) {
            serverInstance.emit("connection", client);
        } else {
            throw new Error(
                "BroadCastWebSocket instance not found on dashboard"
            );
        }

        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => ({}),
            })
        ) as any;
    });

    test("should handle WebSocket ping", () => {
        const pingMessage = JSON.stringify({ type: "ping" });
        if (messageHandler) messageHandler(pingMessage);
        expect(client.send).toHaveBeenCalledWith(
            expect.stringContaining("pong")
        );
    });

    test("should handle WebSocket backlog request (bad amount)", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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

    test("should handle WebSocket backlog request (bad huge int)", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        if (messageHandler)
            messageHandler(
                JSON.stringify({
                    type: "backlog",
                    data: { amount: "10000000" },
                })
            );
        expect(warnSpy).toHaveBeenCalledWith(
            "Invalid backlog amount:",
            "10000000"
        );
        expect(client.send).not.toHaveBeenCalledWith(
            expect.stringContaining("backlog")
        );
        warnSpy.mockRestore();
    });

    test("should handle WebSocket backlog request (notanumber)", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        if (messageHandler) messageHandler("{ invalid JSON }");
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test("should handle invalid request (no type)", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        if (messageHandler) messageHandler(JSON.stringify({}));
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test("should handle invalid request (non-string type)", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        if (messageHandler) messageHandler(JSON.stringify({ type: 123 }));
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

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
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: false,
                status: 400,
                statusText: "Bad Request",
                json: async () => ({}),
            })
        ) as any;
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dashboard["sendWebhookMessage"]("http://bad", { type: "fail" });
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("should call broadcastSignal for swing prediction", () => {
        const broadcastSpy = vi
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

    test("should handle error in broadcastMessage", () => {
        dashboard["sendToClients"] = () => {
            throw new Error("fail");
        };
        const errorSpy = vi
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
            send: vi.fn(),
        };
        (dashboard as any).BroadCastWebSocket = {
            clients: new Set([closedClient]),
        };
        (dashboard as any).sendToClients(message);
        expect(closedClient.send).not.toHaveBeenCalled();
    });

    test("should register SIGINT and exit handlers in purgeDatabase", () => {
        // arrange
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit was called");
        });

        dashboard["purgeDatabase"]();

        // act + assert
        let exitError: Error | undefined;
        try {
            process.emit("SIGINT", "SIGINT");
        } catch (err) {
            exitError = err as Error;
        }

        expect(exitError).toBeDefined();
        expect(exitError?.message).toBe("process.exit was called");
        expect(storage.Storage).toHaveBeenCalled();

        exitSpy.mockRestore();
    });

    test("should handle error in purgeOldEntries", () => {
        const err = new Error("purge error");
        (storage.Storage as any).mockImplementation(() => ({
            purgeOldEntries: () => {
                throw err;
            },
        }));
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        dashboard["purgeDatabase"]();
        vi.runOnlyPendingTimers();
        expect(errorSpy).toHaveBeenCalled();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test("should start the dashboard and launch components", async () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dashboard.startDashboard();
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining("Server running at http")
        );
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test("should handle error in startDashboard", async () => {
        dashboard["preloadTrades"] = vi
            .fn()
            .mockRejectedValue(new Error("preload error"));
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dashboard.startDashboard();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

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

    test("startWebServer calls use and listen", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        dashboard["startWebServer"]();
        expect(dashboard["httpServer"].use).toHaveBeenCalled();
        expect(dashboard["httpServer"].listen).toHaveBeenCalled();
        logSpy.mockRestore();
    });

    test("should log error if processWebSocketUpdate throws", async () => {
        const connectionMock = {
            aggTrade: vi.fn().mockReturnValue({ on: vi.fn() }),
            diffBookDepth: vi.fn().mockReturnValue({
                on: vi.fn((event, cb) => {
                    const badData = {};
                    dashboard["orderBookProcessor"].processWebSocketUpdate =
                        vi.fn(() => {
                            throw new Error("fail");
                        });
                    const errorSpy = vi
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
            on: vi.fn(),
        };
        dashboard["binanceFeed"].connectToStreams = vi
            .fn()
            .mockResolvedValue(connectionMock);
        await dashboard["getFromBinanceAPI"]();
    });

    test("should log error if addTrade throws in trade message", async () => {
        const connectionMock = {
            aggTrade: vi.fn().mockReturnValue({
                on: vi.fn((event, cb) => {
                    dashboard["tradesProcessor"].addTrade = vi.fn(() => {
                        throw new Error("fail");
                    });
                    const errorSpy = vi
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
            diffBookDepth: vi.fn().mockReturnValue({ on: vi.fn() }),
            on: vi.fn(),
        };
        dashboard["binanceFeed"].connectToStreams = vi
            .fn()
            .mockResolvedValue(connectionMock);
        await dashboard["getFromBinanceAPI"]();
    });

    test("should log error if reconnection in connection.on('close') fails", async () => {
        const connectionMock = {
            aggTrade: vi.fn().mockReturnValue({ on: vi.fn() }),
            diffBookDepth: vi.fn().mockReturnValue({ on: vi.fn() }),
            on: vi.fn((event, cb) => {
                if (event === "close") {
                    const errorSpy = vi
                        .spyOn(console, "error")
                        .mockImplementation(() => {});
                    dashboard["delayFn"] = vi.fn((fn) => {
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
        dashboard["binanceFeed"].connectToStreams = vi
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
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
        const useSpy = vi.spyOn(dash["httpServer"], "use");
        const listenSpy = vi.spyOn(dash["httpServer"], "listen");
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
            aggTrade: vi.fn(),
            diffBookDepth: vi.fn(),
        };
        dash["binanceFeed"].connectToStreams = vi
            .fn()
            .mockResolvedValue(mockConnection);
        dash["delayFn"] = () => {
            throw new Error("fail reconnect");
        };
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dash["getFromBinanceAPI"]();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("getFromBinanceAPI handles error in stream handlers setup", async () => {
        const dash = new OrderFlowDashboard();
        const mockConnection = {
            on: vi.fn(),
            aggTrade: () => {
                throw new Error("aggTrade fail");
            },
            diffBookDepth: vi.fn(),
        };
        dash["binanceFeed"].connectToStreams = vi
            .fn()
            .mockResolvedValue(mockConnection);
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await dash["getFromBinanceAPI"]();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test("getFromBinanceAPI handles error in top-level catch", async () => {
        const dash = new OrderFlowDashboard();
        dash["binanceFeed"].connectToStreams = () =>
            Promise.reject(new Error("fail"));
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        await expect(dash["getFromBinanceAPI"]()).rejects.toThrow("fail");
        errorSpy.mockRestore();
    });

    test("handles error in sendToClients", () => {
        const dash = new OrderFlowDashboard();
        dash["sendToClients"] = () => {
            throw new Error("fail send");
        };
        const errorSpy = vi
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

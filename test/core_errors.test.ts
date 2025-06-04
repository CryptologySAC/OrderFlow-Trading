import { describe, it, expect } from "vitest";
import {
    SignalProcessingError,
    WebSocketError,
    ConnectionError,
} from "../src/core/errors";

describe("core/errors", () => {
    it("creates SignalProcessingError", () => {
        const err = new SignalProcessingError("msg", { a: 1 }, "id");
        expect(err.name).toBe("SignalProcessingError");
        expect(err.message).toBe("msg");
        expect(err.context).toEqual({ a: 1 });
        expect(err.correlationId).toBe("id");
    });

    it("creates WebSocketError", () => {
        const err = new WebSocketError("boom", "c1", "corr");
        expect(err.name).toBe("WebSocketError");
        expect(err.clientId).toBe("c1");
        expect(err.correlationId).toBe("corr");
    });

    it("creates ConnectionError", () => {
        const err = new ConnectionError("oops", "svc", "cid");
        expect(err.name).toBe("ConnectionError");
        expect(err.service).toBe("svc");
        expect(err.correlationId).toBe("cid");
    });
});

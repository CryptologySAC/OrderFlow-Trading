import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("openai");

import { WorkerLogger } from "../src/multithreading/workerLogger";

let openaiCreate: any;

describe("services/llmSignalAnalyzer", () => {
    const env = process.env;
    beforeEach(async () => {
        vi.resetModules();
        process.env = {
            ...env,
            LLM_API_KEY: "test_api_key_1234567890",
            LLM_MODEL: "model",
        };
        ({ create: openaiCreate } = await import("openai"));
        (openaiCreate as any).mockClear();
    });
    afterEach(() => {
        process.env = env;
    });

    it("sends signal to openai", async () => {
        (openaiCreate as any).mockResolvedValue({
            choices: [{ message: { content: "ok" } }],
        });
        const logger = new WorkerLogger();
        const { analyzeSignal } = await import(
            "../src/services/llmSignalAnalyzer"
        );
        const result = await analyzeSignal({ id: "1" } as any, logger);
        expect(openaiCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: "model" })
        );
        expect(result).toBe("ok");
        expect(logger.info).toHaveBeenCalled();
    });

    it("logs errors", async () => {
        (openaiCreate as any).mockRejectedValue(new Error("fail"));
        const logger = new WorkerLogger();
        const { analyzeSignal } = await import(
            "../src/services/llmSignalAnalyzer"
        );
        await expect(analyzeSignal({ id: "1" } as any, logger)).rejects.toThrow(
            "fail"
        );
        expect(logger.error).toHaveBeenCalled();
    });

    it("validates API key format and rejects invalid keys", async () => {
        // Test with invalid API key (too short)
        process.env.LLM_API_KEY = "short";
        const logger = new WorkerLogger();
        const { analyzeSignal } = await import(
            "../src/services/llmSignalAnalyzer"
        );
        await expect(analyzeSignal({ id: "1" } as any, logger)).rejects.toThrow(
            "LLM_API_KEY not configured or invalid"
        );
        expect(logger.error).toHaveBeenCalledWith(
            "LLM credential validation failed",
            expect.objectContaining({
                component: "LLMSignalAnalyzer",
                error: "API key missing or invalid format",
            })
        );
    });
});

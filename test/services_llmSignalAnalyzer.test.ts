import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Logger } from "../src/infrastructure/logger";

let openaiCreate: any;

vi.mock("openai");
vi.mock("../src/infrastructure/logger");

describe("services/llmSignalAnalyzer", () => {
    const env = process.env;
    beforeEach(async () => {
        vi.resetModules();
        process.env = { ...env, LLM_API_KEY: "k", LLM_MODEL: "model" };
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
        const logger = new Logger();
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
        const logger = new Logger();
        const { analyzeSignal } = await import(
            "../src/services/llmSignalAnalyzer"
        );
        await expect(analyzeSignal({ id: "1" } as any, logger)).rejects.toThrow(
            "fail"
        );
        expect(logger.error).toHaveBeenCalled();
    });
});

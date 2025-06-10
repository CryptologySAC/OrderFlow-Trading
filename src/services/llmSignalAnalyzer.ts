import OpenAI from "openai";
import { Config } from "../core/config.js";
import { WorkerLogger } from "../multithreading/workerLogger";
import type { ProcessedSignal } from "../types/signalTypes.js";

/**
 * Send a processed trading signal to an LLM for additional analysis.
 */
export async function analyzeSignal(
    signal: ProcessedSignal,
    logger: WorkerLogger
): Promise<string> {
    if (!Config.LLM_API_KEY) {
        const err = new Error("LLM_API_KEY not configured");
        logger.error("LLM API key missing", { error: err.message });
        throw err;
    }

    const client = new OpenAI({ apiKey: Config.LLM_API_KEY });

    try {
        const resp = await client.chat.completions.create({
            model: Config.LLM_MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a trading assistant. Provide a short analysis for the signal JSON provided.",
                },
                { role: "user", content: JSON.stringify(signal) },
            ],
        });
        const message = resp.choices?.[0]?.message?.content ?? "";
        logger.info("LLM analysis completed", {
            component: "LLMSignalAnalyzer",
            signalId: signal.id,
        });
        return message;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("LLM analysis failed", {
            component: "LLMSignalAnalyzer",
            signalId: signal.id,
            error: err.message,
        });
        throw err;
    }
}

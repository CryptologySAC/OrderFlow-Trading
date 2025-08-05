import OpenAI from "openai";
import { z } from "zod";
import { Config } from "../core/config.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { ProcessedSignal } from "../types/signalTypes.js";

/**
 * Secure API key validation schema
 * SECURITY-CRITICAL: Validates credential format without exposure
 */
const ApiKeySchema = z
    .string()
    .min(10)
    .regex(/^[a-zA-Z0-9\-_.]+$/, "Invalid API key format");

/**
 * Send a processed trading signal to an LLM for additional analysis.
 * SECURITY: Implements secure credential validation with Zod
 */
export async function analyzeSignal(
    signal: ProcessedSignal,
    logger: ILogger
): Promise<string> {
    const keyValidation = ApiKeySchema.safeParse(Config.LLM_API_KEY);

    if (!keyValidation.success) {
        // SECURITY: Log error without exposing credential details
        logger.error("LLM credential validation failed", {
            component: "LLMSignalAnalyzer",
            error: "API key missing or invalid format",
        });
        throw new Error("LLM_API_KEY not configured or invalid");
    }

    const client = new OpenAI({ apiKey: keyValidation.data });

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

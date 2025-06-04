import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SignalLogger } from "../src/services/signalLogger";

import { Logger } from "../src/infrastructure/logger";
vi.mock("../src/infrastructure/logger");

describe("services/SignalLogger", () => {
    let file: string;
    beforeEach(() => {
        file = path.join(process.cwd(), `test_log_${Date.now()}.csv`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    afterEach(() => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    it("writes header and row", () => {
        const logger = new Logger();
        const sl = new SignalLogger(file, logger);
        sl.logEvent({ timestamp: "t", type: "a", signalPrice: 1, side: "buy" });
        const contents = fs.readFileSync(file, "utf8");
        expect(contents).toContain("timestamp,type");
    });

    it("logs processed signals and errors", () => {
        const logger = new Logger();
        const sl = new SignalLogger(file, logger);
        sl.logProcessedSignal(
            {
                id: "1",
                originalCandidate: {
                    id: "c1",
                    type: "generic",
                    side: "buy",
                    confidence: 1,
                    timestamp: Date.now(),
                    data: {} as any,
                },
                type: "generic",
                confidence: 1,
                timestamp: new Date(),
                detectorId: "det",
                processingMetadata: {
                    processedAt: new Date(),
                    processingVersion: "1",
                },
                data: {} as any,
            },
            { run: true }
        );
        expect(logger.info).toHaveBeenCalled();

        sl.logProcessingError(
            {
                id: "c1",
                type: "generic",
                side: "buy",
                confidence: 1,
                timestamp: Date.now(),
                data: {} as any,
            },
            new Error("fail"),
            { run: true }
        );
        expect(logger.error).toHaveBeenCalled();
    });
});

import * as fs from "fs";
import * as path from "path";

export interface SignalEvent {
    timestamp: string;
    type: string; // "absorption" | "exhaustion" | ...
    symbol: string;
    signalPrice: number;
    side: "buy" | "sell";
    aggressiveVolume: number;
    passiveVolume: number | null;
    zone: number;
    refilled: boolean;
    confirmed: boolean;
    confirmationTime?: string;
    moveSizeTicks?: number;
    moveTimeMs?: number;
    entryRecommended?: boolean;
    entryPrice?: number;
    invalidationTime?: string;
    invalidationReason?: string;
    outcome?: string;
}

export interface ISignalLogger {
    logEvent(event: SignalEvent): void;
}

export class SignalLogger implements ISignalLogger {
    private file: string;
    private headerWritten = false;

    constructor(filename: string) {
        this.file = path.resolve(filename);
        if (!fs.existsSync(this.file)) {
            this.headerWritten = false;
        } else {
            this.headerWritten = true;
        }
    }

    // Implement the interface method (same as logEvent)
    logEvent(event: SignalEvent) {
        const header = Object.keys(event).join(",") + "\n";
        const row =
            Object.values(event)
                .map((v) => (v === undefined ? "" : `"${v}"`))
                .join(",") + "\n";

        if (!this.headerWritten) {
            fs.appendFileSync(this.file, header);
            this.headerWritten = true;
        }
        fs.appendFileSync(this.file, row);
    }
}

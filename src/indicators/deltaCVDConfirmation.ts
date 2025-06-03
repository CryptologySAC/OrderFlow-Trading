/* --------------------------------------------------------------------------
   DeltaCVDConfirmation – multi-window CVD-slope detector
   --------------------------------------------------------------------------
   Emits a "cvd_confirmation" SignalCandidate when the volume-weighted
   cumulative-volume-delta (CVD) shows statistically significant acceleration
   in one direction across short-, mid- and long-term windows.

   Windows (seconds):  60 ‖ 300 ‖ 900   ← tuned for 15-min swing context

   Trigger rule:
       1. Signs of all three slopes must match (all ≥+minZ or all ≤-minZ)
       2. Short-window (60 s) abs(zScore) ≥ minZ (default 3.0)
       3. Volume & trade-count floors satisfied

   Dynamic thresholds:
       * zScore computed against rolling μ/σ of the slope distribution
         (online Welford algo per window)
       * Floors (trades/volume) scale with symbol ADV if provided

   -------------------------------------------------------------------------- */

import { BaseDetector } from "./base/baseDetector.js";
import type {
    DeltaCVDConfirmationResult,
    SignalType,
} from "../types/signalTypes.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ISignalLogger } from "../services/signalLogger.js";
import type {
    DetectorCallback,
    BaseDetectorSettings,
} from "./interfaces/detectorInterfaces.js";
import { EnrichedTradeEvent } from "../types/marketEvents.js";

/* ------------------------------------------------------------------ */
/*  Config & helper types                                             */
/* ------------------------------------------------------------------ */
export interface DeltaCVDConfirmationSettings extends BaseDetectorSettings {
    windowsSec?: [60, 300, 900] | number[]; // analysed windows
    minZ?: number; // min |zScore| on shortest window
    minTradesPerSec?: number; // floor scaled by window
    minVolPerSec?: number; // floor scaled by window
}

interface WindowState {
    trades: EnrichedTradeEvent[];
    rollingMean: number; // μ of slope
    rollingVar: number; // σ² of slope
    count: number; // samples for μ/σ
}

const MIN_SAMPLES_FOR_STATS = 30;

/* ------------------------------------------------------------------ */
/*  Detector implementation                                           */
/* ------------------------------------------------------------------ */
export class DeltaCVDConfirmation extends BaseDetector {
    /* ---- immutable config --------------------------------------- */
    protected readonly detectorType = "cvd_confirmation" as const;
    private windows: number[] = [60, 300, 900];
    private readonly minZ: number;
    private readonly minTPS: number; // min trades / sec
    private readonly minVPS: number; // min volume / sec

    /* ---- mutable state ------------------------------------------ */
    private readonly states = new Map<number, WindowState>(); // keyed by windowSec
    private lastSignalTs = 0;

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: DeltaCVDConfirmationSettings = {},
        logger: Logger,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, callback, settings, logger, metricsCollector, signalLogger);
        this.windows = settings.windowsSec
            ? [...settings.windowsSec]
            : [60, 300, 900];
        this.minZ = settings.minZ ?? 3;
        this.minTPS = settings.minTradesPerSec ?? 0.5; // per sec
        this.minVPS = settings.minVolPerSec ?? 1; // units / sec

        for (const w of this.windows) {
            this.states.set(w, {
                trades: [],
                rollingMean: 0,
                rollingVar: 0,
                count: 0,
            });
        }

        /* metrics */
        this.metricsCollector.createCounter(
            "cvd_confirmations_total",
            "CVD confirmation signals"
        );
    }

    protected getSignalType(): SignalType {
        return this.detectorType;
    }

    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        /* push trade into each window state -------------------------- */
        for (const w of this.windows) {
            const s = this.states.get(w)!;
            s.trades.push(event);

            /* drop old trades */
            const cutoff = event.timestamp - w * 1_000;
            while (s.trades.length && s.trades[0].timestamp < cutoff)
                s.trades.shift();
        }

        this.tryEmitSignal(event.timestamp);
    }

    /* ------------------------------------------------------------------ */
    /*  BaseDetector API stubs                                            */
    /* ------------------------------------------------------------------ */
    public getId(): string {
        return "deltaCVDConfirmation";
    }
    public start(): void {}
    public stop(): void {}
    public enable(): void {}
    public disable(): void {}
    public getStatus(): string {
        return "running";
    }

    /* ------------------------------------------------------------------ */
    /*  Core detection logic                                              */
    /* ------------------------------------------------------------------ */
    private tryEmitSignal(now: number): void {
        /* compute slope & zScore for each window --------------------- */
        const slopes: Record<number, number> = {};
        const zScores: Record<number, number> = {};

        for (const w of this.windows) {
            const state = this.states.get(w)!;
            if (state.trades.length < MIN_SAMPLES_FOR_STATS) return; // insufficient

            /* min trades / volume floors ----------------------------- */
            const windowDur =
                (state.trades[state.trades.length - 1].timestamp -
                    state.trades[0].timestamp) /
                1_000;
            const actualWindowSec = Math.min(windowDur, w);
            const tps = state.trades.length / actualWindowSec;
            if (tps < this.minTPS) return;

            const vps =
                state.trades.reduce((s, tr) => s + tr.quantity, 0) /
                Math.max(windowDur, 1);
            if (vps < this.minVPS) return;

            /* compute CVD series, then slope ------------------------- */
            let cvd = 0;
            const series: number[] = [];
            for (const tr of state.trades) {
                const delta = tr.buyerIsMaker ? -tr.quantity : tr.quantity;
                cvd += delta;
                series.push(cvd);
            }

            const n = series.length;
            const sumX = (n * (n - 1)) / 2;
            const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
            const sumY = series.reduce((s, v) => s + v, 0);
            const sumXY = series.reduce((s, v, i) => s + v * i, 0);
            const denom = n * sumX2 - sumX * sumX;
            if (denom === 0) return;

            const slopeQty = (n * sumXY - sumX * sumY) / denom; // qty / idx
            const slope = slopeQty / w; // qty / sec

            /* online update of μ / σ -------------------------------- */
            const delta = slope - state.rollingMean;
            state.count += 1;
            state.rollingMean += delta / state.count;
            state.rollingVar += delta * (slope - state.rollingMean);
            const variance =
                state.count > 1 ? state.rollingVar / (state.count - 1) : 0;
            const std = Math.sqrt(variance) || 1e-9;

            slopes[w] = slope;
            zScores[w] = (slope - state.rollingMean) / std;
        }

        /* require sign agreement & minZ ------------------------------ */
        const signs = this.windows.map((w) => Math.sign(zScores[w]));
        if (!signs.every((s) => s === signs[0] && s !== 0)) return;

        if (Math.abs(zScores[this.windows[0]]) < this.minZ) return;

        /* throttle:  avoid more than 1 signal per 60 s --------------- */
        if (now - this.lastSignalTs < 60_000) return;
        this.lastSignalTs = now;

        /* build candidate ------------------------------------------- */
        const side = signs[0] > 0 ? "buy" : "sell";
        const lastTrade = this.states.get(this.windows[0])!.trades.slice(-1)[0];

        const candidate: DeltaCVDConfirmationResult = {
            price: lastTrade.price,
            side,
            slopes,
            zScores,
            tradesInWindow: this.states.get(this.windows[0])!.trades.length,
            rateOfChange: slopes[this.windows[0]],
            confidence: 0.5, //TODo
            windowVolume: 0, // TODO this.states.trades.reduce((sum, t) => sum + t.quantity, 0),
        };

        this.handleDetection(candidate);
        this.metricsCollector.incrementCounter("cvd_confirmations_total", 1);

        this.logger.debug("[DEBUG DeltaCVD]", { candidate });
    }
}

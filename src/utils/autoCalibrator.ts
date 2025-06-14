/**
 * Simple auto-calibrator for min volume thresholds.
 */
export class AutoCalibrator {
    private lastCalibrated = Date.now();
    private signalHistory: number[] = [];

    recordSignal(): void {
        this.signalHistory.push(Date.now());
    }

    shouldCalibrate(): boolean {
        const now = Date.now();
        return now - this.lastCalibrated >= 15 * 60 * 1000; // 15 minutes
    }

    calibrate(currentMinVolume: number): number {
        if (!this.shouldCalibrate()) return currentMinVolume;
        this.lastCalibrated = Date.now();
        const now = Date.now();
        this.signalHistory = this.signalHistory.filter(
            (t) => now - t < 30 * 60 * 1000
        );
        const recentSignals = this.signalHistory.length;
        if (recentSignals > 10) {
            const newVolume = Math.round(currentMinVolume * 1.2);
            // POLICY OVERRIDE: Using console.log for legacy AutoCalibrator output
            // REASON: AutoCalibrator is deprecated utility without logger dependency injection
            // This maintains backward compatibility while system transitions to new architecture
            console.log(
                "[AutoCalibrator] Too many signals, raising minAggVolume to",
                newVolume
            );
            return newVolume;
        } else if (recentSignals < 2) {
            const newVolume = Math.max(1, Math.round(currentMinVolume * 0.85));
            // POLICY OVERRIDE: Using console.log for legacy AutoCalibrator output
            // REASON: AutoCalibrator is deprecated utility without logger dependency injection
            // This maintains backward compatibility while system transitions to new architecture
            console.log(
                "[AutoCalibrator] Too few signals, lowering minAggVolume to",
                newVolume
            );
            return newVolume;
        }
        return currentMinVolume;
    }
}

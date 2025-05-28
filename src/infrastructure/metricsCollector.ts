export interface MetricsCollector {
    updateMetric(
        name: string,
        value: number
    ): (name: string, value: number) => void;
    incrementMetric(name: string): (name: string) => void;
}

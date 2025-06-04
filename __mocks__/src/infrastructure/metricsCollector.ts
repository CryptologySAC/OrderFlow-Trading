export class MetricsCollector {
    updateMetric = vi.fn<(name: string, value: number) => void>();
    incrementMetric = vi.fn<(name: string, inc?: number) => void>();
}
export default { MetricsCollector };
export const __esModule = true;

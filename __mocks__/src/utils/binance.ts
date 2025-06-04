export class BinanceDataFeed {
    connectToStreams = vi.fn(async () => ({}));
    tradesAggregate = vi.fn(async () => []);
    fetchAggTradesByTime = vi.fn(async () => []);
    getDepthSnapshot = vi.fn(async () => ({ bids: [], asks: [] }));
    disconnect = vi.fn(async () => {});
}
export default { BinanceDataFeed };
export const __esModule = true;

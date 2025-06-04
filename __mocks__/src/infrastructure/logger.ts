export class Logger {
    info = vi.fn<(msg: string, ctx?: any) => void>();
    warn = vi.fn<(msg: string, ctx?: any) => void>();
    error = vi.fn<(msg: string, ctx?: any) => void>();
    debug = vi.fn<(msg: string, ctx?: any) => void>();
}
export default { Logger };
export const __esModule = true;

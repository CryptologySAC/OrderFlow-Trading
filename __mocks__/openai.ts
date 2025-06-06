/// <reference types="vitest" />
export const create = vi.fn();

export default class OpenAI {
    chat = { completions: { create } };
    constructor(public options?: any) {}
}
export const __esModule = true;

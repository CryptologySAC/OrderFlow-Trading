// workers/storageWorker.ts  – production-ready, ESLint-clean
import { parentPort } from "worker_threads";
import { getDB } from "../../infrastructure/db.js";
import { Storage } from "../storage.js";
import { WorkerProxyLogger } from "../shared/workerProxylogger.js";

const logger = new WorkerProxyLogger("communication");

/* ────────── Instantiate original Storage (sync, WAL) ────────── */
const db = getDB();
db.pragma("journal_mode = WAL");
const storage = new Storage(db, logger);

/* ────────── Utility: function keys of Storage ────────── */
type FunctionKeys<T> = {
    [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T] &
    string;

type AllowedMethod = FunctionKeys<Storage>;

/* ────────── IPC message contracts ────────── */
type CallArgs<M extends AllowedMethod> = Parameters<Storage[M]>;
type CallRes<M extends AllowedMethod> = Awaited<ReturnType<Storage[M]>>;

interface CallMsg<M extends AllowedMethod = AllowedMethod> {
    type: "call";
    method: M;
    args: CallArgs<M>;
    requestId: string;
}
interface ShutdownMsg {
    type: "shutdown";
}
type InMsg = CallMsg | ShutdownMsg;

interface ReplySuccess<M extends AllowedMethod = AllowedMethod> {
    type: "reply";
    requestId: string;
    ok: true;
    result: CallRes<M>;
}
interface ReplyError {
    type: "reply";
    requestId: string;
    ok: false;
    error: string;
}
type Reply = ReplySuccess | ReplyError;

/* ────────── Strictly-typed invoker — always Promise, safe “this” ────────── */
function invoke<M extends AllowedMethod>(
    method: M,
    args: CallArgs<M>
): Promise<CallRes<M>> {
    // 1) Grab the property value with its exact type
    const candidate = storage[method];

    // 2) Verify at run-time it is indeed callable (paranoia guard)
    if (typeof candidate !== "function") {
        return Promise.reject(
            new Error(`Storage method ${String(method)} is not a function`)
        );
    }

    // 3) Call via .apply so prototype methods get a valid `this`
    const result = (candidate as (...p: CallArgs<M>) => CallRes<M>).apply(
        storage,
        args
    );

    // 4) Normalise to Promise
    return Promise.resolve(result);
}

/* ────────── Worker message loop (sync callback) ────────── */
parentPort!.on("message", (msg: InMsg): void => {
    if (msg.type === "shutdown") {
        try {
            db.close();
        } finally {
            process.exit(0);
        }
        return;
    }

    // Wrap async work inside an IIFE to keep the outer callback sync
    void (async () => {
        const { method, args, requestId } = msg;
        try {
            const result = await invoke(method, args);
            const reply: ReplySuccess = {
                type: "reply",
                requestId,
                ok: true,
                result,
            };
            parentPort!.postMessage(reply as Reply);
        } catch (err) {
            const reply: ReplyError = {
                type: "reply",
                requestId,
                ok: false,
                error: (err as Error).message,
            };
            parentPort!.postMessage(reply);
        }
    })();
});

import type BetterSqlite3 from "better-sqlite3";

// Shared API types
export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
}

export interface ColumnDefinition {
    name: string;
    column: string | null;
    table: string | null;
    database: string | null;
    type: string | null;
}

// Generic Statement interface with precise typing
export interface Statement<
    BindParams extends unknown[] | Record<string, unknown> = unknown[],
    Result = unknown,
> {
    // Core properties
    readonly source: string;
    readonly reader: boolean;
    readonly readonly: boolean;
    readonly busy: boolean;

    // Execution methods with overloads for both array and object parameters
    run(
        ...params: BindParams extends unknown[] ? BindParams : never
    ): RunResult;
    run(
        params: BindParams extends Record<string, unknown> ? BindParams : never
    ): RunResult;

    get(
        ...params: BindParams extends unknown[] ? BindParams : never
    ): Result | undefined;
    get(
        params: BindParams extends Record<string, unknown> ? BindParams : never
    ): Result | undefined;

    all(...params: BindParams extends unknown[] ? BindParams : never): Result[];
    all(
        params: BindParams extends Record<string, unknown> ? BindParams : never
    ): Result[];

    iterate(
        ...params: BindParams extends unknown[] ? BindParams : never
    ): IterableIterator<Result>;
    iterate(
        params: BindParams extends Record<string, unknown> ? BindParams : never
    ): IterableIterator<Result>;

    // Binding methods
    bind(...params: BindParams extends unknown[] ? BindParams : never): this;
    bind(
        params: BindParams extends Record<string, unknown> ? BindParams : never
    ): this;

    // Configuration methods
    pluck(toggleState?: boolean): this;
    expand(toggleState?: boolean): this;
    raw(toggleState?: boolean): this;
    columns(): ColumnDefinition[];
    safeIntegers(toggleState?: boolean): this;
}

// Transaction type with multiple execution modes
export interface Transaction<F extends (...args: unknown[]) => unknown> {
    (...params: Parameters<F>): ReturnType<F>;
    default(...params: Parameters<F>): ReturnType<F>;
    deferred(...params: Parameters<F>): ReturnType<F>;
    immediate(...params: Parameters<F>): ReturnType<F>;
    exclusive(...params: Parameters<F>): ReturnType<F>;
}

export interface PragmaOptions {
    simple?: boolean;
}

export interface SQLiteCompatAPI {
    // Core database properties
    readonly memory: boolean;
    readonly readonly: boolean;
    readonly name: string;
    readonly open: boolean;
    readonly inTransaction: boolean;

    // Statement preparation with precise typing
    prepare<
        BindParams extends unknown[] | Record<string, unknown> = unknown[],
        Result = unknown,
    >(
        sql: string
    ): Statement<BindParams, Result>;

    // Transaction with precise function typing
    transaction<F extends (...args: unknown[]) => unknown>(
        fn: F
    ): Transaction<F>;

    // Database operations
    exec(sql: string): void;
    pragma(source: string, options?: PragmaOptions): unknown;
    function(name: string, fn: (...args: unknown[]) => unknown): void;
    close(): void;

    // Additional utility methods
    defaultSafeIntegers?(toggleState?: boolean): this;
    unsafeMode?(unsafe?: boolean): this;
}

// Unified internal database type for both Bun and Better-sqlite3
type UnifiedDatabase = {
    // Core properties (available in both)
    readonly memory?: boolean;
    readonly readonly?: boolean;
    readonly name?: string;
    readonly open?: boolean;
    readonly inTransaction?: boolean;

    // Methods available in both
    prepare<
        BindParams extends unknown[] | Record<string, unknown> = unknown[],
        Result = unknown,
    >(
        sql: string
    ): Statement<BindParams, Result>;

    exec(sql: string): void;

    transaction<F extends (...args: unknown[]) => unknown>(
        fn: F
    ): Transaction<F>;

    close(): void;

    // Methods that may not be available in all environments
    pragma?(source: string, options?: PragmaOptions): unknown;
    function?(name: string, fn: (...args: unknown[]) => unknown): void;
    defaultSafeIntegers?(toggleState?: boolean): UnifiedDatabase;
    unsafeMode?(unsafe?: boolean): UnifiedDatabase;

    // Bun-specific helper
    all?<T = unknown>(sql: string): T[];
};

export default class SQLiteCompat implements SQLiteCompatAPI {
    private db!: UnifiedDatabase;
    private isBun: boolean;

    // Expose database properties
    get memory(): boolean {
        return this.db.memory ?? false;
    }

    get readonly(): boolean {
        return this.db.readonly ?? false;
    }

    get name(): string {
        return this.db.name ?? "";
    }

    get open(): boolean {
        return this.db.open ?? true;
    }

    get inTransaction(): boolean {
        return this.db.inTransaction ?? false;
    }

    private constructor() {
        this.isBun =
            typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
    }

    static async create(
        filename: string,
        options?: BetterSqlite3.Options
    ): Promise<SQLiteCompat> {
        const instance = new SQLiteCompat();

        if (instance.isBun) {
            // Bun
            // @ts-expect-error - Bun's built-in module not recognized by TypeScript
            const { Database } = (await import("bun:sqlite")) as {
                Database: new (file: string) => UnifiedDatabase;
            };
            instance.db = new Database(filename);
        } else {
            // Node
            const Database = (await import("better-sqlite3"))
                .default as unknown as {
                new (
                    file: string,
                    options?: BetterSqlite3.Options
                ): UnifiedDatabase;
            };
            instance.db = new Database(filename, options);
        }

        return instance;
    }

    prepare<
        BindParams extends unknown[] | Record<string, unknown> = unknown[],
        Result = unknown,
    >(sql: string): Statement<BindParams, Result> {
        return this.db.prepare<BindParams, Result>(sql);
    }

    exec(sql: string): void {
        this.db.exec(sql);
    }

    pragma(source: string, options?: PragmaOptions): unknown {
        if (this.isBun) {
            // Bun doesn't have a native pragma method, simulate it
            if (source.includes("=")) {
                this.db.exec(`PRAGMA ${source}`);
                return undefined;
            }
            const result = this.db.all?.(`PRAGMA ${source}`);
            return options?.simple &&
                Array.isArray(result) &&
                result.length === 1
                ? result[0]
                : result;
        }
        return this.db.pragma?.(source, options);
    }

    transaction<F extends (...args: unknown[]) => unknown>(
        fn: F
    ): Transaction<F> {
        return this.db.transaction(fn);
    }

    function(name: string, fn: (...args: unknown[]) => unknown): void {
        if (this.isBun) {
            console.warn(
                `[SQLiteCompat] db.function() not supported in Bun — skipped "${name}"`
            );
            return;
        }
        this.db.function?.(name, fn);
    }

    defaultSafeIntegers(toggleState?: boolean): this {
        if (this.db.defaultSafeIntegers) {
            this.db.defaultSafeIntegers(toggleState);
        }
        return this;
    }

    unsafeMode(unsafe?: boolean): this {
        if (this.db.unsafeMode) {
            this.db.unsafeMode(unsafe);
        }
        return this;
    }

    close(): void {
        this.db.close();
    }
}

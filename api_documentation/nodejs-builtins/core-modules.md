# Node.js Built-in Modules Documentation

Documentation for Node.js core modules used in the OrderFlow Trading system.

## 📚 Modules Used

### `crypto` - Cryptographic functionality

### `events` - Event emitter

### `fs` - File system operations

### `path` - File path utilities

### `child_process` - Child process management

### `node:path` - Modern path utilities

### `node:url` - URL utilities

---

## 🔐 crypto

Provides cryptographic functionality including UUID generation.

### Usage in OrderFlow Trading

```typescript
import { randomUUID } from "crypto";

// Generate unique identifiers for signals, trades, clients
const signalId = randomUUID(); // e.g., '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const clientId = randomUUID();
const correlationId = randomUUID();

// Usage examples from codebase
export class SignalCoordinator {
    private generateSignalId(): string {
        return randomUUID();
    }

    private processSignal(detector: string, data: any): void {
        const signal = {
            id: randomUUID(),
            detector,
            timestamp: Date.now(),
            data,
        };
        // Process signal...
    }
}
```

### Key Methods

```typescript
// UUID generation
randomUUID(): string;  // RFC 4122 v4 UUID

// Other crypto functions (not used in current codebase)
createHash(algorithm: string): Hash;
createHmac(algorithm: string, key: string | Buffer): Hmac;
randomBytes(size: number): Buffer;
```

### Best Practices

- Use `randomUUID()` for unique identifiers
- UUIDs are cryptographically secure and collision-resistant
- Suitable for distributed systems and database primary keys

---

## 📡 events

Event-driven programming with EventEmitter.

### Usage in OrderFlow Trading

```typescript
import { EventEmitter } from "events";

// Base class for many components
export class AbsorptionDetector extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50); // Increase for high-frequency events
    }

    private emitSignal(signal: SignalCandidate): void {
        this.emit("signal", signal);
    }

    private emitError(error: Error): void {
        this.emit("error", error);
    }
}

// Usage in other components
export class SignalCoordinator extends EventEmitter {
    private setupDetector(detector: AbsorptionDetector): void {
        detector.on("signal", (signal) => {
            this.processSignal(signal);
        });

        detector.on("error", (error) => {
            this.logger.error("Detector error", error);
        });
    }
}
```

### Key Methods

```typescript
class EventEmitter {
    // Emit events
    emit(eventName: string | symbol, ...args: any[]): boolean;

    // Listen for events
    on(eventName: string | symbol, listener: (...args: any[]) => void): this;
    once(eventName: string | symbol, listener: (...args: any[]) => void): this;

    // Remove listeners
    removeListener(
        eventName: string | symbol,
        listener: (...args: any[]) => void
    ): this;
    removeAllListeners(eventName?: string | symbol): this;

    // Listener management
    listeners(eventName: string | symbol): Function[];
    listenerCount(eventName: string | symbol): number;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
}
```

### Trading System Patterns

```typescript
// Component lifecycle events
export class OrderFlowComponent extends EventEmitter {
    public start(): void {
        this.emit("starting");
        // Initialize component
        this.emit("started");
    }

    public stop(): void {
        this.emit("stopping");
        // Cleanup component
        this.emit("stopped");
    }
}

// Market data flow events
export class MarketDataStream extends EventEmitter {
    private handleTradeData(trade: TradeData): void {
        this.emit("trade", trade);
        this.emit("data", { type: "trade", data: trade });
    }

    private handleDepthData(depth: DepthData): void {
        this.emit("depth", depth);
        this.emit("data", { type: "depth", data: depth });
    }
}
```

### Best Practices

- Extend EventEmitter for components that produce events
- Use descriptive event names ('signal', 'error', 'connection_lost')
- Always handle 'error' events to prevent crashes
- Set appropriate maxListeners for high-frequency events
- Remove listeners to prevent memory leaks

---

## 📁 fs

File system operations for data persistence and configuration.

### Usage in OrderFlow Trading

```typescript
import fs from "fs";

// Database and file operations
export class DatabaseManager {
    private ensureDirectoryExists(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    private backupDatabase(sourcePath: string, backupPath: string): void {
        fs.copyFileSync(sourcePath, backupPath);
    }
}

// Configuration loading
export class ConfigManager {
    private loadConfigFile(filePath: string): any {
        try {
            const configData = fs.readFileSync(filePath, "utf8");
            return JSON.parse(configData);
        } catch (error) {
            throw new Error(`Failed to load config: ${error.message}`);
        }
    }
}
```

### Key Methods

```typescript
// Synchronous operations
fs.readFileSync(path: string, options?: { encoding?: string }): string | Buffer;
fs.writeFileSync(path: string, data: string | Buffer, options?: WriteOptions): void;
fs.existsSync(path: string): boolean;
fs.mkdirSync(path: string, options?: { recursive?: boolean }): void;
fs.copyFileSync(src: string, dest: string): void;
fs.unlinkSync(path: string): void;

// Asynchronous operations (preferred for non-blocking)
fs.readFile(path: string, callback: (err: Error | null, data: Buffer) => void): void;
fs.writeFile(path: string, data: string | Buffer, callback: (err: Error | null) => void): void;
fs.mkdir(path: string, options: { recursive?: boolean }, callback: (err: Error | null) => void): void;
```

### Trading System Usage

```typescript
// Log file management
export class FileLogger {
    private logFilePath = "./logs/trading.log";

    public writeLog(message: string): void {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${message}\n`;

        fs.appendFileSync(this.logFilePath, logEntry);
    }
}

// Data export functionality
export class DataExporter {
    public exportTradingData(data: TradeData[], filename: string): void {
        const csvData = this.convertToCSV(data);
        const filePath = `./exports/${filename}`;

        // Ensure export directory exists
        if (!fs.existsSync("./exports")) {
            fs.mkdirSync("./exports", { recursive: true });
        }

        fs.writeFileSync(filePath, csvData);
    }
}
```

### Best Practices

- Use synchronous operations sparingly (only at startup/shutdown)
- Prefer asynchronous operations to avoid blocking the event loop
- Always handle file operation errors
- Use proper file permissions and paths
- Check file existence before operations

---

## 🛤️ path

Cross-platform file path manipulation.

### Usage in OrderFlow Trading

```typescript
import path from "path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Modern ES module directory resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path construction
export class PathManager {
    private getLogPath(filename: string): string {
        return path.join(__dirname, "logs", filename);
    }

    private getConfigPath(): string {
        return path.resolve(__dirname, "..", "config.json");
    }

    private getDataDirectory(): string {
        return path.join(process.cwd(), "data");
    }
}
```

### Key Methods

```typescript
// Path construction
path.join(...paths: string[]): string;         // Join path segments
path.resolve(...paths: string[]): string;      // Resolve to absolute path
path.relative(from: string, to: string): string; // Relative path between two paths

// Path information
path.dirname(path: string): string;            // Directory name
path.basename(path: string, ext?: string): string; // File name
path.extname(path: string): string;            // File extension

// Path properties
path.isAbsolute(path: string): boolean;        // Check if absolute
path.normalize(path: string): string;          // Normalize path
path.parse(path: string): ParsedPath;          // Parse path into components

// Platform-specific
path.sep: string;                              // Path separator ('/' or '\')
path.delimiter: string;                        // PATH delimiter (':' or ';')
```

### Trading System Usage

```typescript
// Database path management
export class DatabaseConfig {
    private getDatabasePath(symbol: string): string {
        const dbName = `${symbol.toLowerCase()}_trades.db`;
        return path.join(__dirname, "..", "data", "databases", dbName);
    }

    private getBackupPath(originalPath: string): string {
        const parsed = path.parse(originalPath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupName = `${parsed.name}_backup_${timestamp}${parsed.ext}`;

        return path.join(parsed.dir, "backups", backupName);
    }
}

// Configuration file paths
export class ConfigPaths {
    private static getConfigPath(env: string): string {
        const configFile = `config.${env}.json`;
        return path.resolve(process.cwd(), "config", configFile);
    }

    private static getSecretPath(): string {
        return path.join(process.cwd(), ".env");
    }
}
```

### Best Practices

- Always use path.join() for cross-platform compatibility
- Use path.resolve() for absolute paths
- Avoid hardcoded path separators ('/' or '\')
- Use **dirname and **filename for relative paths
- Handle both Unix and Windows path formats

---

## 🏃 child_process

Execute external commands and manage child processes.

### Usage in OrderFlow Trading

```typescript
import { spawn } from "child_process";

// System recovery and management
export class SystemRecoveryManager {
    private restartService(): void {
        const process = spawn("pm2", ["restart", "orderflow"], {
            stdio: "inherit",
            shell: true,
        });

        process.on("exit", (code) => {
            if (code === 0) {
                this.logger.info("Service restarted successfully");
            } else {
                this.logger.error(`Service restart failed with code ${code}`);
            }
        });
    }

    private checkSystemHealth(): Promise<boolean> {
        return new Promise((resolve) => {
            const healthCheck = spawn("systemctl", ["is-active", "orderflow"], {
                stdio: "pipe",
            });

            healthCheck.on("exit", (code) => {
                resolve(code === 0);
            });
        });
    }
}
```

### Key Methods

```typescript
// Spawn process
spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;

// Execute command
exec(command: string, callback: (error: ExecException | null, stdout: string, stderr: string) => void): ChildProcess;

// Fork Node.js process
fork(modulePath: string, args?: string[], options?: ForkOptions): ChildProcess;

// Spawn with shell
execFile(file: string, args: string[], callback: ExecFileCallback): ChildProcess;
```

### Trading System Usage

```typescript
// External tool integration
export class ExternalToolManager {
    private runBacktest(strategy: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const backtest = spawn(
                "python",
                ["backtesting/run_backtest.py", strategy],
                {
                    stdio: "pipe",
                }
            );

            let output = "";
            backtest.stdout.on("data", (data) => {
                output += data.toString();
            });

            backtest.on("exit", (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Backtest failed with code ${code}`));
                }
            });
        });
    }

    private exportToExcel(data: any[], filename: string): void {
        const process = spawn("node", ["scripts/export-excel.js", filename], {
            stdio: "pipe",
        });

        process.stdin.write(JSON.stringify(data));
        process.stdin.end();
    }
}
```

### Best Practices

- Use spawn() for long-running processes
- Use exec() for simple command execution with output
- Always handle process events (exit, error, close)
- Set appropriate stdio options for data flow
- Handle process cleanup to avoid zombies
- Use shell: true for shell commands
- Implement timeouts for long-running operations

---

## 🔗 node:url and node:path

Modern Node.js built-in modules with `node:` prefix.

### Usage in OrderFlow Trading

```typescript
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ModulePathResolver {
    private getModuleDirectory(): string {
        return __dirname;
    }

    private resolveRelativePath(relativePath: string): string {
        return path.join(__dirname, relativePath);
    }
}
```

### Key Functions

```typescript
// URL utilities
fileURLToPath(url: string | URL): string;     // Convert file URL to path
pathToFileURL(path: string): URL;             // Convert path to file URL

// Path utilities (same as 'path' module)
dirname(path: string): string;                // Get directory name
basename(path: string): string;               // Get base name
```

### Modern ES Module Pattern

```typescript
// Standard pattern for ES modules
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ESModuleComponent {
    private configPath = path.join(__dirname, "../config.json");
    private dataPath = path.join(__dirname, "../data");

    public getResourcePath(resource: string): string {
        return path.join(__dirname, "../resources", resource);
    }
}
```

---

## 🎯 Common Patterns in OrderFlow Trading

### Error Handling Pattern

```typescript
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export class TradingComponent extends EventEmitter {
    protected correlationId = randomUUID();

    protected handleError(error: Error, context: string): void {
        const errorInfo = {
            correlationId: this.correlationId,
            context,
            error: error.message,
            timestamp: Date.now(),
        };

        this.emit("error", errorInfo);
        this.logger.error("Component error", errorInfo);
    }
}
```

### File Management Pattern

```typescript
import fs from "fs";
import path from "path";

export class TradingDataManager {
    private ensureDataDirectory(): void {
        const dataDir = path.join(process.cwd(), "data");
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    private saveData(filename: string, data: any): void {
        const filePath = path.join(process.cwd(), "data", filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
}
```

### Process Management Pattern

```typescript
import { spawn } from "child_process";

export class SystemManager {
    private executeWithTimeout(
        command: string,
        args: string[],
        timeoutMs: number
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args);
            let output = "";

            const timeout = setTimeout(() => {
                process.kill();
                reject(new Error("Process timeout"));
            }, timeoutMs);

            process.stdout.on("data", (data) => {
                output += data.toString();
            });

            process.on("exit", (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Process exited with code ${code}`));
                }
            });
        });
    }
}
```

## 📝 Best Practices Summary

1. **crypto**: Use for secure UUID generation and unique identifiers
2. **events**: Extend EventEmitter for reactive components, handle errors
3. **fs**: Prefer async operations, always handle errors, check file existence
4. **path**: Use path.join() for cross-platform compatibility
5. **child_process**: Handle all process events, implement timeouts
6. **node:** modules: Use for modern ES module compatibility

## ⚠️ Security Considerations

- Validate all file paths to prevent directory traversal
- Sanitize command arguments in child_process operations
- Use appropriate file permissions for sensitive data
- Never expose internal file paths in error messages
- Implement proper cleanup for child processes

---

_Node.js Version Compatibility: 14+_  
_Used in: OrderFlow Trading System_

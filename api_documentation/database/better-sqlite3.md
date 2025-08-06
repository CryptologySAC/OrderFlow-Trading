# better-sqlite3 API Documentation

The fastest and simplest library for SQLite3 in Node.js.

## 📦 Installation

```bash
npm install better-sqlite3
# or
yarn add better-sqlite3
```

For TypeScript support:

```bash
npm install --save-dev @types/better-sqlite3
```

## 🎯 Basic Usage

### Database Connection

```typescript
import Database from "better-sqlite3";

// Open database file
const db = new Database("foobar.db", { verbose: console.log });

// In-memory database
const memoryDb = new Database(":memory:");

// Read-only database
const readOnlyDb = new Database("data.db", { readonly: true });
```

### Simple Queries

```typescript
// Execute SQL (for schema changes, etc.)
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");

// Prepared statements
const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
const insertResult = insert.run("John Doe", "john@example.com");
console.log(insertResult.lastInsertRowid); // 1
console.log(insertResult.changes); // 1

// Select single row
const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
const user = getUser.get(1);
console.log(user); // { id: 1, name: 'John Doe', email: 'john@example.com' }

// Select multiple rows
const getAllUsers = db.prepare("SELECT * FROM users");
const users = getAllUsers.all();
console.log(users); // Array of user objects
```

## 📖 Core API Methods

### Database Constructor

```typescript
new Database(filename: string, options?: Options)

interface Options {
  readonly?: boolean;           // Default: false
  fileMustExist?: boolean;     // Default: false
  timeout?: number;            // Default: 5000
  nativeBinding?: string;      // Path to native binding
  verbose?: (message: string) => void; // SQL logging function
}
```

### Database Methods

```typescript
// Execute raw SQL
db.exec(sql: string): Database

// Prepare statement
db.prepare(sql: string): Statement

// Transaction handling
db.transaction(fn: Function): Function

// Database info
db.open: boolean
db.inTransaction: boolean
db.name: string
db.memory: boolean
db.readonly: boolean

// Close database
db.close(): void

// Backup database
db.backup(filename: string, options?: BackupOptions): Promise<BackupMetadata>

// Load extension
db.loadExtension(filename: string, entryPoint?: string): void

// User-defined functions
db.function(name: string, fn: Function): Database
db.function(name: string, options: FunctionOptions, fn: Function): Database

// User-defined aggregates
db.aggregate(name: string, options: AggregateOptions): Database
```

### Statement Methods

```typescript
interface Statement {
    // Execute and return info
    run(...bindParameters: any[]): RunResult;

    // Get single row
    get(...bindParameters: any[]): any;

    // Get all rows
    all(...bindParameters: any[]): any[];

    // Iterate over rows
    iterate(...bindParameters: any[]): IterableIterator<any>;

    // Statement info
    source: string;
    reader: boolean;
    readonly: boolean;

    // Bind parameters
    bind(...bindParameters: any[]): Statement;

    // Column info
    columns(): ColumnDefinition[];

    // Finalize statement
    finalize(): void;
}

interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
}
```

### Parameter Binding

```typescript
// Anonymous parameters (?, ?, ?)
const stmt = db.prepare("INSERT INTO users VALUES (?, ?, ?)");
stmt.run(1, "John", "john@example.com");

// Named parameters (@name, :name, $name)
const stmt2 = db.prepare("INSERT INTO users VALUES (@id, @name, @email)");
stmt2.run({ id: 1, name: "John", email: "john@example.com" });

// Mixed binding
const stmt3 = db.prepare("SELECT * FROM users WHERE id = ? AND name = @name");
stmt3.get(1, { name: "John" });
```

### Transactions

```typescript
// Simple transaction
const insertMany = db.transaction((users) => {
    const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
    for (const user of users) {
        insert.run(user.name, user.email);
    }
});

// Execute transaction
insertMany([
    { name: "John", email: "john@example.com" },
    { name: "Jane", email: "jane@example.com" },
]);

// Manual transaction control
const transaction = db.transaction(() => {
    db.prepare("INSERT INTO users (name) VALUES (?)").run("Alice");
    db.prepare("INSERT INTO users (name) VALUES (?)").run("Bob");
});

try {
    transaction();
} catch (error) {
    // Transaction automatically rolled back
    console.error("Transaction failed:", error);
}
```

## 🔧 Advanced Features

### User-Defined Functions

```typescript
// Scalar function
db.function("add", (a, b) => a + b);
const result = db.prepare("SELECT add(5, 3)").get(); // { 'add(5, 3)': 8 }

// Function with options
db.function(
    "regexp",
    {
        varargs: true,
        deterministic: true,
    },
    (pattern, string) => {
        return new RegExp(pattern).test(string) ? 1 : 0;
    }
);
```

### User-Defined Aggregates

```typescript
db.aggregate("avg", {
    start: () => ({ sum: 0, count: 0 }),
    step: (context, value) => {
        context.sum += value;
        context.count += 1;
    },
    result: (context) => context.sum / context.count,
    inverse: (context, value) => {
        context.sum -= value;
        context.count -= 1;
    },
});
```

### WAL Mode & Performance

```typescript
// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// Other performance pragmas
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = 10000");
db.pragma("temp_store = MEMORY");
```

## 🔷 TypeScript Support

```typescript
import Database, { Database as DatabaseType, Statement } from "better-sqlite3";

interface User {
    id: number;
    name: string;
    email: string;
}

const db: DatabaseType = new Database("app.db");

// Type-safe queries
const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
const user: User | undefined = getUser.get(1) as User;

const getAllUsers = db.prepare("SELECT * FROM users");
const users: User[] = getAllUsers.all() as User[];
```

## 🎯 Usage in OrderFlow Trading

### Trade Storage

```typescript
// Create trades table
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    is_buyer_maker INTEGER NOT NULL,
    trade_id INTEGER UNIQUE,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// Prepared statements for high-frequency inserts
const insertTrade = db.prepare(`
  INSERT INTO trades (symbol, price, quantity, timestamp, is_buyer_maker, trade_id) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Batch insert transaction
const insertTrades = db.transaction((trades) => {
    for (const trade of trades) {
        insertTrade.run(
            trade.symbol,
            trade.price,
            trade.quantity,
            trade.timestamp,
            trade.isBuyerMaker ? 1 : 0,
            trade.tradeId
        );
    }
});
```

### Signal Storage

```typescript
// Signal logging for analysis
const insertSignal = db.prepare(`
  INSERT INTO signals (
    detector_type, signal_side, confidence, price, 
    volume, timestamp, metadata
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Query signals for backtesting
const getSignalsInRange = db.prepare(`
  SELECT * FROM signals 
  WHERE timestamp BETWEEN ? AND ? 
  ORDER BY timestamp ASC
`);
```

### Performance Optimizations

```typescript
// OrderFlow Trading specific optimizations
class OrderFlowDatabase {
    private db: Database;

    constructor(filename: string) {
        this.db = new Database(filename);

        // Performance settings for high-frequency trading data
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
        this.db.pragma("cache_size = 50000"); // 50MB cache
        this.db.pragma("temp_store = MEMORY");
        this.db.pragma("mmap_size = 1073741824"); // 1GB memory map
    }

    // Batch operations for better performance
    batchInsertTrades = this.db.transaction((trades: TradeData[]) => {
        const insert = this.db.prepare(/* SQL */);
        for (const trade of trades) {
            insert.run(/* parameters */);
        }
    });
}
```

## ⚙️ Configuration & Options

### Connection Options

```typescript
interface Options {
    readonly?: boolean; // Open in read-only mode
    fileMustExist?: boolean; // Fail if file doesn't exist
    timeout?: number; // Busy timeout in milliseconds
    verbose?: (sql: string, ...params: any[]) => void; // SQL logging
    nativeBinding?: string; // Custom native binding path
}
```

### Pragma Settings

```typescript
// Common performance pragmas
db.pragma("journal_mode = WAL"); // Write-Ahead Logging
db.pragma("synchronous = NORMAL"); // Balanced durability/performance
db.pragma("cache_size = -64000"); // 64MB cache (negative = KB)
db.pragma("temp_store = MEMORY"); // Store temp tables in memory
db.pragma("mmap_size = 1073741824"); // 1GB memory-mapped I/O
```

## 🔗 Official Resources

- **GitHub Repository**: https://github.com/WiseLibs/better-sqlite3
- **API Documentation**: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- **npm Package**: https://www.npmjs.com/package/better-sqlite3
- **SQLite Documentation**: https://www.sqlite.org/docs.html

## 📝 Requirements

- Node.js v14.21.1 or later
- Prebuilt binaries available for most platforms
- Python and build tools required for compilation (if no prebuilt binary)

## ⚠️ Best Practices

1. **Always use prepared statements** for queries with parameters
2. **Use transactions** for multiple related operations
3. **Enable WAL mode** for better concurrent performance
4. **Close databases** explicitly when done
5. **Handle errors** appropriately in production code
6. **Use appropriate pragma settings** for your use case

---

_Version: 11.9.1_  
_Compatible with: OrderFlow Trading System_

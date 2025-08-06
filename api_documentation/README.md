# API Documentation Reference

Complete documentation for all external libraries used in the OrderFlow Trading system.

## 📚 Library Categories

### 🏦 Binance Trading APIs

- **[@binance/spot](./binance/spot-api.md)** (v4.0.0) - Official Binance SPOT API client
- **[@binance/common](./binance/common-api.md)** (v1.0.2) - Common Binance utilities and types

### 💾 Database & Storage

- **[better-sqlite3](./database/better-sqlite3.md)** (v11.9.1) - High-performance SQLite library

### ✅ Data Validation

- **[zod](./validation/zod.md)** (v3.25.57) - TypeScript-first schema validation

### 🌐 Networking & Communication

- **[ws](./networking/ws.md)** (v8.18.2) - WebSocket client and server
- **[mqtt](./networking/mqtt.md)** (v5.13.1) - MQTT client library
- **[express](./networking/express.md)** (v5.1.0) - Web application framework

### 🤖 AI & Machine Learning

- **[openai](./ai/openai.md)** (v5.1.1) - OpenAI API client

### 🔧 Utilities

- **[fastpriorityqueue](./utilities/fastpriorityqueue.md)** (v0.7.5) - High-performance priority queue
- **[async-mutex](./utilities/async-mutex.md)** (v0.5.0) - Mutex for async operations
- **[ulid](./utilities/ulid.md)** (v3.0.0) - Universally Unique Lexicographically Sortable Identifier
- **[pino](./utilities/pino.md)** (v9.6.0) - Super fast JSON logger
- **[dotenv](./utilities/dotenv.md)** (v16.5.0) - Environment variable loader

### 📊 User Interface

- **[lightweight-charts](./ui/lightweight-charts.md)** (v5.0.6) - Financial charting library

### 🏗️ Node.js Built-ins

- **[Node.js Core Modules](./nodejs-builtins/core-modules.md)** - Documentation for used built-in modules

## 🚀 Quick Start

Each documentation file includes:

- ✅ Installation instructions
- 🎯 Basic usage examples
- 📖 API reference (key methods)
- ⚙️ Configuration options
- 🔷 TypeScript support
- 🔗 Official documentation links
- 📝 Project-specific usage notes

## 📋 Usage in OrderFlow Trading

### High-Frequency Components

- **@binance/spot**: Real-time market data and trading operations
- **ws**: WebSocket connections for live data streaming
- **better-sqlite3**: High-performance data storage and retrieval

### Signal Processing

- **zod**: Input validation and data schema enforcement
- **fastpriorityqueue**: Signal prioritization and processing queues
- **async-mutex**: Thread-safe operations in multi-threaded environment

### Infrastructure

- **pino**: Structured logging for production monitoring
- **express**: HTTP API endpoints and dashboard serving
- **mqtt**: Message passing between system components

### Analysis & AI

- **openai**: LLM-powered signal analysis and insights
- **lightweight-charts**: Real-time trading visualizations

---

_Documentation compiled for OrderFlow Trading System_  
_Last updated: July 2025_

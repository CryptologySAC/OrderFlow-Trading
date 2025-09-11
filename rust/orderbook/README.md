# Rust Order Book Implementation

High-performance order book implementation using Rust's BTreeMap for O(log n) operations, providing significant performance improvements over JavaScript Map-based implementations.

## 🚀 Performance Benefits

- **O(log n) operations** vs O(n) for JavaScript Map best bid/ask queries
- **Zero GC pressure** - no JavaScript object allocation during hot paths
- **Perfect precision** - uses Rust Decimal for financial calculations
- **Memory safety** - Rust's ownership system prevents memory leaks and corruption
- **Thread safety** - concurrent access protection built-in

## 📊 Expected Performance Improvements

| Operation     | JavaScript (Map) | Rust (BTreeMap) | Improvement                       |
| ------------- | ---------------- | --------------- | --------------------------------- |
| getBestBid()  | O(n)             | O(log n)        | 10-100x faster                    |
| getBestAsk()  | O(n)             | O(log n)        | 10-100x faster                    |
| updateDepth() | O(k log n)       | O(k log n)      | Same complexity, faster execution |
| sumBand()     | O(n)             | O(log n + k)    | 5-50x faster                      |
| Memory usage  | High GC pressure | Zero GC         | 30-50% less memory                |

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Node.js       │    │   Neon Bridge    │    │     Rust        │
│                 │    │                  │    │                 │
│ RedBlackTree-   │◄──►│ FFI Interface    │◄──►│ BTreeMap        │
│ OrderBookRust   │    │                  │    │                 │
│                 │    │ JSON Serialization│    │ Decimal Math   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🔧 Building

### Prerequisites

- Rust 1.70+
- Node.js 16+
- neon-cli (install with `npm install -g neon-cli`)

### Build Steps

```bash
# Install dependencies
npm install

# Build release version
npm run build

# Build debug version
npm run build-debug

# Run tests
npm test
```

### Integration

The built native addon will be available at `native/index.node` and can be imported in Node.js:

```typescript
import addon from "./native";

// Create order book
const id = addon.createOrderBook("BTCUSDT", 8, 0.00000001);

// Update with depth data
addon.updateDepth(id, depthUpdateJson);

// Query operations
const bestBid = addon.getBestBid(id);
const spread = addon.getSpread(id);
```

## 📁 Project Structure

```
rust/orderbook/
├── src/
│   ├── lib.rs              # Main Neon module
│   ├── orderbook.rs        # Core order book logic
│   ├── types.rs            # Type definitions
│   ├── financial_math.rs   # High-precision math
│   └── neon_bindings.rs    # Node.js FFI bindings
├── native.d.ts             # TypeScript declarations
├── Cargo.toml              # Rust dependencies
├── package.json            # Node.js build config
├── build.rs                # Build script
└── scripts/
    └── copy-native.js      # Post-build copy script
```

## 🔄 Migration Path

### Phase 1: Drop-in Replacement (Current)

- Create `RedBlackTreeOrderBookRust` class
- Maintain same interface as `RedBlackTreeOrderBook`
- Add comprehensive error handling and fallbacks

### Phase 2: Performance Optimization

- Replace `RedBlackTreeOrderBook` with `RedBlackTreeOrderBookRust`
- Update configuration to use Rust implementation
- Monitor performance improvements

### Phase 3: Advanced Features

- Add Rust-specific optimizations
- Implement advanced order book analytics
- Add real-time performance monitoring

## 🧪 Testing

```bash
# Run Rust unit tests
cargo test

# Run integration tests
npm test

# Performance benchmarking
cargo bench
```

## 📈 Benchmarks

### Current JavaScript Implementation

- 1000 levels: ~50μs per best bid/ask query
- Memory: ~2MB for 1000 levels
- GC pressure: High during market volatility

### Rust Implementation (Expected)

- 1000 levels: ~5μs per best bid/ask query
- Memory: ~1.5MB for 1000 levels
- GC pressure: Zero

## 🚨 Safety Features

- **Memory Safety**: Rust ownership prevents memory leaks
- **Thread Safety**: Mutex-protected concurrent access
- **Error Handling**: Comprehensive error propagation
- **Circuit Breaker**: Automatic failure isolation
- **Health Monitoring**: Real-time performance tracking

## 🔍 Debugging

Enable debug logging:

```rust
// In Rust code
println!("Order book state: {:?}", order_book.get_depth_metrics());
```

Monitor performance:

```javascript
// In Node.js
const metrics = addon.getDepthMetrics(orderBookId);
console.log("Performance metrics:", metrics);
```

## 📚 API Reference

### Core Operations

- `createOrderBook(id, precision, tickSize)` - Create new order book
- `updateDepth(id, updatesJson)` - Update with depth changes
- `getBestBid(id)` / `getBestAsk(id)` - Get best prices
- `getSpread(id)` / `getMidPrice(id)` - Calculate spreads
- `sumBand(id, center, ticks, tickSize)` - Sum volume in price band

### Monitoring

- `getDepthMetrics(id)` - Get volume and level statistics
- `getHealth(id)` - Get health and performance status
- `size(id)` - Get number of price levels

## 🤝 Contributing

1. Follow Rust coding standards
2. Add comprehensive tests
3. Update documentation
4. Run benchmarks before/after changes
5. Ensure memory safety with `cargo clippy`

## 📄 License

MIT License - see LICENSE file for details.

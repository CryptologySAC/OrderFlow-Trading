![CI](https://github.com/CryptologySAC/OrderFlow-Trading/actions/workflows/ci.yml/badge.svg)

# OrderFlow Trading System

**Production-grade cryptocurrency trading system** that analyzes real-time Binance order flow to generate institutional-quality trading signals.

## 🎯 System Overview

### What It Does
- **Real-time order flow analysis** from Binance WebSocket streams (LTCUSDT)
- **Multi-detector pattern recognition** (7 specialized detectors)
- **Institutional activity detection** (large order absorption, iceberg orders, spoofing)
- **Zone-based accumulation/distribution tracking**
- **WebSocket dashboard** with live signal broadcasting
- **Production-grade worker thread architecture** for high-performance processing

### Technical Scale
- **117 TypeScript files** (~53,500 lines of code)
- **7 specialized pattern detectors** with 450+ configuration parameters
- **4 dedicated worker threads** (logging, storage, communication, Binance API)
- **Sub-millisecond trade processing** with institutional-grade precision

## 🚀 Quick Start

### Prerequisites
- Node.js >= 23.x
- Yarn package manager
- SQLite database

### Installation & Setup
```bash
# Install dependencies
yarn install

# Build the project
yarn build

# Run in development mode
yarn start:dev

# Run tests
yarn test

# Run with coverage
yarn test:coverage
```

### Development Commands
```bash
yarn check          # Validate lint, build, and test
yarn lint           # Run ESLint with auto-fix
yarn format         # Format code with Prettier
yarn build:watch    # Build with watch mode
yarn backtest       # Run backtesting framework
```

## 🏗️ Architecture Overview

### Core Data Flow
```
Binance WebSocket → OrderFlowPreprocessor → Pattern Detectors → SignalCoordinator → TradingSignals
```

### Key Components
- **DataStreamManager** - Binance WebSocket connection management
- **OrderFlowPreprocessor** - Real-time trade data processing
- **Pattern Detectors** - 7 specialized signal detection algorithms
- **SignalCoordinator** - Signal validation and correlation
- **WebSocketManager** - Dashboard client connections
- **ThreadManager** - Worker thread orchestration

### Worker Thread Architecture
- **Logger Worker** - All logging operations
- **Binance Worker** - Upstream API communication
- **Communication Worker** - Downstream WebSocket/MQTT
- **Storage Worker** - Database operations

## 🎯 Pattern Detectors

### Tier 1: Momentum & Entry Detection

#### 1. DeltaCVD Confirmation ⭐ **Primary Detector**
- **Purpose**: Real-time momentum detection & entry signals
- **Confidence Threshold**: 0.7 (primary momentum detector)
- **Key Strength**: Speed + accuracy for 0.7%+ moves
- **Recent Optimization**: 60%+ memory reduction, 40-60% faster processing

#### 2. Exhaustion Detector
- **Purpose**: Reversal signals at momentum extremes
- **Confidence Threshold**: 0.8 (very high requirement)
- **Key Strength**: High-probability reversal detection

### Tier 2: Zone Analysis & Confirmation

#### 3. Absorption Detector
- **Purpose**: Support/resistance confirmation & institutional accumulation
- **Confidence Threshold**: 0.85 (institutional grade)
- **Key Strength**: Large order absorption detection

#### 4. Accumulation Zone Detector
- **Purpose**: Long-term accumulation zone identification
- **Confidence Threshold**: 0.95 (highest requirement)
- **Key Strength**: Multi-timeframe zone evolution tracking

#### 5. Distribution Zone Detector
- **Purpose**: Distribution zone identification for short signals
- **Confidence Threshold**: 0.8
- **Key Strength**: Institutional selling pressure detection

### Tier 3: Market Structure & Validation

#### 6. Support/Resistance Detector
- **Purpose**: Key level identification and validation
- **Key Strength**: Dynamic level calculation

#### 7. Market Regime Detector
- **Purpose**: Overall market condition assessment
- **Key Strength**: Volatility and trend classification

## ⚙️ Configuration

### Main Configuration
Configuration is managed through `config.json` with symbol-specific settings:

```json
{
    "symbol": "LTCUSDT",
    "httpPort": 3000,
    "wsPort": 3001,
    "symbols": {
        "LTCUSDT": {
            "pricePrecision": 2,
            "windowMs": 75000,
            "detectors": {
                "deltaCvdConfirmation": {
                    "windowsSec": [60, 300],
                    "minZ": 1.2,
                    "detectionMode": "momentum"
                }
            }
        }
    }
}
```

### Environment Variables
```bash
# Required
BINANCE_API_KEY=your_api_key
BINANCE_SECRET_KEY=your_secret_key

# Optional
LLM_API_KEY=your_llm_key    # For signal analysis
LLM_MODEL=gpt-4             # Override default model
NODE_ENV=development        # Environment mode
```

## 🧪 Testing & Quality Assurance

### Testing Framework
- **Vitest** with >95% coverage requirements
- **Comprehensive mocking** in `__mocks__/` directory
- **Integration tests** for detector validation
- **Performance benchmarks** for optimization

### Code Quality Standards
- **Zero `any` types** - Strict TypeScript typing
- **ESLint + Prettier** with pre-commit hooks
- **Zero magic numbers** - All parameters configurable
- **Financial-precision mathematics** using FinancialMath utilities

### Pre-commit Hooks
Hooks are installed via [husky](https://typicode.github.io/husky/).
They will auto-run `lint`, `test`, and `prettier` before commit/push.

## 📊 Monitoring & Performance

### Health Monitoring
- **Component health checks** with automatic recovery
- **Performance metrics** collection and alerting
- **Circuit breaker patterns** for external dependencies
- **Correlation ID tracing** for debugging

### Dashboard Features
- **Real-time signal visualization**
- **Detector performance metrics**
- **Order book state monitoring**
- **System health indicators**

## 🔧 Development Guidelines

### Adding New Detectors
1. Extend `BaseDetector` class
2. Implement `detect(trade: EnrichedTradeEvent)` method
3. Register in `DetectorFactory`
4. Add configuration to symbol config
5. Include comprehensive tests (>95% coverage)

### Worker Thread Rules
- **NEVER create fallback implementations** for worker functionality
- **Use proxy classes only** (`WorkerProxyLogger`, `WorkerMetricsProxy`)
- **Maintain strict isolation** between main thread and workers
- **All communication via ThreadManager**

### Configuration Changes
- **Update TypeScript interfaces** in `src/types/configTypes.ts`
- **Validate new options** in `src/core/config.ts`
- **Document parameter ranges** and effects
- **Test backward compatibility**

## 🚨 Critical Protection Protocols

### Production-Critical Files (NO MODIFICATIONS WITHOUT APPROVAL)
- `src/trading/dataStreamManager.ts` - Market data connectivity
- `src/market/orderFlowPreprocessor.ts` - Core trade processing
- `src/indicators/*/` - All pattern detection algorithms
- `src/services/signalCoordinator.ts` - Signal processing pipeline
- `.env` - **CRITICAL: Contains production API keys**

### Prohibited Practices
- **NEVER cache live market data** - Causes stale trading signals
- **NEVER use magic numbers** in detector implementations
- **NEVER modify WebSocket URLs** in dashboard.js
- **NEVER create duplicate worker implementations**

## 📚 LLM Signal Analysis

Set `LLM_API_KEY` in your environment to enable LLM powered signal explanations:

```ts
import { analyzeSignal } from "./src/services/llmSignalAnalyzer";
import { getLoggedSignals } from "./src/services/signalLogger";

const lastSignal = getLoggedSignals().at(-1);
if (lastSignal) {
    const explanation = await analyzeSignal(lastSignal);
    console.log(explanation);
}
```

## 🔗 Additional Resources

### Core Documentation
- **[CLAUDE.md](./CLAUDE.md)** - Complete development guidelines and architecture
- **[Worker Thread Architecture](./docs/Worker-Thread-Isolation-Architecture.md)** - Thread isolation principles
- **[Zone-Based Architecture](./docs/Zone-Based-Architecture.md)** - Advanced zone detection system

### Detector Guides
- **[DeltaCVD Simplification Guide](./docs/DeltaCVD-Simplification-Guide.md)** - A/B testing framework ⭐
- **[Absorption Detector](./docs/Absorption-Detector.md)** - Order absorption detection
- **[Exhaustion Detector](./docs/Exhaustion-Detector.md)** - Momentum reversal signals

### Performance & Optimization
- **[Algorithm Complexity Analysis](./docs/Algorithm-Complexity-Analysis.md)** - Performance optimization
- **[Parameter Reference Table](./docs/parameter-reference-table.md)** - Complete parameter documentation
- **[Stats API Reference](./docs/stats-api-reference.md)** - Monitoring and metrics

## 📋 Development Checklist

Before pushing any code:

1. ✅ Run `yarn check` to validate lint, build, and test
2. ✅ Never commit failing code — all checks must pass
3. ✅ PRs must be reviewed by a teammate
4. ✅ Update tests for new functionality
5. ✅ Document configuration changes
6. ✅ Verify worker thread isolation maintained

## 🏆 System Achievements

- **Institutional-grade architecture** with worker thread isolation
- **Sub-millisecond trade processing** with financial precision
- **7 specialized detectors** with 450+ configurable parameters
- **Production-ready monitoring** with comprehensive health checks
- **Zero-downtime operation** with graceful degradation
- **Comprehensive testing** with >95% coverage requirements

---

**Built for institutional trading with zero tolerance for errors.**

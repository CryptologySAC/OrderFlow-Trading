# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development

- `yarn build` - Build the TypeScript project
- `yarn start:dev` - Run in development mode with hot reload
- `yarn start` - Start the production build
- `yarn test` - Run all tests with Vitest
- `yarn test:coverage` - Run tests with coverage report
- `yarn lint` - Run ESLint

### Testing Individual Components

- `yarn test -- --run src/path/to/component` - Run specific test file
- Use the test files in `test/` directory which follow the pattern `componentName.test.ts`

## Architecture Overview

This is a real-time cryptocurrency trading system that analyzes Binance order flow to generate trading signals. The system uses an event-driven architecture with the following key components:

### Core Data Flow

```
Binance WebSocket → OrderFlowPreprocessor → Pattern Detectors → SignalCoordinator → TradingSignals
```

### Key Directories

- `src/core/` - Configuration management and error handling
- `src/infrastructure/` - Cross-cutting concerns (logging, metrics, circuit breakers, database)
- `src/market/` - Order book state management and data preprocessing
- `src/indicators/` - Pattern detection algorithms (absorption, exhaustion, accumulation, etc.)
- `src/services/` - Signal coordination, anomaly detection, and alert management
- `src/trading/` - Signal processing and trading logic
- `src/storage/` - Data persistence layer
- `src/websocket/` - WebSocket connection management

### Main Entry Point

- `src/index.ts` exports the main `OrderFlowDashboard` class
- The dashboard orchestrates all components and manages the application lifecycle

### Pattern Detection System

The system uses a factory pattern for detectors (`src/utils/detectorFactory.ts`) that creates instances of:

- AbsorptionDetector - Large order absorption at key levels
- ExhaustionDetector - Liquidity exhaustion patterns
- AccumulationDetector - Smart money accumulation zones
- DistributionDetector - Distribution patterns
- DeltaCVDConfirmation - Volume delta confirmation

All detectors extend `BaseDetector` and process `EnrichedTradeEvent` objects.

### Signal Processing Pipeline

1. **SignalCoordinator** (`src/services/signalCoordinator.ts`) - Manages detector registration and signal queuing
2. **SignalManager** (`src/trading/signalManager.ts`) - Validates, correlates, and filters signals
3. **AnomalyDetector** (`src/services/anomalyDetector.ts`) - Integrates market anomaly detection
4. **AlertManager** (`src/alerts/alertManager.ts`) - Handles webhook notifications

### Configuration

- Main config in `config.json` with symbol-specific settings
- Environment variables override config values
- Use `src/core/config.ts` for configuration management

### Testing Setup

- Uses Vitest with setup file at `test/vitest.setup.ts`
- Extensive mocking in `__mocks__/` directory
- Tests follow pattern: `componentName.test.ts` in `test/` directory

### Database

- SQLite database with migrations in `src/infrastructure/migrate.ts`
- Database abstraction in `src/infrastructure/db.ts`

### Error Handling

- Custom error types in `src/core/errors.ts`
- Circuit breaker pattern for external API calls
- Correlation IDs for request tracing across components

## Important Development Notes

### Lint Strict

Code must pass Lint stric, that means never use <any> types and use real types where possible instead of <unknown>.

### When Adding New Detectors

1. Extend `BaseDetector` class
2. Implement the `detect(trade: EnrichedTradeEvent)` method
3. Register in `DetectorFactory`
4. Add configuration options to symbol config
5. Include comprehensive tests

### When Modifying Signal Processing

- Maintain correlation ID propagation for tracing
- Update anomaly integration if detector behavior changes
- Test signal priority queue behavior in `SignalCoordinator`

### Database Changes

- Always create migrations in `src/infrastructure/migrate.ts`
- Update version number and add migration logic
- Test both forward and rollback scenarios

### Configuration Changes

- Update TypeScript interfaces in `src/types/configTypes.ts`
- Validate new config options in `src/core/config.ts`
- Document parameter ranges and effects in configuration comments
- every class that has configurable options need to use /config.json

### WebSocket Management

- **DataStreamManager** (`src/trading/dataStreamManager.ts`) - Primary WebSocket connection manager for Binance streams
    - Handles trade and depth data streams with robust reconnection logic
    - Exponential backoff with jitter for reconnection attempts
    - Stream health monitoring and automatic recovery
    - Connection state management with proper event emission
- **WebSocketManager** (`src/websocket/websocketManager.ts`) - Manages server-side WebSocket connections for dashboard clients
- **Integration**: OrderFlowDashboard listens to DataStreamManager connection events and notifies dependent components
- Rate limiting applied to prevent API violations

### Important Connection Recovery Notes

- TradesProcessor and OrderBookState adjust their health monitoring based on stream connection status
- When stream disconnects: health timeouts are extended to avoid false unhealthy states
- When stream reconnects: OrderBookState automatically triggers recovery to rebuild order book
- All components properly handle reconnection events to maintain system consistency

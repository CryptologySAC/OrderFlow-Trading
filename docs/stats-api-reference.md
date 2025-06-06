# Stats API Reference

This document describes the JSON structure of the stats data broadcast by the OrderFlow Trading system via WebSocket and MQTT.

## Overview

The stats are broadcast every 5 seconds (configurable) and contain comprehensive metrics about:
- System health and performance
- Signal processing statistics  
- Market data stream metrics
- Detector performance
- Trading signal outcomes

## WebSocket Message Structure

```json
{
  "type": "stats",
  "data": {
    // Stats payload (see below)
  },
  "now": 1703123456789
}
```

## MQTT Message Structure

The MQTT payload contains only the stats data object (no wrapper):

```json
{
  "metrics": { /* ... */ },
  "health": { /* ... */ },
  "dataStream": { /* ... */ },
  "signalPerformance": { /* ... */ },
  "signalTrackerStatus": { /* ... */ }
}
```

## Stats Data Structure

### `metrics` - Core System Metrics

```typescript
interface Metrics {
  // Core system metrics
  signalsGenerated: number;          // Total trading signals generated
  connectionsActive: number;         // Active WebSocket connections
  processingLatency: number[];       // Array of recent processing times (ms)
  errorsCount: number;              // Total system errors
  circuitBreakerState: string;      // Circuit breaker status
  uptime: number;                   // System uptime in seconds

  // Trade processing metrics
  tradeMessages?: number;           // Binance trade messages received
  depthMessages?: number;           // Binance depth messages received
  tradesProcessed?: number;         // Trades successfully processed
  tradesProcessingTime?: number;    // Average trade processing time (ms)
  tradesErrors?: number;            // Trade processing errors
  invalidTrades?: number;           // Invalid/malformed trades
  hybridTradesProcessed?: number;   // Hybrid trades processed

  // Order book metrics
  orderbookUpdatesProcessed?: number;    // Order book updates processed
  orderbookProcessingTime?: number;      // Average processing time (ms)
  orderbookProcessingErrors?: number;    // Processing errors
  orderbookPruneDuration?: number;       // Time spent pruning (ms)
  orderbookPruneRemoved?: number;        // Levels removed during pruning

  // Individual trades enhancement
  "individualTrades.cacheHits"?: number;       // Cache hit count
  "individualTrades.fetchSuccess"?: number;    // Successful API fetches
  "individualTrades.lastFetchSize"?: number;   // Last fetch batch size
  "individualTrades.fetchErrors"?: number;     // Fetch errors

  // Microstructure analysis
  "microstructure.analysisTimeMs"?: number;    // Analysis duration
  "microstructure.analysisCount"?: number;     // Analysis attempts
  "microstructure.analysisErrors"?: number;    // Analysis errors

  // Detector metrics - Absorption
  absorptionDetectionAttempts?: number;    // Detection attempts
  absorptionSignalsGenerated?: number;     // Signals generated
  absorptionDetectionErrors?: number;      // Detection errors
  absorptionZonesActive?: number;         // Active absorption zones
  absorptionSpoofingRejected?: number;    // Rejected due to spoofing

  // Detector metrics - Exhaustion  
  exhaustionDetectionAttempts?: number;    // Detection attempts
  exhaustionSignalsGenerated?: number;     // Signals generated
  exhaustionDetectionErrors?: number;      // Detection errors
  exhaustionSpoofingRejected?: number;    // Rejected due to spoofing
  exhaustionRefillRejected?: number;      // Rejected due to refill

  // Signal processing
  signalCandidatesGenerated?: number;     // Total candidates
  signalCandidatesProcessed?: number;     // Processed candidates
  signalsConfirmed?: number;              // Confirmed signals
  signalsRejected?: number;               // Rejected signals

  // Signal rejection reasons
  signalsRejectedLowConfidence?: number;      // Low confidence
  signalsRejectedUnhealthyMarket?: number;    // Market health issues
  signalsRejectedProcessingError?: number;    // Processing errors
  signalsRejectedTimeout?: number;            // Timeouts
  signalsRejectedDuplicate?: number;          // Duplicates

  // Signal candidates by type
  candidatesAbsorption?: number;
  candidatesExhaustion?: number;
  candidatesAccumulation?: number;
  candidatesDistribution?: number;
  candidatesCvdConfirmation?: number;

  // Confirmed signals by type
  confirmedAbsorption?: number;
  confirmedExhaustion?: number;
  confirmedAccumulation?: number;
  confirmedDistribution?: number;
  confirmedCvdConfirmation?: number;
}
```

### `health` - System Health Summary

```typescript
interface HealthSummary {
  overall: "healthy" | "degraded" | "critical";
  uptime: number;                    // System uptime in seconds
  memoryUsage: {
    used: number;                    // Memory used (MB)
    percentage: number;              // Memory usage percentage
  };
  components: {
    [componentName: string]: {
      status: "healthy" | "degraded" | "critical";
      lastCheck: number;             // Timestamp of last health check
      message?: string;              // Status message
    };
  };
  alerts: Array<{
    level: "warning" | "error" | "critical";
    component: string;
    message: string;
    timestamp: number;
  }>;
}
```

### `dataStream` - Market Data Stream Metrics

```typescript
interface DataStreamMetrics {
  connectionState: "connected" | "connecting" | "disconnected" | "error";
  connectedAt?: number;              // Connection timestamp
  lastMessageAt?: number;            // Last message timestamp
  reconnectAttempts: number;         // Total reconnection attempts
  
  // Message statistics
  totalMessages: number;             // Total messages received
  messagesPerSecond: number;         // Current message rate
  avgLatency: number;                // Average message latency (ms)
  
  // Stream health
  isHealthy: boolean;
  healthScore: number;               // 0-1 health score
  lastHealthCheck: number;
  
  // Error tracking
  errors: {
    total: number;
    recent: Array<{
      type: string;
      message: string;
      timestamp: number;
    }>;
  };
  
  // Performance metrics
  processing: {
    avgProcessingTime: number;       // Average processing time (ms)
    processingErrors: number;        // Processing errors
    backlogSize: number;            // Current backlog size
  };
}
```

### `signalPerformance` - Trading Signal Performance (24h window)

```typescript
interface PerformanceMetrics {
  timeWindow: number;                // Analysis window (ms)
  totalSignals: number;              // Total signals in window
  activeSignals: number;             // Currently active signals
  completedSignals: number;          // Completed signals

  // Overall performance
  overallSuccessRate: number;        // Success rate (0-1)
  avgReturnPerSignal: number;        // Average return per signal
  totalReturn: number;               // Total return in window

  // Risk metrics
  maxDrawdown: number;               // Maximum drawdown
  avgDrawdown: number;               // Average drawdown
  sharpeRatio: number;               // Risk-adjusted return
  winRate: number;                   // Win rate (0-1)

  // Timing metrics
  avgTimeToSuccess: number;          // Average time to successful outcome (ms)
  avgTimeToFailure: number;          // Average time to failed outcome (ms)

  // Performance by signal type
  performanceByType: {
    [signalType: string]: {
      count: number;
      successRate: number;
      avgReturn: number;
      winRate: number;
    };
  };

  // Performance by confidence level
  performanceByConfidence: {
    [confidenceRange: string]: {     // e.g., "0.6-0.7", "0.7-0.8"
      count: number;
      successRate: number;
      avgReturn: number;
    };
  };

  // Recent performance trend
  recentTrend: {
    direction: "improving" | "declining" | "stable";
    changePercent: number;
    periodDays: number;
  };
}
```

### `signalTrackerStatus` - Signal Tracker Status

```typescript
interface SignalTrackerStatus {
  isActive: boolean;                 // Tracker active status
  activeSignals: number;             // Currently tracked signals
  completedSignals: number;          // Completed signal count
  
  // Tracking statistics
  trackingStarted: number;           // Tracker start timestamp
  lastSignalAt?: number;             // Last signal timestamp
  avgTrackingDuration: number;       // Average tracking duration (ms)
  
  // Performance summary
  recentPerformance: {
    successRate: number;             // Recent success rate
    avgReturn: number;               // Recent average return
    signalCount: number;             // Recent signal count
  };
}
```

## Usage Examples

### WebSocket Client (JavaScript)

```javascript
const ws = new WebSocket('ws://localhost:3001');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'stats') {
    const stats = message.data;
    
    // Display system health
    console.log('System Health:', stats.health.overall);
    
    // Show signal performance
    if (stats.signalPerformance) {
      console.log('Success Rate:', stats.signalPerformance.overallSuccessRate);
      console.log('Total Return:', stats.signalPerformance.totalReturn);
    }
    
    // Monitor data stream
    console.log('Stream State:', stats.dataStream.connectionState);
    console.log('Messages/sec:', stats.dataStream.messagesPerSecond);
  }
};
```

### MQTT Client (Node.js)

```javascript
const mqtt = require('mqtt');
const client = mqtt.connect('ws://192.168.2.24:1884', {
  username: 'orderflow',
  password: 'orderflow'
});

client.on('connect', () => {
  client.subscribe('orderflow/stats');
});

client.on('message', (topic, message) => {
  if (topic === 'orderflow/stats') {
    const stats = JSON.parse(message.toString());
    
    // Process stats data
    console.log('Uptime:', stats.metrics.uptime);
    console.log('Active Signals:', stats.signalTrackerStatus.activeSignals);
  }
});
```

### Python Client (MQTT)

```python
import json
import paho.mqtt.client as mqtt

def on_connect(client, userdata, flags, rc):
    client.subscribe("orderflow/stats")

def on_message(client, userdata, msg):
    stats = json.loads(msg.payload.decode())
    
    # Extract key metrics
    uptime = stats['metrics']['uptime']
    health = stats['health']['overall']
    
    print(f"System uptime: {uptime}s, Health: {health}")

client = mqtt.Client()
client.username_pw_set("orderflow", "orderflow")
client.on_connect = on_connect
client.on_message = on_message

client.connect("192.168.2.24", 1884, 60)
client.loop_forever()
```

## Update Frequency

- **WebSocket**: Broadcast every 5 seconds (configurable via `intervalMs`)
- **MQTT**: Published every 5 seconds to the configured topic
- **HTTP**: Available via `/stats` endpoint for on-demand access

## Configuration

The stats broadcaster can be configured in `config.json`:

```json
{
  "mqtt": {
    "url": "ws://192.168.2.24:1884",
    "username": "orderflow",
    "password": "orderflow", 
    "statsTopic": "orderflow/stats",
    "clientId": "orderflow-dashboard"
  }
}
```

## Error Handling

The stats broadcaster includes comprehensive error handling:

- Automatic reconnection for MQTT/WebSocket failures
- Graceful degradation when components are unavailable
- Error logging with correlation IDs
- Circuit breaker protection for external dependencies

## Security Considerations

- Use secure WebSocket (WSS) and MQTT over TLS in production
- Implement proper authentication for MQTT brokers
- Consider rate limiting for WebSocket connections
- Validate and sanitize any user inputs in stats processing
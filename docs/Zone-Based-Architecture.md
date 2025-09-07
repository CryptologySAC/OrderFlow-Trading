# Zone-Based Architecture Documentation

## Overview

The Zone-Based Architecture represents a fundamental shift from event-based to process-based detection of accumulation and distribution patterns. Instead of treating these market phenomena as point-in-time events, zones capture the evolving nature of institutional trading activity over time and price ranges.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Zone Types](#zone-types)
- [Zone Lifecycle](#zone-lifecycle)
- [Visual Representation](#visual-representation)
- [Zone Signals](#zone-signals)
- [Implementation Details](#implementation-details)
- [Configuration](#configuration)
- [API Reference](#api-reference)

## Architecture Overview

### Core Components

```
ZoneManager ← AccumulationZoneDetector
     ↓             DistributionZoneDetector
WebSocket Broadcasting → Dashboard Visualization
```

**Key Files:**

- `backend/src/types/zoneTypes.ts` - Zone type definitions
- `backend/src/trading/zoneManager.ts` - Zone lifecycle management
- `backend/src/indicators/accumulationZoneDetector.ts` - Accumulation zone detection
- `backend/src/indicators/distributionZoneDetector.ts` - Distribution zone detection

### Zone vs Legacy Detectors

| Aspect                  | Legacy Detectors      | Zone-Based Detectors         |
| ----------------------- | --------------------- | ---------------------------- |
| **Detection Model**     | Point-in-time events  | Evolving processes over time |
| **Duration**            | Instantaneous         | 2-30+ minutes                |
| **Price Coverage**      | Single price level    | Price range/zone             |
| **Strength Tracking**   | Binary (detected/not) | Continuous (0-100%)          |
| **Completion Tracking** | Not applicable        | Progressive (0-100%)         |
| **Visualization**       | Signal markers        | Chart overlays/boxes         |

## Zone Types

### Accumulation Zones

**Purpose:** Detect areas where institutional buyers are accumulating positions over time.

**Characteristics:**

- **Formation Time:** 3+ minutes minimum
- **Buy Ratio Requirement:** 65%+ buy volume
- **Price Stability:** Maximum 0.5% price deviation
- **Minimum Volume:** 100+ units
- **Color:** Green with opacity based on strength

**Detection Criteria:**

```typescript
{
    minCandidateDuration: 180000,  // 3 minutes
    minZoneVolume: 100,
    minBuyRatio: 0.65,            // 65% buy volume
    maxPriceDeviation: 0.005,     // 0.5%
    minTradeCount: 10
}
```

### Distribution Zones

**Purpose:** Detect areas where institutional sellers are distributing positions over time.

**Characteristics:**

- **Formation Time:** 2+ minutes minimum (faster than accumulation)
- **Sell Ratio Requirement:** 68%+ sell volume
- **Price Stability:** Maximum 0.8% price deviation
- **Minimum Volume:** 150+ units
- **Color:** Red with opacity based on strength

**Detection Criteria:**

```typescript
{
    minCandidateDuration: 120000,  // 2 minutes
    minZoneVolume: 150,
    minSellRatio: 0.68,           // 68% sell volume
    maxPriceDeviation: 0.008,     // 0.8%
    minTradeCount: 8
}
```

## Zone Lifecycle

### 1. Candidate Formation

Zones begin as **candidates** when initial patterns are detected:

```typescript
interface AccumulationCandidate {
    priceLevel: number;
    startTime: number;
    trades: EnrichedTradeEvent[];
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    consecutiveBuyTrades: number;
    priceStability: number;
}
```

### 2. Zone Creation

Candidates become **zones** when criteria are met:

- Minimum duration requirement satisfied
- Volume and trade count thresholds met
- Flow ratio requirements satisfied (buy/sell dominance)
- Price stability maintained

### 3. Zone Evolution

Active zones continuously update with new trades:

- **Strength calculation** based on volume, time, stability, and flow consistency
- **Completion tracking** based on expected volume and duration
- **Confidence scoring** based on pattern consistency

### 4. Zone Completion/Invalidation

Zones end through:

- **Completion:** Meeting completion threshold (80% for accumulation, 75% for distribution)
- **Invalidation:** Price breaking zone boundaries significantly
- **Timeout:** Exceeding maximum lifetime (1 hour accumulation, 30 min distribution)

## Visual Representation

### Dashboard Chart Overlays

Zones appear as **rectangular overlays** on the trading chart:

```javascript
// Zone Box Properties
{
    type: "box",
    xMin: zone.startTime,
    xMax: currentTime + 5min,  // Extends into future
    yMin: zone.priceRange.min,
    yMax: zone.priceRange.max,
    backgroundColor: getZoneColor(zone),  // Opacity based on strength
    borderColor: getZoneBorderColor(zone),
    label: "ACC 73% (45%)"  // Type, Strength, Completion
}
```

### Zone Colors

**Accumulation Zones:**

- Background: `rgba(34, 197, 94, alpha)` (Green)
- Border: `rgba(34, 197, 94, 0.8)`
- Text: `rgba(21, 128, 61, 1)`

**Distribution Zones:**

- Background: `rgba(239, 68, 68, alpha)` (Red)
- Border: `rgba(239, 68, 68, 0.8)`
- Text: `rgba(153, 27, 27, 1)`

**Opacity Calculation:**

```javascript
const alpha = Math.max(0.15, zone.strength * 0.4); // 15-40% based on strength
```

### Interactive Features

**Hover Tooltips:**

```
ACCUMULATION ZONE
Price Range: $89.20 - $89.65
Center: $89.42
Strength: 73.2%
Completion: 45.8%
Confidence: 81.5%
Duration: 18m
Volume: 1,234
Trades: 156
ID: acc_LTCUSDT_1701234567
```

**Real-time Updates:**

- Zones grow/shrink as price ranges evolve
- Opacity changes with strength variations
- Labels update with current metrics
- Completed zones show checkmark and fade

## Zone Signals

### Signal Types

1. **Zone Entry** - Initial zone formation
2. **Zone Strength Change** - Significant strength increase/decrease
3. **Zone Completion** - Zone reaches completion threshold
4. **Zone Invalidation** - Zone becomes invalid due to price action

### Signal Structure

```typescript
interface ZoneSignal {
    signalType:
        | "zone_entry"
        | "zone_strength_change"
        | "zone_completion"
        | "zone_invalidation";
    zone: AccumulationZone;
    actionType:
        | "enter_zone"
        | "add_to_zone"
        | "prepare_for_breakout"
        | "exit_zone";
    confidence: number;
    urgency: "low" | "medium" | "high";
    timeframe: "immediate" | "short_term" | "medium_term";
    expectedDirection: "up" | "down" | "neutral";
    zoneStrength: number;
    completionLevel: number;
    invalidationLevel: number;
    breakoutTarget?: number;
    positionSizing: "light" | "normal" | "heavy";
    stopLossLevel: number;
    takeProfitLevel?: number;
}
```

### Signal Examples

**Accumulation Zone Entry:**

```
🔵 ACCUMULATION ZONE ENTRY
Price: $89.45 | Strength: 72% | Completion: 34%
Action: Enter Zone | Confidence: 85%
Stop Loss: $88.90 | Take Profit: $91.20
Expected Direction: UP
Position Sizing: Normal
```

**Distribution Zone Completion:**

```
🔴 DISTRIBUTION ZONE COMPLETION
Price: $92.15 | Strength: 89% | Completion: 82%
Action: Prepare for Breakout | Urgency: HIGH
Expected Direction: DOWN | Target: $89.50
Stop Loss: $93.20 | Position Sizing: Normal
```

## Implementation Details

### Zone Manager

Central component managing zone lifecycle:

```typescript
class ZoneManager extends EventEmitter {
    public createZone(
        type: "accumulation" | "distribution",
        symbol: string,
        initialTrade: EnrichedTradeEvent,
        detection: ZoneDetectionData
    ): AccumulationZone;
    public updateZone(
        zoneId: string,
        trade: EnrichedTradeEvent
    ): ZoneUpdate | null;
    public invalidateZone(zoneId: string, reason: string): ZoneUpdate | null;
    public getActiveZones(symbol?: string): AccumulationZone[];
    public getZonesNearPrice(
        symbol: string,
        price: number,
        tolerance: number
    ): AccumulationZone[];
}
```

### Zone Detectors

**AccumulationZoneDetector:**

- Tracks buy-dominant trading patterns
- Requires 65%+ buy volume
- 3-minute minimum formation time
- Monitors for institutional accumulation patterns

**DistributionZoneDetector:**

- Tracks sell-dominant trading patterns
- Requires 68%+ sell volume
- 2-minute minimum formation time (faster than accumulation)
- Detects distribution/selling pressure

### WebSocket Integration

Real-time zone updates broadcast to dashboard:

```typescript
// Zone Update Message
{
    type: "zoneUpdate",
    data: {
        updateType: "zone_created" | "zone_strengthened" | "zone_completed" | "zone_invalidated",
        zone: AccumulationZone,
        significance: "low" | "medium" | "high",
        changeMetrics?: {
            strengthChange: number,
            volumeAdded: number,
            timeProgression: number,
            completionChange: number
        }
    }
}

// Zone Signal Message
{
    type: "zoneSignal",
    data: ZoneSignal
}
```

## Configuration

### Zone Detector Config

```typescript
interface ZoneDetectorConfig {
    maxActiveZones: number; // Max concurrent zones per symbol (default: 3)
    zoneTimeoutMs: number; // Max zone lifetime (default: 3600000 - 1 hour)
    minZoneVolume: number; // Minimum volume for valid zone (default: 100)
    maxZoneWidth: number; // Max price width percentage (default: 0.01 - 1%)
    minZoneStrength: number; // Minimum strength to emit signals (default: 0.5)
    completionThreshold: number; // Completion level for completion signals (default: 0.8)
    strengthChangeThreshold: number; // Minimum strength change for signals (default: 0.15)
}
```

### Symbol-Specific Configuration

Add to `config.json`:

```json
{
    "zoneDetectors": {
        "LTCUSDT": {
            "accumulation": {
                "maxActiveZones": 3,
                "zoneTimeoutMs": 3600000,
                "minZoneVolume": 100,
                "maxZoneWidth": 0.01,
                "minZoneStrength": 0.5,
                "completionThreshold": 0.8,
                "strengthChangeThreshold": 0.15
            },
            "distribution": {
                "maxActiveZones": 3,
                "zoneTimeoutMs": 1800000,
                "minZoneVolume": 150,
                "maxZoneWidth": 0.012,
                "minZoneStrength": 0.45,
                "completionThreshold": 0.75,
                "strengthChangeThreshold": 0.12
            }
        }
    }
}
```

## API Reference

### Zone Manager Methods

#### `createZone(type, symbol, initialTrade, detection)`

Creates a new zone from candidate data.

**Parameters:**

- `type`: "accumulation" | "distribution"
- `symbol`: Trading symbol
- `initialTrade`: Trade that triggered zone creation
- `detection`: Zone detection data with price ranges and metrics

**Returns:** `AccumulationZone`

#### `updateZone(zoneId, trade)`

Updates existing zone with new trade data.

**Parameters:**

- `zoneId`: Unique zone identifier
- `trade`: New trade data

**Returns:** `ZoneUpdate | null`

#### `getActiveZones(symbol?)`

Retrieves all active zones, optionally filtered by symbol.

**Parameters:**

- `symbol`: Optional symbol filter

**Returns:** `AccumulationZone[]`

#### `getZoneStatistics()`

Returns comprehensive zone statistics.

**Returns:**

```typescript
{
    activeZones: number;
    completedZones: number;
    avgZoneStrength: number;
    avgZoneDuration: number;
    zonesByType: Record<string, number>;
    zonesBySignificance: Record<string, number>;
}
```

### Zone Query Methods

#### `getZonesNearPrice(symbol, price, tolerance)`

Find zones near a specific price level.

**Parameters:**

- `symbol`: Trading symbol
- `price`: Target price
- `tolerance`: Price tolerance (default: 0.01 = 1%)

**Returns:** `AccumulationZone[]`

#### `queryZones(options)`

Advanced zone querying with filters.

**Parameters:**

```typescript
{
    symbol?: string;
    type?: "accumulation" | "distribution";
    isActive?: boolean;
    minStrength?: number;
    maxAge?: number;
    nearPrice?: { price: number; tolerance: number; };
}
```

**Returns:** `AccumulationZone[]`

## Performance Considerations

### Memory Management

- **Zone cleanup:** Automatic removal of old completed zones
- **Candidate cleanup:** Periodic removal of stale candidates
- **History limits:** Rolling windows for zone strength history

### Optimization Features

- **Efficient zone lookups** using Map data structures
- **Minimal chart updates** using Chart.js "none" animation mode
- **Event-driven updates** only when zones actually change
- **Configurable limits** on active zones and history retention

### Monitoring Metrics

- Active zone count per symbol
- Zone formation rate
- Average zone duration and success rate
- Memory usage of zone storage

## Best Practices

### Trading Applications

1. **Zone Entry:** Wait for zone strength >70% before entering
2. **Position Sizing:** Use zone significance for position sizing
3. **Stop Losses:** Place stops below/above zone boundaries
4. **Target Setting:** Use completion signals for profit-taking

### Configuration Tuning

1. **Volume Thresholds:** Adjust based on market conditions
2. **Time Requirements:** Shorter for volatile markets
3. **Strength Thresholds:** Higher for conservative trading
4. **Zone Limits:** Balance between coverage and performance

### Monitoring and Alerts

1. **Zone Health:** Monitor formation and completion rates
2. **Performance Tracking:** Compare zone vs legacy detector success
3. **System Resources:** Watch memory usage and update frequency
4. **Market Adaptation:** Adjust parameters based on market regime changes

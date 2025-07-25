# @binance/spot API Documentation

Official Binance SPOT API client library for Node.js.

## 📦 Installation

```bash
npm install @binance/spot
# or
yarn add @binance/spot
```

## 🎯 Basic Usage

### REST API Client

```typescript
import { Spot, SpotRestAPI } from "@binance/spot";

const configurationRestAPI = {
    apiKey: "your-api-key",
    apiSecret: "your-api-secret",
};

const client = new Spot({ configurationRestAPI });

// Get exchange information
client.restAPI
    .exchangeInfo({ symbol: "BNBUSDT" })
    .then((res) => res.data())
    .then((data: SpotRestAPI.ExchangeInfoResponse) => console.log(data))
    .catch((err) => console.error(err));
```

### WebSocket API Client

```typescript
import { Spot, SpotWebsocketAPI } from "@binance/spot";

const configurationWebsocketAPI = {
    apiKey: "your-api-key",
    apiSecret: "your-api-secret",
};

const client = new Spot({ configurationWebsocketAPI });

client.websocketAPI
    .connect()
    .then((connection: SpotWebsocketAPI.WebsocketAPIConnection) =>
        connection.exchangeInfo({ symbol: "BNBUSDT" })
    )
    .then(
        (
            res: SpotWebsocketAPI.ApiResponse<SpotWebsocketAPI.ExchangeInfoResponse>
        ) => console.log(res.data)
    )
    .catch((err) => console.error(err));
```

### WebSocket Streams

```typescript
import { SpotWebsocketStreams } from "@binance/spot";

const wsStreams = new SpotWebsocketStreams({
    wsURL: "wss://stream.binance.com:9443/ws/",
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
});

// Subscribe to trade stream
wsStreams.subscribe(["btcusdt@trade"], (data) => {
    console.log("Trade data:", data);
});

// Subscribe to depth stream
wsStreams.subscribe(["btcusdt@depth"], (data) => {
    console.log("Depth data:", data);
});
```

## 📖 Key API Methods

### REST API Methods

#### Market Data

```typescript
// Exchange information
client.restAPI.exchangeInfo({ symbol?: string })

// Order book
client.restAPI.depth({ symbol: string, limit?: number })

// Recent trades
client.restAPI.trades({ symbol: string, limit?: number })

// Historical trades
client.restAPI.historicalTrades({ symbol: string, limit?: number, fromId?: number })

// Aggregate trades
client.restAPI.aggTrades({
  symbol: string,
  fromId?: number,
  startTime?: number,
  endTime?: number,
  limit?: number
})

// Kline/Candlestick data
client.restAPI.klines({
  symbol: string,
  interval: string,
  startTime?: number,
  endTime?: number,
  limit?: number
})

// 24hr ticker price change statistics
client.restAPI.ticker24hr({ symbol?: string })

// Symbol price ticker
client.restAPI.tickerPrice({ symbol?: string })

// Symbol order book ticker
client.restAPI.tickerBookTicker({ symbol?: string })
```

#### Account Information

```typescript
// Account information
client.restAPI.account()

// Account trade list
client.restAPI.myTrades({ symbol: string, startTime?: number, endTime?: number, fromId?: number, limit?: number })
```

#### Trading

```typescript
// Test new order
client.restAPI.newOrderTest({
  symbol: string,
  side: 'BUY' | 'SELL',
  type: string,
  quantity?: number
})

// New order
client.restAPI.newOrder({
  symbol: string,
  side: 'BUY' | 'SELL',
  type: string,
  quantity?: number,
  price?: number,
  timeInForce?: string
})

// Cancel order
client.restAPI.cancelOrder({ symbol: string, orderId?: number, origClientOrderId?: string })

// Cancel all open orders
client.restAPI.cancelOpenOrders({ symbol: string })

// Query order
client.restAPI.getOrder({ symbol: string, orderId?: number, origClientOrderId?: string })

// Current open orders
client.restAPI.openOrders({ symbol?: string })

// All orders
client.restAPI.allOrders({ symbol: string, orderId?: number, startTime?: number, endTime?: number, limit?: number })
```

### WebSocket Stream Types

#### Trade Streams

```typescript
// Individual symbol trade stream
'<symbol>@trade'

// Example: 'btcusdt@trade'
{
  "e": "trade",
  "E": 123456789,
  "s": "BTCUSDT",
  "i": 12345,
  "p": "0.001",
  "q": "100",
  "b": 88,
  "a": 50,
  "T": 123456785,
  "m": true,
  "M": true
}
```

#### Depth Streams

```typescript
// Partial book depth stream
'<symbol>@depth<levels>@<update_speed>'

// Example: 'btcusdt@depth5@100ms'
{
  "lastUpdateId": 160,
  "bids": [
    ["0.0024", "10"]
  ],
  "asks": [
    ["0.0026", "100"]
  ]
}
```

#### Kline/Candlestick Streams

```typescript
// Kline/Candlestick stream
'<symbol>@kline_<interval>'

// Example: 'btcusdt@kline_1m'
{
  "e": "kline",
  "E": 123456789,
  "s": "BTCUSDT",
  "k": {
    "t": 123400000,
    "T": 123460000,
    "s": "BTCUSDT",
    "i": "1m",
    "f": 100,
    "L": 200,
    "o": "0.0010",
    "c": "0.0020",
    "h": "0.0025",
    "l": "0.0015",
    "v": "1000",
    "n": 100,
    "x": false,
    "q": "1.0000",
    "V": "500",
    "Q": "0.500"
  }
}
```

## ⚙️ Configuration Options

### REST API Configuration

```typescript
interface RestAPIConfiguration {
    apiKey?: string;
    apiSecret?: string;
    baseURL?: string;
    timeout?: number; // Default: 1000ms
    proxy?: {
        protocol?: string;
        host?: string;
        port?: number;
        auth?: {
            username: string;
            password: string;
        };
    };
    httpsAgent?: any;
    httpAgent?: any;
}
```

### WebSocket API Configuration

```typescript
interface WebsocketAPIConfiguration {
    apiKey?: string;
    apiSecret?: string;
    baseURL?: string;
    timeout?: number; // Default: 5000ms
    reconnectDelay?: number; // Default: 5000ms
    compression?: boolean; // Default: true
}
```

### WebSocket Streams Configuration

```typescript
interface WebsocketStreamsConfiguration {
    wsURL?: string; // Default: 'wss://stream.binance.com:9443/ws/'
    reconnectDelay?: number; // Default: 5000ms
    maxReconnectAttempts?: number; // Default: 5
    compression?: boolean; // Default: true
}
```

## 🔷 TypeScript Support

The library provides comprehensive TypeScript definitions:

```typescript
import {
    Spot,
    SpotRestAPI,
    SpotWebsocketAPI,
    SpotWebsocketStreams,
} from "@binance/spot";

// Type-safe responses
type ExchangeInfoResponse = SpotRestAPI.ExchangeInfoResponse;
type TradeData = SpotWebsocketStreams.TradeData;
type DepthData = SpotWebsocketStreams.DepthData;
```

## 🎯 Usage in OrderFlow Trading

### Market Data Streaming

```typescript
// Real-time trade data for signal generation
wsStreams.subscribe(["ltcusdt@trade"], (trade) => {
    const enrichedTrade = {
        symbol: trade.s,
        price: parseFloat(trade.p),
        quantity: parseFloat(trade.q),
        timestamp: trade.T,
        isBuyerMaker: trade.m,
    };

    orderFlowProcessor.processTrade(enrichedTrade);
});
```

### Order Book Management

```typescript
// Depth updates for absorption detection
wsStreams.subscribe(["ltcusdt@depth@100ms"], (depth) => {
    orderBookState.processDepthUpdate(depth);
});
```

### Historical Data Backfill

```typescript
// Fetch historical trades for pattern analysis
const historicalTrades = await client.restAPI.aggTrades({
    symbol: "LTCUSDT",
    fromId: lastTradeId,
    limit: 1000,
});
```

## 🔗 Official Resources

- **GitHub Repository**: https://github.com/binance/binance-spot-api-docs
- **API Documentation**: https://binance-docs.github.io/apidocs/spot/en/
- **npm Package**: https://www.npmjs.com/package/@binance/spot

## 📝 Requirements

- Node.js version 22.12.0 or later
- Valid Binance API credentials for authenticated endpoints

## ⚠️ Rate Limits

Be aware of Binance API rate limits:

- REST API: Various limits per endpoint
- WebSocket: Connection and subscription limits
- Use appropriate delays and error handling for production systems

---

_Version: 4.0.0_  
_Compatible with: OrderFlow Trading System_

# Backtesting Data Storage

This directory contains market data collected for backtesting and detector configuration optimization.

## 📊 Data Collection Overview

The system automatically collects **every trade and depth update** for 7 days to enable comprehensive backtesting of detector configurations.

## 📁 File Structure

### File Naming Convention

```
LTCUSDT_YYYY-MM-DD_HHh_trades.[csv|jsonl]
LTCUSDT_YYYY-MM-DD_HHh_depth.[csv|jsonl]
```

**Examples:**

- `LTCUSDT_2025-06-20_00h_trades.csv` - Trades from 00:00-06:00
- `LTCUSDT_2025-06-20_00h_depth.jsonl` - Depth snapshots from 00:00-06:00
- `LTCUSDT_2025-06-20_06h_trades.csv` - Trades from 06:00-12:00

### File Rotation

- **Every 6 hours** by default (configurable)
- **100MB maximum** file size before rotation
- Files are automatically rotated to prevent excessive memory usage

## 📋 Data Formats

### Trade Data (CSV)

```csv
timestamp,price,quantity,side,tradeId
1672531200000,113.45,2.5,buy,12345
1672531201000,113.44,1.2,sell,12346
```

### Trade Data (JSON Lines)

```json
{"timestamp":1672531200000,"price":113.45,"quantity":2.5,"side":"buy","tradeId":"12345"}
{"timestamp":1672531201000,"price":113.44,"quantity":1.2,"side":"sell","tradeId":"12346"}
```

### Depth Data (CSV)

```csv
timestamp,side,level,price,quantity
1672531200000,bid,0,113.40,10.5
1672531200000,bid,1,113.39,5.2
1672531200000,ask,0,113.41,8.3
1672531200000,ask,1,113.42,6.1
```

### Depth Data (JSON Lines)

```json
{
    "timestamp": 1672531200000,
    "bids": [
        [113.4, 10.5],
        [113.39, 5.2]
    ],
    "asks": [
        [113.41, 8.3],
        [113.42, 6.1]
    ]
}
```

## ⚙️ Configuration

Configuration is in `config.json`:

```json
{
    "marketDataStorage": {
        "enabled": true,
        "dataDirectory": "./backtesting_data",
        "format": "both",
        "maxFileSize": 100,
        "depthLevels": 20,
        "rotationHours": 6,
        "compressionEnabled": false,
        "monitoringInterval": 30
    }
}
```

### Configuration Options

| Option               | Default                | Description                             |
| -------------------- | ---------------------- | --------------------------------------- |
| `enabled`            | `true`                 | Enable/disable data collection          |
| `dataDirectory`      | `"./backtesting_data"` | Storage directory path                  |
| `format`             | `"both"`               | Format: `"csv"`, `"jsonl"`, or `"both"` |
| `maxFileSize`        | `100`                  | Max file size in MB before rotation     |
| `depthLevels`        | `20`                   | Number of order book levels to store    |
| `rotationHours`      | `6`                    | Hours between file rotation             |
| `compressionEnabled` | `false`                | Enable file compression                 |
| `monitoringInterval` | `30`                   | Minutes between status logs             |

## 🔍 Monitoring

### HTTP Endpoints

**Storage Status:**

```bash
curl http://localhost:3000/market-data-storage
```

**Force Status Log:**

```bash
curl -X POST http://localhost:3000/market-data-storage/log-status
```

**General Stats (includes storage info):**

```bash
curl http://localhost:3000/stats
```

### Log Messages

The system logs periodic status updates:

```
Market Data Storage Status: Duration: 2h 15m, Trades: 45,231, Depth: 18,412, Size: 12.34 MB
```

## 📈 Data Usage

### For Backtesting

- Load historical trades and depth snapshots
- Replay market conditions at any speed
- Test detector configurations with real market data
- Analyze detector performance across different market conditions

### File Loading Examples

**Python:**

```python
import pandas as pd
import json

# Load trade data
trades = pd.read_csv('LTCUSDT_2025-06-20_00h_trades.csv')

# Load depth data (JSON Lines)
depth_snapshots = []
with open('LTCUSDT_2025-06-20_00h_depth.jsonl', 'r') as f:
    for line in f:
        depth_snapshots.append(json.loads(line))
```

**Node.js:**

```javascript
const fs = require("fs");
const csv = require("csv-parser");

// Load trade data
const trades = [];
fs.createReadStream("LTCUSDT_2025-06-20_00h_trades.csv")
    .pipe(csv())
    .on("data", (row) => trades.push(row));

// Load depth data
const depthData = fs
    .readFileSync("LTCUSDT_2025-06-20_00h_depth.jsonl", "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
```

## 🚨 Important Notes

### Storage Requirements

- **~500MB per day** estimated (varies with market activity)
- **3.5GB for 7 days** of continuous collection
- Files compress well if `compressionEnabled: true`

### Performance Impact

- **Minimal impact** on trading system performance
- Buffered writes every 1 second
- Automatic cleanup and rotation
- Circuit breaker protection for storage errors

### Data Quality

- **Every trade** is captured with precise timestamps
- **Depth snapshots** every 100-500ms (market dependent)
- **No data loss** during system restarts (buffered writes)
- **Atomic file operations** prevent corruption

## 🔧 Troubleshooting

### Common Issues

**Storage disabled:**

- Check `config.json` has `"enabled": true`
- Verify directory permissions
- Check logs for initialization errors

**Large files:**

- Reduce `maxFileSize` for more frequent rotation
- Enable `compressionEnabled: true`
- Reduce `depthLevels` if depth data is too large

**Missing data:**

- Check if system was running during expected time period
- Verify WebSocket connection health in logs
- Check file rotation boundaries

### Log Analysis

```bash
# Check storage initialization
grep "Market data storage" logs/app.log

# Monitor collection rates
grep "Market Data Storage Status" logs/app.log

# Check for errors
grep "Failed to store" logs/app.log
```

## 🎯 Next Steps

1. **Let it run for 7 days** to collect comprehensive dataset
2. **Analyze data quality** and coverage
3. **Develop backtesting framework** using collected data
4. **Optimize detector configurations** based on historical performance
5. **Create automated backtesting pipelines** for continuous optimization

This data collection enables evidence-based optimization of your trading detectors using real market conditions! 🚀

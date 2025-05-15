import pandas as pd
import sqlite3
from datetime import timedelta, datetime

# Constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
LOOKBACK_HOURS = 1
WINDOW_SECONDS = 300  # 5-minute window for price highs
IMBALANCE_SECONDS = 60  # 1-minute window for order book imbalance
REVERSAL_SECONDS = 60  # 1-minute window for price reversal
TIMESTAMP_TOLERANCE_SECONDS = 60  # Match signals within 60 seconds of true SHPs

def load_shp_data():
    shp_df = pd.read_csv(SHP_PATH)
    shp_df['high_time'] = pd.to_datetime(shp_df['high_time'])
    return shp_df

def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms')
    conn.close()
    return trades

def detect_shp(trades, window_seconds=300, imbalance_seconds=60, reversal_seconds=60):
    signals = []
    window_ms = window_seconds * 1000
    imbalance_ms = imbalance_seconds * 1000
    reversal_ms = reversal_seconds * 1000

    # Compute volume threshold (top 40% for volume spike)
    volume_threshold = trades['quantity'].quantile(0.6)

    for i in range(len(trades)):
        current_time = trades['tradeTime'].iloc[i]
        current_price = trades['price'].iloc[i]
        current_volume = trades['quantity'].iloc[i]

        # Define the window for detecting price highs
        window_start = current_time - timedelta(seconds=window_seconds // 2)
        window_end = current_time + timedelta(seconds=window_seconds // 2)
        window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] <= window_end)]

        if window_trades.empty:
            continue

        # Check if current price is the highest in the window
        max_price = window_trades['price'].max()
        if current_price != max_price:
            continue

        # Volume Spike: High volume at the peak (relaxed to top 40%)
        volume_spike = current_volume >= volume_threshold
        if not volume_spike:
            continue

        # Order Book Imbalance: Net buying/selling pressure in the last 1 minute
        imbalance_start = current_time - timedelta(seconds=imbalance_seconds)
        imbalance_trades = window_trades[(window_trades['tradeTime'] >= imbalance_start) & (window_trades['tradeTime'] <= current_time)]
        if imbalance_trades.empty:
            continue

        net_pressure = 0
        for _, trade in imbalance_trades.iterrows():
            if trade['isBuyerMaker']:  # Maker sell (taker buy, aggressive buying)
                net_pressure -= trade['quantity']
            else:  # Maker buy (taker sell, aggressive selling)
                net_pressure += trade['quantity']
        net_pressure_magnitude = abs(net_pressure)
        pressure_threshold = imbalance_trades['quantity'].sum() * 0.6  # Top 40% of total volume in the window
        strong_imbalance = net_pressure_magnitude >= pressure_threshold
        if not strong_imbalance:
            continue

        # Price Reversal: Price drops by 0.3% within the next 1 minute (relaxed from 0.5%)
        reversal_end = current_time + timedelta(seconds=reversal_seconds)
        reversal_trades = trades[(trades['tradeTime'] > current_time) & (trades['tradeTime'] <= reversal_end)]
        if reversal_trades.empty:
            continue

        min_price = reversal_trades['price'].min()
        price_drop = (current_price - min_price) / current_price
        reversal_confirmed = price_drop >= 0.003  # 0.3% drop
        if not reversal_confirmed:
            continue

        # If all conditions are met, emit a signal
        signals.append({
            'timestamp': current_time,
            'price': current_price,
            'net_pressure': net_pressure
        })

    return signals

def simulate_trade(signal, trades):
    entry_time = signal['timestamp']
    entry_price = signal['price']
    tp_threshold = entry_price * 0.98
    sl_threshold = entry_price * 1.005
    subsequent_trades = trades[trades['tradeTime'] > entry_time]
    if subsequent_trades.empty:
        return None
    for _, trade in subsequent_trades.iterrows():
        price = trade['price']
        if price <= tp_threshold:
            return {'Outcome': 'TP', 'ExitPrice': tp_threshold}
        if price >= sl_threshold:
            return {'Outcome': 'SL', 'ExitPrice': sl_threshold}
    return {'Outcome': 'Open', 'ExitPrice': subsequent_trades['price'].iloc[-1]}

if __name__ == '__main__':
    # Load SHP data
    shp_df = load_shp_data()
    true_positive_timestamps = shp_df['high_time'].tolist()
    print(f"Total SHP timestamps loaded: {len(true_positive_timestamps)}")
    print(f"Sample SHP timestamps: {true_positive_timestamps[:5]}")  # Print first 5 for verification

    # Load trades (last 1 hour)
    trades = load_trades()
    end_time = pd.to_datetime('2025-02-10 11:41:28')
    start_time = end_time - timedelta(hours=LOOKBACK_HOURS)
    trades_subset = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] <= end_time)]
    print(f"Trades in last 1 hour: {len(trades_subset)}")

    # Filter SHPs within the time range, considering tolerance
    adjusted_start_time = start_time - timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS)
    adjusted_end_time = end_time + timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS)
    true_positive_timestamps_subset = [
        tp for tp in true_positive_timestamps
        if adjusted_start_time <= tp <= adjusted_end_time
    ]
    print(f"Adjusted time range: {adjusted_start_time} to {adjusted_end_time}")
    print(f"SHP timestamps in subset: {true_positive_timestamps_subset}")

    # Detect SHPs
    signals = detect_shp(trades_subset)
    print(f"Detected SHP signals: {len(signals)}")

    # Validate against true SHPs
    true_positives = 0
    for signal in signals:
        timestamp = signal['timestamp']
        is_true_positive = any(
            timestamp - timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS) <= tp <= timestamp + timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS)
            for tp in true_positive_timestamps_subset
        )
        trade_result = simulate_trade(signal, trades_subset)
        outcome = trade_result['Outcome'] if trade_result else "Not Executed"
        if is_true_positive:
            true_positives += 1
            print(f"True Positive: {timestamp}, Outcome: {outcome}")
        else:
            print(f"False Positive: {timestamp}, Outcome: {outcome}")

    true_positive_rate = (true_positives / len(signals) * 100) if len(signals) > 0 else 0
    print(f"\nTrue Positives: {true_positives}/{len(signals)} ({true_positive_rate:.2f}%)")
    print(f"Total SHPs in subset: {len(true_positive_timestamps_subset)}")
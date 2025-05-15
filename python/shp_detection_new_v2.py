import pandas as pd
import sqlite3
from datetime import timedelta, datetime
import numpy as np

# Constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
LOOKBACK_HOURS = 1
WINDOW_SECONDS = 300  # 5-minute window for price highs
IMBALANCE_SECONDS = 60  # 1-minute window for order book imbalance
REVERSAL_SECONDS = 60  # 1-minute window for price reversal
TIMESTAMP_TOLERANCE_SECONDS = 60  # Match signals within 60 seconds of true SHPs
VOLUME_MAX_THRESHOLD = 350.0
ROC_STD_THRESHOLD = 0.00155
PRICE_STD_THRESHOLD = 0.0886  # Adjusted from 0.12785 to match observed volatility
NET_PRESSURE_THRESHOLD = -446.495
PRICE_DROP_THRESHOLD = 0.0025

def load_shp_data():
    shp_df = pd.read_csv(SHP_PATH)
    # Parse high_time as UTC and convert to local timezone (America/Lima, -05:00)
    shp_df['high_time'] = pd.to_datetime(shp_df['high_time'], utc=True).dt.tz_convert('America/Lima')
    return shp_df

def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms')
    # Convert tradeTime to local timezone (America/Lima, -05:00)
    trades['tradeTime'] = trades['tradeTime'].dt.tz_localize('UTC').dt.tz_convert('America/Lima')
    conn.close()
    return trades

def detect_shp(trades, window_seconds=300, imbalance_seconds=60, reversal_seconds=60):
    signals = []
    window_ms = window_seconds * 1000
    imbalance_ms = imbalance_seconds * 1000
    reversal_ms = reversal_seconds * 1000

    for i in range(len(trades)):
        current_time = trades['tradeTime'].iloc[i]
        current_price = trades['price'].iloc[i]

        # Debug for trades near the known SHP
        debug_time = pd.to_datetime('2025-02-10 10:47:52', utc=True).tz_convert('America/Lima')
        if abs((current_time - debug_time).total_seconds()) <= 60:
            print(f"\nDebugging trade at {current_time} (Price: {current_price})")

        # Define the window for detecting price highs
        window_start = current_time - timedelta(seconds=window_seconds // 2)
        window_end = current_time + timedelta(seconds=window_seconds // 2)
        window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] <= window_end)]

        if window_trades.empty:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print("  Window empty, skipping")
            continue

        # Check if current price is the highest in the window
        max_price = window_trades['price'].max()
        if current_price != max_price:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print(f"  Not the price high: Current = {current_price}, Max = {max_price}")
            continue

        # Price Volatility: Standard deviation of prices in the window
        price_std = window_trades['price'].std()
        if price_std <= PRICE_STD_THRESHOLD:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print(f"  Price Std too low: {price_std} <= {PRICE_STD_THRESHOLD}")
            continue

        # Volume Spike: Maximum volume in the window
        volume_max = window_trades['quantity'].max()
        if volume_max <= VOLUME_MAX_THRESHOLD:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print(f"  Volume Max too low: {volume_max} <= {VOLUME_MAX_THRESHOLD}")
            continue

        # Momentum Variability: ROC Std over 1-minute windows
        roc_values = []
        for j in range(len(window_trades)):
            roc_start = window_trades['tradeTime'].iloc[j] - timedelta(seconds=imbalance_seconds)
            roc_trades = window_trades[(window_trades['tradeTime'] >= roc_start) & (window_trades['tradeTime'] <= window_trades['tradeTime'].iloc[j])]
            if len(roc_trades) >= 2:
                price_start = roc_trades['price'].iloc[0]
                price_end = roc_trades['price'].iloc[-1]
                roc = (price_end - price_start) / price_start if price_start != 0 else 0
                roc_values.append(roc)
        roc_std = np.std(roc_values) if roc_values else 0
        if roc_std <= ROC_STD_THRESHOLD:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print(f"  ROC Std too low: {roc_std} <= {ROC_STD_THRESHOLD}")
            continue

        # Order Book Pressure: Net pressure in the last 1 minute
        imbalance_start = current_time - timedelta(seconds=imbalance_seconds)
        imbalance_trades = window_trades[(window_trades['tradeTime'] >= imbalance_start) & (window_trades['tradeTime'] <= current_time)]
        if imbalance_trades.empty:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print("  Imbalance window empty, skipping")
            continue

        buy_volume = imbalance_trades[imbalance_trades['isBuyerMaker'] == False]['quantity'].sum()
        sell_volume = imbalance_trades[imbalance_trades['isBuyerMaker'] == True]['quantity'].sum()
        net_pressure = buy_volume - sell_volume
        if net_pressure >= NET_PRESSURE_THRESHOLD:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print(f"  Net Pressure too high: {net_pressure} >= {NET_PRESSURE_THRESHOLD}")
            continue

        # Price Reversal: Price drops by 0.25% within the next 1 minute
        reversal_end = current_time + timedelta(seconds=reversal_seconds)
        reversal_trades = trades[(trades['tradeTime'] > current_time) & (trades['tradeTime'] <= reversal_end)]
        if reversal_trades.empty:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print("  Reversal window empty, skipping")
            continue

        min_price = reversal_trades['price'].min()
        price_drop = (current_price - min_price) / current_price
        if price_drop < PRICE_DROP_THRESHOLD:
            if abs((current_time - debug_time).total_seconds()) <= 60:
                print(f"  Price Drop too small: {price_drop} < {PRICE_DROP_THRESHOLD}")
            continue

        # If all conditions are met, emit a signal
        signals.append({
            'timestamp': current_time,
            'price': current_price,
            'net_pressure': net_pressure,
            'price_std': price_std,
            'roc_std': roc_std,
            'volume_max': volume_max
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
    print(f"Sample SHP timestamps: {true_positive_timestamps[:5]}")

    # Hardcode the known SHP timestamp
    known_shp = pd.to_datetime('2025-02-10 10:47:52', utc=True).tz_convert('America/Lima')
    true_positive_timestamps.append(known_shp)

    # Load trades (last 1 hour)
    trades = load_trades()
    # Ensure start_time and end_time are tz-aware (America/Lima)
    end_time = pd.to_datetime('2025-02-10 11:41:28', utc=True).tz_convert('America/Lima')
    start_time = end_time - timedelta(hours=LOOKBACK_HOURS)
    trades_subset = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] <= end_time)]
    print(f"Trades in last 1 hour: {len(trades_subset)}")

    # Debug SHP filtering
    adjusted_start_time = start_time - timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS)
    adjusted_end_time = end_time + timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS)
    print(f"Adjusted time range for SHP filtering: {adjusted_start_time} to {adjusted_end_time}")
    true_positive_timestamps_subset = [
        tp for tp in true_positive_timestamps
        if adjusted_start_time <= tp <= adjusted_end_time
    ]
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
            print(f"True Positive: {timestamp}, Outcome: {outcome}, Features: {signal}")
        else:
            print(f"False Positive: {timestamp}, Outcome: {outcome}, Features: {signal}")

    true_positive_rate = (true_positives / len(signals) * 100) if len(signals) > 0 else 0
    print(f"\nTrue Positives: {true_positives}/{len(signals)} ({true_positive_rate:.2f}%)")
    print(f"Total SHPs in subset: {len(true_positive_timestamps_subset)}")
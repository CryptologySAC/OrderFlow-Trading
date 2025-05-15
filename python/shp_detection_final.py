import pandas as pd
import sqlite3
from datetime import timedelta, datetime
import numpy as np
import multiprocessing as mp
from functools import partial

# Constants
DB_PATH = '../trades.db'
WINDOW_SECONDS = 60  # ±30 seconds for detection lookback
IMBALANCE_SECONDS = 60
TIMESTAMP_TOLERANCE_SECONDS = 60
COOLDOWN_SECONDS = 300  # 300-second cooldown to ensure one signal per event
VOLUME_MAX_THRESHOLD = 85
VOLUME_MAX_UPPER = 150
ROC_STD_THRESHOLD = 0.0005
ROC_STD_UPPER = 0.00148
PRICE_STD_THRESHOLD = 0.05
PRICE_STD_UPPER = 0.11
NET_PRESSURE_THRESHOLD = -30
NET_PRESSURE_UPPER = -180

def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms', utc=True).dt.tz_convert('America/Lima')
    conn.close()
    return trades

def detect_shp(indices, trades, window_seconds=60, imbalance_seconds=60):
    signals = []
    window_ms = window_seconds * 1000
    imbalance_ms = imbalance_seconds * 1000

    for i in indices:
        current_time = trades['tradeTime'].iloc[i]
        current_price = trades['price'].iloc[i]

        # Lookback window to analyze order flow
        window_start = current_time - timedelta(seconds=window_seconds)
        window_end = current_time
        window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] <= window_end)]

        if window_trades.empty:
            continue

        # Leading indicators for predictive SHP detection
        price_std = window_trades['price'].std()
        if not (PRICE_STD_THRESHOLD < price_std < PRICE_STD_UPPER):
            continue

        volume_max = window_trades['quantity'].max()
        if not (VOLUME_MAX_THRESHOLD < volume_max < VOLUME_MAX_UPPER):
            continue

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
        if not (ROC_STD_THRESHOLD < roc_std < ROC_STD_UPPER):
            continue

        imbalance_start = current_time - timedelta(seconds=imbalance_seconds)
        imbalance_trades = window_trades[(window_trades['tradeTime'] >= imbalance_start) & (window_trades['tradeTime'] <= current_time)]
        if imbalance_trades.empty:
            continue

        buy_volume = imbalance_trades[imbalance_trades['isBuyerMaker'] == False]['quantity'].sum()
        sell_volume = imbalance_trades[imbalance_trades['isBuyerMaker'] == True]['quantity'].sum()
        net_pressure = buy_volume - sell_volume
        if not (NET_PRESSURE_UPPER < net_pressure < NET_PRESSURE_THRESHOLD):
            continue

        # Signal detected based on leading indicators
        signals.append({
            'timestamp': current_time,
            'price': current_price,
            'net_pressure': net_pressure,
            'price_std': price_std,
            'roc_std': roc_std,
            'volume_max': volume_max
        })

    return signals

def split_indices(n, num_chunks, overlap=30):
    chunk_size = n // num_chunks
    indices = []
    for i in range(num_chunks):
        start = max(0, i * chunk_size - overlap)
        end = min(n, (i + 1) * chunk_size + overlap if i < num_chunks - 1 else n)
        chunk_indices = list(range(start, end))
        indices.append(chunk_indices)
    return indices

if __name__ == '__main__':
    # Load trades (full 10% subset)
    trades = load_trades()
    start_time = pd.to_datetime('2025-01-31 21:37:27', utc=True).tz_convert('America/Lima')
    end_time = pd.to_datetime('2025-02-10 11:41:28', utc=True).tz_convert('America/Lima')
    trades_subset = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] <= end_time)]
    print(f"Trades in 10% subset: {len(trades_subset)}")

    # Hardcode SHP timestamps (to be replaced with full list)
    true_positive_timestamps = [pd.to_datetime('2025-02-10 10:47:52', utc=True).tz_convert('America/Lima')]
    np.random.seed(42)
    for _ in range(110):
        while True:
            random_time = start_time + timedelta(seconds=np.random.randint(0, (end_time - start_time).total_seconds()))
            too_close = any(abs((random_time - shp).total_seconds()) < 300 for shp in true_positive_timestamps)
            if not too_close:
                true_positive_timestamps.append(random_time)
                break

    # Determine number of processes (use CPU count)
    num_processes = mp.cpu_count()
    print(f"Using {num_processes} processes for parallel execution.")

    # Split indices into chunks with overlap
    indices = split_indices(len(trades_subset), num_processes, overlap=30)

    # Create a partial function to pass trades to detect_shp
    detect_shp_partial = partial(detect_shp, trades=trades_subset)

    # Run detection in parallel
    with mp.Pool(processes=num_processes) as pool:
        results = pool.map(detect_shp_partial, indices)

    # Combine signals and apply cooldown to ensure one signal per event
    all_signals = []
    seen_timestamps = []
    for chunk_signals in results:
        for signal in chunk_signals:
            timestamp = signal['timestamp']
            # Check if this signal is within the cooldown period of a previous signal
            is_within_cooldown = False
            for seen_ts in seen_timestamps:
                if abs((timestamp - seen_ts).total_seconds()) <= COOLDOWN_SECONDS:
                    is_within_cooldown = True
                    break
            if not is_within_cooldown:
                seen_timestamps.append(timestamp)
                all_signals.append(signal)

    print(f"Detected SHP signals: {len(all_signals)}")

    # Validate against true SHPs
    true_positives = 0
    false_positives = 0
    total_shps = len(true_positive_timestamps)
    total_non_shps = len(trades_subset) - total_shps
    for signal in all_signals:
        timestamp = signal['timestamp']
        is_true_positive = any(
            timestamp - timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS) <= tp <= timestamp + timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS)
            for tp in true_positive_timestamps
        )
        if is_true_positive:
            true_positives += 1
            print(f"True Positive: {timestamp}, Features: {signal}")
        else:
            false_positives += 1
            print(f"False Positive: {timestamp}, Features: {signal}")

    tpr = (true_positives / total_shps * 100) if total_shps > 0 else 0
    fpr = (false_positives / total_non_shps * 100) if total_non_shps > 0 else 0
    print(f"\nTrue Positives: {true_positives}/{total_shps} ({tpr:.2f}%)")
    print(f"False Positives: {false_positives}/{total_non_shps} ({fpr:.2f}%)")
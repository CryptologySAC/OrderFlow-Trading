import pandas as pd
import sqlite3
from datetime import timedelta, datetime
import numpy as np

# Constants
DB_PATH = '../trades.db'
WINDOW_SECONDS = 300  # 5-minute window
IMBALANCE_SECONDS = 60  # 1-minute window for net pressure and ROC

def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms')
    trades['tradeTime'] = trades['tradeTime'].dt.tz_localize('UTC').dt.tz_convert('America/Lima')
    conn.close()
    return trades

def compute_features(trades, center_time):
    window_start = center_time - timedelta(seconds=WINDOW_SECONDS // 2)
    window_end = center_time + timedelta(seconds=WINDOW_SECONDS // 2)
    window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] <= window_end)]

    if window_trades.empty:
        return None

    # Price Statistics
    price_std = window_trades['price'].std()
    price_max = window_trades['price'].max()

    # Volume Statistics
    volume_max = window_trades['quantity'].max()

    # Momentum Variability: ROC Std over 1-minute windows
    roc_values = []
    for j in range(len(window_trades)):
        roc_start = window_trades['tradeTime'].iloc[j] - timedelta(seconds=IMBALANCE_SECONDS)
        roc_trades = window_trades[(window_trades['tradeTime'] >= roc_start) & (window_trades['tradeTime'] <= window_trades['tradeTime'].iloc[j])]
        if len(roc_trades) >= 2:
            price_start = roc_trades['price'].iloc[0]
            price_end = roc_trades['price'].iloc[-1]
            roc = (price_end - price_start) / price_start if price_start != 0 else 0
            roc_values.append(roc)
    roc_std = np.std(roc_values) if roc_values else 0

    # Order Book Pressure: Net pressure in the last 1 minute before center_time
    imbalance_start = center_time - timedelta(seconds=IMBALANCE_SECONDS)
    imbalance_trades = window_trades[(window_trades['tradeTime'] >= imbalance_start) & (window_trades['tradeTime'] <= center_time)]
    if imbalance_trades.empty:
        return None
    buy_volume = imbalance_trades[imbalance_trades['isBuyerMaker'] == False]['quantity'].sum()
    sell_volume = imbalance_trades[imbalance_trades['isBuyerMaker'] == True]['quantity'].sum()
    net_pressure = buy_volume - sell_volume

    return {
        'center_time': center_time,
        'price_std': price_std,
        'price_max': price_max,
        'volume_max': volume_max,
        'roc_std': roc_std,
        'net_pressure': net_pressure
    }

if __name__ == '__main__':
    # Load trades (full 10% subset)
    trades = load_trades()
    start_time = pd.to_datetime('2025-01-31 21:37:27', utc=True).tz_convert('America/Lima')
    end_time = pd.to_datetime('2025-02-10 11:41:28', utc=True).tz_convert('America/Lima')
    trades_subset = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] <= end_time)]
    print(f"Trades in 10% subset: {len(trades_subset)}")

    # Hardcode SHP timestamps (to be replaced with full list)
    shp_timestamps = [pd.to_datetime('2025-02-10 10:47:52', utc=True).tz_convert('America/Lima')]
    # Simulate additional SHPs (111 total, use random timestamps for now)
    np.random.seed(42)
    for _ in range(110):  # 111 total SHPs - 1 hardcoded
        while True:
            random_time = start_time + timedelta(seconds=np.random.randint(0, (end_time - start_time).total_seconds()))
            too_close = any(abs((random_time - shp).total_seconds()) < 300 for shp in shp_timestamps)
            if not too_close:
                shp_timestamps.append(random_time)
                break
    print(f"SHP timestamps: {len(shp_timestamps)}")

    # Compute features for SHP windows
    shp_features = []
    for shp_time in shp_timestamps:
        features = compute_features(trades_subset, shp_time)
        if features:
            features['label'] = 'SHP'
            shp_features.append(features)

    # Compute features for non-SHP windows
    non_shp_timestamps = []
    for _ in range(len(shp_timestamps)):
        while True:
            random_time = start_time + timedelta(seconds=np.random.randint(0, (end_time - start_time).total_seconds()))
            too_close = any(abs((random_time - shp).total_seconds()) < 300 for shp in shp_timestamps)
            if not too_close:
                non_shp_timestamps.append(random_time)
                break

    non_shp_features = []
    for non_shp_time in non_shp_timestamps:
        features = compute_features(trades_subset, non_shp_time)
        if features:
            features['label'] = 'Non-SHP'
            non_shp_features.append(features)

    # Combine and analyze
    all_features = pd.DataFrame(shp_features + non_shp_features)
    print("\nFeature Statistics:")
    print(all_features.groupby('label').mean())
    print("\nFeature Std Dev:")
    print(all_features.groupby('label').std())
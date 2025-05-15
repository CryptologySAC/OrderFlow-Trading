import pandas as pd
import sqlite3
from datetime import datetime, timedelta
import numpy as np

# Constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
WINDOW_MINUTES = 10

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

def analyze_window(trades, start_time, end_time, label):
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] <= end_time)]
    if window_trades.empty:
        return None

    # Feature Extraction
    # 1. Price Statistics
    price_mean = window_trades['price'].mean()
    price_std = window_trades['price'].std()
    price_max = window_trades['price'].max()
    price_min = window_trades['price'].min()
    price_range = price_max - price_min

    # 2. Volume Statistics
    volume_mean = window_trades['quantity'].mean()
    volume_total = window_trades['quantity'].sum()
    volume_max = window_trades['quantity'].max()

    # 3. Order Flow (isBuyerMaker)
    buy_volume = window_trades[window_trades['isBuyerMaker'] == False]['quantity'].sum()  # Taker buys
    sell_volume = window_trades[window_trades['isBuyerMaker'] == True]['quantity'].sum()  # Taker sells
    net_pressure = buy_volume - sell_volume
    imbalance_ratio = net_pressure / volume_total if volume_total > 0 else 0

    # 4. Price Momentum (Rate of Change over 1-minute windows)
    roc_values = []
    for i in range(len(window_trades)):
        start = window_trades['tradeTime'].iloc[i] - timedelta(seconds=60)
        roc_trades = window_trades[(window_trades['tradeTime'] >= start) & (window_trades['tradeTime'] <= window_trades['tradeTime'].iloc[i])]
        if len(roc_trades) >= 2:
            price_start = roc_trades['price'].iloc[0]
            price_end = roc_trades['price'].iloc[-1]
            roc = (price_end - price_start) / price_start if price_start != 0 else 0
            roc_values.append(roc)
    roc_mean = np.mean(roc_values) if roc_values else 0
    roc_std = np.std(roc_values) if roc_values else 0

    return {
        'label': label,
        'num_trades': len(window_trades),
        'price_mean': price_mean,
        'price_std': price_std,
        'price_range': price_range,
        'volume_mean': volume_mean,
        'volume_total': volume_total,
        'volume_max': volume_max,
        'buy_volume': buy_volume,
        'sell_volume': sell_volume,
        'net_pressure': net_pressure,
        'imbalance_ratio': imbalance_ratio,
        'roc_mean': roc_mean,
        'roc_std': roc_std
    }

if __name__ == '__main__':
    # Load data
    shp_df = load_shp_data()
    trades = load_trades()

    # Define windows
    shp_time = pd.to_datetime('2025-02-10 10:47:52')
    shp_start = shp_time - timedelta(minutes=WINDOW_MINUTES // 2)
    shp_end = shp_time + timedelta(minutes=WINDOW_MINUTES // 2)

    non_shp_start = pd.to_datetime('2025-02-10 11:00:00')
    non_shp_end = non_shp_start + timedelta(minutes=WINDOW_MINUTES)

    # Analyze windows
    shp_features = analyze_window(trades, shp_start, shp_end, 'SHP')
    non_shp_features = analyze_window(trades, non_shp_start, non_shp_end, 'Non-SHP')

    # Compare features
    print("Feature Comparison:")
    print("=================")
    print("SHP Window (2025-02-10 10:42:52 to 2025-02-10 10:52:52):")
    print(shp_features)
    print("\nNon-SHP Window (2025-02-10 11:00:00 to 2025-02-10 11:10:00):")
    print(non_shp_features)

    # Identify distinguishing features
    print("\nDifferences:")
    for key in shp_features.keys():
        if key == 'label' or key == 'num_trades':
            continue
        shp_value = shp_features[key]
        non_shp_value = non_shp_features[key]
        diff = abs(shp_value - non_shp_value)
        rel_diff = diff / abs(non_shp_value) * 100 if non_shp_value != 0 else float('inf')
        print(f"{key}: SHP = {shp_value:.4f}, Non-SHP = {non_shp_value:.4f}, Relative Diff = {rel_diff:.2f}%")
import pandas as pd
import sqlite3
import numpy as np
from datetime import timedelta
from multiprocessing import Pool
from functools import partial

# Define global constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
NUM_PROCESSES = 8
WINDOW_SECONDS = 300  # 5 minutes before SHP for large trade check
PATTERN_WINDOW_SECONDS = 30  # 30 seconds for volume ratio pattern
VOLUME_RATIO_THRESHOLD = 1.5  # Sell volume / Buy volume > 1.5

# Load SHP data
def load_shp_data():
    shp_df = pd.read_csv(SHP_PATH)
    shp_df['high_time'] = pd.to_datetime(shp_df['high_time'])
    return shp_df

# Load trade data
def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms')
    trades['usdt_value'] = trades['quantity'] * trades['price']  # Compute USDT value
    conn.close()
    return trades

# Calculate the 99th percentile thresholds
def calculate_thresholds(trades):
    quantity_threshold = np.percentile(trades['quantity'], 99)
    usdt_value_threshold = np.percentile(trades['usdt_value'], 99)
    return quantity_threshold, usdt_value_threshold

# Analyze trades before a single SHP
def analyze_shp(shp_row, trades, quantity_threshold, usdt_value_threshold):
    high_time = shp_row['high_time']
    start_time = high_time - timedelta(seconds=WINDOW_SECONDS)
    pattern_start_time = high_time - timedelta(seconds=PATTERN_WINDOW_SECONDS)

    # Extract trades within the 300-second window for large trade check
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] < high_time)]
    if window_trades.empty:
        return None

    # Extract trades within the 30-second window for volume ratio pattern
    pattern_window_trades = trades[(trades['tradeTime'] >= pattern_start_time) & (trades['tradeTime'] < high_time)]
    if pattern_window_trades.empty:
        return None

    # Check for large trades (>99th percentile) in the 300-second window
    large_trades_quantity = window_trades[window_trades['quantity'] > quantity_threshold]
    large_trades_usdt = window_trades[window_trades['usdt_value'] > usdt_value_threshold]
    has_large_trade_quantity = not large_trades_quantity.empty
    has_large_trade_usdt = not large_trades_usdt.empty
    num_large_trades_quantity = len(large_trades_quantity)
    num_large_trades_usdt = len(large_trades_usdt)

    # Compute sell/buy volume ratio in the 30-second window
    buy_volume = pattern_window_trades[pattern_window_trades['isBuyerMaker'] == 0]['quantity'].sum()
    sell_volume = pattern_window_trades[pattern_window_trades['isBuyerMaker'] == 1]['quantity'].sum()
    volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')
    volume_ratio_exceeded = volume_ratio > VOLUME_RATIO_THRESHOLD

    # Check patterns
    pattern_matched_quantity = volume_ratio_exceeded and has_large_trade_quantity
    pattern_matched_usdt = volume_ratio_exceeded and has_large_trade_usdt

    return {
        'high_time': high_time,
        'volume_ratio': volume_ratio,
        'volume_ratio_exceeded': volume_ratio_exceeded,
        'has_large_trade_quantity': has_large_trade_quantity,
        'num_large_trades_quantity': num_large_trades_quantity,
        'has_large_trade_usdt': has_large_trade_usdt,
        'num_large_trades_usdt': num_large_trades_usdt,
        'pattern_matched_quantity': pattern_matched_quantity,
        'pattern_matched_usdt': pattern_matched_usdt
    }

# Test pattern across the entire database using time-based windows
def test_pattern(params, trades, shp_df, quantity_threshold, usdt_value_threshold):
    chunk_start, chunk_size = params
    chunk = trades.iloc[chunk_start:chunk_start + chunk_size]
    chunk = chunk.reset_index(drop=True)  # Reset index for consistent slicing

    occurrences_quantity = 0
    false_positives_quantity = 0
    occurrences_usdt = 0
    false_positives_usdt = 0

    i = 0
    while i < len(chunk):
        end_time = chunk['tradeTime'].iloc[i]
        pattern_start_time = end_time - timedelta(seconds=PATTERN_WINDOW_SECONDS)
        large_trade_start_time = end_time - timedelta(seconds=WINDOW_SECONDS)

        # Extract trades for large trade check (300 seconds)
        large_trade_window = chunk[(chunk['tradeTime'] >= large_trade_start_time) & (chunk['tradeTime'] < end_time)]
        if len(large_trade_window) < 10:  # Ensure enough trades
            i += 1
            continue

        # Extract trades for volume ratio pattern (30 seconds)
        pattern_window = chunk[(chunk['tradeTime'] >= pattern_start_time) & (chunk['tradeTime'] < end_time)]
        if len(pattern_window) < 5:  # Ensure enough trades
            i += 1
            continue

        # Check for large trades
        large_trades_quantity = large_trade_window[large_trade_window['quantity'] > quantity_threshold]
        large_trades_usdt = large_trade_window[large_trade_window['usdt_value'] > usdt_value_threshold]
        has_large_trade_quantity = not large_trades_quantity.empty
        has_large_trade_usdt = not large_trades_usdt.empty

        # Compute sell/buy volume ratio
        buy_volume = pattern_window[pattern_window['isBuyerMaker'] == 0]['quantity'].sum()
        sell_volume = pattern_window[pattern_window['isBuyerMaker'] == 1]['quantity'].sum()
        volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')
        volume_ratio_exceeded = volume_ratio > VOLUME_RATIO_THRESHOLD

        # Check patterns
        if volume_ratio_exceeded and has_large_trade_quantity:
            occurrences_quantity += 1
            future_window = trades[(trades['tradeTime'] >= end_time) & (trades['tradeTime'] <= end_time + timedelta(seconds=300))]
            if len(future_window) < 1740:
                i += 1
                continue
            max_price_idx = future_window['price'].idxmax()
            max_price = future_window['price'].loc[max_price_idx]
            future_after_max = future_window[future_window.index > max_price_idx]
            if future_after_max.empty:
                i += 1
                continue
            min_price_after = future_after_max['price'].min()
            drop_pct = (max_price - min_price_after) / max_price
            shp_match = shp_df[(shp_df['high_time'] >= end_time) & 
                              (shp_df['high_time'] <= end_time + timedelta(seconds=300)) & 
                              (shp_df['high_price'] == max_price)]
            if shp_match.empty and drop_pct < 0.02:
                false_positives_quantity += 1

        if volume_ratio_exceeded and has_large_trade_usdt:
            occurrences_usdt += 1
            if len(future_window) < 1740:
                i += 1
                continue
            if shp_match.empty and drop_pct < 0.02:
                false_positives_usdt += 1

        # Move to the next window (slide by 1 trade)
        i += 1

    return occurrences_quantity, false_positives_quantity, occurrences_usdt, false_positives_usdt

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()

    # Calculate 99th percentile thresholds
    quantity_threshold, usdt_value_threshold = calculate_thresholds(trades)
    print(f"99th Percentile Quantity Threshold: {quantity_threshold}")
    print(f"99th Percentile USDT Value Threshold: {usdt_value_threshold}")

    # Analyze pattern before SHPs
    with Pool(processes=NUM_PROCESSES) as pool:
        analyze_shp_with_data = partial(analyze_shp, trades=trades, quantity_threshold=quantity_threshold, usdt_value_threshold=usdt_value_threshold)
        shp_results = pool.map(analyze_shp_with_data, shp_df.to_dict('records'))

    # Filter out None results
    shp_results = [r for r in shp_results if r is not None]
    shp_results_df = pd.DataFrame(shp_results)

    # Summarize pattern presence
    print("\nPattern Analysis Before SHPs (Window: 30 seconds for Volume Ratio, 300 seconds for Large Trades):")
    pattern_presence_quantity = shp_results_df['pattern_matched_quantity'].mean() * 100
    pattern_presence_usdt = shp_results_df['pattern_matched_usdt'].mean() * 100
    volume_ratio_presence = shp_results_df['volume_ratio_exceeded'].mean() * 100
    large_trade_quantity_presence = shp_results_df['has_large_trade_quantity'].mean() * 100
    large_trade_usdt_presence = shp_results_df['has_large_trade_usdt'].mean() * 100
    print(f"Pattern (Volume Ratio > {VOLUME_RATIO_THRESHOLD} AND Has Large Trade by Quantity): {pattern_presence_quantity:.2f}% of SHPs")
    print(f"Pattern (Volume Ratio > {VOLUME_RATIO_THRESHOLD} AND Has Large Trade by USDT Value): {pattern_presence_usdt:.2f}% of SHPs")
    print(f"Volume Ratio > {VOLUME_RATIO_THRESHOLD}: {volume_ratio_presence:.2f}% of SHPs")
    print(f"Has Large Trade (>99th Percentile Quantity): {large_trade_quantity_presence:.2f}% of SHPs")
    print(f"Has Large Trade (>99th Percentile USDT Value): {large_trade_usdt_presence:.2f}% of SHPs")

    # Test pattern across the entire database
    chunk_size = len(trades) // NUM_PROCESSES
    chunk_starts = list(range(0, len(trades), chunk_size))
    params = [(start, min(chunk_size, len(trades) - start)) for start in chunk_starts]

    with Pool(processes=NUM_PROCESSES) as pool:
        test_pattern_with_data = partial(test_pattern, trades=trades, shp_df=shp_df, quantity_threshold=quantity_threshold, usdt_value_threshold=usdt_value_threshold)
        results = pool.map(test_pattern_with_data, params)

    total_occurrences_quantity = sum(r[0] for r in results)
    total_false_positives_quantity = sum(r[1] for r in results)
    total_occurrences_usdt = sum(r[2] for r in results)
    total_false_positives_usdt = sum(r[3] for r in results)
    false_positive_rate_quantity = (total_false_positives_quantity / total_occurrences_quantity) * 100 if total_occurrences_quantity > 0 else 0.0
    false_positive_rate_usdt = (total_false_positives_usdt / total_occurrences_usdt) * 100 if total_occurrences_usdt > 0 else 0.0

    print(f"\nPattern Specificity Across Database (Volume Ratio > {VOLUME_RATIO_THRESHOLD} AND Has Large Trade by Quantity):")
    print(f"Total Occurrences: {total_occurrences_quantity}")
    print(f"False Positives (No SHP): {total_false_positives_quantity}")
    print(f"False Positive Rate: {false_positive_rate_quantity:.2f}%")

    print(f"\nPattern Specificity Across Database (Volume Ratio > {VOLUME_RATIO_THRESHOLD} AND Has Large Trade by USDT Value):")
    print(f"Total Occurrences: {total_occurrences_usdt}")
    print(f"False Positives (No SHP): {total_false_positives_usdt}")
    print(f"False Positive Rate: {false_positive_rate_usdt:.2f}%")
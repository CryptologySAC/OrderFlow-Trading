import pandas as pd
import sqlite3
import numpy as np
from datetime import timedelta
from multiprocessing import Pool
from functools import partial

# Define global constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
ROLLING_WINDOW_SECONDS = 3600  # 1 hour for rolling window
WINDOW_SECONDS = 300  # 5 minutes for context
IMMEDIATE_WINDOW_SECONDS = 30  # 30 seconds for immediate conditions
VOLUME_RATIO_THRESHOLD = 0.8  # Adjusted to 0.8
CUMULATIVE_DELTA_THRESHOLD = -5000  # Adjusted to -5000 USDT
NUM_PROCESSES = 8

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
    trades['usdt_value'] = trades['quantity'] * trades['price']
    conn.close()
    return trades

# Compute average SELL LT quantities for SHPs in a rolling window
def compute_rolling_sell_quantities(shp_df, trades, rolling_end_time, quantity_threshold):
    start_time = rolling_end_time - timedelta(seconds=ROLLING_WINDOW_SECONDS)
    # Extract SHPs within the rolling window
    window_shps = shp_df[(shp_df['high_time'] >= start_time) & (shp_df['high_time'] <= rolling_end_time)]
    avg_sell_quantities = []

    for _, shp_row in window_shps.iterrows():
        high_time = shp_row['high_time']
        window_start = high_time - timedelta(seconds=WINDOW_SECONDS)
        window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] < high_time)]
        if window_trades.empty:
            continue

        # Identify large trades using the provided quantity threshold
        large_trades = window_trades[window_trades['quantity'] > quantity_threshold]
        if large_trades.empty:
            continue

        # Compute average SELL LT quantity
        sell_lts = large_trades[large_trades['isBuyerMaker'] == 1]
        if sell_lts.empty:
            continue
        avg_sell_quantity = sell_lts['quantity'].mean()
        avg_sell_quantities.append(avg_sell_quantity)

    # Compute 25th percentile
    if avg_sell_quantities:
        return np.percentile(avg_sell_quantities, 25)
    return np.inf  # Default to a high value if no data

# Analyze the latest SELL LT before a single SHP (function for parallel processing)
def analyze_shp(shp_row, trades, shp_df):
    high_time = shp_row['high_time']
    start_time = high_time - timedelta(seconds=WINDOW_SECONDS)

    # Extract trades within the 300-second window
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] < high_time)]
    if window_trades.empty:
        return None

    # Compute the 99th percentile quantity threshold in the rolling window ending at high_time
    rolling_start_time = high_time - timedelta(seconds=ROLLING_WINDOW_SECONDS)
    rolling_window_trades = trades[(trades['tradeTime'] >= rolling_start_time) & (trades['tradeTime'] <= high_time)]
    if rolling_window_trades.empty:
        return None
    quantity_threshold = np.percentile(rolling_window_trades['quantity'], 99)

    # Identify large trades using the rolling window threshold
    large_trades = window_trades[window_trades['quantity'] > quantity_threshold]
    if large_trades.empty:
        return None

    # Separate BUY and SELL large trades
    sell_lts = large_trades[large_trades['isBuyerMaker'] == 1]
    if sell_lts.empty:
        return None

    # Get the latest SELL LT
    latest_sell_lt = sell_lts.iloc[-1]
    sell_lt_time = latest_sell_lt['tradeTime']
    sell_lt_quantity = latest_sell_lt['quantity']

    # Compute the 25th percentile SELL LT quantity threshold in the rolling window ending at high_time
    sell_quantity_threshold = compute_rolling_sell_quantities(shp_df, trades, high_time, quantity_threshold)

    # Immediate window (30 seconds prior to the SELL LT)
    immediate_start_time = sell_lt_time - timedelta(seconds=IMMEDIATE_WINDOW_SECONDS)
    immediate_window = window_trades[(window_trades['tradeTime'] >= immediate_start_time) & (window_trades['tradeTime'] <= sell_lt_time)]

    # Volume ratio in the 30-second window
    buy_volume = immediate_window[immediate_window['isBuyerMaker'] == 0]['quantity'].sum()
    sell_volume = immediate_window[immediate_window['isBuyerMaker'] == 1]['quantity'].sum()
    volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')

    # Cumulative delta in the 300-second window prior to the SELL LT
    context_window = window_trades[window_trades['tradeTime'] <= sell_lt_time]
    buy_value = (context_window[context_window['isBuyerMaker'] == 0]['quantity'] * context_window[context_window['isBuyerMaker'] == 0]['price']).sum()
    sell_value = (context_window[context_window['isBuyerMaker'] == 1]['quantity'] * context_window[context_window['isBuyerMaker'] == 1]['price']).sum()
    cumulative_delta = buy_value - sell_value

    # Check the refined pattern with adjusted conditions
    matches_pattern = (
        sell_lt_quantity > sell_quantity_threshold and
        volume_ratio > VOLUME_RATIO_THRESHOLD and
        cumulative_delta < CUMULATIVE_DELTA_THRESHOLD
    )

    return {
        'high_time': high_time,
        'matches_pattern': matches_pattern,
        'sell_lt_quantity': sell_lt_quantity,
        'volume_ratio': volume_ratio,
        'cumulative_delta': cumulative_delta,
        'quantity_threshold': quantity_threshold,
        'sell_quantity_threshold': sell_quantity_threshold
    }

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()

    # Analyze the refined pattern for each SHP using multiprocessing
    with Pool(processes=NUM_PROCESSES) as pool:
        analyze_shp_with_data = partial(analyze_shp, trades=trades, shp_df=shp_df)
        results = pool.map(analyze_shp_with_data, [row for _, row in shp_df.iterrows()])

    # Filter out None results
    results = [r for r in results if r is not None]

    # Convert results to DataFrame
    results_df = pd.DataFrame(results)

    # Save to CSV
    results_df.to_csv('shp_refined_pattern_analysis_rolling_parallel_further_adjusted.csv', index=False)
    print("Analysis saved to 'shp_refined_pattern_analysis_rolling_parallel_further_adjusted.csv'.")

    # Compute and print summary statistics
    print("\nSummary Statistics:")
    print(f"Total SHPs Analyzed: {len(results_df)}")
    print(f"Number of SHPs Matching Refined Pattern: {results_df['matches_pattern'].sum()}")
    print(f"Presence Rate (%): {results_df['matches_pattern'].mean() * 100:.2f}%")
    print(f"Mean 99th Percentile Quantity Threshold: {results_df['quantity_threshold'].mean():.2f}")
    print(f"Mean 25th Percentile SELL LT Quantity Threshold: {results_df['sell_quantity_threshold'].mean():.2f}")
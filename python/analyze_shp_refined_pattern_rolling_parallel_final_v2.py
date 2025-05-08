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
CUMULATIVE_DELTA_THRESHOLD = 0  # Adjusted to 0 USDT
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

# Compute static 10th percentile of average SELL LT quantities across all SHPs
def compute_static_sell_quantity_threshold(shp_df, trades, quantity_threshold):
    avg_sell_quantities = []

    for _, shp_row in shp_df.iterrows():
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

    # Compute 10th percentile
    if avg_sell_quantities:
        return np.percentile(avg_sell_quantities, 10)
    return np.inf  # Default to a high value if no data

# Analyze the latest SELL LT before a single SHP (function for parallel processing)
def analyze_shp(shp_row, trades, sell_quantity_threshold):
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

    # Separate SELL large trades
    sell_lts = large_trades[large_trades['isBuyerMaker'] == 1]
    if sell_lts.empty:
        return None

    # Get the latest SELL LT
    latest_sell_lt = sell_lts.iloc[-1]
    sell_lt_time = latest_sell_lt['tradeTime']
    sell_lt_quantity = latest_sell_lt['quantity']

    # Cumulative delta in the 300-second window prior to the SELL LT
    context_window = window_trades[window_trades['tradeTime'] <= sell_lt_time]
    buy_value = (context_window[context_window['isBuyerMaker'] == 0]['quantity'] * context_window[context_window['isBuyerMaker'] == 0]['price']).sum()
    sell_value = (context_window[context_window['isBuyerMaker'] == 1]['quantity'] * context_window[context_window['isBuyerMaker'] == 1]['price']).sum()
    cumulative_delta = buy_value - sell_value

    # Check the refined pattern with adjusted conditions
    matches_pattern = (
        sell_lt_quantity > sell_quantity_threshold and
        cumulative_delta < CUMULATIVE_DELTA_THRESHOLD
    )

    return {
        'high_time': high_time,
        'matches_pattern': matches_pattern,
        'sell_lt_quantity': sell_lt_quantity,
        'cumulative_delta': cumulative_delta,
        'quantity_threshold': quantity_threshold,
        'sell_quantity_threshold': sell_quantity_threshold
    }

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()

    # Compute the 99th percentile quantity threshold for identifying LTs (used for static threshold calculation)
    quantity_threshold = np.percentile(trades['quantity'], 99)

    # Compute the static 10th percentile SELL LT quantity threshold
    sell_quantity_threshold = compute_static_sell_quantity_threshold(shp_df, trades, quantity_threshold)
    print(f"Static 10th Percentile SELL LT Quantity Threshold: {sell_quantity_threshold}")

    # Analyze the refined pattern for each SHP using multiprocessing
    with Pool(processes=NUM_PROCESSES) as pool:
        analyze_shp_with_data = partial(analyze_shp, trades=trades, sell_quantity_threshold=sell_quantity_threshold)
        results = pool.map(analyze_shp_with_data, [row for _, row in shp_df.iterrows()])

    # Filter out None results
    results = [r for r in results if r is not None]

    # Convert results to DataFrame
    results_df = pd.DataFrame(results)

    # Save to CSV
    results_df.to_csv('shp_refined_pattern_analysis_rolling_parallel_final_v2.csv', index=False)
    print("Analysis saved to 'shp_refined_pattern_analysis_rolling_parallel_final_v2.csv'.")

    # Compute and print summary statistics
    print("\nSummary Statistics:")
    print(f"Total SHPs Analyzed: {len(results_df)}")
    print(f"Number of SHPs Matching Refined Pattern: {results_df['matches_pattern'].sum()}")
    print(f"Presence Rate (%): {results_df['matches_pattern'].mean() * 100:.2f}%")
    print(f"Mean 99th Percentile Quantity Threshold: {results_df['quantity_threshold'].mean():.2f}")
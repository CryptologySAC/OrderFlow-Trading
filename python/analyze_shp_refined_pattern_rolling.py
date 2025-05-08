import pandas as pd
import sqlite3
import numpy as np
from datetime import timedelta

# Define global constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
ROLLING_WINDOW_SECONDS = 3600  # 1 hour for rolling window
WINDOW_SECONDS = 300  # 5 minutes for context
IMMEDIATE_WINDOW_SECONDS = 30  # 30 seconds for immediate conditions
VOLUME_RATIO_THRESHOLD = 1.2
TIME_SINCE_BUY_THRESHOLD = 50  # Seconds
PRICE_CHANGE_THRESHOLD = 0  # Price increase before SELL LT

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

    # Compute 75th percentile
    if avg_sell_quantities:
        return np.percentile(avg_sell_quantities, 75)
    return np.inf  # Default to a high value if no data

# Compute cumulative delta percentiles in a rolling window
def compute_rolling_cumulative_deltas(trades, rolling_end_time, quantity_threshold):
    start_time = rolling_end_time - timedelta(seconds=ROLLING_WINDOW_SECONDS)
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] <= rolling_end_time)]
    if window_trades.empty:
        return np.inf  # Default to a high value if no data

    # Compute cumulative delta for each trade in the window
    cumulative_deltas = []
    for idx, trade in window_trades.iterrows():
        trade_time = trade['tradeTime']
        context_start = trade_time - timedelta(seconds=WINDOW_SECONDS)
        context_window = window_trades[(window_trades['tradeTime'] >= context_start) & (window_trades['tradeTime'] <= trade_time)]
        buy_value = (context_window[context_window['isBuyerMaker'] == 0]['quantity'] * context_window[context_window['isBuyerMaker'] == 0]['price']).sum()
        sell_value = (context_window[context_window['isBuyerMaker'] == 1]['quantity'] * context_window[context_window['isBuyerMaker'] == 1]['price']).sum()
        cumulative_deltas.append(buy_value - sell_value)

    # Compute 25th percentile
    if cumulative_deltas:
        return np.percentile(cumulative_deltas, 25)
    return np.inf  # Default to a high value if no data

# Analyze the latest SELL LT before a single SHP
def analyze_shp(shp_row, trades):
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
    buy_lts = large_trades[large_trades['isBuyerMaker'] == 0]
    sell_lts = large_trades[large_trades['isBuyerMaker'] == 1]
    if sell_lts.empty:
        return None

    # Get the latest SELL LT
    latest_sell_lt = sell_lts.iloc[-1]
    sell_lt_time = latest_sell_lt['tradeTime']
    sell_lt_quantity = latest_sell_lt['quantity']

    # Compute the 75th percentile SELL LT quantity threshold in the rolling window ending at high_time
    sell_quantity_threshold = compute_rolling_sell_quantities(shp_df, trades, high_time, quantity_threshold)

    # Compute the 25th percentile cumulative delta threshold in the rolling window ending at sell_lt_time
    cumulative_delta_threshold = compute_rolling_cumulative_deltas(trades, sell_lt_time, quantity_threshold)

    # Time since the last BUY LT
    time_since_last_buy_lt = WINDOW_SECONDS  # Default if no BUY LT
    if not buy_lts.empty:
        latest_buy_time = buy_lts['tradeTime'].max()
        time_since_last_buy_lt = (sell_lt_time - latest_buy_time).total_seconds()
        if time_since_last_buy_lt < 0:  # BUY LT after SELL LT
            time_since_last_buy_lt = WINDOW_SECONDS

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

    # Price change in the 30 seconds prior to the SELL LT
    price_change = 0
    if not immediate_window.empty:
        price_start = immediate_window['price'].iloc[0]
        price_end = immediate_window['price'].iloc[-1]
        price_change = (price_end - price_start) / price_start * 100

    # Check the refined pattern with rolling percentile-based thresholds
    matches_pattern = (
        time_since_last_buy_lt <= TIME_SINCE_BUY_THRESHOLD and
        sell_lt_quantity > sell_quantity_threshold and
        volume_ratio > VOLUME_RATIO_THRESHOLD and
        cumulative_delta < cumulative_delta_threshold and
        price_change > PRICE_CHANGE_THRESHOLD
    )

    return {
        'high_time': high_time,
        'matches_pattern': matches_pattern,
        'time_since_last_buy_lt': time_since_last_buy_lt,
        'sell_lt_quantity': sell_lt_quantity,
        'volume_ratio': volume_ratio,
        'cumulative_delta': cumulative_delta,
        'price_change': price_change,
        'quantity_threshold': quantity_threshold,
        'sell_quantity_threshold': sell_quantity_threshold,
        'cumulative_delta_threshold': cumulative_delta_threshold
    }

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()

    # Analyze the refined pattern for each SHP
    results = []
    for _, shp_row in shp_df.iterrows():
        result = analyze_shp(shp_row, trades)
        if result is not None:
            results.append(result)

    # Convert results to DataFrame
    results_df = pd.DataFrame(results)

    # Save to CSV
    results_df.to_csv('shp_refined_pattern_analysis_rolling.csv', index=False)
    print("Analysis saved to 'shp_refined_pattern_analysis_rolling.csv'.")

    # Compute and print summary statistics
    print("\nSummary Statistics:")
    print(f"Total SHPs Analyzed: {len(results_df)}")
    print(f"Number of SHPs Matching Refined Pattern: {results_df['matches_pattern'].sum()}")
    print(f"Presence Rate (%): {results_df['matches_pattern'].mean() * 100:.2f}%")
    print(f"Mean 99th Percentile Quantity Threshold: {results_df['quantity_threshold'].mean():.2f}")
    print(f"Mean 75th Percentile SELL LT Quantity Threshold: {results_df['sell_quantity_threshold'].mean():.2f}")
    print(f"Mean 25th Percentile Cumulative Delta Threshold: {results_df['cumulative_delta_threshold'].mean():.2f}")
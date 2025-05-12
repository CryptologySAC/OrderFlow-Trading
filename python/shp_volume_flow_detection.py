import pandas as pd
import sqlite3
import numpy as np
from datetime import timedelta
from collections import defaultdict
from multiprocessing import Pool
from functools import partial

# Constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
WINDOW_SIZE = 600  # Overall window size in seconds (10 minutes) to ensure trades are captured
NUM_PROCESSES = 10  # Match CPU cores on M4 Pro
MIN_OCCURRENCE_RATE = 0.6  # Minimum occurrence rate (60%)
FLOW_WINDOW_SECONDS = 60  # Time window (seconds) to evaluate dominant flow
REVERSAL_WINDOW_SECONDS = 10  # Time window (seconds) to look for reversal trades
PROXIMITY_WINDOW_SECONDS = 5  # Time window (seconds) for LT trade proximity

# Volume thresholds for flow patterns
IMBALANCE_CUMULATIVE_VOLUME = 60
IMBALANCE_NET_VOLUME = 45
IMBALANCE_VOLUME_RATE = 0.75
ABSORPTION_CUMULATIVE_VOLUME = 15
ABSORPTION_NET_VOLUME = 11.25
ABSORPTION_VOLUME_RATE = 0.25

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
    conn.close()
    return trades

# Compute global 75th percentile for trade sizes
def compute_global_percentiles(trades):
    percentiles_75 = np.percentile(trades['quantity'], [0, 75, 100])
    trades['size_label_75'] = np.where(trades['quantity'] > percentiles_75[1], '75-100', '0-75')
    print(f"Global 75th percentile trade size: {percentiles_75[1]}")
    print(f"Trade size distribution summary:")
    print(trades['quantity'].describe())
    return trades

# Extract trades in a time window and calculate volume flows
def extract_volume_flows(window_end, trades, window_size=WINDOW_SIZE):
    window_start = window_end - timedelta(seconds=window_size)
    window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] < window_end)]
    if window_trades.empty:
        print(f"Warning: No trades found in window ending at {window_end}")
        return None
    return window_trades

# Check if a pattern matches based on volume flows
def matches_flow_pattern(window_trades, pattern, window_end):
    if window_trades is None:
        return False

    def is_liquidity_taking(row):
        direction = 'B' if row['isBuyerMaker'] == 0 else 'S'
        is_buyer_maker = row['isBuyerMaker']
        return (direction == 'B' and is_buyer_maker == 0) or (direction == 'S' and is_buyer_maker == 1)

    # Define the flow window (60 seconds before the window_end)
    flow_window_start = window_end - timedelta(seconds=FLOW_WINDOW_SECONDS)
    flow_trades = window_trades[(window_trades['tradeTime'] >= flow_window_start) & 
                                (window_trades['tradeTime'] < window_end)]
    if flow_trades.empty:
        return False

    # Compute volume metrics for the flow window
    buy_lt_volume = 0.0
    sell_lt_volume = 0.0
    for _, row in flow_trades.iterrows():
        if is_liquidity_taking(row):
            if row['size_label_75'].startswith('75-100'):
                if row['isBuyerMaker'] == 0:  # BUY LT trade
                    buy_lt_volume += row['quantity']
                else:  # SELL LT trade
                    sell_lt_volume += row['quantity']

    # For absorption patterns, compute volume of smaller LT trades
    buy_small_lt_volume = 0.0
    sell_small_lt_volume = 0.0
    for _, row in flow_trades.iterrows():
        if is_liquidity_taking(row):
            if row['size_label_75'] == '0-75':
                if row['isBuyerMaker'] == 0:  # BUY LT trade
                    buy_small_lt_volume += row['quantity']
                else:  # SELL LT trade
                    sell_small_lt_volume += row['quantity']

    # Net volume for imbalance patterns
    net_buying_volume = buy_lt_volume - sell_lt_volume
    net_selling_volume = sell_lt_volume - buy_lt_volume
    # Net volume for absorption patterns (smaller trades)
    net_buying_small_volume = buy_small_lt_volume - sell_small_lt_volume
    net_selling_small_volume = sell_small_lt_volume - buy_small_lt_volume

    # Calculate volume rates (LTC per second)
    flow_duration = (window_end - flow_window_start).total_seconds()
    if flow_duration <= 0:
        return False
    buy_lt_volume_rate = buy_lt_volume / flow_duration
    sell_lt_volume_rate = sell_lt_volume / flow_duration
    buy_small_lt_volume_rate = buy_small_lt_volume / flow_duration
    sell_small_lt_volume_rate = sell_small_lt_volume / flow_duration

    # Define the reversal window (10 seconds after the flow window)
    reversal_window_start = window_end
    reversal_window_end = window_end + timedelta(seconds=REVERSAL_WINDOW_SECONDS)
    reversal_trades = window_trades[(window_trades['tradeTime'] >= reversal_window_start) & 
                                    (window_trades['tradeTime'] <= reversal_window_end)]

    # Define the proximity window for LT trade condition (5 seconds before/after the pattern)
    pattern_start_time = flow_window_start - timedelta(seconds=PROXIMITY_WINDOW_SECONDS)
    pattern_end_time = window_end + timedelta(seconds=PROXIMITY_WINDOW_SECONDS)
    proximity_trades = window_trades[(window_trades['tradeTime'] >= pattern_start_time) & 
                                     (window_trades['tradeTime'] <= pattern_end_time)]

    # Check for LT trade in proximity
    lt_trade_found = False
    for _, row in proximity_trades.iterrows():
        if is_liquidity_taking(row):
            lt_trade_found = True
            break
    if not lt_trade_found:
        return False

    if pattern == "ImbalanceFlowBuys-SignificantSell":
        if (buy_lt_volume >= IMBALANCE_CUMULATIVE_VOLUME and 
            net_buying_volume >= IMBALANCE_NET_VOLUME and 
            buy_lt_volume_rate >= IMBALANCE_VOLUME_RATE):
            # Check for a significant SELL LT trade in the reversal window
            for _, row in reversal_trades.iterrows():
                if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 1 and is_liquidity_taking(row):
                    return True
        return False

    elif pattern == "ImbalanceFlowSells-SignificantBuy":
        if (sell_lt_volume >= IMBALANCE_CUMULATIVE_VOLUME and 
            net_selling_volume >= IMBALANCE_NET_VOLUME and 
            sell_lt_volume_rate >= IMBALANCE_VOLUME_RATE):
            for _, row in reversal_trades.iterrows():
                if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 0 and is_liquidity_taking(row):
                    return True
        return False

    elif pattern == "AbsorptionFlowSell-BuyPressure":
        # Find a significant SELL trade before the flow window
        pre_flow_window_end = flow_window_start
        pre_flow_window_start = pre_flow_window_end - timedelta(seconds=REVERSAL_WINDOW_SECONDS)
        pre_flow_trades = window_trades[(window_trades['tradeTime'] >= pre_flow_window_start) & 
                                        (window_trades['tradeTime'] < pre_flow_window_end)]
        significant_sell_found = False
        for _, row in pre_flow_trades.iterrows():
            if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 1:
                significant_sell_found = True
                break
        if not significant_sell_found:
            return False
        if (buy_small_lt_volume >= ABSORPTION_CUMULATIVE_VOLUME and 
            net_buying_small_volume >= ABSORPTION_NET_VOLUME and 
            buy_small_lt_volume_rate >= ABSORPTION_VOLUME_RATE):
            for _, row in reversal_trades.iterrows():
                if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 1 and is_liquidity_taking(row):
                    return True
        return False

    elif pattern == "AbsorptionFlowBuy-SellPressure":
        pre_flow_window_end = flow_window_start
        pre_flow_window_start = pre_flow_window_end - timedelta(seconds=REVERSAL_WINDOW_SECONDS)
        pre_flow_trades = window_trades[(window_trades['tradeTime'] >= pre_flow_window_start) & 
                                        (window_trades['tradeTime'] < pre_flow_window_end)]
        significant_buy_found = False
        for _, row in pre_flow_trades.iterrows():
            if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 0:
                significant_buy_found = True
                break
        if not significant_buy_found:
            return False
        if (sell_small_lt_volume >= ABSORPTION_CUMULATIVE_VOLUME and 
            net_selling_small_volume >= ABSORPTION_NET_VOLUME and 
            sell_small_lt_volume_rate >= ABSORPTION_VOLUME_RATE):
            for _, row in reversal_trades.iterrows():
                if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 0 and is_liquidity_taking(row):
                    return True
        return False

    elif pattern == "StoppingFlowSell-SignificantBuy":
        # Find a significant SELL trade within the last 60 seconds
        flow_trades_check = window_trades[(window_trades['tradeTime'] >= flow_window_start) & 
                                          (window_trades['tradeTime'] < window_end)]
        significant_sell_found = False
        for _, row in flow_trades_check.iterrows():
            if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 1:
                significant_sell_found = True
                break
        if not significant_sell_found:
            return False
        # Check for a significant BUY LT trade in the reversal window
        for _, row in reversal_trades.iterrows():
            if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 0 and is_liquidity_taking(row):
                return True
        return False

    elif pattern == "StoppingFlowBuy-SignificantSell":
        flow_trades_check = window_trades[(window_trades['tradeTime'] >= flow_window_start) & 
                                          (window_trades['tradeTime'] < window_end)]
        significant_buy_found = False
        for _, row in flow_trades_check.iterrows():
            if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 0:
                significant_buy_found = True
                break
        if not significant_buy_found:
            return False
        for _, row in reversal_trades.iterrows():
            if row['size_label_75'] == '75-100' and row['isBuyerMaker'] == 1 and is_liquidity_taking(row):
                return True
        return False

    return False

# Detect flow patterns in a window of trades
def detect_flow_patterns(window_trades, window_end):
    if window_trades is None:
        return []
    detected_patterns = []
    flow_patterns = [
        "ImbalanceFlowBuys-SignificantSell",
        "ImbalanceFlowSells-SignificantBuy",
        "AbsorptionFlowSell-BuyPressure",
        "AbsorptionFlowBuy-SellPressure",
        "StoppingFlowSell-SignificantBuy",
        "StoppingFlowBuy-SignificantSell",
    ]
    for pattern in flow_patterns:
        if matches_flow_pattern(window_trades, pattern, window_end):
            detected_patterns.append(pattern)
    return detected_patterns

# Process a single SHP window
def process_shp_window(shp_row, trades):
    high_time = shp_row['high_time']
    # Extract trade sequence and detect patterns
    window_trades = extract_volume_flows(high_time, trades)
    if window_trades is None:
        return [], []
    detected_patterns = detect_flow_patterns(window_trades, high_time)
    return detected_patterns, []

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()
    print(f"Total SHPs: {len(shp_df)}")
    print(f"Total trades: {len(trades)}")

    # Compute global percentiles for trade sizes
    trades = compute_global_percentiles(trades)

    # Step 1: Detect flow patterns before known SHPs in chronological order
    print("\nDetecting flow patterns before known SHPs (live trading simulation):")
    with Pool(processes=NUM_PROCESSES) as pool:
        process_shp_with_data = partial(process_shp_window, trades=trades)
        shp_results = pool.map(process_shp_with_data, [row for _, row in shp_df.iterrows()])

    # Aggregate results for SHPs
    shp_pattern_counts = defaultdict(int)
    total_shps = len(shp_df)
    for idx, (result, _) in enumerate(shp_results):
        for pattern in result:
            shp_pattern_counts[pattern] += 1

    # Flow Patterns
    print("\nFlow pattern occurrence rates before SHPs (must have an LT trade in close proximity):")
    shp_pattern_rates = {
        pattern: count / total_shps
        for pattern, count in shp_pattern_counts.items()
        if count / total_shps >= MIN_OCCURRENCE_RATE
    }
    sorted_shp_patterns = sorted(shp_pattern_rates.items(), key=lambda x: x[1], reverse=True)
    if not sorted_shp_patterns:
        print("  No flow patterns found with occurrence rate >= 60%.")
    else:
        for pattern, rate in sorted_shp_patterns:
            print(f"  {pattern}: {rate:.2%}")

    # Save results to CSV
    print("\nSaving results to CSV:")
    results_df = pd.DataFrame(
        sorted_shp_patterns,
        columns=['Pattern', 'Occurrence Rate']
    )
    results_df.to_csv('shp_flow_pattern_detection_before_shp.csv', index=False)
    print("Results saved to 'shp_flow_pattern_detection_before_shp.csv'.")
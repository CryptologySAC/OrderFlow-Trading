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
WINDOW_SIZE = 300  # Window size in seconds (5 minutes)
NUM_PROCESSES = 10  # Match CPU cores on M4 Pro
MIN_OCCURRENCE_RATE = 0.6  # Minimum occurrence rate (60%)
FOCUS_LENGTH = 50  # Number of trades closest to SHP to analyze
WINDOW_LOOKAHEAD = 5  # Window to look ahead for small trades after a large trade
MIN_SMALL_TRADES = 2  # Minimum number of small trades for MultipleSmall patterns
PROXIMITY_WINDOW = 5  # Proximity window for LT trade (before/after pattern)
LT_TIME_WINDOW = 30  # Time window (seconds) before SHP to check for LT trade

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

# Compute global 50th and 99th percentiles for trade sizes
def compute_global_percentiles(trades):
    # Compute the 50th percentile for pattern detection (large trades in patterns)
    percentiles_50 = np.percentile(trades['quantity'], [0, 50, 100])
    trades['size_label'] = np.where(trades['quantity'] > percentiles_50[1], '50-100', '0-50')
    # Compute the 99th percentile for LT trade condition (within 30 seconds before SHP)
    percentiles_99 = np.percentile(trades['quantity'], [0, 99, 100])
    trades['size_label_99'] = np.where(trades['quantity'] > percentiles_99[1], '99-100', '0-99')
    # Debug: Log the percentile values and trade size distribution
    print(f"Global 50th percentile trade size: {percentiles_50[1]}")
    print(f"Global 99th percentile trade size: {percentiles_99[1]}")
    print(f"Trade size distribution summary:")
    print(trades['quantity'].describe())
    # Debug: Log sample trades to verify sizes
    print("Sample trades (first 10):")
    print(trades[['quantity', 'size_label', 'size_label_99']].head(10))
    return trades

# Extract trade sequence in chronological order for a given time window
def extract_trade_sequence(window_end, trades, window_size=WINDOW_SIZE, focus_length=FOCUS_LENGTH):
    window_start = window_end - timedelta(seconds=window_size)
    window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] < window_end)]
    if window_trades.empty:
        return None, None, None, None, None
    # Sort trades in chronological order (live trading simulation)
    window_trades = window_trades.sort_values(by='tradeTime', ascending=True)
    # Limit to the last FOCUS_LENGTH trades (closest to SHP)
    window_trades = window_trades.tail(focus_length)
    sequence_with_size = [
        f"{'B' if row['isBuyerMaker'] == 0 else 'S'}-{row['size_label']}"
        for _, row in window_trades.iterrows()
    ]
    sequence_direction = [
        'B' if row['isBuyerMaker'] == 0 else 'S'
        for _, row in window_trades.iterrows()
    ]
    sequence_is_buyer_maker = window_trades['isBuyerMaker'].tolist()
    sequence_times = window_trades['tradeTime'].tolist()
    # Also extract the 99th percentile size labels for the LT trade condition
    sequence_with_size_99 = [
        f"{'B' if row['isBuyerMaker'] == 0 else 'S'}-{row['size_label_99']}"
        for _, row in window_trades.iterrows()
    ]
    return sequence_direction, sequence_with_size, sequence_is_buyer_maker, sequence_times, sequence_with_size_99

# Check if there is a large LT trade within LT_TIME_WINDOW seconds before the SHP
def has_large_lt_trade_before_shp(window_end, trades):
    lt_window_start = window_end - timedelta(seconds=LT_TIME_WINDOW)
    lt_window_trades = trades[(trades['tradeTime'] >= lt_window_start) & (trades['tradeTime'] < window_end)]
    if lt_window_trades.empty:
        return False
    for _, row in lt_window_trades.iterrows():
        direction = 'B' if row['isBuyerMaker'] == 0 else 'S'
        is_buyer_maker = row['isBuyerMaker']
        size_label_99 = row['size_label_99']
        # Check if the trade is an LT trade and above the 99th percentile
        if ((direction == 'B' and is_buyer_maker == 0) or (direction == 'S' and is_buyer_maker == 1)) and size_label_99 == '99-100':
            return True
    return False

# Check if a sequence matches a flow pattern and has an LT trade in close proximity
def matches_flow_pattern(sequence_with_size, sequence_is_buyer_maker, pattern):
    if not sequence_with_size or not sequence_is_buyer_maker:
        return False

    def is_liquidity_taking(pos):
        # LT trade: BUY with isBuyerMaker == 0 (buyer is taker) or SELL with isBuyerMaker == 1 (seller is taker)
        direction = sequence_with_size[pos].split('-')[0]
        is_buyer_maker = sequence_is_buyer_maker[pos]
        return (direction == 'B' and is_buyer_maker == 0) or (direction == 'S' and is_buyer_maker == 1)

    pattern_matched_at_start = -1  # Start position of the pattern
    pattern_matched_at_end = -1    # End position of the pattern

    if pattern == "LargeSell-MultipleSmallBuys":
        # Pattern: S-50-100 followed by at least MIN_SMALL_TRADES B-0-50 within the next WINDOW_LOOKAHEAD trades
        current_pos = 0
        while current_pos < len(sequence_with_size):
            if sequence_with_size[current_pos] == 'S-50-100':
                small_buy_count = 0
                look_ahead_pos = current_pos + 1
                end_pos = min(current_pos + WINDOW_LOOKAHEAD + 1, len(sequence_with_size))
                while look_ahead_pos < end_pos:
                    if sequence_with_size[look_ahead_pos] == 'B-0-50':
                        small_buy_count += 1
                    look_ahead_pos += 1
                if small_buy_count >= MIN_SMALL_TRADES:
                    pattern_matched_at_start = current_pos
                    pattern_matched_at_end = look_ahead_pos - 1
                    break
            current_pos += 1

    elif pattern == "LargeBuy-MultipleSmallSells":
        # Pattern: B-50-100 followed by at least MIN_SMALL_TRADES S-0-50 within the next WINDOW_LOOKAHEAD trades
        current_pos = 0
        while current_pos < len(sequence_with_size):
            if sequence_with_size[current_pos] == 'B-50-100':
                small_sell_count = 0
                look_ahead_pos = current_pos + 1
                end_pos = min(current_pos + WINDOW_LOOKAHEAD + 1, len(sequence_with_size))
                while look_ahead_pos < end_pos:
                    if sequence_with_size[look_ahead_pos] == 'S-0-50':
                        small_sell_count += 1
                    look_ahead_pos += 1
                if small_sell_count >= MIN_SMALL_TRADES:
                    pattern_matched_at_start = current_pos
                    pattern_matched_at_end = look_ahead_pos - 1
                    break
            current_pos += 1

    elif pattern == "ConsecutiveBuys-LargeSell":
        # Pattern: At least 4 consecutive BUYs (any size) followed by S-50-100
        current_pos = 0
        while current_pos < len(sequence_with_size):
            buy_count = 0
            while (current_pos < len(sequence_with_size) and 
                   (sequence_with_size[current_pos].startswith('B-0-50') or sequence_with_size[current_pos].startswith('B-50-100'))):
                buy_count += 1
                current_pos += 1
            if buy_count >= 4 and current_pos < len(sequence_with_size) and sequence_with_size[current_pos] == 'S-50-100':
                pattern_matched_at_start = current_pos - buy_count
                pattern_matched_at_end = current_pos
                break
            current_pos += 1

    elif pattern == "ConsecutiveSells-LargeBuy":
        # Pattern: At least 4 consecutive SELLs (any size) followed by B-50-100
        current_pos = 0
        while current_pos < len(sequence_with_size):
            sell_count = 0
            while (current_pos < len(sequence_with_size) and 
                   (sequence_with_size[current_pos].startswith('S-0-50') or sequence_with_size[current_pos].startswith('S-50-100'))):
                sell_count += 1
                current_pos += 1
            if sell_count >= 4 and current_pos < len(sequence_with_size) and sequence_with_size[current_pos] == 'B-50-100':
                pattern_matched_at_start = current_pos - sell_count
                pattern_matched_at_end = current_pos
                break
            current_pos += 1

    elif pattern == "LargeSell-LargeBuy":
        # Pattern: S-50-100 followed by B-50-100
        current_pos = 0
        while current_pos < len(sequence_with_size):
            if sequence_with_size[current_pos] == 'S-50-100':
                look_ahead_pos = current_pos + 1
                while look_ahead_pos < len(sequence_with_size):
                    if sequence_with_size[look_ahead_pos] == 'B-50-100':
                        pattern_matched_at_start = current_pos
                        pattern_matched_at_end = look_ahead_pos
                        break
                    look_ahead_pos += 1
                if pattern_matched_at_end != -1:
                    break
            current_pos += 1

    elif pattern == "LargeBuy-LargeSell":
        # Pattern: B-50-100 followed by S-50-100
        current_pos = 0
        while current_pos < len(sequence_with_size):
            if sequence_with_size[current_pos] == 'B-50-100':
                look_ahead_pos = current_pos + 1
                while look_ahead_pos < len(sequence_with_size):
                    if sequence_with_size[look_ahead_pos] == 'S-50-100':
                        pattern_matched_at_start = current_pos
                        pattern_matched_at_end = look_ahead_pos
                        break
                    look_ahead_pos += 1
                if pattern_matched_at_end != -1:
                    break
            current_pos += 1

    # Check for an LT trade within PROXIMITY_WINDOW before or after the pattern
    if pattern_matched_at_start != -1 and pattern_matched_at_end != -1:
        start_pos = max(0, pattern_matched_at_start - PROXIMITY_WINDOW)
        end_pos = min(len(sequence_with_size), pattern_matched_at_end + PROXIMITY_WINDOW + 1)
        for pos in range(start_pos, end_pos):
            if is_liquidity_taking(pos):
                return True
    return False

# Detect flow patterns in a sequence
def detect_flow_patterns(sequence_with_size, sequence_is_buyer_maker):
    if not sequence_with_size or not sequence_is_buyer_maker:
        return []
    detected_patterns = []
    flow_patterns = [
        "LargeSell-MultipleSmallBuys",
        "LargeBuy-MultipleSmallSells",
        "ConsecutiveBuys-LargeSell",
        "ConsecutiveSells-LargeBuy",
        "LargeSell-LargeBuy",
        "LargeBuy-LargeSell",
    ]
    for pattern in flow_patterns:
        if matches_flow_pattern(sequence_with_size, sequence_is_buyer_maker, pattern):
            detected_patterns.append(pattern)
    return detected_patterns

# Process a single SHP window
def process_shp_window(shp_row, trades):
    high_time = shp_row['high_time']
    # First, check if there is a large LT trade within 30 seconds before the SHP
    if not has_large_lt_trade_before_shp(high_time, trades):
        return [], ([], [])
    # If the LT trade condition is met, proceed with pattern detection
    sequence_direction, sequence_with_size, sequence_is_buyer_maker, sequence_times, sequence_with_size_99 = extract_trade_sequence(high_time, trades)
    if sequence_direction is None:
        return [], ([], [])
    detected_patterns = detect_flow_patterns(sequence_with_size, sequence_is_buyer_maker)
    return detected_patterns, (sequence_direction, sequence_with_size)

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
    sample_sequences = []
    for idx, (result, sequence) in enumerate(shp_results):
        for pattern in result:
            shp_pattern_counts[pattern] += 1
        # Collect sample sequences for debugging
        if idx < 3 and len(sequence) == 2:  # Check if sequence contains the expected elements
            dir_seq, size_seq = sequence
            sample_sequences.append((dir_seq[:20], size_seq[:20], len(dir_seq)))

    # Print sample sequences for debugging
    print("Sample sequences (first 3 SHPs):")
    for i, (dir_seq, size_seq, seq_len) in enumerate(sample_sequences):
        print(f"  SHP {i+1} Direction: {dir_seq}... (total length: {seq_len})")
        print(f"  SHP {i+1} Direction-Size: {size_seq}... (total length: {seq_len})")

    # Flow Patterns
    print("\nFlow pattern occurrence rates before SHPs (must have an LT trade in close proximity and a large LT trade within 30 seconds before SHP):")
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
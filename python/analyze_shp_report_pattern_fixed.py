import pandas as pd
import sqlite3
from datetime import timedelta
from multiprocessing import Pool
from functools import partial

# Define global constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
NUM_PROCESSES = 8
WINDOW_SECONDS = 30  # 30 seconds before SHP
VOLUME_RATIO_THRESHOLD = 1.5  # Relaxed threshold: Sell volume / Buy volume > 1.5

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

# Analyze trades before a single SHP
def analyze_shp(shp_row, trades):
    high_time = shp_row['high_time']
    start_time = high_time - timedelta(seconds=WINDOW_SECONDS)

    # Extract trades within the window
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] < high_time)]
    if window_trades.empty:
        return None

    # Compute sell/buy volume ratio
    buy_volume = window_trades[window_trades['isBuyerMaker'] == 0]['quantity'].sum()
    sell_volume = window_trades[window_trades['isBuyerMaker'] == 1]['quantity'].sum()
    volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')
    volume_ratio_exceeded = volume_ratio > VOLUME_RATIO_THRESHOLD

    return {
        'high_time': high_time,
        'volume_ratio': volume_ratio,
        'volume_ratio_exceeded': volume_ratio_exceeded
    }

# Test pattern across the entire database using time-based windows
def test_pattern(params, trades, shp_df):
    chunk_start, chunk_size = params
    chunk = trades.iloc[chunk_start:chunk_start + chunk_size]
    chunk = chunk.reset_index(drop=True)  # Reset index for consistent slicing

    occurrences = 0
    false_positives = 0

    i = 0
    while i < len(chunk):
        end_time = chunk['tradeTime'].iloc[i]
        start_time = end_time - timedelta(seconds=WINDOW_SECONDS)

        # Extract trades within the window
        window = chunk[(chunk['tradeTime'] >= start_time) & (chunk['tradeTime'] < end_time)]
        if len(window) < 10:  # Ensure enough trades in the window
            i += 1
            continue

        # Compute sell/buy volume ratio
        buy_volume = window[window['isBuyerMaker'] == 0]['quantity'].sum()
        sell_volume = window[window['isBuyerMaker'] == 1]['quantity'].sum()
        volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')
        volume_ratio_exceeded = volume_ratio > VOLUME_RATIO_THRESHOLD

        # Check pattern
        if volume_ratio_exceeded:
            occurrences += 1
            # Check if an SHP follows within 300 seconds
            future_window = trades[(trades['tradeTime'] >= end_time) & (trades['tradeTime'] <= end_time + timedelta(seconds=300))]
            if len(future_window) < 1740:  # 300 seconds
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
            if shp_match.empty and drop_pct < 0.02:  # No SHP and no 2% drop, false positive
                false_positives += 1

        # Move to the next window (slide by 1 trade)
        i += 1

    return occurrences, false_positives

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()

    # Analyze pattern before SHPs
    with Pool(processes=NUM_PROCESSES) as pool:
        analyze_shp_with_data = partial(analyze_shp, trades=trades)
        shp_results = pool.map(analyze_shp_with_data, shp_df.to_dict('records'))

    # Filter out None results
    shp_results = [r for r in shp_results if r is not None]
    shp_results_df = pd.DataFrame(shp_results)

    # Summarize pattern presence
    print("\nPattern Analysis Before SHPs (Window: 30 seconds):")
    volume_ratio_presence = shp_results_df['volume_ratio_exceeded'].mean() * 100
    print(f"Volume Ratio > {VOLUME_RATIO_THRESHOLD}: {volume_ratio_presence:.2f}% of SHPs")

    # Test pattern across the entire database
    chunk_size = len(trades) // NUM_PROCESSES
    chunk_starts = list(range(0, len(trades), chunk_size))
    params = [(start, min(chunk_size, len(trades) - start)) for start in chunk_starts]

    with Pool(processes=NUM_PROCESSES) as pool:
        test_pattern_with_data = partial(test_pattern, trades=trades, shp_df=shp_df)
        results = pool.map(test_pattern_with_data, params)

    total_occurrences = sum(r[0] for r in results)
    total_false_positives = sum(r[1] for r in results)
    false_positive_rate = (total_false_positives / total_occurrences) * 100 if total_occurrences > 0 else 0.0

    print(f"\nPattern Specificity Across Database (Volume Ratio > {VOLUME_RATIO_THRESHOLD}, Window: 30 seconds):")
    print(f"Total Occurrences: {total_occurrences}")
    print(f"False Positives (No SHP): {total_false_positives}")
    print(f"False Positive Rate: {false_positive_rate:.2f}%")
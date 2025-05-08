import pandas as pd
import sqlite3
from datetime import timedelta
from multiprocessing import Pool
from functools import partial

# Define global constants
DB_PATH = 'trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
SIGNAL_PATH = 'signals_ltcusdt.csv'
NUM_PROCESSES = 8
WINDOW_SECONDS = 30  # 5 minutes before SHP
VOLUME_RATIO_THRESHOLD = 3.0  # Sell volume / Buy volume > 3
CUMULATIVE_DELTA_THRESHOLD = -400  # Cumulative delta < -400

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

# Load pre-generated signals
def load_signals():
    signals = pd.read_csv(SIGNAL_PATH)
    signals['time'] = pd.to_datetime(signals['time'])
    return signals

# Analyze trades before a single SHP
def analyze_shp(shp_row, trades, signals):
    high_time = shp_row['high_time']
    start_time = high_time - timedelta(seconds=WINDOW_SECONDS)

    # Extract trades within the window
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] < high_time)]
    if window_trades.empty:
        return None

    # Merge with signals
    window_trades = window_trades.merge(signals, how='left', left_on='tradeTime', right_on='time')
    window_trades.fillna({'sell_volume_increase': False, 'negative_delta': False, 'trade_rate_increase': False, 'price_rally': False}, inplace=True)

    # Compute characteristics
    signal_presence = {
        'sell_volume_increase': window_trades['sell_volume_increase'].any(),
        'negative_delta': window_trades['negative_delta'].any(),
        'trade_rate_increase': window_trades['trade_rate_increase'].any(),
        'price_rally': window_trades['price_rally'].any()
    }

    # Compute sell/buy volume ratio
    buy_volume = window_trades[window_trades['isBuyerMaker'] == 0]['quantity'].sum()
    sell_volume = window_trades[window_trades['isBuyerMaker'] == 1]['quantity'].sum()
    volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')

    # Compute cumulative delta
    buy_value = (window_trades[window_trades['isBuyerMaker'] == 0]['quantity'] * window_trades[window_trades['isBuyerMaker'] == 0]['price']).sum()
    sell_value = (window_trades[window_trades['isBuyerMaker'] == 1]['quantity'] * window_trades[window_trades['isBuyerMaker'] == 1]['price']).sum()
    cumulative_delta = buy_value - sell_value

    # Check pattern
    pattern_matched = (signal_presence['sell_volume_increase'] and 
                       signal_presence['price_rally'] and 
                       volume_ratio > VOLUME_RATIO_THRESHOLD and 
                       cumulative_delta < CUMULATIVE_DELTA_THRESHOLD)

    return {
        'high_time': high_time,
        'cumulative_delta': cumulative_delta,
        'volume_ratio': volume_ratio,
        'pattern_matched': pattern_matched,
        **signal_presence
    }

# Test pattern across the entire database
def test_pattern(params, trades, signals, shp_df):
    chunk_start, chunk_size = params
    chunk = trades.iloc[chunk_start:chunk_start + chunk_size]
    chunk = chunk.merge(signals, how='left', left_on='tradeTime', right_on='time')
    chunk.fillna({'sell_volume_increase': False, 'negative_delta': False, 'trade_rate_increase': False, 'price_rally': False}, inplace=True)

    occurrences = 0
    false_positives = 0
    window_trades = 1740  # ~300 seconds

    for i in range(len(chunk) - window_trades):
        window = chunk.iloc[i:i+window_trades]
        end_time = window['tradeTime'].iloc[-1]
        start_time = window['tradeTime'].iloc[0]

        # Compute pattern components
        buy_volume = window[window['isBuyerMaker'] == 0]['quantity'].sum()
        sell_volume = window[window['isBuyerMaker'] == 1]['quantity'].sum()
        volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')
        buy_value = (window[window['isBuyerMaker'] == 0]['quantity'] * window[window['isBuyerMaker'] == 0]['price']).sum()
        sell_value = (window[window['isBuyerMaker'] == 1]['quantity'] * window[window['isBuyerMaker'] == 1]['price']).sum()
        cumulative_delta = buy_value - sell_value

        # Check pattern
        if (window['sell_volume_increase'].any() and 
            window['price_rally'].any() and 
            volume_ratio > VOLUME_RATIO_THRESHOLD and 
            cumulative_delta < CUMULATIVE_DELTA_THRESHOLD):
            occurrences += 1
            # Check if an SHP follows within 300 seconds
            future_window = trades[(trades['tradeTime'] > end_time) & (trades['tradeTime'] <= end_time + timedelta(seconds=WINDOW_SECONDS))]
            if len(future_window) < window_trades:
                continue
            max_price_idx = future_window['price'].idxmax()
            max_price = future_window['price'].loc[max_price_idx]
            future_after_max = future_window[future_window.index > max_price_idx]
            if future_after_max.empty:
                continue
            min_price_after = future_after_max['price'].min()
            drop_pct = (max_price - min_price_after) / max_price
            # Check if this max price corresponds to an SHP
            shp_match = shp_df[(shp_df['high_time'] >= end_time) & 
                              (shp_df['high_time'] <= end_time + timedelta(seconds=WINDOW_SECONDS)) & 
                              (shp_df['high_price'] == max_price)]
            if shp_match.empty and drop_pct < 0.02:  # No SHP and no 2% drop, false positive
                false_positives += 1

    return occurrences, false_positives

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    signals = load_signals()
    shp_df = load_shp_data()

    # Analyze patterns before SHPs
    with Pool(processes=NUM_PROCESSES) as pool:
        analyze_shp_with_data = partial(analyze_shp, trades=trades, signals=signals)
        shp_results = pool.map(analyze_shp_with_data, shp_df.to_dict('records'))

    # Filter out None results
    shp_results = [r for r in shp_results if r is not None]
    shp_results_df = pd.DataFrame(shp_results)

    # Summarize pattern presence
    print("\nPattern Analysis Before SHPs:")
    pattern_presence = shp_results_df['pattern_matched'].mean() * 100
    print(f"Pattern (sell_volume_increase AND price_rally AND volume_ratio > {VOLUME_RATIO_THRESHOLD} AND cumulative_delta < {CUMULATIVE_DELTA_THRESHOLD}): {pattern_presence:.2f}% of SHPs")

    # Test pattern across the entire database
    chunk_size = len(trades) // NUM_PROCESSES
    chunk_starts = list(range(0, len(trades), chunk_size))
    params = [(start, min(chunk_size, len(trades) - start)) for start in chunk_starts]

    with Pool(processes=NUM_PROCESSES) as pool:
        test_pattern_with_data = partial(test_pattern, trades=trades, signals=signals, shp_df=shp_df)
        results = pool.map(test_pattern_with_data, params)

    total_occurrences = sum(r[0] for r in results)
    total_false_positives = sum(r[1] for r in results)
    false_positive_rate = (total_false_positives / total_occurrences) * 100 if total_occurrences > 0 else 0.0

    print(f"\nPattern Specificity Across Database:")
    print(f"Total Occurrences: {total_occurrences}")
    print(f"False Positives (No SHP): {total_false_positives}")
    print(f"False Positive Rate: {false_positive_rate:.2f}%")
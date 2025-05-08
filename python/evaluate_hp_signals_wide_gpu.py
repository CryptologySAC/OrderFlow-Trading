import pandas as pd
import sqlite3
import numpy as np
import torch
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import psutil
from multiprocessing import Pool
import os
from functools import partial

# Configure device for MPS (Apple Silicon GPU) or CPU fallback
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
print(f"Using device: {device}")

# Define global constants
DB_PATH = '../trades.db'
WINDOW_SECONDS = 300  # Start with a wide 300-second window for HP detection
TRADES_PER_CHECK = 10  # Last 10 trades for signal evaluation
CONTEXT_SECONDS = 60  # 60 seconds for contextual trend
BATCH_SIZE = 500  # Batch size for MPS
CHUNK_SIZE = 500000  # Load 500,000 trades at a time
SUB_CHUNK_SIZE = 10000  # Process 10,000 trades within each chunk
NUM_PROCESSES = 8  # Number of parallel processes (adjust based on M4 Pro cores)

# Function to fetch trades in chunks
def fetch_trades_in_chunks(start_idx, chunk_size):
    conn = sqlite3.connect(DB_PATH)
    query = f"""
    SELECT tradeTime, price, quantity, isBuyerMaker
    FROM aggregated_trades
    ORDER BY tradeTime ASC
    LIMIT {chunk_size} OFFSET {start_idx}
    """
    chunk = pd.read_sql_query(query, conn)
    chunk['tradeTime'] = pd.to_datetime(chunk['tradeTime'], unit='ms')
    conn.close()
    return chunk

# Function to evaluate wide-net signals with minimal memory usage
def evaluate_signals_batch(start_indices, trade_times, prices, quantities, is_buyer_maker):
    batch_size = len(start_indices)
    signal_results = []

    for i in range(batch_size):
        start_idx = start_indices[i].item()
        window = slice(start_idx, start_idx + TRADES_PER_CHECK)
        window_trade_times = trade_times[window]
        window_prices = prices[window]
        window_quantities = quantities[window]
        window_is_buyer_maker = is_buyer_maker[window]

        # Compute context window (last 60 seconds)
        end_time = window_trade_times[-1]
        context_start_time = end_time - CONTEXT_SECONDS
        context_mask = (trade_times >= context_start_time) & (trade_times <= end_time)
        context_quantities = quantities[context_mask]
        context_is_buyer_maker = is_buyer_maker[context_mask]
        context_prices = prices[context_mask]

        # Sell Volume Increase: Sell volume > Buy volume
        buy_mask = (context_is_buyer_maker == 0).float()
        sell_mask = (context_is_buyer_maker == 1).float()
        buy_volume = (context_quantities * buy_mask).sum()
        sell_volume = (context_quantities * sell_mask).sum()
        sell_volume_increase = sell_volume > buy_volume

        # Negative Delta Shift: Cumulative delta < 0
        buy_value = (context_quantities * buy_mask * context_prices).sum()
        sell_value = (context_quantities * sell_mask * context_prices).sum()
        cumulative_delta = buy_value - sell_value
        negative_delta = cumulative_delta < 0

        # Trade Rate Increase: Trade rate > previous 10-second trade rate
        window_duration = window_trade_times[-1] - window_trade_times[0]
        trade_rate = TRADES_PER_CHECK / window_duration.clamp(min=torch.tensor(1e-6, dtype=torch.float32, device=device))
        short_context_start = end_time - 10
        short_context_mask = (trade_times >= short_context_start) & (trade_times <= end_time)
        short_trade_counts = short_context_mask.sum()
        short_duration = (trade_times[short_context_mask].max() - trade_times[short_context_mask].min()).clamp(min=torch.tensor(1e-6, dtype=torch.float32, device=device)) if short_trade_counts > 0 else torch.tensor(1e-6, dtype=torch.float32, device=device)
        short_trade_rate = short_trade_counts / short_duration
        trade_rate_increase = trade_rate > short_trade_rate

        # Price Rally: Price increase > 0.5% in the last 60 seconds
        if context_mask.sum() > 0:
            context_price_range = context_prices.max() - context_prices.min()
            context_price_min = context_prices.min()
            price_rally = (context_price_range / context_price_min.clamp(min=torch.tensor(1e-6, dtype=torch.float32, device=device)) * 100) > 0.5
        else:
            price_rally = torch.tensor(False, device=device)

        # Collect results
        result = {'time': pd.to_datetime(window_trade_times[0].cpu().numpy() * 1e9), 'current_price': float(window_prices[-1].cpu().numpy())}
        if sell_volume_increase:
            result['sell_volume_increase'] = True
        if negative_delta:
            result['negative_delta'] = True
        if trade_rate_increase:
            result['trade_rate_increase'] = True
        if price_rally:
            result['price_rally'] = True
        if any([result.get('sell_volume_increase', False), result.get('negative_delta', False), 
                result.get('trade_rate_increase', False), result.get('price_rally', False)]):
            signal_results.append(result)

    return signal_results

# Function to evaluate wide-net signals for a single chunk
def process_chunk(chunk_start, total_trades):
    print(f"Process {os.getpid()} processing chunk {chunk_start} to {min(chunk_start + CHUNK_SIZE, total_trades)}...")
    chunk = fetch_trades_in_chunks(chunk_start, CHUNK_SIZE)
    if chunk.empty:
        return []

    signal_results = []
    # Process in sub-chunks within the chunk
    for sub_chunk_start in range(0, len(chunk), SUB_CHUNK_SIZE):
        sub_chunk_end = min(sub_chunk_start + SUB_CHUNK_SIZE, len(chunk))
        sub_chunk = chunk.iloc[sub_chunk_start:sub_chunk_end]

        # Convert sub-chunk to tensors with float32
        trade_times_chunk = pd.to_datetime(sub_chunk['tradeTime']).astype(int) / 10**9
        trade_times_tensor_chunk = torch.tensor(trade_times_chunk.values, dtype=torch.float32, device=device)
        prices_tensor_chunk = torch.tensor(sub_chunk['price'].values, dtype=torch.float32, device=device)
        quantities_tensor_chunk = torch.tensor(sub_chunk['quantity'].values, dtype=torch.float32, device=device)
        is_buyer_maker_tensor_chunk = torch.tensor(sub_chunk['isBuyerMaker'].values, dtype=torch.float32, device=device)

        # Process in batches within the sub-chunk
        for batch_start in range(0, len(sub_chunk) - TRADES_PER_CHECK + 1, BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(sub_chunk) - TRADES_PER_CHECK + 1)
            start_indices = torch.arange(batch_start, batch_end, device=device)
            batch_results = evaluate_signals_batch(start_indices, trade_times_tensor_chunk, prices_tensor_chunk, quantities_tensor_chunk, is_buyer_maker_tensor_chunk)
            signal_results.extend(batch_results)

    # Print memory usage for this process
    process = psutil.Process()
    memory_info = process.memory_info()
    print(f"Process {os.getpid()} memory usage after chunk {chunk_start}: {memory_info.rss / 1024 / 1024:.2f} MB")
    return signal_results

if __name__ == '__main__':
    # Opt-in to future Pandas behavior to avoid FutureWarning
    pd.set_option('future.no_silent_downcasting', True)

    # Load HP data from CSV
    hp_df = pd.read_csv('swing_high_low_pairs_filtered_v1.1.csv')
    hp_df['high_time'] = pd.to_datetime(hp_df['high_time'])
    hp_df = hp_df.sort_values('high_time')

    # Get total number of trades
    conn = sqlite3.connect(DB_PATH)
    total_trades = pd.read_sql_query("SELECT COUNT(*) FROM aggregated_trades", conn).iloc[0, 0]
    print(f"Total trades: {total_trades}")
    conn.close()

    # Parallel processing of chunks
    chunk_starts = list(range(0, total_trades, CHUNK_SIZE))
    with Pool(processes=NUM_PROCESSES) as pool:
        process_chunk_with_total = partial(process_chunk, total_trades=total_trades)
        results = pool.map(process_chunk_with_total, chunk_starts)

    # Flatten results
    signal_occurrences = [item for sublist in results for item in sublist]

    # Add HP-related metrics
    signal_occurrences_df = pd.DataFrame(signal_occurrences)
    signal_columns = ['sell_volume_increase', 'negative_delta', 'trade_rate_increase', 'price_rally']

    # Ensure all signal columns exist, defaulting to False if missing
    for col in signal_columns:
        if col not in signal_occurrences_df.columns:
            signal_occurrences_df[col] = False
        else:
            signal_occurrences_df[col] = signal_occurrences_df[col].astype(bool)

    # Calculate occurrence statistics across the entire database
    total_trades_processed = total_trades - TRADES_PER_CHECK + 1
    frequencies = {}
    for col in signal_columns:
        count = signal_occurrences_df[col].sum()
        frequency = count / total_trades_processed if total_trades_processed > 0 else 0
        frequencies[col] = {'count': count, 'frequency': frequency}

    print("\nSignal Occurrences Across Entire Database:")
    for col, stats in frequencies.items():
        print(f"{col}: {stats['count']} occurrences, {stats['frequency']:.6%} of total windows")

    # Check signals within 300 seconds before each known HP
    hp_signal_check = []
    for idx, row in hp_df.iterrows():
        hp_time = row['high_time']
        start_time = hp_time - timedelta(seconds=WINDOW_SECONDS)
        trades = all_trades[(all_trades['tradeTime'] >= start_time) & (all_trades['tradeTime'] <= hp_time)]
        if len(trades) < TRADES_PER_CHECK:
            continue

        # Evaluate signals for each 10-trade window within the 300-second period
        results = []
        for start_idx in range(0, len(trades) - TRADES_PER_CHECK + 1):
            window = trades.iloc[start_idx:start_idx + TRADES_PER_CHECK]
            trade_times_batch = torch.tensor(pd.to_datetime(window['tradeTime']).astype(int) / 10**9, dtype=torch.float32, device=device)
            prices_batch = torch.tensor(window['price'].values, dtype=torch.float32, device=device)
            quantities_batch = torch.tensor(window['quantity'].values, dtype=torch.float32, device=device)
            is_buyer_maker_batch = torch.tensor(window['isBuyerMaker'].values, dtype=torch.float32, device=device)
            batch_results = evaluate_signals_batch(torch.tensor([0], device=device), trade_times_batch, prices_batch, quantities_batch, is_buyer_maker_batch)
            if batch_results:
                result = batch_results[0]
                earliest_time = window['tradeTime'].iloc[0]
                time_before_hp = (hp_time - earliest_time).total_seconds()
                result['time_before_hp'] = time_before_hp
                results.append(result)

        # Aggregate results for this HP
        if results:
            hp_result = {'hp_time': hp_time}
            for col in signal_columns:
                hp_result[col] = any(r.get(col, False) for r in results)
                if hp_result[col]:
                    earliest_result = min((r for r in results if r.get(col, False)), key=lambda x: x['time_before_hp'], default=None)
                    hp_result[f'{col}_time'] = earliest_result['time_before_hp'] if earliest_result else None
            hp_signal_check.append(hp_result)

    # Convert HP signal check to DataFrame
    hp_check_df = pd.DataFrame(hp_signal_check)

    # Calculate frequency of signals within 300 seconds before HPs
    print("\nSignal Occurrences Within 300 Seconds Before Known HPs:")
    for col in signal_columns:
        freq = hp_check_df[col].mean() if not hp_check_df.empty else 0
        count = hp_check_df[col].sum() if not hp_check_df.empty else 0
        print(f"{col}: {freq:.2%} ({int(count)} out of {len(hp_df)} HPs)")

    # Visualize timing distribution
    plt.figure(figsize=(12, 8))
    for col in signal_columns:
        subset = hp_check_df[hp_check_df[col] == True]
        if not subset.empty:
            sns.histplot(subset[f'{col}_time'], label=col, stat='density', bins=50, alpha=0.5)
    if plt.gca().has_data():
        plt.legend()
    plt.title('Timing Distribution of Signals Within 300 Seconds Before HPs')
    plt.xlabel('Time Before HP (seconds)')
    plt.ylabel('Density')
    plt.savefig('signal_timing_distribution_within_300s.png')
    plt.close()

    # Overall signal visualizations
    plt.figure(figsize=(12, 8))
    for col in signal_columns:
        subset = signal_occurrences_df[signal_occurrences_df[col] == True]
        if not subset.empty:
            sns.histplot(subset['time_to_next_hp'], label=col, stat='density', bins=50, alpha=0.5)
    if plt.gca().has_data():
        plt.legend()
    plt.title('Time to Next HP for All Signal Occurrences')
    plt.xlabel('Time to Next HP (seconds)')
    plt.ylabel('Density')
    plt.savefig('time_to_next_hp_distribution.png')
    plt.close()

    plt.figure(figsize=(12, 8))
    for col in signal_columns:
        subset = signal_occurrences_df[signal_occurrences_df[col] == True]
        if not subset.empty:
            sns.histplot(subset['price_diff_percent'], label=col, stat='density', bins=50, alpha=0.5)
    if plt.gca().has_data():
        plt.legend()
    plt.title('Price Difference from Next HP at Signal Occurrence')
    plt.xlabel('Price Difference (% Above/Below HP)')
    plt.ylabel('Density')
    plt.savefig('price_diff_distribution.png')
    plt.close()

    plt.figure(figsize=(10, 6))
    data_to_plot = {col: signal_occurrences_df[signal_occurrences_df[col] == True]['time_to_next_hp'] for col in signal_columns if signal_occurrences_df[col].sum() > 0}
    sns.boxplot(data=pd.DataFrame(data_to_plot), orient='v')
    plt.title('Time to Next HP for All Signal Occurrences')
    plt.ylabel('Time to Next HP (seconds)')
    plt.savefig('time_to_next_hp_boxplot.png')
    plt.close()

    plt.figure(figsize=(10, 6))
    data_to_plot = {col: signal_occurrences_df[signal_occurrences_df[col] == True]['price_diff_percent'] for col in signal_columns if signal_occurrences_df[col].sum() > 0}
    sns.boxplot(data=pd.DataFrame(data_to_plot), orient='v')
    plt.title('Price Difference from Next HP at Signal Occurrence')
    plt.ylabel('Price Difference (% Above/Below HP)')
    plt.savefig('price_diff_boxplot.png')
    plt.close()

    print("\nVisualizations saved as PNG files.")
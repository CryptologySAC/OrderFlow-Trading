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
LOOKBACK_SECONDS = 60  # Lookback for rally detection
BATCH_SIZE = 500  # Batch size for MPS/CPU
CHUNK_SIZE = 500000  # Load 500,000 trades at a time
SUB_CHUNK_SIZE = 10000  # Process 10,000 trades within each chunk

# Load HP data from CSV
hp_df = pd.read_csv('swing_high_low_pairs_filtered_v1.1.csv')
hp_df['high_time'] = pd.to_datetime(hp_df['high_time'])
hp_df = hp_df.sort_values('high_time')

# Connect to SQLite database
conn = sqlite3.connect(DB_PATH)

# Define parameters
WINDOW_SECONDS = 300  # Window for HP detection
TRADES_PER_CHECK = 10  # Last 10 trades for signal evaluation
CONTEXT_SECONDS = 60  # 60 seconds for contextual trend
LOOKBACK_SECONDS = 60  # Lookback for rally detection

# Fetch all trades from the database
query = """
SELECT tradeTime, price, quantity, isBuyerMaker
FROM aggregated_trades
ORDER BY tradeTime ASC
"""
all_trades = pd.read_sql_query(query, conn)
all_trades['tradeTime'] = pd.to_datetime(all_trades['tradeTime'], unit='ms')
all_trades = all_trades.sort_values('tradeTime')

# Compute quantity threshold (75th percentile)
quantity_threshold = np.percentile(all_trades['quantity'], 75)
print(f"Quantity Threshold (75th percentile): {quantity_threshold}")

# Convert data to PyTorch tensors
trade_times = pd.to_datetime(all_trades['tradeTime']).astype(int) / 10**9  # Convert to seconds since epoch
trade_times_tensor = torch.tensor(trade_times.values, dtype=torch.float32, device=device)
prices_tensor = torch.tensor(all_trades['price'].values, dtype=torch.float32, device=device)
quantities_tensor = torch.tensor(all_trades['quantity'].values, dtype=torch.float32, device=device)
is_buyer_maker_tensor = torch.tensor(all_trades['isBuyerMaker'].values, dtype=torch.float32, device=device)

# Function to evaluate signals using GPU-accelerated operations
def evaluate_signals_batch(start_indices, trade_times, prices, quantities, is_buyer_maker, quantity_threshold):
    batch_size = len(start_indices)
    end_indices = start_indices + TRADES_PER_CHECK
    signal_results = []

    # Extract 10-trade windows
    window_indices = torch.arange(TRADES_PER_CHECK, device=device).unsqueeze(0).repeat(batch_size, 1) + start_indices.unsqueeze(1)
    window_trade_times = trade_times[window_indices]
    window_prices = prices[window_indices]
    window_quantities = quantities[window_indices]
    window_is_buyer_maker = is_buyer_maker[window_indices]

    # Compute context windows (last 60 seconds)
    window_end_times = window_trade_times[:, -1]
    context_start_times = window_end_times - CONTEXT_SECONDS
    context_mask = (trade_times.unsqueeze(0) >= context_start_times.unsqueeze(1)) & (trade_times.unsqueeze(0) <= window_end_times.unsqueeze(1))
    context_quantities = quantities.unsqueeze(0).expand(batch_size, -1) * context_mask.float()
    context_is_buyer_maker = is_buyer_maker.unsqueeze(0).expand(batch_size, -1) * context_mask.float()
    context_prices = prices.unsqueeze(0).expand(batch_size, -1) * context_mask.float()

    # Absorption Signal: Large sell trades followed by failure to break higher within 30 seconds
    sell_mask = (context_is_buyer_maker == 1).float()
    large_sell_trades = (context_quantities * sell_mask) > quantity_threshold
    absorption = torch.zeros(batch_size, dtype=torch.bool, device=device)
    for i in range(batch_size):
        if large_sell_trades[i].any():
            large_sell_times = trade_times[large_sell_trades[i].nonzero(as_tuple=True)[0]]
            if large_sell_times.numel() == 0:
                continue
            max_sell_time = large_sell_times.max()
            future_mask = (trade_times >= max_sell_time) & (trade_times <= max_sell_time + 30)
            if future_mask.any():
                max_price_after = prices[future_mask].max()
                max_price_during = context_prices[i][large_sell_trades[i]].max()
                absorption[i] = max_price_after <= max_price_during

    # Selling Pressure Signal: Increase in sell volume with negative delta
    buy_volume = (context_quantities * (1 - context_is_buyer_maker)).sum(dim=1)
    sell_volume = (context_quantities * context_is_buyer_maker).sum(dim=1)
    buy_value = (context_quantities * (1 - context_is_buyer_maker) * context_prices).sum(dim=1)
    sell_value = (context_quantities * context_is_buyer_maker * context_prices).sum(dim=1)
    cumulative_delta = buy_value - sell_value
    # Check for increasing sell volume (compare first and second halves of the 60-second window)
    mid_time = context_start_times + (window_end_times - context_start_times) / 2
    early_mask = context_mask & (trade_times.unsqueeze(0) <= mid_time.unsqueeze(1))
    late_mask = context_mask & (trade_times.unsqueeze(0) > mid_time.unsqueeze(1))
    early_sell_volume = (context_quantities * context_is_buyer_maker * early_mask).sum(dim=1)
    late_sell_volume = (context_quantities * context_is_buyer_maker * late_mask).sum(dim=1)
    selling_pressure = (late_sell_volume > early_sell_volume) & (cumulative_delta < 0)

    # Price Stagnation Signal: Small price change after a rally
    lookback_start_times = window_end_times - CONTEXT_SECONDS - LOOKBACK_SECONDS
    lookback_mask = (trade_times.unsqueeze(0) >= lookback_start_times.unsqueeze(1)) & (trade_times.unsqueeze(0) <= context_start_times.unsqueeze(1))
    lookback_prices = prices.unsqueeze(0).expand(batch_size, -1) * lookback_mask.float()
    rally = torch.zeros(batch_size, dtype=torch.bool, device=device)
    price_stagnation = torch.zeros(batch_size, dtype=torch.bool, device=device)
    for i in range(batch_size):
        lookback_price_range = lookback_prices[i][lookback_mask[i]].max() - lookback_prices[i][lookback_mask[i]].min()
        lookback_price_min = lookback_prices[i][lookback_mask[i]].min()
        rally[i] = (lookback_price_range / lookback_price_min.clamp(min=1e-6) * 100) > 1  # Rally > 1%
        context_price_range = context_prices[i][context_mask[i]].max() - context_prices[i][context_mask[i]].min()
        context_price_min = context_prices[i][context_mask[i]].min()
        price_stagnation[i] = (context_price_range / context_price_min.clamp(min=1e-6) * 100) < 0.5  # Stagnation < 0.5%

    # Collect results
    earliest_times = window_trade_times[:, 0].cpu().numpy()
    current_prices = window_prices[:, -1].cpu().numpy()
    for i in range(batch_size):
        result = {'time': pd.to_datetime(earliest_times[i] * 1e9), 'current_price': float(current_prices[i])}
        if absorption[i]:
            result['sell_volume_increase'] = True
        if selling_pressure[i]:
            result['negative_delta'] = True
        if rally[i]:
            result['trade_rate_increase'] = True
        if price_stagnation[i]:
            result['price_rally'] = True
        if any([result.get('sell_volume_increase', False), result.get('negative_delta', False), 
                result.get('trade_rate_increase', False), result.get('price_rally', False)]):
            signal_results.append(result)
    return signal_results

# Process in chunks
def process_chunk(chunk_start):
    print(f"Processing chunk {chunk_start} to {min(chunk_start + CHUNK_SIZE, len(all_trades))}...")
    chunk = all_trades.iloc[chunk_start:chunk_start + CHUNK_SIZE]
    if chunk.empty:
        return []

    # Convert chunk to tensors
    trade_times_chunk = pd.to_datetime(chunk['tradeTime']).astype(int) / 10**9
    trade_times_tensor_chunk = torch.tensor(trade_times_chunk.values, dtype=torch.float32, device=device)
    prices_tensor_chunk = torch.tensor(chunk['price'].values, dtype=torch.float32, device=device)
    quantities_tensor_chunk = torch.tensor(chunk['quantity'].values, dtype=torch.float32, device=device)
    is_buyer_maker_tensor_chunk = torch.tensor(chunk['isBuyerMaker'].values, dtype=torch.float32, device=device)

    # Process in batches within the chunk
    signal_results = []
    for batch_start in range(0, len(chunk) - TRADES_PER_CHECK + 1, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(chunk) - TRADES_PER_CHECK + 1)
        start_indices = torch.arange(batch_start, batch_end, device=device)
        batch_results = evaluate_signals_batch(start_indices, trade_times_tensor_chunk, prices_tensor_chunk, quantities_tensor_chunk, is_buyer_maker_tensor_chunk, quantity_threshold)
        signal_results.extend(batch_results)

    # Print memory usage
    process = psutil.Process()
    memory_info = process.memory_info()
    print(f"Memory usage: {memory_info.rss / 1024 / 1024:.2f} MB")
    return signal_results

if __name__ == '__main__':
    # Process in chunks
    chunk_starts = list(range(0, len(all_trades), CHUNK_SIZE))
    with Pool(processes=8) as pool:
        results = pool.map(process_chunk, chunk_starts)

    # Flatten results
    signal_occurrences = [item for sublist in results for item in sublist]
    signal_occurrences_df = pd.DataFrame(signal_occurrences)

    # Save signals to CSV
    signal_occurrences_df.to_csv('signals_ltcusdt.csv', index=False)
    print("Signals saved to 'signals_ltcusdt.csv'.")

    # Add HP-related metrics
    for idx, result in signal_occurrences_df.iterrows():
        future_hps = hp_df[hp_df['high_time'] > result['time']]
        if future_hps.empty:
            signal_occurrences_df.at[idx, 'time_to_next_hp'] = float('inf')
            continue
        nearest_hp = future_hps.iloc[0]
        time_to_next_hp = (nearest_hp['high_time'] - result['time']).total_seconds()
        hp_price = nearest_hp['high_price']
        price_diff_percent = ((result['current_price'] - hp_price) / hp_price) * 100
        signal_occurrences_df.at[idx, 'time_to_next_hp'] = time_to_next_hp
        signal_occurrences_df.at[idx, 'price_diff_percent'] = price_diff_percent
        signal_occurrences_df.at[idx, 'nearest_hp_time'] = nearest_hp['high_time']

    # Calculate occurrence statistics across the entire database
    signal_columns = ['sell_volume_increase', 'negative_delta', 'trade_rate_increase', 'price_rally']
    total_trades = len(all_trades) - TRADES_PER_CHECK + 1
    frequencies = {}
    for col in signal_columns:
        signal_occurrences_df[col] = signal_occurrences_df[col].fillna(False)
        count = signal_occurrences_df[col].sum()
        frequency = count / total_trades if total_trades > 0 else 0
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
            batch_results = evaluate_signals_batch(torch.tensor([0], device=device), trade_times_batch, prices_batch, quantities_batch, is_buyer_maker_batch, quantity_threshold)
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

    # Visualizations
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

    plt.figure(figsize=(12, 8))
    for col in signal_columns:
        subset = hp_check_df[hp_check_df[col] == True]
        if not subset.empty:
            sns.histplot(subset[f'{col}_time'], label=col, stat='density', bins=20, alpha=0.5)
    if plt.gca().has_data():
        plt.legend()
    plt.title('Timing Distribution of Signals Within 300 Seconds Before HPs')
    plt.xlabel('Time Before HP (seconds)')
    plt.ylabel('Density')
    plt.savefig('signal_timing_distribution_within_300s.png')
    plt.close()

    print("\nVisualizations saved as PNG files.")
    conn.close()
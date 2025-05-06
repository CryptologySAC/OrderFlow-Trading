import pandas as pd
import sqlite3
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta

# Load HP data from CSV (assumes 'high_time' and 'high_price' columns)
hp_df = pd.read_csv('swing_high_low_pairs_filtered_v1.1.csv')
hp_df['high_time'] = pd.to_datetime(hp_df['high_time'])
hp_df = hp_df.sort_values('high_time')  # Ensure HPs are sorted by time

# Connect to SQLite database
DB_PATH = '../trades.db'
conn = sqlite3.connect(DB_PATH)

# Define parameters
WINDOW_SECONDS = 60  # Increased to 60 seconds for signal evaluation
TRADES_PER_CHECK = 10  # Last 10 trades for signal evaluation
CONTEXT_SECONDS = 180  # 3 minutes for contextual trend

# Fetch all trades from the database
query = """
SELECT tradeTime, price, quantity, isBuyerMaker
FROM aggregated_trades
ORDER BY tradeTime ASC
"""
all_trades = pd.read_sql_query(query, conn)
all_trades['tradeTime'] = pd.to_datetime(all_trades['tradeTime'], unit='ms')
all_trades = all_trades.sort_values('tradeTime')

# Function to evaluate signals for a window of trades
def evaluate_signals(trades):
    if len(trades) < TRADES_PER_CHECK:
        return None

    # Calculate average metrics over the 3-minute window for context
    context_window = trades[trades['tradeTime'] >= (trades['tradeTime'].max() - timedelta(seconds=CONTEXT_SECONDS))]
    if context_window.empty:
        return None

    # Average volume, value, and trades per 10-trade window in 3 minutes
    avg_volume = context_window['quantity'].sum() / (len(context_window) / TRADES_PER_CHECK)
    context_sell_value = (context_window[context_window['isBuyerMaker'] == 1]['quantity'] * 
                          context_window[context_window['isBuyerMaker'] == 1]['price']).sum()
    avg_sell_value = context_sell_value / (len(context_window) / TRADES_PER_CHECK)
    # Calculate actual average trades per 10-trade window
    context_trade_counts = []
    for i in range(0, len(context_window) - TRADES_PER_CHECK + 1):
        window = context_window.iloc[i:i + TRADES_PER_CHECK]
        context_trade_counts.append(len(window))
    avg_trades = np.mean(context_trade_counts) if context_trade_counts else TRADES_PER_CHECK

    # Cumulative delta in the 3-minute window
    context_buy_value = (context_window[context_window['isBuyerMaker'] == 0]['quantity'] * 
                         context_window[context_window['isBuyerMaker'] == 0]['price']).sum()
    context_sell_value = (context_window[context_window['isBuyerMaker'] == 1]['quantity'] * 
                          context_window[context_window['isBuyerMaker'] == 1]['price']).sum()
    cumulative_delta_value = context_buy_value - context_sell_value

    window = trades.tail(TRADES_PER_CHECK)
    earliest_time = window['tradeTime'].iloc[0]
    current_price = window['price'].iloc[-1]  # Price at the end of the window

    # Signal 1: Sell Volume Surge (relaxed threshold)
    buy_volume = window[window['isBuyerMaker'] == 0]['quantity'].sum()
    sell_volume = window[window['isBuyerMaker'] == 1]['quantity'].sum()
    total_volume = buy_volume + sell_volume
    volume_ratio = (sell_volume - buy_volume) / buy_volume if buy_volume > 0 else float('inf')
    volume_threshold = 0.1  # Reduced from 0.2
    sell_volume_surge = (volume_ratio >= volume_threshold and total_volume >= 1.2 * avg_volume)  # Reduced from 1.5

    # Signal 2: Sell Value Spike (relaxed threshold)
    buy_value = (window[window['isBuyerMaker'] == 0]['quantity'] * window[window['isBuyerMaker'] == 0]['price']).sum()
    sell_value = (window[window['isBuyerMaker'] == 1]['quantity'] * window[window['isBuyerMaker'] == 1]['price']).sum()
    value_ratio = sell_value / buy_value if buy_value > 0 else float('inf')
    value_threshold = 1.5  # Reduced from 2
    sell_value_spike = (value_ratio >= 1.5 and sell_value >= value_threshold * avg_sell_value)

    # Signal 3: Trade Frequency Jump (fixed logic, relaxed threshold)
    total_trades = len(window)
    sell_trades = len(window[window['isBuyerMaker'] == 1])
    sell_trade_ratio = sell_trades / total_trades if total_trades > 0 else 0
    trade_threshold = 0.5  # Reduced from 0.6
    trade_frequency_jump = (total_trades >= 1.5 * avg_trades and sell_trade_ratio >= trade_threshold)  # Reduced from 2

    # Signal 4: Delta Flip with Contextual Trend (relaxed threshold)
    delta_value = buy_value - sell_value
    delta_threshold = 0  # Unchanged
    delta_flip = (cumulative_delta_value > 0 and delta_value <= delta_threshold)

    # Signal 5: Combined Signal (updated with relaxed thresholds)
    combined_signal = (cumulative_delta_value > 0 and delta_value <= 0 and 
                       value_ratio >= 1.5 and total_trades >= 1.5 * avg_trades and 
                       sell_trade_ratio >= trade_threshold)

    return {
        'time': earliest_time,
        'current_price': current_price,
        'sell_volume_surge': sell_volume_surge,
        'sell_value_spike': sell_value_spike,
        'trade_frequency_jump': trade_frequency_jump,
        'delta_flip': delta_flip,
        'combined_signal': combined_signal
    }

# Scan the entire database for signals
signal_occurrences = []
for idx in range(len(all_trades) - TRADES_PER_CHECK + 1):
    trades_window = all_trades.iloc[idx:idx + TRADES_PER_CHECK + CONTEXT_SECONDS * 2]
    if len(trades_window) < TRADES_PER_CHECK:
        continue

    # Evaluate signals
    result = evaluate_signals(trades_window)
    if result and any([result['sell_volume_surge'], result['sell_value_spike'], 
                       result['trade_frequency_jump'], result['delta_flip'], 
                       result['combined_signal']]):
        # Find the nearest future HP
        future_hps = hp_df[hp_df['high_time'] > result['time']]
        if future_hps.empty:
            continue
        nearest_hp = future_hps.iloc[0]
        time_to_next_hp = (nearest_hp['high_time'] - result['time']).total_seconds()
        hp_price = nearest_hp['high_price']
        price_diff_percent = ((result['current_price'] - hp_price) / hp_price) * 100
        result.update({
            'time_to_next_hp': time_to_next_hp,
            'price_diff_percent': price_diff_percent,
            'nearest_hp_time': nearest_hp['high_time']
        })
        signal_occurrences.append(result)

# Convert to DataFrame
occurrences_df = pd.DataFrame(signal_occurrences)

# Calculate occurrence statistics across the entire database
signal_columns = ['sell_volume_surge', 'sell_value_spike', 'trade_frequency_jump', 'delta_flip', 'combined_signal']
total_trades = len(all_trades) - TRADES_PER_CHECK + 1
frequencies = {}
for col in signal_columns:
    count = occurrences_df[col].sum()
    frequency = count / total_trades if total_trades > 0 else 0
    frequencies[col] = {'count': count, 'frequency': frequency}

print("\nSignal Occurrences Across Entire Database:")
for col, stats in frequencies.items():
    print(f"{col}: {stats['count']} occurrences, {stats['frequency']:.6%} of total windows")

# Check signals within 60 seconds before each known HP
hp_signal_check = []
for idx, row in hp_df.iterrows():
    hp_time = row['high_time']
    start_time = hp_time - timedelta(seconds=WINDOW_SECONDS)
    trades = all_trades[(all_trades['tradeTime'] >= start_time) & (all_trades['tradeTime'] <= hp_time)]
    if len(trades) < TRADES_PER_CHECK:
        continue

    # Evaluate signals for each 10-trade window within the 60-second period
    results = []
    for start_idx in range(0, len(trades) - TRADES_PER_CHECK + 1):
        window = trades.iloc[start_idx:start_idx + TRADES_PER_CHECK]
        result = evaluate_signals(window)
        if result:
            earliest_time = window['tradeTime'].iloc[0]
            time_before_hp = (hp_time - earliest_time).total_seconds()
            result['time_before_hp'] = time_before_hp
            results.append(result)

    # Aggregate results for this HP
    if results:
        hp_result = {'hp_time': hp_time}
        for col in signal_columns:
            hp_result[col] = any(r[col] for r in results)
            if hp_result[col]:
                # Find the earliest occurrence of the signal
                earliest_result = min((r for r in results if r[col]), key=lambda x: x['time_before_hp'], default=None)
                hp_result[f'{col}_time'] = earliest_result['time_before_hp'] if earliest_result else None
        hp_signal_check.append(hp_result)

# Convert HP signal check to DataFrame
hp_check_df = pd.DataFrame(hp_signal_check)

# Calculate frequency of signals within 60 seconds before HPs
print("\nSignal Occurrences Within 60 Seconds Before Known HPs:")
for col in signal_columns:
    freq = hp_check_df[col].mean() if not hp_check_df.empty else 0
    count = hp_check_df[col].sum() if not hp_check_df.empty else 0
    print(f"{col}: {freq:.2%} ({int(count)} out of {len(hp_df)} HPs)")

# Analyze time to next HP and price difference for all occurrences
plt.figure(figsize=(12, 8))
for col in signal_columns:
    subset = occurrences_df[occurrences_df[col] == True]
    if not subset.empty:
        sns.histplot(subset['time_to_next_hp'], label=col, stat='density', bins=50, alpha=0.5)
plt.title('Time to Next HP for All Signal Occurrences')
plt.xlabel('Time to Next HP (seconds)')
plt.ylabel('Density')
plt.legend()
plt.savefig('time_to_next_hp_distribution.png')
plt.close()

plt.figure(figsize=(12, 8))
for col in signal_columns:
    subset = occurrences_df[occurrences_df[col] == True]
    if not subset.empty:
        sns.histplot(subset['price_diff_percent'], label=col, stat='density', bins=50, alpha=0.5)
plt.title('Price Difference from Next HP at Signal Occurrence')
plt.xlabel('Price Difference (% Above/Below HP)')
plt.ylabel('Density')
plt.legend()
plt.savefig('price_diff_distribution.png')
plt.close()

# Box plots for timing and price difference
plt.figure(figsize=(10, 6))
data_to_plot = {col: occurrences_df[occurrences_df[col] == True]['time_to_next_hp'] for col in signal_columns if occurrences_df[col].sum() > 0}
sns.boxplot(data=pd.DataFrame(data_to_plot), orient='v')
plt.title('Time to Next HP for All Signal Occurrences')
plt.ylabel('Time to Next HP (seconds)')
plt.savefig('time_to_next_hp_boxplot.png')
plt.close()

plt.figure(figsize=(10, 6))
data_to_plot = {col: occurrences_df[occurrences_df[col] == True]['price_diff_percent'] for col in signal_columns if occurrences_df[col].sum() > 0}
sns.boxplot(data=pd.DataFrame(data_to_plot), orient='v')
plt.title('Price Difference from Next HP at Signal Occurrence')
plt.ylabel('Price Difference (% Above/Below HP)')
plt.savefig('price_diff_boxplot.png')
plt.close()

# Timing distribution for signals within 60 seconds before HPs
plt.figure(figsize=(12, 8))
for col in signal_columns:
    subset = hp_check_df[hp_check_df[col] == True]
    if not subset.empty:
        sns.histplot(subset[f'{col}_time'], label=col, stat='density', bins=20, alpha=0.5)
plt.title('Timing Distribution of Signals Within 60 Seconds Before HPs')
plt.xlabel('Time Before HP (seconds)')
plt.ylabel('Density')
plt.legend()
plt.savefig('signal_timing_distribution_within_60s.png')
plt.close()

print("\nVisualizations saved as PNG files.")
conn.close()
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
NUM_PROCESSES = 10  # Match CPU cores on M4 Pro
SLIDING_WINDOW_STEP_SECONDS = 5  # 5-second steps for scanning the database
TIMESTAMP_TOLERANCE_SECONDS = 120  # Lookback window for matching to SHPs
MAX_FLOW_PERIOD_SECONDS = 120  # Period to search for the flow window in seconds
REVERSAL_WINDOW_SECONDS = 15   # Reversal window duration in seconds
FALSE_POSITIVE_CLUSTER_SECONDS = 60  # Cluster false positives within 60 seconds
SUBSET_FRACTION = 0.1  # Process a subset of the database

def check_shp_flow(window_end, trades, min_volume=50, min_net_volume=37.5, 
                   flow_window_seconds=60, max_flow_period_seconds=120, 
                   reversal_window_seconds=15, proximity_window_seconds=10, 
                   significant_trade_threshold=1.926):
    """
    Check for a flow pattern leading to a Swing High Point (SHP) based on volume metrics and price action.
    
    Parameters:
    - window_end (pd.Timestamp): End time of the window (SHP time).
    - trades (pd.DataFrame): Trades DataFrame with columns ['tradeTime', 'quantity', 'isBuyerMaker', 'size_label_75'].
    - min_volume (float): Minimum cumulative volume (LTC) for the flow (default: 50).
    - min_net_volume (float): Minimum net volume (LTC) for the flow (default: 37.5).
    - flow_window_seconds (int): Duration of the flow window in seconds (default: 60).
    - max_flow_period_seconds (int): Period to search for the flow window in seconds (default: 120).
    - reversal_window_seconds (int): Reversal window duration in seconds (default: 15).
    - proximity_window_seconds (int): LT trade proximity window in seconds (default: 10).
    - significant_trade_threshold (float): Threshold for significant trades (default: 1.926 LTC).
    
    Returns:
    - dict: Signal details including patterns, flow window, imbalance ratio, cumulative pressure, and reversal sustainability.
    """
    # Define overall window: 120 seconds for flow + 15 seconds for reversal
    overall_window_start = window_end - timedelta(seconds=max_flow_period_seconds + reversal_window_seconds)
    overall_window_trades = trades[(trades['tradeTime'] >= overall_window_start) & 
                                   (trades['tradeTime'] <= window_end)].copy()
    if overall_window_trades.empty:
        return None

    # Pre-compute LT trades using .loc to avoid SettingWithCopyWarning
    overall_window_trades.loc[:, 'is_lt'] = ((overall_window_trades['isBuyerMaker'] == 0) & 
                                             (overall_window_trades['quantity'] > 0)) | \
                                            ((overall_window_trades['isBuyerMaker'] == 1) & 
                                             (overall_window_trades['quantity'] > 0))

    # Define flow window search range (last 120 seconds before SHP)
    flow_search_end = window_end
    flow_search_start = window_end - timedelta(seconds=max_flow_period_seconds)

    # Initialize variables to track the strongest flow
    max_buy_flow = {'net_volume': -float('inf'), 'start_time': None, 'end_time': None, 'imbalance_ratio': 0.0, 'pressure': 0.0, 'reversal_volume': 0.0}
    max_sell_flow = {'net_volume': -float('inf'), 'start_time': None, 'end_time': None, 'imbalance_ratio': 0.0, 'pressure': 0.0, 'reversal_volume': 0.0}

    # Scan for the strongest 60-second flow window within the last 120 seconds
    current_start = flow_search_start
    window_data = []  # Store net volumes and timestamps for pressure calculation

    while current_start <= flow_search_end - timedelta(seconds=flow_window_seconds):
        current_end = current_start + timedelta(seconds=flow_window_seconds)
        flow_trades = overall_window_trades[(overall_window_trades['tradeTime'] >= current_start) & 
                                            (overall_window_trades['tradeTime'] < current_end)]
        if flow_trades.empty:
            current_start += timedelta(seconds=1)
            continue

        # Compute volume metrics for the flow window
        buy_lt_volume = flow_trades[(flow_trades['size_label_75'] == '75-100') & 
                                    (flow_trades['isBuyerMaker'] == 0) & 
                                    (flow_trades['is_lt'])]['quantity'].sum()
        sell_lt_volume = flow_trades[(flow_trades['size_label_75'] == '75-100') & 
                                     (flow_trades['isBuyerMaker'] == 1) & 
                                     (flow_trades['is_lt'])]['quantity'].sum()
        net_buying_volume = buy_lt_volume - sell_lt_volume
        net_selling_volume = sell_lt_volume - buy_lt_volume

        # Compute buy/sell imbalance ratio
        buy_sell_ratio = buy_lt_volume / sell_lt_volume if sell_lt_volume > 0 else float('inf')
        sell_buy_ratio = sell_lt_volume / buy_lt_volume if buy_lt_volume > 0 else float('inf')

        # Store window data for cumulative pressure
        window_data.append({
            'start_time': current_start,
            'end_time': current_end,
            'net_buy_volume': net_buying_volume,
            'net_sell_volume': net_selling_volume,
            'buy_sell_ratio': buy_sell_ratio,
            'sell_buy_ratio': sell_buy_ratio
        })

        # Update strongest buying flow
        if buy_lt_volume >= min_volume and net_buying_volume >= min_net_volume:
            if net_buying_volume > max_buy_flow['net_volume']:
                max_buy_flow.update({
                    'net_volume': net_buying_volume,
                    'start_time': current_start,
                    'end_time': current_end,
                    'imbalance_ratio': buy_sell_ratio
                })

        # Update strongest selling flow
        if sell_lt_volume >= min_volume and net_selling_volume >= min_net_volume:
            if net_selling_volume > max_sell_flow['net_volume']:
                max_sell_flow.update({
                    'net_volume': net_selling_volume,
                    'start_time': current_start,
                    'end_time': current_end,
                    'imbalance_ratio': sell_buy_ratio
                })

        current_start += timedelta(seconds=1)

    # Compute cumulative pressure for each flow
    if window_data:
        for flow in [max_buy_flow, max_sell_flow]:
            if flow['start_time'] is not None:
                pressure = 0.0
                for window in window_data:
                    if window['start_time'] >= flow['start_time'] - timedelta(seconds=60):  # 120-second window
                        time_interval = (window['end_time'] - window['start_time']).total_seconds()
                        if flow == max_buy_flow:
                            pressure += window['net_buy_volume'] * time_interval
                        else:
                            pressure += window['net_sell_volume'] * time_interval
                flow['pressure'] = pressure

    # Check for reversal and compute post-reversal net volume
    patterns = []
    # ImbalanceFlowBuys-SignificantSell
    if max_buy_flow['start_time'] is not None:
        reversal_start = max_buy_flow['end_time']
        reversal_end = reversal_start + timedelta(seconds=reversal_window_seconds)
        reversal_trades = overall_window_trades[(overall_window_trades['tradeTime'] >= reversal_start) & 
                                                (overall_window_trades['tradeTime'] <= reversal_end)]
        has_reversal = not reversal_trades[(reversal_trades['size_label_75'] == '75-100') & 
                                           (reversal_trades['isBuyerMaker'] == 1) & 
                                           (reversal_trades['is_lt'])].empty
        if has_reversal:
            proximity_start = max_buy_flow['start_time'] - timedelta(seconds=proximity_window_seconds)
            proximity_end = max_buy_flow['end_time'] + timedelta(seconds=proximity_window_seconds)
            proximity_trades = overall_window_trades[(overall_window_trades['tradeTime'] >= proximity_start) & 
                                                     (overall_window_trades['tradeTime'] <= proximity_end)]
            has_lt_proximity = not proximity_trades[proximity_trades['is_lt']].empty
            if has_lt_proximity:
                # Compute net LT volume after reversal to assess sustainability
                post_reversal_buy = reversal_trades[(reversal_trades['size_label_75'] == '75-100') & 
                                                    (reversal_trades['isBuyerMaker'] == 0) & 
                                                    (reversal_trades['is_lt'])]['quantity'].sum()
                post_reversal_sell = reversal_trades[(reversal_trades['size_label_75'] == '75-100') & 
                                                     (reversal_trades['isBuyerMaker'] == 1) & 
                                                     (reversal_trades['is_lt'])]['quantity'].sum()
                max_buy_flow['reversal_volume'] = post_reversal_buy - post_reversal_sell
                patterns.append("ImbalanceFlowBuys-SignificantSell")

    # ImbalanceFlowSells-SignificantBuy
    if max_sell_flow['start_time'] is not None:
        reversal_start = max_sell_flow['end_time']
        reversal_end = reversal_start + timedelta(seconds=reversal_window_seconds)
        reversal_trades = overall_window_trades[(overall_window_trades['tradeTime'] >= reversal_start) & 
                                                (overall_window_trades['tradeTime'] <= reversal_end)]
        has_reversal = not reversal_trades[(reversal_trades['size_label_75'] == '75-100') & 
                                           (reversal_trades['isBuyerMaker'] == 0) & 
                                           (reversal_trades['is_lt'])].empty
        if has_reversal:
            proximity_start = max_sell_flow['start_time'] - timedelta(seconds=proximity_window_seconds)
            proximity_end = max_sell_flow['end_time'] + timedelta(seconds=proximity_window_seconds)
            proximity_trades = overall_window_trades[(overall_window_trades['tradeTime'] >= proximity_start) & 
                                                     (overall_window_trades['tradeTime'] <= proximity_end)]
            has_lt_proximity = not proximity_trades[proximity_trades['is_lt']].empty
            if has_lt_proximity:
                post_reversal_buy = reversal_trades[(reversal_trades['size_label_75'] == '75-100') & 
                                                    (reversal_trades['isBuyerMaker'] == 0) & 
                                                    (reversal_trades['is_lt'])]['quantity'].sum()
                post_reversal_sell = reversal_trades[(reversal_trades['size_label_75'] == '75-100') & 
                                                     (reversal_trades['isBuyerMaker'] == 1) & 
                                                     (reversal_trades['is_lt'])]['quantity'].sum()
                max_sell_flow['reversal_volume'] = post_reversal_buy - post_reversal_sell
                patterns.append("ImbalanceFlowSells-SignificantBuy")

    # Determine the flow window to return (based on detected patterns)
    flow_start, flow_end = None, None
    if patterns:
        if "ImbalanceFlowBuys-SignificantSell" in patterns:
            flow_start = max_buy_flow['start_time']
            flow_end = max_buy_flow['end_time']
        elif "ImbalanceFlowSells-SignificantBuy" in patterns:
            flow_start = max_sell_flow['start_time']
            flow_end = max_sell_flow['end_time']

    if not patterns:
        return None

    return {
        'Timestamp': window_end,
        'Patterns': patterns,
        'FlowStart': flow_start,
        'FlowEnd': flow_end,
        'ImbalanceRatio': max(max_buy_flow['imbalance_ratio'], max_sell_flow['imbalance_ratio']),
        'CumulativePressure': max(max_buy_flow['pressure'], max_sell_flow['pressure']),
        'ReversalVolume': max_buy_flow['reversal_volume'] if "ImbalanceFlowBuys-SignificantSell" in patterns else max_sell_flow['reversal_volume']
    }

# Load SHP data
def load_shp_data():
    shp_df = pd.read_csv(SHP_PATH)
    shp_df['high_time'] = pd.to_datetime(shp_df['high_time'])
    return shp_df

# Load trade data
def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker, aggregatedTradeId AS orderId FROM aggregated_trades ORDER BY tradeTime ASC", conn)
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

# Process a single timestamp (for sliding window)
def process_timestamp(timestamp, trades, true_positive_timestamps):
    result = check_shp_flow(timestamp, trades)
    return result

# Deduplicate signals by clustering within a time window
def deduplicate_signals(signals, cluster_seconds):
    if not signals:
        return []
    # Sort by timestamp
    signals = sorted(signals, key=lambda x: x['Timestamp'])
    clustered = []
    current_cluster = [signals[0]]
    
    for i in range(1, len(signals)):
        prev_time = current_cluster[-1]['Timestamp']
        curr_time = signals[i]['Timestamp']
        # If the current timestamp is within cluster_seconds of the previous, add to the same cluster
        if (curr_time - prev_time).total_seconds() <= cluster_seconds:
            current_cluster.append(signals[i])
        else:
            # Select the first timestamp in the cluster as the representative, preserving all fields
            clustered.append(current_cluster[0])
            current_cluster = [signals[i]]
    
    # Add the last cluster
    if current_cluster:
        clustered.append(current_cluster[0])
    
    return clustered

# Filter signals based on flow characteristics
def filter_signals(signals):
    if not signals:
        return []

    # Compute thresholds for top 10% of imbalance ratio, cumulative pressure, and reversal volume magnitude
    imbalance_ratios = [s['ImbalanceRatio'] for s in signals if s['ImbalanceRatio'] != float('inf')]
    cumulative_pressures = [s['CumulativePressure'] for s in signals]
    reversal_volumes = [abs(s['ReversalVolume']) for s in signals]

    imbalance_threshold = np.percentile(imbalance_ratios, 90) if imbalance_ratios else 0
    pressure_threshold = np.percentile(cumulative_pressures, 90) if cumulative_pressures else 0
    reversal_volume_threshold = np.percentile(reversal_volumes, 90) if reversal_volumes else 0

    filtered_signals = []
    for signal in signals:
        # Check imbalance ratio, cumulative pressure, and reversal volume magnitude
        if (signal['ImbalanceRatio'] == float('inf') or signal['ImbalanceRatio'] >= imbalance_threshold) and \
           signal['CumulativePressure'] >= pressure_threshold and \
           abs(signal['ReversalVolume']) >= reversal_volume_threshold:
            # Check reversal sustainability
            if "ImbalanceFlowBuys-SignificantSell" in signal['Patterns']:
                # For buying flows, require negative net LT volume after reversal (sustained selling pressure)
                if signal['ReversalVolume'] <= 0:
                    filtered_signals.append(signal)
            elif "ImbalanceFlowSells-SignificantBuy" in signal['Patterns']:
                # For selling flows, require positive net LT volume after reversal (sustained buying pressure)
                if signal['ReversalVolume'] >= 0:
                    filtered_signals.append(signal)

    return filtered_signals

# Identify true positive signals by matching to SHPs (for reporting only)
def identify_true_positives(signals, true_positive_timestamps):
    true_positives = []
    matched_shps = set()
    
    for signal in signals:
        timestamp = signal['Timestamp']
        # Find the nearest SHP within the 120-second window after the timestamp
        matching_shp = None
        min_distance = float('inf')
        for tp in true_positive_timestamps:
            if (tp - timedelta(seconds=TIMESTAMP_TOLERANCE_SECONDS) <= timestamp <= tp):
                distance = (tp - timestamp).total_seconds()
                if distance < min_distance:
                    min_distance = distance
                    matching_shp = tp
        if matching_shp and matching_shp not in matched_shps:
            matched_shps.add(matching_shp)
            true_positives.append(signal)
    
    return true_positives

# Simulate a trade based on the signal
def simulate_trade(signal, trades):
    entry_time = signal['Timestamp']
    signal_patterns = signal['Patterns']
    flow_start = signal['FlowStart']
    flow_end = signal['FlowEnd']
    
    # Get trades within the flow window to find the largest trade
    flow_trades = trades[(trades['tradeTime'] >= flow_start) & 
                         (trades['tradeTime'] <= flow_end)]
    if flow_trades.empty:
        return None
    
    # Find the largest trade by quantity
    largest_trade = flow_trades.loc[flow_trades['quantity'].idxmax()]
    largest_trade_id = largest_trade['orderId']  # This is aggregatedTradeId (aliased as orderId)
    entry_price = largest_trade['price']
    
    # Define thresholds
    tp_threshold = entry_price * 0.98  # -2% drop (Take Profit)
    escape_threshold = entry_price * 0.995  # -0.5% drop (Escape)
    escape_recovery_threshold = entry_price * 1.002  # +0.2% (Escape recovery, confirming price moves against us)
    sl_threshold = entry_price * 1.005  # +0.5% increase (Stop Loss)
    
    # Get trades after the signal
    subsequent_trades = trades[trades['tradeTime'] > entry_time]
    if subsequent_trades.empty:
        return None
    
    # Track price movement
    min_price = entry_price
    max_price = entry_price
    exit_time = None
    outcome = None
    exit_price = None
    hit_escape_level = False
    
    # Simulate trade (no special treatment for true positives)
    for _, trade in subsequent_trades.iterrows():
        price = trade['price']
        trade_time = trade['tradeTime']
        
        # Update minimum price
        if price < min_price:
            min_price = price
        
        # Update maximum price
        if price > max_price:
            max_price = price
        
        # Check for TP (-2% drop)
        if price <= tp_threshold:
            outcome = "TP"
            exit_price = price
            exit_time = trade_time
            break
        
        # Check for SL (+0.5% increase)
        if price >= sl_threshold:
            outcome = "SL"
            exit_price = price
            exit_time = trade_time
            break
        
        # Check for Escape (-0.5% drop followed by recovery to +0.2%)
        if price <= escape_threshold:
            hit_escape_level = True
        if hit_escape_level and price >= escape_recovery_threshold:
            outcome = "Escape"
            exit_price = price  # Exit at recovery price
            exit_time = trade_time
            break
    
    # If no exit condition met, trade remains open until the last trade
    if outcome is None:
        outcome = "Open"
        exit_price = subsequent_trades['price'].iloc[-1]
        exit_time = subsequent_trades['tradeTime'].iloc[-1]
    
    return {
        'EntryTimestamp': entry_time,
        'AggregatedTradeId': largest_trade_id,
        'EntryPrice': entry_price,
        'ExitTimestamp': exit_time,
        'ExitPrice': exit_price,
        'Outcome': outcome,
        'Patterns': signal_patterns
    }

if __name__ == '__main__':
    # Load SHP data
    shp_df = load_shp_data()
    print(f"Total SHPs: {len(shp_df)}")

    # Load trades (full database)
    trades = load_trades()
    print(f"Total trades: {len(trades)}")

    # Compute global percentiles
    trades = compute_global_percentiles(trades)

    # Get true positive timestamps (known SHPs)
    true_positive_timestamps = shp_df['high_time'].tolist()
    total_true_positives = len(true_positive_timestamps)

    # Determine the full time range of the database
    min_time_full = trades['tradeTime'].min() + timedelta(seconds=MAX_FLOW_PERIOD_SECONDS)
    max_time_full = trades['tradeTime'].max() - timedelta(seconds=REVERSAL_WINDOW_SECONDS)
    full_time_range = (max_time_full - min_time_full).total_seconds()

    # Calculate the subset time range
    subset_duration = full_time_range * SUBSET_FRACTION
    subset_end_time = min_time_full + timedelta(seconds=subset_duration)

    # Adjust subset to ensure it includes the necessary lookback and lookforward periods
    min_time = min_time_full
    max_time = subset_end_time - timedelta(seconds=REVERSAL_WINDOW_SECONDS)
    timestamps = pd.date_range(start=min_time, end=max_time, freq=f'{SLIDING_WINDOW_STEP_SECONDS}s')

    # Filter SHPs within the subset time range
    subset_true_positive_timestamps = [
        tp for tp in true_positive_timestamps
        if min_time <= tp <= subset_end_time
    ]
    total_subset_true_positives = len(subset_true_positive_timestamps)

    print(f"\nProcessing subset of database (first {SUBSET_FRACTION*100}% of time range):")
    print(f"Subset time range: {min_time} to {subset_end_time}")
    print(f"Number of SHPs in subset: {total_subset_true_positives}")

    # Detect flow patterns across the subset using sliding window
    print("\nDetecting flow patterns across the subset database (live trading simulation):")
    with Pool(processes=NUM_PROCESSES) as pool:
        process_with_data = partial(
            process_timestamp, 
            trades=trades, 
            true_positive_timestamps=subset_true_positive_timestamps
        )
        results = pool.map(process_with_data, timestamps)

    # Filter out None results (no patterns detected)
    all_signals = [r for r in results if r is not None]

    # Deduplicate all signals
    all_signals = deduplicate_signals(all_signals, FALSE_POSITIVE_CLUSTER_SECONDS)
    print(f"\nTotal signals after deduplication (before filtering): {len(all_signals)}")

    # Apply flow-based filter
    filtered_signals = filter_signals(all_signals)
    print(f"Total signals after flow-based filtering: {len(filtered_signals)}")

    # Simulate trades without prioritizing true positives
    trades_executed = []
    active_trade_exit_time = None  # Tracks when the current trade exits
    signal_index = 0

    for signal in filtered_signals:
        signal_time = signal['Timestamp']
        
        # Skip signal if a trade is active
        if active_trade_exit_time and signal_time <= active_trade_exit_time:
            continue
        
        # Simulate the new trade
        trade_result = simulate_trade(signal, trades)
        if trade_result:
            trade_result['SignalIndex'] = signal_index  # Track the signal index for matching
            trades_executed.append(trade_result)
            active_trade_exit_time = trade_result['ExitTimestamp']
        signal_index += 1

    # Identify true positives among executed trades for reporting
    true_positive_signals = identify_true_positives(filtered_signals, subset_true_positive_timestamps)
    true_positive_timestamps_set = {s['Timestamp'] for s in true_positive_signals}
    true_positive_count = 0
    skipped_true_positives = 0

    for trade in trades_executed:
        signal_timestamp = trade['EntryTimestamp']
        if signal_timestamp in true_positive_timestamps_set:
            trade['IsTruePositive'] = True
            true_positive_count += 1
        else:
            trade['IsTruePositive'] = False

    # Count skipped true positives
    for signal in filtered_signals:
        if signal['Timestamp'] in true_positive_timestamps_set and signal['Timestamp'] not in {t['EntryTimestamp'] for t in trades_executed}:
            skipped_true_positives += 1

    # Analyze trade outcomes
    total_trades = len(trades_executed)
    tp_count = 0
    escape_count = 0
    sl_count = 0
    open_count = 0
    true_positive_tp_count = 0  # True positives that hit TP

    for trade in trades_executed:
        if trade['Outcome'] == "TP":
            tp_count += 1
            if trade['IsTruePositive']:
                true_positive_tp_count += 1
        elif trade['Outcome'] == "Escape":
            escape_count += 1
        elif trade['Outcome'] == "SL":
            sl_count += 1
        elif trade['Outcome'] == "Open":
            open_count += 1

    print("\nTrade execution summary (live scenario, no true positive prioritization):")
    print(f"Total trades executed: {total_trades}")
    print(f"True positives executed (matched SHPs): {true_positive_count} ({true_positive_count/total_trades*100:.2f}%)")
    print(f"True positives that hit TP: {true_positive_tp_count} ({true_positive_tp_count/true_positive_count*100:.2f}% of true positives executed)" if true_positive_count > 0 else "True positives that hit TP: 0 (0.00% of true positives executed)")
    print(f"True positives skipped due to active trades: {skipped_true_positives} ({skipped_true_positives/total_subset_true_positives*100:.2f}% of total true positives)")
    print(f"False positives executed: {total_trades - true_positive_count} ({(total_trades - true_positive_count)/total_trades*100:.2f}%)")
    print(f"Reached TP (-2% drop): {tp_count} ({tp_count/total_trades*100:.2f}%)")
    print(f"Reached Escape (-0.5% drop then +0.2% recovery): {escape_count} ({escape_count/total_trades*100:.2f}%)")
    print(f"Reached SL (+0.5% increase): {sl_count} ({sl_count/total_trades*100:.2f}%)")
    print(f"Open trades (no exit condition met): {open_count} ({open_count/total_trades*100:.2f}%)")

    # Calculate profitability
    commission_per_trade = 0.2  # 0.1% entry + 0.1% exit
    gross_profit = 0
    net_profit = 0

    for trade in trades_executed:
        if trade['Outcome'] == "TP":
            gross_profit += 2.0  # +2% gross
            net_profit += (2.0 - commission_per_trade)
        elif trade['Outcome'] == "Escape":
            gross_profit += (trade['ExitPrice'] - trade['EntryPrice']) / trade['EntryPrice'] * 100
            net_profit += ((trade['ExitPrice'] - trade['EntryPrice']) / trade['EntryPrice'] * 100 - commission_per_trade)
        elif trade['Outcome'] == "SL":
            gross_profit += -0.5  # -0.5% gross
            net_profit += (-0.5 - commission_per_trade)
        elif trade['Outcome'] == "Open":
            profit = (trade['ExitPrice'] - trade['EntryPrice']) / trade['EntryPrice'] * 100
            gross_profit += profit
            net_profit += (profit - commission_per_trade)

    print("\nProfitability summary:")
    print(f"Total gross profit: {gross_profit:.2f}%")
    print(f"Total net profit (after {commission_per_trade}% commissions): {net_profit:.2f}%")
    print(f"Average gross profit per trade: {gross_profit/total_trades:.2f}%")
    print(f"Average net profit per trade: {net_profit/total_trades:.2f}%")

    # Prepare trades for output
    trades_df = pd.DataFrame(trades_executed)
    if not trades_df.empty:
        trades_df['EntryTimestamp'] = trades_df['EntryTimestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')
        trades_df['ExitTimestamp'] = trades_df['ExitTimestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')
        trades_df['Patterns'] = trades_df['Patterns'].apply(lambda x: 'Both' if len(x) == 2 else x[0])
        trades_df.to_csv('trade_execution_results_live_filtered_v2.csv', index=False)
        print("\nTrade execution results saved to 'trade_execution_results_live_filtered_v2.csv'.")
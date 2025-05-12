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
SUPPORT_SIGNAL_WINDOW_SECONDS = 120  # Window for support signals (centered on signal timestamp)

def compute_volume_threshold(trades, window_seconds=60, lookback_hours=24):
    """Compute a volume threshold as the 90th percentile of 60-second window volumes over the last 24 hours."""
    lookback_start = trades['tradeTime'].max() - timedelta(hours=lookback_hours)
    recent_trades = trades[trades['tradeTime'] >= lookback_start].copy()
    if recent_trades.empty:
        return 1000.0  # Default threshold if insufficient data

    # Compute total volume in 60-second windows
    recent_trades['time_bin'] = recent_trades['tradeTime'].dt.floor(f'{window_seconds}s')
    window_volumes = recent_trades.groupby('time_bin')['quantity'].sum()
    if window_volumes.empty:
        return 1000.0

    # Return the 90th percentile
    return np.percentile(window_volumes, 90)

def check_shp_flow(window_end, trades, min_volume=50, min_net_volume=37.5, 
                   flow_window_seconds=60, max_flow_period_seconds=120, 
                   reversal_window_seconds=15, proximity_window_seconds=10, 
                   significant_trade_threshold=1.926):
    """
    Check for a flow pattern leading to a Swing High Point (SHP) based on volume metrics.
    
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
    - dict: Signal details including patterns, flow window, and flow metrics.
    """
    # Define overall window: 120 seconds for flow + 15 seconds for reversal
    overall_window_start = window_end - timedelta(seconds=max_flow_period_seconds + reversal_window_seconds)
    overall_window_trades = trades[(trades['tradeTime'] >= overall_window_start) & 
                                   (trades['tradeTime'] <= window_end)].copy()
    if overall_window_trades.empty:
        return None

    # Pre-compute LT trades using .loc to avoid SettingWithCopyWarning
    # Simplified: 'is_lt' means the trade is in the 75th percentile of quantity
    overall_window_trades.loc[:, 'is_lt'] = (overall_window_trades['size_label_75'] == '75-100')

    # Define flow window search range (last 120 seconds before SHP)
    flow_search_end = window_end
    flow_search_start = window_end - timedelta(seconds=max_flow_period_seconds)

    # Initialize variables to track the strongest flow
    max_buy_flow = {
        'net_volume': -float('inf'), 'start_time': None, 'end_time': None, 
        'imbalance_ratio': 0.0, 'pressure': 0.0, 'reversal_volume': 0.0,
        'trade_intensity': 0.0, 'total_lt_volume': 0.0
    }
    max_sell_flow = {
        'net_volume': -float('inf'), 'start_time': None, 'end_time': None, 
        'imbalance_ratio': 0.0, 'pressure': 0.0, 'reversal_volume': 0.0,
        'trade_intensity': 0.0, 'total_lt_volume': 0.0
    }

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

        # Compute trade intensity (for LT trades only)
        lt_trades = flow_trades[flow_trades['is_lt']]
        num_lt_trades = len(lt_trades)
        mean_lt_volume = lt_trades['quantity'].mean() if num_lt_trades > 0 else 0.0
        trade_intensity = num_lt_trades * mean_lt_volume
        normalized_trade_intensity = trade_intensity / flow_window_seconds

        # Store window data for cumulative pressure
        window_data.append({
            'start_time': current_start,
            'end_time': current_end,
            'net_buy_volume': net_buying_volume,
            'net_sell_volume': net_selling_volume,
            'buy_sell_ratio': buy_sell_ratio,
            'sell_buy_ratio': sell_buy_ratio,
            'total_lt_volume': buy_lt_volume + sell_lt_volume
        })

        # Update strongest buying flow
        if buy_lt_volume >= min_volume and net_buying_volume >= min_net_volume:
            if net_buying_volume > max_buy_flow['net_volume']:
                max_buy_flow.update({
                    'net_volume': net_buying_volume,
                    'start_time': current_start,
                    'end_time': current_end,
                    'imbalance_ratio': buy_sell_ratio,
                    'trade_intensity': normalized_trade_intensity,
                    'total_lt_volume': buy_lt_volume + sell_lt_volume
                })

        # Update strongest selling flow
        if sell_lt_volume >= min_volume and net_selling_volume >= min_net_volume:
            if net_selling_volume > max_sell_flow['net_volume']:
                max_sell_flow.update({
                    'net_volume': net_selling_volume,
                    'start_time': current_start,
                    'end_time': current_end,
                    'imbalance_ratio': sell_buy_ratio,
                    'trade_intensity': normalized_trade_intensity,
                    'total_lt_volume': buy_lt_volume + sell_lt_volume
                })

        current_start += timedelta(seconds=1)

    # Compute cumulative pressure for each flow
    if window_data:
        for flow in [max_buy_flow, max_sell_flow]:
            if flow['start_time'] is not None:
                pressure = 0.0
                for window in window_data:
                    if window['start_time'] >= flow['start_time'] - timedelta(seconds=60):
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
        'ReversalVolume': max_buy_flow['reversal_volume'] if "ImbalanceFlowBuys-SignificantSell" in patterns else max_sell_flow['reversal_volume'],
        'TradeIntensity': max(max_buy_flow['trade_intensity'], max_sell_flow['trade_intensity'])
    }

def compute_support_signals_for_timestamp(timestamp, trades, volume_threshold):
    """Compute support signals for a single timestamp."""
    # Define the window for the current timestamp (±60 seconds)
    window_start = timestamp - timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
    window_end = timestamp + timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
    window_trades = trades[(trades['tradeTime'] >= window_start) & 
                           (trades['tradeTime'] <= window_end)].copy()
    result = {
        'timestamp': timestamp,
        'vwap_proximity': 0.0,
        'order_book_density': 0.0,
        'order_flow_acceleration': 0.0,
        'rejection_strength': 0.0,
        'cumulative_delta_divergence': 0.0,
        'order_flow_acceleration_value': 0.0
    }

    if window_trades.empty:
        return result

    # Compute 'is_lt' for window_trades
    window_trades.loc[:, 'is_lt'] = (window_trades['size_label_75'] == '75-100')

    # VWAP Proximity
    vwap_trades = trades[trades['tradeTime'] <= timestamp].sort_values('tradeTime', ascending=False).copy()
    cumulative_volume = 0.0
    price_volume_sum = 0.0
    total_volume = 0.0
    for _, trade in vwap_trades.iterrows():
        cumulative_volume += trade['quantity']
        price_volume_sum += trade['price'] * trade['quantity']
        total_volume += trade['quantity']
        if cumulative_volume >= volume_threshold:
            break
    current_price = window_trades['price'].iloc[-1] if not window_trades.empty else 0.0
    vwap = price_volume_sum / total_volume if total_volume > 0 else current_price
    vwap_proximity = abs(current_price - vwap) / vwap if vwap != 0 else 0.0
    result['vwap_proximity'] = vwap_proximity

    # Volume Heat Map (Order Book Density)
    heat_map_trades = vwap_trades.copy()
    cumulative_volume = 0.0
    heat_map = defaultdict(float)
    for _, trade in heat_map_trades.iterrows():
        cumulative_volume += trade['quantity']
        price_bin = round(trade['price'], 2)
        heat_map[price_bin] += trade['quantity']
        if cumulative_volume >= volume_threshold:
            break
    recent_trades = trades[trades['tradeTime'] <= timestamp].tail(100).copy()
    if len(recent_trades) >= 2:
        price_returns = recent_trades['price'].pct_change().dropna()
        price_std_dev = np.std(price_returns) * recent_trades['price'].iloc[-1]
    else:
        price_std_dev = 0.01 * current_price
    price_range = 1 * price_std_dev
    price_bins = [bin_price for bin_price in heat_map.keys() 
                  if current_price - price_range <= bin_price <= current_price + price_range]
    peak_volume_level = max(price_bins, key=lambda x: heat_map[x], default=current_price) if price_bins else current_price
    order_book_density = abs(current_price - peak_volume_level) / peak_volume_level if peak_volume_level != 0 else 0.0
    result['order_book_density'] = order_book_density

    # Order Flow Acceleration
    acceleration = 0.0
    recent_trades = trades[trades['tradeTime'] <= timestamp].tail(300).copy()
    if len(recent_trades) >= 300:
        recent_trades.loc[:, 'is_lt'] = (recent_trades['size_label_75'] == '75-100')
        window_1 = recent_trades.iloc[:100]
        window_2 = recent_trades.iloc[100:200]
        window_3 = recent_trades.iloc[200:300]
        buy_lt_1 = window_1[(window_1['size_label_75'] == '75-100') & 
                            (window_1['isBuyerMaker'] == 0) & 
                            (window_1['is_lt'])]['quantity'].sum()
        sell_lt_1 = window_1[(window_1['size_label_75'] == '75-100') & 
                             (window_1['isBuyerMaker'] == 1) & 
                             (window_1['is_lt'])]['quantity'].sum()
        net_volume_1 = buy_lt_1 - sell_lt_1
        buy_lt_2 = window_2[(window_2['size_label_75'] == '75-100') & 
                            (window_2['isBuyerMaker'] == 0) & 
                            (window_2['is_lt'])]['quantity'].sum()
        sell_lt_2 = window_2[(window_2['size_label_75'] == '75-100') & 
                             (window_2['isBuyerMaker'] == 1) & 
                             (window_2['is_lt'])]['quantity'].sum()
        net_volume_2 = buy_lt_2 - sell_lt_2
        buy_lt_3 = window_3[(window_3['size_label_75'] == '75-100') & 
                            (window_3['isBuyerMaker'] == 0) & 
                            (window_3['is_lt'])]['quantity'].sum()
        sell_lt_3 = window_3[(window_3['size_label_75'] == '75-100') & 
                             (window_3['isBuyerMaker'] == 1) & 
                             (window_3['is_lt'])]['quantity'].sum()
        net_volume_3 = buy_lt_3 - sell_lt_3
        time_diff_1_2 = (window_2['tradeTime'].iloc[-1] - window_1['tradeTime'].iloc[0]).total_seconds()
        time_diff_2_3 = (window_3['tradeTime'].iloc[-1] - window_2['tradeTime'].iloc[0]).total_seconds()
        if time_diff_1_2 > 0 and time_diff_2_3 > 0:
            velocity_1 = (net_volume_2 - net_volume_1) / time_diff_1_2
            velocity_2 = (net_volume_3 - net_volume_2) / time_diff_2_3
            acceleration = (velocity_2 - velocity_1) / time_diff_2_3
    result['order_flow_acceleration'] = acceleration
    result['order_flow_acceleration_value'] = acceleration

    # Price Rejection Pattern (using trade-based window)
    recent_trades = trades[trades['tradeTime'] <= timestamp].tail(100).copy()  # Approximate flow window
    if recent_trades.empty:
        total_lt_volume = 0.0
    else:
        recent_trades.loc[:, 'is_lt'] = (recent_trades['size_label_75'] == '75-100')
        total_lt_volume = recent_trades[recent_trades['is_lt']]['quantity'].sum()
    post_trades = trades[(trades['tradeTime'] > timestamp)].head(50).copy()  # Next 50 trades
    if post_trades.empty:
        rejection_strength = 0.0
    else:
        post_trades.loc[:, 'is_lt'] = (post_trades['size_label_75'] == '75-100')
        sell_lt_volume = post_trades[(post_trades['isBuyerMaker'] == 1) & 
                                     (post_trades['is_lt'])]['quantity'].sum()
        rejection_strength = sell_lt_volume / total_lt_volume if total_lt_volume > 0 else 0.0
    result['rejection_strength'] = rejection_strength

    # Cumulative Delta Divergence
    cumulative_delta = 0.0
    delta_trades = trades[trades['tradeTime'] <= timestamp].sort_values('tradeTime', ascending=False).copy()
    cumulative_volume = 0.0
    delta_values = []
    for _, trade in delta_trades.iterrows():
        cumulative_volume += trade['quantity']
        delta = trade['quantity'] if trade['isBuyerMaker'] == 0 else -trade['quantity']
        cumulative_delta += delta
        delta_values.append({'time': trade['tradeTime'], 'delta': cumulative_delta})
        if cumulative_volume >= volume_threshold:
            break
    recent_trades = trades[trades['tradeTime'] <= timestamp].tail(100).copy()
    if len(recent_trades) >= 100 and len(delta_values) >= 100:
        price_start = recent_trades['price'].iloc[0]
        price_end = recent_trades['price'].iloc[-1]
        price_trend = (price_end - price_start) / price_start if price_start != 0 else 0.0
        delta_start = delta_values[-100]['delta']
        delta_end = delta_values[-1]['delta']
        delta_trend = delta_end - delta_start
        divergence = np.sign(price_trend) * np.sign(delta_trend)
        divergence_active = 1.0 if divergence < 0 else 0.0
    else:
        divergence_active = 0.0
    result['cumulative_delta_divergence'] = divergence_active

    return result

def compute_support_signals(trades, timestamps):
    """Compute support signals across the given timestamps in parallel."""
    volume_threshold = compute_volume_threshold(trades)
    with Pool(processes=NUM_PROCESSES) as pool:
        process_func = partial(compute_support_signals_for_timestamp, trades=trades, volume_threshold=volume_threshold)
        results = pool.map(process_func, timestamps)

    # Organize results
    support_signals = {
        'vwap_proximity': [],
        'order_book_density': [],
        'order_flow_acceleration': [],
        'rejection_strength': [],
        'cumulative_delta_divergence': []
    }
    for res in results:
        support_signals['vwap_proximity'].append({
            'timestamp': res['timestamp'],
            'value': res['vwap_proximity']
        })
        support_signals['order_book_density'].append({
            'timestamp': res['timestamp'],
            'value': res['order_book_density']
        })
        support_signals['order_flow_acceleration'].append({
            'timestamp': res['timestamp'],
            'value': res['order_flow_acceleration']
        })
        support_signals['rejection_strength'].append({
            'timestamp': res['timestamp'],
            'value': res['rejection_strength']
        })
        support_signals['cumulative_delta_divergence'].append({
            'timestamp': res['timestamp'],
            'value': res['cumulative_delta_divergence']
        })

    # Process support signals to determine active periods
    active_signals = {key: [] for key in support_signals.keys()}
    for key in ['vwap_proximity', 'order_book_density', 'rejection_strength']:
        values = [s['value'] for s in support_signals[key]]
        timestamps = [s['timestamp'] for s in support_signals[key]]
        if values:
            threshold = np.percentile(values, 80)  # Top 20% (inversely for proximity and density)
            for i, (val, ts) in enumerate(zip(values, timestamps)):
                if key in ['vwap_proximity', 'order_book_density']:
                    active = 1 if val <= threshold else 0  # Smaller is better
                else:
                    active = 1 if val >= threshold else 0  # Larger is better
                active_signals[key].append({'timestamp': ts, 'active': active})

    # For Order Flow Acceleration (direction matters)
    accelerations = [s['value'] for s in support_signals['order_flow_acceleration']]
    accel_timestamps = [s['timestamp'] for s in support_signals['order_flow_acceleration']]
    if accelerations:
        accel_magnitudes = np.abs(accelerations)
        threshold = np.percentile(accel_magnitudes, 80)
        for i, (accel, ts) in enumerate(zip(accelerations, accel_timestamps)):
            if accel_magnitudes[i] >= threshold:
                active = 1  # Will determine direction based on flow type later
            else:
                active = 0
            active_signals['order_flow_acceleration'].append({'timestamp': ts, 'active': active, 'value': accel})

    # Cumulative Delta Divergence (already binary)
    for signal in support_signals['cumulative_delta_divergence']:
        active_signals['cumulative_delta_divergence'].append({
            'timestamp': signal['timestamp'],
            'active': signal['value']
        })

    return active_signals

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

# Process a single timestamp for main flow signal
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

# Identify true positive signals by matching to SHPs
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
    largest_trade_id = largest_trade['orderId']
    entry_price = largest_trade['price']
    
    # Define thresholds
    tp_threshold = entry_price * 0.98
    escape_threshold = entry_price * 0.995
    escape_recovery_threshold = entry_price * 1.002
    sl_threshold = entry_price * 1.005
    
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
    
    # Simulate trade
    for _, trade in subsequent_trades.iterrows():
        price = trade['price']
        trade_time = trade['tradeTime']
        
        if price < min_price:
            min_price = price
        if price > max_price:
            max_price = price
        
        if price <= tp_threshold:
            outcome = "TP"
            exit_price = price
            exit_time = trade_time
            break
        
        if price >= sl_threshold:
            outcome = "SL"
            exit_price = price
            exit_time = trade_time
            break
        
        if price <= escape_threshold:
            hit_escape_level = True
        if hit_escape_level and price >= escape_recovery_threshold:
            outcome = "Escape"
            exit_price = price
            exit_time = trade_time
            break
    
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

    # Detect main flow signals across the subset
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

    # Deduplicate main signals
    all_signals = deduplicate_signals(all_signals, FALSE_POSITIVE_CLUSTER_SECONDS)
    print(f"\nTotal main signals after deduplication: {len(all_signals)}")

    # Compute support signals across all timestamps
    print("\nComputing support signals across the subset database:")
    support_signals = compute_support_signals(trades, timestamps)

    # Analyze support signals for true positives independently
    support_tp_counts = {
        'vwap_proximity': {'true': 0, 'false': 0},
        'order_book_density': {'true': 0, 'false': 0},
        'order_flow_acceleration': {'true': 0, 'false': 0},
        'rejection_strength': {'true': 0, 'false': 0},
        'cumulative_delta_divergence': {'true': 0, 'false': 0}
    }

    for signal_name, signal_data in support_signals.items():
        for signal in signal_data:
            ts = signal['timestamp']
            active = signal['active']
            if not active:
                continue
            # Check if the support signal window contains an SHP
            window_start = ts - timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
            window_end = ts + timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
            is_true_positive = any(window_start <= tp <= window_end for tp in subset_true_positive_timestamps)
            if is_true_positive:
                support_tp_counts[signal_name]['true'] += 1
            else:
                support_tp_counts[signal_name]['false'] += 1

    print("\nSupport signals true/false positive counts (standalone):")
    for signal_name, counts in support_tp_counts.items():
        total = counts['true'] + counts['false']
        true_rate = counts['true'] / total if total > 0 else 0.0
        print(f"{signal_name}: True Positives = {counts['true']}, False Positives = {counts['false']}, True Positive Rate = {true_rate:.2%}")

    # Combine support signals with main signals
    output_data = []
    for main_signal in all_signals:
        main_ts = main_signal['Timestamp']
        window_start = main_ts - timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
        window_end = main_ts + timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)

        # Check for true positive
        is_true_positive = any(window_start <= tp <= window_end for tp in subset_true_positive_timestamps)

        # Check which support signals are active in the same window
        active_support = {
            'vwap_proximity': 0,
            'order_book_density': 0,
            'order_flow_acceleration': 0,
            'rejection_strength': 0,
            'cumulative_delta_divergence': 0
        }

        for signal_name, signal_data in support_signals.items():
            for signal in signal_data:
                support_ts = signal['timestamp']
                support_window_start = support_ts - timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
                support_window_end = support_ts + timedelta(seconds=SUPPORT_SIGNAL_WINDOW_SECONDS // 2)
                # Check for overlap between main signal window and support signal window
                if (support_window_start <= window_end and support_window_end >= window_start):
                    if signal_name == 'order_flow_acceleration':
                        if signal['active']:
                            accel_value = signal['value']
                            if "ImbalanceFlowBuys-SignificantSell" in main_signal['Patterns']:
                                if accel_value < 0:
                                    active_support[signal_name] = 1
                            else:
                                if accel_value > 0:
                                    active_support[signal_name] = 1
                    else:
                        active_support[signal_name] = max(active_support[signal_name], signal['active'])

        # Simulate trade to get outcome
        trade_result = simulate_trade(main_signal, trades)
        outcome = trade_result['Outcome'] if trade_result else "Not Executed"

        # Prepare output row
        output_row = {
            'MainSignalTimestamp': main_ts,
            'Patterns': main_signal['Patterns'][0] if len(main_signal['Patterns']) == 1 else 'Both',
            'IsTruePositive': is_true_positive,
            'TradeOutcome': outcome,
            'VWAPProximityActive': active_support['vwap_proximity'],
            'OrderBookDensityActive': active_support['order_book_density'],
            'OrderFlowAccelerationActive': active_support['order_flow_acceleration'],
            'RejectionStrengthActive': active_support['rejection_strength'],
            'CumulativeDeltaDivergenceActive': active_support['cumulative_delta_divergence']
        }
        output_data.append(output_row)

    # Save results to CSV
    output_df = pd.DataFrame(output_data)
    output_df['MainSignalTimestamp'] = output_df['MainSignalTimestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')
    output_df.to_csv('support_signal_analysis_v5.csv', index=False)
    print("\nSupport signal analysis saved to 'support_signal_analysis_v5.csv'.")
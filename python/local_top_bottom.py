import pandas as pd
import sqlite3
import numpy as np
import torch
from multiprocessing import Pool
from datetime import datetime
import random

# Database path
db_path = '../trades.db'  # Replace with your actual database path

# Flag to use 99th percentile trades or all trades
USE_99TH_PERCENTILE = True

# Look-ahead windows (in minutes and milliseconds)
WINDOWS = {
    10: 600000,
    30: 1800000,
    60: 3600000,
    90: 5400000
}

# Global caches
TRADE_DATA_CACHE = None
VOLUME_CACHE = {}
VOLUME_PERCENTILE = None

# Function to fetch price and trade data
def get_trade_data(start_time):
    try:
        query = """
        SELECT tradeTime, price, quantity, isBuyerMaker,
               CASE WHEN isBuyerMaker = 1 THEN 'buy' ELSE 'sell' END AS trade_type,
               (price * quantity) AS value
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ?
        ORDER BY tradeTime
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(start_time,))
        return df
    except Exception as e:
        print(f"Error fetching trade data: {e}")
        return pd.DataFrame()

# Function to fetch order flow data
def get_order_flow(trade_time, window_ms, direction='before'):
    try:
        if direction == 'before':
            start_time = trade_time - window_ms
            end_time = trade_time
        else:
            start_time = trade_time
            end_time = trade_time + window_ms
        query = """
        SELECT tradeTime, quantity, isBuyerMaker, price
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ? AND tradeTime < ?
        ORDER BY tradeTime
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(start_time, end_time))
        return df
    except Exception as e:
        print(f"Error fetching order flow for tradeTime {trade_time}: {e}")
        return pd.DataFrame()

# Function to detect local tops and bottoms
def detect_tops_bottoms(price_df, look_ahead_ms):
    tops = []
    bottoms = []
    price_threshold = 0.01  # 1.0%
    
    for i in range(len(price_df)):
        current_time = price_df['tradeTime'].iloc[i]
        current_price = price_df['price'].iloc[i]
        
        look_ahead = price_df[
            (price_df['tradeTime'] > current_time) & 
            (price_df['tradeTime'] <= current_time + look_ahead_ms)
        ]
        
        if look_ahead.empty:
            continue
        
        min_price = look_ahead['price'].min()
        max_price = look_ahead['price'].max()
        
        if min_price <= current_price * (1 - price_threshold):
            tops.append({
                'tradeTime': current_time,
                'price': current_price,
                'type': 'top'
            })
        
        if max_price >= current_price * (1 + price_threshold):
            bottoms.append({
                'tradeTime': current_time,
                'price': current_price,
                'type': 'bottom'
            })
    
    return tops, bottoms

# Function to analyze trade characteristics with filters
def analyze_event(args):
    event_time, event_price, event_type, high_value_trades = args
    global TRADE_DATA_CACHE, VOLUME_PERCENTILE
    trade_data = TRADE_DATA_CACHE
    
    before_window = 120000
    after_window = 120000
    
    before_flow = get_order_flow(event_time, before_window, 'before')
    if not before_flow.empty:
        net_flow_before = (before_flow['quantity'] * (2 * (before_flow['isBuyerMaker'] == 0) - 1)).sum()
        delta_before = net_flow_before
        volume_before = before_flow['quantity'].sum()
    else:
        net_flow_before = delta_before = volume_before = 0
    
    during_trades = trade_data[
        (trade_data['tradeTime'] >= event_time - 1000) & 
        (trade_data['tradeTime'] <= event_time + 1000)
    ]
    if not during_trades.empty:
        delta_during = (during_trades['quantity'] * (2 * (during_trades['isBuyerMaker'] == 0) - 1)).sum()
        volume_during = during_trades['quantity'].sum()
    else:
        delta_during = volume_during = 0
    
    after_flow = get_order_flow(event_time, after_window, 'after')
    if not after_flow.empty:
        net_flow_after = (after_flow['quantity'] * (2 * (after_flow['isBuyerMaker'] == 0) - 1)).sum()
        delta_after = net_flow_after
        volume_after = after_flow['quantity'].sum()
        after_prices = after_flow['price'].values
        price_reversal = False
        if len(after_prices) > 0:
            confirm_price = after_prices[-1]
            price_reversal = (confirm_price >= event_price * 1.003) if event_type == 'bottom' else (confirm_price <= event_price * 0.997)
    else:
        net_flow_after = delta_after = volume_after = 0
        price_reversal = False
    
    volume_data = get_order_flow(event_time, 900000)
    volume_climax = False
    if not volume_data.empty:
        volume = volume_data['quantity'].sum()
        if VOLUME_PERCENTILE is not None and volume > VOLUME_PERCENTILE:
            volume_climax = True
    
    order_flow = get_order_flow(event_time, 600000)
    order_flow_valid = False
    if not order_flow.empty:
        net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
        order_flow_valid = (event_type == 'bottom' and net_flow <= -1500) or (event_type == 'top' and net_flow >= 1500)
    
    event_trades = high_value_trades[
        (high_value_trades['tradeTime'] >= event_time - 1000) &
        (high_value_trades['tradeTime'] <= event_time + 1000)
    ]
    
    results = []
    for _, trade in event_trades.iterrows():
        trade_type = trade['trade_type']
        trade_price = trade['price']
        
        confirm_trades = get_price_series(event_time)[:120]
        if len(confirm_trades) < 5:
            continue
        confirm_price = confirm_trades[-1]
        price_reversal_filter = (trade_type == 'buy' and confirm_price >= trade_price * 1.003 and event_type == 'bottom') or \
                               (trade_type == 'sell' and confirm_price <= trade_price * 0.997 and event_type == 'top')
        if not price_reversal_filter:
            continue
        
        if not order_flow_valid:
            continue
        
        if volume_climax:
            continue
        
        outcome = check_trade_outcome(trade['tradeTime'], trade_type, trade_price)
        if outcome:
            results.append({
                'tradeTime': event_time,
                'event_price': event_price,
                'event_type': event_type,
                'net_flow_before': net_flow_before,
                'delta_before': delta_before,
                'volume_before': volume_before,
                'delta_during': delta_during,
                'volume_during': volume_during,
                'net_flow_after': net_flow_after,
                'delta_after': delta_after,
                'volume_after': volume_after,
                'price_reversal': price_reversal,
                'trade_id': trade['value'],
                'trade_type': trade_type,
                'trade_price': trade_price,
                'outcome': outcome
            })
    
    return results

# Function to check trade outcome
def check_trade_outcome(trade_time, trade_type, entry_price):
    try:
        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            return None
        
        prices = torch.tensor(price_series, dtype=torch.float32)
        entry_price = torch.tensor(entry_price, dtype=torch.float32)
        
        if trade_type == 'buy':
            tp_threshold = entry_price * 1.01
            sl_threshold = entry_price * 0.99
            tp_hit = prices >= tp_threshold
            sl_hit = prices <= sl_threshold
        else:
            tp_threshold = entry_price * 0.99
            sl_threshold = entry_price * 1.01
            tp_hit = prices <= tp_threshold
            sl_hit = prices >= sl_threshold
        
        tp_indices = torch.where(tp_hit)[0]
        sl_indices = torch.where(sl_hit)[0]
        
        if len(tp_indices) > 0 and (len(sl_indices) == 0 or tp_indices[0] < sl_indices[0]):
            return 'TP First'
        elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
            return 'SL First'
        return None
    except Exception as e:
        print(f"Error checking outcome for tradeTime {trade_time}: {e}")
        return None

# Function to get price series
def get_price_series(trade_time):
    try:
        query = """
        SELECT price
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ?
        ORDER BY tradeTime
        """
        with sqlite3.connect(db_path) as conn:
            price_df = pd.read_sql_query(query, conn, params=(trade_time,))
        return price_df['price'].values
    except Exception as e:
        print(f"Error fetching price series for tradeTime {trade_time}: {e}")
        return np.array([])

# Main processing function
def process_tops_bottoms():
    global TRADE_DATA_CACHE, VOLUME_CACHE, VOLUME_PERCENTILE
    start_time = int(datetime(2025, 1, 27).timestamp() * 1000)
    TRADE_DATA_CACHE = get_trade_data(start_time)
    
    if TRADE_DATA_CACHE.empty:
        print("No trade data found")
        return
    
    # Precompute volume percentile
    sample_times = TRADE_DATA_CACHE['tradeTime'].sample(min(1000, len(TRADE_DATA_CACHE))).values
    for t in sample_times:
        v_data = get_order_flow(t, 900000)
        if not v_data.empty:
            VOLUME_CACHE[t] = v_data['quantity'].sum()
    VOLUME_PERCENTILE = np.percentile(list(VOLUME_CACHE.values()), 85) if VOLUME_CACHE else float('inf')
    print(f"Volume percentile (85th): {VOLUME_PERCENTILE}")
    
    if USE_99TH_PERCENTILE:
        value_threshold = np.percentile(TRADE_DATA_CACHE['value'], 99)
        high_value_trades = TRADE_DATA_CACHE[TRADE_DATA_CACHE['value'] >= value_threshold]
        print(f"Using 99th percentile trades: {len(high_value_trades)} trades")
    else:
        high_value_trades = TRADE_DATA_CACHE
        print(f"Using all trades: {len(high_value_trades)} trades")
    
    for window_min, window_ms in WINDOWS.items():
        print(f"\nProcessing window: {window_min} minutes")
        
        tops, bottoms = detect_tops_bottoms(TRADE_DATA_CACHE, window_ms)
        events = tops + bottoms
        print(f"Detected {len(tops)} tops and {len(bottoms)} bottoms")
        
        # Sample events to reduce processing time
        events = random.sample(events, min(10000, len(events)))
        print(f"Sampling {len(events)} events")
        
        event_args = [(e['tradeTime'], e['price'], e['type'], high_value_trades) for e in events]
        
        batch_size = 500
        event_results = []
        with Pool(processes=8) as pool:
            for i in range(0, len(event_args), batch_size):
                batch_args = event_args[i:i + batch_size]
                batch_results = pool.map(analyze_event, batch_args)
                for result in batch_results:
                    event_results.extend(result)
                print(f"Processed batch {i // batch_size + 1}/{len(event_args) // batch_size + 1}, Trades: {len(event_results)}")
        
        results_df = pd.DataFrame(event_results)
        if results_df.empty:
            print(f"No trades found at tops/bottoms for {window_min}-minute window")
            continue
        
        results_df.to_csv(f'ltcusdt_top_bottom_{window_min}min.csv', index=False)
        
        for event_type in ['top', 'bottom']:
            event_df = results_df[results_df['event_type'] == event_type]
            if event_df.empty:
                print(f"\nNo trades at {event_type}s for {window_min}-minute window")
                continue
            
            buy_trades = event_df[event_df['trade_type'] == 'buy']
            sell_trades = event_df[event_df['trade_type'] == 'sell']
            
            buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
            sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
            
            print(f"\nTrade Outcome Analysis at {event_type.capitalize()}s (LTCUSDT, {window_min}-Minute Window):")
            print(f"Total Closed Trades: {len(event_df)}")
            print(f"Buy Trades: {len(buy_trades)}")
            print("Buy Outcome Percentages:")
            print(f"  +1% First (TP First): {buy_outcomes.get('TP First', 0):.2f}%")
            print(f"  -1% First (SL First): {buy_outcomes.get('SL First', 0):.2f}%")
            print(f"Sell Trades: {len(sell_trades)}")
            print("Sell Outcome Percentages:")
            print(f"  +1% First (TP First): {sell_outcomes.get('TP First', 0):.2f}%")
            print(f"  -1% First (SL First): {sell_outcomes.get('SL First', 0):.2f}%")
            
            print(f"\nCommon Patterns at {event_type.capitalize()}s:")
            print(f"Avg Net Flow Before: {event_df['net_flow_before'].mean():.2f}")
            print(f"Avg Delta Before: {event_df['delta_before'].mean():.2f}")
            print(f"Avg Volume Before: {event_df['volume_before'].mean():.2f}")
            print(f"Avg Delta During: {event_df['delta_during'].mean():.2f}")
            print(f"Avg Volume During: {event_df['volume_during'].mean():.2f}")
            print(f"Avg Net Flow After: {event_df['net_flow_after'].mean():.2f}")
            print(f"Price Reversal Rate: {(event_df['price_reversal'].mean() * 100):.2f}%")

if __name__ == '__main__':
    process_tops_bottoms()
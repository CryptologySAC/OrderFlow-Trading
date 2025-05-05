import pandas as pd
import sqlite3
import numpy as np
import torch
from datetime import datetime
from itertools import product

# Script version
SCRIPT_VERSION = "1.2.0"

# Database path
db_path = '../trades.db'

# Grid search parameters
NET_FLOW_THRESHOLDS = [3000]
PRICE_PROXIMITIES = [0.025, 0.05, 0.1]
TIME_WINDOW_MS = 300000  # 5 minutes
BUFFER_MS = 2000  # 2-second buffer for entry price
OFFSET_MS = 100  # Small offset to exclude signal price

# Function to fetch trade data
def get_trade_data(start_time):
    try:
        query = """
        SELECT aggregatedTradeId, tradeTime, price, quantity, isBuyerMaker,
               CASE WHEN isBuyerMaker = 1 THEN 'buy' ELSE 'sell' END AS trade_type,
               (price * quantity) AS value
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ?
        ORDER BY tradeTime
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(start_time,))
        print(f"Retrieved {len(df)} trades from get_trade_data")
        return df
    except Exception as e:
        print(f"Error fetching trade data: {e}")
        return pd.DataFrame()

# Function to fetch order flow data
def get_order_flow(trade_time, window_ms):
    try:
        query = """
        SELECT tradeTime, quantity, isBuyerMaker, price
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ? AND tradeTime < ?
        ORDER BY tradeTime
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(trade_time - window_ms, trade_time))
        return df
    except Exception as e:
        print(f"Error fetching order flow for tradeTime {trade_time}: {e}")
        return pd.DataFrame()

# Function to get price series between two times
def get_price_series(start_time, end_time=None):
    try:
        query = """
        SELECT price, tradeTime
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ?
        """
        params = [start_time]
        if end_time is not None:
            query += " AND tradeTime < ?"
            params.append(end_time)
        query += " ORDER BY tradeTime"
        with sqlite3.connect(db_path) as conn:
            price_df = pd.read_sql_query(query, conn, params=params)
        return price_df['price'].values, price_df['tradeTime'].values
    except Exception as e:
        print(f"Error fetching price series for start_time {start_time}: {e}")
        return np.array([]), np.array([])

# Function to get entry price after buffer
def get_entry_price(trade_time, signal_price, buffer_ms):
    try:
        query = """
        SELECT price
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ?
        ORDER BY tradeTime
        LIMIT 1
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(trade_time + buffer_ms,))
        if df.empty:
            print(f"No trade found after buffer for tradeTime {trade_time}")
            return None, None
        execution_price = df['price'].iloc[0]
        # Calculate price difference percentage
        price_diff_percent = ((execution_price - signal_price) / signal_price) * 100
        return execution_price, price_diff_percent
    except Exception as e:
        print(f"Error fetching entry price for tradeTime {trade_time}: {e}")
        return None, None

# Function to check trade outcome for Price Level Imbalance
def check_trade_outcome(args, active_signal=None):
    trade_id, trade_type, signal_price, trade_time, net_flow_threshold, price_proximity = args
    try:
        order_flow = get_order_flow(trade_time, TIME_WINDOW_MS)
        if order_flow.empty:
            return None, active_signal
        net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
        if abs(signal_price - round(signal_price)) > price_proximity:
            return None, active_signal
        if (trade_type == 'buy' and net_flow > -net_flow_threshold) or (trade_type == 'sell' and net_flow < net_flow_threshold):
            return None, active_signal

        # Convert trade_time (ms) to datetime and extract date, day of week
        trade_datetime = datetime.fromtimestamp(trade_time / 1000)
        trade_date = trade_datetime.date().isoformat()
        day_of_week = trade_datetime.strftime('%A')

        # If there's an active signal, check if this signal closes it
        outcome = None
        if active_signal is not None:
            # Check if new signal closes active signal
            if (active_signal['trade_type'] == 'buy' and trade_type == 'sell') or \
               (active_signal['trade_type'] == 'sell' and trade_type == 'buy'):
                # Get price series from active signal's start + offset to current trade time
                price_series, time_series = get_price_series(active_signal['trade_time'] + OFFSET_MS, trade_time)
                if len(price_series) == 0:
                    print(f"Trade {trade_id}: Empty price series for active signal {active_signal['trade_id']}")
                    return None, active_signal
                
                prices = torch.tensor(price_series, dtype=torch.float32)
                
                if active_signal['trade_type'] == 'buy':
                    tp_hit = prices >= active_signal['updated_tp_price']
                    sl_hit = prices <= active_signal['sl_price']
                else:
                    tp_hit = prices <= active_signal['updated_tp_price']
                    sl_hit = prices >= active_signal['sl_price']
                
                tp_indices = torch.where(tp_hit)[0]
                sl_indices = torch.where(sl_hit)[0]
                
                close_time = trade_time  # Default to current trade time
                if len(tp_indices) > 0 and (len(sl_indices) == 0 or tp_indices[0] < sl_indices[0]):
                    close_time = time_series[tp_indices[0]] if len(tp_indices) > 0 else close_time
                    outcome = {
                        'trade_id': active_signal['trade_id'],
                        'trade_type': active_signal['trade_type'],
                        'outcome': 'TP First',
                        'net_flow_threshold': active_signal['net_flow_threshold'],
                        'price_proximity': active_signal['price_proximity'],
                        'trade_time': active_signal['trade_time'],
                        'date': active_signal['date'],
                        'day_of_week': active_signal['day_of_week'],
                        'entry_time': active_signal['entry_time'],
                        'original_tp_price': active_signal['original_tp_price'],
                        'updated_tp_price': active_signal['updated_tp_price'],
                        'signal_close_time': close_time,
                        'price_diff_percent': active_signal['price_diff_percent'],
                        'script_version': SCRIPT_VERSION
                    }
                    print(f"Trade {active_signal['trade_id']}: Closed with TP First by {trade_id} at {datetime.fromtimestamp(close_time / 1000)}")
                    active_signal = None  # Clear active signal
                elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < sl_indices[0]):
                    close_time = time_series[sl_indices[0]] if len(sl_indices) > 0 else close_time
                    outcome = {
                        'trade_id': active_signal['trade_id'],
                        'trade_type': active_signal['trade_type'],
                        'outcome': 'SL First',
                        'net_flow_threshold': active_signal['net_flow_threshold'],
                        'price_proximity': active_signal['price_proximity'],
                        'trade_time': active_signal['trade_time'],
                        'date': active_signal['date'],
                        'day_of_week': active_signal['day_of_week'],
                        'entry_time': active_signal['entry_time'],
                        'original_tp_price': active_signal['original_tp_price'],
                        'updated_tp_price': active_signal['updated_tp_price'],
                        'signal_close_time': close_time,
                        'price_diff_percent': active_signal['price_diff_percent'],
                        'script_version': SCRIPT_VERSION
                    }
                    print(f"Trade {active_signal['trade_id']}: Closed with SL First by {trade_id} at {datetime.fromtimestamp(close_time / 1000)}")
                    active_signal = None  # Clear active signal
                else:
                    # No closure, proceed to evaluate new signal
                    pass
            elif active_signal['trade_type'] == trade_type:
                # Consecutive signal: update TP
                if trade_type == 'buy':
                    new_tp_price = signal_price * 1.01
                else:
                    new_tp_price = signal_price * 0.99
                active_signal['updated_tp_price'] = new_tp_price
                print(f"Trade {trade_id}: Updated TP for active {trade_type} signal {active_signal['trade_id']} to {new_tp_price}")
                return None, active_signal
            else:
                # Same-type signal but not consecutive (shouldn't happen)
                print(f"Trade {trade_id}: Ignored due to active {active_signal['trade_type']} signal")
                return None, active_signal

        # If no active signal or previous signal was closed, evaluate new signal
        if active_signal is None:
            # Get entry price after buffer
            execution_price, price_diff_percent = get_entry_price(trade_time, signal_price, BUFFER_MS)
            if execution_price is None:
                print(f"Trade {trade_id}: No entry price after buffer")
                return None, active_signal
            entry_time = trade_time + BUFFER_MS

            # Set TP and SL for new signal
            if trade_type == 'buy':
                original_tp_price = updated_tp_price = execution_price * 1.01
                sl_price = execution_price * 0.99
            else:
                original_tp_price = updated_tp_price = execution_price * 0.99
                sl_price = execution_price * 1.01

            # Store new active signal
            active_signal = {
                'trade_id': trade_id,
                'trade_type': trade_type,
                'entry_price': execution_price,
                'original_tp_price': original_tp_price,
                'updated_tp_price': updated_tp_price,
                'sl_price': sl_price,
                'trade_time': trade_time,
                'entry_time': entry_time,
                'date': trade_date,
                'day_of_week': day_of_week,
                'net_flow_threshold': net_flow_threshold,
                'price_proximity': price_proximity,
                'price_diff_percent': price_diff_percent
            }
            print(f"Trade {trade_id}: Opened new {trade_type} signal at {trade_datetime} with entry price {execution_price}, price diff {price_diff_percent:.2f}%")
            return None, active_signal

        return outcome, active_signal
    except Exception as e:
        print(f"Error processing trade {trade_id}: {e}")
        return None, active_signal

# Main processing function
def process_grid_search():
    start_time = int(datetime(2025, 1, 27).timestamp() * 1000)
    trade_data = get_trade_data(start_time)
    
    if trade_data.empty:
        print("No trades found in database")
        return
    
    value_threshold = np.percentile(trade_data['value'], 99)
    trades_df = trade_data[trade_data['value'] >= value_threshold]
    
    print(f"Processing {len(trades_df)} 99th percentile trades...")
    
    results = []
    for net_flow_threshold, price_proximity in product(NET_FLOW_THRESHOLDS, PRICE_PROXIMITIES):
        print(f"\nRunning Price Level Imbalance: net_flow={net_flow_threshold}, proximity={price_proximity}")
        # Sort trades by tradeTime for sequential processing
        args = [
            (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'], net_flow_threshold, price_proximity)
            for _, row in trades_df.sort_values('tradeTime').iterrows()
        ]
        
        outcomes = []
        active_signal = None
        batch_size = 500
        for i in range(0, len(args), batch_size):
            batch_args = args[i:i + batch_size]
            batch_closed = []
            for arg in batch_args:
                outcome, active_signal = check_trade_outcome(arg, active_signal)
                if outcome is not None:
                    batch_closed.append(outcome)
            outcomes.extend(batch_closed)
            print(f"Processed batch {i // batch_size + 1}/{len(args) // batch_size + 1}, Batch closed trades: {len(batch_closed)}, Total closed trades: {len(outcomes)}")
        
        # Check if final active signal closes
        if active_signal is not None:
            price_series, time_series = get_price_series(active_signal['trade_time'] + OFFSET_MS)
            if len(price_series) == 0:
                print(f"Final active signal {active_signal['trade_id']} skipped: Empty price series")
            else:
                prices = torch.tensor(price_series, dtype=torch.float32)
                if active_signal['trade_type'] == 'buy':
                    tp_hit = prices >= active_signal['updated_tp_price']
                    sl_hit = prices <= active_signal['sl_price']
                else:
                    tp_hit = prices <= active_signal['updated_tp_price']
                    sl_hit = prices >= active_signal['sl_price']
                
                tp_indices = torch.where(tp_hit)[0]
                sl_indices = torch.where(sl_hit)[0]
                
                close_time = active_signal['trade_time'] + OFFSET_MS  # Default
                if len(tp_indices) > 0 and (len(sl_indices) == 0 or tp_indices[0] < sl_indices[0]):
                    close_time = time_series[tp_indices[0]] if len(tp_indices) > 0 else close_time
                    outcomes.append({
                        'trade_id': active_signal['trade_id'],
                        'trade_type': active_signal['trade_type'],
                        'outcome': 'TP First',
                        'net_flow_threshold': active_signal['net_flow_threshold'],
                        'price_proximity': active_signal['price_proximity'],
                        'trade_time': active_signal['trade_time'],
                        'date': active_signal['date'],
                        'day_of_week': active_signal['day_of_week'],
                        'entry_time': active_signal['entry_time'],
                        'original_tp_price': active_signal['original_tp_price'],
                        'updated_tp_price': active_signal['updated_tp_price'],
                        'signal_close_time': close_time,
                        'price_diff_percent': active_signal['price_diff_percent'],
                        'script_version': SCRIPT_VERSION
                    })
                    print(f"Final active signal {active_signal['trade_id']}: Closed with TP First at {datetime.fromtimestamp(close_time / 1000)}")
                elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
                    close_time = time_series[sl_indices[0]] if len(sl_indices) > 0 else close_time
                    outcomes.append({
                        'trade_id': active_signal['trade_id'],
                        'trade_type': active_signal['trade_type'],
                        'outcome': 'SL First',
                        'net_flow_threshold': active_signal['net_flow_threshold'],
                        'price_proximity': active_signal['price_proximity'],
                        'trade_time': active_signal['trade_time'],
                        'date': active_signal['date'],
                        'day_of_week': active_signal['day_of_week'],
                        'entry_time': active_signal['entry_time'],
                        'original_tp_price': active_signal['original_tp_price'],
                        'updated_tp_price': active_signal['updated_tp_price'],
                        'signal_close_time': close_time,
                        'price_diff_percent': active_signal['price_diff_percent'],
                        'script_version': SCRIPT_VERSION
                    })
                    print(f"Final active signal {active_signal['trade_id']}: Closed with SL First at {datetime.fromtimestamp(close_time / 1000)}")
        
        outcome_df = pd.DataFrame(outcomes)
        if outcome_df.empty:
            print(f"No closed trades for net_flow={net_flow_threshold}, proximity={price_proximity}")
            continue
        
        buy_trades = outcome_df[outcome_df['trade_type'] == 'buy']
        sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
        
        buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
        sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
        
        buy_tp_percent = buy_outcomes.get('TP First', 0)
        buy_sl_percent = buy_outcomes.get('SL First', 0)
        sell_tp_percent = sell_outcomes.get('TP First', 0)
        sell_sl_percent = sell_outcomes.get('SL First', 0)
        
        # Interpret signals based on insight
        buy_action = 'sell' if buy_sl_percent > buy_tp_percent else 'buy'
        buy_effective_tp = buy_sl_percent if buy_sl_percent > buy_tp_percent else buy_tp_percent
        sell_action = 'buy' if sell_sl_percent > sell_tp_percent else 'sell'
        sell_effective_tp = sell_sl_percent if sell_sl_percent > sell_tp_percent else sell_tp_percent
        
        result = {
            'net_flow_threshold': net_flow_threshold,
            'price_proximity': price_proximity,
            'total_trades': len(outcome_df),
            'buy_trades': len(buy_trades),
            'buy_tp_percent': buy_tp_percent,
            'buy_sl_percent': buy_sl_percent,
            'sell_trades': len(sell_trades),
            'sell_tp_percent': sell_tp_percent,
            'sell_sl_percent': sell_sl_percent,
            'script_version': SCRIPT_VERSION
        }
        results.append(result)
        
        # Print updated summary
        print(f"Buy Signals: Preferred action: {buy_action}, Effective TP: {buy_effective_tp:.2f}%")
        print(f"Sell Signals: Preferred action: {sell_action}, Effective TP: {sell_effective_tp:.2f}%")
        
        # Save individual CSV with new fields
        outcome_df.to_csv(f'ltcusdt_price_level_imbalance_flow_{net_flow_threshold}_prox_{price_proximity}_v{SCRIPT_VERSION}.csv', index=False)
    
    # Save summary CSV
    summary_df = pd.DataFrame(results)
    summary_df.to_csv(f'ltcusdt_price_level_imbalance_grid_summary_v{SCRIPT_VERSION}.csv', index=False)

if __name__ == '__main__':
    process_grid_search()
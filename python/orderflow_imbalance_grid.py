import pandas as pd
import sqlite3
import numpy as np
import torch
from multiprocessing import Pool
from datetime import datetime
from itertools import product

# Database path
db_path = '../trades.db'

# Grid search parameters
NET_FLOW_THRESHOLDS = [3000]
PRICE_PROXIMITIES = [0.025, 0.05, 0.1]
TIME_WINDOW_MS = 300000  # 5 minutes

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

# Function to check trade outcome for Price Level Imbalance
def check_trade_outcome(args):
    trade_id, trade_type, entry_price, trade_time, net_flow_threshold, price_proximity = args
    try:
        order_flow = get_order_flow(trade_time, TIME_WINDOW_MS)
        if order_flow.empty:
            return None
        net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
        if abs(entry_price - round(entry_price)) > price_proximity:
            return None
        if (trade_type == 'buy' and net_flow > -net_flow_threshold) or (trade_type == 'sell' and net_flow < net_flow_threshold):
            return None

        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            print(f"Trade {trade_id} skipped: Empty price series")
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
            return {
                'trade_id': trade_id,
                'trade_type': trade_type,
                'outcome': 'TP First',
                'net_flow_threshold': net_flow_threshold,
                'price_proximity': price_proximity
            }
        elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
            return {
                'trade_id': trade_id,
                'trade_type': trade_type,
                'outcome': 'SL First',
                'net_flow_threshold': net_flow_threshold,
                'price_proximity': price_proximity
            }
        print(f"Trade {trade_id} not closed")
        return None
    except Exception as e:
        print(f"Error processing trade {trade_id}: {e}")
        return None

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
    
    # Grid search combinations
    results = []
    for net_flow_threshold, price_proximity in product(NET_FLOW_THRESHOLDS, PRICE_PROXIMITIES):
        print(f"\nRunning Price Level Imbalance: net_flow={net_flow_threshold}, proximity={price_proximity}")
        args = [
            (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'], net_flow_threshold, price_proximity)
            for _, row in trades_df.iterrows()
        ]
        
        batch_size = 500
        outcomes = []
        with Pool(processes=8) as pool:
            for i in range(0, len(args), batch_size):
                batch_args = args[i:i + batch_size]
                batch_results = pool.map(check_trade_outcome, batch_args)
                outcomes.extend([r for r in batch_results if r is not None])
                print(f"Processed batch {i // batch_size + 1}/{len(args) // batch_size + 1}, Closed trades: {len(outcomes)}")
        
        outcome_df = pd.DataFrame(outcomes)
        if outcome_df.empty:
            print(f"No closed trades for net_flow={net_flow_threshold}, proximity={price_proximity}")
            continue
        
        buy_trades = outcome_df[outcome_df['trade_type'] == 'buy']
        sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
        
        buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
        sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
        
        result = {
            'net_flow_threshold': net_flow_threshold,
            'price_proximity': price_proximity,
            'total_trades': len(outcome_df),
            'buy_trades': len(buy_trades),
            'buy_tp_percent': buy_outcomes.get('TP First', 0),
            'buy_sl_percent': buy_outcomes.get('SL First', 0),
            'sell_trades': len(sell_trades),
            'sell_tp_percent': sell_outcomes.get('TP First', 0),
            'sell_sl_percent': sell_outcomes.get('SL First', 0)
        }
        results.append(result)
        
        # Save individual CSV
        outcome_df.to_csv(f'ltcusdt_price_level_imbalance_flow_{net_flow_threshold}_prox_{price_proximity}.csv', index=False)
    
    # Save summary CSV
    summary_df = pd.DataFrame(results)
    summary_df.to_csv('ltcusdt_price_level_imbalance_grid_summary.csv', index=False)
    
    # Print summary
    for _, row in summary_df.iterrows():
        print(f"\nPrice Level Imbalance (net_flow={row['net_flow_threshold']}, proximity={row['price_proximity']}):")
        print(f"Total Closed Trades: {row['total_trades']}")
        print(f"Buy Trades: {row['buy_trades']}")
        print(f"Buy Outcome Percentages: TP First: {row['buy_tp_percent']:.2f}%, SL First: {row['buy_sl_percent']:.2f}%")
        print(f"Sell Trades: {row['sell_trades']}")
        print(f"Sell Outcome Percentages: TP First: {row['sell_tp_percent']:.2f}%, SL First: {row['sell_sl_percent']:.2f}%")

if __name__ == '__main__':
    process_grid_search()
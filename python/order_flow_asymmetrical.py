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
NET_FLOW_THRESHOLDS = [1000, 1500, 2000, 2500, 3000, 3500]
PRICE_PROXIMITIES = [0.025, 0.05, 0.075, 0.1, 0.15]
TIME_WINDOWS_MS = [180000, 300000, 600000]  # 3, 5, 10 minutes
PERCENTILES = [99, 95]

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
        print(f"Fetched {len(df)} trades from database")
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
        if price_df.empty:
            print(f"Empty price series for tradeTime {trade_time}")
        return price_df['price'].values
    except Exception as e:
        print(f"Error fetching price series for tradeTime {trade_time}: {e}")
        return np.array([])

# Function to check trade outcome for sell trades
def check_trade_outcome(args):
    trade_id, trade_type, entry_price, trade_time, net_flow_threshold, price_proximity, time_window_ms, percentile = args
    try:
        if trade_type != 'sell':
            return None  # Only process sell trades
        
        order_flow = get_order_flow(trade_time, time_window_ms)
        if order_flow.empty:
            print(f"Trade {trade_id} skipped: Empty order flow")
            return None
        net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
        if abs(entry_price - round(entry_price)) > price_proximity:
            print(f"Trade {trade_id} skipped: Price not near round number ({entry_price}, proximity={price_proximity})")
            return None
        if net_flow > -net_flow_threshold:
            print(f"Trade {trade_id} skipped: Net flow {net_flow} > {-net_flow_threshold}")
            return None
        print(f"Trade {trade_id} sell accepted: Net flow {net_flow} ≤ {-net_flow_threshold}, percentile={percentile}")

        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            print(f"Trade {trade_id} skipped: Empty price series for outcome check")
            return None
        
        prices = torch.tensor(price_series, dtype=torch.float32)
        entry_price = torch.tensor(entry_price, dtype=torch.float32)
        
        tp_threshold = entry_price * 0.99
        sl_threshold = entry_price * 1.01
        tp_hit = prices <= tp_threshold
        sl_hit = prices >= sl_threshold
        
        tp_indices = torch.where(tp_hit)[0]
        sl_indices = torch.where(sl_hit)[0]
        
        if len(tp_indices) > 0 and (len(sl_indices) == 0 or tp_indices[0] < sl_indices[0]):
            print(f"Trade {trade_id} outcome: TP First")
            return {
                'trade_id': trade_id,
                'trade_type': trade_type,
                'outcome': 'TP First',
                'net_flow_threshold': net_flow_threshold,
                'price_proximity': price_proximity,
                'time_window_ms': time_window_ms,
                'percentile': percentile
            }
        elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
            print(f"Trade {trade_id} outcome: SL First")
            return {
                'trade_id': trade_id,
                'trade_type': trade_type,
                'outcome': 'SL First',
                'net_flow_threshold': net_flow_threshold,
                'price_proximity': price_proximity,
                'time_window_ms': time_window_ms,
                'percentile': percentile
            }
        print(f"Trade {trade_id} not closed")
        return None
    except Exception as e:
        print(f"Error processing trade {trade_id}: {e}")
        return None

# Function to calculate drawdown
def calculate_drawdown(outcomes):
    balance = 0
    peak = 0
    max_drawdown = 0
    for outcome in outcomes:
        if outcome['outcome'] == 'TP First':
            balance += 0.01  # 1% gain per LTC
        else:
            balance -= 0.01  # 1% loss per LTC
        peak = max(peak, balance)
        drawdown = (peak - balance) / peak if peak > 0 else 0
        max_drawdown = max(max_drawdown, drawdown)
    return max_drawdown * 100  # Convert to percentage

# Main processing function
def process_sell_optimization():
    start_time = int(datetime(2025, 1, 27).timestamp() * 1000)
    trade_data = get_trade_data(start_time)
    
    if trade_data.empty:
        print("No trades found in database")
        return
    
    results = []
    for percentile in PERCENTILES:
        value_threshold = np.percentile(trade_data['value'], percentile)
        trades_df = trade_data[trade_data['value'] >= value_threshold]
        print(f"\nProcessing {len(trades_df)} trades at {percentile}th percentile...")
        
        for net_flow_threshold, price_proximity, time_window_ms in product(NET_FLOW_THRESHOLDS, PRICE_PROXIMITIES, TIME_WINDOWS_MS):
            print(f"\nRunning Reversed Price Level Imbalance: net_flow={net_flow_threshold}, proximity={price_proximity}, time_window={time_window_ms/60000}min, percentile={percentile}")
            args = [
                (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'], net_flow_threshold, price_proximity, time_window_ms, percentile)
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
                print(f"No closed trades for net_flow={net_flow_threshold}, proximity={price_proximity}, time_window={time_window_ms/60000}min, percentile={percentile}")
                continue
            
            sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
            sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
            
            ltc_returns = (sell_outcomes.get('TP First', 0) / 100 * len(sell_trades) * 0.01) - \
                          (sell_outcomes.get('SL First', 0) / 100 * len(sell_trades) * 0.01)
            max_drawdown = calculate_drawdown(outcomes)
            
            result = {
                'net_flow_threshold': net_flow_threshold,
                'price_proximity': price_proximity,
                'time_window_ms': time_window_ms,
                'percentile': percentile,
                'sell_trades': len(sell_trades),
                'sell_tp_percent': sell_outcomes.get('TP First', 0),
                'sell_sl_percent': sell_outcomes.get('SL First', 0),
                'ltc_returns': ltc_returns,
                'max_drawdown_percent': max_drawdown
            }
            results.append(result)
            
            outcome_df.to_csv(f'ltcusdt_sell_imbalance_flow_{net_flow_threshold}_prox_{price_proximity}_time_{time_window_ms}_perc_{percentile}.csv', index=False)
    
    summary_df = pd.DataFrame(results)
    summary_df.to_csv('ltcusdt_sell_optimization_summary_v2.csv', index=False)
    
    for _, row in summary_df.iterrows():
        print(f"\nReversed Price Level Imbalance (net_flow={row['net_flow_threshold']}, proximity={row['price_proximity']}, time_window={row['time_window_ms']/60000}min, percentile={row['percentile']}):")
        print(f"Sell Trades: {row['sell_trades']}")
        print(f"Sell Outcome Percentages: TP First: {row['sell_tp_percent']:.2f}%, SL First: {row['sell_sl_percent']:.2f}%")
        print(f"LTC Returns: {row['ltc_returns']:.4f} LTC")
        print(f"Max Drawdown: {row['max_drawdown_percent']:.2f}%")

if __name__ == '__main__':
    process_sell_optimization()
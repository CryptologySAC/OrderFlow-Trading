import pandas as pd
import sqlite3
import numpy as np
import torch
from multiprocessing import Pool
from datetime import datetime

# Database path
db_path = '../trades.db'  # Replace with your actual database path, e.g., '/Users/marcschot/trades.db'

# Function to fetch price series
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
            print(f"No price series for tradeTime {trade_time}")
            return np.array([])
        return price_df['price'].values
    except Exception as e:
        print(f"Error fetching price series for tradeTime {trade_time}: {e}")
        return np.array([])

# Function to fetch order flow data
def get_order_flow(trade_time, window_ms=300000):  # Extended to 5 minutes
    try:
        query = """
        SELECT tradeTime, quantity, isBuyerMaker
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ? AND tradeTime < ?
        ORDER BY tradeTime
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(trade_time - window_ms, trade_time))
        if df.empty:
            print(f"No order flow data for tradeTime {trade_time}, window {window_ms}ms")
        return df
    except Exception as e:
        print(f"Error fetching order flow for tradeTime {trade_time}: {e}")
        return pd.DataFrame()

# Function to compute VWAP
def get_vwap(trade_time, window_ms=3600000):  # 1 hour
    try:
        query = """
        SELECT price, quantity
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT' AND tradeTime >= ? AND tradeTime < ?
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn, params=(trade_time - window_ms, trade_time))
        if df.empty:
            print(f"No VWAP data for tradeTime {trade_time}")
            return None
        vwap = (df['price'] * df['quantity']).sum() / df['quantity'].sum()
        return vwap
    except Exception as e:
        print(f"Error computing VWAP for tradeTime {trade_time}: {e}")
        return None

# Function to fetch historical volume data
def get_historical_volumes():
    try:
        query = """
        SELECT quantity
        FROM aggregated_trades
        WHERE symbol = 'LTCUSDT'
        """
        with sqlite3.connect(db_path) as conn:
            df = pd.read_sql_query(query, conn)
        return df['quantity'].values
    except Exception as e:
        print(f"Error fetching historical volumes: {e}")
        return np.array([])

# Function to check trade outcome with a single filter
def check_trade_outcome(args):
    trade_id, trade_type, entry_price, trade_time, filter_name = args
    try:
        # Apply the specified filter
        if filter_name == "order_flow_imbalance":
            order_flow = get_order_flow(trade_time, 300000)  # 5 minutes
            if order_flow.empty:
                return None
            net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
            if (trade_type == 'buy' and net_flow > -1000) or (trade_type == 'sell' and net_flow < 1000):
                return None

        elif filter_name == "price_reversal":
            confirm_trades = get_price_series(trade_time)[:120]  # 2 minutes
            if len(confirm_trades) < 5:
                return None
            confirm_price = confirm_trades[-1]
            if (trade_type == 'buy' and confirm_price < entry_price * 1.002) or \
               (trade_type == 'sell' and confirm_price > entry_price * 0.998):
                return None

        elif filter_name == "volume_climax":
            volume_data = get_order_flow(trade_time, 900000)  # 15 minutes
            if volume_data.empty:
                return None
            volume = volume_data['quantity'].sum()
            historical_volumes = get_historical_volumes()
            if len(historical_volumes) > 0 and volume > np.percentile(historical_volumes, 95):
                return None

        elif filter_name == "delta_direction":
            delta_data = get_order_flow(trade_time, 3600000)  # 1 hour
            if delta_data.empty:
                return None
            delta = (delta_data['quantity'] * (2 * (delta_data['isBuyerMaker'] == 0) - 1)).sum()
            delta_trend = (delta_data.tail(50)['quantity'] * (2 * (delta_data.tail(50)['isBuyerMaker'] == 0) - 1)).sum()
            if (trade_type == 'buy' and (delta > -1000 or delta_trend > -100)) or \
               (trade_type == 'sell' and (delta < 1000 or delta_trend < 100)):
                return None

        elif filter_name == "vwap_deviation":
            vwap = get_vwap(trade_time, 3600000)  # 1 hour
            if vwap is None:
                return None
            if (trade_type == 'buy' and entry_price >= vwap * 1.01) or \
               (trade_type == 'sell' and entry_price <= vwap * 0.99):
                return None

        # Check outcome
        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            print(f"Trade {trade_id} skipped: Empty price series for filter {filter_name}")
            return None
        
        prices = torch.tensor(price_series, dtype=torch.float32)
        entry_price = torch.tensor(entry_price, dtype=torch.float32)
        
        if trade_type == 'buy':
            tp_threshold = entry_price * 1.01
            sl_threshold = entry_price * 0.99
            tp_hit = prices >= tp_threshold
            sl_hit = prices <= sl_threshold
        else:  # sell
            tp_threshold = entry_price * 0.99
            sl_threshold = entry_price * 1.01
            tp_hit = prices <= tp_threshold
            sl_hit = prices >= sl_threshold
        
        tp_indices = torch.where(tp_hit)[0]
        sl_indices = torch.where(sl_hit)[0]
        
        if len(tp_indices) > 0 and (len(sl_indices) == 0 or tp_indices[0] < sl_indices[0]):
            return {'trade_id': trade_id, 'trade_type': trade_type, 'outcome': 'TP First', 'filter': filter_name}
        elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
            return {'trade_id': trade_id, 'trade_type': trade_type, 'outcome': 'SL First', 'filter': filter_name}
        print(f"Trade {trade_id} not closed for filter {filter_name}")
        return None
    except Exception as e:
        print(f"Error processing trade {trade_id} for filter {filter_name}: {e}")
        return None

# Main processing function
def process_trades():
    conn = sqlite3.connect(db_path)
    start_time = int(datetime(2025, 1, 27).timestamp() * 1000)
    query = """
    SELECT aggregatedTradeId, tradeTime, symbol, price, quantity, 
           CASE WHEN isBuyerMaker = 1 THEN 'buy' ELSE 'sell' END AS trade_type,
           (price * quantity) AS value
    FROM aggregated_trades
    WHERE symbol = 'LTCUSDT' AND tradeTime >= ?
    ORDER BY tradeTime
    """
    try:
        trades_df = pd.read_sql_query(query, conn, params=(start_time,))
        print(f"Fetched {len(trades_df)} trades from database")
    except Exception as e:
        print(f"Error fetching trades: {e}")
        conn.close()
        return {}
    
    if trades_df.empty:
        print("No trades found in database")
        conn.close()
        return {}
    
    value_threshold = np.percentile(trades_df['value'], 99)
    trades_df = trades_df[trades_df['value'] >= value_threshold]
    conn.close()
    
    print(f"Processing {len(trades_df)} 99th percentile trades...")
    
    # Process each filter independently
    filters = ["order_flow_imbalance", "price_reversal", "volume_climax", "delta_direction", "vwap_deviation"]
    results = {f: [] for f in filters}
    
    for filter_name in filters:
        print(f"\nRunning filter: {filter_name}")
        args = [
            (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'], filter_name)
            for _, row in trades_df.iterrows()
        ]
        
        batch_size = 500
        outcomes = []
        for i in range(0, len(args), batch_size):
            batch_args = args[i:i + batch_size]
            with Pool(processes=10) as pool:
                batch_results = pool.map(check_trade_outcome, batch_args)
            outcomes.extend([r for r in batch_results if r is not None])
            print(f"Processed batch {i // batch_size + 1}/{len(args) // batch_size + 1}, Closed trades: {len(outcomes)} for {filter_name}")
        results[filter_name] = outcomes
    
    return results

if __name__ == '__main__':
    results = process_trades()
    
    for filter_name, outcomes in results.items():
        outcome_df = pd.DataFrame(outcomes)
        if outcome_df.empty:
            print(f"\nNo closed trades found for filter {filter_name}. Check data or thresholds.")
        else:
            buy_trades = outcome_df[outcome_df['trade_type'] == 'buy']
            sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
            
            buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
            sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
            
            print(f"\nFiltered Trade Outcome Analysis (LTCUSDT, 99th Percentile, Filter: {filter_name}):")
            print(f"Total Closed Trades: {len(outcome_df)}")
            print(f"Buy Trades: {len(buy_trades)}")
            print("Buy Outcome Percentages:")
            print(f"  +1% First (TP First): {buy_outcomes.get('TP First', 0):.2f}%")
            print(f"  -1% First (SL First): {buy_outcomes.get('SL First', 0):.2f}%")
            
            print(f"Sell Trades: {len(sell_trades)}")
            print("Sell Outcome Percentages:")
            print(f"  +1% First (TP First): {sell_outcomes.get('TP First', 0):.2f}%")
            print(f"  -1% First (SL First): {sell_outcomes.get('SL First', 0):.2f}%")
            
            outcome_df.to_csv(f'filtered_ltcusdt_{filter_name}.csv', index=False)
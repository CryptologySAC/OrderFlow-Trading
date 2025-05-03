import pandas as pd
import sqlite3
import numpy as np
import torch
from multiprocessing import Pool
from datetime import datetime

# Database path
db_path = '../trades.db'

# Parameters for ~82% sell TP
NET_FLOW_THRESHOLD = 3000  # From grid search, highest buy SL%
PRICE_PROXIMITY = 0.075   # Balances high TP% and trade count
TIME_WINDOW_MS = 300000   # 5 minutes, from orderflow_imbalance_grid.py
PERCENTILE = 99           # 99th percentile

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
            df = pd.read_sql_query(query, conn, params=(trade_time,))
        if df.empty:
            print(f"Empty price series for tradeTime {trade_time}")
        return df['price'].values
    except Exception as e:
        print(f"Error fetching price series for tradeTime {trade_time}: {e}")
        return np.array([])

# Function to check trade outcome for sell trades
def check_trade_outcome(args):
    trade_id, trade_type, entry_price, trade_time = args
    try:
        if trade_type != 'sell':
            return None  # Only process sell trades
        
        order_flow = get_order_flow(trade_time, TIME_WINDOW_MS)
        if order_flow.empty:
            print(f"Trade {trade_id} skipped: Empty order flow")
            return None
        net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
        price_diff = abs(entry_price - round(entry_price))
        if price_diff > PRICE_PROXIMITY:
            print(f"Trade {trade_id} skipped: Price not near round number (price={entry_price}, diff={price_diff}, proximity={PRICE_PROXIMITY})")
            if 0.075 < price_diff <= 0.1:
                print(f"Trade {trade_id} note: Price_diff {price_diff} just above proximity 0.075, would pass with proximity=0.1")
            return None
        if net_flow > -NET_FLOW_THRESHOLD:
            print(f"Trade {trade_id} skipped: Net flow {net_flow} > {-NET_FLOW_THRESHOLD}")
            return None
        print(f"Trade {trade_id} sell accepted: Net flow {net_flow} ≤ {-NET_FLOW_THRESHOLD}, price_diff={price_diff}")

        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            print(f"Trade {trade_id} skipped: Empty price series for outcome check")
            return None
        
        prices = torch.tensor(price_series, dtype=torch.float32)
        entry_price = torch.tensor(entry_price, dtype=torch.float32)
        
        # Check TP/SL
        tp_threshold = entry_price * 0.99
        sl_threshold = entry_price * 1.01
        tp_hit = prices <= tp_threshold
        sl_hit = prices >= sl_threshold
        
        tp_indices = torch.where(tp_hit)[0]
        sl_indices = torch.where(sl_hit)[0]
        
        # Calculate max % movements
        max_hit_percent = 0.0
        max_miss_percent = 0.0
        if len(prices) > 0:
            min_price = prices.min()
            max_hit_percent = ((entry_price - min_price) / entry_price * 100).item() if min_price < entry_price else 0.0
            max_price = prices.max()
            max_miss_percent = ((max_price - entry_price) / entry_price * 100).item() if max_price > entry_price else 0.0
        
        # Convert tradeTime to date, time, day of week
        trade_datetime = datetime.fromtimestamp(trade_time / 1000)
        trade_date = trade_datetime.strftime('%Y-%m-%d')
        trade_time_str = trade_datetime.strftime('%H:%M:%S')
        day_of_week = trade_datetime.strftime('%A')
        
        outcome = None
        if len(tp_indices) > 0 or len(sl_indices) > 0:
            # Determine which happens first
            tp_index = tp_indices[0].item() if len(tp_indices) > 0 else float('inf')
            sl_index = sl_indices[0].item() if len(sl_indices) > 0 else float('inf')
            if tp_index < sl_index:
                outcome = 'TP First'
                print(f"Trade {trade_id} outcome: TP First, net_flow={net_flow}, price_diff={price_diff}, price_series_length={len(prices)}, min_price={prices.min().item()}, max_price={prices.max().item()}, tp_index={tp_index}, sl_index={sl_index}")
            else:
                outcome = 'SL First'
                print(f"Trade {trade_id} outcome: SL First, net_flow={net_flow}, price_diff={price_diff}, price_series_length={len(prices)}, min_price={prices.min().item()}, max_price={prices.max().item()}, tp_index={tp_index}, sl_index={sl_index}")
        else:
            print(f"Trade {trade_id} not closed: No TP/SL hit, net_flow={net_flow}, price_diff={price_diff}, price_series_length={len(prices)}, min_price={prices.min().item() if len(prices) > 0 else 'N/A'}, max_price={prices.max().item() if len(prices) > 0 else 'N/A'}")
            return None
        
        return {
            'trade_id': trade_id,
            'trade_type': trade_type,
            'outcome': outcome,
            'date': trade_date,
            'time': trade_time_str,
            'day_of_week': day_of_week,
            'entry_price': entry_price.item(),
            'net_flow': net_flow,
            'price_diff': price_diff,
            'max_hit_percent': max_hit_percent,
            'max_miss_percent': max_miss_percent
        }
    except Exception as e:
        print(f"Error processing trade {trade_id}: {e}")
        return None

# Main processing function
def replicate_82_percent():
    start_time = int(datetime(2025, 1, 27).timestamp() * 1000)
    trade_data = get_trade_data(start_time)
    
    if trade_data.empty:
        print("No trades found in database")
        return
    
    value_threshold = np.percentile(trade_data['value'], PERCENTILE)
    trades_df = trade_data[trade_data['value'] >= value_threshold]
    
    print(f"Processing {len(trades_df)} {PERCENTILE}th percentile trades...")
    
    args = [
        (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'])
        for _, row in trades_df.iterrows()
    ]
    
    batch_size = 500
    outcomes = []
    closed_trades = 0
    with Pool(processes=8) as pool:
        for i in range(0, len(args), batch_size):
            batch_args = args[i:i + batch_size]
            batch_results = pool.map(check_trade_outcome, batch_args)
            batch_outcomes = [r for r in batch_results if r is not None]
            outcomes.extend(batch_outcomes)
            closed_trades += len(batch_outcomes)
            print(f"Processed batch {i // batch_size + 1}/{len(args) // batch_size + 1}, Closed trades: {closed_trades}")
    
    outcome_df = pd.DataFrame(outcomes)
    if outcome_df.empty:
        print("No closed trades found")
        return
    
    sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
    sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
    
    print("\nReversed Price Level Imbalance Analysis (LTCUSDT, 99th Percentile):")
    print(f"Sell Trades: {len(sell_trades)}")
    print(f"Sell Outcome Percentages: TP First: {sell_outcomes.get('TP First', 0):.2f}%, SL First: {sell_outcomes.get('SL First', 0):.2f}%")
    
    outcome_df.to_csv('ltcusdt_replicate_82_exact_v11.csv', index=False)

if __name__ == '__main__':
    replicate_82_percent()
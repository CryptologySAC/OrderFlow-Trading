import pandas as pd
import sqlite3
import numpy as np
import torch
from multiprocessing import Pool
from datetime import datetime
import os

# Database path
db_path = '../trades.db'  # Replace with your actual database path, e.g., '/Users/marcschot/trades.db'

# Function to fetch price series
def get_price_series(trade_time):
    """
    Fetch prices for LTCUSDT after trade_time.
    """
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

# Function to check trade outcome using PyTorch
def check_trade_outcome(args):
    trade_id, trade_type, entry_price, trade_time = args
    """
    Check if price reaches +1% (TP) or -1% (SL) first.
    Returns: dict with trade_id, trade_type, outcome, or None if open
    """
    try:
        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            return None
        
        # Convert to PyTorch tensor
        prices = torch.tensor(price_series, dtype=torch.float32)
        entry_price = torch.tensor(entry_price, dtype=torch.float32)
        
        # Calculate thresholds
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
        
        # Find first hit
        tp_indices = torch.where(tp_hit)[0]
        sl_indices = torch.where(sl_hit)[0]
        
        if len(tp_indices) > 0 and (len(sl_indices) == 0 or tp_indices[0] < sl_indices[0]):
            return {'trade_id': trade_id, 'trade_type': trade_type, 'outcome': 'TP First'}
        elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
            return {'trade_id': trade_id, 'trade_type': trade_type, 'outcome': 'SL First'}
        return None
    except Exception as e:
        print(f"Error processing trade {trade_id}: {e}")
        return None

# Main processing function
def process_trades():
    # Connect to database
    conn = sqlite3.connect(db_path)
    
    # Fetch LTCUSDT trades from Jan 27, 2025
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
    except Exception as e:
        print(f"Error fetching trades: {e}")
        conn.close()
        return []
    
    # Calculate 99th percentile value
    if trades_df.empty:
        print("No trades found for LTCUSDT after Jan 27, 2025.")
        conn.close()
        return []
    
    value_threshold = np.percentile(trades_df['value'], 99)
    trades_df = trades_df[trades_df['value'] >= value_threshold]
    
    conn.close()
    
    print(f"Processing {len(trades_df)} 99th percentile trades...")
    
    # Prepare arguments for parallel processing
    args = [
        (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'])
        for _, row in trades_df.iterrows()
    ]
    
    # Batch processing
    batch_size = 500
    outcomes = []
    for i in range(0, len(args), batch_size):
        batch_args = args[i:i + batch_size]
        with Pool(processes=10) as pool:  # Use 10 performance cores
            results = pool.map(check_trade_outcome, batch_args)
        outcomes.extend([r for r in results if r is not None])
        print(f"Processed batch {i // batch_size + 1}/{len(args) // batch_size + 1}")
    
    return outcomes

# Main execution
if __name__ == '__main__':
    # Run processing
    outcomes = process_trades()
    
    # Convert outcomes to DataFrame
    outcome_df = pd.DataFrame(outcomes)
    
    if outcome_df.empty:
        print("No closed trades found. Check data or thresholds.")
    else:
        # Calculate outcome distributions
        buy_trades = outcome_df[outcome_df['trade_type'] == 'buy']
        sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
        
        buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
        sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
        
        # Print results
        print("\nRaw Trade Outcome Analysis (LTCUSDT, 99th Percentile by Value, +1% vs -1%):")
        print(f"Total Closed Trades: {len(outcome_df)}")
        print(f"Buy Trades: {len(buy_trades)}")
        print("Buy Outcome Percentages:")
        print(f"  +1% First (TP First): {buy_outcomes.get('TP First', 0):.2f}%")
        print(f"  -1% First (SL First): {buy_outcomes.get('SL First', 0):.2f}%")
        
        print(f"Sell Trades: {len(sell_trades)}")
        print("Sell Outcome Percentages:")
        print(f"  +1% First (TP First): {sell_outcomes.get('TP First', 0):.2f}%")
        print(f"  -1% First (SL First): {sell_outcomes.get('SL First', 0):.2f}%")
        
        # Save results
        outcome_df.to_csv('ltcusdt_trade_outcomes.csv', index=False)
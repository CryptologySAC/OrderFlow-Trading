import pandas as pd
import sqlite3
import numpy as np
import torch
from multiprocessing import Pool
from datetime import datetime

# Database path
db_path = '../trades.db'  # Replace with your actual database path

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

# Function to check trade outcome with a strategy
def check_trade_outcome(args):
    trade_id, trade_type, entry_price, trade_time, strategy = args
    try:
        if strategy == "price_level_imbalance":
            order_flow = get_order_flow(trade_time, 300000)  # 5 minutes
            if order_flow.empty:
                return None
            net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
            # Check if price is near a round number (e.g., multiple of $1)
            if abs(entry_price - round(entry_price)) > 0.05:
                return None
            if (trade_type == 'buy' and net_flow > -2000) or (trade_type == 'sell' and net_flow < 2000):
                return None

        elif strategy == "cumulative_delta_reversal":
            delta_data = get_order_flow(trade_time, 1800000)  # 30 minutes
            if delta_data.empty:
                return None
            delta = (delta_data['quantity'] * (2 * (delta_data['isBuyerMaker'] == 0) - 1)).cumsum()
            recent_data = get_order_flow(trade_time, 600000)  # 10 minutes
            if recent_data.empty:
                return None
            recent_delta = (recent_data['quantity'] * (2 * (recent_data['isBuyerMaker'] == 0) - 1)).sum()
            if trade_type == 'buy' and (delta.iloc[-1] < -1500 or recent_delta < 500):
                return None
            if trade_type == 'sell' and (delta.iloc[-1] > 1500 or recent_delta > -500):
                return None

        elif strategy == "volume_spike_directional":
            order_flow = get_order_flow(trade_time, 300000)  # 5 minutes
            if order_flow.empty:
                return None
            volume = order_flow['quantity'].sum()
            delta = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
            all_volumes = []
            sample_times = trade_data['tradeTime'].sample(min(500, len(trade_data))).values
            for t in sample_times:
                v_data = get_order_flow(t, 300000)
                if not v_data.empty:
                    all_volumes.append(v_data['quantity'].sum())
            if len(all_volumes) < 10 or volume <= np.percentile(all_volumes, 95):
                return None
            if (trade_type == 'buy' and delta < 1000) or (trade_type == 'sell' and delta > -1000):
                return None

        elif strategy == "order_flow_climax":
            order_flow = get_order_flow(trade_time, 600000)  # 10 minutes
            if order_flow.empty:
                return None
            net_flow = (order_flow['quantity'] * (2 * (order_flow['isBuyerMaker'] == 0) - 1)).sum()
            volume = order_flow['quantity'].sum()
            all_volumes = []
            sample_times = trade_data['tradeTime'].sample(min(500, len(trade_data))).values
            for t in sample_times:
                v_data = get_order_flow(t, 600000)
                if not v_data.empty:
                    all_volumes.append(v_data['quantity'].sum())
            if len(all_volumes) < 10 or volume <= np.percentile(all_volumes, 90):
                return None
            if (trade_type == 'buy' and net_flow > -3000) or (trade_type == 'sell' and net_flow < 3000):
                return None

        price_series = get_price_series(trade_time)
        if len(price_series) == 0:
            print(f"Trade {trade_id} skipped: Empty price series for {strategy}")
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
            return {'trade_id': trade_id, 'trade_type': trade_type, 'outcome': 'TP First', 'strategy': strategy}
        elif len(sl_indices) > 0 and (len(tp_indices) == 0 or sl_indices[0] < tp_indices[0]):
            return {'trade_id': trade_id, 'trade_type': trade_type, 'outcome': 'SL First', 'strategy': strategy}
        print(f"Trade {trade_id} not closed for {strategy}")
        return None
    except Exception as e:
        print(f"Error processing trade {trade_id} for {strategy}: {e}")
        return None

# Main processing function
def process_strategies():
    global trade_data
    start_time = int(datetime(2025, 1, 27).timestamp() * 1000)
    trade_data = get_trade_data(start_time)
    
    if trade_data.empty:
        print("No trades found in database")
        return {}
    
    value_threshold = np.percentile(trade_data['value'], 99)
    trades_df = trade_data[trade_data['value'] >= value_threshold]
    
    print(f"Processing {len(trades_df)} 99th percentile trades...")
    
    strategies = [
        "price_level_imbalance",
        "cumulative_delta_reversal",
        "volume_spike_directional",
        "order_flow_climax"
    ]
    results = {s: [] for s in strategies}
    
    for strategy in strategies:
        print(f"\nRunning strategy: {strategy}")
        args = [
            (row['aggregatedTradeId'], row['trade_type'], row['price'], row['tradeTime'], strategy)
            for _, row in trades_df.iterrows()
        ]
        
        batch_size = 500
        outcomes = []
        with Pool(processes=8) as pool:
            for i in range(0, len(args), batch_size):
                batch_args = args[i:i + batch_size]
                batch_results = pool.map(check_trade_outcome, batch_args)
                outcomes.extend([r for r in batch_results if r is not None])
                print(f"Processed batch {i // batch_size + 1}/{len(args) // batch_size + 1}, Closed trades: {len(outcomes)} for {strategy}")
        results[strategy] = outcomes
    
    return results

if __name__ == '__main__':
    results = process_strategies()
    
    for strategy, outcomes in results.items():
        outcome_df = pd.DataFrame(outcomes)
        if outcome_df.empty:
            print(f"\nNo closed trades found for strategy {strategy}. Check data or thresholds.")
        else:
            buy_trades = outcome_df[outcome_df['trade_type'] == 'buy']
            sell_trades = outcome_df[outcome_df['trade_type'] == 'sell']
            
            buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
            sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
            
            print(f"\nOrder Flow Strategy Analysis (LTCUSDT, 99th Percentile, Strategy: {strategy}):")
            print(f"Total Closed Trades: {len(outcome_df)}")
            print(f"Buy Trades: {len(buy_trades)}")
            print("Buy Outcome Percentages:")
            print(f"  +1% First (TP First): {buy_outcomes.get('TP First', 0):.2f}%")
            print(f"  -1% First (SL First): {buy_outcomes.get('SL First', 0):.2f}%")
            print(f"Sell Trades: {len(sell_trades)}")
            print("Sell Outcome Percentages:")
            print(f"  +1% First (TP First): {sell_outcomes.get('TP First', 0):.2f}%")
            print(f"  -1% First (SL First): {sell_outcomes.get('SL First', 0):.2f}%")
            
            outcome_df.to_csv(f'ltcusdt_{strategy}.csv', index=False)
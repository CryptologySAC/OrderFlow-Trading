import pandas as pd
import numpy as np
import sqlite3
from datetime import timedelta

# Load data from SQLite
def load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT'):
    conn = sqlite3.connect(db_file)
    try:
        query = f"""
            SELECT aggregatedTradeId AS id, firstTradeId AS trade_id1, lastTradeId AS trade_id2,
                   tradeTime AS timestamp, symbol AS pair, price, quantity,
                   isBuyerMaker AS is_buyer, orderType AS order_type
            FROM {table_name}
            WHERE symbol = ?
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(symbol,))
        if df.empty:
            raise ValueError(f"No data found for symbol {symbol} in table {table_name}")
        
        # Convert is_buyer to buy/sell
        df['trade_type'] = np.where(df['is_buyer'] == 1, 'buy', 'sell')
        
        # Calculate USDT value
        df['usdt_value'] = df['quantity'] * df['price']
        
        # Convert timestamp to datetime
        df['trade_timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None
    finally:
        conn.close()

# Analyze whether a -1% or +1% move happens first in the 89-minute window
def analyze_moves_first(trades, large_trade_threshold=4607.62, window_minutes=89, move_threshold=1.0):
    # Filter large trades
    large_trades = trades[trades['usdt_value'] > large_trade_threshold].copy()
    print(f"Analyzing {len(large_trades)} large trades...")

    # Results storage
    results = []

    for idx, trade in large_trades.iterrows():
        entry_time = trade['trade_timestamp']
        entry_price = trade['price']
        trade_type = trade['trade_type']
        
        # Define the 89-minute window
        window_end = entry_time + timedelta(minutes=window_minutes)
        window_trades = trades[(trades['trade_timestamp'] > entry_time) & 
                              (trades['trade_timestamp'] <= window_end)]
        
        # Define price thresholds
        down_threshold = entry_price * (1 - move_threshold / 100)  # -1%
        up_threshold = entry_price * (1 + move_threshold / 100)    # +1%
        
        # Check which threshold is hit first
        hit_down_first = False
        hit_up_first = False
        
        for _, window_trade in window_trades.iterrows():
            price = window_trade['price']
            if price <= down_threshold:
                hit_down_first = True
                break
            elif price >= up_threshold:
                hit_up_first = True
                break
        
        # Determine the outcome
        if hit_down_first:
            outcome = 'Bottom First'
        elif hit_up_first:
            outcome = 'Top First'
        else:
            outcome = 'Neither'
        
        # Additional factors for analysis
        hour_of_day = entry_time.hour
        # Check if price is near a round number (e.g., 110.00, 111.00)
        round_number = round(entry_price)
        is_near_round = abs(entry_price - round_number) <= 0.1  # Within 0.1% of round number
        
        results.append({
            'trade_type': trade_type,
            'outcome': outcome,
            'hour_of_day': hour_of_day,
            'is_near_round': is_near_round
        })
    
    # Convert results to DataFrame
    results_df = pd.DataFrame(results)
    
    # Calculate probabilities
    print("\nProbability Analysis:")
    
    # Overall probabilities
    buy_trades = results_df[results_df['trade_type'] == 'buy']
    sell_trades = results_df[results_df['trade_type'] == 'sell']
    
    buy_bottom_first = len(buy_trades[buy_trades['outcome'] == 'Bottom First']) / len(buy_trades) * 100 if len(buy_trades) > 0 else 0
    sell_top_first = len(sell_trades[sell_trades['outcome'] == 'Top First']) / len(sell_trades) * 100 if len(sell_trades) > 0 else 0
    
    print(f"Large Buy Trades: {len(buy_trades)}")
    print(f"Probability of -1% Move First (Bottom First): {buy_bottom_first:.2f}%")
    print(f"Large Sell Trades: {len(sell_trades)}")
    print(f"Probability of +1% Move First (Top First): {sell_top_first:.2f}%")
    
    # Group by hour of day
    print("\nBy Hour of Day:")
    buy_hourly = buy_trades.groupby('hour_of_day')['outcome'].value_counts(normalize=True).unstack().fillna(0) * 100
    sell_hourly = sell_trades.groupby('hour_of_day')['outcome'].value_counts(normalize=True).unstack().fillna(0) * 100
    if 'Bottom First' in buy_hourly.columns:
        print("Buy Trades (-1% Move First):")
        print(buy_hourly['Bottom First'].to_string())
    if 'Top First' in sell_hourly.columns:
        print("\nSell Trades (+1% Move First):")
        print(sell_hourly['Top First'].to_string())
    
    # Group by proximity to round number
    print("\nBy Proximity to Round Number:")
    buy_round = buy_trades.groupby('is_near_round')['outcome'].value_counts(normalize=True).unstack().fillna(0) * 100
    sell_round = sell_trades.groupby('is_near_round')['outcome'].value_counts(normalize=True).unstack().fillna(0) * 100
    if 'Bottom First' in buy_round.columns:
        print("Buy Trades (-1% Move First):")
        print(buy_round['Bottom First'].to_string())
    if 'Top First' in sell_round.columns:
        print("\nSell Trades (+1% Move First):")
        print(sell_round['Top First'].to_string())
    
    return results_df

# Main execution
if __name__ == "__main__":
    # Load data from SQLite
    db_file = '../trades.db'  # Replace with the path to your SQLite database file
    trades = load_data_from_sqlite(db_file)
    if trades is None:
        raise SystemExit("Failed to load data. Exiting.")
    
    # Analyze moves
    results = analyze_moves_first(trades, large_trade_threshold=4607.62, move_threshold=1.0)
    results.to_csv('move_analysis_results.csv', index=False)
    print("Saved analysis results to 'move_analysis_results.csv'")
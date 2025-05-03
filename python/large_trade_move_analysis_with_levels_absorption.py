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


def analyze_absorption(trades, large_trade_threshold=4607.62, window_minutes=89, move_threshold=0.9, absorption_window=5, abs_ratio_threshold=2.0, price_move_threshold=0.2):
    large_trades = trades[trades['usdt_value'] > large_trade_threshold].copy()
    print(f"Analyzing {len(large_trades)} large trades for refined absorption...")
    results = []

    # Calculate average volume for volume spike detection
    avg_volume = trades['usdt_value'].mean()

    for idx, trade in large_trades.iterrows():
        entry_time = trade['trade_timestamp']
        entry_price = trade['price']
        trade_type = trade['trade_type']
        window_end = entry_time + timedelta(minutes=window_minutes)
        absorption_end = entry_time + timedelta(minutes=absorption_window)

        # Filter trades in absorption window
        absorption_trades = trades[(trades['trade_timestamp'] > entry_time) & 
                                  (trades['trade_timestamp'] <= absorption_end)]

        # Calculate opposing volume and count
        opposing_trades = absorption_trades[absorption_trades['trade_type'] != trade_type]
        opposing_volume = opposing_trades['usdt_value'].sum()
        opposing_count = len(opposing_trades)
        absorption_ratio = opposing_volume / trade['usdt_value'] if trade['usdt_value'] > 0 else 0

        # Calculate total volume in absorption window for spike detection
        total_volume = absorption_trades['usdt_value'].sum()
        volume_spike = total_volume / avg_volume if avg_volume > 0 else 0

        # Calculate max price movement in trade direction
        max_price = absorption_trades['price'].max() if trade_type == 'buy' else absorption_trades['price'].min()
        price_move = abs((max_price - entry_price) / entry_price * 100) if max_price else 0

        # Analyze price move in main window
        window_trades = trades[(trades['trade_timestamp'] > entry_time) & 
                              (trades['trade_timestamp'] <= window_end)]
        down_threshold = entry_price * (1 - move_threshold / 100)
        up_threshold = entry_price * (1 + move_threshold / 100)
        
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

        outcome = 'Bottom First' if hit_down_first else 'Top First' if hit_up_first else 'Neither'

        results.append({
            'trade_type': trade_type,
            'outcome': outcome,
            'absorption_ratio': absorption_ratio,
            'price_move': price_move,
            'opposing_count': opposing_count,
            'volume_spike': volume_spike
        })

    results_df = pd.DataFrame(results)

    # Refined probability analysis
    print("\nRefined Absorption Analysis:")
    buy_trades = results_df[results_df['trade_type'] == 'buy']
    sell_trades = results_df[results_df['trade_type'] == 'sell']

    for abs_threshold in [2.0, 3.0]:
        for price_threshold in [0.2, 0.3]:
            for count_threshold in [5, 10]:
                for vol_threshold in [2.0, 3.0]:
                    buy_filtered = buy_trades[
                        (buy_trades['absorption_ratio'] > abs_threshold) &
                        (buy_trades['price_move'] < price_threshold) &
                        (buy_trades['opposing_count'] > count_threshold) &
                        (buy_trades['volume_spike'] > vol_threshold)
                    ]
                    sell_filtered = sell_trades[
                        (sell_trades['absorption_ratio'] > abs_threshold) &
                        (sell_trades['price_move'] < price_threshold) &
                        (sell_trades['opposing_count'] > count_threshold) &
                        (sell_trades['volume_spike'] > vol_threshold)
                    ]
                    buy_bottom_prob = len(buy_filtered[buy_filtered['outcome'] == 'Bottom First']) / len(buy_filtered) * 100 if len(buy_filtered) > 0 else 0
                    sell_top_prob = len(sell_filtered[sell_filtered['outcome'] == 'Top First']) / len(sell_filtered) * 100 if len(sell_filtered) > 0 else 0
                    print(f"Abs Ratio > {abs_threshold}, Price Move < {price_threshold}%, Opposing Count > {count_threshold}, Volume Spike > {vol_threshold}x:")
                    print(f"  Buy Trades (-0.9% Move): {buy_bottom_prob:.2f}% ({len(buy_filtered)} trades)")
                    print(f"  Sell Trades (+0.9% Move): {sell_top_prob:.2f}% ({len(sell_filtered)} trades)")

    return results_df

if __name__ == "__main__":
    db_file = '../trades.db'
    trades = load_data_from_sqlite(db_file)
    if trades is None:
        raise SystemExit("Failed to load data. Exiting.")
    
    results = analyze_absorption(trades, large_trade_threshold=4607.62, move_threshold=0.9)
    results.to_csv('refined_absorption_analysis_results.csv', index=False)
    print("Saved analysis results to 'refined_absorption_analysis_results.csv'")




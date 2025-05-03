import pandas as pd
import numpy as np
import sqlite3


#connect to the DB
db_file = '../trades.db'
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
        df['isBuyer'] = np.where(df['is_buyer'] == 1, 'buy', 'sell')
        df['usdt_value'] = df['quantity'] * df['price']
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None
    finally:
        conn.close()


# Load trade data (replace with your database query or CSV path)
#trades = pd.read_csv('trades.csv', parse_dates=['timestamp'])
trades = load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT')

if trades is None or trades.empty:
    print("Failed to load data. Exiting.")
    exit(1)

# Load trade data (replace with your database query or CSV path)
#trades = pd.read_csv('trades.csv', parse_dates=['timestamp'])

# Convert timestamp from milliseconds to datetime if needed
if trades['timestamp'].dtype != 'datetime64[ns]':
    trades['timestamp'] = pd.to_datetime(trades['timestamp'], unit='ms')

# Verify date range
print("Date Range:", trades['timestamp'].min(), "to", trades['timestamp'].max())
print("Total Trades:", len(trades))

# Calculate USDT value and filter for 99th percentile trades
#trades['usdt_value'] = trades['quantity'] * trades['price']
large_trade_threshold = trades['usdt_value'].quantile(0.99)  # $4,608.50
large_trades = trades[trades['usdt_value'] > large_trade_threshold].copy()
print(f"Large Trades (>99th percentile, ${large_trade_threshold:.2f} USDT):", len(large_trades))

# Initialize columns for analysis
results = []

# Analyze each large trade
for idx, trade in large_trades.iterrows():
    trade_time = trade['timestamp']
    trade_price = trade['price']
    trade_type = trade['isBuyer']
    
    # Define windows
    window_13m_end = trade_time + pd.Timedelta(minutes=13)
    window_89m_end = trade_time + pd.Timedelta(minutes=89)
    
    # Get trades in 13m and 89m windows
    trades_13m = trades[(trades['timestamp'] > trade_time) & (trades['timestamp'] <= window_13m_end)]
    trades_89m = trades[(trades['timestamp'] > trade_time) & (trades['timestamp'] <= window_89m_end)]
    
    # 13m window analysis
    if not trades_13m.empty:
        price_max_13m = trades_13m['price'].max()
        price_min_13m = trades_13m['price'].min()
        delta_to_top_13m = (price_max_13m - trade_price) / trade_price * 100
        delta_to_bottom_13m = (trade_price - price_min_13m) / trade_price * 100
        max_time_13m = trades_13m.loc[trades_13m['price'].idxmax(), 'timestamp']
        min_time_13m = trades_13m.loc[trades_13m['price'].idxmin(), 'timestamp']
        top_first_13m = max_time_13m < min_time_13m
    else:
        price_max_13m = price_min_13m = delta_to_top_13m = delta_to_bottom_13m = np.nan
        top_first_13m = None
    
    # 89m window analysis
    if not trades_89m.empty:
        price_max_89m = trades_89m['price'].max()
        price_min_89m = trades_89m['price'].min()
        delta_to_top_89m = (price_max_89m - trade_price) / trade_price * 100
        delta_to_bottom_89m = (trade_price - price_min_89m) / trade_price * 100
        max_time_89m = trades_89m.loc[trades_89m['price'].idxmax(), 'timestamp']
        min_time_89m = trades_89m.loc[trades_89m['price'].idxmin(), 'timestamp']
        top_first_89m = max_time_89m < min_time_89m
    else:
        price_max_89m = price_min_89m = delta_to_top_89m = delta_to_bottom_89m = np.nan
        top_first_89m = None
    
    # Store results
    results.append({
        'trade_timestamp': trade_time,
        'trade_price': trade_price,
        'trade_type': trade_type,
        'usdt_value': trade['usdt_value'],
        'max_13m': price_max_13m,
        'min_13m': price_min_13m,
        'delta_to_top_13m': delta_to_top_13m,
        'delta_to_bottom_13m': delta_to_bottom_13m,
        'top_first_13m': top_first_13m,
        'max_89m': price_max_89m,
        'min_89m': price_min_89m,
        'delta_to_top_89m': delta_to_top_89m,
        'delta_to_bottom_89m': delta_to_bottom_89m,
        'top_first_89m': top_first_89m
    })

# Convert results to DataFrame
results_df = pd.DataFrame(results)

# Aggregate statistics
print("\n13-Minute Window Statistics:")
print("Average Delta to Top (%):", results_df['delta_to_top_13m'].mean())
print("Median Delta to Top (%):", results_df['delta_to_top_13m'].median())
print("Average Delta to Bottom (%):", results_df['delta_to_bottom_13m'].mean())
print("Median Delta to Bottom (%):", results_df['delta_to_bottom_13m'].median())
print("Top First (%):", (results_df['top_first_13m'].mean() * 100) if not results_df['top_first_13m'].isna().all() else "N/A")

print("\n89-Minute Window Statistics:")
print("Average Delta to Top (%):", results_df['delta_to_top_89m'].mean())
print("Median Delta to Top (%):", results_df['delta_to_top_89m'].median())
print("Average Delta to Bottom (%):", results_df['delta_to_bottom_89m'].mean())
print("Median Delta to Bottom (%):", results_df['delta_to_bottom_89m'].median())
print("Top First (%):", (results_df['top_first_89m'].mean() * 100) if not results_df['top_first_89m'].isna().all() else "N/A")

# Analyze by trade type
buy_trades = results_df[results_df['trade_type'] == "buy"]
sell_trades = results_df[results_df['trade_type'] == "sell"]

print("\nBuy Trades - 13m Window:")
print("Average Delta to Top (%):", buy_trades['delta_to_top_13m'].mean())
print("Average Delta to Bottom (%):", buy_trades['delta_to_bottom_13m'].mean())
print("Top First (%):", (buy_trades['top_first_13m'].mean() * 100) if not buy_trades['top_first_13m'].isna().all() else "N/A")

print("\nBuy Trades - 89m Window:")
print("Average Delta to Top (%):", buy_trades['delta_to_top_89m'].mean())
print("Average Delta to Bottom (%):", buy_trades['delta_to_bottom_89m'].mean())
print("Top First (%):", (buy_trades['top_first_89m'].mean() * 100) if not buy_trades['top_first_89m'].isna().all() else "N/A")

print("\nSell Trades - 13m Window:")
print("Average Delta to Top (%):", sell_trades['delta_to_top_13m'].mean())
print("Average Delta to Bottom (%):", sell_trades['delta_to_bottom_13m'].mean())
print("Top First (%):", (sell_trades['top_first_13m'].mean() * 100) if not sell_trades['top_first_13m'].isna().all() else "N/A")

print("\nSell Trades - 89m Window:")
print("Average Delta to Top (%):", sell_trades['delta_to_top_89m'].mean())
print("Average Delta to Bottom (%):", sell_trades['delta_to_bottom_89m'].mean())
print("Top First (%):", (sell_trades['top_first_89m'].mean() * 100) if not sell_trades['top_first_89m'].isna().all() else "N/A")

# Save results
results_df.to_csv('large_trade_analysis_with_deltas.csv', index=False)
print("\nSaved analysis to 'large_trade_analysis_with_deltas.csv'")
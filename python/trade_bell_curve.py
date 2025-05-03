import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
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
        df['isBuyer'] = df['is_buyer'] == 1
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

# Calculate USDT value for each trade
#trades['usdt_value'] = trades['quantity'] * trades['price']

# Verify data
print("Date Range:", trades['timestamp'].min(), "to", trades['timestamp'].max())
print("Total Trades:", len(trades))
print("USDT Value Summary:")
print(trades['usdt_value'].describe())

# Compute percentiles for large trade threshold
percentiles = trades['usdt_value'].quantile([0.25, 0.5, 0.75, 0.90, 0.95, 0.99])
print("\nPercentiles of USDT Trade Size:")
print(percentiles)

# Visualize the bell curve (histogram + KDE)
plt.figure(figsize=(10, 6))
sns.histplot(trades['usdt_value'], bins=100, kde=True, color='blue', stat='density')
plt.axvline(percentiles[0.95], color='red', linestyle='--', label='95th Percentile')
plt.axvline(percentiles[0.99], color='green', linestyle='--', label='99th Percentile')
plt.xlabel('Trade Size (USDT)')
plt.ylabel('Density')
plt.title('Distribution of Trade Sizes (USDT)')
plt.legend()
plt.xscale('log')  # Log scale for right-skewed data
plt.savefig('trade_size_distribution.png')
plt.show()

# Save large trades for signal generation
large_trade_threshold = percentiles[0.95]
large_trades = trades[trades['usdt_value'] > large_trade_threshold]
large_trades.to_csv('large_trades.csv', index=False)
print(f"\nSaved {len(large_trades)} large trades (>{large_trade_threshold:.2f} USDT) to 'large_trades.csv'")
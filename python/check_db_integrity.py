import sqlite3
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime
import time;

# Database configuration
DB_PATH = "../trades.db"
START_DATE = "2025-01-27"
END_DATE = "2025-05-01"
EXPECTED_PAIR = "LTC/USDT"  # Expected trading pair (adjust as needed)

def convert_timestamp_to_datetime(timestamp_ms):
    """Convert timestamp in milliseconds to datetime."""
    return datetime.fromtimestamp(timestamp_ms / 1000)

def check_data_coverage(conn):
    """Check total number of trades and time range."""
    query = "SELECT COUNT(*), MIN(tradeTime), MAX(tradeTime) FROM aggregated_trades"
    cursor = conn.cursor()
    cursor.execute(query)
    total_trades, min_time, max_time = cursor.fetchone()
    
    min_time_dt = convert_timestamp_to_datetime(min_time) if min_time else None
    max_time_dt = convert_timestamp_to_datetime(max_time) if max_time else None
    
    print(f"Total trades: {total_trades}")
    print(f"Earliest trade time: {min_time_dt}")
    print(f"Latest trade time: {max_time_dt}")
    return total_trades, min_time_dt, max_time_dt

def check_trade_id_gaps(conn):
    """Check for gaps in aggregatedTradeId sequence."""
    query = "SELECT aggregatedTradeId FROM aggregated_trades ORDER BY aggregatedTradeId"
    df = pd.read_sql_query(query, conn)
    
    if df.empty:
        print("No trade IDs found in the database.")
        return
    
    trade_ids = df['aggregatedTradeId'].values
    gaps = []
    for i in range(len(trade_ids) - 1):
        diff = trade_ids[i + 1] - trade_ids[i]
        if diff > 1:
            gaps.append((trade_ids[i], trade_ids[i + 1], diff - 1))
    
    if gaps:
        print(f"Found {len(gaps)} gaps in aggregatedTradeId sequence:")
        for start_id, end_id, gap_size in gaps[:10]:  # Limit to first 10 for brevity
            print(f"Gap between aggregatedTradeId {start_id} and {end_id}: {gap_size} missing IDs")
        if len(gaps) > 10:
            print(f"... and {len(gaps) - 10} more gaps.")
    else:
        print("No gaps found in aggregatedTradeId sequence.")

def check_timestamp_gaps(conn, threshold_seconds=3600):
    """Check for large gaps in tradeTime (default threshold: 1 hour)."""
    query = """
        SELECT tradeTime, 
               LAG(tradeTime) OVER (ORDER BY tradeTime) AS prev_tradeTime,
               (tradeTime - LAG(tradeTime) OVER (ORDER BY tradeTime)) / 1000 AS time_diff_seconds
        FROM aggregated_trades
        ORDER BY tradeTime
    """
    df = pd.read_sql_query(query, conn)
    
    if df.empty:
        print("No trades found for timestamp gap analysis.")
        return
    
    gaps = df[df['time_diff_seconds'] > threshold_seconds]
    if not gaps.empty:
        print(f"Found {len(gaps)} timestamp gaps exceeding {threshold_seconds} seconds:")
        for _, row in gaps.head(10).iterrows():  # Limit to first 10 for brevity
            start_time = convert_timestamp_to_datetime(row['prev_tradeTime'])
            end_time = convert_timestamp_to_datetime(row['tradeTime'])
            print(f"Gap from {start_time} to {end_time}: {row['time_diff_seconds']:.0f} seconds | distance: {int( time.time() - (row['prev_tradeTime']/1000) )}000" )
        if len(gaps) > 10:
            print(f"... and {len(gaps) - 10} more gaps.")
    else:
        print(f"No timestamp gaps exceeding {threshold_seconds} seconds found.")

def check_duplicates(conn):
    """Check for duplicate aggregatedTradeId or tradeTime entries."""
    # Check for duplicate tradeIds
    query_tradeid = """
        SELECT aggregatedTradeId, COUNT(*) AS count
        FROM aggregated_trades
        GROUP BY aggregatedTradeId
        HAVING count > 1
    """
    df_tradeid = pd.read_sql_query(query_tradeid, conn)
    if not df_tradeid.empty:
        print(f"Found {len(df_tradeid)} duplicate tradeIds:")
        print(df_tradeid.head(10))  # Limit to first 10 for brevity
        if len(df_tradeid) > 10:
            print(f"... and {len(df_tradeid) - 10} more duplicates.")
    else:
        print("No duplicate tradeIds found.")


def analyze_distribution(conn):
    """Analyze the distribution of trades across time."""
    query = "SELECT tradeTime FROM aggregated_trades ORDER BY tradeTime"
    df = pd.read_sql_query(query, conn)
    
    if df.empty:
        print("No trades found for distribution analysis.")
        return
    
    df['tradeTime'] = df['tradeTime'].apply(convert_timestamp_to_datetime)
    plt.figure(figsize=(12, 6))
    plt.hist(df['tradeTime'], bins=50, color='blue', alpha=0.7)
    plt.title("Distribution of Trades Over Time (Jan 27 - May 1, 2025)")
    plt.xlabel("Time")
    plt.ylabel("Number of Trades")
    plt.grid(True)
    plt.savefig("trade_distribution.png")
    plt.close()
    print("Trade distribution plot saved to 'trade_distribution.png'.")

def main():
    """Main function to check database integrity."""
    try:
        conn = sqlite3.connect(DB_PATH)
        print("Connected to database successfully.")

        # Check data coverage
        print("\n=== Checking Data Coverage ===")
        total_trades, min_time, max_time = check_data_coverage(conn)

        # Check for gaps in tradeId sequence
        #print("\n=== Checking for Gaps in Trade IDs ===")
        #check_trade_id_gaps(conn)

        # Check for gaps in timestamps
        print("\n=== Checking for Gaps in Timestamps ===")
        check_timestamp_gaps(conn, threshold_seconds=60)  # 60 sec threshold

        # Check for duplicates
        #print("\n=== Checking for Duplicates ===")
        #check_duplicates(conn)

        # Analyze distribution across time
        print("\n=== Analyzing Trade Distribution Across Time ===")
        analyze_distribution(conn)

    except Exception as e:
        print(f"Error during database integrity check: {e}")
    finally:
        conn.close()
        print("\nDatabase connection closed.")

if __name__ == "__main__":
    main()
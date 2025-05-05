import pandas as pd
import sqlite3
import matplotlib.pyplot as plt
from datetime import datetime

# Configuration
DB_PATH = "../trades.db"
START_DATE = "2025-01-27"
END_DATE = "2025-05-01"
THRESHOLD_DROP = 0.02  # 2% threshold for confirming HP
THRESHOLD_UP = 0.005   # 0.5% threshold for SL and LP confirmation

class SwingDetector:
    def __init__(self):
        """Initialize the swing detector with empty state."""
        self.current_hp = None  # Current Highest Point contender (index, time, price)
        self.current_lp = None  # Current Lowest Point contender (index, time, price)
        self.previous_hp = None  # Last confirmed swing high (index, time, price)
        self.previous_lp = None  # Last confirmed swing low (index, time, price)
        self.last_type = None    # 'low' (looking for HP) or 'high' (looking for LP)
        self.swings = []         # List of confirmed swing points (index, type, time, price)
        self.pairs = []          # List of HP-LP pairs (high_time, high_price, low_time, low_price, price_drop_percent)

    def process_trade(self, index, time, price):
        """Process a single trade and update swing points."""
        # Initialize first pivot
        if self.current_hp is None and self.current_lp is None:
            self.current_hp = (index, time, price)
            self.current_lp = (index, time, price)
            self.last_type = 'low'  # Start by looking for an HP
            return

        # Update contenders and confirm swings
        if self.last_type == 'low':
            # Looking for a Highest Point (HP)
            # Check if price rises >=0.5% above current_hp before dropping >=2%
            price_rise = (price - self.current_hp[2]) / self.current_hp[2]
            if price_rise >= THRESHOLD_UP:
                # Price rose >=0.5% above the HP candidate, update HP and continue
                self.current_hp = (index, time, price)
                return

            # Update HP if price is higher
            if price > self.current_hp[2]:
                self.current_hp = (index, time, price)
                return

            # Check if price drops >=2% below the current HP to confirm it
            price_drop = (self.current_hp[2] - price) / self.current_hp[2]
            if price_drop >= THRESHOLD_DROP:
                # Confirm the HP as a swing high
                self.swings.append((self.current_hp[0], 'high', self.current_hp[1], self.current_hp[2]))
                self.previous_hp = self.current_hp
                self.last_type = 'high'
                # Start looking for an LP
                self.current_lp = (index, time, price)

        else:  # last_type == 'high'
            # Looking for a Lowest Point (LP)
            if price < self.current_lp[2]:
                self.current_lp = (index, time, price)
            # Check if price rises >=0.5% above the current LP to confirm it
            price_rise = (price - self.current_lp[2]) / self.current_lp[2]
            if price_rise >= THRESHOLD_UP:
                # Confirm the LP as a swing low
                self.swings.append((self.current_lp[0], 'low', self.current_lp[1], self.current_lp[2]))
                self.previous_lp = self.current_lp
                self.last_type = 'low'
                # Form a pair if drop from previous HP to this LP is >=2%
                if self.previous_hp:
                    price_drop_from_high = (self.previous_hp[2] - self.current_lp[2]) / self.previous_hp[2]
                    if price_drop_from_high >= THRESHOLD_DROP:
                        self.pairs.append({
                            'high_time': self.previous_hp[1],
                            'high_price': self.previous_hp[2],
                            'low_time': self.current_lp[1],
                            'low_price': self.current_lp[2],
                            'price_drop_percent': price_drop_from_high * 100
                        })
                # Start looking for an HP
                self.current_hp = (index, time, price)

    def get_pairs(self):
        """Return detected swing high-low pairs."""
        return pd.DataFrame(self.pairs)

def load_data(db_path, start_date, end_date):
    """Load trade data from SQLite database within the specified date range."""
    try:
        conn = sqlite3.connect(db_path)
        start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp() * 1000)
        end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp() * 1000)
        query = """
            SELECT tradeTime, price 
            FROM aggregated_trades 
            WHERE tradeTime BETWEEN ? AND ? 
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(start_ts, end_ts))
        conn.close()
        if df.empty:
            raise ValueError("No data found in the specified date range.")
        df['tradeTime'] = pd.to_datetime(df['tradeTime'], unit='ms')
        print(f"Loaded {len(df)} trades from {df['tradeTime'].min()} to {df['tradeTime'].max()}")
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None

def main():
    # Load data
    data = load_data(DB_PATH, START_DATE, END_DATE)
    if data is None or len(data) < 2:
        print("Insufficient data to analyze.")
        return

    # Initialize swing detector
    detector = SwingDetector()

    # Process trades sequentially
    for idx, row in data.iterrows():
        detector.process_trade(idx, row['tradeTime'], row['price'])

    # Debug: Log swing points
    print(f"Detected {len(detector.swings)} swing points:")
    high_count = sum(1 for _, t, _, _ in detector.swings if t == 'high')
    low_count = sum(1 for _, t, _, _ in detector.swings if t == 'low')
    print(f"  {high_count} highs, {low_count} lows")

    # Get pairs
    pairs_df = detector.get_pairs()
    if pairs_df.empty:
        print("No valid swing pairs found.")
        return

    # Save to CSV
    pairs_df.to_csv("swing_high_low_pairs_async_v1.1.csv", index=False)
    print("Results saved to 'swing_high_low_pairs_async_v1.1.csv'.")

    # Statistics
    print(f"Number of pairs: {len(pairs_df)}")
    print(f"Maximum drop: {pairs_df['price_drop_percent'].max()/100:.2%}")
    print(f"Average drop: {pairs_df['price_drop_percent'].mean()/100:.2%}")

    # Visualization
    plt.figure(figsize=(12, 6))
    plt.hist(pairs_df['high_time'], bins=50, color='blue', alpha=0.7)
    plt.title("Distribution of Swing High-Low Pairs Over Time (Jan 27 - May 1, 2025)")
    plt.xlabel("Time")
    plt.ylabel("Frequency")
    plt.grid(True)
    plt.savefig("swing_pairs_distribution_async_v1.1.png")
    plt.close()
    print("Distribution plot saved to 'swing_pairs_distribution_async_v1.1.png'.")

if __name__ == "__main__":
    main()
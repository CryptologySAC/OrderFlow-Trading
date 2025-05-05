import pandas as pd
import sqlite3
import matplotlib.pyplot as plt
from datetime import datetime

# Configuration
DB_PATH = "../trades.db"
START_DATE = "2025-01-31"
END_DATE = "2025-05-01"
THRESHOLD = 0.04  # 4% threshold for confirming swings and forming pairs

class SwingDetector:
    def __init__(self):
        """Initialize the swing detector with empty state."""
        self.hp_candidate = None  # Current HP contender (index, time, price)
        self.lp_candidate = None  # Current LP contender (index, time, price)
        self.mode = 'find_hp'     # 'find_hp' or 'find_lp'
        self.hp_list = []         # List of confirmed HPs (index, time, price)
        self.lp_list = []         # List of confirmed LPs (index, time, price)
        self.pairs = []           # List of HP-LP pairs (high_time, high_price, low_time, low_price, price_drop_percent)

    def process_trade(self, index, time, price):
        """Process a single trade and detect HPs and LPs."""
        # Initialize with the first trade
        if self.hp_candidate is None and self.lp_candidate is None:
            self.hp_candidate = (index, time, price)
            self.lp_candidate = (index, time, price)
            self.mode = 'find_hp'
            return

        if self.mode == 'find_hp':
            # Looking for a Highest Point (HP)
            if price > self.hp_candidate[2]:
                self.hp_candidate = (index, time, price)
            # Check if price drops >=4% below the current HP candidate
            price_drop = (self.hp_candidate[2] - price) / self.hp_candidate[2]
            if price_drop >= THRESHOLD:
                # Confirm the HP
                self.hp_list.append(self.hp_candidate)
                self.mode = 'find_lp'
                self.lp_candidate = (index, time, price)
        else:  # mode == 'find_lp'
            # Looking for a Lowest Point (LP)
            if price < self.lp_candidate[2]:
                self.lp_candidate = (index, time, price)
            # Check if price rises >=4% above the current LP candidate
            price_rise = (price - self.lp_candidate[2]) / self.lp_candidate[2]
            if price_rise >= THRESHOLD:
                # Confirm the LP and form a pair
                self.lp_list.append(self.lp_candidate)
                if len(self.hp_list) > len(self.lp_list):
                    last_hp = self.hp_list[-1]
                    price_drop_from_high = (last_hp[2] - self.lp_candidate[2]) / last_hp[2]
                    if price_drop_from_high >= THRESHOLD:
                        self.pairs.append({
                            'high_time': last_hp[1],
                            'high_price': last_hp[2],
                            'low_time': self.lp_candidate[1],
                            'low_price': self.lp_candidate[2],
                            'price_drop_percent': price_drop_from_high * 100
                        })
                self.mode = 'find_hp'
                self.hp_candidate = (index, time, price)

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
    print(f"Detected {len(detector.hp_list)} high points (HPs)")
    print(f"Detected {len(detector.lp_list)} low points (LPs)")

    # Get pairs
    pairs_df = detector.get_pairs()
    if pairs_df.empty:
        print("No valid swing pairs found.")
        return

    # Save to CSV
    pairs_df.to_csv("swing_high_low_pairs_v13.0.csv", index=False)
    print("Results saved to 'swing_high_low_pairs_v13.0.csv'.")

    # Statistics
    print(f"Number of pairs: {len(pairs_df)}")
    print(f"Maximum drop: {pairs_df['price_drop_percent'].max()/100:.2%}")
    print(f"Average drop: {pairs_df['price_drop_percent'].mean()/100:.2%}")

    # Visualization
    plt.figure(figsize=(12, 6))
    plt.hist(pairs_df['high_time'], bins=50, color='blue', alpha=0.7)
    plt.title("Distribution of Swing High-Low Pairs Over Time (Jan 31 - May 1, 2025)")
    plt.xlabel("Time")
    plt.ylabel("Frequency")
    plt.grid(True)
    plt.savefig("swing_pairs_distribution_v13.0.png")
    plt.close()
    print("Distribution plot saved to 'swing_pairs_distribution_v13.0.png'.")

if __name__ == "__main__":
    main()
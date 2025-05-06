import pandas as pd
import sqlite3
import numpy as np
import torch
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta

# Check if GPU is available
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

# Load HP data from CSV
hp_df = pd.read_csv('swing_high_low_pairs_filtered_v1.1.csv')
hp_df['high_time'] = pd.to_datetime(hp_df['high_time'])
hp_df = hp_df.sort_values('high_time')

# Connect to SQLite database
DB_PATH = '../trades.db'
conn = sqlite3.connect(DB_PATH)

# Define parameters
WINDOW_SECONDS = 120  # Narrow to 120 seconds for HP detection
TRADES_PER_CHECK = 10  # Last 10 trades for signal evaluation
CONTEXT_SECONDS = 60  # 60 seconds for contextual trend

# Fetch all trades from the database
query = """
SELECT tradeTime, price, quantity, isBuyerMaker
FROM aggregated_trades
ORDER BY tradeTime ASC
"""
all_trades = pd.read_sql_query(query, conn)
all_trades['tradeTime'] = pd.to_datetime(all_trades['tradeTime'], unit='ms')
all_trades = all_trades.sort_values('tradeTime')

# Convert data to PyTorch tensors
trade_times = pd.to_datetime(all_trades['tradeTime']).astype(int) / 10**9  # Convert to seconds since epoch
trade_times_tensor = torch.tensor(trade_times.values, dtype=torch.float64, device=device)
prices_tensor = torch.tensor(all_trades['price'].values, dtype=torch.float32, device=device)
quantities_tensor = torch.tensor(all_trades['quantity'].values, dtype=torch.float32, device=device)
is_buyer_maker_tensor = torch.tensor(all_trades['isBuyerMaker'].values, dtype=torch.float32, device=device)

# Function to evaluate narrowed signals using GPU-accelerated operations
def evaluate_signals_batch(start_indices, trade_times, prices, quantities, is_buyer_maker):
    batch_size = len(start_indices)
    end_indices = start_indices + TRADES_PER_CHECK
    signal_results = []

    # Extract 10-trade windows
    window_indices = torch.arange(TRADES_PER_CHECK, device=device).unsqueeze(0).repeat(batch_size, 1) + start_indices.unsqueeze(1)
    window_trade_times = trade_times[window_indices]
    window_prices = prices[window_indices]
    window_quantities = quantities[window_indices]
    window_is_buyer_maker = is_buyer_maker[window_indices]

    # Compute context windows (last 60 seconds)
    window_end_times = window_trade_times[:, -1]
    context_start_times = window_end_times - CONTEXT_SECONDS
    context_mask = (trade_times.unsqueeze(0) >= context_start_times.unsqueeze(1)) & (trade_times.unsqueeze(0) <= window_end_times.unsqueeze(1))
    context_quantities = quantities.unsqueeze(0).expand(batch_size, -1) * context_mask.float()
    context_is_buyer_maker = is_buyer_maker.unsqueeze(0).expand(batch_size, -1) * context_mask.float()
    context_prices = prices.unsqueeze(0).expand(batch_size, -1) * context_mask.float()

    # Sell Volume Increase: Sell volume >= 1.2× Buy volume
    buy_mask = (context_is_buyer_maker == 0).float()
    sell_mask = (context_is_buyer_maker == 1).float()
    buy_volume = (context_quantities * buy_mask).sum(dim=1)
    sell_volume = (context_quantities * sell_mask).sum(dim=1)
    sell_volume_increase = sell_volume
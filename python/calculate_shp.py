import pandas as pd
import sqlite3
import numpy as np
import matplotlib.pyplot as plt
import os

# Constants
DB_PATH = '../trades.db'
PLOT_WINDOW_SECONDS = 300  # 5 minutes for plotting
OUTPUT_DIR = 'shp_plots'
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Drop thresholds
DROP_A = 0.05  # ≥ 5%
DROP_B = 0.02  # ≥ 2%
DROP_C = 0.01  # ≥ 1%

def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, aggregatedTradeId, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    conn.close()
    return trades

def find_shp(trades):
    trade_time = trades['tradeTime'].values
    aggregated_trade_id = trades['aggregatedTradeId'].values
    price = trades['price'].values
    quantity = trades['quantity'].values
    is_buyer_maker = trades['isBuyerMaker'].values
    n_trades = len(trades)
    
    shp_list = []
    current_low = price[0]  # Initial lowest point
    candidate_entry_price = None  # Entry-level price when SHP candidate starts
    shp_price = None  # Highest price (SHP candidate)
    shp_idx = None  # Index of SHP candidate
    slp_price = float('inf')  # Lowest price after SHP (tentative SLP)
    slp_idx = None  # Index of tentative SLP
    start_idx = None  # Index where the SHP candidate started
    waiting_for_slp_confirmation = False  # Flag to indicate we're waiting for SLP confirmation
    pending_slp_price = None  # Temporary SLP price while waiting for confirmation
    pending_slp_idx = None  # Temporary SLP index
    first_trade_after_slp = False  # Flag to indicate we're at the first trade after SLP confirmation
    first_trade_after_slp_idx = None  # Index of the first trade after the SLP (for retrospective SHP candidate)
    first_trade_after_slp_price = None  # Price of the first trade after the SLP
    
    # Logging file
    with open('shp_debug.log', 'w') as log_file:
        log_file.write("Starting SHP identification\n")
        log_file.write(f"Initial current_low: {current_low}\n")
        
        for i in range(n_trades):
            current_price = price[i]
            
            # Start a new SHP candidate
            if candidate_entry_price is None:
                if waiting_for_slp_confirmation:
                    # Check if the SLP is confirmed (price went up 1% from pending SLP)
                    if pending_slp_price is not None and current_price >= pending_slp_price * 1.01:
                        waiting_for_slp_confirmation = False
                        first_trade_after_slp = True  # Indicate we're at the first trade after SLP confirmation
                        log_file.write(f"SLP confirmed at index {i}, tradeTime {trade_time[i]}, slp_price {pending_slp_price}, first_trade_after_slp_idx {first_trade_after_slp_idx}, waiting for first trade after SLP\n")
                    continue  # Skip this trade, wait for the next one to start the SHP candidate
                
                if first_trade_after_slp and first_trade_after_slp_idx is not None:
                    # Start the SHP candidate at the first trade after the SLP (retrospectively)
                    current_low = pending_slp_price  # Update current low with the confirmed SLP
                    candidate_entry_price = first_trade_after_slp_price
                    shp_price = first_trade_after_slp_price
                    shp_idx = first_trade_after_slp_idx
                    slp_price = first_trade_after_slp_price
                    slp_idx = first_trade_after_slp_idx
                    start_idx = first_trade_after_slp_idx
                    first_trade_after_slp = False
                    first_trade_after_slp_idx = None
                    first_trade_after_slp_price = None
                    pending_slp_price = None
                    pending_slp_idx = None
                    log_file.write(f"Started new SHP candidate (first trade after SLP) at index {start_idx}, tradeTime {trade_time[start_idx]}, entry_price {candidate_entry_price}\n")
                    # Since we're setting the SHP candidate retrospectively, re-process the current trade
                    current_price = price[i]  # Reset current price for the loop
                
                elif current_price >= current_low * 1.01:
                    # Start a new SHP candidate if price increases by 1% from the current low
                    candidate_entry_price = current_price
                    shp_price = current_price
                    shp_idx = i
                    slp_price = current_price
                    slp_idx = i
                    start_idx = i
                    log_file.write(f"Started new SHP candidate (1% increase) at index {i}, tradeTime {trade_time[i]}, entry_price {current_price}\n")
            
            if candidate_entry_price is not None:
                # Replace SHP candidate if current price is higher
                if current_price > shp_price:
                    shp_price = current_price
                    shp_idx = i
                    slp_price = current_price  # Reset SLP to new SHP price
                    slp_idx = i
                    log_file.write(f"Updated SHP candidate at index {i}, tradeTime {trade_time[i]}, shp_price {shp_price}\n")
                
                # Update SLP if current price is lower
                if current_price < slp_price:
                    slp_price = current_price
                    slp_idx = i
                    # Track the first trade after the SLP for retrospective SHP candidate
                    if i + 1 < n_trades:
                        first_trade_after_slp_idx = i + 1
                        first_trade_after_slp_price = price[i + 1]
                    else:
                        first_trade_after_slp_idx = None
                        first_trade_after_slp_price = None
                    log_file.write(f"Updated tentative SLP at index {i}, tradeTime {trade_time[i]}, slp_price {slp_price}, first_trade_after_slp_idx {first_trade_after_slp_idx}\n")
                
                # Log current state for debugging
                log_file.write(f"Index {i}, tradeTime {trade_time[i]}, current_price {current_price}, entry_price {candidate_entry_price}, shp_price {shp_price}, slp_price {slp_price}, drop {(shp_price - slp_price) / shp_price * 100:.2f}%\n")
                
                # Check closing condition: Price goes up 1% from SLP (primary closure)
                if i > start_idx and current_price >= slp_price * 1.01:
                    drop = (shp_price - slp_price) / shp_price
                    # Only close if the drop from SHP to SLP is > 1%
                    if drop > DROP_C:  # Drop must be > 1% for SLP to exist
                        log_file.write(f"Closing at 1% SLP increase at index {i}, tradeTime {trade_time[i]}, shp_price {shp_price}, slp_price {slp_price}, drop {drop*100:.2f}%\n")
                        if drop >= DROP_C:  # Drop must be ≥ 1% (already true, but kept for clarity)
                            if drop >= DROP_A:
                                category = 'A'
                            elif drop >= DROP_B:
                                category = 'B'
                            else:
                                category = 'C'
                            
                            shp_list.append({
                                'category': category,
                                'entry_tradeTime': trade_time[shp_idx],
                                'entry_aggregatedTradeId': aggregated_trade_id[shp_idx],
                                'entry_price': shp_price,
                                'exit_tradeTime': trade_time[slp_idx],
                                'exit_aggregatedTradeId': aggregated_trade_id[slp_idx],
                                'exit_price': slp_price,
                                'drop_percentage': drop * 100
                            })
                            log_file.write(f"SHP confirmed: Category {category}, drop {drop*100:.2f}%\n")
                        else:
                            log_file.write("SHP discarded: Drop too small, starting new candidate at closing trade\n")
                            # Start a new SHP candidate at the current price (closing trade)
                            candidate_entry_price = current_price
                            shp_price = current_price
                            shp_idx = i
                            slp_price = current_price
                            slp_idx = i
                            start_idx = i
                            log_file.write(f"New SHP candidate started (post-discard) at index {i}, tradeTime {trade_time[i]}, entry_price {current_price}\n")
                            continue  # Skip further conditions in this iteration
                        
                        # Wait for the next trade after SLP confirmation to start new candidate
                        waiting_for_slp_confirmation = True
                        pending_slp_price = slp_price
                        pending_slp_idx = slp_idx
                        candidate_entry_price = None
                        shp_price = None
                        shp_idx = None
                        slp_price = float('inf')
                        slp_idx = None
                        start_idx = None
    
        # Handle any open candidate at the end of the dataset
        if candidate_entry_price is not None:
            drop = (shp_price - slp_price) / shp_price
            log_file.write(f"End of dataset: Closing open candidate, shp_price {shp_price}, slp_price {slp_price}, drop {drop*100:.2f}%\n")
            if drop > DROP_C:  # Drop must be > 1% for SLP to exist
                if drop >= DROP_A:
                    category = 'A'
                elif drop >= DROP_B:
                    category = 'B'
                else:
                    category = 'C'
                
                shp_list.append({
                    'category': category,
                    'entry_tradeTime': trade_time[shp_idx],
                    'entry_aggregatedTradeId': aggregated_trade_id[shp_idx],
                    'entry_price': shp_price,
                    'exit_tradeTime': trade_time[slp_idx],
                    'exit_aggregatedTradeId': aggregated_trade_id[slp_idx],
                    'exit_price': slp_price,
                    'drop_percentage': drop * 100
                })
                log_file.write(f"End SHP confirmed: Category {category}, drop {drop*100:.2f}%\n")
            else:
                log_file.write("End SHP discarded: Drop too small\n")
    
    return shp_list, trade_time, price, quantity, is_buyer_maker

def generate_plot(shp, trade_time, price, quantity, is_buyer_maker, output_dir):
    entry_time = shp['entry_tradeTime']
    exit_time = shp['exit_tradeTime']
    
    # Plot window: 5 minutes before SHP to 5 minutes after SLP
    plot_start = entry_time - PLOT_WINDOW_SECONDS * 1000
    plot_end = exit_time + PLOT_WINDOW_SECONDS * 1000
    
    start_idx = np.searchsorted(trade_time, plot_start, side='left')
    end_idx = np.searchsorted(trade_time, plot_end, side='right')
    
    if end_idx <= start_idx:
        return
    
    plot_times = trade_time[start_idx:end_idx]
    plot_prices = price[start_idx:end_idx]
    plot_quantities = quantity[start_idx:end_idx]
    plot_is_buyer_maker = is_buyer_maker[start_idx:end_idx]
    
    plt.figure(figsize=(10, 6))
    
    # Plot trades as circles: green for buys, red for sells, radius proportional to sqrt(quantity)
    max_quantity = np.max(plot_quantities)
    if max_quantity > 0:
        scaling_factor = 100 / np.sqrt(max_quantity)  # Scale so largest quantity has radius 100
        for j in range(len(plot_times)):
            radius = scaling_factor * np.sqrt(plot_quantities[j])
            color = 'green' if plot_is_buyer_maker[j] == 1 else 'red'
            plt.scatter(plot_times[j], plot_prices[j], s=radius, c=color, alpha=0.5)
    
    # Vertical lines for SHP and SLP
    plt.axvline(x=entry_time, color='blue', linestyle='--', label='SHP')
    plt.axvline(x=exit_time, color='purple', linestyle='--', label='SLP')
    
    plt.title(f"SHP {shp['category']} - Entry: {shp['entry_tradeTime']} - Drop: {shp['drop_percentage']:.2f}%")
    plt.xlabel('tradeTime (Epoch ms)')
    plt.ylabel('Price')
    plt.legend()
    plt.grid()
    
    plot_filename = f"{output_dir}/shp_{shp['category']}_{shp['entry_tradeTime']}.png"
    plt.savefig(plot_filename)
    plt.close()

if __name__ == '__main__':
    # Load trades
    trades = load_trades()
    print(f"Loaded {len(trades)} trades")
    
    # Find SHPs sequentially
    all_shp, trade_time, price, quantity, is_buyer_maker = find_shp(trades)
    
    print(f"Total SHPs identified: {len(all_shp)}")
    
    # Categorize and write to CSVs
    categories = {'A': [], 'B': [], 'C': []}
    for shp in all_shp:
        categories[shp['category']].append(shp)
    
    for category in categories:
        df = pd.DataFrame(categories[category], columns=[
            'entry_tradeTime', 'entry_aggregatedTradeId', 'entry_price',
            'exit_tradeTime', 'exit_aggregatedTradeId', 'exit_price', 'drop_percentage'
        ])
        df.to_csv(f'shp_category_{category}.csv', index=False)
        print(f"Category {category}: {len(categories[category])} SHPs")
    
    # Generate plots sequentially to avoid I/O contention
    for shp in all_shp:
        generate_plot(shp, trade_time, price, quantity, is_buyer_maker, OUTPUT_DIR)
    
    print("Plots generated in", OUTPUT_DIR)
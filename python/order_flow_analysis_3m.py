import pandas as pd
import numpy as np
from collections import deque
from datetime import timedelta
import itertools
import multiprocessing as mp
import torch
import sqlite3

# Define the OrderFlowAnalyzer class with stop-loss and take-profit
class OrderFlowAnalyzer:
    def __init__(self, absorptionWindow=4, priceRange=0.004, minLargeOrder=55, volumeWindow=20*60*1000, 
                 confirmThreshold=0.0015, stopLoss=0.005, takeProfit=0.01):
        self.absorptionWindow = absorptionWindow  # seconds
        self.priceRange = priceRange              # price range percentage
        self.minLargeOrder = minLargeOrder        # minimum quantity for large order (LTC)
        self.volumeWindow = pd.Timedelta(milliseconds=volumeWindow)  # convert ms to Timedelta
        self.confirmThreshold = confirmThreshold   # price move for confirmation (e.g., 0.0015 = 0.15%)
        self.stopLoss = stopLoss                  # stop-loss percentage (e.g., 0.005 = 0.5%)
        self.takeProfit = takeProfit              # take-profit percentage (e.g., 0.01 = 1%)
        self.priceBins = {}                       # volume heat map
        self.signals = []                         # list to store signals
        self.recentTrades = deque()               # trades within absorptionWindow

    def processTrades(self, df):
        for _, trade in df.iterrows():
            self.updateRecentTrades(trade)
            self.processTrade(trade)

    def updateRecentTrades(self, trade):
        current_time = trade['timestamp']
        while self.recentTrades and current_time - self.recentTrades[0]['timestamp'] > pd.Timedelta(seconds=self.absorptionWindow):
            self.recentTrades.popleft()
        self.recentTrades.append(trade)

    def processTrade(self, trade):
        # Update volume heat map
        binPrice = round(trade['price'] / 0.001) * 0.001
        if binPrice not in self.priceBins:
            self.priceBins[binPrice] = {'buyVol': 0, 'sellVol': 0, 'lastUpdate': trade['timestamp']}
        bin = self.priceBins[binPrice]
        if trade['timestamp'] - bin['lastUpdate'] > self.volumeWindow:
            bin['buyVol'] = 0
            bin['sellVol'] = 0
        if trade['isBuyer']:
            bin['buyVol'] += trade['quantity']
        else:
            bin['sellVol'] += trade['quantity']
        bin['lastUpdate'] = trade['timestamp']

        # Detect absorption
        if trade['quantity'] >= self.minLargeOrder:
            opposingTrades = [t for t in self.recentTrades if t['isBuyer'] != trade['isBuyer'] and t['quantity'] <= 0.5]
            if opposingTrades:
                priceMin = trade['price'] * (1 - self.priceRange)
                priceMax = trade['price'] * (1 + self.priceRange)
                if all(priceMin <= t['price'] <= priceMax for t in opposingTrades):
                    signal = {
                        'type': 'sell_absorption' if trade['isBuyer'] else 'buy_absorption',
                        'timestamp': trade['timestamp'],
                        'price': trade['price'],
                        'score': trade['quantity'],
                        'trade_index': trade.name
                    }
                    if self.isNearHighVolume(trade['price']):
                        # Price action confirmation
                        if signal['type'] == 'sell_absorption':  # Buy signal
                            if trade['max_price_5min'] >= signal['price'] * (1 + self.confirmThreshold):
                                self.signals.append(signal)
                        elif signal['type'] == 'buy_absorption':  # Sell signal
                            if trade['min_price_5min'] <= signal['price'] * (1 - self.confirmThreshold):
                                self.signals.append(signal)

    def isNearHighVolume(self, price):
        binPrice = round(price / 0.001) * 0.001
        if binPrice in self.priceBins:
            bin = self.priceBins[binPrice]
            totalVol = bin['buyVol'] + bin['sellVol']
            return totalVol >= self.getTopVolumeThreshold()
        return False

    def getTopVolumeThreshold(self):
        volumes = [bin['buyVol'] + bin['sellVol'] for bin in self.priceBins.values()]
        return np.quantile(volumes, 0.9) if volumes else 0

# Load and prepare the data from SQLite database
def load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT'):
    # Connect to the SQLite database
    conn = sqlite3.connect(db_file)
    try:
        # Query to fetch data for the specified symbol
        query = f"""
            SELECT aggregatedTradeId AS id, firstTradeId AS trade_id1, lastTradeId AS trade_id2,
                   tradeTime AS timestamp, symbol AS pair, price, quantity,
                   isBuyerMaker AS is_buyer, orderType AS order_type, bestMatch AS unknown
            FROM {table_name}
            WHERE symbol = ?
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(symbol,))
        
        # Data preprocessing to match CSV-based script
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df['isBuyer'] = df['is_buyer'] == 1  # Convert isBuyerMaker to boolean (1 = buyer-initiated, 0 = seller-initiated)
        return df
    finally:
        conn.close()

# Optimized future max and min prices
def compute_future_max_min(df, time_delta):
    df = df.sort_values('timestamp').reset_index(drop=True)
    max_prices = np.full(len(df), np.nan)
    min_prices = np.full(len(df), np.nan)
    j = 0
    for i in range(len(df)):
        current_time = df['timestamp'].iloc[i]
        while j < len(df) and df['timestamp'].iloc[j] <= current_time + time_delta:
            j += 1
        future_trades = df.iloc[i+1:j]
        if not future_trades.empty:
            max_prices[i] = future_trades['price'].max()
            min_prices[i] = future_trades['price'].min()
    return max_prices, min_prices

# Define parameter ranges to test
absorptionWindows = [4, 5, 6]               # seconds
priceRanges = [0.003, 0.004, 0.005]         # 0.3%, 0.4%, 0.5%
minLargeOrders = [45, 50, 55]               # LTC
volumeWindows = [10*60*1000, 15*60*1000, 20*60*1000]  # 10, 15, 20 minutes
confirmThresholds = [0.0015, 0.002, 0.0025]  # 0.15%, 0.2%, 0.25% for confirmation
stopLosses = [0.005, 0.0075]               # 0.5%, 0.75% for stop-loss
takeProfits = [0.01, 0.015]                 # 1%, 1.5% for take-profit

# Load data from SQLite
db_file = '../trades.db'  # Replace with your SQLite database file path
df = load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT')

# Compute for confirmation (5 minutes) and profitability (2 hours)
time_delta_5min = pd.Timedelta(minutes=5)
time_delta_2h = pd.Timedelta(hours=2)
df['max_price_5min'], df['min_price_5min'] = compute_future_max_min(df, time_delta_5min)
df['max_price_2h'], df['min_price_2h'] = compute_future_max_min(df, time_delta_2h)

# Check if GPU (MPS) is available
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
print(f"Using device: {device}")

# Function to evaluate a parameter combination with stop-loss and take-profit, using GPU
def evaluate_parameters(params, df=df):
    absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit = params
    analyzer = OrderFlowAnalyzer(absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit)
    analyzer.processTrades(df)
    signals = pd.DataFrame(analyzer.signals)
    if signals.empty:
        return 0, 0, 0, 0, 0  # profitable_pct, num_signals, avg_return, hit_rate, loss_rate
    
    # Convert signal data to tensors for GPU processing
    signal_types = signals['type'].values
    entry_prices = torch.tensor(signals['price'].values, dtype=torch.float32, device=device)
    trade_indices = signals['trade_index'].values
    
    # Precompute trade data for relevant indices
    trade_data = df.loc[trade_indices, ['max_price_2h', 'min_price_2h']].values
    max_prices_2h = torch.tensor(trade_data[:, 0], dtype=torch.float32, device=device)
    min_prices_2h = torch.tensor(trade_data[:, 1], dtype=torch.float32, device=device)
    
    # Initialize tensors for outcomes and returns
    outcomes = torch.zeros(len(signals), dtype=torch.int32, device=device)  # 0: undetermined, 1: profit, 2: loss
    returns = torch.zeros(len(signals), dtype=torch.float32, device=device)
    
    # Vectorized evaluation for buy signals (sell_absorption)
    buy_mask = np.array([t == 'sell_absorption' for t in signal_types])
    if buy_mask.any():
        buy_indices = torch.tensor(np.where(buy_mask)[0], device=device)
        entry_buy = entry_prices[buy_indices]
        max_buy = max_prices_2h[buy_indices]
        min_buy = min_prices_2h[buy_indices]
        
        tp_price = entry_buy * (1 + takeProfit)
        sl_price = entry_buy * (1 - stopLoss)
        
        # Take-profit condition
        tp_hit = max_buy >= tp_price
        outcomes[buy_indices[tp_hit]] = 1
        returns[buy_indices[tp_hit]] = takeProfit
        
        # Stop-loss condition (only for non-TP cases)
        sl_hit = (~tp_hit) & (min_buy <= sl_price)
        outcomes[buy_indices[sl_hit]] = 2
        returns[buy_indices[sl_hit]] = -stopLoss
        
        # Original profit condition (only for non-TP, non-SL cases)
        orig_profit = (~tp_hit) & (~sl_hit) & (max_buy >= entry_buy * 1.01)
        outcomes[buy_indices[orig_profit]] = 1
        returns[buy_indices[orig_profit]] = (max_buy[orig_profit] / entry_buy[orig_profit]) - 1
    
    # Vectorized evaluation for sell signals (buy_absorption)
    sell_mask = np.array([t == 'buy_absorption' for t in signal_types])
    if sell_mask.any():
        sell_indices = torch.tensor(np.where(sell_mask)[0], device=device)
        entry_sell = entry_prices[sell_indices]
        min_sell = min_prices_2h[sell_indices]
        max_sell = max_prices_2h[sell_indices]
        
        tp_price = entry_sell * (1 - takeProfit)
        sl_price = entry_sell * (1 + stopLoss)
        
        # Take-profit condition
        tp_hit = min_sell <= tp_price
        outcomes[sell_indices[tp_hit]] = 1
        returns[sell_indices[tp_hit]] = takeProfit
        
        # Stop-loss condition (only for non-TP cases)
        sl_hit = (~tp_hit) & (max_sell >= sl_price)
        outcomes[sell_indices[sl_hit]] = 2
        returns[sell_indices[sl_hit]] = -stopLoss
        
        # Original profit condition (only for non-TP, non-SL cases)
        orig_profit = (~tp_hit) & (~sl_hit) & (min_sell <= entry_sell * 0.99)
        outcomes[sell_indices[orig_profit]] = 1
        returns[sell_indices[orig_profit]] = (entry_sell[orig_profit] / min_sell[orig_profit]) - 1
    
    # Compute metrics
    profitable_pct = (outcomes == 1).float().mean().item()
    num_signals = len(signals)
    avg_return = returns.mean().item()
    hit_rate = profitable_pct
    loss_rate = (outcomes == 2).float().mean().item()
    
    return profitable_pct, num_signals, avg_return, hit_rate, loss_rate

# Create a list of all parameter combinations
param_combinations = list(itertools.product(absorptionWindows, priceRanges, minLargeOrders, volumeWindows, confirmThresholds, stopLosses, takeProfits))

# Use multiprocessing to evaluate parameters in parallel
if __name__ == '__main__':
    with mp.Pool(mp.cpu_count()) as pool:
        results = pool.map(evaluate_parameters, param_combinations)

    # Collect results
    results_data = []
    for i, params in enumerate(param_combinations):
        absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit = params
        profitable_pct, num_signals, avg_return, hit_rate, loss_rate = results[i]
        results_data.append({
            'absorptionWindow': absorptionWindow,
            'priceRange': priceRange,
            'minLargeOrder': minLargeOrder,
            'volumeWindow': volumeWindow / (60*1000),  # Convert to minutes
            'confirmThreshold': confirmThreshold,
            'stopLoss': stopLoss,
            'takeProfit': takeProfit,
            'profitable_pct': profitable_pct,
            'num_signals': num_signals,
            'avg_return': avg_return,
            'hit_rate': hit_rate,
            'loss_rate': loss_rate
        })
        print(f"Params: absorptionWindow={absorptionWindow}s, priceRange={priceRange*100}%, minLargeOrder={minLargeOrder}, "
              f"volumeWindow={volumeWindow/(60*1000)}min, confirmThreshold={confirmThreshold*100}%, "
              f"stopLoss={stopLoss*100}%, takeProfit={takeProfit*100}%")
        print(f"  Profitable Signals: {profitable_pct:.2%}, Total Signals: {num_signals}, "
              f"Avg Return: {avg_return:.4f}, Hit Rate: {hit_rate:.2%}, Loss Rate: {loss_rate:.2%}")

    # Find the best parameter combination based on average return
    results_df = pd.DataFrame(results_data)
    best_result = results_df.loc[results_df['avg_return'].idxmax()]

    # Report the best results
    print("\nBest Parameter Combination (Max Average Return):")
    print(f"Absorption Window: {best_result['absorptionWindow']} seconds")
    print(f"Price Range: {best_result['priceRange']*100}%")
    print(f"Minimum Large Order: {best_result['minLargeOrder']} LTC")
    print(f"Volume Window: {best_result['volumeWindow']} minutes")
    print(f"Confirmation Threshold: {best_result['confirmThreshold']*100}%")
    print(f"Stop Loss: {best_result['stopLoss']*100}%")
    print(f"Take Profit: {best_result['takeProfit']*100}%")
    print(f"Percentage of Profitable Signals: {best_result['profitable_pct']:.2%}")
    print(f"Total Number of Signals: {int(best_result['num_signals'])}")
    print(f"Average Return: {best_result['avg_return']:.4f}")
    print(f"Hit Rate: {best_result['hit_rate']:.2%}")
    print(f"Loss Rate: {best_result['loss_rate']:.2%}")

    # Baseline comparison: SMA crossover strategy with stop-loss and take-profit
    df['sma_short'] = df['price'].rolling(window=10).mean()
    df['sma_long'] = df['price'].rolling(window=50).mean()
    sma_signals = []
    stop_loss = 0.005  # 0.5%
    take_profit = 0.01  # 1%
    for i in range(1, len(df)):
        if df['sma_short'].iloc[i-1] < df['sma_long'].iloc[i-1] and df['sma_short'].iloc[i] >= df['sma_long'].iloc[i]:
            sma_signals.append({'timestamp': df['timestamp'].iloc[i], 'type': 'buy', 'price': df['price'].iloc[i], 'index': i})
        elif df['sma_short'].iloc[i-1] > df['sma_long'].iloc[i-1] and df['sma_short'].iloc[i] <= df['sma_long'].iloc[i]:
            sma_signals.append({'timestamp': df['timestamp'].iloc[i], 'type': 'sell', 'price': df['price'].iloc[i], 'index': i})

    sma_signals = pd.DataFrame(sma_signals)
    if not sma_signals.empty:
        # Convert SMA signal data to tensors for GPU processing
        sma_types = sma_signals['type'].values
        sma_prices = torch.tensor(sma_signals['price'].values, dtype=torch.float32, device=device)
        sma_indices = sma_signals['index'].values
        
        sma_trade_data = df.loc[sma_indices, ['max_price_2h', 'min_price_2h']].values
        sma_max_prices = torch.tensor(sma_trade_data[:, 0], dtype=torch.float32, device=device)
        sma_min_prices = torch.tensor(sma_trade_data[:, 1], dtype=torch.float32, device=device)
        
        sma_outcomes = torch.zeros(len(sma_signals), dtype=torch.int32, device=device)
        sma_returns = torch.zeros(len(sma_signals), dtype=torch.float32, device=device)
        
        # Buy signals
        sma_buy_mask = np.array([t == 'buy' for t in sma_types])
        if sma_buy_mask.any():
            buy_indices = torch.tensor(np.where(sma_buy_mask)[0], device=device)
            entry_buy = sma_prices[buy_indices]
            max_buy = sma_max_prices[buy_indices]
            min_buy = sma_min_prices[buy_indices]
            
            tp_price = entry_buy * (1 + take_profit)
            sl_price = entry_buy * (1 - stop_loss)
            
            tp_hit = max_buy >= tp_price
            sma_outcomes[buy_indices[tp_hit]] = 1
            sma_returns[buy_indices[tp_hit]] = take_profit
            
            sl_hit = (~tp_hit) & (min_buy <= sl_price)
            sma_outcomes[buy_indices[sl_hit]] = 2
            sma_returns[buy_indices[sl_hit]] = -stop_loss
            
            orig_profit = (~tp_hit) & (~sl_hit) & (max_buy >= entry_buy * 1.01)
            sma_outcomes[buy_indices[orig_profit]] = 1
            sma_returns[buy_indices[orig_profit]] = (max_buy[orig_profit] / entry_buy[orig_profit]) - 1
        
        # Sell signals
        sma_sell_mask = np.array([t == 'sell' for t in sma_types])
        if sma_sell_mask.any():
            sell_indices = torch.tensor(np.where(sma_sell_mask)[0], device=device)
            entry_sell = sma_prices[sell_indices]
            min_sell = sma_min_prices[sell_indices]
            max_sell = sma_max_prices[sell_indices]
            
            tp_price = entry_sell * (1 - take_profit)
            sl_price = entry_sell * (1 + stop_loss)
            
            tp_hit = min_sell <= tp_price
            sma_outcomes[sell_indices[tp_hit]] = 1
            sma_returns[sell_indices[tp_hit]] = take_profit
            
            sl_hit = (~tp_hit) & (max_sell >= sl_price)
            sma_outcomes[sell_indices[sl_hit]] = 2
            sma_returns[sell_indices[sl_hit]] = -stop_loss
            
            orig_profit = (~tp_hit) & (~sl_hit) & (min_sell <= entry_sell * 0.99)
            sma_outcomes[sell_indices[orig_profit]] = 1
            sma_returns[sell_indices[orig_profit]] = (entry_sell[orig_profit] / min_sell[orig_profit]) - 1
        
        sma_profitable_pct = (sma_outcomes == 1).float().mean().item()
        sma_avg_return = sma_returns.mean().item()
        sma_hit_rate = sma_profitable_pct
        sma_loss_rate = (sma_outcomes == 2).float().mean().item()
    else:
        sma_profitable_pct, sma_avg_return, sma_hit_rate, sma_loss_rate = 0, 0, 0, 0

    print(f"\nBaseline (SMA Crossover with SL={stop_loss*100}% and TP={take_profit*100}%):")
    print(f"Profitable Signals: {sma_profitable_pct:.2%}, Avg Return: {sma_avg_return:.4f}, "
          f"Hit Rate: {sma_hit_rate:.2%}, Loss Rate: {sma_loss_rate:.2%}")
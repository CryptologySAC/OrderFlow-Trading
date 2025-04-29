# Version 1.3: Dynamic Stop-Loss with Trailing Stop (20250429_150000)
# Changes from Version 1.2 (20250429_140000):
# - Updated VERSION to 20250429_150000
# - Added trailing_stop_pct parameter to OrderFlowAnalyzer for dynamic stop-loss
# - Modified processTrade to include real-time checks for take-profit and trailing stop closure
# - Added 'best_price' and 'position_type' to activeTrade for trailing stop management
# - Simplified evaluate_parameters to compute returns based on actual entry and exit prices
# - Simplified parameter grid to focus on high-impact values
# Baseline: Order flow analysis for LTCUSDT with 6 AM–10 PM Daytime, 10 PM–6 AM Nighttime

import pandas as pd
import numpy as np
from collections import deque
from datetime import timedelta, datetime
import itertools
import multiprocessing as mp
import torch
import sqlite3
import pytz

VERSION = "20250429_173000"  # Dynamic Stop-Loss with Trailing Stop, April 29, 2025, 17:30:00

# Define Lima timezone (PET, UTC-5)
lima_tz = pytz.timezone('America/Lima')

# Define the OrderFlowAnalyzer class with dynamic stop-loss (trailing stop)
class OrderFlowAnalyzer:
    def __init__(self, absorptionWindow=4, priceRange=0.004, minLargeOrder=55, volumeWindow=20*60*1000, 
                 confirmThreshold=0.0015, stopLoss=0.005, takeProfit=0.01, trailing_stop_pct=0.01):
        self.absorptionWindow = absorptionWindow  # seconds
        self.priceRange = priceRange              # price range percentage
        self.minLargeOrder = minLargeOrder        # minimum quantity for large order (LTC)
        self.volumeWindow = pd.Timedelta(milliseconds=volumeWindow)  # convert ms to Timedelta
        self.confirmThreshold = confirmThreshold   # price move for confirmation (e.g., 0.0015 = 0.15%)
        self.defaultStopLoss = stopLoss           # default stop-loss percentage (e.g., 0.005 = 0.5%)
        self.takeProfit = takeProfit              # take-profit percentage (e.g., 0.01 = 1%)
        self.trailing_stop_pct = trailing_stop_pct  # trailing stop percentage (e.g., 0.01 = 1%)
        self.priceBins = {}                       # volume heat map
        self.signals = []                         # list to store executed trades
        self.recentTrades = deque()               # trades within absorptionWindow
        self.activeTrade = None                   # track active trade

    def processTrades(self, df):
        for _, trade in df.iterrows():
            self.updateRecentTrades(trade)
            self.processTrade(trade)

    def updateRecentTrades(self, trade):
        current_time = trade['timestamp']
        while self.recentTrades and current_time - self.recentTrades[0]['timestamp'] > pd.Timedelta(seconds=self.absorptionWindow):
            self.recentTrades.popleft()
        self.recentTrades.append(trade)

    def checkInvalidation(self, signal_timestamp, signal_price, is_buy_signal):
        # Check recent trades for invalidation within 5 seconds post-signal
        buy_volume = 0
        sell_volume = 0
        min_price = signal_price
        max_price = signal_price
        invalidation_window = pd.Timedelta(seconds=5)

        for trade in self.recentTrades:
            if signal_timestamp < trade['timestamp'] <= signal_timestamp + invalidation_window:
                if trade['isBuyer']:
                    buy_volume += trade['quantity']
                else:
                    sell_volume += trade['quantity']
                min_price = min(min_price, trade['price'])
                max_price = max(max_price, trade['price'])

        if is_buy_signal:
            volume_condition = sell_volume > 2 * buy_volume and sell_volume > 0
            price_condition = min_price <= signal_price * (1 - 0.002)
            return volume_condition or price_condition
        else:
            volume_condition = buy_volume > 2 * sell_volume and buy_volume > 0
            price_condition = max_price >= signal_price * (1 + 0.002)
            return volume_condition or price_condition

    def closeActiveTrade(self, exit_price, exit_timestamp, trade_index, reason='opposite_signal'):
        if not self.activeTrade:
            return
        trade = {
            'type': self.activeTrade['type'],
            'entry_timestamp': self.activeTrade['timestamp'],
            'entry_price': self.activeTrade['price'],
            'exit_timestamp': exit_timestamp,
            'exit_price': exit_price,
            'trade_index': trade_index,
            'is_invalidated': self.activeTrade['is_invalidated'],
            'close_reason': reason
        }
        self.signals.append(trade)
        self.activeTrade = None

    def calculate_return(self, exit_price):
        """Calculate return for the active trade based on exit price."""
        if not self.activeTrade:
            return 0
        entry_price = self.activeTrade['price']
        if self.activeTrade['type'] == 'sell_absorption':  # Buy signal (long)
            return (exit_price / entry_price) - 1
        else:  # Sell signal (short)
            return (entry_price / exit_price) - 1

    def processTrade(self, trade):
        current_price = trade['price']

        # If there is an active trade, check for take-profit or trailing stop closure
        if self.activeTrade:
            position_type = self.activeTrade['position_type']
            entry_price = self.activeTrade['price']
            best_price = self.activeTrade['best_price']

            if position_type == 'long':
                # Check take-profit
                if current_price >= entry_price * (1 + self.takeProfit):
                    reason = 'take_profit'
                    self.closeActiveTrade(current_price, trade['timestamp'], trade.name, reason)
                # Check trailing stop
                elif current_price <= best_price * (1 - self.trailing_stop_pct):
                    reason = 'trailing_stop'
                    self.closeActiveTrade(current_price, trade['timestamp'], trade.name, reason)
                else:
                    # Update best_price if current price is higher
                    self.activeTrade['best_price'] = max(best_price, current_price)
            elif position_type == 'short':
                # Check take-profit
                if current_price <= entry_price * (1 - self.takeProfit):
                    reason = 'take_profit'
                    self.closeActiveTrade(current_price, trade['timestamp'], trade.name, reason)
                # Check trailing stop
                elif current_price >= best_price * (1 + self.trailing_stop_pct):
                    reason = 'trailing_stop'
                    self.closeActiveTrade(current_price, trade['timestamp'], trade.name, reason)
                else:
                    # Update best_price if current price is lower
                    self.activeTrade['best_price'] = min(best_price, current_price)

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

        # Detect absorption for new signals
        if trade['quantity'] >= self.minLargeOrder:
            opposingTrades = [t for t in self.recentTrades if t['isBuyer'] != trade['isBuyer'] and t['quantity'] <= 0.5]
            if opposingTrades:
                priceMin = trade['price'] * (1 - self.priceRange)
                priceMax = trade['price'] * (1 + self.priceRange)
                if all(priceMin <= t['price'] <= priceMax for t in opposingTrades):
                    signal_type = 'sell_absorption' if trade['isBuyer'] else 'buy_absorption'
                    is_buy_signal = signal_type == 'sell_absorption'
                    # Check for opposite signal to close active trade
                    if self.activeTrade:
                        if (self.activeTrade['type'] == 'sell_absorption' and signal_type == 'buy_absorption') or \
                           (self.activeTrade['type'] == 'buy_absorption' and signal_type == 'sell_absorption'):
                            exit_price = trade['price']
                            reason = 'take_profit' if self.calculate_return(exit_price) > 0 else 'stop_loss'
                            self.closeActiveTrade(exit_price, trade['timestamp'], trade.name, reason=reason)
                        else:
                            return  # Same signal: ignore
                    # No active trade: process new signal
                    signal = {
                        'type': signal_type,
                        'timestamp': trade['timestamp'],
                        'price': trade['price'],
                        'score': trade['quantity'],
                        'trade_index': trade.name,
                        'best_price': trade['price'],  # Initialize best_price
                        'position_type': 'long' if signal_type == 'sell_absorption' else 'short'
                    }
                    if self.isNearHighVolume(trade['price']):
                        if signal_type == 'sell_absorption':
                            if trade['max_price_5min'] >= signal['price'] * (1 + self.confirmThreshold):
                                signal['is_invalidated'] = self.checkInvalidation(signal['timestamp'], signal['price'], is_buy_signal=True)
                                self.activeTrade = signal
                        elif signal_type == 'buy_absorption':
                            if trade['min_price_5min'] <= signal['price'] * (1 - self.confirmThreshold):
                                signal['is_invalidated'] = self.checkInvalidation(signal['timestamp'], signal['price'], is_buy_signal=False)
                                self.activeTrade = signal

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
    conn = sqlite3.connect(db_file)
    try:
        query = f"""
            SELECT aggregatedTradeId AS id, firstTradeId AS trade_id1, lastTradeId AS trade_id2,
                   tradeTime AS timestamp, symbol AS pair, price, quantity,
                   isBuyerMaker AS is_buyer, orderType AS order_type, bestMatch AS unknown
            FROM {table_name}
            WHERE symbol = ?
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(symbol,))
        if df.empty:
            raise ValueError(f"No data found for symbol {symbol} in table {table_name}")
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms').dt.tz_localize('UTC').dt.tz_convert(lima_tz)
        df['isBuyer'] = df['is_buyer'] == 1
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None
    finally:
        conn.close()

# Categorize trades by timeframe
def categorize_timeframe(timestamp):
    hour = timestamp.hour
    return 'Daytime' if 6 <= hour < 22 else 'Nighttime'

# Optimized future max and min prices (still needed for confirmation logic)
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

# Simplified parameter grid
absorptionWindows = [5]                    # Focused on optimal value
priceRanges = [0.005]                      # Focused on optimal value
minLargeOrders = [50]                      # Focused on optimal value
volumeWindows = [10*60*1000, 15*60*1000]   # Testing two promising values
confirmThresholds = [0.0025, 0.003]        # Testing two promising values
stopLosses = [0.003]                       # Fixed, as trailing stop is now used
takeProfits = [0.015, 0.02]                # Testing two promising values

# Load data from SQLite
db_file = '../trades.db'  # Replace with your SQLite database file path
df = load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT')

if df is None or df.empty:
    print("Failed to load data. Exiting.")
    exit(1)

# Compute for confirmation (5 minutes) and profitability (2 hours)
time_delta_5min = pd.Timedelta(minutes=5)
time_delta_2h = pd.Timedelta(hours=2)
df['max_price_5min'], df['min_price_5min'] = compute_future_max_min(df, time_delta_5min)
df['max_price_2h'], df['min_price_2h'] = compute_future_max_min(df, time_delta_2h)
df['timeframe'] = df['timestamp'].apply(categorize_timeframe)

# Check if GPU (MPS) is available
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
print(f"Version {VERSION}, Using device: {device}")

# Function to evaluate a parameter combination with progress logging
counter = 0
def evaluate_parameters(params, df=df):
    global counter
    counter += 1
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Version {VERSION}, Processed {counter}/{len(param_combinations)}")
    absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit = params
    analyzer = OrderFlowAnalyzer(absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit, trailing_stop_pct=0.01)
    analyzer.processTrades(df)
    
    # Close any remaining active trade at the last price
    if analyzer.activeTrade:
        last_trade = df.iloc[-1]
        analyzer.closeActiveTrade(last_trade['price'], last_trade['timestamp'], last_trade.name, reason='end_of_data')
    
    signals = pd.DataFrame(analyzer.signals)
    if signals.empty:
        return {
            'Daytime': (0, 0, 0, 0, 0),
            'Nighttime': (0, 0, 0, 0, 0)
        }
    
    signals['timeframe'] = signals['entry_timestamp'].apply(categorize_timeframe)
    results = {}
    
    for timeframe in ['Daytime', 'Nighttime']:
        tf_signals = signals[signals['timeframe'] == timeframe]
        if tf_signals.empty:
            results[timeframe] = (0, 0, 0, 0, 0)
            continue
        
        # Compute returns based on actual entry and exit prices
        returns = np.where(
            tf_signals['type'] == 'sell_absorption',  # Long positions
            (tf_signals['exit_price'] / tf_signals['entry_price']) - 1,
            (tf_signals['entry_price'] / tf_signals['exit_price']) - 1  # Short positions
        )
        outcomes = np.where(returns > 0, 1, 2)
        profitable_pct = np.mean(outcomes == 1)
        num_signals = len(tf_signals)
        avg_return = np.mean(returns)
        hit_rate = profitable_pct
        loss_rate = np.mean(outcomes == 2)
        
        results[timeframe] = (profitable_pct, num_signals, avg_return, hit_rate, loss_rate)
    
    return results

# Create a list of all parameter combinations (simplified grid)
param_combinations = list(itertools.product(absorptionWindows, priceRanges, minLargeOrders, volumeWindows, confirmThresholds, stopLosses, takeProfits))

# Use multiprocessing to evaluate parameters in parallel
if __name__ == '__main__':
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting grid search with version {VERSION}, {len(param_combinations)} combinations")
    counter = 0
    with mp.Pool(mp.cpu_count()) as pool:
        results = pool.map(evaluate_parameters, param_combinations)
    
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Grid search completed")
    # Collect results
    results_data = []
    for i, params in enumerate(param_combinations):
        absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit = params
        daytime_results, nighttime_results = results[i]['Daytime'], results[i]['Nighttime']
        for timeframe, (profitable_pct, num_signals, avg_return, hit_rate, loss_rate) in [('Daytime', daytime_results), ('Nighttime', nighttime_results)]:
            results_data.append({
                'timeframe': timeframe,
                'absorptionWindow': absorptionWindow,
                'priceRange': priceRange,
                'minLargeOrder': minLargeOrder,
                'volumeWindow': volumeWindow / (60*1000),
                'confirmThreshold': confirmThreshold,
                'stopLoss': stopLoss,
                'takeProfit': takeProfit,
                'profitable_pct': profitable_pct,
                'num_signals': num_signals,
                'avg_return': avg_return,
                'hit_rate': hit_rate,
                'loss_rate': loss_rate
            })
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Timeframe: {timeframe}")
            print(f"Params: absorptionWindow={absorptionWindow}s, priceRange={priceRange*100}%, minLargeOrder={minLargeOrder}, "
                  f"volumeWindow={volumeWindow/(60*1000)}min, confirmThreshold={confirmThreshold*100}%, "
                  f"stopLoss={stopLoss*100}%, takeProfit={takeProfit*100}%")
            print(f"Profitable Signals: {profitable_pct:.2%}, Total Signals: {num_signals}, "
                  f"Avg Return: {avg_return:.4f}, Hit Rate: {hit_rate:.2%}, Loss Rate: {loss_rate:.2%}")
    
    results_df = pd.DataFrame(results_data)
    for timeframe in ['Daytime', 'Nighttime']:
        tf_df = results_df[results_df['timeframe'] == timeframe]
        if not tf_df.empty:
            best_result = tf_df.loc[tf_df['avg_return'].idxmax()]
            print(f"\nBest Parameter Combination (Max Average Return) for {timeframe}:")
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
    
    # Save results to CSV with version and parameter header
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_file = f"results_{timestamp}.csv"
    param_info = (f"Version: {VERSION}, Parameters: absorptionWindows={absorptionWindows}, "
                  f"priceRanges={priceRanges}, minLargeOrders={minLargeOrders}, "
                  f"volumeWindows={[v/(60*1000) for v in volumeWindows]}min, "
                  f"confirmThresholds={confirmThresholds}, stopLosses={stopLosses}, "
                  f"takeProfits={takeProfits}")
    results_df.to_csv(csv_file, index=False)
    with open(csv_file, 'r') as f:
        content = f.read()
    with open(csv_file, 'w') as f:
        f.write(f"# {param_info}\n{content}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Results saved to {csv_file}")

    # Baseline comparison: SMA crossover strategy (unchanged from v1.2)
    df['sma_short'] = df['price'].rolling(window=10).mean()
    df['sma_long'] = df['price'].rolling(window=50).mean()
    sma_signals = []
    stop_loss = 0.005  # Fixed 0.5%
    take_profit = 0.01  # Fixed 1%
    active_trade = None
    for i in range(1, len(df)):
        if df['sma_short'].iloc[i-1] < df['sma_long'].iloc[i-1] and df['sma_short'].iloc[i] >= df['sma_long'].iloc[i]:
            if active_trade:
                if active_trade['type'] == 'sell':
                    sma_signals.append({
                        'entry_timestamp': active_trade['timestamp'],
                        'entry_price': active_trade['price'],
                        'exit_timestamp': df['timestamp'].iloc[i],
                        'exit_price': df['price'].iloc[i],
                        'type': active_trade['type'],
                        'index': i,
                        'timeframe': df['timeframe'].iloc[i],
                        'close_reason': 'opposite_signal'
                    })
                    active_trade = None
                else:
                    continue
            active_trade = {'timestamp': df['timestamp'].iloc[i], 'type': 'buy', 'price': df['price'].iloc[i], 'index': i}
        elif df['sma_short'].iloc[i-1] > df['sma_long'].iloc[i-1] and df['sma_short'].iloc[i] <= df['sma_long'].iloc[i]:
            if active_trade:
                if active_trade['type'] == 'buy':
                    sma_signals.append({
                        'entry_timestamp': active_trade['timestamp'],
                        'entry_price': active_trade['price'],
                        'exit_timestamp': df['timestamp'].iloc[i],
                        'exit_price': df['price'].iloc[i],
                        'type': active_trade['type'],
                        'index': i,
                        'timeframe': df['timeframe'].iloc[i],
                        'close_reason': 'opposite_signal'
                    })
                    active_trade = None
                else:
                    continue
            active_trade = {'timestamp': df['timestamp'].iloc[i], 'type': 'sell', 'price': df['price'].iloc[i], 'index': i}
    
    if active_trade:
        sma_signals.append({
            'entry_timestamp': active_trade['timestamp'],
            'entry_price': active_trade['price'],
            'exit_timestamp': df['timestamp'].iloc[-1],
            'exit_price': df['price'].iloc[-1],
            'type': active_trade['type'],
            'index': len(df)-1,
            'timeframe': df['timeframe'].iloc[-1],
            'close_reason': 'end_of_data'
        })
    
    sma_signals = pd.DataFrame(sma_signals)
    if not sma_signals.empty:
        for timeframe in ['Daytime', 'Nighttime']:
            tf_sma_signals = sma_signals[sma_signals['timeframe'] == timeframe]
            if tf_sma_signals.empty:
                continue
            sma_types = tf_sma_signals['type'].values
            entry_prices = torch.tensor(tf_sma_signals['entry_price'].values, dtype=torch.float32, device=device)
            exit_prices = torch.tensor(tf_sma_signals['exit_price'].values, dtype=torch.float32, device=device)
            sma_indices = tf_sma_signals['index'].values
            close_reasons = tf_sma_signals['close_reason'].values
            
            sma_trade_data = df.loc[sma_indices, ['max_price_2h', 'min_price_2h']].values
            sma_max_prices = torch.tensor(sma_trade_data[:, 0], dtype=torch.float32, device=device)
            sma_min_prices = torch.tensor(sma_trade_data[:, 1], dtype=torch.float32, device=device)
            
            sma_outcomes = torch.zeros(len(tf_sma_signals), dtype=torch.int32, device=device)
            sma_returns = torch.zeros(len(tf_sma_signals), dtype=torch.float32, device=device)
            
            buy_mask = np.array([t == 'buy' for t in sma_types])
            if buy_mask.any():
                buy_indices = torch.tensor(np.where(buy_mask)[0], device=device)
                entry_buy = entry_prices[buy_indices]
                exit_buy = exit_prices[buy_indices]
                max_buy = sma_max_prices[buy_indices]
                min_buy = sma_min_prices[buy_indices]
                close_reason_buy = close_reasons[buy_mask]
                
                manual_close = np.array([r in ['opposite_signal', 'end_of_data'] for r in close_reason_buy])
                if manual_close.any():
                    manual_indices = buy_indices[torch.tensor(manual_close, device=device)]
                    sma_returns[manual_indices] = (exit_buy[manual_close] / entry_buy[manual_close]) - 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] > 0]] = 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] <= 0]] = 2
                
                tp_sl_indices = buy_indices[~torch.tensor(manual_close, device=device)]
                if len(tp_sl_indices) > 0:
                    entry_buy_tp_sl = entry_buy[~manual_close]
                    max_buy_tp_sl = max_buy[~manual_close]
                    min_buy_tp_sl = min_buy[~manual_close]
                    
                    tp_price = entry_buy_tp_sl * (1 + take_profit)
                    sl_price = entry_buy_tp_sl * (1 - stop_loss)
                    
                    tp_hit = max_buy_tp_sl >= tp_price
                    sma_outcomes[tp_sl_indices[tp_hit]] = 1
                    sma_returns[tp_sl_indices[tp_hit]] = take_profit
                    
                    sl_hit = (~tp_hit) & (min_buy_tp_sl <= sl_price)
                    sma_outcomes[tp_sl_indices[sl_hit]] = 2
                    sma_returns[tp_sl_indices[sl_hit]] = -stop_loss
                    
                    orig_profit = (~tp_hit) & (~sl_hit) & (max_buy_tp_sl >= entry_buy_tp_sl * 1.01)
                    sma_outcomes[tp_sl_indices[orig_profit]] = 1
                    sma_returns[tp_sl_indices[orig_profit]] = (max_buy_tp_sl[orig_profit] / entry_buy_tp_sl[orig_profit]) - 1
            
            sell_mask = np.array([t == 'sell' for t in sma_types])
            if sell_mask.any():
                sell_indices = torch.tensor(np.where(sell_mask)[0], device=device)
                entry_sell = entry_prices[sell_indices]
                exit_sell = exit_prices[sell_indices]
                min_sell = sma_min_prices[sell_indices]
                max_sell = sma_max_prices[sell_indices]
                close_reason_sell = close_reasons[sell_mask]
                
                manual_close = np.array([r in ['opposite_signal', 'end_of_data'] for r in close_reason_sell])
                if manual_close.any():
                    manual_indices = sell_indices[torch.tensor(manual_close, device=device)]
                    sma_returns[manual_indices] = (entry_sell[manual_close] / exit_sell[manual_close]) - 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] > 0]] = 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] <= 0]] = 2
                
                tp_sl_indices = sell_indices[~torch.tensor(manual_close, device=device)]
                if len(tp_sl_indices) > 0:
                    entry_sell_tp_sl = entry_sell[~manual_close]
                    min_sell_tp_sl = min_sell[~manual_close]
                    max_sell_tp_sl = max_sell[~manual_close]
                    
                    tp_price = entry_sell_tp_sl * (1 - take_profit)
                    sl_price = entry_sell_tp_sl * (1 + stop_loss)
                    
                    tp_hit = min_sell_tp_sl <= tp_price
                    sma_outcomes[tp_sl_indices[tp_hit]] = 1
                    sma_returns[tp_sl_indices[tp_hit]] = take_profit
                    
                    sl_hit = (~tp_hit) & (max_sell_tp_sl >= sl_price)
                    sma_outcomes[tp_sl_indices[sl_hit]] = 2
                    sma_returns[tp_sl_indices[sl_hit]] = -stop_loss
                    
                    orig_profit = (~tp_hit) & (~sl_hit) & (min_sell_tp_sl <= entry_sell_tp_sl * 0.99)
                    sma_outcomes[tp_sl_indices[orig_profit]] = 1
                    sma_returns[tp_sl_indices[orig_profit]] = (entry_sell_tp_sl[orig_profit] / min_sell_tp_sl[orig_profit]) - 1
            
            sma_profitable_pct = (sma_outcomes == 1).float().mean().item()
            sma_avg_return = sma_returns.mean().item() if len(sma_returns) > 0 else 0
            sma_hit_rate = sma_profitable_pct
            sma_loss_rate = (sma_outcomes == 2).float().mean().item()
            
            print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Baseline (SMA Crossover with SL={stop_loss*100}% and TP={take_profit*100}%) for {timeframe}:")
            print(f"Profitable Signals: {sma_profitable_pct:.2%}, Avg Return: {sma_avg_return:.4f}, "
                  f"Hit Rate: {sma_hit_rate:.2%}, Loss Rate: {sma_loss_rate:.2%}")
    else:
        print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] No SMA crossover signals generated.")
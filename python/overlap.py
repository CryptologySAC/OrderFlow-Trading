import pandas as pd
import numpy as np
from itertools import combinations

# Load the CSV files
price_reversal_df = pd.read_csv('filtered_ltcusdt_price_reversal.csv')
delta_direction_df = pd.read_csv('filtered_ltcusdt_delta_direction.csv')
order_flow_df = pd.read_csv('filtered_ltcusdt_order_flow_imbalance.csv')
vwap_deviation_df = pd.read_csv('filtered_ltcusdt_vwap_deviation.csv')

# Dictionary of filter names and their dataframes
filters = {
    'price_reversal': price_reversal_df,
    'delta_direction': delta_direction_df,
    'order_flow_imbalance': order_flow_df,
    'vwap_deviation': vwap_deviation_df
}

# Function to analyze outcomes for a set of trades
def analyze_outcomes(trades_df, filter_name):
    if trades_df.empty:
        return {
            'filter': filter_name,
            'total_trades': 0,
            'buy_trades': 0,
            'buy_tp_percent': 0,
            'buy_sl_percent': 0,
            'sell_trades': 0,
            'sell_tp_percent': 0,
            'sell_sl_percent': 0
        }
    
    buy_trades = trades_df[trades_df['trade_type'] == 'buy']
    sell_trades = trades_df[trades_df['trade_type'] == 'sell']
    
    buy_outcomes = buy_trades['outcome'].value_counts(normalize=True) * 100
    sell_outcomes = sell_trades['outcome'].value_counts(normalize=True) * 100
    
    return {
        'filter': filter_name,
        'total_trades': len(trades_df),
        'buy_trades': len(buy_trades),
        'buy_tp_percent': buy_outcomes.get('TP First', 0),
        'buy_sl_percent': buy_outcomes.get('SL First', 0),
        'sell_trades': len(sell_trades),
        'sell_tp_percent': sell_outcomes.get('TP First', 0),
        'sell_sl_percent': sell_outcomes.get('SL First', 0)
    }

# Find trades overlapping across all filters
all_trade_ids = [set(df['trade_id']) for df in filters.values()]
overlapping_ids = set.intersection(*all_trade_ids)

# Get overlapping trades from one dataframe (e.g., price_reversal) and verify consistency
overlapping_trades = price_reversal_df[price_reversal_df['trade_id'].isin(overlapping_ids)]

# Analyze outcomes for overlapping trades
all_filters_result = analyze_outcomes(overlapping_trades, 'all_filters')

# Analyze pairwise filter combinations
pairwise_results = []
filter_names = list(filters.keys())
for combo in combinations(filter_names, 2):
    filter1, filter2 = combo
    ids1 = set(filters[filter1]['trade_id'])
    ids2 = set(filters[filter2]['trade_id'])
    combo_ids = ids1.intersection(ids2)
    combo_trades = filters[filter1][filters[filter1]['trade_id'].isin(combo_ids)]
    result = analyze_outcomes(combo_trades, f"{filter1}+{filter2}")
    pairwise_results.append(result)

# Print results
print("\nAnalysis of Trades Overlapping Across All Filters:")
print(f"Total Closed Trades: {all_filters_result['total_trades']}")
print(f"Buy Trades: {all_filters_result['buy_trades']}")
print(f"Buy Outcome Percentages:")
print(f"  +1% First (TP First): {all_filters_result['buy_tp_percent']:.2f}%")
print(f"  -1% First (SL First): {all_filters_result['buy_sl_percent']:.2f}%")
print(f"Sell Trades: {all_filters_result['sell_trades']}")
print(f"Sell Outcome Percentages:")
print(f"  +1% First (TP First): {all_filters_result['sell_tp_percent']:.2f}%")
print(f"  -1% First (SL First): {all_filters_result['sell_sl_percent']:.2f}%")

print("\nPairwise Filter Combination Analysis:")
for result in pairwise_results:
    print(f"\nFilter Combination: {result['filter']}")
    print(f"Total Closed Trades: {result['total_trades']}")
    print(f"Buy Trades: {result['buy_trades']}")
    print(f"Buy Outcome Percentages:")
    print(f"  +1% First (TP First): {result['buy_tp_percent']:.2f}%")
    print(f"  -1% First (SL First): {result['buy_sl_percent']:.2f}%")
    print(f"Sell Trades: {result['sell_trades']}")
    print(f"Sell Outcome Percentages:")
    print(f"  +1% First (TP First): {result['sell_tp_percent']:.2f}%")
    print(f"  -1% First (SL First): {result['sell_sl_percent']:.2f}%")

# Save overlapping trades to CSV
overlapping_trades.to_csv('filtered_ltcusdt_all_filters_overlap.csv', index=False)
import pandas as pd
import numpy as np
from scipy.stats import chi2_contingency
from multiprocessing import Pool
import sqlite3

# Load data from SQLite database
def load_data(db_path):
    """Load trade data from SQLite database."""
    conn = sqlite3.connect(db_path)
    query = "SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime"
    df = pd.read_sql_query(query, conn)
    conn.close()
    df['tradeTime'] = pd.to_datetime(df['tradeTime'])
    df = df.drop_duplicates().sort_values('tradeTime')
    df['buy_sell'] = df['isBuyerMaker'].apply(lambda x: 'buy' if x else 'sell')
    df['buy_volume'] = df.apply(lambda x: x['quantity'] if x['buy_sell'] == 'buy' else 0, axis=1)
    df['sell_volume'] = df.apply(lambda x: x['quantity'] if x['buy_sell'] == 'sell' else 0, axis=1)
    return df

# Detect swing highs with 1% distance condition
def detect_swing_highs(df, lookback=50, lookforward=50, min_distance=0.01):
    """Identify swing highs with at least 1% distance from preceding swing low."""
    prices = df['price'].values
    swing_highs = []
    swing_lows = []
    
    for i in range(lookback, len(prices) - lookforward):
        if (prices[i] > max(prices[i - lookback:i]) and 
            prices[i] > max(prices[i + 1:i + lookforward + 1])):
            # Find the preceding swing low
            prev_low = min(prices[i - lookback:i])
            if (prices[i] - prev_low) / prev_low >= min_distance:
                swing_highs.append(i)
        elif (prices[i] < min(prices[i - lookback:i]) and 
              prices[i] < min(prices[i + 1:i + lookforward + 1])):
            swing_lows.append(i)
    
    df['swing_high'] = False
    df['swing_low'] = False
    df.iloc[swing_highs, df.columns.get_loc('swing_high')] = True
    df.iloc[swing_lows, df.columns.get_loc('swing_low')] = True
    return df

# Compute features
def compute_features(df, window=100):
    """Calculate features from raw trade data."""
    df['cum_volume_delta'] = (df['buy_volume'] - df['sell_volume']).rolling(window).sum()
    df['price_momentum'] = df['price'].diff(window) / df['price'].shift(window)
    df['order_flow_imbalance'] = (df['buy_volume'] - df['sell_volume']).rolling(window).mean()
    df['absorption'] = df['quantity'].rolling(window).sum() / df['price'].diff(window).abs()  # Corrected from 'volume' to 'quantity'
    df['volatility'] = df['price'].diff().rolling(window).std()
    return df.fillna(0)

# Detect and test patterns
def detect_patterns(df, window=100):
    """Identify and test patterns preceding swing highs."""
    features = ['cum_volume_delta', 'price_momentum', 'order_flow_imbalance', 
               'absorption', 'volatility']
    results = {}
    
    for feature in features:
        threshold = df[feature].quantile(0.9)
        df[f'{feature}_extreme'] = df[feature] > threshold
        
        swing_high_idx = df[df['swing_high']].index
        before_swing = swing_high_idx - window
        before_swing = [i for i in before_swing if i >= 0]
        random_points = np.random.choice(df.index[:-window], len(before_swing), replace=False)
        
        swing_count = df.loc[before_swing, f'{feature}_extreme'].sum()
        random_count = df.loc[random_points, f'{feature}_extreme'].sum()
        
        contingency = [[swing_count, len(before_swing) - swing_count],
                       [random_count, len(random_points) - random_count]]
        chi2, p_value, _, _ = chi2_contingency(contingency)
        results[feature] = {'chi2': chi2, 'p_value': p_value}
    
    return results

# Analyze distribution
def analyze_distribution(df, feature, window=100):
    """Check pattern distribution over time."""
    extreme_col = f'{feature}_extreme'
    df[extreme_col] = df[feature] > df[feature].quantile(0.9)
    occurrences = df[df[extreme_col]].index
    time_diff = np.diff(occurrences)
    uniformity = np.std(time_diff) / np.mean(time_diff)  # Coefficient of variation
    return uniformity

# Parallel feature computation
def process_chunk(args):
    """Helper for parallel feature computation."""
    df_chunk, feature, window = args
    df_chunk[feature] = df_chunk[feature].rolling(window).mean()
    return df_chunk

def parallel_feature_computation(df, features, window=100):
    """Compute features in parallel."""
    with Pool() as pool:
        chunks = np.array_split(df, pool._processes)
        args = [(chunk, feature, window) for chunk in chunks for feature in features]
        results = pool.map(process_chunk, args)
    return pd.concat(results)

# Main execution
if __name__ == "__main__":
    db_path = '../trades.db'
    df = load_data(db_path)
    df = detect_swing_highs(df)
    df = compute_features(df)
    pattern_results = detect_patterns(df)
    print("Pattern Significance:")
    for feature, stats in pattern_results.items():
        print(f"{feature}: chi2={stats['chi2']:.2f}, p-value={stats['p_value']:.4f}")
    for feature in pattern_results.keys():
        uniformity = analyze_distribution(df, feature)
        print(f"{feature} distribution uniformity: {uniformity:.2f}")
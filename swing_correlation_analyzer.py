#!/usr/bin/env python3
"""
Signal-Swing Correlation Analyzer (Simplified)
Matches trading signals to actual price swings (>= 0.7% movements)
to determine optimal parameter settings
"""

import pandas as pd
import numpy as np
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
import json
from scipy import stats, signal
import warnings
warnings.filterwarnings('ignore')

class SwingCorrelationAnalyzer:
    def __init__(self, db_path, log_directory, swing_threshold=0.007):
        """
        Initialize analyzer
        
        Args:
            db_path: Path to trades.db
            log_directory: Path to signal validation logs
            swing_threshold: Minimum swing size (0.007 = 0.7%)
        """
        self.db_path = db_path
        self.log_dir = Path(log_directory)
        self.swing_threshold = swing_threshold
        self.price_data = None
        self.swings = None
        self.all_signals = pd.DataFrame()
        self.matched_signals = pd.DataFrame()
        
    def load_price_data(self, hours=24):
        """Load price data from trades database"""
        print(f"📊 Loading {hours} hours of price data from database...")
        
        conn = sqlite3.connect(self.db_path)
        
        # Calculate milliseconds for N hours ago
        ms_per_hour = 3600000
        hours_ago_ms = int((datetime.now().timestamp() * 1000) - (hours * ms_per_hour))
        
        # Get price data from aggregated_trades table (tradeTime is in milliseconds)
        query = """
        SELECT tradeTime as timestamp, price
        FROM aggregated_trades
        WHERE tradeTime > ?
        ORDER BY tradeTime
        """
        
        try:
            self.price_data = pd.read_sql_query(query, conn, params=[hours_ago_ms])
            
            # Keep timestamps as milliseconds, just set as index
            self.price_data = self.price_data.set_index('timestamp')
            
            # Resample using millisecond timestamps (group by minute = 60000ms)
            # Create minute buckets
            self.price_data['minute_bucket'] = (self.price_data.index // 60000) * 60000
            self.price_data = self.price_data.groupby('minute_bucket').agg({
                'price': 'last'  # Use last price in each minute
            })
            
            print(f"  ✓ Loaded {len(self.price_data)} price points (1-min candles)")
            if not self.price_data.empty:
                min_ts = self.price_data.index.min()
                max_ts = self.price_data.index.max()
                print(f"  ✓ Timestamp range: {min_ts} to {max_ts}")
                print(f"  ✓ Price range: ${self.price_data['price'].min():.2f} - ${self.price_data['price'].max():.2f}")
            
        except Exception as e:
            print(f"  ⚠️ Error loading price data: {e}")
            # Try to get basic info
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM aggregated_trades")
                count = cursor.fetchone()[0]
                print(f"  ℹ️ Total rows in aggregated_trades: {count}")
                
                # Get date range
                cursor.execute("SELECT MIN(tradeTime), MAX(tradeTime) FROM aggregated_trades")
                min_time, max_time = cursor.fetchone()
                if min_time and max_time:
                    print(f"  ℹ️ Data range: {min_time} to {max_time}")
            except Exception as e2:
                print(f"  ⚠️ Error getting info: {e2}")
        finally:
            conn.close()
    
    def detect_swings(self, window=10):
        """
        Detect swing highs and lows in price data
        
        Args:
            window: Rolling window for swing detection (in minutes)
        """
        if self.price_data is None or self.price_data.empty:
            print("  ⚠️ No price data available for swing detection")
            return
        
        print(f"\n🔍 Detecting swing points (window={window} minutes)...")
        
        prices = self.price_data['price'].values
        
        # Find local maxima and minima using scipy
        # Prominence set to 0.1% of mean price to filter noise
        min_prominence = prices.mean() * 0.001
        
        peaks, _ = signal.find_peaks(prices, distance=window, prominence=min_prominence)
        valleys, _ = signal.find_peaks(-prices, distance=window, prominence=min_prominence)
        
        swings = []
        
        # Create swing points (with millisecond timestamps)
        for idx in peaks:
            swings.append({
                'timestamp': self.price_data.index[idx],  # This is in milliseconds
                'price': prices[idx],
                'type': 'high',
                'index': idx
            })
        
        for idx in valleys:
            swings.append({
                'timestamp': self.price_data.index[idx],  # This is in milliseconds
                'price': prices[idx],
                'type': 'low',
                'index': idx
            })
        
        # Sort by timestamp
        swings = sorted(swings, key=lambda x: x['timestamp'])
        
        # Calculate swing movements
        swing_movements = []
        for i in range(1, len(swings)):
            prev_swing = swings[i-1]
            curr_swing = swings[i]
            
            # Only consider high->low or low->high
            if prev_swing['type'] != curr_swing['type']:
                price_change = curr_swing['price'] - prev_swing['price']
                pct_change = abs(price_change) / prev_swing['price']
                
                if pct_change >= self.swing_threshold:
                    swing_movements.append({
                        'start_time': prev_swing['timestamp'],
                        'end_time': curr_swing['timestamp'],
                        'start_price': prev_swing['price'],
                        'end_price': curr_swing['price'],
                        'start_type': prev_swing['type'],
                        'end_type': curr_swing['type'],
                        'price_change': price_change,
                        'pct_change': pct_change,
                        'direction': 'up' if price_change > 0 else 'down',
                        'duration_minutes': (curr_swing['timestamp'] - prev_swing['timestamp']) / 60000  # Convert ms to minutes
                    })
        
        self.swings = pd.DataFrame(swing_movements)
        
        if not self.swings.empty:
            print(f"  ✓ Found {len(self.swings)} significant swings (>= {self.swing_threshold*100:.1f}%)")
            print(f"  ✓ Average swing: {self.swings['pct_change'].mean()*100:.2f}%")
            print(f"  ✓ Largest swing: {self.swings['pct_change'].max()*100:.2f}%")
            print(f"  ✓ Up swings: {len(self.swings[self.swings['direction'] == 'up'])}")
            print(f"  ✓ Down swings: {len(self.swings[self.swings['direction'] == 'down'])}")
            print(f"  ✓ Average duration: {self.swings['duration_minutes'].mean():.1f} minutes")
        else:
            print(f"  ⚠️ No swings found above {self.swing_threshold*100:.1f}% threshold")
            # Show all detected peaks/valleys for debugging
            print(f"  ℹ️ Detected {len(peaks)} peaks and {len(valleys)} valleys")
            if len(swings) > 1:
                # Calculate all swing sizes to see what we're getting
                all_swings = []
                for i in range(1, len(swings)):
                    if swings[i-1]['type'] != swings[i]['type']:
                        pct = abs(swings[i]['price'] - swings[i-1]['price']) / swings[i-1]['price']
                        all_swings.append(pct * 100)
                if all_swings:
                    print(f"  ℹ️ Swing sizes found: {sorted(all_swings)[:5]} ... (showing first 5)")
    
    def load_all_signals(self):
        """Load all signals from CSV files (validation, successful, rejections)"""
        print("\n📁 Loading all signal data...")
        
        signal_types = ['absorption', 'deltacvd', 'exhaustion']
        categories = ['validation', 'successful', 'rejections']
        
        all_dfs = []
        
        for signal_type in signal_types:
            for category in categories:
                pattern = f"{signal_type}_{category}_*.csv"
                files = list(self.log_dir.glob(pattern))
                
                for file in files:
                    try:
                        df = pd.read_csv(file)
                        if not df.empty and len(df) > 0:
                            # Add metadata
                            df['signal_type'] = signal_type
                            df['category'] = category
                            df['source_file'] = file.name
                            
                            # Parse timestamp - keep as milliseconds
                            if 'timestamp' in df.columns:
                                # Just ensure it's numeric
                                df['timestamp'] = pd.to_numeric(df['timestamp'], errors='coerce')
                            
                            all_dfs.append(df)
                            print(f"  ✓ Loaded {len(df)} {signal_type} {category} signals from {file.name}")
                    except Exception as e:
                        print(f"  ⚠️ Error loading {file.name}: {e}")
        
        if len(all_dfs) > 0:
            self.all_signals = pd.concat(all_dfs, ignore_index=True)
            # Remove any rows with invalid timestamps
            if 'timestamp' in self.all_signals.columns:
                before_count = len(self.all_signals)
                self.all_signals = self.all_signals.dropna(subset=['timestamp'])
                if before_count != len(self.all_signals):
                    print(f"  ℹ️ Removed {before_count - len(self.all_signals)} signals with invalid timestamps")
            print(f"\n  ✓ Total signals loaded: {len(self.all_signals)}")
        else:
            self.all_signals = pd.DataFrame()
            print("  ⚠️ No signals loaded")
    
    def match_signals_to_swings(self, lookforward_minutes=60):
        """
        Match signals to subsequent swing movements
        
        Args:
            lookforward_minutes: Time window to look for swings after signal
        """
        if self.swings is None or self.swings.empty:
            print("  ⚠️ No swings detected to match signals against")
            return
        
        if self.all_signals.empty:
            print("  ⚠️ No signals loaded to match")
            return
        
        print(f"\n🔗 Matching signals to swings (lookforward: {lookforward_minutes} minutes)...")
        
        matched = []
        
        for _, signal_row in self.all_signals.iterrows():
            if 'timestamp' not in signal_row or pd.isna(signal_row['timestamp']):
                continue
            
            signal_time = signal_row['timestamp']  # This is in milliseconds
            signal_price = signal_row.get('price', 0)
            
            # Find swings that started within the lookforward window (in milliseconds)
            time_window_end = signal_time + (lookforward_minutes * 60000)
            
            potential_swings = self.swings[
                (self.swings['start_time'] >= signal_time) & 
                (self.swings['start_time'] <= time_window_end)
            ]
            
            if not potential_swings.empty:
                # Match to the first qualifying swing
                best_swing = potential_swings.iloc[0]
                
                # Determine if signal direction matches swing
                signal_side = str(signal_row.get('signalSide', '')).lower()
                swing_direction = best_swing['direction']
                
                direction_match = (
                    (signal_side in ['buy', 'long'] and swing_direction == 'up') or
                    (signal_side in ['sell', 'short'] and swing_direction == 'down')
                )
                
                matched_entry = {
                    # Signal info
                    'signal_id': signal_row.get('signalId', ''),
                    'signal_type': signal_row['signal_type'],
                    'signal_category': signal_row['category'],
                    'signal_time': signal_time,
                    'signal_price': signal_price,
                    'signal_side': signal_side,
                    'signal_confidence': signal_row.get('confidence', 0),
                    
                    # Swing info
                    'swing_start_time': best_swing['start_time'],
                    'swing_end_time': best_swing['end_time'],
                    'swing_start_price': best_swing['start_price'],
                    'swing_end_price': best_swing['end_price'],
                    'swing_pct_change': best_swing['pct_change'],
                    'swing_direction': swing_direction,
                    
                    # Match info
                    'time_to_swing_minutes': (best_swing['start_time'] - signal_time) / 60000,  # Convert ms to minutes
                    'direction_match': direction_match,
                    'is_successful': direction_match and best_swing['pct_change'] >= self.swing_threshold,
                    
                    # Add all signal parameters for analysis
                    **{k: v for k, v in signal_row.items() 
                       if k not in ['signal_type', 'category', 'timestamp', 'price', 'signalSide', 'confidence', 'source_file']}
                }
                
                matched.append(matched_entry)
            else:
                # No swing found - unsuccessful signal
                matched_entry = {
                    'signal_id': signal_row.get('signalId', ''),
                    'signal_type': signal_row['signal_type'],
                    'signal_category': signal_row['category'],
                    'signal_time': signal_time,
                    'signal_price': signal_price,
                    'signal_side': str(signal_row.get('signalSide', '')).lower(),
                    'signal_confidence': signal_row.get('confidence', 0),
                    'is_successful': False,
                    'no_swing_found': True,
                    
                    # Add all signal parameters
                    **{k: v for k, v in signal_row.items() 
                       if k not in ['signal_type', 'category', 'timestamp', 'price', 'signalSide', 'confidence', 'source_file']}
                }
                matched.append(matched_entry)
        
        self.matched_signals = pd.DataFrame(matched) if matched else pd.DataFrame()
        
        if not self.matched_signals.empty:
            success_rate = self.matched_signals['is_successful'].mean() * 100
            print(f"  ✓ Matched {len(self.matched_signals)} signals")
            print(f"  ✓ Overall success rate: {success_rate:.1f}%")
            
            # Success rate by signal type
            for signal_type in self.matched_signals['signal_type'].unique():
                type_data = self.matched_signals[self.matched_signals['signal_type'] == signal_type]
                type_success = type_data['is_successful'].mean() * 100
                print(f"    • {signal_type}: {type_success:.1f}% success rate ({len(type_data)} signals)")
                
            # Show breakdown by category
            print("\n  📊 Breakdown by category:")
            for category in ['validation', 'successful', 'rejections']:
                cat_data = self.matched_signals[self.matched_signals['signal_category'] == category]
                if not cat_data.empty:
                    cat_success = cat_data['is_successful'].mean() * 100
                    print(f"    • {category}: {cat_success:.1f}% success rate ({len(cat_data)} signals)")
        else:
            print("  ⚠️ No signals could be matched")
    
    def analyze_parameter_differences(self):
        """Analyze parameter differences between successful and unsuccessful signals"""
        if not hasattr(self, 'matched_signals') or self.matched_signals.empty:
            print("  ⚠️ No matched signals to analyze")
            return {}
        
        print("\n🔬 Analyzing parameter differences between successful and unsuccessful signals...")
        
        analysis_results = {}
        
        # Analyze by signal type
        for signal_type in self.matched_signals['signal_type'].unique():
            print(f"\n  {signal_type.upper()}:")
            
            type_data = self.matched_signals[self.matched_signals['signal_type'] == signal_type]
            successful = type_data[type_data['is_successful'] == True]
            unsuccessful = type_data[type_data['is_successful'] == False]
            
            if len(successful) == 0 or len(unsuccessful) == 0:
                print(f"    ⚠️ Insufficient data (successful: {len(successful)}, unsuccessful: {len(unsuccessful)})")
                continue
            
            # Key parameters to analyze (based on your signal types)
            key_params = [
                # Absorption parameters
                'minAggVolume', 'priceEfficiencyThreshold', 'maxAbsorptionRatio',
                'minPassiveMultiplier', 'passiveAbsorptionThreshold', 'finalConfidenceRequired',
                'minAbsorptionScore', 'eventCooldownMs', 'contextConfidenceBoostMultiplier',
                'liquidityGradientRange', 'institutionalVolumeThreshold',
                
                # DeltaCVD parameters
                'minDelta', 'timeWindow', 'priceThreshold', 'minFlowConfidence',
                'useVariableVWAP', 'volumeWeightedDelta',
                
                # Exhaustion parameters
                'minBidAskImbalance', 'volumeThreshold', 'deltaThreshold',
                'priceRangeThreshold', 'timeWindowSeconds'
            ]
            
            param_analysis = {}
            
            for param in key_params:
                if param not in type_data.columns:
                    continue
                
                success_values = successful[param].dropna()
                unsuccess_values = unsuccessful[param].dropna()
                
                if success_values.empty or unsuccess_values.empty:
                    continue
                
                # Skip if values are constant
                if success_values.std() == 0 and unsuccess_values.std() == 0:
                    continue
                
                # Calculate statistics
                analysis = {
                    'successful_mean': success_values.mean(),
                    'unsuccessful_mean': unsuccess_values.mean(),
                    'successful_median': success_values.median(),
                    'unsuccessful_median': unsuccess_values.median(),
                    'successful_std': success_values.std(),
                    'unsuccessful_std': unsuccess_values.std(),
                    'difference': success_values.mean() - unsuccess_values.mean(),
                    'pct_difference': ((success_values.mean() - unsuccess_values.mean()) / abs(unsuccess_values.mean()) * 100) 
                                     if unsuccess_values.mean() != 0 else 0
                }
                
                # Statistical significance test
                if len(success_values) > 1 and len(unsuccess_values) > 1:
                    try:
                        t_stat, p_value = stats.ttest_ind(success_values, unsuccess_values)
                        analysis['p_value'] = p_value
                        analysis['is_significant'] = p_value < 0.05
                        
                        if analysis['is_significant']:
                            print(f"    ✅ {param}:")
                            print(f"       Successful avg: {analysis['successful_mean']:.4f}")
                            print(f"       Unsuccessful avg: {analysis['unsuccessful_mean']:.4f}")
                            print(f"       Difference: {analysis['pct_difference']:.1f}% (p={p_value:.4f})")
                    except:
                        analysis['p_value'] = 1.0
                        analysis['is_significant'] = False
                
                param_analysis[param] = analysis
            
            analysis_results[signal_type] = {
                'total_signals': len(type_data),
                'successful_count': len(successful),
                'unsuccessful_count': len(unsuccessful),
                'success_rate': len(successful) / len(type_data) * 100,
                'parameters': param_analysis
            }
        
        return analysis_results
    
    def find_optimal_settings(self, analysis_results):
        """Generate optimal parameter recommendations based on analysis"""
        print("\n🎯 OPTIMAL PARAMETER RECOMMENDATIONS")
        print("="*60)
        
        recommendations = {}
        
        for signal_type, analysis in analysis_results.items():
            print(f"\n{signal_type.upper()} SIGNALS")
            print(f"Success Rate: {analysis['success_rate']:.1f}%")
            print("-"*40)
            
            type_recommendations = {}
            
            # Sort parameters by significance and effect size
            significant_params = [
                (param, data) for param, data in analysis['parameters'].items()
                if data.get('is_significant', False)
            ]
            
            significant_params.sort(key=lambda x: abs(x[1]['pct_difference']), reverse=True)
            
            for param, data in significant_params[:10]:  # Top 10 most impactful
                # Recommend moving toward successful mean
                recommended_value = data['successful_mean']
                current_typical = data['unsuccessful_mean']
                
                type_recommendations[param] = {
                    'current_typical': current_typical,
                    'recommended': recommended_value,
                    'change_required': data['pct_difference'],
                    'confidence': 1 - data['p_value']  # Convert p-value to confidence
                }
                
                direction = "↑ Increase" if recommended_value > current_typical else "↓ Decrease"
                print(f"\n  {param}:")
                print(f"    Current (unsuccessful): {current_typical:.4f}")
                print(f"    Optimal (successful):   {recommended_value:.4f}")
                print(f"    Action: {direction} by {abs(data['pct_difference']):.1f}%")
                print(f"    Confidence: {(1 - data['p_value']) * 100:.1f}%")
            
            recommendations[signal_type] = type_recommendations
        
        return recommendations
    
    def generate_swing_report(self):
        """Generate comprehensive swing correlation report"""
        print("\n" + "="*70)
        print("📊 SIGNAL-SWING CORRELATION ANALYSIS REPORT")
        print("="*70)
        
        # Load price data
        self.load_price_data(hours=24)
        
        # Detect swings
        if self.price_data is not None and not self.price_data.empty:
            self.detect_swings(window=10)  # 10-minute window for 1-min candles
        
        # Load all signals
        self.load_all_signals()
        
        # Match signals to swings
        if not self.all_signals.empty and self.swings is not None:
            self.match_signals_to_swings(lookforward_minutes=60)
        
        # Analyze parameter differences
        analysis_results = {}
        recommendations = {}
        
        if hasattr(self, 'matched_signals') and not self.matched_signals.empty:
            analysis_results = self.analyze_parameter_differences()
            
            # Find optimal settings
            if analysis_results:
                recommendations = self.find_optimal_settings(analysis_results)
        
        # Save results
        self.save_results(analysis_results, recommendations)
        
        return analysis_results, recommendations
    
    def save_results(self, analysis_results, recommendations):
        """Save analysis results to files"""
        
        # Save detailed analysis
        with open('swing_correlation_analysis.json', 'w') as f:
            # Convert numpy types for JSON serialization
            def convert_types(obj):
                if isinstance(obj, (np.integer, np.int64)):
                    return int(obj)
                elif isinstance(obj, (np.floating, np.float64)):
                    return float(obj)
                elif isinstance(obj, np.ndarray):
                    return obj.tolist()
                elif isinstance(obj, dict):
                    return {k: convert_types(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [convert_types(item) for item in obj]
                elif pd.isna(obj):
                    return None
                return obj
            
            json.dump(convert_types({
                'timestamp': datetime.now().isoformat(),
                'swing_threshold': self.swing_threshold,
                'analysis': analysis_results,
                'recommendations': recommendations,
                'swings_detected': len(self.swings) if self.swings is not None else 0,
                'signals_analyzed': len(self.all_signals) if not self.all_signals.empty else 0
            }), f, indent=2)
        
        # Save matched signals for further analysis
        if hasattr(self, 'matched_signals') and not self.matched_signals.empty:
            self.matched_signals.to_csv('matched_signals.csv', index=False)
            print(f"\n✅ Matched signals saved to 'matched_signals.csv'")
        
        # Save swings for review
        if self.swings is not None and not self.swings.empty:
            self.swings.to_csv('detected_swings.csv', index=False)
            print(f"✅ Detected swings saved to 'detected_swings.csv'")
        
        # Save recommendations as CSV
        rec_rows = []
        for signal_type, params in recommendations.items():
            for param_name, param_data in params.items():
                rec_rows.append({
                    'signal_type': signal_type,
                    'parameter': param_name,
                    'current_value': param_data['current_typical'],
                    'recommended_value': param_data['recommended'],
                    'change_percent': param_data['change_required'],
                    'confidence_percent': param_data['confidence'] * 100
                })
        
        if rec_rows:
            pd.DataFrame(rec_rows).to_csv('swing_based_recommendations.csv', index=False)
            print(f"✅ Recommendations saved to 'swing_based_recommendations.csv'")
        
        print(f"✅ Full analysis saved to 'swing_correlation_analysis.json'")


def main():
    # Configuration
    db_path = "/Users/marcschot/Projects/OrderFlow Trading/storage/trades.db"
    log_directory = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation"
    
    # Create analyzer with 0.7% swing threshold
    analyzer = SwingCorrelationAnalyzer(
        db_path=db_path,
        log_directory=log_directory,
        swing_threshold=0.007  # 0.7% minimum swing
    )
    
    # Run complete analysis
    analysis_results, recommendations = analyzer.generate_swing_report()
    
    # Print summary
    print("\n" + "="*70)
    print("📈 ANALYSIS COMPLETE")
    print("="*70)
    print("\n🎯 Key Findings:")
    
    if hasattr(analyzer, 'matched_signals') and not analyzer.matched_signals.empty:
        # Overall statistics
        total_signals = len(analyzer.matched_signals)
        successful = analyzer.matched_signals['is_successful'].sum()
        success_rate = (successful / total_signals) * 100
        
        print(f"\n  Total Signals Analyzed: {total_signals}")
        print(f"  Successful (caught ≥0.7% swings): {successful}")
        print(f"  Overall Success Rate: {success_rate:.1f}%")
        
        # By signal type
        print("\n  Success Rates by Type:")
        for signal_type in analyzer.matched_signals['signal_type'].unique():
            type_data = analyzer.matched_signals[analyzer.matched_signals['signal_type'] == signal_type]
            type_success = type_data['is_successful'].mean() * 100
            print(f"    • {signal_type}: {type_success:.1f}%")
        
        # Top recommendations
        print("\n  Top Parameter Adjustments Needed:")
        for signal_type, params in recommendations.items():
            if params:
                top_param = max(params.items(), key=lambda x: abs(x[1]['change_required']))
                param_name, param_data = top_param
                print(f"    • {signal_type}: Adjust {param_name} by {param_data['change_required']:.1f}%")
    else:
        print("\n  ⚠️ No matched signals to analyze")
        if analyzer.swings is not None:
            print(f"  ℹ️ Found {len(analyzer.swings)} swings but couldn't match to signals")
        if not analyzer.all_signals.empty:
            print(f"  ℹ️ Loaded {len(analyzer.all_signals)} signals but no swings to match")
    
    print("\n" + "="*70)
    print("📁 Output Files Generated:")
    print("  • swing_correlation_analysis.json - Complete analysis")
    print("  • swing_based_recommendations.csv - Parameter recommendations")
    print("  • matched_signals.csv - All signal-swing matches")
    print("  • detected_swings.csv - All detected price swings")
    print("="*70)


if __name__ == "__main__":
    main()

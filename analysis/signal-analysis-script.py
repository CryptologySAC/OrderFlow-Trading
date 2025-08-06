#!/usr/bin/env python3
"""
Signal Validation Analysis Script
Analyzes trading signal validation logs to determine optimal settings
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

class SignalAnalyzer:
    def __init__(self, log_directory):
        self.log_dir = Path(log_directory)
        self.data = {}
        self.signal_types = ['absorption', 'deltacvd', 'exhaustion']
        self.categories = ['validation', 'successful', 'rejections']
        
    def load_all_data(self):
        """Load all CSV files from the log directory"""
        print("📁 Loading signal validation data...")
        
        for signal_type in self.signal_types:
            self.data[signal_type] = {}
            
            for category in self.categories:
                pattern = f"{signal_type}_{category}_*.csv"
                files = list(self.log_dir.glob(pattern))
                
                if files:
                    dfs = []
                    for file in files:
                        try:
                            df = pd.read_csv(file)
                            if not df.empty:
                                df['date'] = file.stem.split('_')[-1]
                                dfs.append(df)
                        except Exception as e:
                            print(f"  ⚠️  Error loading {file.name}: {e}")
                    
                    if dfs:
                        self.data[signal_type][category] = pd.concat(dfs, ignore_index=True)
                        print(f"  ✓ Loaded {len(dfs)} {signal_type} {category} files ({len(self.data[signal_type][category])} records)")
    
    def calculate_metrics(self, signal_type=None):
        """Calculate performance metrics for signals"""
        results = {}
        
        signal_types = [signal_type] if signal_type else self.signal_types
        
        for st in signal_types:
            if st not in self.data or not self.data[st]:
                continue
                
            metrics = {}
            
            # Count signals by category
            for category in self.categories:
                if category in self.data[st]:
                    metrics[f'{category}_count'] = len(self.data[st][category])
            
            # Calculate success rate
            total = metrics.get('validation_count', 0)
            successful = metrics.get('successful_count', 0)
            if total > 0:
                metrics['success_rate'] = (successful / total) * 100
            
            # Analyze confidence scores
            if 'successful' in self.data[st] and 'confidence' in self.data[st]['successful'].columns:
                successful_conf = self.data[st]['successful']['confidence'].dropna()
                if not successful_conf.empty:
                    metrics['avg_successful_confidence'] = successful_conf.mean()
                    metrics['median_successful_confidence'] = successful_conf.median()
                    metrics['std_successful_confidence'] = successful_conf.std()
            
            if 'rejections' in self.data[st] and 'confidence' in self.data[st]['rejections'].columns:
                rejected_conf = self.data[st]['rejections']['confidence'].dropna()
                if not rejected_conf.empty:
                    metrics['avg_rejected_confidence'] = rejected_conf.mean()
                    metrics['confidence_delta'] = metrics.get('avg_successful_confidence', 0) - rejected_conf.mean()
            
            # Analyze accuracy at different timeframes
            if 'validation' in self.data[st]:
                val_data = self.data[st]['validation']
                for timeframe in ['5min', '15min', '1hr']:
                    col = f'signalAccuracy{timeframe}'
                    if col in val_data.columns:
                        accuracy_data = val_data[col].dropna()
                        if not accuracy_data.empty:
                            metrics[f'accuracy_{timeframe}'] = (accuracy_data.sum() / len(accuracy_data)) * 100
            
            results[st] = metrics
        
        return results
    
    def find_optimal_parameters(self, signal_type=None):
        """Find optimal parameter settings based on successful signals"""
        optimal_settings = {}
        
        signal_types = [signal_type] if signal_type else self.signal_types
        
        # Key parameters to analyze
        key_params = [
            'minAggVolume',
            'priceEfficiencyThreshold',
            'maxAbsorptionRatio',
            'minPassiveMultiplier',
            'passiveAbsorptionThreshold',
            'finalConfidenceRequired',
            'minAbsorptionScore',
            'eventCooldownMs',
            'contextConfidenceBoostMultiplier'
        ]
        
        for st in signal_types:
            if st not in self.data or 'successful' not in self.data[st]:
                continue
            
            successful_data = self.data[st]['successful']
            rejected_data = self.data[st].get('rejections', pd.DataFrame())
            
            optimal_settings[st] = {}
            
            for param in key_params:
                if param not in successful_data.columns:
                    continue
                
                success_values = successful_data[param].dropna()
                reject_values = rejected_data[param].dropna() if not rejected_data.empty and param in rejected_data.columns else pd.Series()
                
                if success_values.empty:
                    continue
                
                # Calculate statistics
                param_stats = {
                    'current_mean': success_values.mean(),
                    'current_median': success_values.median(),
                    'current_std': success_values.std(),
                    'current_min': success_values.min(),
                    'current_max': success_values.max()
                }
                
                # Weight by confidence if available
                if 'confidence' in successful_data.columns:
                    conf_values = successful_data.loc[success_values.index, 'confidence'].dropna()
                    if not conf_values.empty:
                        weights = conf_values / conf_values.sum()
                        weighted_mean = (success_values * weights).sum()
                        param_stats['confidence_weighted_optimal'] = weighted_mean
                
                # Compare with rejected signals
                if not reject_values.empty:
                    param_stats['reject_mean'] = reject_values.mean()
                    param_stats['success_vs_reject_delta'] = param_stats['current_mean'] - param_stats['reject_mean']
                    
                    # Statistical test for significance
                    if len(success_values) > 1 and len(reject_values) > 1:
                        t_stat, p_value = stats.ttest_ind(success_values, reject_values)
                        param_stats['p_value'] = p_value
                        param_stats['is_significant'] = p_value < 0.05
                
                # Determine optimal value
                if 'confidence_weighted_optimal' in param_stats:
                    param_stats['recommended_value'] = param_stats['confidence_weighted_optimal']
                else:
                    # Use 75th percentile of successful signals as optimal
                    param_stats['recommended_value'] = success_values.quantile(0.75)
                
                optimal_settings[st][param] = param_stats
        
        return optimal_settings
    
    def analyze_correlations(self, signal_type=None):
        """Analyze correlations between parameters and success"""
        correlations = {}
        
        signal_types = [signal_type] if signal_type else self.signal_types
        
        for st in signal_types:
            if st not in self.data or 'validation' not in self.data[st]:
                continue
            
            val_data = self.data[st]['validation']
            
            # Create success indicator
            if 'wasValidSignal' in val_data.columns:
                success_indicator = val_data['wasValidSignal'].astype(float)
            elif 'signalAccuracy15min' in val_data.columns:
                success_indicator = val_data['signalAccuracy15min'].astype(float)
            else:
                continue
            
            # Calculate correlations with numeric columns
            numeric_cols = val_data.select_dtypes(include=[np.number]).columns
            correlation_results = {}
            
            for col in numeric_cols:
                if col != 'wasValidSignal' and not col.startswith('signalAccuracy'):
                    corr_value = val_data[col].corr(success_indicator)
                    if not pd.isna(corr_value):
                        correlation_results[col] = corr_value
            
            # Sort by absolute correlation
            sorted_corr = dict(sorted(correlation_results.items(), 
                                    key=lambda x: abs(x[1]), 
                                    reverse=True))
            
            correlations[st] = sorted_corr
        
        return correlations
    
    def generate_report(self):
        """Generate comprehensive analysis report"""
        print("\n" + "="*60)
        print("📊 SIGNAL VALIDATION ANALYSIS REPORT")
        print("="*60)
        
        # Load data
        self.load_all_data()
        
        # Overall metrics
        print("\n🎯 PERFORMANCE METRICS")
        print("-"*40)
        metrics = self.calculate_metrics()
        
        for signal_type, signal_metrics in metrics.items():
            print(f"\n{signal_type.upper()}:")
            for key, value in signal_metrics.items():
                if isinstance(value, float):
                    print(f"  {key:30s}: {value:8.2f}")
                else:
                    print(f"  {key:30s}: {value:8d}")
        
        # Optimal parameters
        print("\n⚙️  OPTIMAL PARAMETER SETTINGS")
        print("-"*40)
        optimal = self.find_optimal_parameters()
        
        for signal_type, params in optimal.items():
            print(f"\n{signal_type.upper()}:")
            for param_name, param_stats in params.items():
                if 'recommended_value' in param_stats:
                    current = param_stats.get('current_mean', 0)
                    recommended = param_stats['recommended_value']
                    delta_pct = ((recommended - current) / current * 100) if current != 0 else 0
                    
                    print(f"\n  {param_name}:")
                    print(f"    Current Average: {current:.4f}")
                    print(f"    Recommended:     {recommended:.4f}")
                    print(f"    Change:          {delta_pct:+.1f}%")
                    
                    if 'is_significant' in param_stats:
                        if param_stats['is_significant']:
                            print(f"    Statistical Significance: ✅ (p={param_stats['p_value']:.4f})")
                        else:
                            print(f"    Statistical Significance: ❌ (p={param_stats['p_value']:.4f})")
        
        # Correlations
        print("\n📈 PARAMETER CORRELATIONS WITH SUCCESS")
        print("-"*40)
        correlations = self.analyze_correlations()
        
        for signal_type, corr_dict in correlations.items():
            print(f"\n{signal_type.upper()} - Top 5 Correlations:")
            for i, (param, corr) in enumerate(list(corr_dict.items())[:5]):
                direction = "↑" if corr > 0 else "↓"
                print(f"  {i+1}. {param:30s}: {corr:+.3f} {direction}")
        
        # Save detailed results to JSON
        self.save_results(metrics, optimal, correlations)
        
        print("\n" + "="*60)
        print("✅ Analysis complete! Results saved to 'signal_analysis_results.json'")
        print("="*60)
    
    def save_results(self, metrics, optimal, correlations):
        """Save analysis results to JSON file"""
        results = {
            'timestamp': datetime.now().isoformat(),
            'metrics': metrics,
            'optimal_parameters': optimal,
            'correlations': correlations
        }
        
        # Convert numpy types to native Python types for JSON serialization
        def convert_types(obj):
            if isinstance(obj, np.integer):
                return int(obj)
            elif isinstance(obj, np.floating):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            elif isinstance(obj, dict):
                return {k: convert_types(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_types(item) for item in obj]
            return obj
        
        results = convert_types(results)
        
        with open('signal_analysis_results.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        # Also save a CSV with recommended settings
        recommendations = []
        for signal_type, params in optimal.items():
            for param_name, param_stats in params.items():
                if 'recommended_value' in param_stats:
                    recommendations.append({
                        'signal_type': signal_type,
                        'parameter': param_name,
                        'current_mean': param_stats.get('current_mean', 0),
                        'recommended_value': param_stats['recommended_value'],
                        'change_percent': ((param_stats['recommended_value'] - param_stats.get('current_mean', 0)) 
                                         / param_stats.get('current_mean', 1) * 100)
                    })
        
        if recommendations:
            pd.DataFrame(recommendations).to_csv('recommended_settings.csv', index=False)
            print("\n📋 Recommended settings also saved to 'recommended_settings.csv'")


def main():
    # Path to your signal validation logs
    log_directory = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation"
    
    # Create analyzer and run analysis
    analyzer = SignalAnalyzer(log_directory)
    analyzer.generate_report()
    
    # Additional analysis: Find the best performing parameter combinations
    print("\n🏆 BEST PERFORMING PARAMETER COMBINATIONS")
    print("-"*40)
    
    for signal_type in analyzer.signal_types:
        if signal_type not in analyzer.data or 'successful' not in analyzer.data[signal_type]:
            continue
        
        successful = analyzer.data[signal_type]['successful']
        if 'confidence' in successful.columns and len(successful) > 0:
            # Find top 3 configurations by confidence
            top_configs = successful.nlargest(3, 'confidence')
            
            print(f"\n{signal_type.upper()} - Top 3 Configurations:")
            for idx, config in top_configs.iterrows():
                print(f"\n  Configuration #{idx+1} (Confidence: {config['confidence']:.4f}):")
                for param in ['minAggVolume', 'priceEfficiencyThreshold', 'finalConfidenceRequired']:
                    if param in config:
                        print(f"    {param}: {config[param]:.4f}")


if __name__ == "__main__":
    main()

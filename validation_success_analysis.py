#!/usr/bin/env python3
"""
Focused Signal Validation Success Analysis
Specifically analyzes the validation logs to identify patterns 
that lead to 0.7%+ movements for detector optimization.
"""

import pandas as pd
import numpy as np
import json
from pathlib import Path
from typing import Dict, List, Tuple, Any
from collections import defaultdict
import scipy.stats as stats
from datetime import datetime

class ValidationSuccessAnalyzer:
    def __init__(self, log_dir: str):
        self.log_dir = Path(log_dir)
        self.validation_df = pd.DataFrame()
        
    def load_and_prepare_validation_data(self):
        """Load validation data and calculate movement percentages"""
        print("Loading validation data for success analysis...")
        
        validation_files = [
            "signal_validation_2025-07-27.csv",
            "signal_validation_2025-07-28.csv"
        ]
        
        validation_data = []
        for filename in validation_files:
            file_path = self.log_dir / filename
            if file_path.exists():
                try:
                    df = pd.read_csv(file_path)
                    print(f"Loaded {len(df)} validation records from {filename}")
                    validation_data.append(df)
                except Exception as e:
                    print(f"Error loading {file_path}: {e}")
        
        if validation_data:
            self.validation_df = pd.concat(validation_data, ignore_index=True)
            print(f"Total validation records: {len(self.validation_df)}")
            
            # Convert key columns to numeric
            numeric_cols = ['timestamp', 'confidence', 'price', 'tradeQuantity', 'bestBid', 
                          'bestAsk', 'spread', 'totalAggressiveVolume', 'totalPassiveVolume',
                          'aggressiveBuyVolume', 'aggressiveSellVolume', 'passiveBidVolume',
                          'passiveAskVolume', 'volumeImbalance', 'institutionalVolumeRatio',
                          'activeZones', 'zoneTotalVolume', 'priceEfficiency', 'absorptionRatio',
                          'exhaustionRatio', 'depletionRatio', 'signalStrength', 'confluenceScore',
                          'institutionalFootprint']
            
            for col in numeric_cols:
                if col in self.validation_df.columns:
                    self.validation_df[col] = pd.to_numeric(self.validation_df[col], errors='coerce')
                    
            # Calculate movement percentages
            self._calculate_movements()
        else:
            print("No validation data loaded")
    
    def _calculate_movements(self):
        """Calculate percentage movements for all timeframes"""
        print("Calculating price movements...")
        
        timeframes = ['5min', '15min', '1hr']
        movement_columns = []
        
        for timeframe in timeframes:
            price_col = f'priceAt{timeframe}'
            movement_col = f'movement_pct_{timeframe}'
            max_movement_col = f'maxMovement{timeframe}'
            
            if price_col in self.validation_df.columns:
                # Convert price columns to numeric
                self.validation_df[price_col] = pd.to_numeric(self.validation_df[price_col], errors='coerce')
                
                # Calculate percentage movement from initial price
                initial_price = self.validation_df['price']
                final_price = self.validation_df[price_col]
                
                # Calculate both absolute and directional movements
                valid_mask = (~pd.isna(initial_price)) & (~pd.isna(final_price)) & (initial_price != 0)
                
                # Absolute percentage movement
                abs_movement = np.abs((final_price - initial_price) / initial_price * 100)
                self.validation_df[movement_col] = abs_movement
                
                # Directional movement
                directional_movement = (final_price - initial_price) / initial_price * 100
                self.validation_df[f'directional_movement_{timeframe}'] = directional_movement
                
                movement_columns.append(movement_col)
                
                # Also use maxMovement data if available
                if max_movement_col in self.validation_df.columns:
                    self.validation_df[max_movement_col] = pd.to_numeric(self.validation_df[max_movement_col], errors='coerce')
        
        # Mark successful signals (≥0.7%)
        for col in movement_columns:
            if col in self.validation_df.columns:
                success_col = f'is_successful_{col.split("_")[-1]}'
                self.validation_df[success_col] = (self.validation_df[col] >= 0.7).astype(int)
        
        print(f"Movement calculation complete. Columns added: {movement_columns}")
    
    def analyze_success_patterns(self) -> Dict[str, Any]:
        """Analyze patterns in successful vs unsuccessful signals"""
        print("\n=== SUCCESS PATTERN ANALYSIS ===")
        
        results = {}
        
        # Overall success rates
        timeframes = ['5min', '15min', '1hr']
        success_summary = {}
        
        for timeframe in timeframes:
            movement_col = f'movement_pct_{timeframe}'
            success_col = f'is_successful_{timeframe}'
            
            if movement_col in self.validation_df.columns:
                # Remove NaN values
                valid_data = self.validation_df.dropna(subset=[movement_col])
                
                if len(valid_data) > 0:
                    successful_signals = valid_data[valid_data[movement_col] >= 0.7]
                    total_signals = len(valid_data)
                    success_count = len(successful_signals)
                    success_rate = (success_count / total_signals) * 100 if total_signals > 0 else 0
                    
                    # Movement statistics
                    movements = valid_data[movement_col]
                    
                    success_summary[timeframe] = {
                        'total_signals': total_signals,
                        'successful_signals': success_count,
                        'success_rate_percentage': success_rate,
                        'average_movement': float(movements.mean()),
                        'median_movement': float(movements.median()),
                        'max_movement': float(movements.max()),
                        'percentile_75': float(movements.quantile(0.75)),
                        'percentile_90': float(movements.quantile(0.90)),
                        'percentile_95': float(movements.quantile(0.95)),
                        'percentile_99': float(movements.quantile(0.99)),
                        'successful_signals_stats': {
                            'average_movement': float(successful_signals[movement_col].mean()) if len(successful_signals) > 0 else 0,
                            'median_movement': float(successful_signals[movement_col].median()) if len(successful_signals) > 0 else 0,
                            'min_movement': float(successful_signals[movement_col].min()) if len(successful_signals) > 0 else 0,
                            'max_movement': float(successful_signals[movement_col].max()) if len(successful_signals) > 0 else 0
                        }
                    }
                    
                    print(f"{timeframe} Success Metrics:")
                    print(f"  Total signals: {total_signals:,}")
                    print(f"  Successful (≥0.7%): {success_count:,} ({success_rate:.1f}%)")
                    print(f"  Average movement: {success_summary[timeframe]['average_movement']:.3f}%")
                    print(f"  95th percentile movement: {success_summary[timeframe]['percentile_95']:.3f}%")
                    print(f"  Successful signals avg: {success_summary[timeframe]['successful_signals_stats']['average_movement']:.3f}%")
        
        results['success_summary'] = success_summary
        return results
    
    def analyze_detector_success_patterns(self) -> Dict[str, Any]:
        """Analyze success patterns by detector type"""
        print("\n=== DETECTOR SUCCESS PATTERN ANALYSIS ===")
        
        results = {}
        
        for detector_type in self.validation_df['detectorType'].unique():
            if pd.isna(detector_type):
                continue
                
            detector_data = self.validation_df[self.validation_df['detectorType'] == detector_type]
            detector_results = {'total_signals': len(detector_data)}
            
            print(f"\n{detector_type.upper()} DETECTOR ANALYSIS:")
            print(f"  Total signals: {len(detector_data):,}")
            
            # Analyze success by timeframe
            for timeframe in ['5min', '15min', '1hr']:
                movement_col = f'movement_pct_{timeframe}'
                
                if movement_col in detector_data.columns:
                    valid_movements = detector_data.dropna(subset=[movement_col])
                    
                    if len(valid_movements) > 0:
                        successful = valid_movements[valid_movements[movement_col] >= 0.7]
                        success_rate = (len(successful) / len(valid_movements)) * 100
                        
                        timeframe_stats = {
                            'total_with_data': len(valid_movements),
                            'successful_count': len(successful),
                            'success_rate': success_rate,
                            'average_movement': float(valid_movements[movement_col].mean()),
                            'successful_avg_movement': float(successful[movement_col].mean()) if len(successful) > 0 else 0
                        }
                        
                        detector_results[f'{timeframe}_stats'] = timeframe_stats
                        
                        print(f"    {timeframe}: {success_rate:.1f}% success ({len(successful)}/{len(valid_movements)})")
                        print(f"      Avg movement: {timeframe_stats['average_movement']:.3f}%")
                        if len(successful) > 0:
                            print(f"      Successful avg: {timeframe_stats['successful_avg_movement']:.3f}%")
            
            results[detector_type] = detector_results
        
        return results
    
    def analyze_parameter_success_correlation(self) -> Dict[str, Any]:
        """Analyze correlation between signal parameters and success"""
        print("\n=== PARAMETER SUCCESS CORRELATION ANALYSIS ===")
        
        results = {}
        
        # Key parameters to analyze
        key_parameters = [
            'confidence', 'totalAggressiveVolume', 'totalPassiveVolume', 
            'volumeImbalance', 'institutionalVolumeRatio', 'priceEfficiency',
            'absorptionRatio', 'signalStrength', 'confluenceScore',
            'institutionalFootprint', 'activeZones', 'zoneTotalVolume'
        ]
        
        # Analyze correlation with 5min success (most relevant timeframe)
        movement_col = 'movement_pct_5min'
        success_col = f'is_successful_5min'
        
        if movement_col in self.validation_df.columns:
            # Create success indicator
            valid_data = self.validation_df.dropna(subset=[movement_col])
            valid_data = valid_data.copy()
            valid_data[success_col] = (valid_data[movement_col] >= 0.7).astype(int)
            
            # Analyze each parameter
            correlations = {}
            successful_vs_failed_stats = {}
            
            for param in key_parameters:
                if param in valid_data.columns:
                    param_data = valid_data.dropna(subset=[param, success_col])
                    
                    if len(param_data) > 10:  # Minimum data requirement
                        # Calculate correlation
                        correlation = param_data[param].corr(param_data[success_col])
                        correlations[param] = float(correlation) if not pd.isna(correlation) else 0
                        
                        # Compare successful vs failed signals
                        successful_data = param_data[param_data[success_col] == 1][param]
                        failed_data = param_data[param_data[success_col] == 0][param]
                        
                        if len(successful_data) > 0 and len(failed_data) > 0:
                            # Statistical comparison
                            t_stat, p_value = stats.ttest_ind(successful_data, failed_data)
                            
                            successful_vs_failed_stats[param] = {
                                'successful_mean': float(successful_data.mean()),
                                'successful_median': float(successful_data.median()),
                                'successful_std': float(successful_data.std()),
                                'failed_mean': float(failed_data.mean()),
                                'failed_median': float(failed_data.median()),
                                'failed_std': float(failed_data.std()),
                                'correlation': correlations[param],
                                't_statistic': float(t_stat),
                                'p_value': float(p_value),
                                'statistically_significant': p_value < 0.05,
                                'successful_count': len(successful_data),
                                'failed_count': len(failed_data)
                            }
                            
                            # Print significant findings
                            if p_value < 0.05:
                                diff_direction = "higher" if successful_data.mean() > failed_data.mean() else "lower"
                                print(f"  {param}: Successful signals have {diff_direction} values")
                                print(f"    Successful mean: {successful_data.mean():.4f}")
                                print(f"    Failed mean: {failed_data.mean():.4f}")
                                print(f"    p-value: {p_value:.6f} (significant)")
            
            results = {
                'correlations': correlations,
                'parameter_comparisons': successful_vs_failed_stats,
                'analysis_summary': {
                    'total_signals_analyzed': len(valid_data),
                    'successful_signals': len(valid_data[valid_data[success_col] == 1]),
                    'failed_signals': len(valid_data[valid_data[success_col] == 0])
                }
            }
            
            # Print top correlations
            print(f"\nTOP PARAMETER CORRELATIONS WITH SUCCESS:")
            sorted_correlations = sorted(correlations.items(), key=lambda x: abs(x[1]), reverse=True)
            for param, corr in sorted_correlations[:10]:
                print(f"  {param}: {corr:.4f}")
        
        return results
    
    def identify_optimization_opportunities(self) -> Dict[str, Any]:
        """Identify specific optimization opportunities based on successful signals"""
        print("\n=== OPTIMIZATION OPPORTUNITIES IDENTIFICATION ===")
        
        results = {}
        
        # Analyze successful signals to find optimal parameter ranges
        movement_col = 'movement_pct_5min'  # Focus on 5min as most relevant
        
        if movement_col in self.validation_df.columns:
            valid_data = self.validation_df.dropna(subset=[movement_col])
            successful_signals = valid_data[valid_data[movement_col] >= 0.7]
            
            if len(successful_signals) > 0:
                print(f"Analyzing {len(successful_signals)} successful signals...")
                
                # Key parameters for optimization
                optimization_params = [
                    'confidence', 'totalAggressiveVolume', 'volumeImbalance',
                    'institutionalVolumeRatio', 'priceEfficiency', 'signalStrength'
                ]
                
                param_ranges = {}
                
                for param in optimization_params:
                    if param in successful_signals.columns:
                        param_data = successful_signals[param].dropna()
                        
                        if len(param_data) > 0:
                            param_ranges[param] = {
                                'count': len(param_data),
                                'min': float(param_data.min()),
                                'max': float(param_data.max()),
                                'mean': float(param_data.mean()),
                                'median': float(param_data.median()),
                                'std': float(param_data.std()),
                                'percentiles': {
                                    '10th': float(param_data.quantile(0.10)),
                                    '25th': float(param_data.quantile(0.25)),
                                    '75th': float(param_data.quantile(0.75)),
                                    '90th': float(param_data.quantile(0.90))
                                },
                                'recommended_min_threshold': float(param_data.quantile(0.25)),  # 25th percentile
                                'recommended_optimal_threshold': float(param_data.quantile(0.50)),  # Median
                                'recommended_max_threshold': float(param_data.quantile(0.75))   # 75th percentile
                            }
                            
                            print(f"  {param}:")
                            print(f"    Successful range: {param_ranges[param]['min']:.4f} - {param_ranges[param]['max']:.4f}")
                            print(f"    Recommended thresholds: {param_ranges[param]['recommended_min_threshold']:.4f} (min) - {param_ranges[param]['recommended_optimal_threshold']:.4f} (optimal)")
                
                results['successful_parameter_ranges'] = param_ranges
                
                # Detector-specific optimization
                detector_optimizations = {}
                for detector_type in successful_signals['detectorType'].unique():
                    if pd.isna(detector_type):
                        continue
                        
                    detector_successful = successful_signals[successful_signals['detectorType'] == detector_type]
                    
                    if len(detector_successful) > 5:  # Minimum requirement
                        detector_params = {}
                        
                        for param in optimization_params:
                            if param in detector_successful.columns:
                                param_data = detector_successful[param].dropna()
                                
                                if len(param_data) > 0:
                                    detector_params[param] = {
                                        'count': len(param_data),
                                        'mean': float(param_data.mean()),
                                        'median': float(param_data.median()),
                                        'optimal_threshold': float(param_data.quantile(0.50))
                                    }
                        
                        if detector_params:
                            detector_optimizations[detector_type] = detector_params
                            
                            print(f"\n  {detector_type.upper()} specific optimizations:")
                            for param, stats in detector_params.items():
                                print(f"    {param}: optimal threshold {stats['optimal_threshold']:.4f} (from {stats['count']} successful signals)")
                
                results['detector_specific_optimizations'] = detector_optimizations
        
        return results
    
    def generate_implementation_recommendations(self) -> Dict[str, Any]:
        """Generate specific implementation recommendations"""
        print("\n=== IMPLEMENTATION RECOMMENDATIONS ===")
        
        # Collect all analysis results
        success_patterns = self.analyze_success_patterns()
        detector_patterns = self.analyze_detector_success_patterns()
        parameter_correlations = self.analyze_parameter_success_correlation()
        optimization_opportunities = self.identify_optimization_opportunities()
        
        recommendations = {
            'analysis_metadata': {
                'generated_at': datetime.now().isoformat(),
                'total_validation_records': len(self.validation_df),
                'focus': '0.7%+ movement prediction optimization'
            },
            'success_analysis': success_patterns,
            'detector_performance': detector_patterns,
            'parameter_correlations': parameter_correlations,
            'optimization_opportunities': optimization_opportunities,
            'implementation_recommendations': self._generate_specific_recommendations(
                success_patterns, detector_patterns, parameter_correlations, optimization_opportunities
            )
        }
        
        return recommendations
    
    def _generate_specific_recommendations(self, success_patterns, detector_patterns, 
                                         parameter_correlations, optimization_opportunities) -> Dict[str, Any]:
        """Generate specific implementation recommendations based on analysis"""
        
        recommendations = {
            'priority_actions': [],
            'parameter_adjustments': {},
            'detector_specific_changes': {},
            'monitoring_requirements': []
        }
        
        # Priority actions based on success rates
        if 'success_summary' in success_patterns:
            for timeframe, stats in success_patterns['success_summary'].items():
                if stats['success_rate_percentage'] < 10:  # Low success rate
                    recommendations['priority_actions'].append({
                        'action': f'Optimize {timeframe} detection parameters',
                        'reason': f'Only {stats["success_rate_percentage"]:.1f}% success rate',
                        'urgency': 'high'
                    })
        
        # Parameter adjustments based on correlations
        if 'correlations' in parameter_correlations:
            for param, correlation in parameter_correlations['correlations'].items():
                if abs(correlation) > 0.1:  # Meaningful correlation
                    if param in parameter_correlations['parameter_comparisons']:
                        stats = parameter_correlations['parameter_comparisons'][param]
                        if stats['statistically_significant']:
                            if correlation > 0:
                                rec_value = stats['successful_mean']
                                direction = 'increase'
                            else:
                                rec_value = stats['successful_mean']
                                direction = 'optimize around'
                            
                            recommendations['parameter_adjustments'][param] = {
                                'current_correlation': correlation,
                                'recommended_action': direction,
                                'target_value': rec_value,
                                'confidence': 'high' if stats['p_value'] < 0.01 else 'medium'
                            }
        
        # Detector-specific recommendations
        for detector_type, stats in detector_patterns.items():
            detector_recs = []
            
            # Check 5min success rate (most important)
            if '5min_stats' in stats:
                success_rate = stats['5min_stats']['success_rate']
                if success_rate < 5:  # Very low success rate
                    detector_recs.append({
                        'issue': 'Low 5min success rate',
                        'current_rate': success_rate,
                        'recommendation': 'Review threshold parameters for more sensitive detection',
                        'priority': 'high'
                    })
                elif success_rate > 20:  # High success rate
                    detector_recs.append({
                        'issue': 'Good performance to maintain',
                        'current_rate': success_rate,
                        'recommendation': 'Monitor current parameters, consider slight optimization',
                        'priority': 'low'
                    })
            
            if detector_recs:
                recommendations['detector_specific_changes'][detector_type] = detector_recs
        
        # Monitoring requirements
        recommendations['monitoring_requirements'] = [
            'Track 0.7%+ movement success rates daily',
            'Monitor parameter correlation changes weekly',
            'Alert on success rate drops below 5%',
            'Review optimization effectiveness monthly'
        ]
        
        return recommendations

def main():
    """Main analysis execution"""
    log_directory = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation"
    output_file = "/Users/marcschot/Projects/OrderFlow Trading/validation_success_analysis_report.json"
    
    print("VALIDATION SUCCESS ANALYSIS FOR 0.7%+ MOVEMENT PREDICTION")
    print("="*70)
    print(f"Analyzing validation logs from: {log_directory}")
    
    # Initialize analyzer
    analyzer = ValidationSuccessAnalyzer(log_directory)
    
    # Load and prepare data
    analyzer.load_and_prepare_validation_data()
    
    # Generate comprehensive recommendations
    recommendations = analyzer.generate_implementation_recommendations()
    
    # Save report
    with open(output_file, 'w') as f:
        json.dump(recommendations, f, indent=2, default=str)
    
    print(f"\nValidation success analysis report saved to: {output_file}")
    
    # Print executive summary
    print("\n" + "="*70)
    print("EXECUTIVE SUMMARY - VALIDATION SUCCESS ANALYSIS")
    print("="*70)
    
    if 'success_analysis' in recommendations and 'success_summary' in recommendations['success_analysis']:
        success_data = recommendations['success_analysis']['success_summary']
        
        print("OVERALL SUCCESS RATES FOR 0.7%+ MOVEMENTS:")
        for timeframe, stats in success_data.items():
            print(f"  {timeframe}: {stats['success_rate_percentage']:.1f}% ({stats['successful_signals']:,}/{stats['total_signals']:,})")
            print(f"    Average movement: {stats['average_movement']:.3f}%")
            if stats['successful_signals'] > 0:
                print(f"    Successful signals average: {stats['successful_signals_stats']['average_movement']:.3f}%")
    
    if 'implementation_recommendations' in recommendations:
        impl_recs = recommendations['implementation_recommendations']
        
        if 'priority_actions' in impl_recs and impl_recs['priority_actions']:
            print("\nPRIORITY ACTIONS:")
            for action in impl_recs['priority_actions']:
                print(f"  - {action['action']} ({action['urgency']} priority)")
                print(f"    Reason: {action['reason']}")
        
        if 'parameter_adjustments' in impl_recs and impl_recs['parameter_adjustments']:
            print("\nKEY PARAMETER ADJUSTMENTS:")
            for param, rec in list(impl_recs['parameter_adjustments'].items())[:5]:
                print(f"  - {param}: {rec['recommended_action']} to {rec['target_value']:.4f}")
                print(f"    Confidence: {rec['confidence']}")
    
    print("="*70)

if __name__ == "__main__":
    main()
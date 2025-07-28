#!/usr/bin/env python3
"""
Signal Validation Log Analysis for Detector Optimization
Systematically parses signal validation logs to extract comprehensive data
for optimizing detector thresholds to predict 0.7%+ movements.
"""

import pandas as pd
import numpy as np
import json
from pathlib import Path
from typing import Dict, List, Tuple, Any
from collections import defaultdict
import scipy.stats as stats
from datetime import datetime, timedelta

class DetectorOptimizationAnalyzer:
    def __init__(self, log_dir: str):
        self.log_dir = Path(log_dir)
        self.rejection_data = []
        self.validation_data = []
        self.analysis_results = {}
        
    def load_rejection_data(self):
        """Load and parse rejection log files"""
        print("Loading rejection data...")
        
        # Define rejection log structure (no headers in 2025-07-27, headers in 2025-07-28)
        rejection_columns = [
            'timestamp', 'detectorType', 'rejectionReason', 'price', 'thresholdType',
            'thresholdValue', 'actualValue', 'aggressiveVolume', 'passiveVolume',
            'priceEfficiency', 'confidence', 'subsequentMovement5min',
            'subsequentMovement15min', 'subsequentMovement1hr', 'wasValidSignal'
        ]
        
        # Load 2025-07-27 (no headers)
        file_27 = self.log_dir / "signal_rejections_2025-07-27.csv"
        if file_27.exists():
            try:
                df_27 = pd.read_csv(file_27, names=rejection_columns, dtype=str)
                print(f"Loaded {len(df_27)} rejection records from 2025-07-27")
                self.rejection_data.append(df_27)
            except Exception as e:
                print(f"Error loading {file_27}: {e}")
        
        # Load 2025-07-28 (has headers)
        file_28 = self.log_dir / "signal_rejections_2025-07-28.csv"
        if file_28.exists():
            try:
                df_28 = pd.read_csv(file_28, dtype=str)
                print(f"Loaded {len(df_28)} rejection records from 2025-07-28")
                self.rejection_data.append(df_28)
            except Exception as e:
                print(f"Error loading {file_28}: {e}")
        
        # Combine all rejection data
        if self.rejection_data:
            self.rejection_df = pd.concat(self.rejection_data, ignore_index=True)
            print(f"Total rejection records: {len(self.rejection_df)}")
            
            # Convert numeric columns
            numeric_cols = ['timestamp', 'price', 'thresholdValue', 'actualValue', 
                          'aggressiveVolume', 'passiveVolume', 'priceEfficiency', 
                          'confidence', 'subsequentMovement5min', 'subsequentMovement15min', 
                          'subsequentMovement1hr']
            
            for col in numeric_cols:
                if col in self.rejection_df.columns:
                    self.rejection_df[col] = pd.to_numeric(self.rejection_df[col], errors='coerce')
        else:
            print("No rejection data loaded")
            self.rejection_df = pd.DataFrame()
    
    def load_validation_data(self):
        """Load and parse validation log files"""
        print("Loading validation data...")
        
        validation_files = [
            "signal_validation_2025-07-27.csv",
            "signal_validation_2025-07-28.csv"
        ]
        
        for filename in validation_files:
            file_path = self.log_dir / filename
            if file_path.exists():
                try:
                    df = pd.read_csv(file_path, dtype=str)
                    print(f"Loaded {len(df)} validation records from {filename}")
                    self.validation_data.append(df)
                except Exception as e:
                    print(f"Error loading {file_path}: {e}")
        
        # Combine all validation data
        if self.validation_data:
            self.validation_df = pd.concat(self.validation_data, ignore_index=True)
            print(f"Total validation records: {len(self.validation_df)}")
            
            # Convert numeric columns
            numeric_cols = ['timestamp', 'confidence', 'price', 'tradeQuantity', 'bestBid', 
                          'bestAsk', 'spread', 'totalAggressiveVolume', 'totalPassiveVolume',
                          'aggressiveBuyVolume', 'aggressiveSellVolume', 'passiveBidVolume',
                          'passiveAskVolume', 'volumeImbalance', 'institutionalVolumeRatio',
                          'activeZones', 'zoneTotalVolume', 'priceEfficiency', 'absorptionRatio',
                          'exhaustionRatio', 'depletionRatio', 'signalStrength', 'confluenceScore',
                          'institutionalFootprint', 'priceAt5min', 'priceAt15min', 'priceAt1hr',
                          'maxMovement5min', 'maxMovement15min', 'maxMovement1hr',
                          'signalAccuracy5min', 'signalAccuracy15min', 'signalAccuracy1hr']
            
            for col in numeric_cols:
                if col in self.validation_df.columns:
                    self.validation_df[col] = pd.to_numeric(self.validation_df[col], errors='coerce')
        else:
            print("No validation data loaded")
            self.validation_df = pd.DataFrame()
    
    def analyze_rejection_categories(self) -> Dict[str, Any]:
        """Analyze rejection categories and reasons by detector type"""
        print("\n=== REJECTION CATEGORIES ANALYSIS ===")
        
        if self.rejection_df.empty:
            return {}
            
        results = {}
        
        # Overall rejection statistics
        total_rejections = len(self.rejection_df)
        results['total_rejections'] = total_rejections
        
        # Rejections by detector type
        detector_rejections = self.rejection_df['detectorType'].value_counts()
        results['rejections_by_detector'] = detector_rejections.to_dict()
        
        print(f"Total rejections: {total_rejections:,}")
        print("\nRejections by detector type:")
        for detector, count in detector_rejections.items():
            percentage = (count / total_rejections) * 100
            print(f"  {detector}: {count:,} ({percentage:.1f}%)")
        
        # Rejections by reason
        rejection_reasons = self.rejection_df['rejectionReason'].value_counts()
        results['rejections_by_reason'] = rejection_reasons.to_dict()
        
        print("\nTop rejection reasons:")
        for reason, count in rejection_reasons.head(10).items():
            percentage = (count / total_rejections) * 100
            print(f"  {reason}: {count:,} ({percentage:.1f}%)")
        
        # Detailed analysis by detector and reason
        detector_reason_analysis = {}
        for detector in detector_rejections.index:
            detector_data = self.rejection_df[self.rejection_df['detectorType'] == detector]
            reason_counts = detector_data['rejectionReason'].value_counts()
            detector_reason_analysis[detector] = reason_counts.to_dict()
            
            print(f"\n{detector.upper()} detector rejections:")
            for reason, count in reason_counts.head(5).items():
                detector_total = len(detector_data)
                percentage = (count / detector_total) * 100
                print(f"  {reason}: {count:,} ({percentage:.1f}%)")
        
        results['detector_reason_breakdown'] = detector_reason_analysis
        return results
    
    def analyze_threshold_distribution(self) -> Dict[str, Any]:
        """Analyze actual vs threshold values for parameter optimization"""
        print("\n=== THRESHOLD DISTRIBUTION ANALYSIS ===")
        
        if self.rejection_df.empty:
            return {}
        
        results = {}
        
        # Group by detector type and threshold type
        threshold_analysis = defaultdict(dict)
        
        for detector in self.rejection_df['detectorType'].unique():
            if pd.isna(detector):
                continue
                
            detector_data = self.rejection_df[self.rejection_df['detectorType'] == detector]
            
            print(f"\n{detector.upper()} THRESHOLD ANALYSIS:")
            
            for threshold_type in detector_data['thresholdType'].unique():
                if pd.isna(threshold_type):
                    continue
                    
                threshold_data = detector_data[detector_data['thresholdType'] == threshold_type]
                
                # Remove rows with missing values
                valid_data = threshold_data.dropna(subset=['thresholdValue', 'actualValue'])
                
                if len(valid_data) == 0:
                    continue
                
                threshold_values = valid_data['thresholdValue'].astype(float)
                actual_values = valid_data['actualValue'].astype(float)
                
                # Calculate statistics
                stats_dict = {
                    'count': len(valid_data),
                    'threshold_value': threshold_values.iloc[0] if len(threshold_values) > 0 else None,
                    'actual_mean': float(actual_values.mean()),
                    'actual_median': float(actual_values.median()),
                    'actual_std': float(actual_values.std()),
                    'actual_min': float(actual_values.min()),
                    'actual_max': float(actual_values.max()),
                    'actual_25th': float(actual_values.quantile(0.25)),
                    'actual_75th': float(actual_values.quantile(0.75)),
                    'actual_90th': float(actual_values.quantile(0.90)),
                    'actual_95th': float(actual_values.quantile(0.95)),
                    'actual_99th': float(actual_values.quantile(0.99))
                }
                
                # Calculate what percentage would pass with different thresholds
                current_threshold = threshold_values.iloc[0]
                stats_dict['pass_rate_90th'] = len(actual_values[actual_values >= stats_dict['actual_90th']]) / len(actual_values)
                stats_dict['pass_rate_95th'] = len(actual_values[actual_values >= stats_dict['actual_95th']]) / len(actual_values)
                stats_dict['pass_rate_99th'] = len(actual_values[actual_values >= stats_dict['actual_99th']]) / len(actual_values)
                
                threshold_analysis[detector][threshold_type] = stats_dict
                
                print(f"  {threshold_type} (threshold: {current_threshold}):")
                print(f"    Rejections: {stats_dict['count']:,}")
                print(f"    Actual values - Mean: {stats_dict['actual_mean']:.3f}, Median: {stats_dict['actual_median']:.3f}")
                print(f"    Percentiles - 90th: {stats_dict['actual_90th']:.3f}, 95th: {stats_dict['actual_95th']:.3f}, 99th: {stats_dict['actual_99th']:.3f}")
                print(f"    Suggested thresholds:")
                print(f"      Aggressive (90% pass): {stats_dict['actual_90th']:.3f}")
                print(f"      Balanced (95% pass): {stats_dict['actual_95th']:.3f}")
                print(f"      Conservative (99% pass): {stats_dict['actual_99th']:.3f}")
        
        results['threshold_analysis'] = dict(threshold_analysis)
        return results
    
    def analyze_volume_distribution(self) -> Dict[str, Any]:
        """Analyze volume distribution patterns in rejections"""
        print("\n=== VOLUME DISTRIBUTION ANALYSIS ===")
        
        if self.rejection_df.empty:
            return {}
        
        results = {}
        
        # Analyze aggressive and passive volume distributions
        volume_cols = ['aggressiveVolume', 'passiveVolume']
        
        for col in volume_cols:
            if col in self.rejection_df.columns:
                volume_data = pd.to_numeric(self.rejection_df[col], errors='coerce').dropna()
                
                if len(volume_data) > 0:
                    results[col] = {
                        'count': len(volume_data),
                        'mean': float(volume_data.mean()),
                        'median': float(volume_data.median()),
                        'std': float(volume_data.std()),
                        'min': float(volume_data.min()),
                        'max': float(volume_data.max()),
                        'percentiles': {
                            '25th': float(volume_data.quantile(0.25)),
                            '50th': float(volume_data.quantile(0.50)),
                            '75th': float(volume_data.quantile(0.75)),
                            '90th': float(volume_data.quantile(0.90)),
                            '95th': float(volume_data.quantile(0.95)),
                            '99th': float(volume_data.quantile(0.99))
                        }
                    }
                    
                    print(f"{col} distribution:")
                    print(f"  Count: {results[col]['count']:,}")
                    print(f"  Mean: {results[col]['mean']:.2f}")
                    print(f"  Median: {results[col]['median']:.2f}")
                    print(f"  90th percentile: {results[col]['percentiles']['90th']:.2f}")
                    print(f"  95th percentile: {results[col]['percentiles']['95th']:.2f}")
                    print(f"  99th percentile: {results[col]['percentiles']['99th']:.2f}")
        
        return results
    
    def analyze_temporal_patterns(self) -> Dict[str, Any]:
        """Analyze rejection patterns over time"""
        print("\n=== TEMPORAL PATTERNS ANALYSIS ===")
        
        if self.rejection_df.empty:
            return {}
        
        results = {}
        
        # Convert timestamp to datetime
        self.rejection_df['datetime'] = pd.to_datetime(self.rejection_df['timestamp'], unit='ms')
        self.rejection_df['hour'] = self.rejection_df['datetime'].dt.hour
        self.rejection_df['minute'] = self.rejection_df['datetime'].dt.minute
        
        # Analyze rejections by hour
        hourly_rejections = self.rejection_df.groupby('hour').size()
        results['hourly_distribution'] = hourly_rejections.to_dict()
        
        print("Rejections by hour of day:")
        for hour, count in hourly_rejections.head(10).items():
            print(f"  {hour:02d}:00 - {count:,} rejections")
        
        # Analyze rejection rate changes over time
        self.rejection_df['time_bucket'] = self.rejection_df['datetime'].dt.floor('1H')
        temporal_stats = self.rejection_df.groupby('time_bucket').agg({
            'detectorType': 'count',
            'rejectionReason': lambda x: x.value_counts().index[0] if len(x) > 0 else None
        }).rename(columns={'detectorType': 'rejection_count'})
        
        results['temporal_stats'] = {
            'avg_rejections_per_hour': float(temporal_stats['rejection_count'].mean()),
            'max_rejections_per_hour': int(temporal_stats['rejection_count'].max()),
            'min_rejections_per_hour': int(temporal_stats['rejection_count'].min())
        }
        
        print(f"Average rejections per hour: {results['temporal_stats']['avg_rejections_per_hour']:.0f}")
        print(f"Peak rejections per hour: {results['temporal_stats']['max_rejections_per_hour']:,}")
        
        return results
    
    def analyze_signal_success_metrics(self) -> Dict[str, Any]:
        """Analyze signals that achieved 0.7%+ movements"""
        print("\n=== SIGNAL SUCCESS METRICS ANALYSIS ===")
        
        if self.validation_df.empty:
            return {}
        
        results = {}
        
        # Calculate movement percentages from prices
        for timeframe in ['5min', '15min', '1hr']:
            price_col = f'priceAt{timeframe}'
            if price_col in self.validation_df.columns:
                # Calculate percentage movement
                initial_price = self.validation_df['price']
                final_price = self.validation_df[price_col]
                
                # Only calculate for rows with valid price data
                valid_mask = (~pd.isna(initial_price)) & (~pd.isna(final_price)) & (initial_price != 0)
                
                if valid_mask.sum() > 0:
                    movement_pct = ((final_price - initial_price) / initial_price * 100).abs()
                    self.validation_df[f'movement_pct_{timeframe}'] = movement_pct
                    
                    # Identify signals that achieved 0.7%+ movement
                    successful_signals = movement_pct >= 0.7
                    success_rate = successful_signals.sum() / len(movement_pct) * 100
                    
                    results[f'success_rate_{timeframe}'] = {
                        'total_signals': int(len(movement_pct)),
                        'successful_signals': int(successful_signals.sum()),
                        'success_rate_percentage': float(success_rate),
                        'movement_stats': {
                            'mean': float(movement_pct.mean()),
                            'median': float(movement_pct.median()),
                            'std': float(movement_pct.std()),
                            'percentiles': {
                                '75th': float(movement_pct.quantile(0.75)),
                                '90th': float(movement_pct.quantile(0.90)),
                                '95th': float(movement_pct.quantile(0.95)),
                                '99th': float(movement_pct.quantile(0.99))
                            }
                        }
                    }
                    
                    print(f"{timeframe} success metrics:")
                    print(f"  Total signals: {results[f'success_rate_{timeframe}']['total_signals']:,}")
                    print(f"  Successful (≥0.7%): {results[f'success_rate_{timeframe}']['successful_signals']:,}")
                    print(f"  Success rate: {success_rate:.1f}%")
                    print(f"  Average movement: {results[f'success_rate_{timeframe}']['movement_stats']['mean']:.2f}%")
                    print(f"  Median movement: {results[f'success_rate_{timeframe}']['movement_stats']['median']:.2f}%")
        
        return results
    
    def analyze_detector_performance(self) -> Dict[str, Any]:
        """Analyze success rates by detector type"""
        print("\n=== DETECTOR PERFORMANCE ANALYSIS ===")
        
        if self.validation_df.empty:
            return {}
        
        results = {}
        
        # Analyze by detector type
        for detector in self.validation_df['detectorType'].unique():
            if pd.isna(detector):
                continue
                
            detector_data = self.validation_df[self.validation_df['detectorType'] == detector]
            
            detector_results = {
                'total_signals': len(detector_data),
                'confidence_stats': {},
                'success_by_timeframe': {}
            }
            
            # Confidence statistics
            if 'confidence' in detector_data.columns:
                confidence_data = pd.to_numeric(detector_data['confidence'], errors='coerce').dropna()
                if len(confidence_data) > 0:
                    detector_results['confidence_stats'] = {
                        'mean': float(confidence_data.mean()),
                        'median': float(confidence_data.median()),
                        'std': float(confidence_data.std()),
                        'min': float(confidence_data.min()),
                        'max': float(confidence_data.max())
                    }
            
            # Success rates by timeframe
            for timeframe in ['5min', '15min', '1hr']:
                movement_col = f'movement_pct_{timeframe}'
                if movement_col in detector_data.columns:
                    movement_data = pd.to_numeric(detector_data[movement_col], errors='coerce').dropna()
                    if len(movement_data) > 0:
                        successful = movement_data >= 0.7
                        success_rate = successful.sum() / len(movement_data) * 100
                        
                        detector_results['success_by_timeframe'][timeframe] = {
                            'total': int(len(movement_data)),
                            'successful': int(successful.sum()),
                            'success_rate': float(success_rate)
                        }
            
            results[detector] = detector_results
            
            print(f"\n{detector.upper()} performance:")
            print(f"  Total signals: {detector_results['total_signals']:,}")
            if detector_results['confidence_stats']:
                print(f"  Avg confidence: {detector_results['confidence_stats']['mean']:.2f}")
            
            for timeframe, stats in detector_results['success_by_timeframe'].items():
                print(f"  {timeframe} success rate: {stats['success_rate']:.1f}% ({stats['successful']}/{stats['total']})")
        
        return results
    
    def calculate_optimal_thresholds(self) -> Dict[str, Any]:
        """Calculate optimal threshold recommendations based on statistical analysis"""
        print("\n=== OPTIMAL THRESHOLD RECOMMENDATIONS ===")
        
        results = {}
        
        if self.rejection_df.empty:
            return results
        
        # For each detector and threshold type, calculate optimal values
        for detector in self.rejection_df['detectorType'].unique():
            if pd.isna(detector):
                continue
                
            detector_data = self.rejection_df[self.rejection_df['detectorType'] == detector]
            detector_recommendations = {}
            
            for threshold_type in detector_data['thresholdType'].unique():
                if pd.isna(threshold_type):
                    continue
                    
                threshold_data = detector_data[detector_data['thresholdType'] == threshold_type]
                valid_data = threshold_data.dropna(subset=['actualValue'])
                
                if len(valid_data) == 0:
                    continue
                
                actual_values = pd.to_numeric(valid_data['actualValue'], errors='coerce').dropna()
                
                if len(actual_values) > 0:
                    # Calculate different threshold strategies
                    recommendations = {
                        'current_threshold': float(valid_data['thresholdValue'].iloc[0]),
                        'rejection_count': len(actual_values),
                        'strategies': {
                            'aggressive': {
                                'threshold': float(actual_values.quantile(0.80)),
                                'description': '80th percentile - captures more signals, higher false positives',
                                'expected_pass_rate': 0.20
                            },
                            'balanced': {
                                'threshold': float(actual_values.quantile(0.90)),
                                'description': '90th percentile - balanced approach',
                                'expected_pass_rate': 0.10
                            },
                            'conservative': {
                                'threshold': float(actual_values.quantile(0.95)),
                                'description': '95th percentile - fewer signals, higher quality',
                                'expected_pass_rate': 0.05
                            },
                            'very_conservative': {
                                'threshold': float(actual_values.quantile(0.99)),
                                'description': '99th percentile - minimal signals, highest quality',
                                'expected_pass_rate': 0.01
                            }
                        },
                        'statistical_insights': {
                            'mean': float(actual_values.mean()),
                            'median': float(actual_values.median()),
                            'std': float(actual_values.std()),
                            'coefficient_of_variation': float(actual_values.std() / actual_values.mean()) if actual_values.mean() != 0 else None
                        }
                    }
                    
                    detector_recommendations[threshold_type] = recommendations
                    
                    current = recommendations['current_threshold']
                    balanced = recommendations['strategies']['balanced']['threshold']
                    conservative = recommendations['strategies']['conservative']['threshold']
                    
                    print(f"\n{detector.upper()} - {threshold_type}:")
                    print(f"  Current threshold: {current}")
                    print(f"  Balanced recommendation: {balanced:.3f} (90th percentile)")
                    print(f"  Conservative recommendation: {conservative:.3f} (95th percentile)")
                    print(f"  Based on {len(actual_values):,} rejections")
            
            if detector_recommendations:
                results[detector] = detector_recommendations
        
        return results
    
    def generate_implementation_report(self) -> Dict[str, Any]:
        """Generate comprehensive implementation-ready optimization report"""
        print("\n=== GENERATING IMPLEMENTATION REPORT ===")
        
        # Collect all analysis results
        report = {
            'analysis_metadata': {
                'generated_at': datetime.now().isoformat(),
                'total_rejection_records': len(self.rejection_df) if not self.rejection_df.empty else 0,
                'total_validation_records': len(self.validation_df) if not self.validation_df.empty else 0,
                'analysis_period': {
                    'start': '2025-07-27',
                    'end': '2025-07-28'
                }
            },
            'rejection_analysis': self.analyze_rejection_categories(),
            'threshold_analysis': self.analyze_threshold_distribution(),
            'volume_analysis': self.analyze_volume_distribution(),
            'temporal_analysis': self.analyze_temporal_patterns(),
            'success_metrics': self.analyze_signal_success_metrics(),
            'detector_performance': self.analyze_detector_performance(),
            'optimization_recommendations': self.calculate_optimal_thresholds()
        }
        
        return report
    
    def save_analysis_report(self, report: Dict[str, Any], output_file: str):
        """Save comprehensive analysis report to JSON file"""
        output_path = Path(output_file)
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        print(f"\nAnalysis report saved to: {output_path}")
        
    def print_executive_summary(self, report: Dict[str, Any]):
        """Print executive summary of key findings"""
        print("\n" + "="*80)
        print("EXECUTIVE SUMMARY - DETECTOR OPTIMIZATION ANALYSIS")
        print("="*80)
        
        meta = report['analysis_metadata']
        print(f"Analysis Period: {meta['analysis_period']['start']} to {meta['analysis_period']['end']}")
        print(f"Total Records Analyzed: {meta['total_rejection_records']:,} rejections, {meta['total_validation_records']:,} validations")
        
        # Key rejection insights
        if 'rejection_analysis' in report and report['rejection_analysis']:
            rejection_data = report['rejection_analysis']
            print(f"\nKEY REJECTION INSIGHTS:")
            print(f"- Total rejections: {rejection_data['total_rejections']:,}")
            
            if 'rejections_by_detector' in rejection_data:
                print("- Top rejecting detectors:")
                for detector, count in list(rejection_data['rejections_by_detector'].items())[:3]:
                    percentage = (count / rejection_data['total_rejections']) * 100
                    print(f"  • {detector}: {count:,} ({percentage:.1f}%)")
        
        # Key success insights
        if 'success_metrics' in report and report['success_metrics']:
            success_data = report['success_metrics']
            print(f"\nSIGNAL SUCCESS RATES:")
            for timeframe in ['5min', '15min', '1hr']:
                key = f'success_rate_{timeframe}'
                if key in success_data:
                    rate = success_data[key]['success_rate_percentage']
                    total = success_data[key]['total_signals']
                    successful = success_data[key]['successful_signals']
                    print(f"- {timeframe}: {rate:.1f}% ({successful:,}/{total:,} signals achieved ≥0.7%)")
        
        # Key optimization recommendations
        if 'optimization_recommendations' in report and report['optimization_recommendations']:
            print(f"\nTOP OPTIMIZATION OPPORTUNITIES:")
            opt_data = report['optimization_recommendations']
            
            for detector, recommendations in opt_data.items():
                print(f"- {detector.upper()}:")
                for threshold_type, rec in recommendations.items():
                    current = rec['current_threshold']
                    balanced = rec['strategies']['balanced']['threshold']
                    improvement_factor = balanced / current if current != 0 else 'N/A'
                    print(f"  • {threshold_type}: {current} → {balanced:.3f} (balanced strategy)")
        
        print("\n" + "="*80)

def main():
    """Main analysis execution"""
    log_directory = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation"
    output_file = "/Users/marcschot/Projects/OrderFlow Trading/detector_optimization_report.json"
    
    print("DETECTOR OPTIMIZATION ANALYSIS")
    print("="*50)
    print(f"Analyzing logs from: {log_directory}")
    
    # Initialize analyzer
    analyzer = DetectorOptimizationAnalyzer(log_directory)
    
    # Load data
    analyzer.load_rejection_data()
    analyzer.load_validation_data()
    
    # Generate comprehensive report
    report = analyzer.generate_implementation_report()
    
    # Save report
    analyzer.save_analysis_report(report, output_file)
    
    # Print executive summary
    analyzer.print_executive_summary(report)
    
    print(f"\nFull analysis report available at: {output_file}")

if __name__ == "__main__":
    main()
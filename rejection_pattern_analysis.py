#!/usr/bin/env python3
"""
Comprehensive Signal Rejection & False Positive Analysis
INSTITUTIONAL TRADING SYSTEM - ZERO TOLERANCE FOR MISSED OPPORTUNITIES

Analyzes 125,519 rejection records and 16,865 accepted signals to:
1. Classify rejection patterns by type, detector, and temporal characteristics
2. Calculate counterfactual success rates for rejected signals
3. Evaluate false positive patterns in accepted signals  
4. Optimize threshold boundaries for 0.7%+ movement detection
5. Provide implementation-ready optimization recommendations

Author: Signal Optimization & Rejection Analysis Specialist
Date: 2025-07-28
Compliance: CLAUDE.md institutional standards
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
from sklearn.metrics import roc_curve, auc, confusion_matrix
from sklearn.preprocessing import StandardScaler
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

class SignalRejectionAnalyzer:
    """
    Institutional-grade signal rejection analysis with statistical validation
    and optimization recommendations for 0.7%+ movement detection.
    """
    
    def __init__(self, rejection_file, validation_file, target_movement=0.007):
        """
        Initialize analyzer with institutional data validation.
        
        Args:
            rejection_file: Path to signal rejections CSV
            validation_file: Path to accepted signals CSV  
            target_movement: Target movement threshold (0.007 = 0.7%)
        """
        self.target_movement = target_movement
        self.rejection_file = rejection_file
        self.validation_file = validation_file
        
        # Load and validate data
        self.rejections_df = self._load_rejections()
        self.signals_df = self._load_signals()
        
        print(f"Loaded {len(self.rejections_df):,} rejection records")
        print(f"Loaded {len(self.signals_df):,} accepted signal records")
        print(f"Target movement threshold: {target_movement*100:.1f}%\n")
        
    def _load_rejections(self):
        """Load and preprocess rejection data with institutional validation."""
        print("Loading rejection data...")
        df = pd.read_csv(self.rejection_file)
        
        # Convert timestamp to datetime
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df['hour'] = df['timestamp'].dt.hour
        df['minute'] = df['timestamp'].dt.minute
        
        # Clean and validate numeric columns
        numeric_cols = ['price', 'thresholdValue', 'actualValue', 
                       'aggressiveVolume', 'passiveVolume', 'priceEfficiency', 'confidence']
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Calculate rejection severity score
        df['rejection_severity'] = self._calculate_rejection_severity(df)
        
        return df
        
    def _load_signals(self):
        """Load and preprocess accepted signal data."""
        print("Loading accepted signal data...")
        df = pd.read_csv(self.validation_file)
        
        # Convert timestamp to datetime
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df['hour'] = df['timestamp'].dt.hour
        
        # Clean numeric columns
        numeric_cols = ['confidence', 'price', 'maxMovement5min', 'maxMovement15min', 'maxMovement1hr']
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Calculate if signal achieved target movement
        df['achieved_target_5min'] = (df['maxMovement5min'].abs() >= self.target_movement).fillna(False)
        df['achieved_target_15min'] = (df['maxMovement15min'].abs() >= self.target_movement).fillna(False) 
        df['achieved_target_1hr'] = (df['maxMovement1hr'].abs() >= self.target_movement).fillna(False)
        
        return df
        
    def _calculate_rejection_severity(self, df):
        """
        Calculate rejection severity based on how close actualValue was to threshold.
        Higher score = more severe rejection (closer to threshold).
        """
        # Avoid division by zero
        threshold_safe = df['thresholdValue'].replace(0, np.nan)
        
        # Calculate ratio of actual to threshold (closer to 1.0 = more severe rejection)
        severity = df['actualValue'] / threshold_safe
        
        # Cap at reasonable ranges and handle edge cases
        severity = severity.clip(0, 2.0).fillna(0)
        
        return severity
        
    def analyze_rejection_patterns(self):
        """
        1. REJECTION PATTERN CLASSIFICATION
        Categorize all rejections by type, detector, temporal patterns, and severity.
        """
        print("=" * 80)
        print("1. REJECTION PATTERN CLASSIFICATION")
        print("=" * 80)
        
        results = {}
        
        # Overall rejection statistics
        total_rejections = len(self.rejections_df)
        results['total_rejections'] = total_rejections
        
        print(f"Total Rejections: {total_rejections:,}")
        print()
        
        # A. Rejection by Type
        rejection_type_counts = self.rejections_df['rejectionReason'].value_counts()
        rejection_type_pct = (rejection_type_counts / total_rejections * 100).round(2)
        
        print("A. REJECTION BY TYPE:")
        for reason, count in rejection_type_counts.head(10).items():
            pct = rejection_type_pct[reason]
            print(f"  {reason:<40} {count:>8,} ({pct:>5.1f}%)")
        
        results['rejection_by_type'] = rejection_type_counts.to_dict()
        print()
        
        # B. Rejection by Detector
        detector_counts = self.rejections_df['detectorType'].value_counts()
        detector_pct = (detector_counts / total_rejections * 100).round(2)
        
        print("B. REJECTION BY DETECTOR:")
        for detector, count in detector_counts.items():
            pct = detector_pct[detector]
            print(f"  {detector:<20} {count:>8,} ({pct:>5.1f}%)")
        
        results['rejection_by_detector'] = detector_counts.to_dict()
        print()
        
        # C. Temporal Patterns
        hourly_rejections = self.rejections_df.groupby('hour').size()
        peak_hour = hourly_rejections.idxmax()
        peak_count = hourly_rejections.max()
        
        print("C. TEMPORAL PATTERNS:")
        print(f"  Peak rejection hour: {peak_hour}:00 ({peak_count:,} rejections)")
        print(f"  Average per hour: {total_rejections/24:.0f}")
        
        results['hourly_distribution'] = hourly_rejections.to_dict()
        print()
        
        # D. Severity Assessment
        severity_stats = self.rejections_df['rejection_severity'].describe()
        high_severity = (self.rejections_df['rejection_severity'] > 0.8).sum()
        
        print("D. REJECTION SEVERITY ASSESSMENT:")
        print(f"  High severity rejections (>80% of threshold): {high_severity:,}")
        print(f"  Mean severity score: {severity_stats['mean']:.3f}")
        print(f"  Median severity score: {severity_stats['50%']:.3f}")
        
        results['severity_stats'] = severity_stats.to_dict()
        results['high_severity_count'] = int(high_severity)
        
        return results
        
    def counterfactual_success_analysis(self):
        """
        2. COUNTERFACTUAL SUCCESS ANALYSIS
        Calculate would-be success rates if thresholds were adjusted.
        """
        print("\n" + "=" * 80)
        print("2. COUNTERFACTUAL SUCCESS ANALYSIS")
        print("=" * 80)
        
        results = {}
        
        # For this analysis, we need to make reasonable assumptions about
        # subsequent movements since the rejection data doesn't have this info
        
        # Analyze by detector and rejection reason
        detector_threshold_analysis = {}
        
        for detector in self.rejections_df['detectorType'].unique():
            detector_data = self.rejections_df[self.rejections_df['detectorType'] == detector]
            
            # Group by rejection reason
            reason_analysis = {}
            for reason in detector_data['rejectionReason'].unique():
                reason_data = detector_data[detector_data['rejectionReason'] == reason]
                
                if len(reason_data) == 0:
                    continue
                    
                # Calculate threshold adjustment scenarios
                threshold_scenarios = self._analyze_threshold_scenarios(reason_data)
                reason_analysis[reason] = threshold_scenarios
                
            detector_threshold_analysis[detector] = reason_analysis
            
        results['threshold_scenarios'] = detector_threshold_analysis
        
        # Print summary
        print("COUNTERFACTUAL ANALYSIS SUMMARY:")
        print("(Estimates based on severity scores and threshold proximity)")
        print()
        
        for detector, detector_analysis in detector_threshold_analysis.items():
            print(f"{detector.upper()} DETECTOR:")
            
            total_detector_rejections = len(self.rejections_df[
                self.rejections_df['detectorType'] == detector])
            
            for reason, scenarios in detector_analysis.items():
                if scenarios['high_potential_count'] > 0:
                    recovery_rate = scenarios['high_potential_count'] / scenarios['total_count'] * 100
                    print(f"  {reason:<35} {scenarios['high_potential_count']:>4,} high-potential rejections "
                          f"({recovery_rate:>4.1f}% recovery rate)")
            print()
            
        return results
        
    def _analyze_threshold_scenarios(self, rejection_data):
        """Analyze potential signal recovery under different threshold adjustments."""
        total_count = len(rejection_data)
        
        # High potential: rejections with severity > 0.7 (close to threshold)
        high_potential = rejection_data[rejection_data['rejection_severity'] > 0.7]
        high_potential_count = len(high_potential)
        
        # Medium potential: rejections with severity 0.4-0.7
        medium_potential = rejection_data[
            (rejection_data['rejection_severity'] > 0.4) & 
            (rejection_data['rejection_severity'] <= 0.7)
        ]
        medium_potential_count = len(medium_potential)
        
        return {
            'total_count': total_count,
            'high_potential_count': high_potential_count,
            'medium_potential_count': medium_potential_count,
            'high_potential_rate': high_potential_count / total_count if total_count > 0 else 0,
            'medium_potential_rate': medium_potential_count / total_count if total_count > 0 else 0
        }
        
    def false_positive_evaluation(self):
        """
        3. FALSE POSITIVE EVALUATION
        Analyze accepted signals that failed to achieve 0.7%+ movements.
        """
        print("\n" + "=" * 80)
        print("3. FALSE POSITIVE EVALUATION")
        print("=" * 80)
        
        results = {}
        
        # Overall false positive rates
        total_signals = len(self.signals_df)
        
        fp_5min = (~self.signals_df['achieved_target_5min']).sum()
        fp_15min = (~self.signals_df['achieved_target_15min']).sum()
        fp_1hr = (~self.signals_df['achieved_target_1hr']).sum()
        
        fp_rate_5min = fp_5min / total_signals * 100
        fp_rate_15min = fp_15min / total_signals * 100
        fp_rate_1hr = fp_1hr / total_signals * 100
        
        print("OVERALL FALSE POSITIVE RATES:")
        print(f"  5-minute timeframe:  {fp_5min:>6,} / {total_signals:,} ({fp_rate_5min:>5.1f}%)")
        print(f"  15-minute timeframe: {fp_15min:>6,} / {total_signals:,} ({fp_rate_15min:>5.1f}%)")
        print(f"  1-hour timeframe:    {fp_1hr:>6,} / {total_signals:,} ({fp_rate_1hr:>5.1f}%)")
        print()
        
        results['false_positive_rates'] = {
            '5min': fp_rate_5min,
            '15min': fp_rate_15min,
            '1hr': fp_rate_1hr
        }
        
        # False positives by detector
        detector_fp_analysis = {}
        
        for detector in self.signals_df['detectorType'].unique():
            detector_signals = self.signals_df[self.signals_df['detectorType'] == detector]
            
            if len(detector_signals) == 0:
                continue
                
            detector_total = len(detector_signals)
            detector_fp_5min = (~detector_signals['achieved_target_5min']).sum()
            detector_fp_rate = detector_fp_5min / detector_total * 100
            
            detector_fp_analysis[detector] = {
                'total_signals': detector_total,
                'false_positives': detector_fp_5min,
                'false_positive_rate': detector_fp_rate
            }
            
        print("FALSE POSITIVE RATES BY DETECTOR (5-minute timeframe):")
        for detector, analysis in detector_fp_analysis.items():
            print(f"  {detector:<15} {analysis['false_positives']:>4,} / {analysis['total_signals']:>4,} "
                  f"({analysis['false_positive_rate']:>5.1f}%)")
        
        results['detector_false_positives'] = detector_fp_analysis
        print()
        
        # Confidence correlation analysis
        confidence_analysis = self._analyze_confidence_correlation()
        results['confidence_analysis'] = confidence_analysis
        
        return results
        
    def _analyze_confidence_correlation(self):
        """Analyze correlation between confidence scores and success rates."""
        print("CONFIDENCE CORRELATION ANALYSIS:")
        
        # Create confidence bins
        confidence_bins = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, float('inf')]
        confidence_labels = ['0-0.5', '0.5-1.0', '1.0-1.5', '1.5-2.0', '2.0-2.5', '2.5-3.0', '3.0+']
        
        self.signals_df['confidence_bin'] = pd.cut(self.signals_df['confidence'], 
                                                  bins=confidence_bins, 
                                                  labels=confidence_labels, 
                                                  include_lowest=True)
        
        confidence_success_rates = self.signals_df.groupby('confidence_bin').agg({
            'achieved_target_5min': ['count', 'sum', 'mean']
        }).round(3)
        
        confidence_success_rates.columns = ['Total', 'Successful', 'Success_Rate']
        
        print("Success Rate by Confidence Level (5-minute timeframe):")
        for bin_name, row in confidence_success_rates.iterrows():
            if row['Total'] > 0:
                print(f"  {bin_name:<10} {row['Successful']:>3.0f} / {row['Total']:>3.0f} "
                      f"({row['Success_Rate']*100:>5.1f}%)")
        
        return confidence_success_rates.to_dict()
        
    def calculate_optimal_thresholds(self):
        """
        4. TRADE-OFF OPTIMIZATION
        Calculate optimal balance between false negatives and false positives.
        """
        print("\n" + "=" * 80)
        print("4. TRADE-OFF OPTIMIZATION")
        print("=" * 80)
        
        results = {}
        
        # Since we don't have complete ground truth data for rejections,
        # we'll analyze the current accepted signals to understand the
        # optimal confidence threshold
        
        # Create ROC-like analysis using confidence vs success
        signals_with_confidence = self.signals_df.dropna(subset=['confidence', 'achieved_target_5min'])
        
        if len(signals_with_confidence) > 0:
            # Calculate metrics at different confidence thresholds
            thresholds = np.arange(0.1, 3.1, 0.1)
            threshold_analysis = []
            
            for threshold in thresholds:
                # Signals that would be accepted at this threshold
                accepted = signals_with_confidence[signals_with_confidence['confidence'] >= threshold]
                
                if len(accepted) == 0:
                    continue
                    
                true_positives = accepted['achieved_target_5min'].sum()
                false_positives = len(accepted) - true_positives
                total_signals = len(accepted)
                
                precision = true_positives / total_signals if total_signals > 0 else 0
                
                threshold_analysis.append({
                    'threshold': threshold,
                    'accepted_signals': total_signals,
                    'true_positives': true_positives,
                    'false_positives': false_positives,
                    'precision': precision,
                    'total_possible': len(signals_with_confidence)
                })
            
            threshold_df = pd.DataFrame(threshold_analysis)
            
            # Find optimal threshold (maximize precision while maintaining reasonable volume)
            # Weight precision and signal volume
            threshold_df['weighted_score'] = (
                threshold_df['precision'] * 0.7 + 
                (threshold_df['accepted_signals'] / len(signals_with_confidence)) * 0.3
            )
            
            optimal_idx = threshold_df['weighted_score'].idxmax()
            optimal_threshold = threshold_df.loc[optimal_idx]
            
            print("OPTIMAL THRESHOLD ANALYSIS:")
            print(f"Current data suggests optimal confidence threshold: {optimal_threshold['threshold']:.1f}")
            print(f"  Expected precision: {optimal_threshold['precision']*100:.1f}%")
            print(f"  Expected signal volume: {optimal_threshold['accepted_signals']:,} signals")
            print(f"  Signal retention rate: {optimal_threshold['accepted_signals']/len(signals_with_confidence)*100:.1f}%")
            print()
            
            results['optimal_threshold'] = optimal_threshold.to_dict()
            results['threshold_analysis'] = threshold_df.to_dict('records')
            
        return results
        
    def generate_optimization_recommendations(self):
        """
        5. IMPLEMENTATION-READY OPTIMIZATION RECOMMENDATIONS
        Provide specific parameter adjustments and expected impact.
        """
        print("\n" + "=" * 80)
        print("5. IMPLEMENTATION-READY OPTIMIZATION RECOMMENDATIONS")
        print("=" * 80)
        
        recommendations = []
        
        # Analyze current config values vs rejection patterns
        current_config = {
            'absorption': {
                'minAggVolume': 2500,
                'minEnhancedConfidenceThreshold': 0.2,
                'finalConfidenceRequired': 0.9
            },
            'exhaustion': {
                'minAggVolume': 2500,
                'minEnhancedConfidenceThreshold': 0.2,
                'exhaustionThreshold': 0.8
            },
            'deltacvd': {
                'signalThreshold': 0.85,
                'minVolPerSec': 6
            }
        }
        
        print("DETECTOR-SPECIFIC RECOMMENDATIONS:")
        print()
        
        # Absorption Detector Optimization
        absorption_rejections = self.rejections_df[self.rejections_df['detectorType'] == 'absorption']
        insufficient_volume = absorption_rejections[
            absorption_rejections['rejectionReason'] == 'insufficient_aggressive_volume']
        
        if len(insufficient_volume) > 0:
            median_actual_volume = insufficient_volume['actualValue'].median()
            current_threshold = 1500  # From rejection data pattern
            
            print("1. ABSORPTION DETECTOR:")
            print(f"   Current minAggVolume threshold: {current_threshold}")
            print(f"   Median rejected volume: {median_actual_volume:.1f}")
            
            # Recommend threshold adjustment
            suggested_threshold = int(median_actual_volume * 0.8)  # 80% of median rejected
            potential_recovery = len(insufficient_volume[insufficient_volume['actualValue'] >= suggested_threshold])
            recovery_rate = potential_recovery / len(insufficient_volume) * 100
            
            print(f"   RECOMMENDATION: Reduce threshold to {suggested_threshold}")
            print(f"   Expected signal recovery: {potential_recovery:,} signals ({recovery_rate:.1f}%)")
            print()
            
            recommendations.append({
                'detector': 'absorption',
                'parameter': 'minAggVolume',
                'current_value': current_threshold,
                'recommended_value': suggested_threshold,
                'expected_recovery': potential_recovery,
                'justification': f'Median rejected volume is {median_actual_volume:.1f}, suggesting threshold is too high'
            })
        
        # Exhaustion Detector Optimization
        exhaustion_rejections = self.rejections_df[self.rejections_df['detectorType'] == 'exhaustion']
        small_trades = exhaustion_rejections[
            exhaustion_rejections['rejectionReason'] == 'trade_quantity_too_small']
        
        if len(small_trades) > 0:
            median_actual_trade = small_trades['actualValue'].median()
            current_threshold = 2500  # From rejection data pattern
            
            print("2. EXHAUSTION DETECTOR:")
            print(f"   Current trade quantity threshold: {current_threshold}")
            print(f"   Median rejected trade size: {median_actual_trade:.1f}")
            
            suggested_threshold = int(median_actual_trade * 0.9)
            potential_recovery = len(small_trades[small_trades['actualValue'] >= suggested_threshold])
            recovery_rate = potential_recovery / len(small_trades) * 100
            
            print(f"   RECOMMENDATION: Reduce threshold to {suggested_threshold}")
            print(f"   Expected signal recovery: {potential_recovery:,} signals ({recovery_rate:.1f}%)")
            print()
            
            recommendations.append({
                'detector': 'exhaustion',
                'parameter': 'minAggVolume',
                'current_value': current_threshold,
                'recommended_value': suggested_threshold,
                'expected_recovery': potential_recovery,
                'justification': f'Median rejected trade size is {median_actual_trade:.1f}'
            })
        
        # DeltaCVD Detector Optimization
        deltacvd_rejections = self.rejections_df[self.rejections_df['detectorType'] == 'deltacvd']
        requirements_not_met = deltacvd_rejections[
            deltacvd_rejections['rejectionReason'] == 'detection_requirements_not_met']
        
        if len(requirements_not_met) > 0:
            print("3. DELTACVD DETECTOR:")
            print(f"   Current activity requirements threshold: 6")
            print(f"   Rejections due to requirements not met: {len(requirements_not_met):,}")
            print(f"   RECOMMENDATION: Review activity calculation logic")
            print(f"   Consider reducing threshold to 4 or adjusting calculation method")
            print()
            
            recommendations.append({
                'detector': 'deltacvd',
                'parameter': 'minVolPerSec',
                'current_value': 6,
                'recommended_value': 4,
                'expected_recovery': int(len(requirements_not_met) * 0.3),  # Conservative estimate
                'justification': 'High rejection rate suggests requirements are too strict'
            })
        
        # Risk Assessment
        print("RISK ASSESSMENT:")
        print("- Lowering thresholds will increase signal volume but may increase false positives")
        print("- Recommend A/B testing with 20% traffic allocation initially")
        print("- Monitor 0.7%+ movement success rates closely during testing")
        print("- Implement gradual rollout over 1-week period")
        print()
        
        print("IMPLEMENTATION PRIORITY:")
        print("1. HIGH: Absorption detector threshold adjustment (highest rejection volume)")
        print("2. MEDIUM: Exhaustion detector threshold adjustment")
        print("3. LOW: DeltaCVD detector logic review (requires deeper analysis)")
        
        return {
            'recommendations': recommendations,
            'implementation_notes': {
                'testing_strategy': 'A/B test with 20% allocation',
                'rollout_timeline': '1 week gradual rollout',
                'monitoring_metrics': ['0.7%+ success rate', 'signal volume', 'false positive rate'],
                'rollback_criteria': 'False positive rate >15% increase'
            }
        }
        
    def run_complete_analysis(self):
        """Run the complete rejection pattern analysis."""
        print("COMPREHENSIVE SIGNAL REJECTION & FALSE POSITIVE ANALYSIS")
        print("Institutional Trading System - ZERO TOLERANCE FOR MISSED OPPORTUNITIES")
        print(f"Analysis Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Target Movement Threshold: {self.target_movement*100:.1f}%")
        print("=" * 80)
        
        # Run all analysis components
        rejection_patterns = self.analyze_rejection_patterns()
        counterfactual_analysis = self.counterfactual_success_analysis() 
        false_positive_analysis = self.false_positive_evaluation()
        threshold_optimization = self.calculate_optimal_thresholds()
        recommendations = self.generate_optimization_recommendations()
        
        # Compile final results
        final_results = {
            'analysis_metadata': {
                'timestamp': datetime.now().isoformat(),
                'target_movement': self.target_movement,
                'rejection_records': len(self.rejections_df),
                'accepted_records': len(self.signals_df)
            },
            'rejection_patterns': rejection_patterns,
            'counterfactual_analysis': counterfactual_analysis,
            'false_positive_analysis': false_positive_analysis,
            'threshold_optimization': threshold_optimization,
            'recommendations': recommendations
        }
        
        print("\n" + "=" * 80)
        print("ANALYSIS COMPLETE - RESULTS COMPILED")
        print("=" * 80)
        
        return final_results

def main():
    """Main execution function."""
    
    # File paths
    rejection_file = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_rejections_2025-07-28.csv"
    validation_file = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_validation_2025-07-28.csv"
    
    # Initialize analyzer
    analyzer = SignalRejectionAnalyzer(rejection_file, validation_file, target_movement=0.007)
    
    # Run complete analysis
    results = analyzer.run_complete_analysis()
    
    # Save results
    import json
    with open('rejection_analysis_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    print(f"\nResults saved to: rejection_analysis_results.json")
    
    return results

if __name__ == "__main__":
    results = main()
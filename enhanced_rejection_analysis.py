#!/usr/bin/env python3
"""
Enhanced Signal Rejection Analysis with Statistical Validation
INSTITUTIONAL TRADING SYSTEM - ZERO TOLERANCE FOR MISSED OPPORTUNITIES

Advanced analysis focusing on rejection patterns, threshold optimization,
and statistical modeling for 0.7%+ movement detection.

Author: Signal Optimization & Rejection Analysis Specialist
Date: 2025-07-28
Compliance: CLAUDE.md institutional standards
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
from datetime import datetime, timedelta
import json
import warnings
warnings.filterwarnings('ignore')

class EnhancedRejectionAnalyzer:
    """
    Advanced institutional-grade signal rejection analysis with
    statistical modeling and optimization recommendations.
    """
    
    def __init__(self, rejection_file, validation_file, target_movement=0.007):
        """Initialize with comprehensive data validation."""
        self.target_movement = target_movement
        self.rejection_file = rejection_file
        self.validation_file = validation_file
        
        # Load data
        self.rejections_df = self._load_rejections()
        self.signals_df = self._load_signals()
        
        print(f"Enhanced Analysis Initialized:")
        print(f"  Rejection records: {len(self.rejections_df):,}")
        print(f"  Accepted signals: {len(self.signals_df):,}")
        print(f"  Target movement: {target_movement*100:.1f}%\n")
        
    def _load_rejections(self):
        """Load rejection data with enhanced preprocessing."""
        df = pd.read_csv(self.rejection_file)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df['hour'] = df['timestamp'].dt.hour
        df['day_of_week'] = df['timestamp'].dt.dayofweek
        
        # Enhanced rejection severity calculation
        df['threshold_ratio'] = self._calculate_threshold_ratio(df)
        df['rejection_impact'] = self._calculate_rejection_impact(df)
        df['recovery_potential'] = self._calculate_recovery_potential(df)
        
        return df
        
    def _load_signals(self):
        """Load signal data with enhanced metrics."""
        df = pd.read_csv(self.validation_file)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df['hour'] = df['timestamp'].dt.hour
        
        # Calculate signal quality metrics
        df['signal_quality'] = self._calculate_signal_quality(df)
        df['institutional_score'] = self._calculate_institutional_score(df)
        
        return df
        
    def _calculate_threshold_ratio(self, df):
        """Calculate how close actualValue is to thresholdValue."""
        ratio = df['actualValue'] / df['thresholdValue'].replace(0, np.nan)
        return ratio.clip(0, 2.0).fillna(0)
        
    def _calculate_rejection_impact(self, df):
        """Calculate potential impact of each rejection."""
        # Higher impact for rejections close to threshold with high volume
        base_impact = df['threshold_ratio'] * 0.6  # Closer to threshold = higher impact
        volume_impact = np.log1p(df['aggressiveVolume'].fillna(0)) * 0.2  # Volume scaling
        confidence_impact = df['confidence'].fillna(0) * 0.2  # Confidence scaling
        
        return (base_impact + volume_impact + confidence_impact).clip(0, 1)
        
    def _calculate_recovery_potential(self, df):
        """Calculate likelihood of signal recovery with threshold adjustment."""
        # High potential if close to threshold + good volume + reasonable confidence
        threshold_factor = (df['threshold_ratio'] > 0.5).astype(float) * 0.4
        volume_factor = (df['aggressiveVolume'].fillna(0) > 100).astype(float) * 0.3
        confidence_factor = (df['confidence'].fillna(0) > 0.1).astype(float) * 0.3
        
        return threshold_factor + volume_factor + confidence_factor
        
    def _calculate_signal_quality(self, df):
        """Calculate overall signal quality score."""
        confidence_score = (df['confidence'].fillna(0) / 3.0).clip(0, 1) * 0.4
        volume_score = np.log1p(df['totalAggressiveVolume'].fillna(0)) / 10 * 0.3
        institutional_score = df['institutionalVolumeRatio'].fillna(0) * 0.3
        
        return confidence_score + volume_score + institutional_score
        
    def _calculate_institutional_score(self, df):
        """Calculate institutional footprint strength."""
        return (df['institutionalFootprint'].fillna(0) * 
               df['institutionalVolumeRatio'].fillna(0))
        
    def analyze_rejection_patterns_advanced(self):
        """Advanced rejection pattern analysis with statistical validation."""
        print("="*80)
        print("ADVANCED REJECTION PATTERN ANALYSIS")
        print("="*80)
        
        results = {}
        
        # 1. Temporal Analysis
        temporal_analysis = self._analyze_temporal_patterns()
        results['temporal_patterns'] = temporal_analysis
        
        # 2. Detector Performance Analysis
        detector_analysis = self._analyze_detector_performance()
        results['detector_performance'] = detector_analysis
        
        # 3. Threshold Sensitivity Analysis
        threshold_analysis = self._analyze_threshold_sensitivity()
        results['threshold_sensitivity'] = threshold_analysis
        
        # 4. Volume-Price Relationship Analysis
        volume_analysis = self._analyze_volume_price_relationships()
        results['volume_relationships'] = volume_analysis
        
        return results
        
    def _analyze_temporal_patterns(self):
        """Analyze rejection patterns across time dimensions."""
        print("1. TEMPORAL PATTERN ANALYSIS")
        print("-" * 40)
        
        # Hourly rejection patterns
        hourly_stats = self.rejections_df.groupby('hour').agg({
            'rejectionReason': 'count',
            'rejection_impact': 'mean',
            'recovery_potential': 'mean',
            'threshold_ratio': 'mean'
        }).round(3)
        
        # Find peak hours
        peak_hour = hourly_stats['rejectionReason'].idxmax()
        peak_count = hourly_stats['rejectionReason'].max()
        
        print(f"Peak rejection hour: {peak_hour}:00 ({peak_count:,} rejections)")
        print(f"Average rejection impact during peak: {hourly_stats.loc[peak_hour, 'rejection_impact']:.3f}")
        print(f"Recovery potential during peak: {hourly_stats.loc[peak_hour, 'recovery_potential']:.3f}")
        
        # Day of week analysis
        daily_stats = self.rejections_df.groupby('day_of_week').agg({
            'rejectionReason': 'count',
            'rejection_impact': 'mean'
        }).round(3)
        
        days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        print("\nDaily rejection patterns:")
        for day_idx, day_name in enumerate(days):
            if day_idx in daily_stats.index:
                count = daily_stats.loc[day_idx, 'rejectionReason']
                impact = daily_stats.loc[day_idx, 'rejection_impact']
                print(f"  {day_name}: {count:,} rejections (avg impact: {impact:.3f})")
        
        print()
        
        return {
            'hourly_patterns': hourly_stats.to_dict(),
            'daily_patterns': daily_stats.to_dict(),
            'peak_hour': int(peak_hour),
            'peak_count': int(peak_count)
        }
        
    def _analyze_detector_performance(self):
        """Comprehensive detector performance analysis."""
        print("2. DETECTOR PERFORMANCE ANALYSIS")
        print("-" * 40)
        
        detector_stats = {}
        
        for detector in self.rejections_df['detectorType'].unique():
            detector_data = self.rejections_df[self.rejections_df['detectorType'] == detector]
            
            # Calculate key metrics
            total_rejections = len(detector_data)
            avg_impact = detector_data['rejection_impact'].mean()
            high_potential_count = (detector_data['recovery_potential'] > 0.7).sum()
            recovery_rate = high_potential_count / total_rejections * 100
            
            # Top rejection reasons
            top_reasons = detector_data['rejectionReason'].value_counts().head(3).to_dict()
            
            detector_stats[detector] = {
                'total_rejections': total_rejections,
                'average_impact': round(avg_impact, 3),
                'high_potential_signals': high_potential_count,
                'recovery_rate': round(recovery_rate, 1),
                'top_rejection_reasons': top_reasons
            }
            
            print(f"{detector.upper()} DETECTOR:")
            print(f"  Total rejections: {total_rejections:,}")
            print(f"  Average impact: {avg_impact:.3f}")
            print(f"  High recovery potential: {high_potential_count:,} ({recovery_rate:.1f}%)")
            print(f"  Top rejection reason: {list(top_reasons.keys())[0]} ({list(top_reasons.values())[0]:,})")
            print()
            
        return detector_stats
        
    def _analyze_threshold_sensitivity(self):
        """Analyze sensitivity to threshold adjustments."""
        print("3. THRESHOLD SENSITIVITY ANALYSIS")
        print("-" * 40)
        
        threshold_scenarios = {}
        
        # Analyze different threshold adjustment scenarios
        adjustment_factors = [0.9, 0.8, 0.7, 0.6, 0.5]  # 10%, 20%, 30%, 40%, 50% reduction
        
        for detector in self.rejections_df['detectorType'].unique():
            detector_data = self.rejections_df[self.rejections_df['detectorType'] == detector]
            detector_scenarios = {}
            
            for factor in adjustment_factors:
                # Count rejections that would be recovered with this adjustment
                recovered = (detector_data['threshold_ratio'] >= factor).sum()
                recovery_rate = recovered / len(detector_data) * 100
                
                # Calculate weighted recovery (considering impact)
                weighted_recovery = (detector_data[detector_data['threshold_ratio'] >= factor]['rejection_impact'].sum() / 
                                   detector_data['rejection_impact'].sum() * 100)
                
                detector_scenarios[f"{(1-factor)*100:.0f}%_reduction"] = {
                    'recovered_signals': recovered,
                    'recovery_rate': round(recovery_rate, 1),
                    'weighted_recovery': round(weighted_recovery, 1)
                }
            
            threshold_scenarios[detector] = detector_scenarios
            
            print(f"{detector.upper()} THRESHOLD SENSITIVITY:")
            for scenario, metrics in detector_scenarios.items():
                print(f"  {scenario:<15} {metrics['recovered_signals']:>4,} signals "
                      f"({metrics['recovery_rate']:>4.1f}% / weighted: {metrics['weighted_recovery']:>4.1f}%)")
            print()
            
        return threshold_scenarios
        
    def _analyze_volume_price_relationships(self):
        """Analyze relationships between volume, price, and rejections."""
        print("4. VOLUME-PRICE RELATIONSHIP ANALYSIS")
        print("-" * 40)
        
        # Volume distribution analysis
        volume_stats = self.rejections_df['aggressiveVolume'].describe()
        
        # Price level analysis
        price_stats = self.rejections_df['price'].describe()
        
        # Correlation analysis
        correlations = self.rejections_df[['price', 'aggressiveVolume', 'passiveVolume', 
                                         'threshold_ratio', 'rejection_impact']].corr()
        
        print("Volume Distribution (Aggressive Volume):")
        print(f"  Median: {volume_stats['50%']:.1f}")
        print(f"  75th percentile: {volume_stats['75%']:.1f}")
        print(f"  95th percentile: {volume_stats['95%'] if '95%' in volume_stats else 'N/A'}")
        
        print(f"\nPrice Level Distribution:")
        print(f"  Range: ${price_stats['min']:.2f} - ${price_stats['max']:.2f}")
        print(f"  Median: ${price_stats['50%']:.2f}")
        
        print(f"\nKey Correlations:")
        print(f"  Price vs Rejection Impact: {correlations.loc['price', 'rejection_impact']:.3f}")
        print(f"  Volume vs Threshold Ratio: {correlations.loc['aggressiveVolume', 'threshold_ratio']:.3f}")
        print()
        
        return {
            'volume_stats': volume_stats.to_dict(),
            'price_stats': price_stats.to_dict(),
            'correlations': correlations.to_dict()
        }
        
    def calculate_optimization_parameters(self):
        """Calculate specific optimization parameters with statistical validation."""
        print("="*80)
        print("STATISTICAL OPTIMIZATION PARAMETER CALCULATION")
        print("="*80)
        
        optimizations = {}
        
        # For each detector, calculate optimal threshold adjustments
        for detector in self.rejections_df['detectorType'].unique():
            detector_data = self.rejections_df[self.rejections_df['detectorType'] == detector]
            
            # Find rejection reasons that are threshold-based
            threshold_reasons = detector_data[detector_data['thresholdValue'] > 0]
            
            if len(threshold_reasons) == 0:
                continue
                
            # Group by rejection reason and threshold type
            reason_analysis = {}
            
            for reason in threshold_reasons['rejectionReason'].unique():
                reason_data = threshold_reasons[threshold_reasons['rejectionReason'] == reason]
                
                if len(reason_data) < 10:  # Skip if too few samples
                    continue
                    
                # Calculate statistical metrics
                current_threshold = reason_data['thresholdValue'].median()
                actual_values = reason_data['actualValue']
                
                # Statistical analysis of rejected values
                q25 = actual_values.quantile(0.25)
                q50 = actual_values.quantile(0.50)
                q75 = actual_values.quantile(0.75)
                
                # Recommend threshold based on quantile analysis
                # Use 25th percentile to capture more signals while maintaining quality
                recommended_threshold = q25
                
                # Calculate expected impact
                would_be_accepted = (actual_values >= recommended_threshold).sum()
                current_rejection_count = len(reason_data)
                recovery_rate = would_be_accepted / current_rejection_count * 100
                
                # Calculate statistical confidence
                confidence_interval = stats.t.interval(0.95, len(actual_values)-1, 
                                                     loc=actual_values.mean(), 
                                                     scale=stats.sem(actual_values))
                
                reason_analysis[reason] = {
                    'current_threshold': float(current_threshold),
                    'recommended_threshold': float(recommended_threshold),
                    'current_rejections': int(current_rejection_count),
                    'potential_recovery': int(would_be_accepted),
                    'recovery_rate': round(recovery_rate, 1),
                    'value_statistics': {
                        'q25': float(q25),
                        'q50': float(q50),
                        'q75': float(q75),
                        'mean': float(actual_values.mean()),
                        'std': float(actual_values.std())
                    },
                    'confidence_interval': [float(ci) for ci in confidence_interval],
                    'statistical_significance': 'high' if len(reason_data) > 100 else 'medium'
                }
                
            optimizations[detector] = reason_analysis
            
        # Print recommendations
        print("STATISTICAL OPTIMIZATION RECOMMENDATIONS:")
        print()
        
        for detector, analysis in optimizations.items():
            print(f"{detector.upper()} DETECTOR OPTIMIZATIONS:")
            
            for reason, metrics in analysis.items():
                print(f"  {reason}:")
                print(f"    Current threshold: {metrics['current_threshold']:.1f}")
                print(f"    Recommended threshold: {metrics['recommended_threshold']:.1f}")
                print(f"    Expected recovery: {metrics['potential_recovery']:,} signals ({metrics['recovery_rate']:.1f}%)")
                print(f"    Statistical confidence: {metrics['statistical_significance']}")
                print(f"    Value distribution: Q25={metrics['value_statistics']['q25']:.1f}, "
                      f"Q50={metrics['value_statistics']['q50']:.1f}, Q75={metrics['value_statistics']['q75']:.1f}")
                print()
            
        return optimizations
        
    def generate_implementation_roadmap(self, optimizations):
        """Generate detailed implementation roadmap with risk assessment."""
        print("="*80)
        print("IMPLEMENTATION ROADMAP & RISK ASSESSMENT")
        print("="*80)
        
        # Prioritize optimizations by impact
        implementation_plan = []
        
        for detector, analysis in optimizations.items():
            for reason, metrics in analysis.items():
                impact_score = (metrics['potential_recovery'] * metrics['recovery_rate'] / 100)
                
                implementation_plan.append({
                    'detector': detector,
                    'parameter': self._map_reason_to_parameter(reason),
                    'rejection_reason': reason,
                    'current_value': metrics['current_threshold'],
                    'recommended_value': metrics['recommended_threshold'],
                    'expected_recovery': metrics['potential_recovery'],
                    'recovery_rate': metrics['recovery_rate'],
                    'impact_score': impact_score,
                    'statistical_confidence': metrics['statistical_significance'],
                    'risk_level': self._assess_risk_level(metrics)
                })
        
        # Sort by impact score
        implementation_plan.sort(key=lambda x: x['impact_score'], reverse=True)
        
        print("PRIORITIZED IMPLEMENTATION PLAN:")
        print()
        
        for i, item in enumerate(implementation_plan[:10], 1):  # Top 10 optimizations
            print(f"{i}. {item['detector'].upper()} - {item['parameter']}")
            print(f"   Current: {item['current_value']:.1f} → Recommended: {item['recommended_value']:.1f}")
            print(f"   Impact: {item['expected_recovery']:,} signals ({item['recovery_rate']:.1f}% recovery)")
            print(f"   Risk Level: {item['risk_level']} | Confidence: {item['statistical_confidence']}")
            print()
        
        # Risk assessment
        print("RISK ASSESSMENT & MITIGATION:")
        print("- HIGH PRIORITY: Items with >1000 potential signal recovery")
        print("- MEDIUM RISK: Threshold reductions >30% require careful monitoring")
        print("- LOW RISK: Statistical confidence 'high' with large sample sizes")
        print()
        
        print("IMPLEMENTATION STRATEGY:")
        print("1. PHASE 1 (Week 1): Implement top 3 optimizations with A/B testing (20% traffic)")
        print("2. PHASE 2 (Week 2): Monitor results, expand to 50% traffic if successful")
        print("3. PHASE 3 (Week 3): Full rollout + implement next 3 optimizations")
        print("4. CONTINUOUS: Monitor 0.7%+ movement detection rates and false positive increases")
        print()
        
        # Configuration changes
        config_changes = self._generate_config_changes(implementation_plan[:5])
        
        return {
            'implementation_plan': implementation_plan,
            'config_changes': config_changes,
            'monitoring_metrics': [
                'signal_volume_increase',
                'false_positive_rate_change', 
                'successful_0.7%_movement_detection',
                'detector_response_time',
                'memory_usage_impact'
            ]
        }
        
    def _map_reason_to_parameter(self, reason):
        """Map rejection reason to configuration parameter."""
        mapping = {
            'insufficient_aggressive_volume': 'minAggVolume',
            'trade_quantity_too_small': 'minAggVolume', 
            'detection_requirements_not_met': 'minVolPerSec',
            'passive_volume_ratio_too_low': 'passiveVolumeThreshold',
            'no_cvd_divergence': 'cvdImbalanceThreshold'
        }
        return mapping.get(reason, 'unknown_parameter')
        
    def _assess_risk_level(self, metrics):
        """Assess risk level of threshold change."""
        threshold_reduction = (metrics['current_threshold'] - metrics['recommended_threshold']) / metrics['current_threshold']
        
        if threshold_reduction > 0.5:  # >50% reduction
            return 'HIGH'
        elif threshold_reduction > 0.3:  # >30% reduction
            return 'MEDIUM'
        else:
            return 'LOW'
            
    def _generate_config_changes(self, top_optimizations):
        """Generate specific configuration file changes."""
        config_changes = {}
        
        for opt in top_optimizations:
            detector = opt['detector']
            parameter = opt['parameter']
            new_value = opt['recommended_value']
            
            if detector not in config_changes:
                config_changes[detector] = {}
                
            config_changes[detector][parameter] = {
                'current': opt['current_value'],
                'recommended': new_value,
                'justification': f"Statistical analysis of {opt['expected_recovery']} rejections"
            }
            
        return config_changes
        
    def run_complete_enhanced_analysis(self):
        """Run the complete enhanced analysis."""
        print("ENHANCED SIGNAL REJECTION ANALYSIS")
        print("Statistical Optimization for 0.7%+ Movement Detection")
        print(f"Analysis Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*80)
        
        # Run enhanced analysis components
        advanced_patterns = self.analyze_rejection_patterns_advanced()
        optimizations = self.calculate_optimization_parameters()
        implementation_roadmap = self.generate_implementation_roadmap(optimizations)
        
        # Compile results
        final_results = {
            'metadata': {
                'timestamp': datetime.now().isoformat(),
                'target_movement': self.target_movement,
                'total_rejections': len(self.rejections_df),
                'total_signals': len(self.signals_df),
                'analysis_type': 'enhanced_statistical'
            },
            'advanced_patterns': advanced_patterns,
            'statistical_optimizations': optimizations,
            'implementation_roadmap': implementation_roadmap
        }
        
        # Save results
        with open('enhanced_rejection_analysis_results.json', 'w') as f:
            json.dump(final_results, f, indent=2, default=str)
            
        print("ENHANCED ANALYSIS COMPLETE")
        print("Results saved to: enhanced_rejection_analysis_results.json")
        print("="*80)
        
        return final_results

def main():
    """Execute enhanced rejection analysis."""
    rejection_file = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_rejections_2025-07-28.csv"
    validation_file = "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_validation_2025-07-28.csv"
    
    analyzer = EnhancedRejectionAnalyzer(rejection_file, validation_file)
    return analyzer.run_complete_enhanced_analysis()

if __name__ == "__main__":
    results = main()
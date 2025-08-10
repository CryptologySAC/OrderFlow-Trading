#!/usr/bin/env python3
"""
Analyze exhaustion signals as if they were inverted (reversal signals)
Check validation file to see what would happen with corrected logic
"""

import pandas as pd
import numpy as np

def analyze_inverted_exhaustion():
    """Analyze exhaustion signals with inverted logic"""
    print("="*80)
    print("EXHAUSTION DETECTOR - INVERTED SIGNAL ANALYSIS")
    print("="*80)
    
    # Load exhaustion validation data (ALL signals, not just successful)
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/exhaustion_validation_2025-08-09.csv')
    
    print(f"\nTotal Exhaustion Signals: {len(df)}")
    
    # Filter for signals that have price data (not pending)
    evaluated = df[df['TP_SL'].notna()]
    print(f"Evaluated Signals: {len(evaluated)}")
    
    # Current performance
    current_tp = len(evaluated[evaluated['TP_SL'] == 'TP'])
    current_sl = len(evaluated[evaluated['TP_SL'] == 'SL'])
    current_neither = len(evaluated[evaluated['TP_SL'] == 'NEITHER'])
    
    print(f"\n📊 CURRENT PERFORMANCE (AS-IS):")
    print(f"  TP: {current_tp} ({current_tp/len(evaluated)*100:.1f}%)")
    print(f"  SL: {current_sl} ({current_sl/len(evaluated)*100:.1f}%)")
    print(f"  Neither: {current_neither} ({current_neither/len(evaluated)*100:.1f}%)")
    
    if current_tp + current_sl > 0:
        current_success = current_tp / (current_tp + current_sl) * 100
        print(f"  Success Rate: {current_success:.1f}%")
    
    # Analyze what would happen with inverted signals
    print(f"\n📊 INVERTED SIGNAL ANALYSIS:")
    
    # For each signal, check what would have happened if inverted
    inverted_results = []
    
    for idx, row in evaluated.iterrows():
        original_side = row['signalSide']
        price = row['price']
        price_5min = row.get('priceAt5min', np.nan)
        price_15min = row.get('priceAt15min', np.nan)
        price_1hr = row.get('priceAt1hr', np.nan)
        
        # Invert the signal
        inverted_side = 'sell' if original_side == 'buy' else 'buy'
        
        # Calculate what would have happened with inverted signal
        # For BUY signal: TP if price goes up 0.7%, SL if down 0.7%
        # For SELL signal: TP if price goes down 0.7%, SL if up 0.7%
        
        inverted_tp = False
        inverted_sl = False
        
        if not pd.isna(price_1hr):
            movement = (price_1hr - price) / price
            
            if inverted_side == 'buy':
                if movement >= 0.007:  # 0.7% up
                    inverted_tp = True
                elif movement <= -0.007:  # 0.7% down
                    inverted_sl = True
            else:  # sell
                if movement <= -0.007:  # 0.7% down
                    inverted_tp = True
                elif movement >= 0.007:  # 0.7% up
                    inverted_sl = True
        
        inverted_results.append({
            'original_side': original_side,
            'inverted_side': inverted_side,
            'original_result': row['TP_SL'],
            'inverted_result': 'TP' if inverted_tp else ('SL' if inverted_sl else 'NEITHER'),
            'price': price,
            'movement_1hr': (price_1hr - price) / price * 100 if not pd.isna(price_1hr) else np.nan,
            'confidence': row['confidence']
        })
    
    inverted_df = pd.DataFrame(inverted_results)
    
    # Calculate inverted performance
    inverted_tp = len(inverted_df[inverted_df['inverted_result'] == 'TP'])
    inverted_sl = len(inverted_df[inverted_df['inverted_result'] == 'SL'])
    inverted_neither = len(inverted_df[inverted_df['inverted_result'] == 'NEITHER'])
    
    print(f"\n🔄 PERFORMANCE WITH INVERTED SIGNALS:")
    print(f"  TP: {inverted_tp} ({inverted_tp/len(inverted_df)*100:.1f}%)")
    print(f"  SL: {inverted_sl} ({inverted_sl/len(inverted_df)*100:.1f}%)")
    print(f"  Neither: {inverted_neither} ({inverted_neither/len(inverted_df)*100:.1f}%)")
    
    if inverted_tp + inverted_sl > 0:
        inverted_success = inverted_tp / (inverted_tp + inverted_sl) * 100
        print(f"  Success Rate: {inverted_success:.1f}%")
        
        print(f"\n📈 IMPROVEMENT:")
        print(f"  Current Success: {current_success:.1f}%")
        print(f"  Inverted Success: {inverted_success:.1f}%")
        print(f"  Difference: {inverted_success - current_success:+.1f} percentage points")
    
    # Analyze by confidence levels
    print(f"\n📊 INVERTED SUCCESS BY CONFIDENCE:")
    confidence_ranges = [(0.65, 0.70), (0.70, 0.75), (0.75, 0.80), (0.80, 1.0)]
    
    for low, high in confidence_ranges:
        mask = (inverted_df['confidence'] >= low) & (inverted_df['confidence'] < high)
        subset = inverted_df[mask]
        
        if len(subset) > 0:
            tp = len(subset[subset['inverted_result'] == 'TP'])
            sl = len(subset[subset['inverted_result'] == 'SL'])
            
            if tp + sl > 0:
                success = tp / (tp + sl) * 100
                print(f"  {low:.2f}-{high:.2f}: {len(subset)} signals, {success:.1f}% success ({tp} TP / {sl} SL)")
    
    # Show examples of signals that would flip from SL to TP
    print(f"\n📋 EXAMPLES OF SIGNALS THAT WOULD IMPROVE:")
    flipped_to_tp = inverted_df[
        (inverted_df['original_result'] == 'SL') & 
        (inverted_df['inverted_result'] == 'TP')
    ]
    
    if len(flipped_to_tp) > 0:
        print(f"  Found {len(flipped_to_tp)} signals that would flip from SL to TP")
        
        # Show first 5 examples
        for i, (idx, row) in enumerate(flipped_to_tp.head(5).iterrows()):
            print(f"\n  Example {i+1}:")
            print(f"    Original: {row['original_side'].upper()} → {row['original_result']}")
            print(f"    Inverted: {row['inverted_side'].upper()} → {row['inverted_result']}")
            print(f"    Price: ${row['price']:.2f}")
            print(f"    1hr Movement: {row['movement_1hr']:.2f}%")
            print(f"    Confidence: {row['confidence']:.3f}")
    
    # Signals that would get worse
    print(f"\n📋 SIGNALS THAT WOULD GET WORSE:")
    flipped_to_sl = inverted_df[
        (inverted_df['original_result'] == 'TP') & 
        (inverted_df['inverted_result'] == 'SL')
    ]
    
    print(f"  Found {len(flipped_to_sl)} signals that would flip from TP to SL")
    
    # Summary statistics
    print(f"\n📊 SIGNAL FLIP SUMMARY:")
    print(f"  SL → TP: {len(flipped_to_tp)} signals")
    print(f"  TP → SL: {len(flipped_to_sl)} signals")
    print(f"  Net Improvement: {len(flipped_to_tp) - len(flipped_to_sl)} signals")
    
    # Check original signal distribution
    print(f"\n📊 ORIGINAL SIGNAL DISTRIBUTION:")
    buy_signals = evaluated[evaluated['signalSide'] == 'buy']
    sell_signals = evaluated[evaluated['signalSide'] == 'sell']
    
    print(f"  BUY signals: {len(buy_signals)}")
    if len(buy_signals) > 0:
        buy_tp = len(buy_signals[buy_signals['TP_SL'] == 'TP'])
        buy_sl = len(buy_signals[buy_signals['TP_SL'] == 'SL'])
        if buy_tp + buy_sl > 0:
            print(f"    Success: {buy_tp/(buy_tp + buy_sl)*100:.1f}% ({buy_tp} TP / {buy_sl} SL)")
    
    print(f"  SELL signals: {len(sell_signals)}")
    if len(sell_signals) > 0:
        sell_tp = len(sell_signals[sell_signals['TP_SL'] == 'TP'])
        sell_sl = len(sell_signals[sell_signals['TP_SL'] == 'SL'])
        if sell_tp + sell_sl > 0:
            print(f"    Success: {sell_tp/(sell_tp + sell_sl)*100:.1f}% ({sell_tp} TP / {sell_sl} SL)")

def main():
    """Run inverted exhaustion analysis"""
    analyze_inverted_exhaustion()

if __name__ == "__main__":
    main()
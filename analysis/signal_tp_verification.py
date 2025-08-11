#!/usr/bin/env python3
"""
Signal Take Profit Verification Analysis
Verifies if successful absorption signals actually reached their TP targets within 90 minutes
and tracks drawdown/gains for each signal.
"""

import sqlite3
import pandas as pd
import glob
import csv
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import os

def parse_signal_logs(log_dir: str = "logs") -> List[Dict]:
    """Parse successful absorption signals from CSV logs"""
    signals = []
    
    # Find all successful absorption signal files
    pattern = os.path.join(log_dir, "**/absorption_successful_*.csv")
    files = glob.glob(pattern, recursive=True)
    
    print(f"Found {len(files)} successful signal files")
    
    for file in files:
        print(f"Reading: {file}")
        try:
            with open(file, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        signal = {
                            'timestamp': int(row['timestamp']),
                            'signal_type': row['signalType'],
                            'price': float(row['price']),
                            'confidence': float(row.get('confidence', 0)),
                            'file': os.path.basename(file),
                            'date': datetime.fromtimestamp(int(row['timestamp']) / 1000)
                        }
                        signals.append(signal)
                    except (KeyError, ValueError) as e:
                        print(f"Error parsing row in {file}: {e}")
                        continue
        except Exception as e:
            print(f"Error reading file {file}: {e}")
    
    return signals

def get_price_movement(db_path: str, signal: Dict, minutes: int = 90) -> Dict:
    """Get price movement data for a signal from the database"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Signal timestamp in milliseconds
    start_time = signal['timestamp']
    end_time = start_time + (minutes * 60 * 1000)  # 90 minutes later
    
    # Query for price data in the time window
    query = """
    SELECT 
        MIN(T) as start_time,
        MAX(T) as end_time,
        MIN(p) as min_price,
        MAX(p) as max_price,
        COUNT(*) as trade_count
    FROM aggregated_trades
    WHERE T >= ? AND T <= ?
    """
    
    cursor.execute(query, (start_time, end_time))
    result = cursor.fetchone()
    
    # Get detailed price movements every minute
    detail_query = """
    SELECT 
        (T - ?) / 60000 as minutes_elapsed,
        MIN(CAST(p AS REAL)) as min_price,
        MAX(CAST(p AS REAL)) as max_price,
        AVG(CAST(p AS REAL)) as avg_price
    FROM aggregated_trades
    WHERE T >= ? AND T <= ?
    GROUP BY minutes_elapsed
    ORDER BY minutes_elapsed
    """
    
    cursor.execute(detail_query, (start_time, start_time, end_time))
    details = cursor.fetchall()
    
    conn.close()
    
    return {
        'min_price': result[2] if result else None,
        'max_price': result[3] if result else None,
        'trade_count': result[4] if result else 0,
        'details': details
    }

def calculate_signal_performance(signal: Dict, price_data: Dict) -> Dict:
    """Calculate performance metrics for a signal"""
    
    if not price_data['details']:
        return {
            'status': 'NO_DATA',
            'max_drawdown_pct': None,
            'max_gain_pct': None,
            'time_to_max_drawdown': None,
            'time_to_max_gain': None,
            'reached_tp': None,
            'reached_sl': None
        }
    
    entry_price = signal['price']
    signal_type = signal['signal_type']
    
    # TP/SL levels (assuming 0.7% TP and 0.5% SL as per typical config)
    tp_percentage = 0.007  # 0.7%
    sl_percentage = 0.005  # 0.5%
    
    if signal_type == 'TOP':
        tp_price = entry_price * (1 - tp_percentage)  # Short TP
        sl_price = entry_price * (1 + sl_percentage)  # Short SL
    else:  # BOTTOM
        tp_price = entry_price * (1 + tp_percentage)  # Long TP
        sl_price = entry_price * (1 - sl_percentage)  # Long SL
    
    # Track performance
    max_drawdown = 0
    max_gain = 0
    time_to_max_drawdown = None
    time_to_max_gain = None
    time_to_tp = None
    time_to_sl = None
    reached_tp = False
    reached_sl = False
    hit_sl_first = False
    
    for minute, min_p, max_p, avg_p in price_data['details']:
        if min_p is None or max_p is None:
            continue
            
        minute = int(minute)
        
        # Calculate movements from entry
        if signal_type == 'TOP':
            # For short: drawdown is price going up, gain is price going down
            drawdown_pct = ((max_p - entry_price) / entry_price) * 100
            gain_pct = ((entry_price - min_p) / entry_price) * 100
            
            # Check TP/SL
            if min_p <= tp_price and not reached_tp:
                reached_tp = True
                if time_to_tp is None:
                    time_to_tp = minute
                    if reached_sl:
                        hit_sl_first = True
            
            if max_p >= sl_price and not reached_sl:
                reached_sl = True
                if time_to_sl is None:
                    time_to_sl = minute
                    
        else:  # BOTTOM
            # For long: drawdown is price going down, gain is price going up
            drawdown_pct = ((entry_price - min_p) / entry_price) * 100
            gain_pct = ((max_p - entry_price) / entry_price) * 100
            
            # Check TP/SL
            if max_p >= tp_price and not reached_tp:
                reached_tp = True
                if time_to_tp is None:
                    time_to_tp = minute
                    if reached_sl:
                        hit_sl_first = True
            
            if min_p <= sl_price and not reached_sl:
                reached_sl = True
                if time_to_sl is None:
                    time_to_sl = minute
        
        # Track maximums
        if drawdown_pct > max_drawdown:
            max_drawdown = drawdown_pct
            time_to_max_drawdown = minute
            
        if gain_pct > max_gain:
            max_gain = gain_pct
            time_to_max_gain = minute
    
    return {
        'status': 'ANALYZED',
        'signal_type': signal_type,
        'entry_price': entry_price,
        'tp_price': tp_price,
        'sl_price': sl_price,
        'max_drawdown_pct': round(max_drawdown, 3),
        'max_gain_pct': round(max_gain, 3),
        'time_to_max_drawdown_min': time_to_max_drawdown,
        'time_to_max_gain_min': time_to_max_gain,
        'reached_tp': reached_tp,
        'reached_sl': reached_sl,
        'time_to_tp_min': time_to_tp,
        'time_to_sl_min': time_to_sl,
        'hit_sl_first': hit_sl_first,
        'hit_sl_before_tp': reached_sl and (not reached_tp or (time_to_sl or 999) < (time_to_tp or 999))
    }

def main():
    # Configuration
    db_path = "storage/trades.db"
    log_dir = "logs"
    
    print("=" * 80)
    print("Signal Take Profit Verification Analysis")
    print("=" * 80)
    
    # Parse signals
    print("\n1. Parsing successful absorption signals...")
    signals = parse_signal_logs(log_dir)
    print(f"Found {len(signals)} successful signals")
    
    if not signals:
        print("No signals found to analyze")
        return
    
    # Analyze each signal
    print("\n2. Analyzing price movements for each signal...")
    results = []
    
    for i, signal in enumerate(signals, 1):
        print(f"\nAnalyzing signal {i}/{len(signals)}: {signal['date']} @ {signal['price']}")
        
        # Get price data
        price_data = get_price_movement(db_path, signal, minutes=90)
        
        # Calculate performance
        performance = calculate_signal_performance(signal, price_data)
        
        # Combine results
        result = {**signal, **performance}
        results.append(result)
        
        # Print summary
        if performance['status'] == 'ANALYZED':
            print(f"  Type: {performance['signal_type']}")
            print(f"  Max Drawdown: {performance['max_drawdown_pct']:.3f}% at {performance['time_to_max_drawdown_min']} min")
            print(f"  Max Gain: {performance['max_gain_pct']:.3f}% at {performance['time_to_max_gain_min']} min")
            print(f"  Reached TP: {performance['reached_tp']} {'at ' + str(performance['time_to_tp_min']) + ' min' if performance['reached_tp'] else ''}")
            print(f"  Reached SL: {performance['reached_sl']} {'at ' + str(performance['time_to_sl_min']) + ' min' if performance['reached_sl'] else ''}")
            if performance['hit_sl_before_tp']:
                print(f"  ⚠️ HIT SL BEFORE TP!")
    
    # Create DataFrame for analysis
    df = pd.DataFrame(results)
    
    # Summary statistics
    print("\n" + "=" * 80)
    print("SUMMARY STATISTICS")
    print("=" * 80)
    
    analyzed_df = df[df['status'] == 'ANALYZED']
    
    if not analyzed_df.empty:
        print(f"\nTotal Signals Analyzed: {len(analyzed_df)}")
        print(f"Signals with data: {len(analyzed_df)}")
        print(f"Signals without data: {len(df) - len(analyzed_df)}")
        
        print("\n--- Take Profit Performance ---")
        tp_reached = analyzed_df['reached_tp'].sum()
        print(f"Reached TP: {tp_reached}/{len(analyzed_df)} ({tp_reached/len(analyzed_df)*100:.1f}%)")
        
        print("\n--- Stop Loss Performance ---")
        sl_reached = analyzed_df['reached_sl'].sum()
        print(f"Reached SL: {sl_reached}/{len(analyzed_df)} ({sl_reached/len(analyzed_df)*100:.1f}%)")
        
        hit_sl_first = analyzed_df['hit_sl_before_tp'].sum()
        print(f"Hit SL before TP: {hit_sl_first}/{len(analyzed_df)} ({hit_sl_first/len(analyzed_df)*100:.1f}%)")
        
        print("\n--- Drawdown Statistics ---")
        print(f"Average Max Drawdown: {analyzed_df['max_drawdown_pct'].mean():.3f}%")
        print(f"Median Max Drawdown: {analyzed_df['max_drawdown_pct'].median():.3f}%")
        print(f"Worst Drawdown: {analyzed_df['max_drawdown_pct'].max():.3f}%")
        
        print("\n--- Gain Statistics ---")
        print(f"Average Max Gain: {analyzed_df['max_gain_pct'].mean():.3f}%")
        print(f"Median Max Gain: {analyzed_df['max_gain_pct'].median():.3f}%")
        print(f"Best Gain: {analyzed_df['max_gain_pct'].max():.3f}%")
        
        # Detailed table
        print("\n" + "=" * 80)
        print("DETAILED SIGNAL PERFORMANCE TABLE")
        print("=" * 80)
        
        # Create summary table
        table_df = analyzed_df[[
            'date', 'signal_type', 'price', 
            'max_drawdown_pct', 'time_to_max_drawdown_min',
            'max_gain_pct', 'time_to_max_gain_min',
            'reached_tp', 'time_to_tp_min',
            'reached_sl', 'time_to_sl_min',
            'hit_sl_before_tp'
        ]].copy()
        
        # Sort by date
        table_df = table_df.sort_values('date')
        
        # Save to CSV
        output_file = 'signal_tp_verification_results.csv'
        table_df.to_csv(output_file, index=False)
        print(f"\nFull results saved to: {output_file}")
        
        # Print table
        print("\nSignal Performance (All Signals, No Omissions):")
        print("-" * 140)
        print(f"{'Date':<20} {'Type':<6} {'Price':<10} {'Max DD%':<10} {'DD Time':<10} {'Max Gain%':<12} {'Gain Time':<12} {'TP?':<5} {'SL?':<5} {'SL First?':<10}")
        print("-" * 140)
        
        for _, row in table_df.iterrows():
            date_str = row['date'].strftime('%Y-%m-%d %H:%M:%S')
            tp_str = '✓' if row['reached_tp'] else '✗'
            sl_str = '✓' if row['reached_sl'] else '✗'
            sl_first_str = '⚠️ YES' if row['hit_sl_before_tp'] else 'No'
            
            print(f"{date_str:<20} {row['signal_type']:<6} {row['price']:<10.2f} "
                  f"{row['max_drawdown_pct']:<10.3f} {str(row['time_to_max_drawdown_min']):<10} "
                  f"{row['max_gain_pct']:<12.3f} {str(row['time_to_max_gain_min']):<12} "
                  f"{tp_str:<5} {sl_str:<5} {sl_first_str:<10}")
        
        # Problem signals summary
        problem_signals = analyzed_df[analyzed_df['hit_sl_before_tp'] == True]
        if not problem_signals.empty:
            print("\n" + "=" * 80)
            print("⚠️  PROBLEM SIGNALS (Hit SL before TP)")
            print("=" * 80)
            print(f"\nTotal: {len(problem_signals)} signals")
            for _, row in problem_signals.iterrows():
                print(f"\n{row['date']} - {row['signal_type']} @ {row['price']:.2f}")
                print(f"  SL hit at: {row['time_to_sl_min']} min")
                print(f"  TP {'reached at ' + str(row['time_to_tp_min']) + ' min' if row['reached_tp'] else 'never reached'}")
                print(f"  Max drawdown: {row['max_drawdown_pct']:.3f}%")

if __name__ == "__main__":
    main()
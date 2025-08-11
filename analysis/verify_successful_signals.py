#!/usr/bin/env python3
"""
Verify ALL successful signals actually reached TP within 90 minutes
Shows max drawdown before TP and max gain for each signal
Outputs HTML table
"""

import sqlite3
import glob
import csv
from datetime import datetime
import os

def get_all_successful_signals(log_dir="logs"):
    """Get ALL successful signals from all detectors"""
    signals = []
    
    # Find all successful signal files from ALL detectors
    patterns = [
        "absorption_successful_*.csv",
        "exhaustion_successful_*.csv", 
        "deltaCVD_successful_*.csv"
    ]
    
    for pattern in patterns:
        files = glob.glob(os.path.join(log_dir, "**", pattern), recursive=True)
        
        for file in files:
            detector_type = pattern.split('_')[0]
            print(f"Reading {detector_type} signals from: {file}")
            
            with open(file, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        # Check which column names exist
                        signal_type = row.get('signalType') or row.get('detectorType', '')
                        
                        signal = {
                            'timestamp': int(row['timestamp']),
                            'detector': detector_type,
                            'signal_type': signal_type,
                            'price': float(row['price']),
                            'confidence': float(row.get('confidence', 0)),
                            'date': datetime.fromtimestamp(int(row['timestamp']) / 1000)
                        }
                        signals.append(signal)
                    except (KeyError, ValueError) as e:
                        print(f"Error parsing row: {e}")
                        continue
    
    return signals

def verify_signal_reached_tp(db_path, signal, tp_percentage=0.007, sl_percentage=0.005):
    """Verify if signal reached TP and track max drawdown/gain"""
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    timestamp = signal['timestamp']
    entry_price = signal['price']
    signal_type = signal['signal_type']
    
    # Calculate TP/SL levels
    if signal_type == 'TOP':
        tp_price = entry_price * (1 - tp_percentage)  # Short TP (price goes down)
        sl_price = entry_price * (1 + sl_percentage)  # Short SL (price goes up)
    else:  # BOTTOM
        tp_price = entry_price * (1 + tp_percentage)  # Long TP (price goes up)
        sl_price = entry_price * (1 - sl_percentage)  # Long SL (price goes down)
    
    # Get minute-by-minute price data for 90 minutes
    end_time = timestamp + (90 * 60 * 1000)
    
    query = """
    SELECT 
        (tradeTime - ?) / 60000 as minute,
        MIN(CAST(price AS REAL)) as min_price,
        MAX(CAST(price AS REAL)) as max_price
    FROM aggregated_trades
    WHERE tradeTime >= ? AND tradeTime <= ?
    GROUP BY minute
    ORDER BY minute
    """
    
    cursor.execute(query, (timestamp, timestamp, end_time))
    minute_data = cursor.fetchall()
    conn.close()
    
    if not minute_data:
        return {
            'reached_tp': False,
            'max_drawdown_pct': None,
            'max_gain_pct': None,
            'time_to_tp': None,
            'time_to_max_drawdown': None,
            'time_to_max_gain': None,
            'no_data': True
        }
    
    # Track performance
    reached_tp = False
    time_to_tp = None
    max_drawdown_pct = 0
    max_gain_pct = 0
    time_to_max_drawdown = 0
    time_to_max_gain = 0
    max_drawdown_before_tp = 0
    
    for minute, min_p, max_p in minute_data:
        if min_p is None or max_p is None:
            continue
            
        minute = int(minute)
        
        if signal_type == 'TOP':
            # Short position
            drawdown = ((max_p - entry_price) / entry_price) * 100  # Price up = loss
            gain = ((entry_price - min_p) / entry_price) * 100      # Price down = profit
            
            # Check if TP reached
            if min_p <= tp_price and not reached_tp:
                reached_tp = True
                time_to_tp = minute
                max_drawdown_before_tp = max_drawdown_pct
        else:  # BOTTOM
            # Long position  
            drawdown = ((entry_price - min_p) / entry_price) * 100  # Price down = loss
            gain = ((max_p - entry_price) / entry_price) * 100      # Price up = profit
            
            # Check if TP reached
            if max_p >= tp_price and not reached_tp:
                reached_tp = True
                time_to_tp = minute
                max_drawdown_before_tp = max_drawdown_pct
        
        # Track maximums
        if drawdown > max_drawdown_pct:
            max_drawdown_pct = drawdown
            time_to_max_drawdown = minute
            
        if gain > max_gain_pct:
            max_gain_pct = gain
            time_to_max_gain = minute
    
    return {
        'reached_tp': reached_tp,
        'max_drawdown_pct': round(max_drawdown_pct, 3),
        'max_drawdown_before_tp_pct': round(max_drawdown_before_tp, 3) if reached_tp else None,
        'max_gain_pct': round(max_gain_pct, 3),
        'time_to_tp': time_to_tp,
        'time_to_max_drawdown': time_to_max_drawdown,
        'time_to_max_gain': time_to_max_gain,
        'no_data': False
    }

def generate_html_table(results):
    """Generate HTML table with results"""
    
    html = """
<!DOCTYPE html>
<html>
<head>
    <title>Successful Signals TP Verification</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .summary { 
            background: #f0f0f0; 
            padding: 15px; 
            margin: 20px 0;
            border-radius: 5px;
        }
        .critical { color: red; font-weight: bold; }
        .success { color: green; font-weight: bold; }
        table { 
            border-collapse: collapse; 
            width: 100%;
            margin: 20px 0;
        }
        th { 
            background: #4CAF50; 
            color: white; 
            padding: 12px;
            text-align: left;
            position: sticky;
            top: 0;
        }
        td { 
            padding: 8px; 
            border-bottom: 1px solid #ddd;
        }
        tr:hover { background: #f5f5f5; }
        .not-reached { background: #ffcccc; }
        .no-data { background: #ffffcc; }
        .high-drawdown { color: red; font-weight: bold; }
    </style>
</head>
<body>
    <h1>Successful Signals TP Verification Report</h1>
"""
    
    # Summary statistics
    total = len(results)
    reached_tp = sum(1 for r in results if r['reached_tp'])
    no_data = sum(1 for r in results if r['no_data'])
    failed_tp = total - reached_tp - no_data
    
    html += f"""
    <div class="summary">
        <h2>Summary</h2>
        <p>Total Successful Signals Analyzed: <strong>{total}</strong></p>
        <p class="{'success' if reached_tp == total - no_data else 'critical'}">
            Reached TP within 90 minutes: <strong>{reached_tp}/{total - no_data}</strong> 
            ({reached_tp/(total-no_data)*100:.1f}% of signals with data)
        </p>
        <p>Signals without price data: <strong>{no_data}</strong></p>
"""
    
    if failed_tp > 0:
        html += f"""
        <p class="critical">⚠️ CRITICAL: {failed_tp} signals marked as successful did NOT reach TP!</p>
"""
    
    html += """
    </div>
    
    <h2>Detailed Signal Analysis</h2>
    <table>
        <thead>
            <tr>
                <th>Date/Time</th>
                <th>Detector</th>
                <th>Type</th>
                <th>Entry Price</th>
                <th>Reached TP?</th>
                <th>Time to TP (min)</th>
                <th>Max Drawdown Before TP (%)</th>
                <th>Max Drawdown Overall (%)</th>
                <th>Max Gain (%)</th>
                <th>Confidence</th>
            </tr>
        </thead>
        <tbody>
"""
    
    # Sort by date
    results.sort(key=lambda x: x['date'])
    
    for r in results:
        row_class = ''
        if r['no_data']:
            row_class = 'no-data'
        elif not r['reached_tp']:
            row_class = 'not-reached'
            
        drawdown_class = 'high-drawdown' if r['max_drawdown_pct'] and r['max_drawdown_pct'] > 0.3 else ''
        
        html += f"""
            <tr class="{row_class}">
                <td>{r['date'].strftime('%Y-%m-%d %H:%M:%S')}</td>
                <td>{r['detector']}</td>
                <td>{r['signal_type']}</td>
                <td>{r['price']:.2f}</td>
                <td>{'✅ Yes' if r['reached_tp'] else '❌ NO' if not r['no_data'] else '⚠️ No Data'}</td>
                <td>{r['time_to_tp'] if r['time_to_tp'] else '-'}</td>
                <td class="{drawdown_class}">{r.get('max_drawdown_before_tp_pct', '-') if r.get('max_drawdown_before_tp_pct') is not None else '-'}</td>
                <td class="{drawdown_class}">{r['max_drawdown_pct'] if r['max_drawdown_pct'] is not None else '-'}</td>
                <td>{r['max_gain_pct'] if r['max_gain_pct'] is not None else '-'}</td>
                <td>{r['confidence']:.4f}</td>
            </tr>
"""
    
    html += """
        </tbody>
    </table>
    
    <div class="summary">
        <h3>Key Findings</h3>
"""
    
    # Calculate averages for signals that reached TP
    tp_signals = [r for r in results if r['reached_tp']]
    if tp_signals:
        avg_time_to_tp = sum(r['time_to_tp'] for r in tp_signals) / len(tp_signals)
        avg_drawdown_before_tp = sum(r.get('max_drawdown_before_tp_pct', 0) for r in tp_signals if r.get('max_drawdown_before_tp_pct') is not None) / len(tp_signals)
        avg_max_gain = sum(r['max_gain_pct'] for r in tp_signals) / len(tp_signals)
        
        html += f"""
        <p><strong>For signals that reached TP:</strong></p>
        <ul>
            <li>Average time to TP: {avg_time_to_tp:.1f} minutes</li>
            <li>Average max drawdown before TP: {avg_drawdown_before_tp:.3f}%</li>
            <li>Average max gain: {avg_max_gain:.3f}%</li>
        </ul>
"""
    
    # List problematic signals
    failed_signals = [r for r in results if not r['reached_tp'] and not r['no_data']]
    if failed_signals:
        html += f"""
        <p class="critical"><strong>Signals that FAILED to reach TP despite being marked successful:</strong></p>
        <ul>
"""
        for r in failed_signals[:10]:  # Show first 10
            html += f"""
            <li>{r['date'].strftime('%H:%M:%S')} - {r['detector']} {r['signal_type']} @ {r['price']:.2f} 
                (max gain: {r['max_gain_pct']:.3f}%)</li>
"""
        if len(failed_signals) > 10:
            html += f"<li>... and {len(failed_signals) - 10} more</li>"
        html += "</ul>"
    
    html += """
    </div>
</body>
</html>
"""
    
    return html

def main():
    db_path = "storage/trades.db"
    
    print("=" * 80)
    print("VERIFYING ALL SUCCESSFUL SIGNALS REACHED TP")
    print("=" * 80)
    
    # Get all successful signals
    print("\n1. Loading all successful signals from all detectors...")
    signals = get_all_successful_signals()
    print(f"Found {len(signals)} total successful signals")
    
    # Count by detector
    by_detector = {}
    for s in signals:
        by_detector[s['detector']] = by_detector.get(s['detector'], 0) + 1
    
    for detector, count in by_detector.items():
        print(f"  - {detector}: {count} signals")
    
    # Verify each signal
    print("\n2. Verifying each signal reached TP within 90 minutes...")
    results = []
    
    for i, signal in enumerate(signals, 1):
        if i % 50 == 0:
            print(f"  Processing signal {i}/{len(signals)}...")
            
        verification = verify_signal_reached_tp(db_path, signal)
        result = {**signal, **verification}
        results.append(result)
    
    # Generate HTML report
    print("\n3. Generating HTML report...")
    html_content = generate_html_table(results)
    
    output_file = 'successful_signals_verification.html'
    with open(output_file, 'w') as f:
        f.write(html_content)
    
    print(f"\n✅ HTML report saved to: {output_file}")
    
    # Print summary
    reached_tp = sum(1 for r in results if r['reached_tp'])
    no_data = sum(1 for r in results if r['no_data'])
    failed = len(results) - reached_tp - no_data
    
    print(f"\n" + "=" * 80)
    print("SUMMARY:")
    print("=" * 80)
    print(f"Total signals: {len(results)}")
    print(f"Reached TP: {reached_tp} ({reached_tp/len(results)*100:.1f}%)")
    print(f"No data: {no_data}")
    
    if failed > 0:
        print(f"\n⚠️ CRITICAL: {failed} signals marked as 'successful' did NOT reach TP!")
        print("These signals should not be in the successful logs!")

if __name__ == "__main__":
    main()
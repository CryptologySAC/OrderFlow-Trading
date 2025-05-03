import sqlite3
import pandas as pd
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, List, Dict
import uuid
import multiprocessing as mp
from multiprocessing.managers import SyncManager
import logging
import statistics

# Set up process-safe logging
log_file = 'signal_engine.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(processName)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler(log_file)]
)
logger = logging.getLogger(__name__)

@dataclass
class Signal:
    type: str  # 'buy' or 'sell'
    price: float
    timestamp: datetime
    status: str  # 'pending', 'active', 'expired', 'deactivated'
    signal_id: str

@dataclass
class SignalConfig:
    min_order_size: float = 75 # Minimum LTC per order
    absorption_ratio: float = 10.0  # Buy/sell volume ratio
    min_trades: int = 10  # Minimum trades in window
    volume_multiplier: float = 2.0  # Total volume vs baseline
    validation_volume_multiplier: float = 1.5  # Validation volume vs baseline
    window_seconds: float = 1.0  # Window for aggregation
    baseline_window_seconds: float = 60.0  # Baseline volume window
    validation_seconds: float = 5.0
    expiration_minutes: float = 5.0
    cooldown_seconds: float = 10.0  # Cooldown between signals
    price_tolerance: float = 0.005  # ±0.5% price stability
    symbol: str = 'LTCUSDT'
    max_signals: int = 1000  # Cap for testing

def process_chunk(config: SignalConfig, db_path: str, chunk: pd.DataFrame) -> List[Dict]:
    """Process a chunk of trades in a separate process."""
    signals: List[Dict] = []
    trade_buffer: List[Dict] = []  # 1-second window
    validation_buffer: List[Dict] = []  # 5-second window
    baseline_buffer: List[Dict] = []  # 60-second window
    current_signal: Optional[Signal] = None
    last_signal_time: Optional[datetime] = None
    last_signal_direction: Optional[str] = None
    signal_count = 0

    # Connect to database
    conn = sqlite3.connect(db_path)
    try:
        for _, trade in chunk.iterrows():
            # Handle tradeTime
            trade_time_ms = trade['tradeTime']
            if isinstance(trade_time_ms, pd.Timestamp):
                trade_time_ms = int(trade_time_ms.timestamp() * 1000)
            trade_time = datetime.fromtimestamp(trade_time_ms / 1000.0)
            trade_dict = trade.to_dict()
            trade_dict['timestamp'] = trade_time
            trade_buffer.append(trade_dict)
            validation_buffer.append(trade_dict)
            baseline_buffer.append(trade_dict)

            # Clean buffers
            trade_buffer = [
                t for t in trade_buffer
                if (trade_time - t['timestamp']).total_seconds() <= config.window_seconds
            ]
            validation_buffer = [
                t for t in validation_buffer
                if (trade_time - t['timestamp']).total_seconds() <= config.validation_seconds
            ]
            baseline_buffer = [
                t for t in baseline_buffer
                if (trade_time - t['timestamp']).total_seconds() <= config.baseline_window_seconds
            ]

            # Check cooldown
            if last_signal_time and (trade_time - last_signal_time).total_seconds() < config.cooldown_seconds:
                continue

            # Calculate baseline volume (per second)
            baseline_volume = sum(t['quantity'] for t in baseline_buffer) if baseline_buffer else 0
            baseline_avg_volume = baseline_volume / config.baseline_window_seconds if baseline_volume else 0

            # Aggregate volumes
            buy_volume = sum(t['quantity'] for t in trade_buffer if t['isBuyerMaker'] == 0)
            sell_volume = sum(t['quantity'] for t in trade_buffer if t['isBuyerMaker'] == 1)
            total_volume = buy_volume + sell_volume
            max_quantity = max(t['quantity'] for t in trade_buffer) if trade_buffer else 0

            # Check price stability
            prices = [t['price'] for t in trade_buffer]
            price_stable = False
            median_price = 0
            if prices:
                median_price = statistics.median(prices)
                price_stable = all(
                    abs(p - median_price) / median_price <= config.price_tolerance
                    for p in prices
                )

            # Log only for potential signals
            if len(trade_buffer) >= config.min_trades:
                logger.debug(
                    f"Trade time: {trade_time}, Trades: {len(trade_buffer)}, "
                    f"Buy volume: {buy_volume:.4f}, Sell volume: {sell_volume:.4f}, "
                    f"Total volume: {total_volume:.4f}, Max quantity: {max_quantity:.4f}, "
                    f"Baseline avg volume: {baseline_avg_volume:.4f}, Price stable: {price_stable}"
                )

            # Check absorption at high-volume point
            if (len(trade_buffer) >= config.min_trades and
                max_quantity >= config.min_order_size and
                total_volume >= config.volume_multiplier * baseline_avg_volume and
                price_stable and
                signal_count < config.max_signals):
                buy_ratio = buy_volume / (sell_volume + 1e-10)
                sell_ratio = sell_volume / (buy_volume + 1e-10)
                signal_type = None
                if buy_ratio >= config.absorption_ratio:
                    signal_type = 'buy'
                    logger.info(f"Buy signal candidate: Ratio {buy_ratio:.2f}, Volume {total_volume:.4f}")
                elif sell_ratio >= config.absorption_ratio:
                    signal_type = 'sell'
                    logger.info(f"Sell signal candidate: Ratio {sell_ratio:.2f}, Volume {total_volume:.4f}")

                if signal_type:
                    price = median_price
                    signal_id = str(uuid.uuid4())

                    # Check existing signal
                    if current_signal and current_signal.status in ['pending', 'active']:
                        if current_signal.type == signal_type:
                            continue
                        if current_signal.status == 'active':
                            current_signal.status = 'deactivated'
                            signals.append({
                                'signal_id': current_signal.signal_id,
                                'type': current_signal.type,
                                'price': current_signal.price,
                                'timestamp': current_signal.timestamp,
                                'status': 'deactivated (opposite_signal)',
                                'update_timestamp': datetime.now()
                            })
                            logger.info(f"Signal {current_signal.signal_id} deactivated: opposite_signal")
                            current_signal = None
                            last_signal_direction = None

                    # Generate signal
                    current_signal = Signal(
                        type=signal_type,
                        price=price,
                        timestamp=trade_time,
                        status='pending',
                        signal_id=signal_id
                    )
                    signals.append({
                        'signal_id': signal_id,
                        'type': signal_type,
                        'price': price,
                        'timestamp': trade_time,
                        'status': 'pending',
                        'update_timestamp': datetime.now()
                    })
                    logger.info(f"Generated {signal_type} signal: ID {signal_id}, Price {price}")
                    signal_count += 1
                    last_signal_time = trade_time
                    last_signal_direction = signal_type

                    # Validate signal
                    val_buy_volume = sum(t['quantity'] for t in validation_buffer if t['isBuyerMaker'] == 0)
                    val_sell_volume = sum(t['quantity'] for t in validation_buffer if t['isBuyerMaker'] == 1)
                    val_total_volume = val_buy_volume + val_sell_volume
                    val_prices = [t['price'] for t in validation_buffer]
                    val_price_stable = False
                    if val_prices:
                        val_median_price = statistics.median(val_prices)
                        val_price_stable = all(
                            abs(p - val_median_price) / val_median_price <= config.price_tolerance
                            for p in val_prices
                        )

                    validated = False
                    if (len(validation_buffer) >= config.min_trades and
                        val_total_volume >= config.validation_volume_multiplier * baseline_avg_volume and
                        val_price_stable):
                        if signal_type == 'buy':
                            validated = val_buy_volume / (val_sell_volume + 1e-10) >= config.absorption_ratio
                        elif signal_type == 'sell':
                            validated = val_sell_volume / (val_buy_volume + 1e-10) >= config.absorption_ratio

                    if validated:
                        current_signal.status = 'active'
                        for signal in signals:
                            if signal['signal_id'] == current_signal.signal_id:
                                signal['status'] = 'active'
                                signal['update_timestamp'] = datetime.now()
                        logger.info(f"Signal {current_signal.signal_id} validated as active")
                    else:
                        current_signal.status = 'deactivated'
                        for signal in signals:
                            if signal['signal_id'] == current_signal.signal_id:
                                signal['status'] = 'deactivated'
                                signal['update_timestamp'] = datetime.now()
                        logger.info(f"Signal {current_signal.signal_id} invalidated: "
                                    f"Trades {len(validation_buffer)}, "
                                    f"Volume {val_total_volume:.4f}, Stable {val_price_stable}")
                        current_signal = None
                        last_signal_direction = None

            # Manage signal expiration
            if current_signal:
                elapsed = (trade_time - current_signal.timestamp).total_seconds() / 60
                if current_signal.status == 'pending' and elapsed > config.expiration_minutes:
                    current_signal.status = 'expired'
                    for signal in signals:
                        if signal['signal_id'] == current_signal.signal_id:
                            signal['status'] = 'expired'
                            signal['update_timestamp'] = datetime.now()
                    logger.info(f"Signal {current_signal.signal_id} expired")
                    current_signal = None
                    last_signal_direction = None

    finally:
        conn.close()

    logger.info(f"Processed chunk with {len(chunk)} trades, generated {len(signals)} signals")
    return signals

class SignalEngine:
    def __init__(self, config: SignalConfig, db_path: Optional[str] = None):
        self.config = config
        self.db_path = db_path
        self.signals: List[Dict] = []

    def initialize(self):
        """Initialize database (for live mode or sequential runs)."""
        if self.db_path:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS aggregated_trades (
                        aggregatedTradeId INTEGER PRIMARY KEY,
                        firstTradeId INTEGER,
                        lastTradeId INTEGER,
                        tradeTime INTEGER,
                        symbol TEXT,
                        price REAL,
                        quantity REAL,
                        isBuyerMaker INTEGER,
                        orderType TEXT,
                        bestMatch INTEGER
                    )
                ''')

    def run_backtest(self, use_multiprocessing: bool = True):
        """Run backtest with optional multiprocessing."""
        # Load trades
        with sqlite3.connect(self.db_path) as conn:
            query = f"SELECT * FROM aggregated_trades WHERE symbol = ? ORDER BY tradeTime"
            df = pd.read_sql_query(query, conn, params=(self.config.symbol,), dtype={'tradeTime': 'int64'})
        if df.empty:
            logger.error("No trades found in database")
            return

        # Ensure tradeTime is int64
        df['tradeTime'] = df['tradeTime'].astype('int64')
        logger.info(f"Loaded {len(df)} trades for backtesting")

        if use_multiprocessing:
            # Split into chunks
            num_processes = mp.cpu_count()
            chunks = [df[i::num_processes] for i in range(num_processes)]
            chunks = [chunk for chunk in chunks if not chunk.empty]
            logger.info(f"Split into {len(chunks)} chunks for {num_processes} processes")

            # Process chunks in parallel
            with mp.Pool(processes=num_processes) as pool:
                manager = SyncManager()
                manager.start()
                shared_signals = manager.list()

                # Run chunks
                chunk_results = pool.starmap(
                    process_chunk,
                    [(self.config, self.db_path, chunk) for chunk in chunks]
                )

                # Collect signals
                for signals in chunk_results:
                    shared_signals.extend(signals)

                # Sort signals
                self.signals = list(shared_signals)
                self.signals.sort(key=lambda x: x['timestamp'])
                logger.info(f"Generated {len(self.signals)} signals")
        else:
            # Sequential processing
            self.signals = process_chunk(self.config, self.db_path, df)
            logger.info(f"Generated {len(self.signals)} signals")

        # Save signals
        pd.DataFrame(self.signals).to_csv('route_b_signals.csv', index=False)
        logger.info("Signals saved to route_b_signals.csv")

    def run_live(self):
        """Run live signal generation (placeholder)."""
        pass

    def stop(self):
        """Clean up resources."""
        pass

if __name__ == '__main__':
    config = SignalConfig()
    engine = SignalEngine(config, db_path='../trades.db')
    engine.initialize()
    try:
        engine.run_backtest(use_multiprocessing=False)
    finally:
        engine.stop()
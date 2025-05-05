import unittest
import pandas as pd
from datetime import datetime

THRESHOLD = 0.01  # 1% price drop for pairs

class SwingDetector:
    def __init__(self):
        """Initialize the swing detector with empty state."""
        self.current_high = None  # (index, time, price)
        self.previous_high = None  # (index, time, price)
        self.current_low = None   # (index, time, price)
        self.previous_low = None  # (index, time, price)
        self.last_type = None     # 'high', 'low', or None
        self.swings = []          # List of (index, type, time, price)
        self.pairs = []           # List of (high_idx, high_time, high_price, low_idx, low_time, low_price, price_drop)

    def process_trade(self, index, time, price):
        """Process a single trade and update swing points."""
        # Initial state: set both current high and low to the first trade
        if self.current_high is None and self.current_low is None:
            self.current_high = (index, time, price)
            self.current_low = (index, time, price)
            return

        # Update current high and low based on the price
        if price >= self.current_high[2]:
            self.current_high = (index, time, price)
        if price <= self.current_low[2]:
            self.current_low = (index, time, price)

        # Determine if a swing point is confirmed
        if self.last_type is None or self.last_type == 'low':
            # Looking for a swing high
            price_drop = (self.current_high[2] - price) / self.current_high[2]
            if price_drop > 0:
                # Confirm the swing high
                if not self.swings or self.current_high[2] >= self.previous_low[2] * (1 + THRESHOLD):
                    self.swings.append((self.current_high[0], 'high', self.current_high[1], self.current_high[2]))
                    self.previous_high = self.current_high
                    self.last_type = 'high'
                # Reset for finding the next low
                self.current_low = (index, time, price)
                self.current_high = (index, time, price)
        else:  # last_type == 'high'
            # Looking for a swing low
            price_rise = (price - self.current_low[2]) / self.current_low[2]
            if price_rise > 0:
                # Confirm the swing low
                price_drop_from_high = (self.previous_high[2] - self.current_low[2]) / self.previous_high[2]
                if price_drop_from_high >= THRESHOLD:
                    self.swings.append((self.current_low[0], 'low', self.current_low[1], self.current_low[2]))
                    self.previous_low = self.current_low
                    self.last_type = 'low'
                    # Form a pair
                    self.pairs.append({
                        'high_time': self.previous_high[1],
                        'high_price': self.previous_high[2],
                        'low_time': self.current_low[1],
                        'low_price': self.current_low[2],
                        'price_drop_percent': price_drop_from_high * 100
                    })
                # Reset for finding the next high
                self.current_high = (index, time, price)
                self.current_low = (index, time, price)

    def get_pairs(self):
        """Return the detected swing high-low pairs."""
        return pd.DataFrame(self.pairs)


class TestSwingDetector(unittest.TestCase):
    def setUp(self):
        """Set up a SwingDetector instance before each test."""
        self.detector = SwingDetector()

    def test_initial_state(self):
        """Test the initial state with a single trade."""
        self.detector.process_trade(0, datetime(2025, 1, 27), 100.0)
        self.assertIsNotNone(self.detector.current_high)
        self.assertIsNotNone(self.detector.current_low)
        self.assertEqual(self.detector.current_high, (0, datetime(2025, 1, 27), 100.0))
        self.assertEqual(self.detector.current_low, (0, datetime(2025, 1, 27), 100.0))
        self.assertEqual(len(self.detector.swings), 0)
        self.assertEqual(len(self.detector.pairs), 0)

    def test_simple_swing_high_low(self):
        """Test a simple sequence: low to high to low with sufficient drop."""
        trades = [
            (0, datetime(2025, 1, 27, 10, 0), 100.0),  # Initial price
            (1, datetime(2025, 1, 27, 10, 1), 101.5),  # Rise to swing high (>1% above 100)
            (2, datetime(2025, 1, 27, 10, 2), 100.4),  # Drop to confirm swing high
            (3, datetime(2025, 1, 27, 10, 3), 99.0),   # Drop further to swing low (>1% below 101.5)
            (4, datetime(2025, 1, 27, 10, 4), 100.0)   # Rise to confirm swing low
        ]

        for idx, time, price in trades:
            self.detector.process_trade(idx, time, price)

        # Verify swings
        self.assertEqual(len(self.detector.swings), 2)
        self.assertEqual(self.detector.swings[0], (1, 'high', datetime(2025, 1, 27, 10, 1), 101.5))  # Swing high
        self.assertEqual(self.detector.swings[1], (3, 'low', datetime(2025, 1, 27, 10, 3), 99.0))    # Swing low

        # Verify pairs
        pairs_df = self.detector.get_pairs()
        self.assertEqual(len(pairs_df), 1)
        pair = pairs_df.iloc[0]
        self.assertEqual(pair['high_price'], 101.5)
        self.assertEqual(pair['low_price'], 99.0)
        self.assertAlmostEqual(pair['price_drop_percent'], (101.5 - 99.0) / 101.5 * 100)

    def test_multiple_highs_without_low(self):
        """Test that multiple highs without a low update the current high."""
        trades = [
            (0, datetime(2025, 1, 27, 10, 0), 100.0),  # Initial price
            (1, datetime(2025, 1, 27, 10, 1), 101.0),  # Rise
            (2, datetime(2025, 1, 27, 10, 2), 102.0),  # Higher
            (3, datetime(2025, 1, 27, 10, 3), 103.0),  # Highest
            (4, datetime(2025, 1, 27, 10, 4), 101.5)   # Drop to confirm swing high
        ]

        for idx, time, price in trades:
            self.detector.process_trade(idx, time, price)

        # Verify swings (only one high should be confirmed)
        self.assertEqual(len(self.detector.swings), 1)
        self.assertEqual(self.detector.swings[0], (3, 'high', datetime(2025, 1, 27, 10, 3), 103.0))  # Swing high
        self.assertEqual(self.detector.current_low[2], 101.5)  # Current low updated

    def test_multiple_lows_without_high(self):
        """Test that multiple lows without a high update the current low."""
        trades = [
            (0, datetime(2025, 1, 27, 10, 0), 100.0),  # Initial price
            (1, datetime(2025, 1, 27, 10, 1), 101.5),  # Rise to swing high
            (2, datetime(2025, 1, 27, 10, 2), 100.0),  # Drop to confirm swing high
            (3, datetime(2025, 1, 27, 10, 3), 99.0),   # Lower
            (4, datetime(2025, 1, 27, 10, 4), 98.0),   # Lowest
            (5, datetime(2025, 1, 27, 10, 5), 99.0)    # Rise to confirm swing low
        ]

        for idx, time, price in trades:
            self.detector.process_trade(idx, time, price)

        # Verify swings
        self.assertEqual(len(self.detector.swings), 2)
        self.assertEqual(self.detector.swings[0], (1, 'high', datetime(2025, 1, 27, 10, 1), 101.5))  # Swing high
        self.assertEqual(self.detector.swings[1], (4, 'low', datetime(2025, 1, 27, 10, 4), 98.0))    # Swing low

        # Verify pairs
        pairs_df = self.detector.get_pairs()
        self.assertEqual(len(pairs_df), 1)
        pair = pairs_df.iloc[0]
        self.assertEqual(pair['high_price'], 101.5)
        self.assertEqual(pair['low_price'], 98.0)
        self.assertAlmostEqual(pair['price_drop_percent'], (101.5 - 98.0) / 101.5 * 100)

    def test_insufficient_drop(self):
        """Test a sequence where the drop is less than 1%, so no pair is formed."""
        trades = [
            (0, datetime(2025, 1, 27, 10, 0), 100.0),  # Initial price
            (1, datetime(2025, 1, 27, 10, 1), 101.5),  # Rise to swing high
            (2, datetime(2025, 1, 27, 10, 2), 100.6),  # Drop (<1%)
            (3, datetime(2025, 1, 27, 10, 3), 101.0)   # Rise
        ]

        for idx, time, price in trades:
            self.detector.process_trade(idx, time, price)

        # Verify swings
        self.assertEqual(len(self.detector.swings), 1)
        self.assertEqual(self.detector.swings[0], (1, 'high', datetime(2025, 1, 27, 10, 1), 101.5))  # Swing high

        # Verify pairs (no pair formed due to insufficient drop)
        pairs_df = self.detector.get_pairs()
        self.assertEqual(len(pairs_df), 0)

    def test_flat_price_sequence(self):
        """Test a sequence with flat prices, expecting minimal swings."""
        trades = [
            (0, datetime(2025, 1, 27, 10, 0), 100.0),
            (1, datetime(2025, 1, 27, 10, 1), 100.0),
            (2, datetime(2025, 1, 27, 10, 2), 100.0),
            (3, datetime(2025, 1, 27, 10, 3), 99.0),
            (4, datetime(2025, 1, 27, 10, 4), 100.0)
        ]

        for idx, time, price in trades:
            self.detector.process_trade(idx, time, price)

        # Verify swings
        self.assertEqual(len(self.detector.swings), 2)
        self.assertEqual(self.detector.swings[0], (0, 'high', datetime(2025, 1, 27, 10, 0), 100.0))  # Swing high (initial)
        self.assertEqual(self.detector.swings[1], (3, 'low', datetime(2025, 1, 27, 10, 3), 99.0))    # Swing low

        # Verify pairs (no pair due to drop <1%)
        pairs_df = self.detector.get_pairs()
        self.assertEqual(len(pairs_df), 0)

if __name__ == "__main__":
    unittest.main()
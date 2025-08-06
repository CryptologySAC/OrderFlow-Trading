# FastPriorityQueue API Documentation

A fast, heap-based priority queue implementation for JavaScript.

## 📦 Installation

```bash
npm install fastpriorityqueue
# or
yarn add fastpriorityqueue
```

## 🎯 Basic Usage

### Creating a Priority Queue

```typescript
import FastPriorityQueue from "fastpriorityqueue";

// Min-heap (default): smaller values have higher priority
const minQueue = new FastPriorityQueue<number>();
minQueue.add(5);
minQueue.add(3);
minQueue.add(8);
console.log(minQueue.poll()); // 3 (smallest value)

// Max-heap: larger values have higher priority
const maxQueue = new FastPriorityQueue<number>((a, b) => a > b);
maxQueue.add(5);
maxQueue.add(3);
maxQueue.add(8);
console.log(maxQueue.poll()); // 8 (largest value)

// Custom comparator for objects
const taskQueue = new FastPriorityQueue<Task>(
    (a, b) => a.priority > b.priority
);
```

### Working with Objects

```typescript
interface Task {
    id: string;
    priority: number;
    description: string;
}

// Higher priority values are processed first
const taskQueue = new FastPriorityQueue<Task>(
    (a, b) => a.priority > b.priority
);

taskQueue.add({ id: "1", priority: 5, description: "Low priority task" });
taskQueue.add({ id: "2", priority: 10, description: "High priority task" });
taskQueue.add({ id: "3", priority: 7, description: "Medium priority task" });

while (!taskQueue.isEmpty()) {
    const task = taskQueue.poll();
    console.log(`Processing: ${task.description} (Priority: ${task.priority})`);
}
// Output:
// Processing: High priority task (Priority: 10)
// Processing: Medium priority task (Priority: 7)
// Processing: Low priority task (Priority: 5)
```

## 📖 Core API

### Constructor

```typescript
// Default min-heap comparator
new FastPriorityQueue<T>()

// Custom comparator function
new FastPriorityQueue<T>(comparator: (a: T, b: T) => boolean)

// With initial capacity
new FastPriorityQueue<T>(comparator?: (a: T, b: T) => boolean, initialCapacity?: number)
```

### Methods

```typescript
interface FastPriorityQueue<T> {
    // Add element to queue
    add(element: T): void;

    // Remove and return highest priority element
    poll(): T | undefined;

    // View highest priority element without removing it
    peek(): T | undefined;

    // Check if queue is empty
    isEmpty(): boolean;

    // Get number of elements in queue
    size(): number;

    // Remove all elements
    clear(): void;

    // Create array copy of queue elements (not in priority order)
    toArray(): T[];

    // Create new queue with same elements and comparator
    clone(): FastPriorityQueue<T>;

    // Remove specific element from queue
    remove(element: T): boolean;

    // Check if element exists in queue
    has(element: T): boolean;

    // Optimize internal structure (useful after many operations)
    heapify(): void;

    // Replace top element with new element (efficient)
    replaceTop(element: T): T | undefined;

    // Iterate over elements (not in priority order)
    forEach(callback: (element: T, index: number) => void): void;
}
```

### Comparator Functions

```typescript
// Min-heap (default): smallest values first
const minHeap = new FastPriorityQueue<number>();

// Max-heap: largest values first
const maxHeap = new FastPriorityQueue<number>((a, b) => a > b);

// Custom object comparison
interface PriorityItem {
    value: string;
    priority: number;
    timestamp: number;
}

// Higher priority first, then earlier timestamp for ties
const customQueue = new FastPriorityQueue<PriorityItem>((a, b) => {
    if (a.priority !== b.priority) {
        return a.priority > b.priority;
    }
    return a.timestamp < b.timestamp; // Earlier timestamp wins ties
});
```

## 🔧 Advanced Usage

### Efficient Top Replacement

```typescript
// Instead of poll() then add() - use replaceTop() for better performance
const queue = new FastPriorityQueue<number>();
queue.add(1);
queue.add(2);
queue.add(3);

// Replace top element (1) with new value (5)
const oldTop = queue.replaceTop(5); // Returns 1
console.log(queue.peek()); // 2 (new top after replacement)
```

### Bulk Operations

```typescript
// Adding multiple elements
const elements = [5, 2, 8, 1, 9, 3];
const queue = new FastPriorityQueue<number>();

elements.forEach((el) => queue.add(el));

// Or using heapify for better performance with many elements
const queue2 = new FastPriorityQueue<number>();
elements.forEach((el) => queue2.add(el));
queue2.heapify(); // Optimize structure
```

### Queue Monitoring

```typescript
class MonitoredPriorityQueue<T> extends FastPriorityQueue<T> {
    private operationCount = 0;

    add(element: T): void {
        super.add(element);
        this.operationCount++;

        // Optimize periodically
        if (this.operationCount % 1000 === 0) {
            this.heapify();
        }
    }

    poll(): T | undefined {
        this.operationCount++;
        return super.poll();
    }

    getOperationCount(): number {
        return this.operationCount;
    }
}
```

## 🎯 Usage in OrderFlow Trading

### Signal Priority Queue

```typescript
interface SignalCandidate {
    id: string;
    detectorType: string;
    confidence: number;
    timestamp: number;
    priority: number;
    symbol: string;
    side: "buy" | "sell";
}

export class SignalPriorityQueue {
    private queue: FastPriorityQueue<SignalCandidate>;

    constructor() {
        // Higher priority and higher confidence signals processed first
        this.queue = new FastPriorityQueue<SignalCandidate>((a, b) => {
            // First compare by priority
            if (a.priority !== b.priority) {
                return a.priority > b.priority;
            }

            // Then by confidence
            if (a.confidence !== b.confidence) {
                return a.confidence > b.confidence;
            }

            // Finally by timestamp (earlier wins)
            return a.timestamp < b.timestamp;
        });
    }

    public addSignal(signal: SignalCandidate): void {
        // Calculate dynamic priority based on market conditions
        const priority = this.calculatePriority(signal);

        this.queue.add({
            ...signal,
            priority,
        });
    }

    public getNextSignal(): SignalCandidate | undefined {
        return this.queue.poll();
    }

    public peekNextSignal(): SignalCandidate | undefined {
        return this.queue.peek();
    }

    public hasSignals(): boolean {
        return !this.queue.isEmpty();
    }

    public getQueueSize(): number {
        return this.queue.size();
    }

    public clearQueue(): void {
        this.queue.clear();
    }

    private calculatePriority(signal: SignalCandidate): number {
        let priority = 0;

        // Base priority by detector type
        const detectorPriorities = {
            absorption: 10,
            exhaustion: 9,
            deltacvd: 8,
            accumulation: 7,
            distribution: 7,
        };

        priority += detectorPriorities[signal.detectorType] || 5;

        // Boost priority for high confidence signals
        if (signal.confidence > 1.5) {
            priority += 5;
        } else if (signal.confidence > 1.0) {
            priority += 2;
        }

        // Time-based priority decay (newer signals preferred)
        const ageMs = Date.now() - signal.timestamp;
        const ageMinutes = ageMs / (1000 * 60);
        const agePenalty = Math.min(ageMinutes * 0.1, 3); // Max 3 point penalty

        return Math.max(priority - agePenalty, 1);
    }

    // Get queue statistics
    public getQueueStats(): QueueStats {
        const signals = this.queue.toArray();

        return {
            totalSignals: signals.length,
            avgConfidence:
                signals.reduce((sum, s) => sum + s.confidence, 0) /
                signals.length,
            avgPriority:
                signals.reduce((sum, s) => sum + s.priority, 0) /
                signals.length,
            detectorBreakdown: this.getDetectorBreakdown(signals),
            oldestSignalAge:
                signals.length > 0
                    ? Date.now() - Math.min(...signals.map((s) => s.timestamp))
                    : 0,
        };
    }

    private getDetectorBreakdown(
        signals: SignalCandidate[]
    ): Record<string, number> {
        return signals.reduce(
            (breakdown, signal) => {
                breakdown[signal.detectorType] =
                    (breakdown[signal.detectorType] || 0) + 1;
                return breakdown;
            },
            {} as Record<string, number>
        );
    }
}
```

### Order Processing Queue

```typescript
interface TradeOrder {
    id: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    urgency: number; // 1-10 scale
    timestamp: number;
}

export class OrderProcessingQueue {
    private queue: FastPriorityQueue<TradeOrder>;
    private processingHistory: TradeOrder[] = [];

    constructor() {
        // Higher urgency and newer orders processed first
        this.queue = new FastPriorityQueue<TradeOrder>((a, b) => {
            if (a.urgency !== b.urgency) {
                return a.urgency > b.urgency;
            }
            return a.timestamp > b.timestamp; // Newer orders first for same urgency
        });
    }

    public addOrder(order: TradeOrder): void {
        this.queue.add(order);
    }

    public processNextOrder(): TradeOrder | undefined {
        const order = this.queue.poll();
        if (order) {
            this.processingHistory.push(order);

            // Keep history size manageable
            if (this.processingHistory.length > 1000) {
                this.processingHistory.splice(0, 500);
            }
        }
        return order;
    }

    public getProcessingStats(): OrderStats {
        const queueArray = this.queue.toArray();

        return {
            pendingOrders: queueArray.length,
            processedOrders: this.processingHistory.length,
            avgUrgency:
                queueArray.reduce((sum, o) => sum + o.urgency, 0) /
                queueArray.length,
            urgencyDistribution: this.getUrgencyDistribution(queueArray),
        };
    }

    // Emergency: process all high-urgency orders immediately
    public flushHighUrgencyOrders(minUrgency: number = 8): TradeOrder[] {
        const highUrgencyOrders: TradeOrder[] = [];
        const remainingOrders: TradeOrder[] = [];

        // Separate high urgency from regular orders
        while (!this.queue.isEmpty()) {
            const order = this.queue.poll()!;
            if (order.urgency >= minUrgency) {
                highUrgencyOrders.push(order);
            } else {
                remainingOrders.push(order);
            }
        }

        // Re-add regular orders
        remainingOrders.forEach((order) => this.queue.add(order));

        return highUrgencyOrders;
    }
}
```

### Event Processing Queue

```typescript
interface MarketEvent {
    type: "trade" | "depth" | "signal" | "anomaly";
    priority: number;
    timestamp: number;
    data: any;
    processingDeadline?: number;
}

export class MarketEventQueue {
    private queue: FastPriorityQueue<MarketEvent>;
    private deadlineQueue: FastPriorityQueue<MarketEvent>;

    constructor() {
        // Main queue: priority first, then timestamp
        this.queue = new FastPriorityQueue<MarketEvent>((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority > b.priority;
            }
            return a.timestamp < b.timestamp;
        });

        // Deadline queue: earliest deadline first
        this.deadlineQueue = new FastPriorityQueue<MarketEvent>((a, b) => {
            return (
                (a.processingDeadline || Infinity) <
                (b.processingDeadline || Infinity)
            );
        });
    }

    public addEvent(event: MarketEvent): void {
        this.queue.add(event);

        if (event.processingDeadline) {
            this.deadlineQueue.add(event);
        }
    }

    public getNextEvent(): MarketEvent | undefined {
        // Check for overdue events first
        const overdueEvent = this.checkForOverdueEvents();
        if (overdueEvent) {
            this.removeFromMainQueue(overdueEvent);
            return overdueEvent;
        }

        // Otherwise get highest priority event
        const event = this.queue.poll();
        if (event && event.processingDeadline) {
            this.removeFromDeadlineQueue(event);
        }

        return event;
    }

    private checkForOverdueEvents(): MarketEvent | undefined {
        const now = Date.now();
        const nextDeadlineEvent = this.deadlineQueue.peek();

        if (
            nextDeadlineEvent &&
            nextDeadlineEvent.processingDeadline &&
            nextDeadlineEvent.processingDeadline <= now
        ) {
            return this.deadlineQueue.poll();
        }

        return undefined;
    }

    private removeFromMainQueue(event: MarketEvent): void {
        // Remove from main queue (less efficient but necessary for deadline management)
        this.queue.remove(event);
    }

    private removeFromDeadlineQueue(event: MarketEvent): void {
        this.deadlineQueue.remove(event);
    }
}
```

## ⚙️ Performance Characteristics

### Time Complexity

- **Add**: O(log n)
- **Poll**: O(log n)
- **Peek**: O(1)
- **Size**: O(1)
- **isEmpty**: O(1)
- **Remove**: O(n) - linear search required
- **Has**: O(n) - linear search required

### Memory Usage

- Efficient heap-based storage
- Dynamic array growth
- Minimal memory overhead per element

### Benchmarks

FastPriorityQueue is optimized for performance:

- Faster than JavaScript's built-in Array.sort()
- Competitive with native binary heap implementations
- Optimized for frequent add/poll operations

## 🔗 Official Resources

- **GitHub Repository**: https://github.com/lemire/FastPriorityQueue.js
- **npm Package**: https://www.npmjs.com/package/fastpriorityqueue
- **Benchmarks**: https://github.com/lemire/FastPriorityQueue.js#usage

## 📝 Requirements

- JavaScript ES5 or later
- Works in Node.js and browsers
- TypeScript definitions included

## ⚠️ Best Practices

1. **Use appropriate comparator functions** for your data type
2. **Consider calling heapify()** after many operations for optimization
3. **Use replaceTop()** instead of poll() + add() when possible
4. **Be careful with object references** in remove() and has() operations
5. **Monitor queue size** in high-frequency applications
6. **Use dedicated queues** for different priority schemes
7. **Consider memory cleanup** for long-running applications

---

_Version: 0.7.5_  
_Compatible with: OrderFlow Trading System_

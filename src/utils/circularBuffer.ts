/**
 * Circular buffer with iterator support for efficient trade storage.
 */
export class CircularBuffer<T> implements Iterable<T> {
    private buffer: T[] = [];
    private head = 0;
    private tail = 0;
    private size = 0;
    private sequence = 0n;
    private readonly cleanupCallback?: (item: T) => void;

    constructor(
        private capacity: number,
        cleanupCallback?: (item: T) => void
    ) {
        this.buffer = new Array(capacity) as T[];
        this.capacity = capacity;
        this.cleanupCallback = cleanupCallback;
    }

    add(item: T): void {
        const oldItem = this.buffer[this.tail];
        if (this.size === this.capacity && oldItem !== undefined) {
            this.cleanupCallback?.(oldItem);
        }

        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        this.sequence++; // Track operations for overflow protection

        if (this.size < this.capacity) {
            this.size++;
        } else {
            this.head = (this.head + 1) % this.capacity;
        }
    }

    getAll(): T[] {
        if (this.size === 0) return [];
        const result: T[] = [];
        let start = this.size < this.capacity ? 0 : this.head;
        for (let i = 0; i < this.size; i++) {
            result.push(this.buffer[(start + i) % this.capacity]);
        }
        return result;
    }

    filter(predicate: (item: T) => boolean): T[] {
        const result: T[] = [];
        for (let i = 0; i < this.size; i++) {
            const item = this.get(i);
            if (item !== undefined && predicate(item)) {
                result.push(item);
            }
        }
        return result;
    }

    clear(): void {
        this.size = 0;
        this.head = 0;
        this.tail = 0; // 🔧 CRITICAL FIX: Reset tail pointer to prevent data corruption
    }

    get length(): number {
        return this.size;
    }

    /**
     * Allow use in for-of and spread operator.
     */
    [Symbol.iterator](): Iterator<T> {
        return this.getAll()[Symbol.iterator]();
    }

    /**
     * Random-access by relative index (0 = oldest, length-1 = newest).
     */
    at(index: number): T | undefined {
        if (index < 0 || index >= this.size) return undefined;
        let start = this.size < this.capacity ? 0 : this.head;
        return this.buffer[(start + index) % this.capacity];
    }

    get(index: number): T | undefined {
        if (index < 0 || index >= this.size) {
            return undefined;
        }
        const realIndex = (this.head + index) % this.capacity;
        return this.buffer[realIndex];
    }

    private checkOverflow(): void {
        if (this.sequence > Number.MAX_SAFE_INTEGER) {
            // POLICY OVERRIDE: Using console.warn for system-level overflow warning
            // REASON: CircularBuffer is a low-level utility without logger access
            // This is a critical system state that requires immediate attention
            console.warn(
                "CircularBuffer: Sequence approaching overflow, consider system restart"
            );
        }
    }

    cleanup(): void {
        if (this.cleanupCallback) {
            for (let i = 0; i < this.size; i++) {
                const item = this.get(i);
                if (item !== undefined) {
                    this.cleanupCallback(item);
                }
            }
        }
        this.buffer.splice(0, this.buffer.length);
        this.size = 0;
        this.head = 0;
        this.tail = 0;
    }
}

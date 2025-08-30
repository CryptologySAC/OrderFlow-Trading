import { describe, it, expect } from "vitest";

// Test the circular reference detection functionality
describe("Circular Reference Detection", () => {
    // Helper function for safe config merging (copied from state.js)
    function safeConfigMerge(target: any, source: any): any {
        const visited = new WeakSet();

        function isCircular(obj: any): boolean {
            if (obj && typeof obj === "object") {
                if (visited.has(obj)) {
                    return true;
                }
                visited.add(obj);
            }
            return false;
        }

        function safeClone(obj: any, depth = 0, maxDepth = 10): any {
            if (depth > maxDepth) {
                console.warn("Max depth reached during config cloning");
                return {};
            }

            if (!obj || typeof obj !== "object" || isCircular(obj)) {
                return obj;
            }

            if (Array.isArray(obj)) {
                return obj.map((item) => safeClone(item, depth + 1, maxDepth));
            }

            const result: any = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    result[key] = safeClone(obj[key], depth + 1, maxDepth);
                }
            }
            return result;
        }

        return { ...safeClone(target), ...safeClone(source) };
    }

    // Helper function to detect circular references
    function hasCircularReference(obj: any, visited = new WeakSet()): boolean {
        if (!obj || typeof obj !== "object") {
            return false;
        }

        if (visited.has(obj)) {
            return true;
        }

        visited.add(obj);

        for (const key in obj) {
            if (hasCircularReference(obj[key], visited)) {
                return true;
            }
        }

        return false;
    }

    it("should detect circular references in objects", () => {
        const obj: any = { name: "test" };
        obj.self = obj; // Create circular reference

        expect(hasCircularReference(obj)).toBe(true);
    });

    it("should handle objects without circular references", () => {
        const obj = {
            name: "test",
            value: 42,
            nested: {
                prop: "value",
            },
        };

        expect(hasCircularReference(obj)).toBe(false);
    });

    it("should handle arrays with circular references", () => {
        const arr: any[] = [1, 2, 3];
        arr.push(arr); // Create circular reference

        expect(hasCircularReference(arr)).toBe(true);
    });

    it("should safely merge configs without circular references", () => {
        const target = { a: 1, b: 2 };
        const source = { b: 3, c: 4 };

        const result = safeConfigMerge(target, source);

        expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("should handle circular references in config merging gracefully", () => {
        const target = { a: 1 };
        const source: any = { b: 2 };
        source.self = source; // Create circular reference

        expect(() => safeConfigMerge(target, source)).not.toThrow();
    });

    it("should handle null and undefined values", () => {
        expect(hasCircularReference(null)).toBe(false);
        expect(hasCircularReference(undefined)).toBe(false);
        expect(hasCircularReference(42)).toBe(false);
        expect(hasCircularReference("string")).toBe(false);
    });
});

/**
 * DetectorStub - Shared stub implementation for testing and compatibility
 *
 * This class provides a minimal detector-like interface for testing purposes
 * and compatibility with systems that expect detector objects.
 */

import { EventEmitter } from "events";

export class DetectorStub extends EventEmitter {
    public constructor(private readonly id: string) {
        super();
    }

    public getId(): string {
        return this.id;
    }
}

import { vi } from "vitest";

// Mock storage for zones to simulate real behavior
const mockZones = new Map<string, any>();
let zoneIdCounter = 0;

export class ZoneManager {
    private zones: Map<string, any>;

    constructor(config: any, logger: any, metricsCollector: any) {
        // Proper mock constructor signature
        this.zones = mockZones; // Ensure zones is properly initialized
        console.log(
            `[MOCK] ZoneManager constructor called, zones initialized: ${this.zones instanceof Map}`
        );
    }

    addZone = vi.fn().mockImplementation((zoneData: any) => {
        const zoneId = `mock-zone-${++zoneIdCounter}`;
        const zone = {
            id: zoneId,
            ...zoneData,
            isActive: true,
        };
        this.zones.set(zoneId, zone);
        return zoneId;
    });

    createZone = vi
        .fn()
        .mockImplementation(
            (type: string, symbol: string, trade: any, zoneDetection: any) => {
                const zoneId = `${type}_${symbol}_${Date.now()}`;
                const zone = {
                    id: zoneId,
                    type: type,
                    symbol: symbol,
                    startTime: trade.timestamp,
                    priceRange: {
                        min: zoneDetection.priceRange?.min || trade.price,
                        max: zoneDetection.priceRange?.max || trade.price,
                        center: trade.price,
                        width: 0.01,
                    },
                    totalVolume: zoneDetection.totalVolume || 0,
                    averageOrderSize: zoneDetection.averageOrderSize || 0,
                    tradeCount: zoneDetection.tradeCount || 1,
                    timeInZone: 0,
                    intensity: zoneDetection.intensity || 0,
                    strength: zoneDetection.initialStrength || 0.5,
                    completion: zoneDetection.completion || 0.8,
                    confidence: zoneDetection.confidence || 0.6,
                    significance: "moderate",
                    isActive: true,
                    lastUpdate: trade.timestamp,
                    strengthHistory: [],
                    supportingFactors: zoneDetection.supportingFactors || {},
                    endTime: null,
                };
                this.zones.set(zoneId, zone);
                console.log(
                    `[MOCK] Created zone ${zoneId}, total zones now: ${this.zones.size}`
                );
                return zone;
            }
        );

    updateZone = vi.fn().mockImplementation((zoneId: string, trade: any) => {
        const zone = this.zones.get(zoneId);
        if (zone) {
            // More realistic mock update - update volume and other properties
            zone.lastUpdate = trade.timestamp;
            zone.totalVolume += trade.quantity || 0;
            zone.tradeCount = (zone.tradeCount || 0) + 1;

            // Update price range if trade is outside current range
            if (zone.priceRange && trade.price) {
                zone.priceRange.min = Math.min(
                    zone.priceRange.min,
                    trade.price
                );
                zone.priceRange.max = Math.max(
                    zone.priceRange.max,
                    trade.price
                );
                zone.priceRange.center =
                    (zone.priceRange.min + zone.priceRange.max) / 2;
            }

            return {
                updateType: "zone_updated",
                zone: zone,
                significance: "medium",
                timestamp: trade.timestamp,
            };
        }
        return null;
    });

    removeZone = vi.fn().mockImplementation((zoneId: string) => {
        return this.zones.delete(zoneId);
    });

    getZones = vi.fn().mockImplementation(() => {
        console.log(
            `[MOCK] getZones called, returning ${this.zones.size} zones`
        );
        return Array.from(this.zones.values());
    });

    getZone = vi.fn().mockImplementation((zoneId: string) => {
        return this.zones.get(zoneId) || null;
    });

    getActiveZones(symbol?: string) {
        try {
            const activeZones = Array.from(this.zones.values()).filter(
                (zone) => {
                    // If symbol is provided, filter by symbol
                    if (symbol && zone.symbol !== symbol) {
                        return false;
                    }
                    return zone.isActive;
                }
            );
            console.log(
                `[MOCK] getActiveZones called for symbol ${symbol}, found ${activeZones.length} active zones`
            );
            console.log(`[MOCK] Total zones in manager: ${this.zones.size}`);
            Array.from(this.zones.values()).forEach((zone, index) => {
                console.log(
                    `[MOCK] Zone ${index}: id=${zone.id}, symbol=${zone.symbol}, isActive=${zone.isActive}`
                );
            });
            return activeZones;
        } catch (error) {
            console.log(`[MOCK] Error in getActiveZones:`, error);
            return [];
        }
    }

    getActiveZoneCount = vi.fn().mockImplementation(() => {
        return this.getActiveZones().length;
    });

    cleanup = vi.fn().mockImplementation(() => {
        // Mock cleanup - remove old zones
        const now = Date.now();
        for (const [id, zone] of this.zones.entries()) {
            if (now - zone.lastUpdate > 600000) {
                // 10 minutes
                this.zones.delete(id);
            }
        }
    });

    hasZoneAt = vi.fn().mockReturnValue(false);
    getZonesNearPrice = vi
        .fn()
        .mockImplementation(
            (symbol: string, price: number, tolerance: number) => {
                return Array.from(this.zones.values()).filter((zone) => {
                    // Filter by symbol
                    if (zone.symbol !== symbol) {
                        return false;
                    }
                    // Check if zone is near the price
                    const priceRange = zone.priceRange;
                    if (!priceRange) return false;

                    const minPrice = priceRange.center * (1 - tolerance);
                    const maxPrice = priceRange.center * (1 + tolerance);

                    return (
                        price >= minPrice && price <= maxPrice && zone.isActive
                    );
                });
            }
        );
    mergeable = vi.fn().mockReturnValue(false);
    merge = vi.fn();

    expandZoneRange = vi
        .fn()
        .mockImplementation((zoneId: string, price: number) => {
            const zone = this.zones.get(zoneId);
            if (zone && zone.priceRange) {
                // Update the zone's price range to include the new price
                zone.priceRange.min = Math.min(zone.priceRange.min, price);
                zone.priceRange.max = Math.max(zone.priceRange.max, price);
                zone.priceRange.center =
                    (zone.priceRange.min + zone.priceRange.max) / 2;
                return true;
            }
            return false;
        });

    // Test helper to clear zones
    clearAllZones() {
        this.zones.clear();
        zoneIdCounter = 0;
    }
}

export const __esModule = true;

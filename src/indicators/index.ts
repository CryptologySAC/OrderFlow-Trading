// Re-export all enhanced indicators and their types

export { AccumulationZoneDetectorEnhanced } from "./accumulationZoneDetectorEnhanced.js";
export { AbsorptionDetectorEnhanced } from "./absorptionDetectorEnhanced.js";
export {
    ExhaustionDetectorEnhanced,
    type ExhaustionEnhancedSettings,
} from "./exhaustionDetectorEnhanced.js";
export { DistributionDetectorEnhanced } from "./distributionDetectorEnhanced.js";
export {
    DeltaCVDDetectorEnhanced,
    type DeltaCVDEnhancedSettings,
} from "./deltaCVDDetectorEnhanced.js";
export { SupportResistanceDetector } from "./supportResistanceDetector.js";

// Re-export settings types from extracted type files
export type { AbsorptionSettings } from "./types/absorptionTypes.js";
export type { ExhaustionSettings } from "./types/exhaustionTypes.js";
export type { DeltaCVDConfirmationSettings } from "./types/deltaCVDTypes.js";

// Re-export types from interfaces
export type {
    AccumulationSettings,
    SuperiorFlowSettings,
} from "./interfaces/detectorInterfaces.js";

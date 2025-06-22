// Re-export all indicators and their types

export { AccumulationZoneDetector } from "./accumulationZoneDetector.js";
export {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "./absorptionDetector.js";
export {
    ExhaustionDetector,
    type ExhaustionSettings,
} from "./exhaustionDetector.js";
export { DistributionZoneDetector } from "./distributionZoneDetector.js";
export {
    DeltaCVDConfirmation,
    type DeltaCVDConfirmationSettings,
} from "./deltaCVDConfirmation.js";
export { SupportResistanceDetector } from "./supportResistanceDetector.js";

// Re-export types from interfaces
export type {
    AccumulationSettings,
    SuperiorFlowSettings,
} from "./interfaces/detectorInterfaces.js";

// src/services/index.ts

export {
    HiddenOrderDetector,
    type HiddenOrderDetectorConfig,
} from "./hiddenOrderDetector.js";
export {
    IcebergDetector,
    type IcebergDetectorConfig,
} from "./icebergDetector.js";
export {
    SpoofingDetector,
    type SpoofingDetectorConfig,
} from "./spoofingDetector.js";
export { AnomalyDetector } from "./anomalyDetector.js";
export { SignalCoordinator } from "./signalCoordinator.js";

// src/services/index.ts

export {
    HiddenOrderDetector,
    type HiddenOrderDetectorConfig,
} from "./hiddenOrderDetector.ts";
export {
    IcebergDetector,
    type IcebergDetectorConfig,
} from "./icebergDetector.ts";
export {
    SpoofingDetector,
    type SpoofingDetectorConfig,
} from "./spoofingDetector.ts";
export { AnomalyDetector } from "./anomalyDetector.ts";
export { SignalCoordinator } from "./signalCoordinator.ts";

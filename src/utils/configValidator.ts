// src/utils/configValidator.ts
export interface ValidationRule<T> {
    validate: (value: T) => boolean;
    message: string;
}

export interface ValidationOptions {
    required?: boolean;
    min?: number;
    max?: number;
    positive?: boolean;
    finite?: boolean;
    integer?: boolean;
    custom?: ValidationRule<unknown>[];
}

export class ConfigValidationError extends Error {
    constructor(
        public field: string,
        public value: unknown,
        public rule: string
    ) {
        super(
            `Configuration validation failed for '${field}': ${rule} (received: ${String(value)})`
        );
        this.name = "ConfigValidationError";
    }
}

export class ConfigValidator {
    /**
     * Validate and assign number configuration with defaults
     */
    public static validateNumber(
        fieldName: string,
        value: number | undefined,
        defaultValue: number,
        options: ValidationOptions = {}
    ): number {
        const finalValue = value ?? defaultValue;

        if (options.required && value === undefined) {
            throw new ConfigValidationError(fieldName, value, "is required");
        }

        if (options.finite && !Number.isFinite(finalValue)) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                "must be a finite number"
            );
        }

        if (options.positive && finalValue <= 0) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                "must be positive"
            );
        }

        if (options.integer && !Number.isInteger(finalValue)) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                "must be an integer"
            );
        }

        if (options.min !== undefined && finalValue < options.min) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                `must be >= ${options.min}`
            );
        }

        if (options.max !== undefined && finalValue > options.max) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                `must be <= ${options.max}`
            );
        }

        if (options.custom) {
            for (const rule of options.custom) {
                if (!rule.validate(finalValue)) {
                    throw new ConfigValidationError(
                        fieldName,
                        finalValue,
                        rule.message
                    );
                }
            }
        }

        return finalValue;
    }

    /**
     * Validate and assign string configuration with defaults
     */
    public static validateString(
        fieldName: string,
        value: string | undefined,
        defaultValue: string,
        options: {
            required?: boolean;
            minLength?: number;
            maxLength?: number;
            pattern?: RegExp;
        } = {}
    ): string {
        const finalValue = value ?? defaultValue;

        if (options.required && value === undefined) {
            throw new ConfigValidationError(fieldName, value, "is required");
        }

        if (
            options.minLength !== undefined &&
            finalValue.length < options.minLength
        ) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                `must be at least ${options.minLength} characters`
            );
        }

        if (
            options.maxLength !== undefined &&
            finalValue.length > options.maxLength
        ) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                `must be at most ${options.maxLength} characters`
            );
        }

        if (options.pattern && !options.pattern.test(finalValue)) {
            throw new ConfigValidationError(
                fieldName,
                finalValue,
                `must match pattern ${options.pattern}`
            );
        }

        return finalValue;
    }

    /**
     * Validate and assign boolean configuration with defaults
     */
    public static validateBoolean(
        fieldName: string,
        value: boolean | undefined,
        defaultValue: boolean,
        options: { required?: boolean } = {}
    ): boolean {
        const finalValue = value ?? defaultValue;

        if (options.required && value === undefined) {
            throw new ConfigValidationError(fieldName, value, "is required");
        }

        return finalValue;
    }

    /**
     * Validate detector-specific settings with common patterns
     */
    public static validateDetectorSettings<T extends Record<string, unknown>>(
        settings: T,
        defaults: T,
        validationRules: Record<keyof T, ValidationOptions>
    ): T {
        const result = { ...settings };

        for (const [field, rules] of Object.entries(validationRules)) {
            const fieldKey = field as keyof T;
            const value = settings[fieldKey];
            const defaultValue = defaults[fieldKey];

            if (typeof defaultValue === "number") {
                result[fieldKey] = this.validateNumber(
                    field,
                    value as number | undefined,
                    defaultValue,
                    rules
                ) as T[keyof T];
            } else if (typeof defaultValue === "string") {
                result[fieldKey] = this.validateString(
                    field,
                    value as string | undefined,
                    defaultValue,
                    rules as {
                        required?: boolean;
                        minLength?: number;
                        maxLength?: number;
                        pattern?: RegExp;
                    }
                ) as T[keyof T];
            } else if (typeof defaultValue === "boolean") {
                result[fieldKey] = this.validateBoolean(
                    field,
                    value as boolean | undefined,
                    defaultValue,
                    rules
                ) as T[keyof T];
            }
        }

        return result;
    }

    /**
     * Common validation rules for trading system parameters
     */
    public static readonly COMMON_RULES = {
        THRESHOLD: { min: 0, max: 1, finite: true },
        VOLUME: { positive: true, finite: true },
        PRICE: { positive: true, finite: true },
        MILLISECONDS: { positive: true, integer: true },
        PRECISION: { min: 0, max: 8, integer: true },
        MULTIPLIER: { positive: true, finite: true },
        RATIO: { min: 0, max: 1, finite: true },
        PERCENTAGE: { min: 0, max: 100, finite: true },
    };

    /**
     * Validate production-safe detector configuration
     */
    public static validateProductionDetectorConfig<
        T extends {
            windowMs?: number;
            minAggVolume?: number;
            eventCooldownMs?: number;
            symbol?: string;
        },
    >(settings: T): void {
        if (settings.windowMs && settings.windowMs < 5000) {
            throw new ConfigValidationError(
                "windowMs",
                settings.windowMs,
                "should be at least 5000ms in production"
            );
        }

        if (settings.minAggVolume && settings.minAggVolume < 100) {
            throw new ConfigValidationError(
                "minAggVolume",
                settings.minAggVolume,
                "should be at least 100 in production"
            );
        }

        if (settings.eventCooldownMs && settings.eventCooldownMs < 5000) {
            throw new ConfigValidationError(
                "eventCooldownMs",
                settings.eventCooldownMs,
                "should be at least 5000ms in production"
            );
        }

        if (!settings.symbol) {
            throw new ConfigValidationError(
                "symbol",
                settings.symbol,
                "is required in production"
            );
        }
    }
}

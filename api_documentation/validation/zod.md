# Zod API Documentation

TypeScript-first schema validation with static type inference.

## 📦 Installation

```bash
npm install zod
# or
yarn add zod
```

## 🎯 Basic Usage

### Schema Definition

```typescript
import { z } from "zod";

// Primitive schemas
const stringSchema = z.string();
const numberSchema = z.number();
const booleanSchema = z.boolean();
const dateSchema = z.date();

// Object schema
const UserSchema = z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
    isActive: z.boolean().optional(),
});

// Array schema
const NumberArraySchema = z.array(z.number());
const UserArraySchema = z.array(UserSchema);
```

### Type Inference

```typescript
// Extract TypeScript type from schema
type User = z.infer<typeof UserSchema>;
// => { name: string; age: number; email: string; isActive?: boolean }
```

### Parsing Data

```typescript
// Safe parsing (recommended)
const result = UserSchema.safeParse({
    name: "John",
    age: 30,
    email: "john@example.com",
});

if (result.success) {
    console.log(result.data); // Typed as User
} else {
    console.log(result.error); // ZodError with detailed issues
}

// Direct parsing (throws on error)
try {
    const user = UserSchema.parse(data);
    console.log(user); // Typed as User
} catch (error) {
    console.error(error); // ZodError
}
```

## 📖 Schema Types

### Primitives

```typescript
z.string(); // string
z.number(); // number
z.bigint(); // bigint
z.boolean(); // boolean
z.date(); // Date
z.symbol(); // symbol
z.undefined(); // undefined
z.null(); // null
z.void(); // void
z.any(); // any (avoid if possible)
z.unknown(); // unknown
z.never(); // never
```

### String Validations

```typescript
z.string().min(5); // Minimum length
z.string().max(10); // Maximum length
z.string().length(5); // Exact length
z.string().email(); // Email format
z.string().url(); // URL format
z.string().uuid(); // UUID format
z.string().regex(/^[a-z]+$/); // Custom regex
z.string().startsWith("hello"); // Starts with
z.string().endsWith("world"); // Ends with
z.string().includes("test"); // Contains substring
z.string().trim(); // Trim whitespace
z.string().toLowerCase(); // Convert to lowercase
z.string().toUpperCase(); // Convert to uppercase

// Built-in validators
z.string().cuid(); // CUID
z.string().cuid2(); // CUID2
z.string().ulid(); // ULID
z.string().emoji(); // Single emoji
z.string().ip(); // IP address (v4 or v6)
z.string().base64(); // Base64
z.string().nanoid(); // Nano ID
```

### Number Validations

```typescript
z.number().min(5); // Minimum value
z.number().max(10); // Maximum value
z.number().int(); // Integer only
z.number().positive(); // > 0
z.number().nonnegative(); // >= 0
z.number().negative(); // < 0
z.number().nonpositive(); // <= 0
z.number().multipleOf(5); // Multiple of 5
z.number().finite(); // Not Infinity or -Infinity
z.number().safe(); // Safe integer range
```

### Object Schemas

```typescript
const PersonSchema = z.object({
    name: z.string(),
    age: z.number(),
    address: z.object({
        street: z.string(),
        city: z.string(),
        zipCode: z.string().length(5),
    }),
});

// Optional properties
const UserSchema = z.object({
    name: z.string(),
    email: z.string().email().optional(),
});

// Default values
const ConfigSchema = z.object({
    port: z.number().default(3000),
    host: z.string().default("localhost"),
});

// Extending objects
const ExtendedUserSchema = UserSchema.extend({
    id: z.number(),
    createdAt: z.date(),
});

// Picking/omitting fields
const PartialUserSchema = UserSchema.pick({ name: true });
const UserWithoutEmailSchema = UserSchema.omit({ email: true });
```

### Array Schemas

```typescript
z.array(z.string()); // string[]
z.array(z.number()).min(1); // At least 1 element
z.array(z.string()).max(10); // At most 10 elements
z.array(z.number()).length(5); // Exactly 5 elements
z.array(z.string()).nonempty(); // At least 1 element

// Non-empty arrays with specific type
z.string().array().nonempty(); // [string, ...string[]]
```

### Union Types

```typescript
// Union of primitives
const StringOrNumber = z.union([z.string(), z.number()]);

// Discriminated unions
const EventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
    z.object({ type: z.literal("hover"), element: z.string() }),
]);

// Literal values
const DirectionSchema = z.union([
    z.literal("left"),
    z.literal("right"),
    z.literal("up"),
    z.literal("down"),
]);

// Enum alternative
const Direction = z.enum(["left", "right", "up", "down"]);
```

### Optional and Nullable

```typescript
z.string().optional(); // string | undefined
z.string().nullable(); // string | null
z.string().nullish(); // string | null | undefined

// Default values
z.string().optional().default("hello");
z.number().nullable().default(null);
```

### Transformations

```typescript
// Transform input data
const NumberFromString = z.string().transform((val) => parseFloat(val));
const result = NumberFromString.parse("123.45"); // 123.45 (number)

// Coercion (built-in transformations)
z.coerce.string(); // String(input)
z.coerce.number(); // Number(input)
z.coerce.boolean(); // Boolean(input)
z.coerce.date(); // new Date(input)

// Pipeline transformations
const schema = z
    .string()
    .transform((s) => s.trim())
    .transform((s) => s.toLowerCase())
    .transform((s) => s.split(" "));
```

### Refinements (Custom Validation)

```typescript
// Custom validation rules
const PasswordSchema = z
    .string()
    .min(8)
    .refine((password) => /[A-Z]/.test(password), {
        message: "Password must contain at least one uppercase letter",
    })
    .refine((password) => /[0-9]/.test(password), {
        message: "Password must contain at least one number",
    });

// Async refinements
const UsernameSchema = z.string().refine(
    async (username) => {
        const exists = await checkUsernameExists(username);
        return !exists;
    },
    { message: "Username already taken" }
);

// Use with parseAsync
const result = await UsernameSchema.parseAsync("john123");
```

## 🎯 Usage in OrderFlow Trading

### Trade Data Validation

```typescript
// Binance trade event schema
export const BinanceTradeEventSchema = z.object({
    e: z.literal("trade"), // Event type
    E: z.number().int().positive(), // Event time
    s: z.string(), // Symbol
    t: z.number().int().positive(), // Trade ID
    p: z.string().transform(parseFloat), // Price
    q: z.string().transform(parseFloat), // Quantity
    b: z.number().int().positive(), // Buyer order ID
    a: z.number().int().positive(), // Seller order ID
    T: z.number().int().positive(), // Trade time
    m: z.boolean(), // Is buyer maker
    M: z.boolean(), // Ignore (always true)
});

export type BinanceTradeEvent = z.infer<typeof BinanceTradeEventSchema>;

// Usage in WebSocket handler
wsStreams.subscribe(["ltcusdt@trade"], (rawData) => {
    const result = BinanceTradeEventSchema.safeParse(rawData);

    if (!result.success) {
        logger.error("Invalid trade data", {
            error: result.error,
            data: rawData,
        });
        return;
    }

    const trade = result.data;
    orderFlowProcessor.processTrade(trade);
});
```

### Configuration Validation

```typescript
// Detector configuration schemas
export const AbsorptionDetectorConfigSchema = z.object({
    minAggVolume: z.number().int().min(1).max(100000),
    absorptionThreshold: z.number().min(0.1).max(1.0),
    priceEfficiencyThreshold: z.number().min(0.001).max(0.1),
    maxAbsorptionRatio: z.number().min(0.1).max(1.0),
    minPassiveMultiplier: z.number().min(0.5).max(5.0),
    eventCooldownMs: z.number().int().min(1000).max(300000),
    finalConfidenceRequired: z.number().min(0.1).max(2.0),
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "testing", "production"]),
});

export const ExhaustionDetectorConfigSchema = z.object({
    minAggVolume: z.number().int().min(1).max(100000),
    exhaustionThreshold: z.number().min(0.1).max(1.0),
    timeWindowIndex: z.number().int().min(0).max(5),
    eventCooldownMs: z.number().int().min(1000).max(300000),
    minEnhancedConfidenceThreshold: z.number().min(0.1).max(1.0),
    useStandardizedZones: z.boolean(),
    enhancementMode: z.enum(["disabled", "testing", "production"]),
});

// Main config schema
export const ConfigSchema = z.object({
    nodeEnv: z.enum(["development", "production", "test"]),
    httpPort: z.number().int().min(1000).max(65535),
    wsPort: z.number().int().min(1000).max(65535),
    symbols: z.record(
        z.object({
            absorption: AbsorptionDetectorConfigSchema,
            exhaustion: ExhaustionDetectorConfigSchema,
            pricePrecision: z.number().int().min(0).max(8),
            quantityPrecision: z.number().int().min(0).max(8),
        })
    ),
});

// Config validation with detailed error reporting
export function validateConfig(rawConfig: unknown): ConfigResult {
    const result = ConfigSchema.safeParse(rawConfig);

    if (!result.success) {
        const errorDetails = result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            received: issue.received,
        }));

        throw new Error(
            `Configuration validation failed:\n${errorDetails
                .map((err) => `  ${err.path}: ${err.message}`)
                .join("\n")}`
        );
    }

    return result.data;
}
```

### Signal Validation

```typescript
// Signal candidate schema
export const SignalCandidateSchema = z.object({
    id: z.string().ulid(),
    detectorType: z.enum([
        "absorption",
        "exhaustion",
        "deltacvd",
        "accumulation",
    ]),
    symbol: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    confidence: z.number().min(0).max(2),
    price: z.number().positive(),
    quantity: z.number().positive(),
    timestamp: z.number().int().positive(),
    metadata: z.record(z.unknown()).optional(),
});

export type SignalCandidate = z.infer<typeof SignalCandidateSchema>;

// WebSocket message validation
export const WebSocketMessageSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("subscribe"),
        channels: z.array(z.string()),
    }),
    z.object({
        type: z.literal("unsubscribe"),
        channels: z.array(z.string()),
    }),
    z.object({
        type: z.literal("signal_filter"),
        filters: z.object({
            detectorTypes: z.array(z.string()).optional(),
            minConfidence: z.number().min(0).max(2).optional(),
            symbols: z.array(z.string()).optional(),
        }),
    }),
]);
```

### Error Handling

```typescript
import { ZodError } from "zod";

// Custom error handler for Zod validation
export function handleZodError(error: ZodError, context: string): void {
    const issues = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
        received: "received" in issue ? issue.received : undefined,
    }));

    logger.error(`Validation error in ${context}`, {
        issues,
        totalIssues: issues.length,
    });

    // For critical data validation, consider throwing
    if (context.includes("trade") || context.includes("signal")) {
        throw new Error(`Critical data validation failed: ${context}`);
    }
}

// Usage in trade processing
try {
    const validatedTrade = TradeSchema.parse(rawTradeData);
    processValidatedTrade(validatedTrade);
} catch (error) {
    if (error instanceof ZodError) {
        handleZodError(error, "trade_processing");
    } else {
        logger.error("Unexpected error in trade processing", error);
    }
}
```

## ⚙️ Advanced Features

### Recursive Schemas

```typescript
interface Category {
    name: string;
    subcategories: Category[];
}

const CategorySchema: z.ZodSchema<Category> = z.lazy(() =>
    z.object({
        name: z.string(),
        subcategories: z.array(CategorySchema),
    })
);
```

### Brand Types

```typescript
const UserId = z.string().brand<"UserId">();
const ProductId = z.string().brand<"ProductId">();

type UserId = z.infer<typeof UserId>; // string & Brand<'UserId'>
type ProductId = z.infer<typeof ProductId>; // string & Brand<'ProductId'>

// These are now distinct types even though both are strings
```

### Catch Errors

```typescript
// Provide fallback values for invalid data
const schema = z.object({
    name: z.string().catch("Unknown"),
    age: z.number().catch(0),
});

const result = schema.parse({ name: 123, age: "invalid" });
// { name: 'Unknown', age: 0 }
```

## 🔗 Official Resources

- **Official Documentation**: https://zod.dev/
- **GitHub Repository**: https://github.com/colinhacks/zod
- **npm Package**: https://www.npmjs.com/package/zod
- **API Reference**: https://zod.dev/api

## 📝 Requirements

- TypeScript 5.5+ (recommended)
- Works with JavaScript but loses type safety benefits

## ⚠️ Best Practices

1. **Use safeParse() in production** to avoid throwing errors
2. **Define schemas outside components/functions** for better performance
3. **Use transformations sparingly** - prefer keeping raw and processed data separate
4. **Provide helpful error messages** with custom refinements
5. **Use discriminated unions** for complex conditional schemas
6. **Validate at system boundaries** (API inputs, config files, external data)

---

_Version: 3.25.57_  
_Compatible with: OrderFlow Trading System_

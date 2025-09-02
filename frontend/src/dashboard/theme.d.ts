// Type declarations for theme.js

export declare function getSystemTheme(): string;
export declare function getCurrentTheme(): string;
export declare function applyTheme(theme: string): void;
export declare function applySystemTheme(): void;
export declare function saveTheme(theme: string): void;
export declare function restoreTheme(): void;
export declare function toggleTheme(): void;
export declare function updateThemeToggleButton(): void;
export declare function updateChartTheme(theme: string): void;
export declare function getDepletionVisualizationEnabled(): boolean;
export declare function setDepletionVisualizationEnabled(
    enabled: boolean
): void;
export declare function toggleDepletionVisualization(): void;
export declare function updateDepletionToggleButton(): void;

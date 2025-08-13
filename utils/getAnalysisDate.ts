/**
 * Utility function to get the date for analysis scripts
 * Either from command line argument or defaults to today
 *
 * Usage in scripts:
 *   import { getAnalysisDate } from './utils/getAnalysisDate';
 *   const dateStr = getAnalysisDate();
 */

export function getAnalysisDate(): string {
    const dateArg = process.argv[2];

    if (dateArg) {
        // Validate format YYYY-MM-DD
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateArg)) {
            console.error("Error: Date must be in YYYY-MM-DD format");
            console.error("Example: npx tsx script.ts 2025-08-12");
            process.exit(1);
        }
        return dateArg;
    }

    // Use today's date in YYYY-MM-DD format
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Prints usage instructions for analysis scripts
 */
export function printUsage(scriptName: string): void {
    console.log(`
Usage: npx tsx ${scriptName} [YYYY-MM-DD]

Examples:
  npx tsx ${scriptName}              # Uses today's date
  npx tsx ${scriptName} 2025-08-12   # Analyze specific date
  
Note: Signal validation CSV files must exist for the specified date
      in logs/signal_validation/ directory
`);
}

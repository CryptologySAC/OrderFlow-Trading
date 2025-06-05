# Column Resize with localStorage Demo

## Features Implemented

✅ **Resizable Columns**: Drag the borders between columns to resize them
✅ **localStorage Persistence**: Browser remembers your preferred column widths
✅ **Automatic Restoration**: Column widths are restored when you reload the page
✅ **Reset Functionality**: Reset button to restore default layout
✅ **Constraints**: Min/max width limits prevent columns from becoming too small/large

## How to Test

### 1. Open the test page

```bash
# Navigate to the public directory
cd "/Users/marcschot/Projects/OrderFlow Trading/public"

# Open test.html in your browser
open test.html
```

### 2. Test the functionality

1. **Resize columns**:

    - Hover over the borders between columns (cursor changes to resize)
    - Drag left/right to resize
    - Column 1 affects columns 1 & 2
    - Column 3 affects columns 2 & 3

2. **Test persistence**:

    - Resize the columns to your preferred widths
    - Reload the page (F5 or Cmd+R)
    - Notice the columns return to your custom sizes

3. **Test reset**:
    - Click the "Reset Layout" button
    - Confirm the dialog
    - Columns return to default widths (25%, 60%, 15%)

## localStorage Structure

The column widths are saved as:

```json
{
    "column1": 30.5, // Percentage width of column 1
    "column3": 20.0, // Percentage width of column 3
    "timestamp": 1704123456789 // When saved
}
```

## Browser Developer Tools Testing

Open browser dev tools (F12) and check:

1. **Console logs**:

    - "Column widths saved: {object}"
    - "Column widths restored: {object}"

2. **Application/Storage tab**:

    - Navigate to Local Storage
    - Look for key: `dashboardColumnWidths`
    - See the JSON structure

3. **Test clear localStorage**:
    ```javascript
    localStorage.removeItem("dashboardColumnWidths");
    location.reload();
    ```

## Integration with Main Dashboard

The same functionality is now integrated into `/public/dashboard.html`:

- Column resizing works with charts and trading interface
- Charts automatically resize when columns change
- Reset button added to range selector toolbar
- All preferences persist across browser sessions

## Constraints Applied

- **Column 1**: 15% - 50% width (200px minimum)
- **Column 3**: 10% - 30% width (150px minimum)
- **Column 2**: Flexible, fills remaining space
- **Validation**: Invalid saved data falls back to defaults

This ensures the layout remains functional and readable across different screen sizes while giving users full control over their preferred workspace layout.

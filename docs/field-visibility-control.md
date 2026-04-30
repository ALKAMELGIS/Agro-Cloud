## Field Visibility Control (GIS Layer Table)

### What it does
- Adds a “Field visibility” control in the layer table metadata header.
- Lets users hide/show individual fields (table columns) using an eye / eye-slash toggle per field.
- Persists user preferences per layer so the table keeps the same visible/hidden fields when reopened.

### How to use
1. Open a layer table (Table view).
2. In the table metadata header, click **Field visibility**.
3. Toggle any field:
   - Eye = visible
   - Eye-slash = hidden
4. The table updates immediately to show/hide the corresponding field columns.

### Persistence / configuration
- Preferences are stored in `localStorage` per layer using a key in this format:
  - `gis:layer-table:hidden-fields:<layerId>`
- The stored value is a JSON array of hidden field names.

### Resetting preferences
- Clear browser storage for the site, or delete the specific key for the layer from `localStorage`.


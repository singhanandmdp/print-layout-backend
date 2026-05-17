# AJ Print Layout Pro Backend

This is a standalone backend for `AJ Print Layout Pro`.

It is intentionally separate from the existing `backend/` folder.

## What it handles

- TIFF and large image previews
- 300 DPI business-card sheet rendering
- Front and back export into a single PDF

## Run locally

```bash
cd print-layout-backend
npm install
npm start
```

Default port:

```text
5101
```

## Frontend hook

The studio page reads:

```html
<meta name="ajartivo-print-layout-backend-url" content="http://localhost:5101">
```

If you deploy this backend somewhere else, update that URL or set:

```js
window.AJARTIVO_PRINT_LAYOUT_BACKEND_URL = "https://your-host.example";
```

# AJ Print Layout Pro Backend

This backend renders print-layout exports for `AJ Print Layout Pro` with a focus on:

- 300 DPI print fidelity
- low-memory export behavior
- Vercel serverless compatibility
- safe repeated back-to-back exports
- JPG + PDF output support

## What it handles

- Business-card preview rendering
- 12x18 inch sheet export at 300 DPI
- 25-up business-card sheet generation
- JPG sheet export
- PDF export with embedded optimized JPG pages
- Memory-bounded multipart uploads

## Local run

```bash
cd "Backend Services/print-layout-backend"
npm install
npm start
```

Default port:

```text
5101
```

## Vercel deployment

This project is structured so the same Express app can run locally and on Vercel.

- `app.js` exports the Express app
- `server.js` starts a local listener only when run directly
- `api/index.js` exposes the app for Vercel
- `vercel.json` rewrites all routes to the function entry

The API endpoints remain the same:

- `POST /tools/aj-print-layout-pro/preview`
- `POST /tools/aj-print-layout-pro/export`
- `GET /health`

## Recommended environment variables

```text
PORT=5101
FRONTEND_ORIGINS=http://127.0.0.1:5500,http://localhost:5500,https://ajartivo.in,https://www.ajartivo.in
UPLOAD_MAX_FILE_SIZE_MB=25
UPLOAD_MAX_PREVIEW_SIZE_MB=12
EXPORT_TIMEOUT_MS=45000
SHARP_CONCURRENCY=1
SHARP_LIMIT_INPUT_PIXELS=268402689
PREVIEW_JPEG_QUALITY=86
EXPORT_JPEG_QUALITY=92
```

## Production guidance

- Keep `SHARP_CONCURRENCY=1` on weak servers and serverless functions.
- Keep export uploads small. A 12x18 sheet is already large at 300 DPI, so the backend now assumes optimized uploads.
- PDF export uses already-rendered JPG pages, so it avoids repeating the expensive image work.
- JPG export streams the final sheet instead of holding an extra full-size JS buffer.

## Frontend hook

The studio page reads:

```html
<meta name="ajartivo-print-layout-backend-url" content="https://print-layout-backend.onrender.com">
```

For local development, the frontend falls back to `http://localhost:5101` unless you override it explicitly.

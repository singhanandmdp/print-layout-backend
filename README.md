# AJ Print Layout Pro Backend

Universal print rendering backend for `AJ Print Layout Pro`.

It now behaves like a lightweight rendering engine instead of a business-card-only exporter:

- Business cards
- Invitations
- Certificates
- ID cards
- Labels
- Sticker sheets
- Photo sheets
- A4 layouts
- 2-up / 4-up / 10-up / 25-up layouts

## Architecture

Frontend responsibilities:

- preview rendering
- layout calculation
- margins and spacing
- coordinates
- snapping and guides

Backend responsibilities:

- receive original files
- receive layout/settings JSON
- render final high-resolution sheets
- export JPG or PDF

### Current backend structure

```text
routes/
  export.js
  preview.js
  printLayout.js

services/
  renderEngine.js
  sheetEngine.js
  imageEngine.js
  pdfEngine.js
  printLayoutRenderer.js

utils/
  sharp.js
  logger.js
  validation.js
  coordinates.js
  http.js
```

## Endpoints

- `POST /tools/aj-print-layout-pro/preview`
- `POST /tools/aj-print-layout-pro/export`
- `GET /health`

## Export request format

The backend expects original uploads plus layout JSON.

```js
formData.append("frontFile", uploadedFile, "front.jpg");

formData.append(
  "settings",
  JSON.stringify({
    sheet: {
      width: 12,
      height: 18,
      dpi: 300
    },
    layout: {
      activeSide: "front",
      pages: [
        {
          side: "front",
          sheet: {
            width: 12,
            height: 18,
            dpi: 300
          },
          items: [
            {
              x: 0,
              y: 0,
              width: 990,
              height: 645,
              rotation: 0,
              imageKey: "front"
            }
          ]
        }
      ],
      sources: {
        front: {
          fieldName: "frontFile",
          imageKey: "front",
          sourceKind: "original-file"
        }
      },
      export: {
        format: "jpg"
      }
    }
  })
);
```

The backend also accepts the legacy top-level shape:

- `settings.pages`
- `settings.items`
- `settings.sources`

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

This project is structured so the same Express app runs locally and on Vercel.

- `app.js` exports the Express app
- `server.js` starts a local listener only when run directly
- `api/index.js` exposes the app for Vercel
- `vercel.json` rewrites all routes to the function entry

Recommended Vercel config:

- `maxDuration`: `60` if your plan allows it
- `memory`: `1024`

## Recommended environment variables

```text
PORT=5101
FRONTEND_ORIGINS=http://127.0.0.1:5500,http://localhost:5500,https://ajartivo.in,https://www.ajartivo.in
UPLOAD_MAX_FILE_SIZE_MB=25
UPLOAD_MAX_EXPORT_FILE_COUNT=8
UPLOAD_MAX_EXPORT_PART_COUNT=24
UPLOAD_MAX_PREVIEW_SIZE_MB=12
UPLOAD_MAX_PREVIEW_FILE_COUNT=1
UPLOAD_MAX_PREVIEW_PART_COUNT=4
EXPORT_TIMEOUT_MS=45000
SHARP_CONCURRENCY=1
SHARP_LIMIT_INPUT_PIXELS=268402689
PREVIEW_JPEG_QUALITY=86
EXPORT_JPEG_QUALITY=92
LOG_LEVEL=info
```

## Optimization notes

- `sharp.cache(false)` is enabled.
- Sharp concurrency is capped for serverless safety.
- Export requests only carry original assets plus JSON, not giant rendered sheets.
- JPG responses are sent directly.
- PDF export embeds rendered JPG pages.
- Mixed-size pages are supported by the PDF pipeline.
- Multipart parsing is bounded with file-count and part-count limits.

## Production notes

- Do not send `renderedFront` / `renderedBack` blobs anymore.
- Keep uploaded originals as small as practical.
- If a layout contains multiple pages, the backend will render each page from the provided coordinates and assets.
- Frontend preview stays local in the browser.

## Frontend hook

The studio page reads:

```html
<meta name="ajartivo-print-layout-backend-url" content="https://print-layout-backend.onrender.com">
```

For local development, the frontend falls back to `http://localhost:5101` unless you override it explicitly.

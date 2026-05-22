const express = require("express");
const multer = require("multer");

const { cleanText, config } = require("../config");
const { asyncHandler, createHttpError } = require("../utils/http");
const {
    buildBusinessCardSheetPipeline,
    buildLayoutPdfBuffer,
    createBusinessCardPreviewBuffer,
    createBusinessCardSheetBuffer,
    createLayoutPageBuffers,
    getSheetDimensions,
    normalizePrintLayoutSettings
} = require("../services/printLayoutRenderer");

const router = express.Router();

const previewUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.uploads.maxPreviewFileSizeBytes,
        files: 1,
        fieldSize: 16 * 1024,
        parts: 2
    }
});

const exportUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.uploads.maxExportFileSizeBytes,
        files: 4,
        fieldSize: 64 * 1024,
        parts: 16
    }
});

const exportedFields = [
    { name: "frontFile", maxCount: 1 },
    { name: "front", maxCount: 1 },
    { name: "file", maxCount: 1 },
    { name: "backFile", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "renderedFront", maxCount: 1 },
    { name: "frontPreview", maxCount: 1 },
    { name: "frontSheet", maxCount: 1 },
    { name: "frontImage", maxCount: 1 },
    { name: "renderedBack", maxCount: 1 },
    { name: "backPreview", maxCount: 1 },
    { name: "backSheet", maxCount: 1 },
    { name: "backImage", maxCount: 1 }
];

router.post("/tools/aj-print-layout-pro/preview", requestTimeoutMiddleware, previewUpload.single("file"), asyncHandler(async function (req, res) {
    const file = req.file;

    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
        throw createHttpError(400, "File data is missing.");
    }

    if (!isSupportedPreviewFile(file.originalname || "")) {
        throw createHttpError(400, "Preview supports JPG, PNG, WEBP, AVIF, GIF, BMP, HEIC, HEIF, TIF, and TIFF files.");
    }

    const previewBuffer = await createBusinessCardPreviewBuffer(file.buffer);
    res.set("Content-Type", "image/jpeg");
    res.set("Content-Disposition", `inline; filename="${cleanFileName(file.originalname || "preview.jpg")}"`);
    res.set("Cache-Control", "no-store");
    res.send(previewBuffer);
}));

router.post("/tools/aj-print-layout-pro/export", requestTimeoutMiddleware, exportUpload.fields(exportedFields), asyncHandler(async function (req, res) {
    const settings = normalizePrintLayoutSettings(parseSettings(req.body && req.body.settings));
    const format = cleanText(req.body && req.body.format).toLowerCase() === "jpg" ? "jpg" : "pdf";
    const activeSide = cleanText(req.body && req.body.activeSide).toLowerCase() === "back" ? "back" : "front";
    const sheetDimensions = getSheetDimensions(settings);

    const frontFile = getUploadedFile(req.files, ["frontFile", "front", "file"]);
    const backFile = getUploadedFile(req.files, ["backFile", "back"]);
    const frontBuffer = getRenderableFileBuffer(frontFile);
    const backBuffer = getRenderableFileBuffer(backFile);

    const renderedPages = await createLayoutPageBuffers({
        front: frontBuffer,
        back: backBuffer
    }, settings);

    if (renderedPages.length) {
        await respondWithRenderedPages(req, res, renderedPages, settings, format, activeSide, sheetDimensions);
        return;
    }

    const legacyRenderedPages = getRenderedPreviewPages(req.files);

    if (legacyRenderedPages.length) {
        await respondWithRenderedPages(req, res, legacyRenderedPages, settings, format, activeSide, sheetDimensions);
        return;
    }

    if (!frontBuffer && !backBuffer) {
        throw createHttpError(400, "At least one uploaded file is required.");
    }

    await resExport(req, res, {
        format: format,
        activeSide: activeSide,
        settings: settings,
        sheetDimensions: sheetDimensions,
        frontBuffer: frontBuffer,
        backBuffer: backBuffer
    });
}));

async function respondWithRenderedPages(_req, res, renderedPages, settings, format, activeSide, sheetDimensions) {
    if (format === "jpg") {
        const primaryPage = activeSide === "back"
            ? (renderedPages.find(function (page) {
                return page.side === "back";
            }) || renderedPages[0])
            : (renderedPages.find(function (page) {
                return page.side === "front";
            }) || renderedPages[0]);

        res.set("Content-Type", "image/jpeg");
        res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, primaryPage.side, "jpg")}"`);
        res.set("Cache-Control", "no-store");
        res.send(primaryPage.buffer);
        return;
    }

    const pages = [];

    for (let i = 0; i < renderedPages.length; i += 1) {
        pages.push({ jpegBuffer: renderedPages[i].buffer });
    }

    const pdfBuffer = await buildLayoutPdfBuffer(pages, sheetDimensions);

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, "pdf")}"`);
    res.set("Cache-Control", "no-store");
    res.send(pdfBuffer);
}

async function resExport(_req, res, payload) {
    const { format, activeSide, settings, sheetDimensions, frontBuffer, backBuffer } = payload;

    if (format === "jpg") {
        const sourceBuffer = activeSide === "back"
            ? (backBuffer || frontBuffer)
            : (frontBuffer || backBuffer);
        const sheetPipeline = await buildBusinessCardSheetPipeline(sourceBuffer, settings, sheetDimensions);
        const fileName = buildExportFileName(settings, activeSide, "jpg");

        res.set("Content-Type", "image/jpeg");
        res.set("Content-Disposition", `attachment; filename="${fileName}"`);
        res.set("Cache-Control", "no-store");

        // The final JPEG is streamed directly to the client so we do not hold a full
        // 12x18 raster buffer in JavaScript memory during the response.
        await pipeSharpToResponse(sheetPipeline, res);
        return;
    }

    const pageBuffers = [];

    if (frontBuffer) {
        pageBuffers.push({ jpegBuffer: await createBusinessCardSheetBuffer(frontBuffer, settings, sheetDimensions) });
    }

    if (backBuffer) {
        pageBuffers.push({ jpegBuffer: await createBusinessCardSheetBuffer(backBuffer, settings, sheetDimensions) });
    }

    const pdfBuffer = await buildLayoutPdfBuffer(pageBuffers, sheetDimensions);

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, "pdf")}"`);
    res.set("Cache-Control", "no-store");
    res.send(pdfBuffer);
}

function pipeSharpToResponse(pipeline, res) {
    return new Promise(function (resolve, reject) {
        let settled = false;

        function cleanup() {
            pipeline.removeListener("error", onError);
            res.removeListener("error", onError);
            res.removeListener("finish", onFinish);
            res.removeListener("close", onClose);
        }

        function settle(handler, value) {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            handler(value);
        }

        function onError(error) {
            settle(reject, error);
        }

        function onFinish() {
            settle(resolve);
        }

        function onClose() {
            if (!settled) {
                settle(reject, createHttpError(499, "Response closed before the export finished."));
            }
        }

        pipeline.once("error", onError);
        res.once("error", onError);
        res.once("finish", onFinish);
        res.once("close", onClose);
        pipeline.pipe(res);
    });
}

function applyRequestTimeout(req, res) {
    const timeoutMs = Math.max(1000, Number(config.exports && config.exports.timeoutMs) || 45000);
    if (typeof req.setTimeout === "function") {
        req.setTimeout(timeoutMs);
    }
    if (typeof res.setTimeout === "function") {
        res.setTimeout(timeoutMs);
    }
}

function requestTimeoutMiddleware(req, res, next) {
    applyRequestTimeout(req, res);
    next();
}

function parseSettings(rawSettings) {
    const text = cleanText(rawSettings);
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (_error) {
        throw createHttpError(400, "Print layout settings payload is invalid.");
    }
}

function getRenderableFileBuffer(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
        return null;
    }
    return file.buffer;
}

function getUploadedFile(files, fieldNames) {
    const map = files && typeof files === "object" ? files : {};

    for (let i = 0; i < fieldNames.length; i += 1) {
        const fieldName = fieldNames[i];
        const list = map[fieldName];
        if (Array.isArray(list) && list.length > 0 && list[0]) {
            return list[0];
        }
    }

    return null;
}

function getRenderedPreviewPages(files) {
    const pages = [];
    const frontFile = getUploadedFile(files, ["renderedFront", "frontPreview", "frontSheet", "frontImage"]);
    const backFile = getUploadedFile(files, ["renderedBack", "backPreview", "backSheet", "backImage"]);
    const frontBuffer = getRenderableFileBuffer(frontFile);
    const backBuffer = getRenderableFileBuffer(backFile);

    if (frontBuffer) {
        pages.push({ side: "front", buffer: frontBuffer });
    }

    if (backBuffer) {
        pages.push({ side: "back", buffer: backBuffer });
    }

    return pages;
}

function isSupportedPreviewFile(fileName) {
    const lower = cleanText(fileName).toLowerCase();
    return /\.(png|jpe?g|webp|avif|gif|bmp|heic|heif|tiff?|tif)$/i.test(lower);
}

function cleanFileName(fileName) {
    const name = cleanText(fileName).replace(/["\\/<>:*?|]+/g, "-").trim();
    return name || "preview.jpg";
}

function buildExportFileName(settings, sideOrFormat, maybeFormat) {
    const format = maybeFormat || sideOrFormat;
    const side = maybeFormat ? sideOrFormat : "";
    const baseName = `aj-print-layout-pro-${cleanText(settings.sheetSize || "12x18").toLowerCase()}`;

    if (format === "pdf") {
        return `${baseName}.pdf`;
    }

    return `${baseName}${side === "back" ? "-back" : "-front"}.jpg`;
}

module.exports = router;

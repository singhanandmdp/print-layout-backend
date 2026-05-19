const express = require("express");
const multer = require("multer");

const { config, cleanText } = require("../config");
const { asyncHandler, createHttpError } = require("../utils/http");
const {
    buildLayoutPdfBuffer,
    createBusinessCardPreviewBuffer,
    createBusinessCardSheetBuffer,
    getSheetDimensions,
    normalizePrintLayoutSettings
} = require("../utils/printLayout");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.uploads.maxFileSizeBytes,
        files: 2
    }
});

let exportInFlight = false;

router.post("/tools/aj-print-layout-pro/preview", upload.single("file"), asyncHandler(async function (req, res) {
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

router.post("/tools/aj-print-layout-pro/export", upload.any(), asyncHandler(async function (req, res) {
    if (exportInFlight) {
        throw createHttpError(429, "An export is already running. Please wait a moment and try again.");
    }

    exportInFlight = true;

    try {
        const settings = normalizePrintLayoutSettings(parseSettings(req.body && req.body.settings));
        const format = cleanText(req.body && req.body.format).toLowerCase() === "jpg" ? "jpg" : "pdf";
        const activeSide = cleanText(req.body && req.body.activeSide).toLowerCase() === "back" ? "back" : "front";
        const frontFile = getUploadedFile(req.files, ["frontFile", "front", "file"]);
        const backFile = getUploadedFile(req.files, ["backFile", "back"]);
        const frontBuffer = getRenderableFileBuffer(frontFile);
        const backBuffer = getRenderableFileBuffer(backFile);
        const renderQueue = [];

        if (!frontBuffer && !backBuffer) {
            throw createHttpError(400, "At least one rendered file is required.");
        }

        if (frontBuffer) {
            renderQueue.push({ side: "front", buffer: frontBuffer });
        }

        if (backBuffer) {
            renderQueue.push({ side: "back", buffer: backBuffer });
        }

        const sheetDimensions = getSheetDimensions(settings);
        const primaryPage = activeSide === "back"
            ? (renderQueue.find(function (page) {
                return page.side === "back";
            }) || renderQueue[0])
            : (renderQueue.find(function (page) {
                return page.side === "front";
            }) || renderQueue[0]);

        if (format === "jpg") {
            const sheetBuffer = await createBusinessCardSheetBuffer(primaryPage.buffer, settings, sheetDimensions);
            res.set("Content-Type", "image/jpeg");
            res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, primaryPage.side, "jpg")}"`);
            res.set("Cache-Control", "no-store");
            res.send(sheetBuffer);
            return;
        }

        const pages = [];

        for (let i = 0; i < renderQueue.length; i += 1) {
            pages.push({
                jpegBuffer: await createBusinessCardSheetBuffer(renderQueue[i].buffer, settings, sheetDimensions)
            });
        }

        const pdfBuffer = await buildLayoutPdfBuffer(pages, sheetDimensions);

        res.set("Content-Type", "application/pdf");
        res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, "pdf")}"`);
        res.set("Cache-Control", "no-store");
        res.send(pdfBuffer);
    } finally {
        exportInFlight = false;
    }
}));

function parseSettings(rawSettings) {
    const text = cleanText(rawSettings);
    if (!text) return {};

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
    const list = Array.isArray(files) ? files : [];

    for (let i = 0; i < fieldNames.length; i += 1) {
        const fieldName = fieldNames[i];
        const match = list.find(function (file) {
            return file && file.fieldname === fieldName;
        });
        if (match) {
            return match;
        }
    }

    return null;
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

const express = require("express");
const sharp = require("sharp");

const { config, cleanText } = require("../config");
const { parseMultipartRequest } = require("../utils/multipart");
const { asyncHandler, createHttpError } = require("../utils/http");
const {
    buildSimpleJpegPdf,
    createBusinessCardPreviewBuffer,
    createBusinessCardSheetBuffer,
    getSheetDimensions,
    normalizePrintLayoutSettings
} = require("../utils/printLayout");

const router = express.Router();

const rawUploadParser = express.raw({
    type: function () {
        return true;
    },
    limit: config.uploads.maxFileSizeBytes
});

router.post("/tools/aj-print-layout-pro/preview", rawUploadParser, asyncHandler(async function (req, res) {
    const multipart = parseMultipartRequest(req);
    const file = multipart.files && multipart.files.file;

    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
        throw createHttpError(400, "File data is missing.");
    }

    if (!isSupportedPreviewFile(file.fileName || "")) {
        throw createHttpError(400, "Preview supports JPG, PNG, WEBP, AVIF, GIF, BMP, HEIC, HEIF, TIF, and TIFF files.");
    }

    const previewBuffer = await createBusinessCardPreviewBuffer(file.buffer);
    res.set("Content-Type", "image/jpeg");
    res.set("Content-Disposition", `inline; filename="${cleanFileName(file.fileName || "preview.jpg")}"`);
    res.set("Cache-Control", "no-store");
    res.send(previewBuffer);
}));

router.post("/tools/aj-print-layout-pro/export", rawUploadParser, asyncHandler(async function (req, res) {
    const multipart = parseMultipartRequest(req);
    const settings = normalizePrintLayoutSettings(parseSettings(multipart.fields && multipart.fields.settings));
    const format = cleanText(multipart.fields && multipart.fields.format).toLowerCase() === "jpg" ? "jpg" : "pdf";
    const activeSide = cleanText(multipart.fields && multipart.fields.activeSide).toLowerCase() === "back" ? "back" : "front";
    const frontFile = multipart.files && (multipart.files.frontFile || multipart.files.front);
    const backFile = multipart.files && (multipart.files.backFile || multipart.files.back);
    const frontBuffer = getRenderableFileBuffer(frontFile);
    const backBuffer = getRenderableFileBuffer(backFile);

    if (!frontBuffer && !backBuffer) {
        throw createHttpError(400, "At least one rendered file is required.");
    }

    const sheetDimensions = getSheetDimensions(settings);

    if (format === "jpg") {
        const sourceBuffer = activeSide === "back"
            ? (backBuffer || frontBuffer)
            : (frontBuffer || backBuffer);
        const sheetBuffer = await createBusinessCardSheetBuffer(sourceBuffer, settings, sheetDimensions);
        res.set("Content-Type", "image/jpeg");
        res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, activeSide, "jpg")}"`);
        res.set("Cache-Control", "no-store");
        res.send(sheetBuffer);
        return;
    }

    const frontSheetBuffer = await createBusinessCardSheetBuffer(frontBuffer || backBuffer, settings, sheetDimensions);
    const backSheetBuffer = await createBusinessCardSheetBuffer(backBuffer || frontBuffer, settings, sheetDimensions);
    const pdfBuffer = buildSimpleJpegPdf(
        [
            await toJpegPage(frontSheetBuffer),
            await toJpegPage(backSheetBuffer)
        ],
        sheetDimensions
    );

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${buildExportFileName(settings, "pdf")}"`);
    res.set("Cache-Control", "no-store");
    res.send(pdfBuffer);
}));

async function toJpegPage(buffer) {
    const metadata = await sharp(buffer).metadata();
    return {
        jpegBuffer: buffer,
        imageWidth: Number(metadata.width) || 1,
        imageHeight: Number(metadata.height) || 1
    };
}

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

const express = require("express");
const multer = require("multer");

const { cleanText, config } = require("../config");
const { asyncHandler, createHttpError, requestTimeoutMiddleware } = require("../utils/http");
const { createLogger, createTimer } = require("../utils/logger");
const { describeUploadedFiles, isSupportedImageFile, parseJsonPayload } = require("../utils/validation");
const { buildExportFileName, renderExportDocument } = require("../services/renderEngine");

const router = express.Router();
const exportLogger = createLogger("export");

const exportUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.uploads.maxExportFileSizeBytes,
        files: Math.max(1, Math.round(config.uploads.maxExportFileCount || 8)),
        fieldSize: 256 * 1024,
        parts: Math.max(4, Math.round(config.uploads.maxExportPartCount || 24))
    }
});

router.post("/tools/aj-print-layout-pro/export", requestTimeoutMiddleware, exportUpload.any(), asyncHandler(async function (req, res) {
    const rawSettings = parseJsonPayload(req.body && req.body.settings, "Print layout settings payload is invalid.");
    const format = resolveFormat(req.body, rawSettings);
    const activeSide = resolveActiveSide(req.body, rawSettings);
    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
        throw createHttpError(400, "At least one uploaded file is required.");
    }

    for (let i = 0; i < files.length; i += 1) {
        if (!isSupportedImageFile(files[i])) {
            throw createHttpError(400, `Unsupported file type for "${cleanText(files[i] && files[i].fieldname)}".`);
        }
    }

    const timer = createTimer("export-request");
    exportLogger.info("Export request received", {
        format: format,
        activeSide: activeSide,
        fileCount: files.length,
        uploadedFiles: describeUploadedFiles(files)
    });

    const exportResult = await renderExportDocument(rawSettings, files, {
        format: format,
        activeSide: activeSide,
        logger: exportLogger
    });

    if (format === "jpg") {
        const primaryPage = exportResult.primaryPage || (Array.isArray(exportResult.pages) ? exportResult.pages[0] : null);
        const buffer = primaryPage && Buffer.isBuffer(primaryPage.buffer) ? primaryPage.buffer : null;
        if (!Buffer.isBuffer(buffer) || !buffer.length) {
            throw createHttpError(500, "Rendered JPG buffer is missing.");
        }

        const fileName = buildExportFileName(exportResult.settings, primaryPage && primaryPage.side ? primaryPage.side : activeSide, "jpg");
        const timing = timer.stop({ format: format, source: exportResult.source, bytes: buffer.length });
        exportLogger.info("Export response ready", timing);

        res.set("Content-Type", "image/jpeg");
        res.set("Content-Disposition", `attachment; filename="${fileName}"`);
        res.set("Cache-Control", "no-store");
        res.send(buffer);
        return;
    }

    if (!Buffer.isBuffer(exportResult.pdfBuffer) || !exportResult.pdfBuffer.length) {
        throw createHttpError(500, "Rendered PDF buffer is missing.");
    }

    const pdfFileName = buildExportFileName(exportResult.settings, "pdf");
    const pdfTiming = timer.stop({ format: format, source: exportResult.source, bytes: exportResult.pdfBuffer.length });
    exportLogger.info("Export response ready", pdfTiming);

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${pdfFileName}"`);
    res.set("Cache-Control", "no-store");
    res.send(exportResult.pdfBuffer);
}));

function resolveFormat(body, settings) {
    const bodyFormat = cleanText(body && body.format).toLowerCase();
    const settingsFormat = cleanText(settings && settings.export && settings.export.format).toLowerCase();
    return bodyFormat === "jpg" || settingsFormat === "jpg" ? "jpg" : "pdf";
}

function resolveActiveSide(body, settings) {
    const bodySide = cleanText(body && body.activeSide).toLowerCase();
    const settingsSide = cleanText(settings && settings.activeSide).toLowerCase();
    const layoutSide = cleanText(settings && settings.layout && settings.layout.activeSide).toLowerCase();
    const resolved = bodySide || settingsSide || layoutSide;
    return resolved === "back" ? "back" : "front";
}

module.exports = router;

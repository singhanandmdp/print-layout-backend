const express = require("express");
const multer = require("multer");

const { cleanText, config } = require("../config");
const { asyncHandler, createHttpError, requestTimeoutMiddleware } = require("../utils/http");
const { createLogger, createTimer } = require("../utils/logger");
const { describeUploadedFiles, getFileBuffer, isSupportedImageFile } = require("../utils/validation");
const { createPreviewBuffer } = require("../services/imageEngine");

const router = express.Router();
const previewLogger = createLogger("preview");

const previewUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.uploads.maxPreviewFileSizeBytes,
        files: Math.max(1, Math.round(config.uploads.maxPreviewFileCount || 1)),
        fieldSize: 32 * 1024,
        parts: Math.max(4, Math.round(config.uploads.maxPreviewPartCount || 4))
    }
});

router.post("/tools/aj-print-layout-pro/preview", requestTimeoutMiddleware, previewUpload.any(), asyncHandler(async function (req, res) {
    const files = Array.isArray(req.files) ? req.files : [];
    const file = files.length > 0 ? files[0] : req.file;
    const fileBuffer = getFileBuffer(file);

    if (!fileBuffer) {
        throw createHttpError(400, "File data is missing.");
    }

    if (!isSupportedImageFile(file)) {
        throw createHttpError(400, "Preview supports JPG, PNG, WEBP, AVIF, GIF, BMP, HEIC, HEIF, TIF, and TIFF files.");
    }

    const timer = createTimer("preview-render");
    previewLogger.info("Preview request received", {
        fileCount: files.length,
        uploadedFiles: describeUploadedFiles(files)
    });

    const previewBuffer = await createPreviewBuffer(fileBuffer);
    const timing = timer.stop({ bytes: previewBuffer.length });
    previewLogger.info("Preview rendered", timing);

    res.set("Content-Type", "image/jpeg");
    res.set("Content-Disposition", `inline; filename="${cleanFileName(file && file.originalname ? file.originalname : "preview.jpg")}"`);
    res.set("Cache-Control", "no-store");
    res.send(previewBuffer);
}));

function cleanFileName(fileName) {
    const name = cleanText(fileName).replace(/["\\/<>:*?|]+/g, "-").trim();
    return name || "preview.jpg";
}

module.exports = router;

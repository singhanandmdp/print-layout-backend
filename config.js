const DEFAULT_PORT = 5101;

const config = {
    port: normalizePort(process.env.PORT, DEFAULT_PORT),
    frontendOrigins: buildFrontendOrigins(process.env.FRONTEND_ORIGINS),
    uploads: {
        maxExportFileSizeBytes: normalizePositiveNumber(process.env.UPLOAD_MAX_FILE_SIZE_MB, 25) * 1024 * 1024,
        maxExportFileCount: normalizePositiveNumber(process.env.UPLOAD_MAX_EXPORT_FILE_COUNT, 8),
        maxExportPartCount: normalizePositiveNumber(process.env.UPLOAD_MAX_EXPORT_PART_COUNT, 24),
        maxPreviewFileSizeBytes: normalizePositiveNumber(process.env.UPLOAD_MAX_PREVIEW_SIZE_MB, 12) * 1024 * 1024,
        maxPreviewFileCount: normalizePositiveNumber(process.env.UPLOAD_MAX_PREVIEW_FILE_COUNT, 1),
        maxPreviewPartCount: normalizePositiveNumber(process.env.UPLOAD_MAX_PREVIEW_PART_COUNT, 4)
    },
    exports: {
        timeoutMs: normalizePositiveNumber(process.env.EXPORT_TIMEOUT_MS, 45000)
    }
};

function buildFrontendOrigins(rawOrigins) {
    const defaults = [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "https://ajartivo.in",
        "https://www.ajartivo.in"
    ];

    const extras = String(rawOrigins || "")
        .split(",")
        .map(function (origin) {
            return String(origin || "").trim();
        })
        .filter(Boolean);

    return Array.from(new Set(defaults.concat(extras)));
}

function normalizePort(rawValue, fallback) {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveNumber(rawValue, fallback) {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanText(value) {
    return String(value || "").trim();
}

module.exports = {
    config,
    cleanText
};

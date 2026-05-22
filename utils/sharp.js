const os = require("os");

const sharp = require("sharp");

const DEFAULT_LIMIT_INPUT_PIXELS = 268402689;
const EXPORT_DPI = 300;
const PREVIEW_MAX_SIDE_PX = 2400;
const RGBA_CHANNELS = 4;

configureSharpRuntime();

const SHARP_INPUT_OPTIONS = Object.freeze({
    animated: true,
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: normalizePositiveNumber(process.env.SHARP_LIMIT_INPUT_PIXELS, DEFAULT_LIMIT_INPUT_PIXELS)
});

function configureSharpRuntime() {
    const cpuCount = Number(os.cpus && os.cpus().length) || 1;
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
    const requested = normalizePositiveNumber(process.env.SHARP_CONCURRENCY, isServerless ? 1 : Math.min(2, cpuCount));
    const concurrency = Math.max(1, Math.min(cpuCount, Math.round(requested)));

    sharp.cache(false);
    sharp.concurrency(concurrency);
}

function createSharpInstance(input) {
    return sharp(input, SHARP_INPUT_OPTIONS);
}

function normalizePositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function normalizeJpegQuality(rawValue, fallback) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(1, Math.min(100, Math.round(parsed)));
}

module.exports = {
    EXPORT_DPI,
    PREVIEW_MAX_SIDE_PX,
    RGBA_CHANNELS,
    SHARP_INPUT_OPTIONS,
    createSharpInstance,
    normalizeJpegQuality
};

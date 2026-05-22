const { cleanText, config } = require("../config");
const { createLogger } = require("./logger");

const httpLogger = createLogger("http");

function createHttpError(status, message, meta) {
    const error = new Error(message);
    error.status = status;
    if (typeof meta !== "undefined") {
        error.meta = meta;
    }
    return error;
}

function asyncHandler(handler) {
    return function (req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function notFoundHandler(_req, res) {
    res.status(404).json({ error: "Route not found." });
}

function errorHandler(error, _req, res, _next) {
    const status = Number(error && (error.status || error.statusCode)) || 500;
    const resolvedStatus = status >= 400 && status < 600 ? status : 500;
    const message = cleanText(error && error.message) || "Server request failed.";

    httpLogger.error("Request failed", {
        status: resolvedStatus,
        message: message,
        meta: error && error.meta ? error.meta : undefined,
        stack: error && error.stack ? error.stack.split("\n").slice(0, 4).join(" | ") : undefined
    });

    res.status(resolvedStatus).json({
        error: message,
        meta: error && error.meta ? error.meta : undefined
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

module.exports = {
    asyncHandler,
    applyRequestTimeout,
    createHttpError,
    errorHandler,
    notFoundHandler,
    requestTimeoutMiddleware
};

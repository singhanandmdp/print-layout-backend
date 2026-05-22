const { cleanText } = require("../config");

const LEVEL_ORDER = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const configuredLevel = resolveLogLevel(process.env.LOG_LEVEL || process.env.AJ_LOG_LEVEL || "info");

function resolveLogLevel(value) {
    const level = cleanText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVEL_ORDER, level) ? level : "info";
}

function createLogger(scope) {
    const resolvedScope = cleanText(scope) || "app";

    return {
        debug: function (message, meta) {
            log("debug", resolvedScope, message, meta);
        },
        info: function (message, meta) {
            log("info", resolvedScope, message, meta);
        },
        warn: function (message, meta) {
            log("warn", resolvedScope, message, meta);
        },
        error: function (message, meta) {
            log("error", resolvedScope, message, meta);
        }
    };
}

function createTimer(label) {
    const startedAt = process.hrtime.bigint();
    const timerLabel = cleanText(label) || "operation";

    return {
        stop: function (meta) {
            const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            return {
                label: timerLabel,
                elapsedMs: Math.max(0, Math.round(elapsedMs * 100) / 100),
                meta: meta || null
            };
        }
    };
}

function log(level, scope, message, meta) {
    if (!shouldLog(level)) {
        return;
    }

    const writer = level === "error"
        ? console.error
        : (level === "warn" ? console.warn : console.log);
    const parts = [
        `[${new Date().toISOString()}]`,
        `[${level.toUpperCase()}]`,
        `[${scope}]`,
        cleanText(message) || "log"
    ];

    if (typeof meta !== "undefined") {
        parts.push(serializeMeta(meta));
    }

    writer(parts.join(" "));
}

function shouldLog(level) {
    const current = LEVEL_ORDER[configuredLevel] != null ? LEVEL_ORDER[configuredLevel] : LEVEL_ORDER.info;
    const requested = LEVEL_ORDER[level] != null ? LEVEL_ORDER[level] : LEVEL_ORDER.info;
    return requested <= current;
}

function serializeMeta(meta) {
    if (meta == null) {
        return "";
    }

    if (typeof meta === "string") {
        return meta;
    }

    try {
        return JSON.stringify(meta);
    } catch (_error) {
        return String(meta);
    }
}

module.exports = {
    createLogger,
    createTimer,
    resolveLogLevel
};

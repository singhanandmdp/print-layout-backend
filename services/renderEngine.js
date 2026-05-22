const { cleanText, config } = require("../config");
const { createHttpError } = require("../utils/http");
const { createLogger, createTimer } = require("../utils/logger");
const {
    buildFieldAliases,
    collectMultipartFiles,
    getFileBuffer,
    groupFilesByField,
    isSupportedImageFile,
    normalizeFieldKey,
    parseJsonPayload
} = require("../utils/validation");
const { createPreviewBuffer } = require("./imageEngine");
const {
    buildBusinessCardSheetPipeline,
    createLayoutPageBuffers,
    getSheetDimensions,
    normalizePrintLayoutSettings
} = require("./sheetEngine");
const { buildPdfBuffer } = require("./pdfEngine");
const { toPixels } = require("../utils/coordinates");

const renderLogger = createLogger("render");

async function renderPreviewImage(file) {
    const buffer = getFileBuffer(file);
    if (!buffer) {
        throw createHttpError(400, "File data is missing.");
    }

    if (!isSupportedImageFile(file)) {
        throw createHttpError(400, "Preview supports JPG, PNG, WEBP, AVIF, GIF, BMP, HEIC, HEIF, TIF, and TIFF files.");
    }

    return createPreviewBuffer(buffer);
}

function parseSettings(rawSettings) {
    return parseJsonPayload(rawSettings, "Print layout settings payload is invalid.");
}

function buildSourceBufferMap(files, rawSettings) {
    const sourceBuffers = Object.create(null);
    const uploadFiles = collectMultipartFiles(files);

    for (let i = 0; i < uploadFiles.length; i += 1) {
        const file = uploadFiles[i];
        const buffer = getFileBuffer(file);
        if (!buffer) {
            continue;
        }

        const aliases = buildFieldAliases(file.fieldname, file.originalname);
        for (let j = 0; j < aliases.length; j += 1) {
            assignSourceBuffer(sourceBuffers, aliases[j], buffer);
        }
    }

    const sourceEntries = collectSourceEntries(rawSettings);
    const groupedFiles = groupFilesByField(uploadFiles);

    Object.keys(sourceEntries).forEach(function (key) {
        const entry = sourceEntries[key];
        const buffer = resolveEntryBuffer(entry, sourceBuffers, groupedFiles);
        if (!buffer) {
            return;
        }

        const aliases = new Set([key]);
        const entryAliases = buildFieldAliases(key, entry && entry.fileName);
        for (let i = 0; i < entryAliases.length; i += 1) {
            aliases.add(entryAliases[i]);
        }

        if (entry && typeof entry === "object") {
            [entry.fieldName, entry.fileField, entry.sourceKey, entry.imageKey, entry.side, entry.name, entry.fileName].forEach(function (alias) {
                if (alias) {
                    aliases.add(alias);
                    const extraAliases = buildFieldAliases(alias, entry.fileName);
                    for (let j = 0; j < extraAliases.length; j += 1) {
                        aliases.add(extraAliases[j]);
                    }
                }
            });
        }

        aliases.forEach(function (alias) {
            assignSourceBuffer(sourceBuffers, alias, buffer);
        });
    });

    return sourceBuffers;
}

function collectSourceEntries(rawSettings) {
    const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const layout = settings.layout && typeof settings.layout === "object" ? settings.layout : {};
    return layout.sources && typeof layout.sources === "object" ? layout.sources : (settings.sources && typeof settings.sources === "object" ? settings.sources : {});
}

function resolveEntryBuffer(entry, sourceBuffers, groupedFiles) {
    if (!entry || typeof entry !== "object") {
        return null;
    }

    const candidates = [
        entry.fieldName,
        entry.fileField,
        entry.sourceKey,
        entry.imageKey,
        entry.side,
        entry.name,
        entry.fileName
    ];

    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (!candidate) {
            continue;
        }

        const aliases = buildFieldAliases(candidate, entry.fileName);
        for (let j = 0; j < aliases.length; j += 1) {
            const alias = aliases[j];
            const buffer = sourceBuffers[alias];
            if (Buffer.isBuffer(buffer) && buffer.length) {
                return buffer;
            }
        }

        const grouped = groupedFiles[candidate] || groupedFiles[normalizeFieldKey(candidate)];
        if (Array.isArray(grouped) && grouped.length > 0) {
            const buffer = getFileBuffer(grouped[0]);
            if (buffer) {
                return buffer;
            }
        }
    }

    return null;
}

function assignSourceBuffer(sourceBuffers, alias, buffer) {
    const key = cleanText(alias);
    if (!key || !Buffer.isBuffer(buffer) || !buffer.length) {
        return;
    }

    const aliases = buildFieldAliases(key);
    aliases.push(key);

    for (let i = 0; i < aliases.length; i += 1) {
        const candidate = aliases[i];
        if (!candidate) {
            continue;
        }
        if (!sourceBuffers[candidate]) {
            sourceBuffers[candidate] = buffer;
        }
    }
}

async function renderLayoutPages(rawSettings, files, logger) {
    const normalizedSettings = normalizePrintLayoutSettings(rawSettings);
    const sourceBuffers = buildSourceBufferMap(files, rawSettings);
    const renderPagesTimer = createTimer("render-layout-pages");
    const pages = await createLayoutPageBuffers(sourceBuffers, normalizedSettings);

    if (pages.length) {
        const timing = renderPagesTimer.stop({ pages: pages.length });
        (logger || renderLogger).info("Layout pages rendered", timing);
        return {
            settings: normalizedSettings,
            sourceBuffers: sourceBuffers,
            pages: pages,
            sheetDimensions: pages[0] && pages[0].sheet ? pages[0].sheet : getSheetDimensions(normalizedSettings),
            source: "layout"
        };
    }

    const legacy = await renderLegacyBusinessCardPages(sourceBuffers, normalizedSettings, logger);
    const timing = renderPagesTimer.stop({ pages: legacy.pages.length, source: legacy.source });
    (logger || renderLogger).info("Fallback pages rendered", timing);
    return legacy;
}

async function renderLegacyBusinessCardPages(sourceBuffers, normalizedSettings, logger) {
    const sheetDimensions = getSheetDimensions(normalizedSettings);
    const frontBuffer = sourceBuffers.front || sourceBuffers.frontfile || sourceBuffers.file || null;
    const backBuffer = sourceBuffers.back || sourceBuffers.backfile || null;
    const pages = [];

    if (frontBuffer) {
        pages.push({
            side: "front",
            sheet: sheetDimensions,
            buffer: await renderBusinessCardSheetBuffer(frontBuffer, normalizedSettings, sheetDimensions)
        });
    }

    if (backBuffer) {
        pages.push({
            side: "back",
            sheet: sheetDimensions,
            buffer: await renderBusinessCardSheetBuffer(backBuffer, normalizedSettings, sheetDimensions)
        });
    }

    if (!pages.length && frontBuffer) {
        pages.push({
            side: normalizedSettings.activeSide || "front",
            sheet: sheetDimensions,
            buffer: await renderBusinessCardSheetBuffer(frontBuffer, normalizedSettings, sheetDimensions)
        });
    }

    (logger || renderLogger).debug("Legacy business-card fallback evaluated", {
        front: Boolean(frontBuffer),
        back: Boolean(backBuffer),
        pages: pages.length
    });

    return {
        settings: normalizedSettings,
        sourceBuffers: sourceBuffers,
        pages: pages,
        sheetDimensions: sheetDimensions,
        source: "legacy-business-card"
    };
}

async function renderBusinessCardSheetBuffer(sourceBuffer, settings, sheetDimensions) {
    return buildBusinessCardSheetPipeline(sourceBuffer, settings, sheetDimensions).then(function (pipeline) {
        return pipeline.toBuffer();
    });
}

async function renderExportDocument(rawSettings, files, options) {
    const logger = options && options.logger ? options.logger : renderLogger;
    const format = cleanText(options && options.format).toLowerCase() === "jpg" ? "jpg" : "pdf";
    const activeSide = cleanText(options && options.activeSide).toLowerCase() === "back" ? "back" : "front";
    const renderTimer = createTimer("export-render");
    const rendered = await renderLayoutPages(rawSettings, files, logger);
    const sheetDimensions = rendered.sheetDimensions || getSheetDimensions(rendered.settings);
    const pages = Array.isArray(rendered.pages) ? rendered.pages : [];

    if (!pages.length) {
        throw createHttpError(400, "At least one uploaded file is required.");
    }

    if (format === "jpg") {
        const primaryPage = activeSide === "back"
            ? (findPageBySide(pages, "back") || pages[0])
            : (findPageBySide(pages, "front") || pages[0]);
        const timing = renderTimer.stop({ format: format, source: rendered.source, pages: pages.length });
        logger.info("Export rendered", timing);

        return {
            format: format,
            settings: rendered.settings,
            sheetDimensions: sheetDimensions,
            pages: pages,
            primaryPage: primaryPage,
            source: rendered.source
        };
    }

    const pdfBuffer = await buildPdfBuffer(pages, sheetDimensions, {
        title: "AJ Print Layout Pro export",
        author: "AJartivo",
        producer: "AJartivo Print Layout Backend",
        creator: "AJartivo Print Layout Backend",
        subject: "Print layout export"
    });
    const timing = renderTimer.stop({ format: format, source: rendered.source, pages: pages.length });
    logger.info("Export rendered", timing);

    return {
        format: format,
        settings: rendered.settings,
        sheetDimensions: sheetDimensions,
        pages: pages,
        pdfBuffer: pdfBuffer,
        source: rendered.source
    };
}

function findPageBySide(pages, side) {
    const list = Array.isArray(pages) ? pages : [];
    const desired = cleanText(side).toLowerCase();

    for (let i = 0; i < list.length; i += 1) {
        const page = list[i];
        if (!page || cleanText(page.side).toLowerCase() !== desired) {
            continue;
        }
        return page;
    }

    return null;
}

function buildExportFileName(settings, sideOrFormat, maybeFormat) {
    const format = maybeFormat || sideOrFormat;
    const side = maybeFormat ? sideOrFormat : "";
    const baseName = `aj-print-layout-pro-${cleanText(settings && settings.sheetSize ? settings.sheetSize : "12x18").toLowerCase()}`;

    if (format === "pdf") {
        return `${baseName}.pdf`;
    }

    return `${baseName}${side === "back" ? "-back" : "-front"}.jpg`;
}

function buildSheetUploadMap(files) {
    const groupedFiles = groupFilesByField(files);
    const sourceBuffers = Object.create(null);

    Object.keys(groupedFiles).forEach(function (fieldName) {
        const file = groupedFiles[fieldName] && groupedFiles[fieldName][0];
        const buffer = getFileBuffer(file);
        if (!buffer) {
            return;
        }

        const aliases = buildFieldAliases(fieldName, file.originalname);
        aliases.forEach(function (alias) {
            assignSourceBuffer(sourceBuffers, alias, buffer);
        });
    });

    return sourceBuffers;
}

module.exports = {
    buildExportFileName,
    buildSheetUploadMap,
    buildSourceBufferMap,
    renderExportDocument,
    renderLegacyBusinessCardPages,
    renderLayoutPages,
    renderPreviewImage,
    parseSettings,
    toPixels
};

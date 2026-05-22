const os = require("os");

const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

const { cleanText } = require("../config");
const { createHttpError } = require("../utils/http");

const EXPORT_DPI = 300;
const PREVIEW_MAX_SIDE_PX = 2400;
const RGBA_CHANNELS = 4;
const DEFAULT_LIMIT_INPUT_PIXELS = 268402689;

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

function normalizePrintLayoutSettings(rawSettings) {
    const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const legacy = {
        toolId: cleanText(settings.toolId) || "business-card",
        sheetSize: cleanText(settings.sheetSize) || "12x18",
        orientation: cleanText(settings.orientation) === "portrait" ? "portrait" : "landscape",
        businessCardWidth: normalizeNumber(settings.businessCardWidth, 2.15, 1, 6),
        businessCardHeight: normalizeNumber(settings.businessCardHeight, 3.3, 1, 6),
        businessGapX: normalizeNumber(settings.businessGapX, 0.25, 0, 1),
        businessGapY: normalizeNumber(settings.businessGapY, 0.313, 0, 1),
        businessBorderMargin: normalizeNumber(settings.businessBorderMargin, 0.125, 0, 1),
        businessCardRotation: Number(settings.businessCardRotation) === 90 ? 90 : 0,
        businessFitToCard: Boolean(settings.businessFitToCard),
        businessCutMarks: settings.businessCutMarks !== false,
        previewBackgroundMode: cleanText(settings.previewBackgroundMode) === "color" ? "color" : "white",
        previewBackgroundColor: normalizeHexColor(settings.previewBackgroundColor, "#ffffff"),
        customWidth: normalizeNumber(settings.customWidth, 12, 4, 40),
        customHeight: normalizeNumber(settings.customHeight, 18, 4, 40),
        activeSide: cleanText(settings.activeSide) === "back" ? "back" : "front",
        businessCutLeft: normalizeNumber(settings.businessCutLeft, 2.402, 0, 12),
        businessCutTop: normalizeNumber(settings.businessCutTop, 3.585, 0, 18)
    };
    const sheet = normalizeSheetSpec(settings.sheet, legacy);
    const layoutInput = settings.layout && typeof settings.layout === "object"
        ? settings.layout
        : (
            Array.isArray(settings.pages) || Array.isArray(settings.items)
                ? {
                    version: settings.layoutVersion,
                    activeSide: settings.activeSide,
                    sheet: settings.sheet,
                    pages: settings.pages,
                    items: settings.items,
                    marks: settings.marks,
                    sources: settings.sources,
                    export: settings.export
                }
                : null
        );
    const layout = normalizeLayoutDefinition(layoutInput, sheet, legacy);

    return {
        toolId: legacy.toolId,
        sheetSize: legacy.sheetSize,
        orientation: legacy.orientation,
        businessCardWidth: legacy.businessCardWidth,
        businessCardHeight: legacy.businessCardHeight,
        businessGapX: legacy.businessGapX,
        businessGapY: legacy.businessGapY,
        businessBorderMargin: legacy.businessBorderMargin,
        businessCardRotation: legacy.businessCardRotation,
        businessFitToCard: legacy.businessFitToCard,
        businessCutMarks: legacy.businessCutMarks,
        previewBackgroundMode: legacy.previewBackgroundMode,
        previewBackgroundColor: legacy.previewBackgroundColor,
        customWidth: legacy.customWidth,
        customHeight: legacy.customHeight,
        activeSide: legacy.activeSide,
        businessCutLeft: legacy.businessCutLeft,
        businessCutTop: legacy.businessCutTop,
        sheet: sheet,
        layout: layout,
        pages: layout.pages,
        items: layout.items,
        marks: layout.marks,
        sources: layout.sources,
        export: layout.export
    };
}

function getSheetDimensions(settings) {
    if (settings && settings.sheet && Number.isFinite(Number(settings.sheet.width)) && Number.isFinite(Number(settings.sheet.height))) {
        const width = clamp(settings.sheet.width, 1, 40);
        const height = clamp(settings.sheet.height, 1, 40);
        if (cleanText(settings.sheet.orientation || settings.orientation) === "portrait") {
            return {
                width: Math.min(width, height),
                height: Math.max(width, height)
            };
        }

        return {
            width: Math.max(width, height),
            height: Math.min(width, height)
        };
    }

    if (settings.sheetSize === "Custom") {
        const width = clamp(settings.customWidth, 4, 40);
        const height = clamp(settings.customHeight, 4, 40);
        return settings.orientation === "portrait"
            ? { width: Math.min(width, height), height: Math.max(width, height) }
            : { width: Math.max(width, height), height: Math.min(width, height) };
    }

    const preset = getSheetPreset(settings.sheetSize);
    const width = Number(preset.width || 18);
    const height = Number(preset.height || 12);
    return settings.orientation === "portrait"
        ? { width: Math.min(width, height), height: Math.max(width, height) }
        : { width: Math.max(width, height), height: Math.min(width, height) };
}

function getBusinessCardLayout(settings, dimensions) {
    const cols = 5;
    const rows = 5;
    const isLandscapeCard = Number(settings.businessCardRotation) === 90;
    const cardWIn = isLandscapeCard
        ? clamp(settings.businessCardHeight, 1, 6)
        : clamp(settings.businessCardWidth, 1, 6);
    const cardHIn = isLandscapeCard
        ? clamp(settings.businessCardWidth, 1, 6)
        : clamp(settings.businessCardHeight, 1, 6);
    const gapMinXIn = isLandscapeCard
        ? clamp(settings.businessGapY, 0, 1)
        : clamp(settings.businessGapX, 0, 1);
    const gapMinYIn = isLandscapeCard
        ? clamp(settings.businessGapX, 0, 1)
        : clamp(settings.businessGapY, 0, 1);
    const marginIn = clamp(settings.businessBorderMargin, 0, 1);
    const usableWIn = Math.max(0, dimensions.width - marginIn * 2);
    const usableHIn = Math.max(0, dimensions.height - marginIn * 2);
    const minTotalWIn = cols * cardWIn + (cols - 1) * gapMinXIn;
    const minTotalHIn = rows * cardHIn + (rows - 1) * gapMinYIn;
    const fitScale = Math.min(
        1,
        usableWIn / Math.max(minTotalWIn, 0.001),
        usableHIn / Math.max(minTotalHIn, 0.001)
    );

    const drawCardWIn = cardWIn * fitScale;
    const drawCardHIn = cardHIn * fitScale;
    const gapXIn = cols > 1 ? Math.max(0, (usableWIn - cols * drawCardWIn) / (cols - 1)) : 0;
    const gapYIn = rows > 1 ? Math.max(0, (usableHIn - rows * drawCardHIn) / (rows - 1)) : 0;

    return {
        cols: cols,
        rows: rows,
        isLandscapeCard: isLandscapeCard,
        marginIn: marginIn,
        cardWIn: drawCardWIn,
        cardHIn: drawCardHIn,
        gapXIn: gapXIn,
        gapYIn: gapYIn
    };
}

function normalizeSheetSpec(rawSheet, legacy) {
    const fallback = getSheetDimensions(legacy);
    const sheet = rawSheet && typeof rawSheet === "object" ? rawSheet : {};
    const width = Number(sheet.width);
    const height = Number(sheet.height);
    const dpi = normalizePositiveNumber(sheet.dpi, EXPORT_DPI);
    const orientation = cleanText(sheet.orientation || legacy.orientation) === "portrait" ? "portrait" : "landscape";

    if (Number.isFinite(width) && Number.isFinite(height)) {
        return {
            width: clamp(width, 1, 40),
            height: clamp(height, 1, 40),
            dpi: dpi,
            orientation: orientation
        };
    }

    return {
        width: fallback.width,
        height: fallback.height,
        dpi: dpi,
        orientation: orientation
    };
}

function normalizeLayoutDefinition(rawLayout, sheet, legacy) {
    const layout = rawLayout && typeof rawLayout === "object" ? rawLayout : {};
    const normalizedSheet = normalizeSheetSpec(layout.sheet || sheet, legacy);
    const pages = Array.isArray(layout.pages) && layout.pages.length
        ? layout.pages.map(function (page) {
            return normalizeLayoutPage(page, normalizedSheet, legacy);
        })
        : (Array.isArray(layout.items) && layout.items.length
            ? [normalizeLayoutPage({
                side: layout.side || layout.activeSide || legacy.activeSide,
                sheet: layout.sheet || normalizedSheet,
                items: layout.items,
                marks: layout.marks,
                background: layout.background,
                sourceKey: layout.sourceKey,
                sourceRotation: layout.sourceRotation
            }, normalizedSheet, legacy)]
            : []);
    const firstPage = pages.length ? pages[0] : null;
    const items = firstPage ? firstPage.items.slice() : normalizeLayoutItems(layout.items);
    const marks = firstPage ? firstPage.marks.slice() : normalizeLayoutMarks(layout.marks);

    return {
        version: Math.max(1, Math.round(Number(layout.version) || 2)),
        activeSide: normalizeSide(layout.activeSide || legacy.activeSide),
        sheet: normalizedSheet,
        pages: pages,
        items: items,
        marks: marks,
        sources: normalizeLayoutSources(layout.sources),
        background: normalizeHexColor(layout.background, legacy.previewBackgroundMode === "color" ? legacy.previewBackgroundColor : "#ffffff"),
        export: normalizeLayoutExport(layout.export)
    };
}

function normalizeLayoutPage(rawPage, sheet, legacy) {
    const page = rawPage && typeof rawPage === "object" ? rawPage : {};
    const pageSheet = normalizeSheetSpec(page.sheet || sheet, legacy);
    const side = normalizeSide(page.side || page.imageKey || legacy.activeSide);

    return {
        side: side,
        sourceKey: cleanText(page.sourceKey || page.imageKey || side) || side,
        sourceRotation: normalizeRotation(page.sourceRotation),
        background: normalizeHexColor(page.background, legacy.previewBackgroundMode === "color" ? legacy.previewBackgroundColor : "#ffffff"),
        sheet: pageSheet,
        items: normalizeLayoutItems(page.items),
        marks: normalizeLayoutMarks(page.marks)
    };
}

function normalizeLayoutItems(items) {
    const list = Array.isArray(items) ? items : [];
    return list.map(normalizeLayoutItem).filter(Boolean);
}

function normalizeLayoutItem(rawItem) {
    const item = rawItem && typeof rawItem === "object" ? rawItem : {};
    const width = normalizeNumber(item.width, 1, 1, 100000);
    const height = normalizeNumber(item.height, 1, 1, 100000);

    return {
        imageKey: cleanText(item.imageKey || item.sourceKey || item.side || "front") || "front",
        sourceKey: cleanText(item.sourceKey || item.imageKey || item.side || "front") || "front",
        x: normalizeNumber(item.x, 0, 0, 100000),
        y: normalizeNumber(item.y, 0, 0, 100000),
        width: width,
        height: height,
        rotation: normalizeRotation(item.rotation),
        fit: normalizeLayoutFit(item.fit),
        inset: normalizeNumber(item.inset, 0, 0, 100000),
        kind: cleanText(item.kind) || "grid",
        index: Math.max(1, Math.round(Number(item.index) || 1))
    };
}

function normalizeLayoutMarks(marks) {
    const list = Array.isArray(marks) ? marks : [];
    return list.map(function (mark) {
        const entry = mark && typeof mark === "object" ? mark : {};
        return {
            x1: normalizeNumber(entry.x1, 0, -100000, 100000),
            y1: normalizeNumber(entry.y1, 0, -100000, 100000),
            x2: normalizeNumber(entry.x2, 0, -100000, 100000),
            y2: normalizeNumber(entry.y2, 0, -100000, 100000),
            stroke: cleanText(entry.stroke) || "rgba(15, 23, 42, 0.45)",
            strokeWidth: normalizeNumber(entry.strokeWidth, 1.2, 0.1, 20)
        };
    });
}

function normalizeLayoutSources(rawSources) {
    const sources = rawSources && typeof rawSources === "object" ? rawSources : {};
    const normalized = {};

    Object.keys(sources).forEach(function (key) {
        const entry = sources[key];
        if (!entry || typeof entry !== "object") {
            return;
        }

        normalized[key] = {
            side: normalizeSide(entry.side || key),
            name: cleanText(entry.name) || cleanText(entry.fileName) || key,
            fileName: cleanText(entry.fileName) || cleanText(entry.name) || key,
            mimeType: cleanText(entry.mimeType) || "",
            rotation: normalizeRotation(entry.rotation),
            sourceKind: cleanText(entry.sourceKind) || "original-file"
        };
    });

    return normalized;
}

function normalizeLayoutExport(rawExport) {
    const exportInfo = rawExport && typeof rawExport === "object" ? rawExport : {};
    return {
        format: cleanText(exportInfo.format) === "jpg" ? "jpg" : "pdf"
    };
}

function normalizeLayoutFit(value) {
    const fit = cleanText(value).toLowerCase();
    if (fit === "contain" || fit === "stretch" || fit === "fill") {
        return fit === "fill" ? "stretch" : fit;
    }
    return "cover";
}

function normalizeSide(value) {
    return cleanText(value).toLowerCase() === "back" ? "back" : "front";
}

function normalizeRotation(value) {
    const numeric = Math.round(Number(value) || 0);
    const normalized = ((numeric % 360) + 360) % 360;
    return normalized;
}

async function createLayoutPageBuffers(sourceBuffers, settings) {
    const layout = settings && settings.layout && typeof settings.layout === "object" ? settings.layout : null;
    if (!layout) {
        return [];
    }

    const pages = Array.isArray(layout.pages) && layout.pages.length
        ? layout.pages
        : (Array.isArray(layout.items) && layout.items.length
            ? [normalizeLayoutPage({
                side: layout.activeSide || settings.activeSide,
                sheet: layout.sheet || settings.sheet,
                items: layout.items,
                marks: layout.marks,
                background: layout.background,
                sourceKey: layout.sourceKey,
                sourceRotation: layout.sourceRotation
            }, settings.sheet || getSheetDimensions(settings), settings)]
            : []);

    if (!pages.length) {
        return [];
    }

    const renderedPages = [];

    for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        const buffer = await createLayoutPageBuffer(sourceBuffers, page, settings);
        if (buffer) {
            renderedPages.push({
                side: normalizeSide(page.side || settings.activeSide),
                buffer: buffer
            });
        }
    }

    return renderedPages;
}

async function createLayoutPageBuffer(sourceBuffers, page, settings) {
    const sheet = normalizeSheetSpec(page.sheet || settings.sheet || getSheetDimensions(settings), settings);
    const sheetWidthPx = Math.max(1, Math.round(sheet.width * sheet.dpi));
    const sheetHeightPx = Math.max(1, Math.round(sheet.height * sheet.dpi));
    const background = normalizeHexColor(page.background || (settings.previewBackgroundMode === "color" ? settings.previewBackgroundColor : "#ffffff"), "#ffffff");
    const composites = [];
    const sourceCache = new Map();
    const items = Array.isArray(page.items) ? page.items : [];

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item || typeof item !== "object") {
            continue;
        }

        const resolvedSource = resolveLayoutSourceBuffer(sourceBuffers, item, page);
        if (!resolvedSource || !Buffer.isBuffer(resolvedSource.buffer) || !resolvedSource.buffer.length) {
            continue;
        }

        const rotation = normalizeRotation(item.rotation != null ? item.rotation : page.sourceRotation);
        const cacheKey = resolvedSource.key + ":" + rotation;
        let sourcePipeline = sourceCache.get(cacheKey);
        if (!sourcePipeline) {
            sourcePipeline = sharp(resolvedSource.buffer, SHARP_INPUT_OPTIONS)
                .rotate(rotation)
                .ensureAlpha();
            sourceCache.set(cacheKey, sourcePipeline);
        }

        const itemWidthPx = Math.max(1, Math.round(Number(item.width) || 1));
        const itemHeightPx = Math.max(1, Math.round(Number(item.height) || 1));
        const insetPx = Math.max(0, Math.round(Number(item.inset) || 0));
        const renderWidthPx = Math.max(1, itemWidthPx - insetPx * 2);
        const renderHeightPx = Math.max(1, itemHeightPx - insetPx * 2);
        const fit = normalizeLayoutFit(item.fit);

        const itemBuffer = await sourcePipeline.clone()
            .resize({
                width: renderWidthPx,
                height: renderHeightPx,
                fit: fit === "stretch" ? "fill" : fit,
                withoutEnlargement: false
            })
            .flatten({ background: background })
            .ensureAlpha()
            .toBuffer();

        composites.push({
            input: itemBuffer,
            left: Math.round(Number(item.x) || 0) + insetPx,
            top: Math.round(Number(item.y) || 0) + insetPx
        });
    }

    if (Array.isArray(page.marks) && page.marks.length) {
        composites.push({
            input: Buffer.from(buildLayoutMarksSvg(page.marks, sheetWidthPx, sheetHeightPx)),
            left: 0,
            top: 0
        });
    }

    if (!composites.length) {
        return null;
    }

    return sharp({
        create: {
            width: sheetWidthPx,
            height: sheetHeightPx,
            channels: RGBA_CHANNELS,
            background: background
        }
    })
        .composite(composites)
        .jpeg({
            quality: normalizeJpegQuality(process.env.EXPORT_JPEG_QUALITY, 92),
            mozjpeg: false,
            chromaSubsampling: "4:4:4"
        })
        .toBuffer();
}

function resolveLayoutSourceBuffer(sourceBuffers, item, page) {
    const sources = sourceBuffers && typeof sourceBuffers === "object" ? sourceBuffers : {};
    const primaryKey = cleanText(item && (item.imageKey || item.sourceKey || page.sourceKey || page.side || "front")) || "front";
    const fallbacks = [primaryKey, "front", "back"];

    for (let i = 0; i < fallbacks.length; i += 1) {
        const key = fallbacks[i];
        const buffer = sources[key];
        if (Buffer.isBuffer(buffer) && buffer.length) {
            return { key: key, buffer: buffer };
        }
    }

    return null;
}

function buildLayoutMarksSvg(marks, sheetWidthPx, sheetHeightPx) {
    const lines = [];

    for (let i = 0; i < marks.length; i += 1) {
        const mark = marks[i];
        if (!mark) {
            continue;
        }

        const x1 = Number(mark.x1);
        const y1 = Number(mark.y1);
        const x2 = Number(mark.x2);
        const y2 = Number(mark.y2);
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
            continue;
        }

        const stroke = escapeXml(cleanText(mark.stroke) || "rgba(15, 23, 42, 0.45)");
        const strokeWidth = Math.max(0.1, Number(mark.strokeWidth) || 1.2);
        lines.push(`<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" />`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidthPx}" height="${sheetHeightPx}" viewBox="0 0 ${sheetWidthPx} ${sheetHeightPx}">
  <rect x="0" y="0" width="${sheetWidthPx}" height="${sheetHeightPx}" fill="none" />
  ${lines.join("\n  ")}
</svg>`;
}

function escapeXml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function createBusinessCardPreviewBuffer(fileBuffer) {
    return sharp(fileBuffer, SHARP_INPUT_OPTIONS)
        .rotate()
        .resize({
            width: PREVIEW_MAX_SIDE_PX,
            height: PREVIEW_MAX_SIDE_PX,
            fit: "inside",
            withoutEnlargement: true
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: normalizeJpegQuality(process.env.PREVIEW_JPEG_QUALITY, 86), mozjpeg: false, chromaSubsampling: "4:2:0" })
        .toBuffer();
}

async function buildBusinessCardSheetPipeline(sourceBuffer, settings, sheetDimensions) {
    if (settings.toolId !== "business-card") {
        throw createHttpError(400, "Print layout backend currently supports Business Card mode only.");
    }

    const layout = getBusinessCardLayout(settings, sheetDimensions);
    const sheetWidthPx = Math.max(1, Math.round(sheetDimensions.width * EXPORT_DPI));
    const sheetHeightPx = Math.max(1, Math.round(sheetDimensions.height * EXPORT_DPI));
    const background = settings.previewBackgroundMode === "color"
        ? normalizeHexColor(settings.previewBackgroundColor, "#ffffff")
        : "#ffffff";
    const tile = await createBusinessCardTileRawBuffer(
        sourceBuffer,
        layout,
        EXPORT_DPI,
        settings.businessFitToCard,
        background
    );
    const overlays = buildSheetTileOverlays(tile, layout, EXPORT_DPI, sheetWidthPx, sheetHeightPx, background, settings.businessCutMarks);

    return sharp({
        create: {
            width: sheetWidthPx,
            height: sheetHeightPx,
            channels: RGBA_CHANNELS,
            background: background
        }
    })
        .composite(overlays)
        .jpeg({
            quality: normalizeJpegQuality(process.env.EXPORT_JPEG_QUALITY, 92),
            mozjpeg: false,
            chromaSubsampling: "4:4:4"
        });
}

async function createBusinessCardSheetBuffer(sourceBuffer, settings, sheetDimensions) {
    return buildBusinessCardSheetPipeline(sourceBuffer, settings, sheetDimensions).then(function (pipeline) {
        return pipeline.toBuffer();
    });
}

function createBusinessCardSheetStream(sourceBuffer, settings, sheetDimensions) {
    return buildBusinessCardSheetPipeline(sourceBuffer, settings, sheetDimensions);
}

async function createBusinessCardTileRawBuffer(sourceBuffer, layout, dpi, fitToCard, background) {
    const cardWidthPx = Math.max(1, Math.round(layout.cardWIn * dpi));
    const cardHeightPx = Math.max(1, Math.round(layout.cardHIn * dpi));
    const inset = Math.max(2, Math.round(Math.min(cardWidthPx, cardHeightPx) * 0.08));
    const innerWidth = Math.max(1, cardWidthPx - inset * 2);
    const innerHeight = Math.max(1, cardHeightPx - inset * 2);

    if (fitToCard) {
        return sharp(sourceBuffer, SHARP_INPUT_OPTIONS)
            .rotate()
            .resize({
                width: cardWidthPx,
                height: cardHeightPx,
                fit: "fill",
                withoutEnlargement: false
            })
            .flatten({ background: background })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
    }

    const image = await sharp(sourceBuffer, SHARP_INPUT_OPTIONS)
        .rotate()
        .resize({
            width: innerWidth,
            height: innerHeight,
            fit: "inside",
            withoutEnlargement: false
        })
        .flatten({ background: background })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const imageLeft = inset + Math.max(0, Math.round((innerWidth - Number(image.info.width || 0)) / 2));
    const imageTop = inset + Math.max(0, Math.round((innerHeight - Number(image.info.height || 0)) / 2));

    return sharp({
        create: {
            width: cardWidthPx,
            height: cardHeightPx,
            channels: RGBA_CHANNELS,
            background: background
        }
    })
        .composite([
            {
                input: image.data,
                raw: {
                    width: Math.max(1, Number(image.info.width) || 1),
                    height: Math.max(1, Number(image.info.height) || 1),
                    channels: RGBA_CHANNELS
                },
                left: imageLeft,
                top: imageTop
            }
        ])
        .raw()
        .toBuffer({ resolveWithObject: true });
}

async function buildLayoutPdfBuffer(pages, dimensions) {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle("AJ Print Layout Pro export");
    pdfDoc.setAuthor("AJartivo");
    pdfDoc.setProducer("AJartivo Print Layout Backend");
    pdfDoc.setCreator("AJartivo Print Layout Backend");
    pdfDoc.setSubject("Print layout export");

    const widthIn = Number(dimensions && dimensions.width) || 1;
    const heightIn = Number(dimensions && dimensions.height) || 1;
    const width = Math.max(1, widthIn * 72);
    const height = Math.max(1, heightIn * 72);

    for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        if (!page || !Buffer.isBuffer(page.jpegBuffer) || !page.jpegBuffer.length) {
            continue;
        }

        const embedded = await pdfDoc.embedJpg(page.jpegBuffer);
        const pdfPage = pdfDoc.addPage([width, height]);
        pdfPage.drawImage(embedded, {
            x: 0,
            y: 0,
            width: width,
            height: height
        });
    }

    const bytes = await pdfDoc.save({ useObjectStreams: false });
    return Buffer.from(bytes);
}

function buildSheetTileOverlays(tile, layout, dpi, sheetWidthPx, sheetHeightPx, background, includeCutMarks) {
    const overlays = [];
    const tileWidthPx = Math.max(1, Number(tile.info.width) || 1);
    const tileHeightPx = Math.max(1, Number(tile.info.height) || 1);
    const rawTile = {
        input: tile.data,
        raw: {
            width: tileWidthPx,
            height: tileHeightPx,
            channels: RGBA_CHANNELS
        }
    };

    for (let row = 0; row < layout.rows; row += 1) {
        for (let col = 0; col < layout.cols; col += 1) {
            const left = Math.round((layout.marginIn + col * (layout.cardWIn + layout.gapXIn)) * dpi);
            const top = Math.round((layout.marginIn + row * (layout.cardHIn + layout.gapYIn)) * dpi);
            overlays.push({
                input: rawTile.input,
                raw: rawTile.raw,
                left: left,
                top: top
            });
        }
    }

    if (includeCutMarks) {
        overlays.push({
            input: Buffer.from(buildBusinessCutMarksSvg(layout, sheetWidthPx, sheetHeightPx, dpi, background)),
            left: 0,
            top: 0
        });
    }

    return overlays;
}

function buildBusinessCutMarksSvg(layout, sheetWidthPx, sheetHeightPx, dpi, _background) {
    const marginPx = layout.marginIn * dpi;
    const cardW = layout.cardWIn * dpi;
    const cardH = layout.cardHIn * dpi;
    const gapX = layout.gapXIn * dpi;
    const gapY = layout.gapYIn * dpi;
    const startX = marginPx + Math.max(0, ((sheetWidthPx - marginPx * 2) - (layout.cols * cardW + (layout.cols - 1) * gapX)) / 2);
    const startY = marginPx + Math.max(0, ((sheetHeightPx - marginPx * 2) - (layout.rows * cardH + (layout.rows - 1) * gapY)) / 2);
    const size = Math.max(4, Math.min(gapX, gapY) * 0.25);
    const markColor = "rgba(15, 23, 42, 0.6)";
    const lines = [];

    for (let row = 0; row < layout.rows - 1; row += 1) {
        for (let col = 0; col < layout.cols - 1; col += 1) {
            const x = startX + cardW + (gapX / 2) + col * (cardW + gapX);
            const y = startY + cardH + (gapY / 2) + row * (cardH + gapY);
            lines.push(`<line x1="${round(x - size / 2)}" y1="${round(y)}" x2="${round(x + size / 2)}" y2="${round(y)}" stroke="${markColor}" stroke-width="1.2" stroke-linecap="round" />`);
            lines.push(`<line x1="${round(x)}" y1="${round(y - size / 2)}" x2="${round(x)}" y2="${round(y + size / 2)}" stroke="${markColor}" stroke-width="1.2" stroke-linecap="round" />`);
        }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidthPx}" height="${sheetHeightPx}" viewBox="0 0 ${sheetWidthPx} ${sheetHeightPx}">
  <rect x="0" y="0" width="${sheetWidthPx}" height="${sheetHeightPx}" fill="none" />
  ${lines.join("\n  ")}
</svg>`;
}

function normalizeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return clamp(parsed, min, max);
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
    return clamp(Math.round(parsed), 1, 100);
}

function normalizeHexColor(value, fallback) {
    const text = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(text) || /^#[0-9a-fA-F]{3}$/.test(text)) {
        return text;
    }
    return fallback;
}

function getSheetPreset(sheetSize) {
    const presets = {
        "12x18": { width: 18, height: 12 },
        A4: { width: 11.69, height: 8.27 },
        A3: { width: 16.54, height: 11.69 },
        "13x19": { width: 19, height: 13 },
        Letter: { width: 11, height: 8.5 },
        Legal: { width: 14, height: 8.5 },
        Custom: { width: 18, height: 12 }
    };

    return presets[sheetSize] || presets["12x18"];
}

function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return min;
    }
    return Math.max(min, Math.min(max, numeric));
}

function round(value) {
    return Math.round(Number(value) || 0);
}

module.exports = {
    buildLayoutPdfBuffer,
    buildBusinessCardSheetPipeline,
    createBusinessCardPreviewBuffer,
    createBusinessCardSheetBuffer,
    createBusinessCardSheetStream,
    createLayoutPageBuffers,
    getBusinessCardLayout,
    getSheetDimensions,
    normalizePrintLayoutSettings
};

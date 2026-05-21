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

    return {
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
        customHeight: normalizeNumber(settings.customHeight, 18, 4, 40)
    };
}

function getSheetDimensions(settings) {
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
    getBusinessCardLayout,
    getSheetDimensions,
    normalizePrintLayoutSettings
};

const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

const { createHttpError } = require("./http");

const EXPORT_DPI = 300;
const PREVIEW_MAX_SIDE_PX = 2400;
const RGBA_CHANNELS = 4;

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
    const prepared = sharp(fileBuffer, { animated: true, failOn: "none" }).rotate();
    const metadata = await prepared.metadata();
    const maxSide = Math.max(Number(metadata.width) || 0, Number(metadata.height) || 0);
    const base = maxSide > PREVIEW_MAX_SIDE_PX
        ? prepared.resize({
            width: PREVIEW_MAX_SIDE_PX,
            height: PREVIEW_MAX_SIDE_PX,
            fit: "inside",
            withoutEnlargement: true
        })
        : prepared;

    return base
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 84, mozjpeg: false, chromaSubsampling: "4:2:0" })
        .toBuffer();
}

async function createBusinessCardSheetBuffer(sourceBuffer, settings, sheetDimensions) {
    if (settings.toolId !== "business-card") {
        throw createHttpError(400, "Print layout backend currently supports Business Card mode only.");
    }

    const layout = getBusinessCardLayout(settings, sheetDimensions);
    const sheetWidthPx = Math.max(1, Math.round(sheetDimensions.width * EXPORT_DPI));
    const sheetHeightPx = Math.max(1, Math.round(sheetDimensions.height * EXPORT_DPI));
    const background = settings.previewBackgroundMode === "color"
        ? normalizeHexColor(settings.previewBackgroundColor, "#ffffff")
        : "#ffffff";
    const backgroundRgba = parseHexColorToRgba(background);
    const tile = await createBusinessCardTileRawBuffer(
        sourceBuffer,
        layout,
        EXPORT_DPI,
        settings.businessFitToCard,
        backgroundRgba
    );
    const sheet = createSolidRgbaBuffer(sheetWidthPx, sheetHeightPx, backgroundRgba);
    const tileWidthPx = Number(tile.info.width) || 1;
    const tileHeightPx = Number(tile.info.height) || 1;

    for (let row = 0; row < layout.rows; row += 1) {
        for (let col = 0; col < layout.cols; col += 1) {
            const left = Math.round((layout.marginIn + col * (layout.cardWIn + layout.gapXIn)) * EXPORT_DPI);
            const top = Math.round((layout.marginIn + row * (layout.cardHIn + layout.gapYIn)) * EXPORT_DPI);
            blitRgbaBuffer(sheet, sheetWidthPx, sheetHeightPx, tile.data, tileWidthPx, tileHeightPx, left, top);
        }
    }

    return sharp(sheet, {
        raw: {
            width: sheetWidthPx,
            height: sheetHeightPx,
            channels: RGBA_CHANNELS
        }
    })
        .jpeg({ quality: 80, mozjpeg: false, chromaSubsampling: "4:2:0" })
        .toBuffer();
}

async function createBusinessCardTileRawBuffer(sourceBuffer, layout, dpi, fitToCard, backgroundRgba) {
    const cardWidthPx = Math.max(1, Math.round(layout.cardWIn * dpi));
    const cardHeightPx = Math.max(1, Math.round(layout.cardHIn * dpi));
    const inset = Math.max(2, Math.round(Math.min(cardWidthPx, cardHeightPx) * 0.08));
    const innerWidth = Math.max(1, cardWidthPx - inset * 2);
    const innerHeight = Math.max(1, cardHeightPx - inset * 2);
    const background = rgbaToBackgroundValue(backgroundRgba);

    if (fitToCard) {
        return sharp(sourceBuffer, { animated: true, failOn: "none" })
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

    const image = await sharp(sourceBuffer, { animated: true, failOn: "none" })
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

    const tile = createSolidRgbaBuffer(cardWidthPx, cardHeightPx, backgroundRgba);
    const imageLeft = inset + Math.max(0, Math.round((innerWidth - Number(image.info.width || 0)) / 2));
    const imageTop = inset + Math.max(0, Math.round((innerHeight - Number(image.info.height || 0)) / 2));
    blitRgbaBuffer(
        tile,
        cardWidthPx,
        cardHeightPx,
        image.data,
        Number(image.info.width) || 1,
        Number(image.info.height) || 1,
        imageLeft,
        imageTop
    );

    return {
        data: tile,
        info: {
            width: cardWidthPx,
            height: cardHeightPx,
            channels: RGBA_CHANNELS
        }
    };
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

function normalizeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed, min, max);
}

function normalizeHexColor(value, fallback) {
    const text = String(value || "").trim();
    if (/^#[0-9a-fA-F]{3}$/.test(text) || /^#[0-9a-fA-F]{6}$/.test(text)) {
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

function cleanText(value) {
    return String(value || "").trim();
}

function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.max(min, Math.min(max, numeric));
}

function parseHexColorToRgba(value) {
    const normalized = normalizeHexColor(value, "#ffffff").slice(1);
    const expanded = normalized.length === 3
        ? normalized.split("").map(function (part) {
            return part + part;
        }).join("")
        : normalized.padEnd(6, "f");
    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);

    return {
        red: Number.isFinite(red) ? red : 255,
        green: Number.isFinite(green) ? green : 255,
        blue: Number.isFinite(blue) ? blue : 255,
        alpha: 255
    };
}

function rgbaToBackgroundValue(rgba) {
    const color = rgba || { red: 255, green: 255, blue: 255, alpha: 255 };
    return {
        r: clamp(Math.round(color.red), 0, 255),
        g: clamp(Math.round(color.green), 0, 255),
        b: clamp(Math.round(color.blue), 0, 255),
        alpha: clamp(Math.round(color.alpha), 0, 255)
    };
}

function createSolidRgbaBuffer(width, height, rgba) {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const totalBytes = safeWidth * safeHeight * RGBA_CHANNELS;
    const color = rgba || { red: 255, green: 255, blue: 255, alpha: 255 };

    if (color.red === 255 && color.green === 255 && color.blue === 255 && color.alpha === 255) {
        return Buffer.alloc(totalBytes, 255);
    }

    const row = Buffer.allocUnsafe(safeWidth * RGBA_CHANNELS);
    for (let x = 0; x < safeWidth; x += 1) {
        const offset = x * RGBA_CHANNELS;
        row[offset] = color.red;
        row[offset + 1] = color.green;
        row[offset + 2] = color.blue;
        row[offset + 3] = color.alpha;
    }

    const buffer = Buffer.allocUnsafe(totalBytes);
    for (let y = 0; y < safeHeight; y += 1) {
        row.copy(buffer, y * row.length);
    }

    return buffer;
}

function blitRgbaBuffer(dest, destWidth, destHeight, src, srcWidth, srcHeight, left, top) {
    const safeDestWidth = Math.max(1, Math.round(destWidth));
    const safeDestHeight = Math.max(1, Math.round(destHeight));
    const safeSrcWidth = Math.max(1, Math.round(srcWidth));
    const safeSrcHeight = Math.max(1, Math.round(srcHeight));
    const startX = Math.max(0, Math.round(left));
    const startY = Math.max(0, Math.round(top));
    const endX = Math.min(safeSrcWidth, safeDestWidth - startX);
    const endY = Math.min(safeSrcHeight, safeDestHeight - startY);

    if (endX <= 0 || endY <= 0) {
        return;
    }

    const srcRowBytes = safeSrcWidth * RGBA_CHANNELS;
    const copyBytes = endX * RGBA_CHANNELS;

    for (let row = 0; row < endY; row += 1) {
        const srcOffset = row * srcRowBytes;
        const destOffset = ((startY + row) * safeDestWidth + startX) * RGBA_CHANNELS;
        src.copy(dest, destOffset, srcOffset, srcOffset + copyBytes);
    }
}

module.exports = {
    normalizePrintLayoutSettings,
    getSheetDimensions,
    createBusinessCardPreviewBuffer,
    createBusinessCardSheetBuffer,
    buildLayoutPdfBuffer
};

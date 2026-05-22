function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return min;
    }
    return Math.max(min, Math.min(max, numeric));
}

function normalizeRotation(value) {
    const numeric = Math.round(Number(value) || 0);
    return ((numeric % 360) + 360) % 360;
}

function normalizeSide(value) {
    return String(value || "").trim().toLowerCase() === "back" ? "back" : "front";
}

function normalizeFit(value) {
    const fit = String(value || "").trim().toLowerCase();
    if (fit === "contain" || fit === "stretch" || fit === "fill") {
        return fit === "fill" ? "stretch" : fit;
    }
    return "cover";
}

function toPixels(inches, dpi) {
    const resolvedInches = Number(inches);
    const resolvedDpi = Number(dpi);
    if (!Number.isFinite(resolvedInches) || !Number.isFinite(resolvedDpi) || resolvedDpi <= 0) {
        return 0;
    }
    return Math.max(0, Math.round(resolvedInches * resolvedDpi));
}

function toInches(px, dpi) {
    const resolvedPx = Number(px);
    const resolvedDpi = Number(dpi);
    if (!Number.isFinite(resolvedPx) || !Number.isFinite(resolvedDpi) || resolvedDpi <= 0) {
        return 0;
    }
    return resolvedPx / resolvedDpi;
}

function getSheetPixelDimensions(sheet) {
    const resolvedSheet = sheet && typeof sheet === "object" ? sheet : {};
    const dpi = clamp(resolvedSheet.dpi, 72, 1200);
    const width = clamp(resolvedSheet.width, 1, 40);
    const height = clamp(resolvedSheet.height, 1, 40);
    return {
        widthPx: Math.max(1, Math.round(width * dpi)),
        heightPx: Math.max(1, Math.round(height * dpi)),
        dpi: dpi,
        widthIn: width,
        heightIn: height
    };
}

function getPlacementPixels(item, dpi) {
    const placement = item && typeof item === "object" ? item : {};
    return {
        x: toPixels(placement.x, dpi),
        y: toPixels(placement.y, dpi),
        width: Math.max(1, toPixels(placement.width, dpi)),
        height: Math.max(1, toPixels(placement.height, dpi)),
        inset: Math.max(0, toPixels(placement.inset, dpi)),
        rotation: normalizeRotation(placement.rotation)
    };
}

module.exports = {
    clamp,
    getPlacementPixels,
    getSheetPixelDimensions,
    normalizeFit,
    normalizeRotation,
    normalizeSide,
    toInches,
    toPixels
};

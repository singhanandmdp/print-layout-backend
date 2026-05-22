const { createSharpInstance, normalizeJpegQuality, PREVIEW_MAX_SIDE_PX } = require("../utils/sharp");

async function createPreviewBuffer(fileBuffer, options) {
    const previewOptions = options && typeof options === "object" ? options : {};
    const maxSidePx = Math.max(1, Number(previewOptions.maxSidePx) || PREVIEW_MAX_SIDE_PX);
    const quality = normalizeJpegQuality(previewOptions.quality || process.env.PREVIEW_JPEG_QUALITY, 86);
    const background = String(previewOptions.background || "#ffffff").trim() || "#ffffff";

    return createSharpInstance(fileBuffer)
        .rotate()
        .resize({
            width: maxSidePx,
            height: maxSidePx,
            fit: "inside",
            withoutEnlargement: true
        })
        .flatten({ background: background })
        .jpeg({
            quality: quality,
            mozjpeg: false,
            chromaSubsampling: "4:2:0"
        })
        .toBuffer();
}

module.exports = {
    createPreviewBuffer
};

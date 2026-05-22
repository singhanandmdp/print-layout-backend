const { PDFDocument } = require("pdf-lib");

const { cleanText } = require("../config");

async function buildPdfBuffer(pages, fallbackDimensions, metadata) {
    const pdfDoc = await PDFDocument.create();
    const info = metadata && typeof metadata === "object" ? metadata : {};

    pdfDoc.setTitle(cleanText(info.title) || "AJ Print Layout Pro export");
    pdfDoc.setAuthor(cleanText(info.author) || "AJartivo");
    pdfDoc.setProducer(cleanText(info.producer) || "AJartivo Print Layout Backend");
    pdfDoc.setCreator(cleanText(info.creator) || "AJartivo Print Layout Backend");
    pdfDoc.setSubject(cleanText(info.subject) || "Print layout export");

    const list = Array.isArray(pages) ? pages : [];
    for (let i = 0; i < list.length; i += 1) {
        const page = list[i];
        const jpegBuffer = getPageBuffer(page);
        if (!jpegBuffer) {
            continue;
        }

        const dimensions = resolvePageDimensions(page, fallbackDimensions);
        const width = Math.max(1, Number(dimensions.width) || 1) * 72;
        const height = Math.max(1, Number(dimensions.height) || 1) * 72;
        const embedded = await pdfDoc.embedJpg(jpegBuffer);
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

function getPageBuffer(page) {
    if (!page || typeof page !== "object") {
        return null;
    }

    if (Buffer.isBuffer(page.jpegBuffer) && page.jpegBuffer.length) {
        return page.jpegBuffer;
    }

    if (Buffer.isBuffer(page.buffer) && page.buffer.length) {
        return page.buffer;
    }

    if (Buffer.isBuffer(page.data) && page.data.length) {
        return page.data;
    }

    return null;
}

function resolvePageDimensions(page, fallbackDimensions) {
    const sheet = page && page.sheet && typeof page.sheet === "object" ? page.sheet : null;
    const dimensions = page && page.dimensions && typeof page.dimensions === "object" ? page.dimensions : null;
    const source = sheet || dimensions || fallbackDimensions || {};
    const width = Number(source.width) || 1;
    const height = Number(source.height) || 1;

    return {
        width: width,
        height: height
    };
}

module.exports = {
    buildPdfBuffer
};

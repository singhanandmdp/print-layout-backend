const { cleanText } = require("../config");
const { createHttpError } = require("./http");

const IMAGE_MIME_PATTERN = /^image\/(png|jpe?g|webp|avif|gif|bmp|heic|heif|tiff?)$/i;
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|avif|gif|bmp|heic|heif|tiff?|tif)$/i;
const EXPORT_MIME_PATTERN = /^(image\/(png|jpe?g|webp|avif|gif|bmp|heic|heif|tiff?)|application\/pdf)$/i;
const EXPORT_FILE_PATTERN = /\.(png|jpe?g|webp|avif|gif|bmp|heic|heif|tiff?|tif|pdf)$/i;

function parseJsonPayload(rawValue, message) {
    const text = cleanText(rawValue);
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (_error) {
        throw createHttpError(400, message || "Payload JSON is invalid.");
    }
}

function normalizeFieldKey(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function buildFieldAliases(fieldName, originalName) {
    const aliases = new Set();
    const rawFieldName = cleanText(fieldName);
    const normalizedFieldName = normalizeFieldKey(rawFieldName);

    if (rawFieldName) {
        aliases.add(rawFieldName);
    }

    if (normalizedFieldName) {
        aliases.add(normalizedFieldName);
    }

    const strippedFieldName = normalizedFieldName.replace(/(file|image|preview|sheet|upload)$/i, "");
    if (strippedFieldName) {
        aliases.add(strippedFieldName);
    }

    const originalBase = normalizeFieldKey(String(originalName || "").replace(/\.[^.]+$/, ""));
    if (originalBase) {
        aliases.add(originalBase);
    }

    return Array.from(aliases).filter(Boolean);
}

function collectMultipartFiles(files) {
    return Array.isArray(files) ? files.filter(Boolean) : [];
}

function groupFilesByField(files) {
    const grouped = {};
    const list = collectMultipartFiles(files);

    for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        const fieldName = cleanText(file && file.fieldname);
        if (!fieldName) {
            continue;
        }

        if (!grouped[fieldName]) {
            grouped[fieldName] = [];
        }

        grouped[fieldName].push(file);
    }

    return grouped;
}

function getFirstUploadedFile(files, fieldNames) {
    const grouped = files && typeof files === "object" ? files : {};
    const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];

    for (let i = 0; i < names.length; i += 1) {
        const fieldName = cleanText(names[i]);
        const list = grouped[fieldName];
        if (Array.isArray(list) && list.length > 0) {
            return list[0];
        }
    }

    return null;
}

function isSupportedImageMimeType(mimeType) {
    return IMAGE_MIME_PATTERN.test(cleanText(mimeType));
}

function isSupportedImageFile(file) {
    if (!file || typeof file !== "object") {
        return false;
    }

    if (isSupportedImageMimeType(file.mimetype)) {
        return true;
    }

    return IMAGE_FILE_PATTERN.test(cleanText(file.originalname));
}

function isSupportedExportFile(file) {
    if (!file || typeof file !== "object") {
        return false;
    }

    if (EXPORT_MIME_PATTERN.test(cleanText(file.mimetype))) {
        return true;
    }

    return EXPORT_FILE_PATTERN.test(cleanText(file.originalname));
}

function getFileBuffer(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
        return null;
    }

    return file.buffer;
}

function assertFileBuffer(file, message) {
    const buffer = getFileBuffer(file);
    if (!buffer) {
        throw createHttpError(400, message || "Uploaded file is missing or empty.");
    }
    return buffer;
}

function describeUploadedFiles(files) {
    const list = collectMultipartFiles(files);
    return list.map(function (file) {
        return {
            field: cleanText(file.fieldname),
            name: cleanText(file.originalname),
            size: Number(file.size) || (Buffer.isBuffer(file.buffer) ? file.buffer.length : 0),
            mimeType: cleanText(file.mimetype)
        };
    });
}

module.exports = {
    assertFileBuffer,
    buildFieldAliases,
    collectMultipartFiles,
    describeUploadedFiles,
    getFileBuffer,
    getFirstUploadedFile,
    groupFilesByField,
    isSupportedImageFile,
    isSupportedExportFile,
    isSupportedImageMimeType,
    normalizeFieldKey,
    parseJsonPayload
};

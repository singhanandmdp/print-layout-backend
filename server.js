const app = require("./app");
const { config } = require("./config");

if (require.main === module) {
    app.listen(config.port, function () {
        console.log(`[AJartivo Print Layout Backend] running on http://localhost:${config.port}`);
        console.log("[AJartivo Print Layout Backend] Allowed origins", config.frontendOrigins);
        console.log("[AJartivo Print Layout Backend] Preview limit", `${Math.round(config.uploads.maxPreviewFileSizeBytes / 1024 / 1024)} MB`);
        console.log("[AJartivo Print Layout Backend] Export limit", `${Math.round(config.uploads.maxExportFileSizeBytes / 1024 / 1024)} MB`);
    });
}

module.exports = app;

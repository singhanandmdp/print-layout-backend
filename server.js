const cors = require("cors");
const express = require("express");

const { cleanText, config } = require("./config");
const { errorHandler, notFoundHandler } = require("./utils/http");
const printLayoutRoutes = require("./routes/printLayout");

const app = express();
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || config.frontendOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error("Origin not allowed by CORS."));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-File-Name", "X-File-Type", "X-Upload-Kind"],
    exposedHeaders: ["Content-Disposition"]
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(printLayoutRoutes);

app.get("/health", function (_req, res) {
    res.json({
        success: true,
        service: "AJartivo print-layout backend",
        port: config.port
    });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, function () {
    console.log(`[AJartivo Print Layout Backend] running on http://localhost:${config.port}`);
    console.log("[AJartivo Print Layout Backend] Allowed origins", config.frontendOrigins);
    console.log("[AJartivo Print Layout Backend] Preview limit", `${Math.round(config.uploads.maxPreviewSizeBytes / 1024 / 1024)} MB`);
});

module.exports = app;

const cors = require("cors");
const express = require("express");

const { config } = require("./config");
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

app.disable("x-powered-by");
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(printLayoutRoutes);

app.get("/health", function (_req, res) {
    res.json({
        success: true,
        service: "AJartivo print-layout backend",
        port: config.port,
        runtime: process.env.VERCEL ? "vercel-serverless" : "node"
    });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

const express = require("express");

const previewRoutes = require("./preview");
const exportRoutes = require("./export");

const router = express.Router();

router.use(previewRoutes);
router.use(exportRoutes);

module.exports = router;

"use strict";
const Adjust = require("./catalog-adjustments.cjs");
module.exports = Adjust.production(require("./production-catalog.json"));

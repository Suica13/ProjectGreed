/* Technology weights compare parallel timelines without ordering their calendar years. */
"use strict";
const TechnologyEras = (() => {
  const weights = Object.freeze({
    UC_0079_T1: 1, UC_0079_T2: 2, UC_0087_T1: 3,
    UC_0087_T2: 4, UC_0093_T1: 5, CE_0071_T1: 1,
  });
  const aliases = Object.freeze({
    "0079E": "UC_0079_T1", "0079L": "UC_0079_T2",
    "0079T1": "UC_0079_T1", "0079T2": "UC_0079_T2", "0083": "UC_0079_T2",
    "0087T1": "UC_0087_T1", "0087T2": "UC_0087_T2", "0093T1": "UC_0093_T1",
    CE71: "CE_0071_T1",
  });
  const normalize = value => aliases[value] || value;
  const weight = value => weights[normalize(value)] || 0;
  const eras = Object.freeze(Object.keys(weights));
  const through = value => eras.filter(era => weight(era) <= weight(value));
  return { weights, normalize, weight, eras, through };
})();
if (typeof module !== "undefined") module.exports = TechnologyEras;

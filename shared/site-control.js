/* Suppression eligibility is shared by battlefield objectives, independent of any campaign. */
"use strict";
const SiteControl = {
  canSuppress(G, unit) {
    return (
      !!unit &&
      !unit.facility &&
      G.onMap(unit) &&
      !unit.embarked &&
      !unit.pendingMove &&
      !unit.plan &&
      !unit.flying &&
      G.modelOf(unit).movementType !== "air"
    );
  },
};
if (typeof module !== "undefined") module.exports = SiteControl;

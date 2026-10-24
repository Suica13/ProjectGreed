const { expect } = require("@playwright/test");
// 等待自动提交完成，不通过测试代码主动触发确认。
async function waitForRoomSettings(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !Net.awaiting &&
          Number(byId("roomCostLimit").value) === Net.snapshot.settings.costLimit &&
          Number(byId("roomUnitCostLimit").value) === Net.snapshot.settings.unitCostLimit,
      ),
    )
    .toBe(true);
}
module.exports = { waitForRoomSettings };

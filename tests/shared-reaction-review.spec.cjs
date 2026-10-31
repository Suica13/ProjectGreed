const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1440, 390]) test(`shared response review remains editable and confirms explicitly (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => typeof renderReactionReview === "function" && typeof Net !== "undefined");
  await page.evaluate(() => {
    window.reviewActions = [];
    Net.active = true;
    Net.seat = 1;
    Net.awaiting = null;
    Net.request = (action, fields) => window.reviewActions.push({ action, fields });
    Net.snapshot = { phase: "reaction", revision: 1, reactions: [], members: [{ seat: 1, name: "甲" }, { seat: 3, name: "乙" }], reactionReview: {
      id: "review-1", required: [1, 3], ready: [], choices: [{ id: "reaction-1", target: "test-unit", response: "defend" }],
    } };
    renderReactionReview();
  });
  await expect(page.locator("#reactionReviewPanel")).toBeVisible();
  await expect(page.locator("#confirmReactionReview")).toHaveText("确认应战方案");
  await page.locator("#reactionReviewPanel").getByRole("button", { name: "修改", exact: true }).click();
  await page.locator("#confirmReactionReview").click();
  expect(await page.evaluate(() => window.reviewActions)).toEqual([
    { action: "edit_response", fields: { reactionId: "reaction-1" } },
    { action: "confirm_responses", fields: { reviewId: "review-1" } },
  ]);
  await page.evaluate(() => { Net.snapshot.reactionReview.ready = [1]; Net.snapshot.revision++; renderReactionReview(); });
  await expect(page.locator("#confirmReactionReview")).toBeDisabled();
  await expect(page.locator("#reactionReviewPanel").getByRole("button", { name: "修改", exact: true })).toBeEnabled();
  const box = await page.locator("#reactionReviewPanel").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
});


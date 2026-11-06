const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
test("replacing a profile releases obsolete wallet backups before the next purchase", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const clean = ProfileSave.exportData();
    const backup = Economy.key + ".before-counted-stock";
    localStorage.setItem(backup, "x".repeat(512000));
    localStorage.setItem("projectgreed.campaign.backup.v1", "preserve-campaign");
    localStorage.setItem("unrelated-data", "preserve-setting");
    const set = Storage.prototype.setItem;
    const size = () =>
      Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0);
    const limit = size();
    Storage.prototype.setItem = function (key, value) {
      const next =
        size() -
        (this.getItem(key)?.length ?? 0) -
        (this.getItem(key) === null ? 0 : key.length) +
        key.length +
        String(value).length;
      if (next > limit) throw new DOMException("Full", "QuotaExceededError");
      return set.call(this, key, value);
    };
    try {
      ProfileSave.importData(clean);
      return {
        bought: Economy.produce("Type61", "standard", "PMC"),
        backup: localStorage.getItem(backup),
        campaign: localStorage.getItem("projectgreed.campaign.backup.v1"),
        foreign: localStorage.getItem("unrelated-data"),
      };
    } finally {
      Storage.prototype.setItem = set;
    }
  });
  expect(result).toEqual({
    bought: true,
    backup: null,
    campaign: "preserve-campaign",
    foreign: "preserve-setting",
  });
});
test("a genuinely fresh profile creates pilots and buys stock with a small persisted save", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.locator("#shellSettings").click();
  await page.locator("#newProfileSave").click();
  const loaded = page.waitForEvent("load");
  await page
    .locator("#gameDialog .game-dialog-actions button")
    .getByText("新建存档", { exact: true })
    .click();
  await loaded;
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => MenuShell.go("pilots"));
  await page.locator("#createCustomPilot").click();
  await page.locator("#createPilotConfirm").click();
  const result = await page.evaluate(() => {
    const bought = Economy.produce("Type61", "standard", "PMC");
    const kit = Economy.buyKit("Type61", "standard", "PMC");
    const data = ProfileSave.exportData();
    return {
      bought,
      kit,
      pilots: data.pilots.PMC.pilots.length,
      stock: Economy.quantity("Type61"),
      kits: Economy.kitQuantity("Type61__standard"),
      report: ProfileStorage.inspect(),
    };
  });
  expect(result.bought).toBe(true);
  expect(result.kit).toBe(true);
  expect(result.pilots).toBe(1);
  expect(result.stock).toBe(1);
  expect(result.kits).toBe(2);
  expect(result.report.writable).toBe(true);
  expect(result.report.estimatedBytes).toBeLessThan(64 * 1024);
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => ProfileSave.exportData().pilots.PMC.pilots.length)).toBe(1);
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(1);
  expect(errors).toEqual([]);
});
test("settings diagnostics distinguish blocked writes and export a report without save contents", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator("#shellSettings").click();
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await page.locator("#checkProfileStorage").click();
  await expect(page.locator("#profileStorageDiagnostic")).toContainText("连极小的数据也无法保存");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportStorageDiagnostic").click();
  const download = await downloadPromise;
  const report = JSON.parse(
    await require("node:fs/promises").readFile(await download.path(), "utf8"),
  );
  expect(report.writable).toBe(false);
  expect(report.errorName).toBe("QuotaExceededError");
  expect(report.entryMode).toBe("file:");
  expect(JSON.stringify(report)).not.toContain("profile-identity");
  await page.evaluate(() => (Storage.prototype.setItem = window.originalStorageSet));
  await page.locator("#checkProfileStorage").click();
  await expect(page.locator("#profileStorageDiagnostic")).toContainText("本地存储写入正常");
});
test("zero writable quota from startup still allows settings diagnostics", async ({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
  });
  await open(page);
  await page.locator('#shellSettings').click();
  await page.locator('#checkProfileStorage').click();
  await expect(page.locator('#profileStorageDiagnostic')).toContainText('连极小的数据也无法保存');
  expect(errors).toEqual([]);
});

/* Visual-only fixture: browser interaction tests stage presentation without
 * launching an extra product mode. Real encounter tests use LocalRoom/RoomEngine.
 */
async function openPresentationFixture(page, ai = false) {
  await page.evaluate((ai) => {
    if (!assetsReady) return;
    try {
      Rules.validateFormation(Formation.current());
    } catch {
      return note("编组 COST 超出上限，请先调整编组。");
    }
    Net.leave();
    TurnFlow.reset();
    MapCamera.reset();
    session++;
    const seed = Math.floor(Math.random() * 4294967296);
    game = Rules.create(
      ai,
      seed,
      [Formation.current(), ai ? Rules.randomFormation(seed) : Formation.current()],
      true,
    );
    Deployment.reset();
    selected = null;
    weaponId = null;
    mode = "select";
    phase = "deployment";
    moving = null;
    pending = null;
    battleView = null;
    setPageView("game");
    log = [];
    for (const id of ["start", "reaction", "battle", "victory", "help"]) byId(id).hidden = true;
    delete byId("endTurn").dataset.confirm;
    addLog("蓝方行动开始。选择机体 → 移动 → 选择武器 → 选择目标 → 防守方应战。");
    update();
  }, ai);
}
module.exports = { openPresentationFixture };

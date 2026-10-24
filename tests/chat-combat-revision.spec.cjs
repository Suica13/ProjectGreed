const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function channelOnLeft(page, prefix) {
  const boxes = await page.evaluate((prefix) => {
    const a = byId(prefix + "Channel").getBoundingClientRect(),
      b = byId(prefix + "Input").getBoundingClientRect();
    return { right: a.right, left: b.left, dy: Math.abs(a.top - b.top) };
  }, prefix);
  expect(boxes.right).toBeLessThanOrEqual(boxes.left);
  expect(boxes.dy).toBeLessThan(2);
}
test("chat channels sit left of both inputs and messages use channel, player and literal content", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator("#playerId").fill("ChatPlayer");
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await channelOnLeft(page, "roomChat");
  await page.locator("#roomChatChannel").selectOption("team1");
  await page.locator("#roomChatInput").fill("<b>Hello</b>");
  await page.locator("#roomChatSend").click();
  await expect(page.locator("#roomChatLines .chat-line")).toHaveText(
    "[队伍1]ChatPlayer:<b>Hello</b>",
  );
  await expect(page.locator("#roomChatLines b")).toHaveCount(0);
  await expect(page.locator("#roomChatLines time")).toHaveCount(0);
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#showChat").click();
  await channelOnLeft(page, "chat");
  await expect(page.locator("#chatLines .chat-line")).toHaveText("[队伍1]ChatPlayer:<b>Hello</b>");
  await page.locator("#roomSettings").click();
  await page.setViewportSize({ width: 430, height: 900 });
  await channelOnLeft(page, "roomChat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("melee crosses the divider, draws native slash sprites for both strikes and returns with round rings", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    byId("start").hidden = true;
    byId("battle").hidden = false;
    byId("battle").style.opacity = 1;
  });
  async function sample(reverse, point) {
    return page.evaluate(
      ({ reverse, point }) => {
        const entry = { unitId: "RGM_79", kitId: "machine_gun" },
          g = Rules.create(false, 1, [[entry], [entry]]),
          [left, right] = g.units;
        for (const [i, u] of g.units.entries()) {
          Object.assign(u, { x: 2 + i, y: 4, hp: 100000, shield: 0 });
          g.tiles[4][2 + i] = "plain";
        }
        g.team = reverse ? 1 : 0;
        const from = reverse ? right : left,
          to = reverse ? left : right,
          w = Rules.modelOf(from).weapons.find((w) => w.type === "melee");
        const event = Rules.fight(g, from, to, w, "defend")[0],
          canvas = byId("battleCanvas"),
          bounds = canvas.getBoundingClientRect();
        const timeline = BattleScene.timeline(event, left, right, bounds.width, bounds.height),
          plan = timeline.plan;
        const time =
          point === "first"
            ? plan.shots[0].at + 0.1
            : point === "second"
              ? plan.shots[1].at + 0.1
              : point === "end"
                ? plan.duration
                : 0;
        const calls = [],
          swings = [],
          ctx = canvas.getContext("2d"),
          draw = SpriteRenderer.draw,
          effect = SpriteEffects.draw,
          ellipse = ctx.ellipse;
        let ellipses = 0;
        SpriteRenderer.draw = function (ctx, model, x, y, ...args) {
          calls.push({ x, y });
          return draw.call(this, ctx, model, x, y, ...args);
        };
        SpriteEffects.draw = function (ctx, id, ...args) {
          const shown = effect.call(this, ctx, id, ...args);
          if (shown && id.startsWith("Cqb_Fire")) swings.push(id);
          return shown;
        };
        ctx.ellipse = function (...args) {
          ellipses++;
          return ellipse.apply(this, args);
        };
        try {
          BattleScene.draw(canvas, {
            left,
            right,
            event,
            ratio: time / plan.duration,
            elapsed: time,
            time: 0,
            completed: false,
            displayHp: { [left.id]: left.hp, [right.id]: right.hp },
          });
        } finally {
          SpriteRenderer.draw = draw;
          SpriteEffects.draw = effect;
          ctx.ellipse = ellipse;
        }
        return {
          actor: calls[reverse ? 1 : 0],
          home: timeline.source.x,
          center: bounds.width / 2,
          swings,
          ellipses,
        };
      },
      { reverse, point },
    );
  }
  for (const reverse of [false, true]) {
    const start = await sample(reverse, "start"),
      first = await sample(reverse, "first"),
      second = await sample(reverse, "second"),
      end = await sample(reverse, "end");
    expect(start.actor.x).toBeCloseTo(start.home);
    expect(end.actor.x).toBeCloseTo(end.home);
    expect(reverse ? first.actor.x < first.center : first.actor.x > first.center).toBe(true);
    expect(second.actor.x).toBeCloseTo(first.actor.x);
    expect(first.swings).toEqual(["Cqb_Fire_1_Pink_R"]);
    expect(second.swings).toEqual(["Cqb_Fire_1_Pink_L"]);
    expect(first.ellipses).toBe(0);
  }
  await sample(false, "first");
  await page.screenshot({ path: ".openai/melee-divider-swing.png" });
  await sample(false, "second");
  await page.screenshot({ path: ".openai/melee-second-swing.png" });
  expect(errors).toEqual([]);
});

test("Dom chest shotgun renders eight separated native pellets", async ({ page }) => {
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    byId("start").hidden = true;
    byId("battle").hidden = false;
    byId("battle").style.opacity = 1;
    const g = Rules.create(false, 1, [
        [{ unitId: "MS_09", kitId: "bazooka" }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ]),
      [left, right] = g.units;
    Object.assign(left, { x: 2, y: 4 });
    Object.assign(right, { x: 3, y: 4 });
    g.tiles[4][2] = g.tiles[4][3] = "plain";
    const w = Rules.modelOf(left).weapons.find((w) => w.id === "ZN_MS_09_ChestBeam"),
      event = Rules.fight(g, left, right, w, "defend")[0],
      canvas = byId("battleCanvas"),
      bounds = canvas.getBoundingClientRect(),
      t = BattleScene.timeline(event, left, right, bounds.width, bounds.height),
      time = t.plan.shots[0].at + t.plan.shots[0].flight * 0.5;
    BattleScene.draw(canvas, {
      left,
      right,
      event,
      ratio: time / t.plan.duration,
      elapsed: time,
      time: 0,
      completed: false,
      displayHp: { [left.id]: left.hp, [right.id]: right.hp },
    });
    return {
      count: t.plan.shots.length,
      lanes: new Set(t.plan.shots.map((s) => s.destination.y)).size,
    };
  });
  expect(result).toEqual({ count: 8, lanes: 8 });
  await page.screenshot({ path: ".openai/dom-shotgun-fan.png" });
});

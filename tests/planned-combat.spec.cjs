const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
async function connect(page, port, name) {
  for (const ip of ["114.66.40.147:1313", "126.227.168.176:1313"])
    await page.routeWebSocket("ws://" + ip + "/ws", (ws) => ws.close());
  await page.goto("http://127.0.0.1:" + port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
test("allied planning arrows, concurrent map moves, parallel owner responses and unsynchronized playback", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    pages = [page];
  for (let i = 1; i < 4; i++) pages.push(await context.newPage());
  const errors = [];
  for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await connect(page, address.port, "Host");
    await page.locator("#roomCode").fill("PLANNED");
    await page.locator("#createRoom").click();
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    for (let i = 1; i < 4; i++) {
      await connect(pages[i], address.port, "Player" + i);
      await pages[i]
        .locator(".room-card")
        .filter({ hasText: "PLANNED" })
        .getByRole("button")
        .click();
    }
    for (const p of pages.slice(1)) await p.locator("#toggleReady").click();
    await page.locator("#startRoomGame").click();
    for (const p of pages) await p.locator("#confirmFinalFormation").click();
    for (const p of pages) {
      await expect(p.locator("#showChat")).toHaveAttribute("aria-selected", "true");
      await expect(p.locator("#log")).toBeHidden();
    }
    await page.locator("#showLog").click();
    for (const p of pages) await p.locator("#confirmDeployment").click();
    await page.evaluate(() => Net.request("sync"));
    await expect.poll(() => page.evaluate(() => !Net.awaiting)).toBe(true);
    await expect(page.locator("#showLog")).toHaveAttribute("aria-selected", "true");
    await expect(pages[1].locator("#showChat")).toHaveAttribute("aria-selected", "true");
    const room = app.rooms.get("PLANNED");
    room.game.units.forEach((u) => {
      const seat = u.ownerSeat,
        index = Number(u.id.split("-")[1]);
      Object.assign(u, {
        x: index ? 1 + seat * 3 : seat % 2 ? 4 : 2,
        y: index ? 12 + index : 4 + Math.floor(seat / 2) * 2,
        hp: 100000,
        shield: 0,
      });
    });
    Object.assign(
      room.game.units.find((unit) => unit.id === "0-2"),
      { x: 2, y: 5 },
    );
    for (const row of room.game.tiles) row.fill("plain");
    for (const p of pages) {
      await expect.poll(() => p.evaluate(() => !Net.awaiting)).toBe(true);
      await p.evaluate(() => Net.request("sync"));
      await expect.poll(() => p.evaluate(() => !Net.awaiting)).toBe(true);
    }
    const revision = room.revision,
      round = room.game.round;
    await Promise.all([
      pages[0].evaluate(
        ({ revision, round }) =>
          Net.request("move", { unitId: "0-1", x: 2, y: 13, revision, round }),
        { revision, round },
      ),
      pages[2].evaluate(
        ({ revision, round }) =>
          Net.request("move", { unitId: "2-1", x: 8, y: 13, revision, round }),
        { revision, round },
      ),
    ]);
    await expect
      .poll(() =>
        pages[0].evaluate(() =>
          game.units.filter((u) => ["0-1", "2-1"].includes(u.id)).every((u) => u.moved),
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => phase)).toBe("idle");
    await pages[0].evaluate(() =>
      Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_BeamSprayGun" }),
    );
    await pages[2].evaluate(() =>
      Net.request("attack", { unitId: "2-0", targetId: "3-0", weaponId: "EF_BeamSprayGun" }),
    );
    await expect.poll(() => page.locator("#map").getAttribute("data-plan-count")).toBe("2");
    await pages[2].locator("#hudToggleRoster").click();
    await pages[2].locator('.roster-unit[data-unit-id="2-0"]').click();
    await pages[2].locator('[data-unit-command="info"]').click();
    await pages[2].locator("#hudWeaponsTab").click();
    await pages[2].locator("#cancelAttackPlan").click();
    await expect.poll(() => room.plans.length).toBe(1);
    await pages[2].locator('[data-unit-command="attack"]').click();
    const attackPoint = await pages[2].evaluate(() => {
      drawMap(performance.now());
      const target = getUnit("3-0"),
        point = mapPosition(target.x, target.y),
        bounds = byId("map").getBoundingClientRect();
      return { x: bounds.left + point.x, y: bounds.top + point.y };
    });
    await pages[2].mouse.click(attackPoint.x, attackPoint.y);
    await pages[2].locator('[data-queue-weapon="EF_BeamSprayGun"]').click();
    await pages[2].locator("#confirmAttackQueue").click();
    await expect.poll(() => room.plans.length).toBe(2);
    await page.evaluate(() =>
      Net.request("attack", { unitId: "0-2", targetId: "1-0", weaponId: "EF_HypeBazooka" }),
    );
    await expect.poll(() => room.plans.length).toBe(3);
    await page.screenshot({ path: ".openai/planned-attacks.png" });
    expect(room.phase).toBe("idle");
    expect(room.game.units.find((u) => u.id === "1-0").hp).toBe(100000);
    await expect(pages[1].locator("#reaction")).toBeHidden();
    for (const p of pages) await p.evaluate(() => MapCamera.setZoom(2.5));
    await pages[0].evaluate(() => Net.request("end_turn"));
    expect(room.phase).toBe("idle");
    await pages[2].evaluate(() => Net.request("end_turn"));
    await expect(pages[1].locator("#reaction")).toBeVisible();
    await expect(pages[3].locator("#reaction")).toBeVisible();
    expect(await pages[1].evaluate(() => MapCamera.zoom)).toBe(2.5);
    await expect(pages[1].locator("#counterTarget option")).toHaveCount(2);
    await pages[1].locator("#responseCounter").click();
    await pages[1].locator('[data-remove-counter-weapon="0"]').click();
    await pages[1].getByRole("button", { name: "反击武器 头部火神炮", exact: true }).click();
    await expect(pages[1].locator("#counterTarget")).toHaveValue("0-0");
    expect(
      await pages[1]
        .locator('#counterTarget option[value="0-2"]')
        .evaluate((option) => option.disabled),
    ).toBe(true);
    await pages[1].getByRole("button", { name: "反击武器 光束喷枪", exact: true }).click();
    expect(
      await pages[1]
        .locator('#counterTarget option[value="0-2"]')
        .evaluate((option) => option.disabled),
    ).toBe(false);
    await expect(pages[1].locator("#engagement .incoming-entry")).toHaveCount(2);
    await expect(pages[1].locator("#reactionSub")).not.toContainText("剩余反击");
    await expect
      .poll(() => pages[1].locator("#map").getAttribute("data-counter-candidate-count"))
      .toBe("2");
    const point = await pages[1].evaluate(() => mapPosition(2, 5));
    const bounds = await pages[1].locator("#map").boundingBox();
    await pages[1].mouse.click(bounds.x + point.x, bounds.y + point.y);
    await expect(pages[1].locator("#counterTarget")).toHaveValue("0-2");
    const strokes = await pages[1].evaluate(() => {
      const ctx = byId("map").getContext("2d"),
        original = ctx.stroke,
        strokes = [];
      ctx.stroke = function () {
        if (["#99efaa", "#ff998a", "#f5d86e", "#ff5f6d"].includes(this.strokeStyle))
          strokes.push({
            color: this.strokeStyle,
            dash: this.getLineDash(),
            alpha: this.globalAlpha,
            width: this.lineWidth,
          });
        return original.call(this);
      };
      drawMap(performance.now());
      ctx.stroke = original;
      return strokes;
    });
    expect(strokes.some((s) => s.color !== "#f5d86e" && s.dash.length === 0)).toBe(true);
    expect(strokes.some((s) => s.color === "#f5d86e" && s.dash.length > 0)).toBe(true);
    const incoming = strokes.filter((s) => s.color === "#ff5f6d");
    expect(incoming).toHaveLength(2);
    expect(incoming.every((s) => s.alpha === 1 && s.width === 5 && s.dash.length === 0)).toBe(true);
    expect(strokes.some((s) => s.color !== "#ff5f6d" && s.alpha < 0.3)).toBe(true);
    for (const forecast of await pages[1].locator(".incoming-forecast").all())
      await expect(forecast).toHaveCSS("color", "rgb(255, 140, 123)");

    const facing = await pages[1].evaluate(() => {
      const defender = getUnit(pending.target),
        target = getUnit(counterTargetId);
      return {
        actual: PlanningUI.facing(defender),
        expected: (Math.atan2(target.x - defender.x, -(target.y - defender.y)) * 180) / Math.PI,
      };
    });
    expect(facing.actual).toBeCloseTo(facing.expected, 6);
    await expect
      .poll(() => pages[1].locator("#map").getAttribute("data-counter-plan-count"))
      .toBe("1");
    await expect.poll(() => pages[1].locator("#map").getAttribute("data-plan-count")).toBe("3");
    await pages[1].screenshot({ path: ".openai/counter-target-arrow.png" });
    await pages[1].locator("#confirmResponse").click();
    expect(room.combats.length).toBe(0);
    await expect(pages[1].locator("#reaction")).toBeHidden();
    await expect.poll(() => page.evaluate(() => Net.snapshot.counterPlans[0]?.target)).toBe("0-2");
    await expect.poll(() => page.locator("#map").getAttribute("data-counter-plan-count")).toBe("1");
    await expect.poll(() => page.locator("#map").getAttribute("data-plan-count")).toBe("3");
    await expect(pages[3].locator("#reaction")).toBeVisible();
    await pages[3].locator("#responseEvade").click();
    const cameras = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => {
          MapCamera.setZoom(2.75);
          MapCamera.focus(12, 10, { preserveZoom: true });
          return { ...mapGeo, zoom: MapCamera.zoom };
        }),
      ),
    );
    await pages[3].locator("#confirmResponse").click();
    await expect.poll(() => room.combats.length).toBe(3);
    expect(room.game.team).toBe(0);
    expect(room.phase).toBe("playback");
    expect(
      room.combats
        .flatMap((b) => b.events)
        .filter((e) => e.from === "1-0")
        .map((e) => e.to),
    ).toEqual(["0-2"]);
    await expect.poll(() => page.locator("#map").getAttribute("data-counter-plan-count")).toBe("0");
    await expect(page.locator("#mapCombatControls")).toBeVisible();
    await expect.poll(() => page.evaluate(() => MapCombat.frames.length)).toBe(3);
    for (let index = 0; index < pages.length; index++) {
      const camera = await pages[index].evaluate(() => ({ ...mapGeo, zoom: MapCamera.zoom }));
      expect(camera.zoom).toBe(cameras[index].zoom);
      expect(camera.ox).toBeCloseTo(cameras[index].ox, 5);
      expect(camera.oy).toBeCloseTo(cameras[index].oy, 5);
    }
    await expect(page.locator("#battle")).toBeHidden();
    const batchId = room.playback.id;
    await page.screenshot({ path: ".openai/parallel-map-combat.png" });
    await page.locator("#mapSkipBattle").click();
    await expect(page.locator("#mapCombatControls")).toBeHidden();
    await expect.poll(() => room.playback.ready.length).toBe(1);
    expect(room.game.team).toBe(0);
    expect(await pages[2].evaluate(() => MapCombat.frames.length)).toBe(3);
    for (const p of pages.slice(1, 3)) await p.locator("#mapSkipBattle").click();
    await expect.poll(() => room.playback.ready.length).toBe(3);
    expect(room.playback.id).toBe(batchId);
    expect(room.game.team).toBe(0);
    await pages[3].locator("#mapSkipBattle").click();
    await expect.poll(() => room.game.team).toBe(1);
    expect(room.phase).toBe("idle");
    for (const p of pages) await expect.poll(() => p.evaluate(() => game.team)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    for (const p of pages) await p.close();
    await app.close();
  }
});

const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("independent hand weapons render at their own muzzle after a position change", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 650;
    document.body.append(canvas);
    Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: 99999 });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#152530";
    ctx.fillRect(0, 0, 1200, 650);
    const rows = [];
    for (const [row, id] of ["RX_78NT_1", "RX_78NT_1_FA", "RX_78XX"].entries()) {
      const [key, m] = Object.entries(UnitModels).find(
        ([key, m]) =>
          m.prefabId === id &&
          m.weapons.some((w) => w.id === (id === "RX_78XX" ? "EF_75mmMG_Double" : "Common_ArmMG")),
      );
      const w = m.weapons.find(
        (w) => w.id === (id === "RX_78XX" ? "EF_75mmMG_Double" : "Common_ArmMG"),
      );
      const hands = [w, m.weapons.find((a) => a.id === w.id + "_L")];
      const pose = WeaponSequence.pose(w, w.attack.shots[0]);
      const actor = { x: 200, y: 110 + row * 200, angle: 90, scale: 2.5 };
      const points = [0, 1].map((i) =>
        SpriteRenderer.muzzle(
          key,
          hands[i],
          actor,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).clip,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).time,
          0,
        ),
      );
      const shifted = { ...actor, x: actor.x + 17, y: actor.y - 29 };
      const translated = [0, 1].map((i) =>
        SpriteRenderer.muzzle(
          key,
          hands[i],
          shifted,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).clip,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).time,
          0,
        ),
      );
      for (const [col, broken] of [{}, { leftArm: true }, { rightArm: true }].entries())
        SpriteRenderer.draw(
          ctx,
          key,
          200 + col * 400,
          110 + row * 200,
          2.5,
          90,
          pose.clip,
          pose.time,
          w.id,
          false,
          true,
          false,
          broken,
        );
      const live = Rules.availableStrikes({ model: key, brokenParts: { leftArm: true } }, w);
      rows.push({
        id,
        points,
        sides: hands.map((hand) => hand.requiredParts),
        clips: hands.map((hand) => WeaponSequence.pose(hand, hand.attack.shots[0]).clip),
        translated,
        shots: live.length,
        ownBroken: Rules.availableStrikes({ model: key, brokenParts: { rightArm: true } }, w)
          .length,
        expected: w.shotCount,
        finite: points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      });
    }
    return rows;
  });
  for (const row of result) {
    expect(row.finite).toBe(true);
    expect(row.shots).toBe(row.expected);
    expect(row.ownBroken).toBe(0);
    expect(row.sides).toEqual([["rightArm"], ["leftArm"]]);
    expect(row.clips[0]).not.toBe(row.clips[1]);
    for (let i = 0; i < 2; i++) {
      expect(row.translated[i].x - row.points[i].x).toBeCloseTo(17);
      expect(row.translated[i].y - row.points[i].y).toBeCloseTo(-29);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("independent-weapon-hands.png") });
  expect(errors).toEqual([]);
});

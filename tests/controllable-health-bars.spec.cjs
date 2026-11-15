const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("green health bars follow control permissions on either team, sharing and scripted allies", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    Net.active = true;
    Net.seat = 3;
    Net.snapshot = {
      settings: { shareAlliedUnits: false },
      members: [{ seat: 3 }, { seat: 5, shareUnits: true }, { seat: 7 }],
      game: {},
      delegatedSeats: [],
    };
    const unit = (seat) => ({
      id: "bar-" + seat,
      ownerSeat: seat,
      team: Rules.seatTeam(seat),
      model: "Type61__standard",
    });
    const colors = [
      UnitIdentity.healthColor(unit(3)),
      UnitIdentity.healthColor(unit(5)),
      UnitIdentity.healthColor(unit(7)),
      UnitIdentity.healthColor(unit(2)),
    ];
    Net.snapshot.settings.shareAlliedUnits = true;
    colors.push(UnitIdentity.healthColor(unit(7)));
    Net.seat = null;
    colors.push(UnitIdentity.healthColor(unit(3)));
    Net.active = false;
    phase = "idle";
    game.team = 0;
    colors.push(UnitIdentity.healthColor(unit(0)));
    return colors;
  });
  expect(result).toEqual([
    "#68e99a",
    "#68e99a",
    "#ed9685",
    "#83d6ee",
    "#68e99a",
    "#ed9685",
    "#68e99a",
  ]);
});

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { createActivityService } = require("../tools/server-activities.cjs"),
  G = require("../shared/rules.js");
const identity = () => ({
  id: crypto.randomUUID(),
  secret: crypto.randomBytes(32).toString("hex"),
});
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "greed-mail-")),
    storePath = path.join(directory, "mail.json"),
    frames = new Map();
  let time = 1000;
  const options = {
    rules: G,
    storePath,
    now: () => time,
    send: (ws, msg) => {
      if (!frames.has(ws)) frames.set(ws, []);
      frames.get(ws).push(msg);
    },
  };
  let service = createActivityService(options);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    frames,
    options,
    get service() {
      return service;
    },
    restart: () => (service = createActivityService(options)),
    time: (value) => (time = value),
  };
}
const activity = (mode, extra = {}) => ({
  title: "活动",
  text: "内容",
  mode,
  rewards: { money: 10, supplies: 20, inventory: { Type61: 3 }, unlockUnits: ["RGM_79_G"] },
  ...extra,
});
test("welcome is durable, private, authenticated and accepted once, including interrupted delivery", (t) => {
  const f = fixture(t),
    id = identity(),
    ws = {},
    other = {},
    otherId = identity();
  f.service.identify(ws, id, "First");
  f.service.identify(other, otherId, "Other");
  let mail = f.frames.get(ws).at(-1).mail[0];
  assert.deepEqual(mail.rewards.inventory, { RGM_79_G: 3, MS_09: 3 });
  assert.equal(mail.rewards.money, 5000);
  assert(!JSON.stringify(f.frames.get(ws)).includes(id.secret));
  assert.throws(() => f.service.identify({}, { ...id, secret: "0".repeat(64) }), /验证失败/);
  assert.throws(
    () => f.service.receive(other, { type: "activity_claim", mailId: mail.id }),
    /不属于/,
  );
  f.service.receive(ws, { type: "activity_claim", mailId: mail.id });
  const award = f.frames.get(ws).at(-1).award;
  f.service.disconnect(ws);
  f.restart();
  const reconnect = {};
  f.service.identify(reconnect, id);
  mail = f.frames.get(reconnect).at(-1).mail[0];
  assert.equal(mail.claimedAt, 1000);
  assert.equal(mail.confirmedAt, null);
  f.service.receive(reconnect, { type: "activity_claim", mailId: mail.id });
  assert.deepEqual(f.frames.get(reconnect).at(-1).award, award);
  f.service.receive(reconnect, { type: "activity_ack", mailId: mail.id });
  assert.equal(f.frames.get(reconnect).at(-1).mail[0].confirmedAt, 1000);
  f.service.receive(reconnect, { type: "activity_claim", mailId: mail.id });
  assert.equal(f.frames.get(reconnect).at(-1).type, "activity_mailbox");
  f.restart();
  const again = {};
  f.service.identify(again, id);
  assert.equal(f.frames.get(again).at(-1).mail.length, 3);
  assert.equal(f.frames.get(again).at(-1).mail[0].confirmedAt, 1000);
});
test("login, all known, online now and time window target the intended players", (t) => {
  const f = fixture(t),
    a = identity(),
    b = identity(),
    c = identity(),
    one = {},
    two = {};
  f.service.identify(one, a);
  f.service.identify(two, b);
  f.service.disconnect(two);
  const all = f.service.publish(activity("all_known")),
    online = f.service.publish(activity("online_now")),
    login = f.service.publish(activity("next_login"));
  const snapshot = () => f.service.adminSnapshot();
  const delivered = (id) => snapshot().activities.find((item) => item.id === id).delivered;
  assert.equal(delivered(all.id), 2);
  assert.equal(delivered(online.id), 1);
  assert.equal(delivered(login.id), 0);
  const third = {};
  f.service.identify(third, c);
  assert.equal(delivered(login.id), 1);
  assert.equal(delivered(all.id), 2);
  f.service.identify(two, b);
  assert.equal(delivered(login.id), 2);
  assert.equal(delivered(online.id), 1);
  const timed = f.service.publish(
    activity("online_window", {
      startsAt: new Date(2000).toISOString(),
      endsAt: new Date(3000).toISOString(),
    }),
  );
  f.service.disconnect(third);
  f.time(1999);
  f.service.tick();
  assert.equal(delivered(timed.id), 0);
  f.time(2000);
  f.service.tick();
  assert.equal(delivered(timed.id), 2);
  f.service.tick();
  assert.equal(delivered(timed.id), 2);
  f.time(3000);
  f.service.identify(third, c);
  assert.equal(delivered(timed.id), 2);
  f.service.toggle(login.id, false);
  f.service.identify(one, a);
  assert.equal(delivered(login.id), 2);
});
test("bad rewards, expired windows and unrequested acknowledgements are rejected", (t) => {
  const f = fixture(t),
    ws = {};
  f.service.identify(ws, identity());
  const mail = f.frames.get(ws).at(-1).mail[0];
  assert.throws(() => f.service.receive(ws, { type: "activity_ack", mailId: mail.id }));
  assert.throws(() => f.service.publish(activity("all_known", { rewards: { money: -1 } })));
  assert.throws(() =>
    f.service.publish(activity("all_known", { rewards: { inventory: { not_a_unit: 1 } } })),
  );
  assert.throws(() =>
    f.service.publish(
      activity("online_window", {
        startsAt: new Date(500).toISOString(),
        endsAt: new Date(900).toISOString(),
      }),
    ),
  );
});

test("editing current activity copy updates existing mail without changing rewards or claims", (t) => {
  const f = fixture(t),
    ws = {},
    profile = identity();
  f.service.identify(ws, profile);
  const mail = f.frames.get(ws).at(-1).mail[0];
  f.service.receive(ws, { type: "activity_claim", mailId: mail.id });
  f.service.receive(ws, { type: "activity_ack", mailId: mail.id });
  f.service.updateCopy("first-server-visit", "新的欢迎件名", "修改过的正文");
  const updated = f.frames.get(ws).at(-1).mail[0];
  assert.equal(updated.title, "新的欢迎件名");
  assert.equal(updated.text, "修改过的正文");
  assert.deepEqual(updated.rewards, mail.rewards);
  assert.equal(updated.confirmedAt, 1000);
  assert.equal(updated.id, mail.id);
  f.restart();
  const next = {};
  f.service.identify(next, profile);
  assert.equal(f.frames.get(next).at(-1).mail[0].title, "新的欢迎件名");
  assert.equal(f.frames.get(next).at(-1).mail.length, 3);
});

const localTime = (day, hour = 6, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
test("daily and weekly defaults reset at server-local 06:00, not after 24 hours, and survive restart", (t) => {
  const f = fixture(t),
    ws = {},
    profile = identity();
  f.time(localTime(25, 23));
  f.service.identify(ws, profile);
  const mails = (id) =>
    f.frames
      .get(ws)
      .at(-1)
      .mail.filter((mail) => mail.activityId === id);
  assert.deepEqual(mails("default-daily-login")[0].rewards, {
    money: 2500,
    supplies: 5000,
    inventory: { RX_79_G: 1, MS_14A: 1 },
    unlockUnits: [],
  });
  assert.deepEqual(mails("default-weekly-login")[0].rewards, {
    money: 5000,
    supplies: 10000,
    inventory: {},
    unlockUnits: [],
  });
  f.time(localTime(26, 5, 59));
  f.service.identify(ws, profile);
  assert.equal(mails("default-daily-login").length, 1);
  assert.equal(mails("default-weekly-login").length, 1);
  f.time(localTime(26)); // Monday 06:00, only seven hours since first login.
  f.service.tick();
  assert.equal(mails("default-daily-login").length, 2);
  assert.equal(mails("default-weekly-login").length, 2);
  f.service.tick();
  f.restart();
  f.service.identify(ws, profile);
  assert.equal(mails("default-daily-login").length, 2);
  f.time(localTime(27, 5, 59));
  f.service.identify(ws, profile);
  assert.equal(mails("default-daily-login").length, 2);
  f.time(localTime(27));
  f.service.tick();
  assert.equal(mails("default-daily-login").length, 3);
  assert.equal(mails("default-weekly-login").length, 2);
});

test("cumulative login counts distinct nonconsecutive login days only during its period", (t) => {
  const f = fixture(t),
    ws = {},
    profile = identity();
  f.time(localTime(26, 5, 59));
  const value = activity("cumulative_login", {
    loginDays: 2,
    startsAt: new Date(localTime(26)).toISOString(),
    endsAt: new Date(localTime(30)).toISOString(),
  });
  const event = f.service.publish(value);
  f.service.identify(ws, profile);
  const count = () =>
    f.frames
      .get(ws)
      .at(-1)
      .mail.filter((mail) => mail.activityId === event.id).length;
  assert.equal(count(), 0);
  f.time(localTime(26));
  f.service.tick();
  f.service.identify(ws, profile);
  f.service.identify({}, profile);
  assert.equal(count(), 0);
  f.time(localTime(27, 5, 59));
  f.service.tick();
  assert.equal(count(), 0);
  f.service.disconnect(ws); // Remove the second connection too by restarting.
  f.restart();
  f.time(localTime(28));
  f.service.identify(ws, profile);
  assert.equal(count(), 1);
  f.service.receive(ws, {
    type: "activity_claim",
    mailId: f.frames
      .get(ws)
      .at(-1)
      .mail.find((mail) => mail.activityId === event.id).id,
  });
  f.time(localTime(29));
  f.service.identify(ws, profile);
  assert.equal(count(), 1);
});

test("period edits preserve receipts and gate subsequent login rewards; defaults install once", (t) => {
  const f = fixture(t),
    ws = {},
    profile = identity();
  f.time(localTime(26));
  f.service.identify(ws, profile);
  const before = f.frames
    .get(ws)
    .at(-1)
    .mail.find((mail) => mail.activityId === "default-daily-login");
  f.service.receive(ws, { type: "activity_claim", mailId: before.id });
  f.service.receive(ws, { type: "activity_ack", mailId: before.id });
  const settings = {
    startsAt: new Date(localTime(28)).toISOString(),
    endsAt: new Date(localTime(29)).toISOString(),
  };
  f.service.updateCopy("default-daily-login", "每日新文案", "新正文", settings);
  f.time(localTime(27));
  f.service.identify(ws, profile);
  let mail = f.frames
    .get(ws)
    .at(-1)
    .mail.filter((mail) => mail.activityId === "default-daily-login");
  assert.equal(mail.length, 1);
  assert.equal(mail[0].confirmedAt, localTime(26));
  f.time(localTime(28));
  f.service.tick();
  assert.equal(
    f.frames
      .get(ws)
      .at(-1)
      .mail.filter((mail) => mail.activityId === "default-daily-login").length,
    2,
  );
  f.time(localTime(29));
  f.service.identify(ws, profile);
  assert.equal(
    f.frames
      .get(ws)
      .at(-1)
      .mail.filter((mail) => mail.activityId === "default-daily-login").length,
    2,
  );
  f.service.toggle("default-weekly-login", false);
  f.restart();
  assert.equal(
    f.service
      .adminSnapshot()
      .activities.filter((activity) => activity.id === "default-weekly-login").length,
    1,
  );
  assert.equal(
    f.service.adminSnapshot().activities.find((activity) => activity.id === "default-weekly-login")
      .enabled,
    false,
  );
  assert.throws(() =>
    f.service.updateCopy("default-daily-login", "test", "text", {
      startsAt: settings.endsAt,
      endsAt: settings.startsAt,
    }),
  );
});

test("default limited battle bonus, separate multipliers, overlap, edits and server restart", (t) => {
  const f = fixture(t);
  const event = f.service
    .adminSnapshot()
    .activities.find((a) => a.id === "default-super-coal-20261028");
  assert.equal(event.title, "超级煤球真理部");
  assert.equal(event.text, "谨防非法广播");
  assert.equal(event.startsAt, new Date(2026, 9, 28).getTime());
  assert.equal(event.endsAt, new Date(2026, 10, 2).getTime());
  const base = { experience: 1, money: 1, supplies: 1, technology: 1 };
  f.time(event.startsAt - 1);
  assert.deepEqual(f.service.rewardMultipliers(), base);
  f.time(event.startsAt);
  assert.deepEqual(f.service.rewardMultipliers(), {
    experience: 2,
    money: 2,
    supplies: 2,
    technology: 2,
  });
  const ws = {},
    profile = identity();
  f.service.identify(ws, profile);
  const mail = f.frames
    .get(ws)
    .at(-1)
    .mail.find((mail) => mail.activityId === event.id);
  assert.deepEqual(mail.multipliers, event.multipliers);
  const added = f.service.publish(
    activity("battle_bonus", {
      startsAt: new Date(event.startsAt).toISOString(),
      endsAt: new Date(event.endsAt).toISOString(),
      multipliers: { experience: 3, money: 1, supplies: 4, technology: 5 },
    }),
  );
  assert.deepEqual(f.service.rewardMultipliers(), {
    experience: 3,
    money: 2,
    supplies: 4,
    technology: 5,
  });
  assert.deepEqual(added.rewards, { money: 0, supplies: 0, inventory: {}, unlockUnits: [] });
  f.service.toggle(added.id, false);
  assert.equal(f.service.rewardMultipliers().experience, 2);
  f.service.updateCopy(event.id, event.title, event.text, {
    multipliers: { experience: 4, money: 3, supplies: 2, technology: 1 },
  });
  f.restart();
  assert.deepEqual(f.service.rewardMultipliers(), {
    experience: 4,
    money: 3,
    supplies: 2,
    technology: 1,
  });
  f.time(event.endsAt);
  assert.deepEqual(f.service.rewardMultipliers(), base);
  assert.throws(() =>
    f.service.publish(activity("battle_bonus", { multipliers: { experience: 2 } })),
  ); // period required
  assert.throws(() =>
    f.service.updateCopy(event.id, event.title, event.text, { multipliers: { money: -1 } }),
  );
});

test("persistent activity listings survive no-mail periods, claims, reconnects and restart", (t) => {
  const f = fixture(t),
    ws = {},
    profile = identity();
  f.time(localTime(26));
  f.service.identify(ws, profile);
  const listing = () => f.frames.get(ws).at(-1).activities;
  const bonus = listing().find((a) => a.mode === "battle_bonus");
  assert(bonus);
  assert.equal(bonus.status, "upcoming");
  assert(
    !f.frames
      .get(ws)
      .at(-1)
      .mail.some((m) => m.activityId === bonus.id),
  );
  const daily = f.frames
    .get(ws)
    .at(-1)
    .mail.find((m) => m.activityId === "default-daily-login");
  f.service.receive(ws, { type: "activity_claim", mailId: daily.id });
  f.service.receive(ws, { type: "activity_ack", mailId: daily.id });
  f.service.disconnect(ws);
  f.restart();
  f.service.identify(ws, profile);
  assert(listing().some((a) => a.id === "default-daily-login"));
  assert.equal(
    f.frames
      .get(ws)
      .at(-1)
      .mail.find((m) => m.id === daily.id).confirmedAt,
    localTime(26),
  );
  f.time(new Date(2026, 10, 3, 6).getTime());
  f.service.identify(ws, profile);
  assert.equal(listing().find((a) => a.id === bonus.id).status, "ended");
  f.service.toggle("default-weekly-login", false);
  assert.equal(listing().find((a) => a.id === "default-weekly-login").status, "paused");
  assert(listing().every((a) => a.secretHash === undefined));
  const old = f.frames
    .get(ws)
    .at(-1)
    .mail.find((m) => m.id === daily.id);
  assert.equal(old.confirmedAt, localTime(26));
});

test("deletion cancels unclaimed mail and bonuses, preserves in-flight receipts and never reinstalls defaults", (t) => {
  const f = fixture(t),
    a = identity(),
    b = identity(),
    wa = {},
    wb = {};
  f.service.identify(wa, a);
  f.service.identify(wb, b);
  const mail = f.frames
    .get(wa)
    .at(-1)
    .mail.find((m) => m.activityId === "first-server-visit");
  f.service.receive(wa, { type: "activity_claim", mailId: mail.id });
  const award = f.frames.get(wa).at(-1).award;
  const otherMail = f.frames
    .get(wb)
    .at(-1)
    .mail.find((m) => m.activityId === "first-server-visit");
  f.service.remove("first-server-visit");
  assert(
    !f.frames
      .get(wb)
      .at(-1)
      .mail.some((m) => m.id === otherMail.id),
  );
  assert.throws(
    () => f.service.receive(wb, { type: "activity_claim", mailId: otherMail.id }),
    /不存在/,
  );
  f.service.receive(wa, { type: "activity_claim", mailId: mail.id });
  assert.deepEqual(f.frames.get(wa).at(-1).award, award);
  f.service.receive(wa, { type: "activity_ack", mailId: mail.id });
  f.service.remove("default-daily-login");
  f.time(new Date(2026, 9, 29, 12).getTime());
  assert.equal(f.service.rewardMultipliers().money, 2);
  f.service.remove("default-super-coal-20261028");
  assert.equal(f.service.rewardMultipliers().money, 1);
  assert.throws(() => f.service.remove("missing"), /不存在/);
  f.restart();
  assert(
    !f.service
      .adminSnapshot()
      .activities.some((x) =>
        ["first-server-visit", "default-daily-login", "default-super-coal-20261028"].includes(x.id),
      ),
  );
  const reconnected = {};
  f.service.identify(reconnected, a);
  assert.equal(
    f.frames
      .get(reconnected)
      .at(-1)
      .mail.find((m) => m.id === mail.id).confirmedAt,
    1000,
  );
});

test("accepted reward deletion persists per player, retains receipts and permits only future login cycles", (t) => {
  const f = fixture(t),
    a = identity(),
    b = identity(),
    wa = {},
    wb = {};
  f.time(new Date(2026, 9, 28, 12).getTime());
  f.service.identify(wa, a);
  f.service.identify(wb, b);
  const current = () => f.frames.get(wa).at(-1);
  const welcome = current().mail.find((m) => m.activityId === "first-server-visit");
  assert.throws(
    () => f.service.receive(wa, { type: "activity_delete", mailId: welcome.id }),
    /已接受/,
  );
  assert.throws(
    () => f.service.receive(wb, { type: "activity_delete", mailId: welcome.id }),
    /不属于/,
  );
  for (const id of ["first-server-visit", "default-daily-login"]) {
    const item = current().mail.find((m) => m.activityId === id);
    f.service.receive(wa, { type: "activity_claim", mailId: item.id });
    f.service.receive(wa, { type: "activity_ack", mailId: item.id });
    f.service.receive(wa, { type: "activity_delete", mailId: item.id });
    assert(!current().mail.some((m) => m.id === item.id));
    f.service.receive(wa, { type: "activity_delete", mailId: item.id });
    f.service.receive(wa, { type: "activity_claim", mailId: item.id });
    assert.equal(current().type, "activity_mailbox");
  }
  assert.equal(
    current().activities.find((a) => a.id === "default-daily-login").confirmedAt,
    new Date(2026, 9, 28, 12).getTime(),
  );
  assert(
    f.frames
      .get(wb)
      .at(-1)
      .mail.some((m) => m.activityId === "first-server-visit"),
  );
  assert.equal(
    f.service.adminSnapshot().activities.find((a) => a.id === "first-server-visit").accepted,
    1,
  );
  f.restart();
  const again = {};
  f.service.identify(again, a);
  assert(
    !f.frames
      .get(again)
      .at(-1)
      .mail.some((m) => m.activityId === "first-server-visit"),
  );
  f.time(new Date(2026, 9, 29, 6).getTime());
  f.service.tick();
  assert(
    f.frames
      .get(again)
      .at(-1)
      .mail.some((m) => m.activityId === "default-daily-login" && m.confirmedAt === null),
  );
});

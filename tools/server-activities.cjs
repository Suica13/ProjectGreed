"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");

function createActivityService({ rules, send, storePath = null, now = Date.now }) {
  const online = new Map();
  const developmentTree = require("../shared/development-tree.json");
  const unitMap = new Map(rules.catalog.prefabs.map((unit) => [unit.id, unit]));
  let state = { schemaVersion: 1, serverId: crypto.randomUUID(), players: {}, activities: [] };
  function save(next) {
    if (storePath) {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      const temporary = storePath + ".tmp";
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, storePath);
    }
    state = next;
  }
  if (storePath && fs.existsSync(storePath)) {
    state = JSON.parse(fs.readFileSync(storePath, "utf8"));
    if (
      state.schemaVersion !== 1 ||
      !state.serverId ||
      !state.players ||
      !Array.isArray(state.activities)
    )
      throw Error("服务器活动存储格式无效，未重置发放记录");
  } else {
    state.activities.push({
      id: "first-server-visit",
      title: "首次加入服务器奖励",
      text: "欢迎加入服务器！感谢参与 ProjectGreed，祝你作战顺利。",
      mode: "next_login",
      enabled: true,
      createdAt: now(),
      rewards: {
        money: 5000,
        supplies: 10000,
        inventory: { RGM_79_G: 3, MS_09: 3 },
        unlockUnits: [],
      },
    });
    save(state);
  }
  // Stable IDs install these defaults once on both new and existing servers.
  const defaults = [
    {
      id: "default-super-coal-20261028",
      title: "超级煤球真理部",
      text: "谨防非法广播",
      mode: "battle_bonus",
      startsAt: new Date(2026, 9, 28).getTime(),
      endsAt: new Date(2026, 10, 2).getTime(),
      multipliers: { experience: 2, money: 2, supplies: 2, technology: 2 },
      rewards: { money: 0, supplies: 0, inventory: {}, unlockUnits: [] },
    },
    {
      id: "default-daily-login",
      title: "每日登录奖励",
      text: "感谢今天登录服务器！每日早上6点刷新。",
      mode: "daily_login",
      rewards: {
        money: 2500,
        supplies: 5000,
        inventory: { RX_79_G: 1, MS_14A: 1 },
        unlockUnits: [],
      },
    },
    {
      id: "default-weekly-login",
      title: "每周登录奖励",
      text: "感谢本周登录服务器！每周一早上6点刷新。",
      mode: "weekly_login",
      rewards: { money: 5000, supplies: 10000, inventory: {}, unlockUnits: [] },
    },
  ];
  if (defaults.some((item) => !state.activities.some((activity) => activity.id === item.id))) {
    const next = structuredClone(state);
    for (const item of defaults)
      if (!next.activities.some((activity) => activity.id === item.id))
        next.activities.push({ ...item, enabled: true, createdAt: now() });
    save(next);
  }
  const loginModes = new Set(["daily_login", "weekly_login", "cumulative_login"]);
  function inPeriod(activity, time = now()) {
    return (
      (activity.startsAt == null || time >= activity.startsAt) &&
      (activity.endsAt == null || time < activity.endsAt)
    );
  }
  // Calendar boundaries follow the server's timezone and refresh at 06:00, even over DST.
  function loginDate(time = now(), weekly = false) {
    const date = new Date(time);
    if (date.getHours() < 6) date.setDate(date.getDate() - 1);
    if (weekly) date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function schedule(value, required = false, allowPast = false) {
    if (!value.startsAt && !value.endsAt && !required) return { startsAt: null, endsAt: null };
    const startsAt = Date.parse(value.startsAt),
      endsAt = Date.parse(value.endsAt);
    if (
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      endsAt <= startsAt ||
      (!allowPast && endsAt <= now())
    )
      throw Error("活动时间段无效或已结束");
    return { startsAt, endsAt };
  }
  function edit(callback) {
    const next = structuredClone(state);
    callback(next);
    save(next);
  }
  function validateRewards(value = {}) {
    const rewards = {
      money: value.money ?? 0,
      supplies: value.supplies ?? 0,
      inventory: {},
      unlockUnits: [],
    };
    if (
      ![rewards.money, rewards.supplies].every(
        (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000,
      )
    )
      throw Error("资金、物资必须为0至10亿的整数");
    if (!value.inventory || typeof value.inventory !== "object" || Array.isArray(value.inventory)) {
      if (value.inventory !== undefined) throw Error("单位库存奖励格式无效");
    }
    for (const [id, count] of Object.entries(value.inventory || {})) {
      if (!unitMap.has(id) || !Number.isSafeInteger(count) || count < 1 || count > 1000000)
        throw Error("单位奖励无效：" + id);
      rewards.inventory[id] = count;
    }
    if (!Array.isArray(value.unlockUnits ?? [])) throw Error("开发奖励格式无效");
    for (const id of new Set(value.unlockUnits || [])) {
      const unit = unitMap.get(id);
      if (!unit || !(developmentTree[unit.faction] || []).some((node) => node.unlocks.includes(id)))
        throw Error("单位没有可解锁科技：" + id);
      rewards.unlockUnits.push(id);
    }
    return rewards;
  }
  function validateMultipliers(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("请配置战斗收益倍率");
    const result = {};
    for (const key of ["experience", "money", "supplies", "technology"]) {
      const multiplier = value[key] ?? 1;
      if (
        typeof multiplier !== "number" ||
        !Number.isFinite(multiplier) ||
        multiplier < 1 ||
        multiplier > 100
      )
        throw Error("收益倍率须为1至100的数值");
      result[key] = multiplier;
    }
    return result;
  }
  function rewardMultipliers() {
    const result = { experience: 1, money: 1, supplies: 1, technology: 1 };
    for (const activity of state.activities)
      if (activity.mode === "battle_bonus" && activity.enabled && inPeriod(activity))
        for (const key of Object.keys(result))
          result[key] = Math.max(result[key], activity.multipliers[key]);
    return result;
  }
  function deliver(next, activity, ids, occurrence = null) {
    if (!activity.enabled || !inPeriod(activity)) return;
    for (const id of ids) {
      const player = next.players[id];
      if (
        !player ||
        player.mail.some(
          (mail) => mail.activityId === activity.id && (mail.occurrence ?? null) === occurrence,
        )
      )
        continue;
      player.mail.push({
        id: crypto.randomUUID(),
        activityId: activity.id,
        occurrence,
        ...(activity.mode === "battle_bonus"
          ? {
              multipliers: structuredClone(activity.multipliers),
              startsAt: activity.startsAt,
              endsAt: activity.endsAt,
            }
          : {}),
        title: activity.title,
        text: activity.text,
        rewards: structuredClone(activity.rewards),
        createdAt: now(),
        claimedAt: null,
        confirmedAt: null,
      });
    }
  }
  function recordLogin(next, activity, id) {
    if (!activity.enabled || !inPeriod(activity)) return;
    if (activity.mode === "cumulative_login") {
      const player = next.players[id];
      const days = ((player.loginDays ||= {})[activity.id] ||= {});
      if (days[loginDate()] == null || !inPeriod(activity, days[loginDate()]))
        days[loginDate()] = now();
      const count = Object.values(days).filter(
        (time) =>
          (activity.startsAt == null || time >= activity.startsAt) &&
          (activity.endsAt == null || time < activity.endsAt),
      ).length;
      if (count >= activity.loginDays) deliver(next, activity, [id]);
    } else deliver(next, activity, [id], loginDate(now(), activity.mode === "weekly_login"));
  }
  function mailbox(ws) {
    const player = state.players[ws.activityProfileId];
    if (!player) return;
    // Activity definitions are persistent listings, independent of this cycle's reward mail.
    const activities = state.activities
      .filter((activity) => loginModes.has(activity.mode) || activity.mode === "battle_bonus")
      .map((activity) => ({
        id: activity.id,
        mode: activity.mode,
        title: activity.title,
        text: activity.text,
        enabled: activity.enabled,
        startsAt: activity.startsAt ?? null,
        endsAt: activity.endsAt ?? null,
        rewards: activity.rewards,
        ...(activity.multipliers ? { multipliers: activity.multipliers } : {}),
        status: !activity.enabled
          ? "paused"
          : activity.startsAt != null && now() < activity.startsAt
            ? "upcoming"
            : activity.endsAt != null && now() >= activity.endsAt
              ? "ended"
              : "active",
        occurrence: ["daily_login", "weekly_login"].includes(activity.mode)
          ? loginDate(now(), activity.mode === "weekly_login")
          : null,
        ...(activity.mode === "cumulative_login"
          ? {
              loginDays: activity.loginDays,
              loggedDays: Object.values(player.loginDays?.[activity.id] || {}).filter((time) =>
                inPeriod(activity, time),
              ).length,
            }
          : {}),
      }));
    send(ws, { type: "activity_mailbox", serverId: state.serverId, mail: player.mail, activities });
  }
  function broadcast() {
    for (const clients of online.values()) for (const ws of clients) mailbox(ws);
  }
  function eligibleWindow(activity) {
    const time = now();
    return (
      ["online_window", "battle_bonus"].includes(activity.mode) &&
      time >= activity.startsAt &&
      time < activity.endsAt
    );
  }
  function loginPending(activity, player) {
    if (!loginModes.has(activity.mode) || !activity.enabled || !inPeriod(activity)) return false;
    if (activity.mode === "cumulative_login")
      return (
        !player.mail.some((mail) => mail.activityId === activity.id) &&
        (player.loginDays?.[activity.id]?.[loginDate()] == null ||
          !inPeriod(activity, player.loginDays[activity.id][loginDate()]) ||
          Object.values(player.loginDays[activity.id]).filter((time) => inPeriod(activity, time))
            .length >= activity.loginDays)
      );
    const occurrence = loginDate(now(), activity.mode === "weekly_login");
    return !player.mail.some(
      (mail) => mail.activityId === activity.id && mail.occurrence === occurrence,
    );
  }
  function tick() {
    const ids = [...online.keys()];
    if (
      !ids.length ||
      !state.activities.some(
        (activity) =>
          activity.enabled &&
          ids.some(
            (id) =>
              loginPending(activity, state.players[id]) ||
              (eligibleWindow(activity) &&
                !state.players[id].mail.some((mail) => mail.activityId === activity.id)),
          ),
      )
    )
      return;
    edit((next) => {
      for (const activity of next.activities) {
        if (eligibleWindow(activity)) deliver(next, activity, ids);
        if (loginModes.has(activity.mode))
          for (const id of ids)
            if (loginPending(activity, next.players[id])) recordLogin(next, activity, id);
      }
    });
    broadcast();
  }
  function disconnect(ws) {
    const clients = online.get(ws.activityProfileId);
    clients?.delete(ws);
    if (clients && !clients.size) online.delete(ws.activityProfileId);
  }
  function identify(ws, identity, name = "") {
    if (
      !identity ||
      !/^[a-zA-Z0-9_-]{16,80}$/.test(identity.id) ||
      !/^[a-f0-9]{64}$/.test(identity.secret)
    )
      throw Error("存档标识无效，请使用最新客户端");
    const digest = crypto.createHash("sha256").update(identity.secret).digest("hex");
    const existing = state.players[identity.id];
    if (
      existing &&
      !crypto.timingSafeEqual(Buffer.from(existing.secretHash, "hex"), Buffer.from(digest, "hex"))
    )
      throw Error("存档标识验证失败");
    disconnect(ws);
    edit((next) => {
      const player = (next.players[identity.id] ||= {
        secretHash: digest,
        firstSeenAt: now(),
        mail: [],
      });
      player.name = String(name).slice(0, 80);
      player.lastSeenAt = now();
      for (const activity of next.activities) {
        if (loginModes.has(activity.mode)) recordLogin(next, activity, identity.id);
        else if (activity.mode === "next_login" || eligibleWindow(activity))
          deliver(next, activity, [identity.id]);
      }
    });
    ws.activityProfileId = identity.id;
    if (!online.has(identity.id)) online.set(identity.id, new Set());
    online.get(identity.id).add(ws);
    mailbox(ws);
  }
  function receive(ws, msg) {
    if (typeof msg.type !== "string" || !msg.type.startsWith("activity_")) return false;
    if (msg.type === "activity_hello") {
      identify(ws, msg.identity, msg.name);
      return true;
    }
    const player = state.players[ws.activityProfileId];
    if (!player) throw Error("请先验证存档标识");
    if (msg.type === "activity_list") {
      mailbox(ws);
      return true;
    }
    const mail = player.mail.find((item) => item.id === msg.mailId);
    if (!mail) throw Error("邮件不存在或不属于此玩家");
    if (msg.type === "activity_claim") {
      if (mail.confirmedAt !== null) {
        mailbox(ws);
        return true;
      }
      if (mail.claimedAt === null)
        edit((next) => {
          next.players[ws.activityProfileId].mail.find((item) => item.id === mail.id).claimedAt =
            now();
        });
      send(ws, {
        type: "activity_reward",
        serverId: state.serverId,
        mailId: mail.id,
        award: {
          id: "server-mail:" + state.serverId + ":" + mail.id,
          matchId: state.serverId,
          ...mail.rewards,
        },
      });
    } else if (msg.type === "activity_ack") {
      if (mail.claimedAt === null) throw Error("邮件尚未接收");
      if (mail.confirmedAt === null)
        edit((next) => {
          next.players[ws.activityProfileId].mail.find((item) => item.id === mail.id).confirmedAt =
            now();
        });
      for (const connection of online.get(ws.activityProfileId) || []) mailbox(connection);
    } else throw Error("未知活动操作");
    return true;
  }
  function publish(value) {
    if (
      ![
        "next_login",
        "all_known",
        "online_now",
        "online_window",
        "battle_bonus",
        ...loginModes,
      ].includes(value.mode)
    )
      throw Error("发放方式无效");
    if (
      typeof value.title !== "string" ||
      !value.title.trim() ||
      value.title.length > 120 ||
      typeof value.text !== "string" ||
      value.text.length > 12000
    )
      throw Error("请填写有效标题和正文");
    const activity = {
      id: crypto.randomUUID(),
      title: value.title.trim(),
      text: value.text,
      mode: value.mode,
      enabled: true,
      createdAt: now(),
      rewards: validateRewards(value.mode === "battle_bonus" ? {} : value.rewards),
    };
    Object.assign(
      activity,
      schedule(value, ["online_window", "battle_bonus"].includes(value.mode)),
    );
    if (value.mode === "battle_bonus")
      activity.multipliers = validateMultipliers(value.multipliers);
    if (value.mode === "cumulative_login") {
      if (!Number.isSafeInteger(value.loginDays) || value.loginDays < 1 || value.loginDays > 10000)
        throw Error("累计登录天数须为1至10000的整数");
      activity.loginDays = value.loginDays;
    }
    edit((next) => {
      next.activities.push(activity);
      if (activity.mode === "all_known") deliver(next, activity, Object.keys(next.players));
      if (activity.mode === "online_now" || eligibleWindow(activity))
        deliver(next, activity, [...online.keys()]);
      if (loginModes.has(activity.mode))
        for (const id of online.keys()) recordLogin(next, activity, id);
    });
    broadcast();
    return activity;
  }
  function adminSnapshot() {
    return {
      serverId: state.serverId,
      serverTime: now(),
      activities: state.activities.map((activity) => ({
        ...activity,
        delivered: Object.values(state.players).filter((player) =>
          player.mail.some((mail) => mail.activityId === activity.id),
        ).length,
        accepted: Object.values(state.players).filter((player) =>
          player.mail.some((mail) => mail.activityId === activity.id && mail.confirmedAt !== null),
        ).length,
      })),
      players: Object.entries(state.players).map(([id, player]) => ({
        id,
        name: player.name,
        online: online.has(id),
      })),
      units: [...unitMap.values()].map((unit) => ({
        id: unit.id,
        name: unit.code + " " + unit.name,
        faction: unit.faction,
        developable: (developmentTree[unit.faction] || []).some((node) =>
          node.unlocks.includes(unit.id),
        ),
      })),
    };
  }
  function updateCopy(id, title, text, settings = {}) {
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 120 ||
      typeof text !== "string" ||
      text.length > 12000
    )
      throw Error("请填写有效标题和正文");
    edit((next) => {
      const activity = next.activities.find((item) => item.id === id);
      if (!activity) throw Error("活动不存在");
      if (Object.hasOwn(settings, "startsAt") || Object.hasOwn(settings, "endsAt"))
        Object.assign(
          activity,
          schedule(settings, ["online_window", "battle_bonus"].includes(activity.mode), true),
        );
      if (activity.mode === "cumulative_login" && Object.hasOwn(settings, "loginDays")) {
        if (
          !Number.isSafeInteger(settings.loginDays) ||
          settings.loginDays < 1 ||
          settings.loginDays > 10000
        )
          throw Error("累计登录天数须为1至10000的整数");
        activity.loginDays = settings.loginDays;
      }
      if (activity.mode === "battle_bonus" && Object.hasOwn(settings, "multipliers"))
        activity.multipliers = validateMultipliers(settings.multipliers);
      activity.title = title.trim();
      activity.text = text;
      activity.updatedAt = now();
      for (const player of Object.values(next.players))
        for (const mail of player.mail)
          if (mail.activityId === id) {
            mail.title = activity.title;
            mail.text = activity.text;
            if (activity.mode === "battle_bonus") {
              mail.multipliers = structuredClone(activity.multipliers);
              mail.startsAt = activity.startsAt;
              mail.endsAt = activity.endsAt;
            }
          }
    });
    broadcast();
  }
  function toggle(id, enabled) {
    edit((next) => {
      const activity = next.activities.find((item) => item.id === id);
      if (!activity) throw Error("活动不存在");
      activity.enabled = !!enabled;
    });
    tick();
    broadcast();
  }
  async function httpHandler(req, res) {
    const remote = req.socket.remoteAddress;
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
    let host;
    try {
      host = new URL("http://" + req.headers.host);
    } catch {}
    if (!local || !host || !["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)) {
      res.writeHead(403);
      res.end("Local administrator only");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    const route = new URL(req.url, "http://localhost").pathname;
    if (["/admin/activities", "/admin/activities.html"].includes(route) && req.method === "GET") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(fs.readFileSync(path.join(__dirname, "../admin/activities.html")));
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      if (route === "/api/activities/admin" && req.method === "GET") {
        res.end(JSON.stringify(adminSnapshot()));
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers.origin !== host.origin ||
        !String(req.headers["content-type"]).startsWith("application/json")
      ) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "Invalid administrator request" }));
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1048576) throw Error("请求过大");
      }
      const value = JSON.parse(body);
      if (route === "/api/activities/admin/publish") publish(value);
      else if (route === "/api/activities/admin/edit")
        updateCopy(value.id, value.title, value.text, value);
      else if (route === "/api/activities/admin/toggle") toggle(value.id, value.enabled);
      else {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      res.end(JSON.stringify(adminSnapshot()));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: error.message }));
    }
  }
  return {
    identify,
    receive,
    disconnect,
    tick,
    publish,
    toggle,
    updateCopy,
    adminSnapshot,
    rewardMultipliers,
    httpHandler,
  };
}
module.exports = { createActivityService };

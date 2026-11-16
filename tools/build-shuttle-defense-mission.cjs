/* Rebuild the BO2 shuttle defense as a 35-turn co-op mission. */
const fs = require("node:fs"),
  path = require("node:path");
const M = require("../shared/map-document"),
  B = require("./rebuild-biome-maps.cjs"),
  G = require("../shared/rules");
const root = path.resolve(__dirname, ".."),
  width = 52,
  height = 48;
const doc = M.create({
  id: "mission_shuttle_defense",
  name: "[0087][原创]危机的时间限制-AEUG",
  width,
  height,
  playersPerTeam: 5,
  environment: "ground",
  supportedModes: ["mission"],
  description:
    "守住三处穿梭机发射位35回合，阻止提坦斯从海岸和平原发动的袭击。剩余穿梭机越多，通关奖励越丰厚。",
});
for (const s of doc.spawns) {
  s.x = s.team ? 46 : 25 + (s.position % 2) * 4;
  s.y = s.team ? 6 + s.position * 7 : 15 + Math.floor((s.position - 1) / 2) * 7;
}
doc.deploymentAreas = doc.spawns.map((s) =>
  s.team ? { x: 42, y: 2, width: 9, height: 43 } : { x: 23, y: 13, width: 11, height: 23 },
);
doc.climate = {
  weather: { allowed: ["clear"], weights: { clear: 1 }, fixed: true },
  time: { allowed: ["afternoon"], fixed: true },
};
const actors = [];
function add(id, unitId, kitId, team, x, y, group, initial = false, extra = {}) {
  actors.push({
    id,
    unitId,
    kitId,
    team,
    x,
    y,
    group,
    initial,
    angle: team ? (x < 26 ? 90 : 270) : 90,
    ...extra,
  });
  return id;
}
const pads = [
  [18, 14],
  [33, 23],
  [18, 31],
];
for (const [i, [x, y]] of pads.entries()) {
  add("shuttle-" + i, "Mission_SpaceShuttle", "standard", 0, x, y, "shuttles", true, {
    stationary: true,
    autonomous: true,
  });
  for (let n = 0; n < 3; n++)
    add(
      "guard-" + i + "-" + n,
      "MSA_003",
      ["kit_0", "kit_1", "kit_2"][n],
      0,
      x + 5,
      y + 3,
      "guards",
      true,
      { squad: "guard-" + i, autonomous: true },
    );
  add("guard-dias-" + i, "RMS_099", "kit_2", 0, x + 4, y + 5, "guards", true, { autonomous: true });
}
const officer = "assets/pilots/Pilot_AEUG_0087_Officer_1.png",
  common = "assets/pilots/Pilot_AEUG_0087_Common_1.png";
const line = (text, communications = false) => ({
  actor: "shuttle-0",
  name: communications ? "奥古通信员" : "奥古前线指挥官",
  text,
  portrait: communications ? common : officer,
});
const dialogue = (...lines) => ({ type: "dialogue", lines });
const events = [
  {
    id: "opening",
    name: "发射场防卫开始",
    when: { type: "start" },
    actions: [
      dialogue(
        line("三台穿梭机正在进行最后检查，发射准备还需要35回合。", true),
        line("PMC部队，请协助守住发射场。提坦斯不会让我们轻易离开。"),
        line("海岸和平原两侧都发现了敌军接近。", true),
      ),
    ],
  },
];
for (let round = 6; round <= 30; round += 6) {
  const ids = [];
  for (const side of ["coast", "plain"]) {
    const edgeX = side === "coast" ? 2 : 48,
      count = round >= 9 ? 7 : 6;
    for (let i = 0; i < count; i++) {
      const groupIndex = Math.floor(i / 3), slot = i % 3,
        attackGroup = `wave-${round}-${side}-group-${groupIndex}`,
        x = edgeX + (side === "coast" ? 1 : -1) * (slot === 1 ? 2 : 0),
        y = 6 + groupIndex * 12 + (slot === 2 ? 3 : 0),
        prefix = `wave-${round}-${side}-${i}`;
      const carrier = add(prefix, "BaseJabber", "standard", 1, x, y, "raiders", false, { attackGroup });
      ids.push(carrier);
      for (let n = 0; n < 2; n++) {
        const index = i * 2 + n + round / 3;
        const model =
          round >= 9 && index % 3 === 0 ? "RMS_108" : index % 2 ? "RMS_106" : "RMS_179_TITANS";
        const kits =
          model === "RMS_106"
            ? ["main_0"]
            : model === "RMS_108"
              ? ["main_0", "kit_1"]
              : ["kit_0"];
        ids.push(
          add(prefix + "-ms-" + n, model, kits[index % kits.length], 1, x, y, "raiders", false, {
            carrier, attackGroup, stayOnSfs: true,
          }),
        );
      }
    }
    if (round >= 9)
      ids.push(add(`asshimar-${round}-${side}`, "NRX_044_MA", "standard", 1, edgeX, 40, "raiders"));
    if ([12, 24, 30].includes(round))
      ids.push(add(`byarlant-${round}-${side}`, "RX_160", "standard", 1, edgeX, 43, "raiders"));
  }
  const actions = [{ type: "spawn", actors: ids }];
  if (round === 6)
    actions.push(
      dialogue(
        line("敌军从两侧同时来袭，航空踏板上搭载了MS！", true),
        line("优先拦截接近穿梭机的敌人，保持交叉掩护。"),
      ),
    );
  if (round === 12)
    actions.push(
      dialogue(
        line("敌军增加了空中部队，确认玛拉塞和亚希玛！", true),
        line("不要被外围敌人引开。守住三处发射位。"),
      ),
    );
  events.push({
    id: "wave-" + round,
    name: "第" + round + "回合两路空袭",
    when: { type: "round", round },
    actions,
  });
}
const garuda = add("garuda", "GarudaClass_TITANS", "standard", 1, 46, 20, "garuda-force"),
  garudaIds = [garuda];
const transport = G.models.GarudaClass_TITANS__standard,
  passenger = G.models.RMS_106__main_0;
const fullCargo = transport.hangars.reduce(
  (sum, h) => sum + Math.floor(h.capacity / (passenger.transport?.slotCost || 1)),
  0,
);
for (let i = 0; i < fullCargo; i++)
  garudaIds.push(
    add(
      "garuda-ms-" + i,
      "RMS_106",
      "main_0",
      1,
      46,
      20,
      "garuda-force",
      false,
      { carrier: garuda },
    ),
  );
events.push({
  id: "garuda-arrival",
  name: "提坦斯迦楼罗增援",
  when: { type: "round", round: 18 },
  actions: [
    { type: "spawn", actors: garudaIds },
    dialogue(
      line("迦楼罗级运输机出现，格纳库装满了高扎古！", true),
      line("集中火力拦截运输机，不能让他们突破防线。"),
    ),
  ],
});
const elites = [
  add("ace-byarlant", "RX_160", "standard", 1, 48, 12, "ace-force", false, { genericPilot: "ace" }),
  add("ace-asshimar", "NRX_044_MA", "standard", 1, 2, 35, "ace-force", false, {
    genericPilot: "ace",
  }),
  add("enhanced-gaplant", "ORX_005_MA", "standard", 1, 48, 35, "ace-force", false, {
    genericPilot: "enhanced",
  }),
];
events.push({
  id: "elite-arrival",
  name: "提坦斯精锐部队抵达",
  when: { type: "round", round: 24 },
  actions: [
    { type: "spawn", actors: elites },
    dialogue(
      line("检测到三台高性能机体，敌方驾驶员的反应异常迅速！", true),
      line("继续防守。距离发射准备完成还剩11回合。"),
    ),
  ],
});
const relief = [
  add("amuro-dodai", "DodaiKai", "standard", 0, 26, 24, "relief-force"),
  add("amuro-dijeh", "MSK_008", "kit_2", 0, 26, 24, "relief-force", false, {
    carrier: "amuro-dodai", pilotId: "Pilot_AEUG_0087_N_ACE_AMR", level: 5, stayOnSfs: true,
  }),
];
for (let squad = 0; squad < 2; squad++)
  for (let i = 0; i < 3; i++)
    relief.push(add(`relief-nemo-${squad}-${i}`, "MSA_003", "kit_0", 0, 24 + squad * 5, 26,
      "relief-force", false, { squad: "relief-nemo-" + squad }));
events.push({
  id: "amuro-arrival", name: "阿姆罗与尼莫援军抵达",
  when: { type: "round", round: 18 },
  actions: [
    { type: "spawn", actors: relief },
    dialogue({ actor: "amuro-dijeh", name: "阿姆罗·雷", text: "这里是阿姆罗，接下来由我们掩护发射场。",
      portrait: "assets/pilots/Pilot_AEUG_0087_N_ACE_AMR.png" }),
  ],
});
for (let i = 0; i < 3; i++)
  events.push({
    id: "shuttle-lost-" + i,
    name: "穿梭机" + (i + 1) + "被击毁",
    when: { type: "actor_destroyed", actor: "shuttle-" + i },
    actions: [
      dialogue(line("一台穿梭机被击毁了！", true), line("立即掩护剩余发射位，不能再让他们靠近。")),
    ],
  });
events.push({
  id: "countdown",
  name: "发射准备最后阶段",
  when: { type: "round", round: 30 },
  actions: [
    dialogue(
      line("剩余穿梭机进入最后检查，还需要5回合。", true),
      line("所有部队坚持住，准备掩护发射！"),
    ),
  ],
});
for (const count of [2, 3])
  events.push({
    id: "survivors-" + count,
    name: "保全" + count + "台穿梭机",
    when: {
      type: "all",
      conditions: [
        { type: "round", round: 35 },
        { type: "group_alive", group: "shuttles", count },
      ],
    },
    actions: [{ type: "message", text: "穿梭机发射准备完成。" }],
  });
events.push({
  id: "launch",
  name: "穿梭机发射成功",
  when: { type: "round", round: 35 },
  actions: [
    dialogue(
      line("发射准备完成，剩余穿梭机可以起飞！", true),
      line("任务完成。感谢PMC部队的支援，全军掩护穿梭机离开。"),
    ),
  ],
});
events.sort(
  (a, b) =>
    (a.when.type === "start" ? 0 : a.when.round || a.when.conditions?.[0]?.round || 0) -
    (b.when.type === "start" ? 0 : b.when.round || b.when.conditions?.[0]?.round || 0),
);
doc.mission = {
  version: 1,
  era: "UC_0087_T1",
  scenarioFaction: "AEUG",
  technologyLimitEnabled: false,
  technologyLimit: 0,
  costLimit: 9000,
  unitLimit: 18,
  fleetLimit: 3,
  enemyResourcePerPlayer: 0,
  protect: [],
  actors,
  events,
  fixedTime: "afternoon",
  victory: { type: "defend_group", group: "shuttles", round: 35 },
  rewards: {
    money: 7500,
    supplies: 10000,
    technology: 1000,
    inventory: { MSA_003: 9, RMS_099: 3 },
    outcomes: [
      {
        event: "survivors-2",
        money: 10000,
        supplies: 15000,
        technology: 1500,
        inventory: { MSA_003: 9, RMS_099: 3, RX_178_AEUG: 1, MSK_008: 1 },
      },
      {
        event: "survivors-3",
        money: 12500,
        supplies: 17500,
        technology: 1500,
        inventory: { MSA_003: 12, RMS_099: 3, RX_178_AEUG: 1, MSK_008: 1, MSN_100: 1 },
      },
    ],
  },
};
const map = M.compile(doc);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const coast = 9 + Math.round(Math.sin(y * 0.19) * 2);
    map.tiles[y][x] =
      x < coast
        ? "water"
        : x <= coast + 2
          ? "desert"
          : x > 42 && (x * 11 + y * 7) % 13 < 3
            ? "forest"
            : "plain";
  }
map.appearance = {
  biome: "wetland",
  colors: { plain: "#657b62", forest: "#435d4c", water: "#345f76", desert: "#a39a72" },
};
for (const [x, y] of pads)
  for (let dy = -2; dy <= 6; dy++)
    for (let dx = -2; dx <= 6; dx++) map.tiles[y + dy][x + dx] = "plain";
const result = B.rebuild(map);
result.mission = doc.mission;
result.tileMap.mission = doc.mission;
result.mission.source = {
  mod: "GundamWars_BattleOperation2_V5",
  map: "Maps/LimitTimer_PVE_01.tmx",
  script: "Units/Buildings/StoryEvent/Stage1/StoryEvent_Stage_1.ini",
  adaptation: "Compact coastal defense; user-specified 35-turn UC0087 roster and survivor rewards.",
};
const ref = "maps/missions/shuttle_defense.json";
fs.writeFileSync(path.join(root, "assets", ref), JSON.stringify(result, null, 2) + "\n");
const catalogPath = path.join(root, "assets/unit-catalog.json"),
  catalog = JSON.parse(fs.readFileSync(catalogPath));
if (!catalog.maps.includes(ref)) {
  catalog.maps.push(ref);
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
}
console.log("Built", ref, "actors:", actors.length, "Garuda cargo:", fullCargo);

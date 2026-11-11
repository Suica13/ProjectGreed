/* A local draft: the only mutation request is the final batch confirmation. */
const SweepRestock = (() => {
  let draft, snapshot, mission, root;
  const request = (action, data = {}) => Net.request(action, data);
  function action(text, click, disabled = false) {
    const b = element("button", "", text);
    b.type = "button";
    b.disabled = disabled;
    b.onclick = click;
    return b;
  }
  function source() {
    return (mission.teams.find((t) => t.id === snapshot.you.id)?.units || []).map((u) => ({
      key: u.key,
      entry: {
        unitId: u.unitId,
        kitId: u.kitId,
        ...(u.preload ? { preload: u.preload } : {}),
        ...(u.customPilot ? { customPilot: u.customPilot } : {}),
      },
      state: { ...u },
    }));
  }
  function options() {
    const p = snapshot.members.find((p) => p.id === snapshot.you.id),
      stock = Economy.snapshot();
    return {
      budget: Rules.armyBudget(snapshot.settings, p),
      unitLimit: Rules.armyUnitLimit(snapshot.settings, p),
      inventory: stock.inventory,
      restrictions: {
        ...Rules.armyRestrictions(snapshot.settings, p),
        ...Economy.normalizeStock(stock),
        licenses: stock.licenses,
        fleetEmbarkation: false,
      },
    };
  }
  const quote = (ops = draft.operations) => SweepMode.restockPlan(Rules, source(), ops, options());
  function stage(op) {
    draft.operations.push(op);
    draft.chooser = null;
    draw();
  }
  function card(model, name, portrait = null) {
    const row = element("article", "sweep-restock-card"),
      img = element("img"),
      body = element("div");
    img.src = portrait || unitIcon(model);
    img.alt = "";
    body.append(element("strong", "", name));
    row.append(img, body);
    return { row, body };
  }
  function draw() {
    root.replaceChildren();
    if (mission.restockCommitted) draft.operations = [];
    let plan;
    try {
      plan = quote();
    } catch (error) {
      root.append(
        element("p", "sweep-error", error.message),
        action("撤销", () => {
          draft.operations.pop();
          draw();
        }),
      );
      return;
    }
    if (mission.restockCommitted) {
      plan.used = mission.restockUsed;
      plan.cost = mission.restockCost;
    }
    const top = element("div", "sweep-restock-cost"),
      cost = element("div", "sweep-resource-row"),
      balance = element("div", "sweep-resource-row");
    ProductionUI.resources(cost, plan.cost);
    ProductionUI.resources(balance, mission.pending, { technology: true });
    top.append(
      element("h3", "", "舰队整备 · 当前花费"),
      cost,
      element(
        "p",
        "",
        `编组COST ${plan.totalCost} / ${options().budget} · 容量点 ${plan.points} / ${options().unitLimit}`,
      ),
      element(
        "small",
        "",
        `补员 ${plan.used.add}/3 · 遣返机体 ${plan.used.remove}/3 · 配属驾驶员 ${plan.used.assign}/3 · 遣返驾驶员 ${plan.used.dismiss}/3`,
      ),
      balance,
    );
    const affordable =
      mission.restockCommitted ||
      (plan.cost.money <= mission.pending.money && plan.cost.supplies <= mission.pending.supplies);
    if (!affordable) top.append(element("p", "sweep-error", "本局暂存资源不足"));
    top.append(
      action(
        mission.restockCommitted ? "已确认整备" : "确定",
        () => request("sweep_restock_commit", { operations: draft.operations }),
        mission.restockCommitted || !affordable,
      ),
      action("取消", () => request("sweep_restock_cancel"), mission.restockCommitted),
      action(
        "撤销",
        () => {
          draft.operations.pop();
          draft.chooser = null;
          draw();
        },
        mission.restockCommitted || !draft.operations.length,
      ),
    );
    root.append(top);
    const visited = new Set();
    function drawUnit(r, parent) {
      if (visited.has(r.key)) return;
      visited.add(r.key);
      const model = Rules.formationModel(r.entry),
        c = card(r.state.model, I18n.text(model.name));
      c.body.append(
        element("small", "", `COST ${model.cost} · HP ${r.state.hp} · EN ${r.state.en}`),
      );
      if (r.entry.customPilot)
        c.body.append(element("small", "", I18n.pilotName(r.entry.customPilot)));
      c.body.append(
        action(
          r.entry.customPilot ? "遣返驾驶员 · 500资金" : "配属驾驶员 · 500资金",
          () => {
            if (r.entry.customPilot) stage({ type: "dismiss", key: r.key });
            else {
              draft.chooser = { pilotKey: r.key };
              draft.search = "";
              draw();
            }
          },
          mission.restockCommitted ||
            (r.entry.customPilot ? plan.used.dismiss : plan.used.assign) >= 3,
        ),
      );
      if (r.entry.preload)
        c.body.append(
          action(
            "遣返回机库",
            () => stage({ type: "remove", key: r.key }),
            mission.restockCommitted || plan.used.remove >= 3 || !!r.entry.customPilot,
          ),
          element(
            "small",
            "",
            "遣返物资 " +
              Math.ceil(
                (Economy.productionOffer(r.entry.unitId, r.entry.kitId)?.supplies || 0) / 4,
              ),
          ),
        );
      parent.append(c.row);
      for (const hangar of model.hangars || []) {
        const group = element("section", "sweep-hangar");
        group.append(element("strong", "", hangar.id));
        for (const child of plan.roster.filter(
          (u) => u.entry.preload?.carrierIndex === r.key && u.entry.preload.hangarId === hangar.id,
        ))
          drawUnit(child, group);
        group.append(
          action(
            "＋",
            () => {
              draft.chooser = { preload: { carrierIndex: r.key, hangarId: hangar.id } };
              draft.search = "";
              draw();
            },
            mission.restockCommitted || plan.used.add >= 3,
          ),
        );
        parent.append(group);
      }
    }
    for (const r of plan.roster.filter(
      (r) => !r.entry.preload || !plan.roster.some((p) => p.key === r.entry.preload.carrierIndex),
    ))
      drawUnit(r, root);
    if (draft.chooser) drawPicker(top);
    if (snapshot.you.id === snapshot.hostId) {
      const ids = snapshot.members
        .filter((p) => !p.bot && p.seat !== null && p.seat % 2 === 0)
        .map((p) => p.id);
      root.append(
        action(
          "整备完成，返回任务地图",
          () => request("sweep_resupply_done"),
          !ids.every((id) => mission.restockReady.includes(id)),
        ),
      );
    }
  }
  function drawPicker(top) {
    const box = element("section", "sweep-picker"),
      search = element("input"),
      cards = element("div", "sweep-restock-cards"),
      pilots = draft.chooser.pilotKey !== undefined,
      eligibility = new Map();
    search.type = "search";
    search.placeholder = pilots ? "搜索驾驶员" : "搜索有库存的单位";
    search.value = draft.search || "";
    function refresh() {
      cards.replaceChildren();
      const query = search.value.toLocaleLowerCase();
      const items = pilots
        ? Formation.availablePilots().filter((p) =>
            I18n.pilotName(p).toLocaleLowerCase().includes(query),
          )
        : ART.prefabs
            .filter(
              (p) =>
                !p.formOnly &&
                !p.facility &&
                !p.wip &&
                Economy.quantity(p.id) > 0 &&
                (p.name + p.id).toLocaleLowerCase().includes(query),
            )
            .sort((a, b) => a.stats.cost - b.stats.cost);
      for (const item of items) {
        const op = pilots
          ? { type: "assign", key: draft.chooser.pilotKey, pilot: item }
          : {
              type: "add",
              entry: {
                unitId: item.id,
                kitId: Economy.defaultKit(item.id),
                preload: draft.chooser.preload,
              },
            };
        let error = eligibility.get(item.id);
        if (error === undefined) {
          error = "";
          try {
            const next = quote([...draft.operations, op]);
            if (
              next.cost.money > mission.pending.money ||
              next.cost.supplies > mission.pending.supplies
            )
              error = "本局暂存资源不足";
          } catch (e) {
            error = e.message;
          }
          eligibility.set(item.id, error);
        }
        const model = pilots ? null : Economy.defaultModel(item.id),
          c = card(
            model,
            pilots ? I18n.pilotName(item) : I18n.text(item.name),
            pilots ? PilotSystem.portrait(item) : null,
          );
        c.body.append(
          element(
            "small",
            "",
            pilots
              ? `Lv.${item.level}`
              : `COST ${Rules.models[model]?.cost} · 库存 ${Economy.quantity(item.id)}`,
          ),
          action(pilots ? "申请配属" : "申请部署", () => stage(op), !!error),
          element(
            "small",
            "",
            pilots
              ? "资金 500"
              : "部署物资 " +
                  Math.ceil(
                    (Economy.productionOffer(item.id, Economy.defaultKit(item.id))?.supplies || 0) /
                      4,
                  ),
          ),
        );
        if (error) {
          c.row.classList.add("blocked");
          c.row.title = error;
          c.body.append(element("small", "sweep-error", error));
        }
        cards.append(c.row);
      }
    }
    search.oninput = () => {
      draft.search = search.value;
      refresh();
    };
    refresh();
    box.append(
      search,
      action("关闭选择", () => {
        draft.chooser = null;
        draw();
      }),
      cards,
    );
    top.after(box);
  }
  function render(container, value) {
    root = container;
    snapshot = value;
    mission = value.sweep;
    const key = value.matchId + ":" + mission.depth;
    if (draft?.key !== key) draft = { key, operations: [], chooser: null };
    draw();
  }
  return {
    render,
    reset: () => {
      draft = null;
    },
  };
})();

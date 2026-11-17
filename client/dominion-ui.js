/* RTT panels submit intents to the same room authority in online and offline play. */
const DominionUI = (() => {
  const bar = element("section", "dominion-toolbar"),
    label = element("strong", "", "占山为王"),
    buttons = element("div", "");
  bar.id = "dominionToolbar";
  bar.hidden = true;
  bar.append(label, buttons);
  byId("mapWrap").querySelector(".hud-top-line").append(bar);
  const dialog = element("dialog", "");
  dialog.id = "dominionDialog";
  document.body.append(dialog);
  const style = element("style");
  style.textContent = `
    .dominion-toolbar{grid-column:1/-1;justify-self:center;display:flex;gap:12px;align-items:center;max-width:100%;padding:5px 10px;background:#142733ed;border:1px solid #668ba4;pointer-events:auto}
    .dominion-toolbar[hidden]{display:none}.dominion-toolbar>div{display:flex;gap:6px;flex-wrap:wrap}
    #dominionDialog{width:min(760px,94vw);max-height:85dvh;box-sizing:border-box;background:#152633;color:#e4eff5;padding:14px;border:1px solid #7db2d2}
    .dominion-room .spawn-slot,.dominion-room .lineup-header{grid-template-columns:minmax(0,1fr) 52px minmax(70px,.7fr) 46px;gap:6px}.dominion-room select{width:100%;min-width:0;font-size:12px;padding:5px}
    #dominionDialog header{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #dominionDialog h3{margin:5px 0}#dominionDialog input{width:100%;box-sizing:border-box;margin:8px 0}
    .dominion-list{display:grid;gap:6px;overflow:auto;max-height:52dvh}.dominion-row{display:grid;grid-template-columns:54px minmax(0,1fr) 92px;align-items:center;gap:9px;padding:7px;background:#223847}
    .dominion-row img{width:54px;height:54px;object-fit:contain}.dominion-row strong,.dominion-row small{display:block}.dominion-row select{max-width:100%;margin-top:4px}.dominion-row button{min-height:36px}.dominion-row small{color:#b6cad7}
    #dominionRoomOptions .room-mode-fields{display:flex;gap:12px;flex-wrap:wrap}#dominionRoomOptions label{display:grid;gap:5px;min-width:130px}
    @media(max-width:600px){.dominion-toolbar{font-size:11px;padding:4px;gap:6px}.dominion-toolbar button{padding:5px;font-size:11px}.dominion-row{grid-template-columns:42px minmax(0,1fr) 74px;gap:6px;font-size:12px}.dominion-row img{width:42px;height:42px}}
  `;
  document.head.append(style);
  let facilityId = null,
    lastKey = "",
    lastDialogKey = "",
    query = "";
  const images = new Map();
  function image(source) {
    if (!images.has(source)) {
      const img = new Image();
      img.src = source;
      images.set(source, img);
    }
    return images.get(source);
  }
  const wallet = () => game.dominion?.players[Net.seat];
  const canUse = () => phase === "idle" && Net.canAct() && !Net.awaiting && game.winner === null;
  function request(action, fields) {
    Net.request(action, fields);
  }
  function open(u) {
    facilityId = u.id;
    query = "";
    lastDialogKey = "";
    dialog.showModal();
    renderDialog();
  }
  function renderDialog() {
    if (!dialog.open) return;
    const u = getUnit(facilityId),
      p = wallet();
    const key = JSON.stringify([
      facilityId,
      u?.hp,
      u?.ownerSeat,
      u?.dominionOrder,
      p,
      phase,
      canUse(),
      I18n.language,
    ]);
    if (key === lastDialogKey) return;
    lastDialogKey = key;
    const scroll = dialog.querySelector(".dominion-list")?.scrollTop || 0;
    dialog.replaceChildren();
    const header = element("header"),
      close = element("button", "", "关闭");
    close.onclick = () => dialog.close();
    header.append(element("h3", "", u ? Rules.unitName(u) : "设施已失去"), close);
    dialog.append(header);
    if (!u || !p || u.hp <= 0 || Rules.ownerOf(u) !== Net.seat) {
      dialog.append(element("p", "", "设施不存在、已损毁或不属于你"));
      return;
    }
    const balance = element("p", "resource-balance");
    ProductionUI.resources(balance, { ...p, technology: p.points }, { technology: true });
    dialog.append(balance);
    const list = element("div", "dominion-list");
    if (u.facility.type === "factory") {
      const order = u.dominionOrder;
      dialog.append(
        element(
          "p",
          "",
          order
            ? "正在生产：" +
                Rules.models[order.unitId + "__" + order.kitId].name +
                " · 剩余" +
                order.remaining +
                "回合"
            : "每次生产一台，完成后从工厂附近出厂；落点被占用时等待空位。",
        ),
      );
      const search = element("input");
      search.placeholder = "搜索单位";
      search.value = query;
      const offers = Rules.dominionMode.offers(Rules, game, Net.seat);
      const draw = () => {
        list.replaceChildren();
        const groups = new Map();
        for (const offer of offers) {
          if (
            query &&
            !(offer.model.name + offer.unitId).toLowerCase().includes(query.toLowerCase())
          )
            continue;
          if (!groups.has(offer.unitId)) groups.set(offer.unitId, []);
          groups.get(offer.unitId).push(offer);
        }
        for (const [id, kits] of [...groups].sort((a, b) =>
          a[1][0].model.name.localeCompare(b[1][0].model.name, I18n.language),
        )) {
          const row = element("div", "dominion-row"),
            icon = element("img"),
            body = element("div"),
            select = element("select"),
            price = element("small"),
            produce = element("button", "primary", "生产");
          icon.src = unitIcon(id + "__" + kits[0].kitId);
          body.append(element("strong", "", kits[0].model.name));
          for (const kit of kits) select.add(new Option(kit.model.kitName, kit.kitId));
          const update = () => {
            const o = kits.find((o) => o.kitId === select.value);
            price.textContent = `资金 ${o.cost.money} · 物资 ${o.cost.supplies} · ${o.turns}回合`;
            produce.disabled =
              !canUse() || !!order || p.money < o.cost.money || p.supplies < o.cost.supplies;
          };
          select.onchange = update;
          update();
          produce.onclick = () =>
            request("dominion_produce", { factoryId: u.id, unitId: id, kitId: select.value });
          body.append(select, price);
          row.append(icon, body, produce);
          list.append(row);
        }
        if (!groups.size) list.append(element("p", "", "没有符合当前阵营、科技和环境的单位"));
      };
      search.oninput = () => {
        query = search.value;
        draw();
      };
      dialog.append(search);
      draw();
    } else if (u.facility.type === "research") {
      dialog.append(
        element("p", "", "局内累计科技点达到需求后开发，不消耗科技点；个人科技进度不影响本局。"),
      );
      const known = p.researched[p.faction] || [];
      for (const n of Development.nodes(p.faction).filter(
        (n) => Rules.technologyWeight(n.era) <= Rules.technologyWeight(game.dominion.era),
      )) {
        const row = element("div", "dominion-row"),
          icon = element("img"),
          body = element("div"),
          done = known.includes(n.id),
          button = element("button", done ? "" : "primary", done ? "已开发" : "开发");
        icon.src = n.icon;
        body.append(element("strong", "", n.name), element("small", "", "科技点需求 " + n.points));
        button.disabled =
          done || !canUse() || p.points < n.points || !n.requires.every((id) => known.includes(id));
        button.onclick = () => request("dominion_research", { labId: u.id, techId: n.id });
        row.append(icon, body, button);
        list.append(row);
      }
    }
    dialog.append(list);
    list.scrollTop = scroll;
  }
  function refresh() {
    const active = !!game.dominion && pageView === "game";
    bar.hidden = !active;
    if (!active) {
      if (dialog.open) dialog.close();
      return;
    }
    const key = Net.revision + ":" + selected + ":" + phase + ":" + !!Net.awaiting;
    if (lastKey === key) return;
    lastKey = key;
    buttons.replaceChildren();
    const p = wallet(),
      u = getUnit(selected);
    label.textContent = p
      ? "占山为王 · " + (Rules.factionInfo[p.faction]?.name || p.faction)
      : "占山为王 · 观战";
    if (
      u &&
      Rules.ownerOf(u) === Net.seat &&
      u.hp > 0 &&
      ["factory", "research"].includes(u.facility?.type)
    ) {
      const b = element(
        "button",
        "primary",
        u.facility.type === "factory" ? "工厂生产" : "局内科技",
      );
      b.onclick = () => open(u);
      buttons.append(b);
    }
    if (p) {
      const rate = Rules.dominionMode.income(game, Net.seat);
      const text = element(
        "small",
        "",
        `每回合 +${rate.money}资金 / +${rate.supplies}物资 / +${rate.points}科技点`,
      );
      buttons.append(text);
    }
    if (
      u &&
      !u.facility &&
      Rules.ownerOf(u) === Net.seat &&
      Rules.campaignBattlefield.canSuppress(Rules, u)
    ) {
      const point = game.dominion.points.find(
        (p) =>
          (p.ownerSeat === null || p.ownerSeat % 2 !== u.team) &&
          Rules.cells(u).some((c) => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= 2),
      );
      if (point) {
        const b = element("button", "primary", "占领 " + point.name);
        b.disabled = !canUse() || u.acted;
        b.onclick = () => request("dominion_capture", { unitId: u.id, pointId: point.id });
        buttons.append(b);
      }
    }
    renderDialog();
  }
  function click(cell) {
    if (!game.dominion || !canUse()) return false;
    const u = Rules.at(game, cell.x, cell.y);
    if (u && Rules.ownerOf(u) === Net.seat && ["factory", "research"].includes(u.facility?.type)) {
      selected = u.id;
      open(u);
      update();
      return true;
    }
    return false;
  }
  function draw(ctx, ox, oy, tile) {
    if (!game.dominion) return;
    ctx.save();
    for (const p of game.dominion.points) {
      const x = ox + (p.x + 0.5) * tile,
        y = oy + (p.y + 0.5) * tile;
      ctx.strokeStyle = p.ownerSeat === null ? "#c9bda2" : p.ownerSeat % 2 ? "#ef8585" : "#68c5f5";
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 2.5 * tile, y - 2.5 * tile, 5 * tile, 5 * tile);
      const icon = image(Rules.getMap(game.mapId).dominion.pointIcon);
      if (icon.complete && icon.naturalWidth)
        ctx.drawImage(icon, x - tile * 0.5, y - tile * 0.5, tile, tile);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = "center";
      ctx.font = Math.max(10, Math.min(15, tile * 0.5)) + "px sans-serif";
      ctx.fillText(p.name, x, y + tile * 1.25);
    }
    const map = Rules.getMap(game.mapId);
    for (const p of game.dominion.points.filter((p) => p.ownerSeat === null)) {
      const plots = [];
      for (let i = 0; i < (p.size || 1); i++)
        plots.push(["factory", p.x - 4 + i * 4, p.y - 4], ["refinery", p.x - 4 + i * 4, p.y + 4]);
      for (let i = 0; i < Math.ceil((p.size || 1) / 2); i++)
        plots.push(["research", p.x + 6, p.y - 2 + i * 4]);
      for (const [type, x, y] of plots) {
        const id = Rules.dominionMode.buildings[type],
          img = image(unitIcon(id + "__standard"));
        ctx.globalAlpha = 0.45;
        if (img.complete && img.naturalWidth) {
          const scale = tile / Math.max(img.naturalWidth, img.naturalHeight),
            width = img.naturalWidth * scale,
            height = img.naturalHeight * scale;
          ctx.drawImage(img, ox + (x + 0.5) * tile - width / 2,
            oy + (y + 0.5) * tile - height / 2, width, height);
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
  window.addEventListener("page-changing", () => dialog.close());
  for (const type of ["keydown", "keyup"])
    dialog.addEventListener(type, (e) => e.stopPropagation());
  return { refresh, click, draw };
})();
window.DominionUI = DominionUI;

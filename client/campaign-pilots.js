/* The strategic crew roster reads only the authoritative campaign snapshot. */
window.createCampaignPilotUI = ({ state, command, node, button }) => {
  const dialog = node("dialog", "", "campaign-pilot-dialog");
  dialog.id = "campaignPilotDialog";
  document.body.append(dialog);
  let armyId = null,
    selectedId = null,
    recruiting = false,
    recruitName = "",
    portraitId = null;
  const team = () => (Number.isInteger(Net.seat) ? Rules.seatTeam(Net.seat) : null);
  const request = (action, fields) => command("campaign_pilot_" + action, fields);
  function open(id = null) {
    armyId = id;
    selectedId = state()?.units.find((unit) => unit.id === id)?.pilotId || null;
    recruiting = false;
    refresh();
    if (!dialog.open) dialog.showModal();
  }
  async function pay(action, profile, money) {
    if (
      await GameDialog.confirm(
        `${I18n.text("资金")} ${formatNumber(money)} · ${I18n.text(action === "upgrade" ? "升职" : action === "demote" ? "降职" : "重置属性点")}？`,
      )
    )
      request(action, { pilotId: profile.id });
  }
  function refresh() {
    const s = state(),
      side = team();
    if (!s || Net.started || side === null) {
      dialog.close();
      return;
    }
    const army = s.units.find((unit) => unit.id === armyId && !unit.destroyed);
    const pool = s.teams[side],
      members = Net.snapshot.members;
    const locked = s.phase !== "strategy" || s.winner !== null || !!Net.awaiting || s.ready.includes(Net.seat);
    const header = node("header", "", "campaign-order-header");
    header.append(
      node(
        "h3",
        army ? "驾驶员配属 · " + CampaignRules.unitLabel({ G: Rules }, army) : "战役驾驶员",
      ),
      button("关闭", () => dialog.close()),
    );
    const body = node("div", "", "campaign-pilot-body");
    const balance = node("div", "", "resource-balance");
    ProductionUI.resources(balance, pool);
    body.append(balance);
    const toolbar = node("div", "", "campaign-pilot-toolbar");
    toolbar.append(
      button(
        "招募驾驶员",
        () => {
          recruiting = !recruiting;
          refresh();
        },
        locked,
      ),
    );
    if (army)
      toolbar.append(
        button(
          "取消配属",
          () => request("assign", { armyId, pilotId: null }),
          locked || !army.pilotId || !CampaignRules.controls(s, members, Net.seat, army),
        ),
      );
    body.append(toolbar);
    if (recruiting) {
      const form = node("form", "", "campaign-pilot-recruit");
      const name = node("input");
      name.placeholder = I18n.text("驾驶员名称");
      name.maxLength = 24;
      name.value = recruitName;
      name.setAttribute("aria-label", "驾驶员名称");
      name.oninput = () => {
        recruitName = name.value;
      };
      const portraits = node("select");
      portraits.setAttribute("aria-label", "驾驶员头像");
      for (const p of PilotSystem.catalog.portraits.filter((p) => p.faction === pool.faction))
        portraits.append(new Option(p.name || p.id, p.id));
      if (!portraitId || ![...portraits.options].some((p) => p.value === portraitId))
        portraitId = portraits.options[0]?.value;
      portraits.value = portraitId;
      const avatar = node("img");
      avatar.src = PilotSystem.portrait({ portraitId, faction: pool.faction });
      avatar.alt = "";
      portraits.onchange = () => {
        portraitId = portraits.value;
        avatar.src = PilotSystem.portrait({ portraitId, faction: pool.faction });
      };
      const price = PilotSystem.customRecruitmentCost;
      const submit = button(
        `招募 · 资金 ${formatNumber(price)}`,
        () => {
          recruitName = name.value;
          request("recruit", { name: recruitName, portraitId });
        },
        locked || pool.money < price,
      );
      form.onsubmit = (event) => {
        event.preventDefault();
        submit.click();
      };
      form.append(avatar, name, portraits, submit);
      body.append(form);
      const aceRow = node("div", "", "campaign-pilot-ace");
      const aces = node("select");
      aces.setAttribute("aria-label", "招募ACE");
      aces.append(new Option(I18n.text("选择ACE驾驶员"), ""));
      for (const ace of PilotSystem.catalog.aces.filter((p) =>
        PilotSystem.canAssign({ aceId: p.id }, pool.faction),
      )) {
        const previous = CampaignPilots.find(s, side, "ace-" + ace.id);
        const unlocked = CampaignPilots.available({ development: Development }, s, side, ace.id);
        const price = PilotSystem.recruitmentPrice(ace.id, previous?.profile);
        const text = `${I18n.localized(ace)} · ${previous && !previous.profile.needsRecruitment ? I18n.text("已招募") : !unlocked ? I18n.text("未解锁") : `${I18n.text("资金")} ${formatNumber(price.money)} / ${I18n.text("物资")} ${formatNumber(price.supplies)}`}`;
        const option = new Option(text, ace.id);
        option.disabled =
          !unlocked ||
          (previous && !previous.profile.needsRecruitment) ||
          !price ||
          pool.money < price.money ||
          pool.supplies < price.supplies;
        aces.append(option);
      }
      aceRow.append(
        aces,
        button(
          "招募ACE",
          () => {
            if (aces.value) request("recruit", { aceId: aces.value });
          },
          locked,
        ),
      );
      body.append(aceRow);
    }
    const list = node("div", "", "campaign-pilot-list");
    for (const entry of (s.pilots || []).filter((entry) => entry.team === side)) {
      const p = entry.profile,
        occupied = CampaignPilots.assigned(s, entry);
      const editable =
        !locked &&
        CampaignPilots.permits(members, Net.seat, entry) &&
        !p.needsRecruitment &&
        (!occupied ||
          (!occupied.moveTo &&
            !s.transfers.some((t) => t.ids.includes(occupied.id)) &&
            !s.encounters.some((e) => e.region === occupied.region && e.turn === s.turn)));
      const row = node("article", "", "campaign-pilot-card");
      row.dataset.pilotId = p.id;
      const image = node("img");
      image.src = PilotSystem.portrait(p);
      image.alt = "";
      image.loading = "lazy";
      const info = node("div", "", "campaign-pilot-copy");
      info.append(
        node("strong", p.name),
        node(
          "small",
          `Lv.${p.level} · EXP ${formatNumber(p.experience)} / ${p.level >= PilotSystem.maxLevel(p) ? "MAX" : formatNumber(PilotSystem.experienceRequired(p.level, p))}`,
        ),
      );
      info.append(
        node(
          "small",
          p.needsRecruitment
            ? "待回归"
            : occupied
              ? I18n.text("已配属：") +
                CampaignRules.unitLabel({ G: Rules }, occupied) +
                " · " +
                I18n.text(
                  CAMPAIGN_WORLD.regions.find((region) => region.id === occupied.region)?.name ||
                    occupied.region,
                )
              : "未配属",
        ),
      );
      const actions = node("div", "", "campaign-pilot-buttons");
      if (army)
        actions.append(
          button(
            army.pilotId === p.id ? "已配属" : "配属",
            () => request("assign", { armyId, pilotId: p.id }),
            !editable ||
              !!occupied ||
              !CampaignRules.controls(s, members, Net.seat, army) ||
              !!army.moveTo,
          ),
        );
      actions.append(
        button(selectedId === p.id ? "收起" : "详情", () => {
          selectedId = selectedId === p.id ? null : p.id;
          refresh();
        }),
      );
      row.append(image, info, actions);
      if (selectedId === p.id) {
        const details = node("section", "", "campaign-pilot-details");
        details.append(node("p", `剩余强化点：${p.points}`));
        for (const [key, label] of Object.entries(PilotSystem.labels)) {
          const stat = node("div", "", "campaign-pilot-stat");
          stat.append(
            node("span", label),
            node("strong", String(Math.round(p.stats[key]))),
          );
          if (!p.ace)
            for (const amount of [1, 5])
              stat.append(
                button(
                  "+" + amount,
                  () => request("train", { pilotId: p.id, stat: key, amount }),
                  !editable ||
                    p.points < amount ||
                    p.stats[key] + amount > PilotSystem.statCap(p.level),
                ),
              );
          details.append(stat);
        }
        const advancement = node("div", "", "campaign-pilot-advancement");
        const promote = button(
          `升职 · 资金 ${formatNumber(PilotSystem.upgradeCost(p) || 0)}`,
          () => pay("upgrade", p, PilotSystem.upgradeCost(p)),
          !editable || !PilotSystem.canUpgrade(p) || pool.money < PilotSystem.upgradeCost(p),
        );
        promote.classList.toggle("campaign-pilot-upgrade-ready", PilotSystem.canUpgrade(p));
        advancement.append(
          promote,
          button(
            `降职 · 资金 ${formatNumber(PilotSystem.demotionCost(p) || 0)}`,
            () => pay("demote", p, PilotSystem.demotionCost(p)),
            !editable || p.level <= 0 || pool.money < PilotSystem.demotionCost(p),
          ),
        );
        if (!p.ace)
          advancement.append(
            button(
              "重置属性点",
              () => pay("reset", p, p.level * 1000),
              !editable || pool.money < p.level * 1000,
            ),
          );
        details.append(advancement);
        if (PilotSystem.canLearnSkill(p)) {
          const skills = node("select");
          skills.setAttribute("aria-label", "驾驶员技能");
          for (const skill of PilotSystem.skillChoices)
            skills.append(new Option(I18n.localized(skill), skill.id));
          details.append(
            skills,
            button(
              "学习技能",
              () => request("skill", { pilotId: p.id, skillId: skills.value }),
              !editable,
            ),
          );
        }
        const skills = PilotSystem.skillsOf({ pilot: p });
        if (skills.length)
          details.append(node("p", skills.map((skill) => I18n.localized(skill)).join(" / ")));
        details.append(
          node(
            "small",
            `击坠 ${p.record.kills} · 战舰 ${p.record.shipKills} · 参战 ${p.record.battles} · 被击坠 ${p.record.losses}`,
          ),
        );
        row.append(details);
      }
      list.append(row);
    }
    if (!list.childElementCount) list.append(node("p", "暂无战役驾驶员，请先招募。"));
    body.append(list);
    const scroll = dialog.querySelector(".campaign-pilot-body")?.scrollTop || 0;
    dialog.replaceChildren(header, body);
    body.scrollTop = scroll;
  }
  return {
    open,
    refresh: () => {
      if (dialog.open) refresh();
    },
    close: () => dialog.close(),
  };
};

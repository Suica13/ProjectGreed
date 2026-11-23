/* Liaison commissions and merchant communications. */
window.ContactUI = (() => {
  const screen = element("section", "warehouse-screen contact-screen"),
    main = element("section", "warehouse-main"),
    header = element("header"),
    content = element("div", "contact-content"),
    tasks = element("div", "contact-tasks"),
    merchants = element("div", "contact-merchants"),
    supply = element("div", "contact-supply"),
    terminal = element("dialog", "contact-terminal");
  screen.id = "contactScreen";
  screen.hidden = true;
  tasks.id = "contactTasks";
  merchants.id = "contactMerchants";
  supply.id = "contactSupply";
  terminal.id = "merchantTerminal";
  terminal.setAttribute("aria-labelledby", "merchantTerminalName");
  header.append(element("span", "muted", "联络终端"));
  content.append(tasks, merchants, supply);
  main.append(header, content);
  screen.append(main);
  document.body.append(screen, terminal);
  let trader = null,
    view = "home",
    query = "",
    purchasing = false;
  const collapsedTaskGroups = new Set();
  let exchangeSource = "supplies", exchangeQuantity = 1;
  let selectedTask = null,
    selectedAcceptedTask = null,
    dialogue = null;
  const button = (text, action, cls = "") => {
    const node = element("button", cls, text);
    node.type = "button";
    node.onclick = action;
    return node;
  };
  function renderMerchants() {
    merchants.replaceChildren();
    for (const merchant of Economy.merchants) {
      const card = element("article", "merchant-card"),
        frame = button("", () => openMerchant(merchant.id), "merchant-portrait"),
        image = element("img"),
        info = element("div", "merchant-information"),
        stats = element("dl");
      card.dataset.merchantId = merchant.id;
      frame.setAttribute("aria-label", I18n.text(merchant.name));
      image.src = merchant.portraitImage || PilotSystem.portrait({ portraitId: merchant.portraitId });
      image.alt = "";
      image.draggable = false;
      frame.append(image);
      stats.append(
        element("dt", "", "好感度"),
        element("dd", "", Economy.merchantAffinity(merchant.id).toFixed(1)),
        element("dt", "", "等级"),
        element("dd", "", "Lv" + Economy.merchantLevel(merchant.id)),
      );
      info.append(element("h3", "", merchant.name), stats);
      card.append(frame, info);
      merchants.append(card);
    }
  }
  function renderTasks() {
    const scroll=taskScroll(tasks);
    tasks.replaceChildren(taskPanel({ acceptedOnly: true }));
    restoreTaskScroll(tasks,scroll);
  }
  function taskScroll(root) {
    return {
      selected:root.querySelector(".contact-task-layout")?.dataset.selectedTask,
      list:root.querySelector(".contact-task-list")?.scrollTop || 0,
      detail:root.querySelector(".contact-task-detail")?.scrollTop || 0,
    };
  }
  function restoreTaskScroll(root,scroll) {
    const list=root.querySelector(".contact-task-list"),detail=root.querySelector(".contact-task-detail");
    if(list) list.scrollTop=scroll.list;
    if(detail && root.querySelector(".contact-task-layout")?.dataset.selectedTask===scroll.selected)
      detail.scrollTop=scroll.detail;
  }
  function selectTask(box,task,acceptedOnly) {
    if(box.dataset.selectedTask===task.id) return;
    if(acceptedOnly) selectedAcceptedTask=task.id;
    else selectedTask=task.id;
    // Keep the live list and focused card attached. Replacing the entire
    // terminal loses the nested scroller and jumps back to the first task.
    const next=taskPanel({acceptedOnly});
    box.querySelector(".contact-task-detail").replaceWith(next.querySelector(".contact-task-detail"));
    box.dataset.selectedTask=task.id;
    for(const card of box.querySelectorAll("[data-task-id]"))
      card.setAttribute("aria-pressed",String(card.dataset.taskId===task.id));
  }
  function taskTitle(task,tag="span") {
    const title=element(tag,"contact-task-title");
    if(ContactTasks.isSideTask(task))title.append(element("span","contact-task-side-tag","支线"));
    title.append(element("strong","",task.name));
    return title;
  }
  function taskSummary(task, progress = 0) {
    const targets = {
      "efsf-1": "歼灭吉翁军MS",
      "efsf-2": "取回坠落米迪亚残骸中的数据后撤离",
      "efsf-3": "击败记名联邦MS小队",
      "efsf-4": "击毁指定区域的吉翁MS",
      "efsf-5": "使用苍白骑士摧毁工厂",
      "efsf-6": "调查运输车队残骸后成功撤离",
      "efsf-7": "击败不死的雷纳斯小队",
      "efsf-8": "歼灭吉翁军MS",
      "efsf-9": "摧毁敌军基地后成功撤离",
      "efsf-10": "使用炮击技能击坠吉翁军MS",
    };
    return {
      conditions: [
        I18n.text("合约模式"),
        "N" + task.difficulty + I18n.text("以上"),
        task.era ? task.era.replace("UC_", "").replace("_", "") : ContactTasks.contactId(task)==="anaheim" ? "当前年代" : "0079T1",
        I18n.text(task.enemyFaction === "NONE" ? "无友军" : task.enemyFaction === "EFSF" ? "敌军：地球联邦军" : "敌军：吉翁军"),
        ...(task.ground ? [I18n.text("地面")] : []),
      ].join(" · "),
      objective:
        I18n.text(task.objectiveText || targets[task.id] || task.eventName || task.name) +
        " " +
        progress +
        "/" +
        task.required,
    };
  }
  function playDialogue(lines, done, title) {
    dialogue = { lines, index: 0, lastSound: -1, done, title };
    view = "dialogue";
    renderTerminal();
  }
  function renderDialogue(body) {
    const d = dialogue,
      line = d.lines[d.index],
      panel = element("section", "liaison-dialogue"),
      portrait = element("img"),
      text = element("div");
    portrait.src = trader.portraitImage || PilotSystem.portrait({ portraitId: trader.portraitId });
    portrait.alt = "";
    text.className = "liaison-dialogue-text";
    if (d.lastSound !== d.index) {
      d.lastSound = d.index;
      GameAudio.play("infoSound");
    }
    text.append(
      element("h3", "", line[0]),
      element("p", "", I18n.text(line[1]).replaceAll("【玩家公司名】", PlayerProfile.name())),
    );
    const next = button(
      d.index === d.lines.length - 1 ? "结束通信" : "继续",
      () => {
        if (d.index < d.lines.length - 1) {
          d.index++;
          renderTerminal();
          return;
        }
        try {
          d.done();
          dialogue = null;
          view = "home";
          renderMerchants();
          renderTasks();
          renderTerminal();
        } catch (error) {
          note(Economy.errorMessage(error));
        }
      },
      "primary",
    );
    next.disabled = Net.started;
    next.id = "liaisonDialogueNext";
    panel.append(
      element("small", "muted", d.title + " · " + (d.index + 1) + " / " + d.lines.length),
      portrait,
      text,
      next,
    );
    body.append(panel);
  }
  function taskPanel({ acceptedOnly = false } = {}) {
    const box = element("div", "contact-task-layout"),
      list = element("nav", "contact-task-list"),
      detail = element("section", "contact-task-detail"),
      state = Economy.snapshot();
    const candidates = ContactTasks.tasks.filter((task) =>
      acceptedOnly
        ? state.contactTasks.some((e) => e.id === task.id && e.status !== "claimed")
        : (task.contactId || "efsf") === trader.id,
    );
    const current = acceptedOnly ? selectedAcceptedTask : selectedTask;
    const selected = candidates.find((task) => task.id === current);
    box.dataset.selectedTask=selected?.id || "";
    if (acceptedOnly) selectedAcceptedTask = selected?.id || null;
    else if (selected) selectedTask = selected.id;
    list.setAttribute("aria-label", I18n.text("联络人任务"));
    for (const merchant of Economy.merchants.filter((m) => acceptedOnly || m.id === trader.id)) {
      const grouped = candidates.filter((task) => (task.contactId || "efsf") === merchant.id);
      if (acceptedOnly && !grouped.length && merchant.id !== "efsf") continue;
      const group = element("section", "contact-task-group"),
        heading = element("h3"),
        cards = element("div", "contact-task-group-cards"),
        groupId = (acceptedOnly ? "accepted-" : "merchant-") + merchant.id,
        toggle = button(
          ["efsf","zeon"].includes(merchant.id) ? ContactTasks.contactName(merchant.id) : merchant.name,
          () => {
            if (collapsedTaskGroups.has(groupId)) collapsedTaskGroups.delete(groupId);
            else collapsedTaskGroups.add(groupId);
            if (acceptedOnly) renderTasks();
            else renderTerminal();
          },
          "contact-task-group-toggle",
        );
      cards.id = "contact-task-group-" + groupId;
      cards.hidden = collapsedTaskGroups.has(groupId);
      toggle.setAttribute("aria-expanded", String(!cards.hidden));
      toggle.setAttribute("aria-controls", cards.id);
      heading.append(toggle);
      group.dataset.contactId = merchant.id;
      group.append(heading);
      for (const task of grouped) {
        const entry = state.contactTasks.find((e) => e.id === task.id),
          available =
            ContactTasks.unlocked(task, state.contactTasks, state);
        const b = button(
          "",
          () => selectTask(box,task,acceptedOnly),
          "contact-task-card",
        );
        b.append(
          taskTitle(task),
          element(
            "span",
            "contact-task-card-status",
            entry
              ? { accepted: "进行中", ready: "可交付", claimed: "已完成" }[entry.status]
              : available
                ? "可接受"
                : "未解锁",
          ),
        );
        b.dataset.locked = String(!available && !entry);
        b.dataset.taskId = task.id;
        b.dataset.branch = ContactTasks.isSideTask(task) ? "side" : "main";
        b.setAttribute("aria-pressed", String(selected?.id === task.id));
        cards.append(b);
      }
      if (!grouped.length)
        cards.append(element("p", "muted", acceptedOnly ? "暂无已接受任务" : "暂无可用任务"));
      group.append(cards);
      list.append(group);
    }
    if (!selected) {
      detail.classList.add("contact-task-unselected");
      detail.append(element("p", "muted", "请选择任务"));
      box.append(list, detail);
      return box;
    }
    const task = selected,
      entry = state.contactTasks.find((e) => e.id === task.id),
      available =
        ContactTasks.unlocked(task, state.contactTasks, state);
    const unitRewards = (inventory, temporary = false) => {
      const group = element("div", "contact-unit-rewards");
      for (const [id, count] of Object.entries(inventory)) {
        const modelId = Economy.defaultModel(id),
          m = UnitModels[modelId],
          row = element("span", "contact-unit-reward"),
          img = element("img");
        img.src = unitIcon(modelId);
        img.alt = "";
        row.append(img, element("span", "", m.name + (temporary ? I18n.text("(临时单位)") : "") + " ×" + count));
        group.append(row);
      }
      return group;
    };
    const summary = taskSummary(task, entry?.progress || 0),
      objective = element("section", "contact-task-objective");
    objective.append(
      element("p", "contact-task-conditions", summary.conditions),
      element("p", "contact-task-progress", summary.objective),
    );
    detail.append(
      taskTitle(task,"h3"),
      element("p", "contact-task-description", task.description),
      element("h4", "", "任务目标"),
      objective,
    );
    if (task.grant) detail.append(element("h4", "", "初始赠送："), unitRewards(task.grant, !!task.reclaim));
    if (task.reclaim) detail.append(element("p", "muted", "临时单位不可装备零件，完成目标后自动回收并解除驾驶员配属。"));
    detail.append(element("h4", "", "任务奖励"));
    const rewards = element("div", "contact-task-rewards"),
      currency = element("div", "contact-currency-reward"),
      technology = element("div", "contact-technology-reward");
    ProductionUI.resources(
      currency,
      { money: task.money, supplies: task.supplies || 0 },
      { compact: true },
    );
    currency.append(element("span", "", I18n.text("好感度") + " +" + (task.affinity || 100)));
    const plans = ContactTasks.planIds(task).map(id=>Object.values(DEVELOPMENT_TREE).flat().find(node=>node.id===id)).filter(Boolean);
    technology.append(
      element(
        "span",
        "",
        plans.length ? I18n.text("科技奖励") + "：" + plans.map(plan=>I18n.text(plan.name)).join("、") + "（" + I18n.text("单位许可") + "）" : "科技奖励：无",
      ),
    );
    if (task.facilityUnlock)
      technology.append(element("p", "", "允许HQ、工厂、巨型工厂、士官学院升级到2级"));
    if(task.pluginUnlocks?.length) technology.append(element("p","contact-plugin-unlocks",
      I18n.text("零件购买权限")+"："+task.pluginUnlocks.map(id=>I18n.text(UnitPlugins.byId.get(id)?.name || id)).join("、")));
    rewards.append(currency, unitRewards(task.inventory), technology);
    const action = button(
      entry?.status === "ready"
        ? "交付任务"
        : entry?.status === "claimed"
          ? "已完成"
          : entry
            ? "进行中"
            : "接受任务",
      () => {
        if (Net.started) return;
        try {
          if (entry?.status === "ready") {
            if (acceptedOnly) openMerchant(task.contactId || "efsf");
            playDialogue(
              task.ending.split("\n").map((text) => [ContactTasks.contactName(task.contactId || "efsf"), text]),
              () => {
                Economy.completeContactTask(task.id);
                note(
                  ContactTasks.planIds(task).length
                    ? "任务已交付，获得奖励及对应单位许可"
                    : "任务已交付，奖励已发放；满仓单位保存在保管库。",
                );
              },
              task.name,
            );
          } else {
            Economy.acceptContactTask(task.id);
            renderTerminal();
            note(
              task.grant ? "任务已接取，临时单位已发放；机库满员时请到保管库接受。" : "任务已接取",
            );
          }
        } catch (error) {
          note(Economy.errorMessage(error));
        }
      },
      "primary",
    );
    action.id = acceptedOnly ? "acceptedContactTaskAction" : "contactTaskAction";
    action.disabled = Net.started || !available || (!!entry && entry.status !== "ready");
    const actions=element("div","contact-task-actions");
    actions.append(action);
    if(!available && !entry) {
      const requirements=element("div","contact-task-requirements");
      requirements.setAttribute("role","status");
      for(const requirement of ContactTasks.unmetRequirements(task,state.contactTasks,state))
        requirements.append(element("span","",requirement.type==="intro"
          ? I18n.text("前提条件：完成初见联络人通信")
          : I18n.text("前提任务：")+I18n.text(requirement.name)));
      actions.append(requirements);
    }
    detail.append(rewards, actions);
    box.append(list, detail);
    return box;
  }
  function buy(action) {
    if (purchasing || Net.started) return;
    purchasing = true;
    try {
      note(action() ? "购买成功，已放入库存" : "资金或物资不足");
    } catch (error) {
      note(Economy.errorMessage(error));
    } finally {
      purchasing = false;
    }
  }
  function renderShopItems(list) {
    list.replaceChildren();
    const search = query.trim().toLocaleLowerCase();
    for (const part of UnitPlugins.catalog.filter((part) =>
      I18n.text(part.name).toLocaleLowerCase().includes(search),
    )) {
      const offer = Economy.pluginOffer(trader.id, part.id);
      if (!offer) continue;
      const card = element("article", "merchant-product merchant-plugin"),
        price = element("div", "resource-balance"),
        purchase = button(
          "购买",
          () => buy(() => Economy.purchasePlugin(trader.id, part.id)),
          "primary",
        );
      card.dataset.pluginId = part.id;
      ProductionUI.resources(price, offer, { compact: true });
      purchase.disabled = Net.started || !offer.available || !Economy.affordable(offer);
      card.append(
        UnitPreview.pluginCard(part),
        price,
        element(
          "small",
          "merchant-unlock" + (offer.available ? "" : " is-locked"),
          offer.requiredTask ? I18n.text("前提任务：") + I18n.text(offer.requiredTaskName) : "需要好感度等级 " + offer.requiredLevel,
        ),
        element("small", "muted", "可用 " + Economy.pluginQuantity(part.id) + " 件"),
        purchase,
      );
      list.append(card);
    }
    if (!list.children.length) list.append(element("p", "muted", "没有符合条件的商品"));
  }
  function shop() {
    const box = element("div", "contact-shop"),
      bar = element("div", "contact-shop-toolbar"),
      search = element("input"),
      list = element("div", "merchant-products");
    bar.append(element("strong", "", "购买零件"));
    search.type = "search";
    search.placeholder = I18n.text("搜索");
    search.setAttribute("aria-label", I18n.text("搜索商品"));
    search.value = query;
    search.oninput = () => {
      query = search.value;
      renderShopItems(list);
    };
    bar.append(search);
    box.append(bar);
    if (Net.started) box.append(element("p", "muted", "对局进行中不能购买"));
    box.append(list);
    renderShopItems(list);
    return box;
  }
  function resourceExchange() {
    const form = element("form", "contact-exchange"),
      directionLabel = element("label", "", "兑换方向"),
      direction = element("select"),
      quantityLabel = element("label", "", "兑换份数"),
      quantity = element("input"),
      preview = element("div", "contact-exchange-preview"),
      submit = element("button", "primary", "确认兑换");
    direction.id = "merchantExchangeDirection";
    quantity.id = "merchantExchangeQuantity";
    directionLabel.htmlFor = direction.id;
    quantityLabel.htmlFor = quantity.id;
    for (const [value, label] of [["supplies", "物资 → 资金"], ["money", "资金 → 物资"]]) {
      const option = element("option", "", label);
      option.value = value;
      direction.append(option);
    }
    direction.value = exchangeSource;
    quantity.type = "number";
    quantity.min = "1";
    quantity.step = "1";
    quantity.required = true;
    quantity.value = String(exchangeQuantity);
    submit.type = "submit";
    const refresh = () => {
      exchangeSource = direction.value;
      exchangeQuantity = quantity.valueAsNumber;
      preview.replaceChildren();
      try {
        const offer = Economy.resourceExchangeOffer(trader.id, exchangeSource, exchangeQuantity);
        for (const [label, amount] of [["交付", offer.cost], ["获得", offer.gain]]) {
          const row = element("div", "contact-exchange-row"), balance = element("div", "resource-balance");
          ProductionUI.resources(balance, amount, { compact: true });
          row.append(element("span", "", label), balance);
          preview.append(row);
        }
        submit.disabled = Net.started || !offer.available;
        if (!offer.available) preview.append(element("p", "muted", "资金或物资不足"));
      } catch (error) {
        submit.disabled = true;
        preview.append(element("p", "muted", Economy.errorMessage(error)));
      }
    };
    direction.onchange = quantity.oninput = refresh;
    form.onsubmit = event => {
      event.preventDefault();
      if (purchasing || Net.started) return;
      purchasing = true;
      try {
        note(Economy.exchangeResources(trader.id, direction.value, quantity.valueAsNumber) ? "兑换成功" : "资金或物资不足");
      } catch (error) {
        note(Economy.errorMessage(error));
      } finally {
        purchasing = false;
      }
    };
    directionLabel.append(direction);
    quantityLabel.append(quantity);
    form.append(element("h3", "", "资源兑换"), element("p", "muted", "每份：1物资 ⇄ 2资金，可双向兑换。"),
      directionLabel, quantityLabel, preview, submit);
    if (Net.started) form.append(element("p", "muted", "对局进行中不能兑换"));
    refresh();
    return form;
  }
  function renderTerminal() {
    if (!trader) return;
    const taskPosition=taskScroll(terminal),terminalScroll=terminal.scrollTop;
    const top = element("header", "contact-terminal-nav"),
      name = element("h2", "", trader.name),
      balance = element("div", "resource-balance"),
      body = element("div", "contact-terminal-body");
    body.dataset.view = view;
    name.id = "merchantTerminalName";
    ProductionUI.resources(balance, Economy.snapshot(), { compact: true });
    top.append(
      name,
      element("span", "", "好感度 " + Economy.merchantAffinity(trader.id).toFixed(1)),
      element("span", "", "Lv" + Economy.merchantLevel(trader.id)),
      balance,
    );
    if (view !== "home")
      top.append(
        button("返回", () => {
          dialogue = null;
          view = "home";
          renderTerminal();
        }),
      );
    top.append(button("关闭", () => terminal.close()));
    if (view === "dialogue" && dialogue) renderDialogue(body);
    else if (view === "home") {
      const menu = element("div", "contact-terminal-menu");
      menu.append(
        button("任务", () => {
          view = "tasks";
          renderTerminal();
        }),
      );
      if (trader.sellsPlugins)
        menu.append(
          button("购买", () => {
            view = "shop";
            renderTerminal();
          }),
        );
      if (trader.resourceExchange)
        menu.append(button("资源兑换", () => {
          view = "exchange";
          renderTerminal();
        }));
      body.append(element("p", "contact-terminal-status", "通信链路已建立"), menu);
    } else if (view === "tasks") body.append(taskPanel());
    else if (view === "exchange") body.append(resourceExchange());
    else body.append(shop());
    const scroll = terminal.querySelector(".contact-terminal-body")?.scrollTop || 0;
    terminal.replaceChildren(top, body);
    body.scrollTop = scroll;
    restoreTaskScroll(terminal,taskPosition);
    terminal.scrollTop=terminalScroll;
  }
  function openMerchant(id) {
    trader = Economy.merchants.find((merchant) => merchant.id === id);
    if (!trader) return;
    view = "home";
    dialogue = null;
    query = "";
    renderTerminal();
    terminal.showModal();
    if (ContactTasks.introFor(id).length && !ContactTasks.met(Economy.snapshot(),id))
      playDialogue(
        ContactTasks.introFor(id),
        () => {
          Economy.meetLiaison(id);
          note(id === "zeon" ? "已获取陆战型扎古开发计划对应单位许可" : "已获取反MS计划对应单位许可");
        },
        "初见联络人",
      );
  }
  window.addEventListener("economy-changed", () => {
    renderTasks();
    renderMerchants();
    if (terminal.open) renderTerminal();
  });
  window.addEventListener("language-change", () => {
    renderMerchants();
    renderTasks();
    if (terminal.open) renderTerminal();
  });
  window.addEventListener("page-changing", () => terminal.close());
  for (const type of ["keydown", "keyup"])
    terminal.addEventListener(type, (event) => event.stopPropagation());
  renderMerchants();
  renderTasks();
  return {
    taskSummary,
    open(view) {
      tasks.hidden = view !== "contactTasks";
      merchants.hidden = view !== "contactMerchants";
      supply.hidden = view !== "contactSupply";
      content.classList.toggle("is-supply", !supply.hidden);
      if (!supply.hidden) SupplyUI.open(supply);
      renderTasks();
      setPageView(view);
    },
  };
})();

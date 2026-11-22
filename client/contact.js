/* Liaison commissions and merchant communications. */
window.ContactUI = (() => {
  const screen = element("section", "warehouse-screen contact-screen"),
    main = element("section", "warehouse-main"),
    header = element("header"),
    content = element("div", "contact-content"),
    tasks = element("div", "contact-tasks"),
    merchants = element("div", "contact-merchants"),
    terminal = element("dialog", "contact-terminal");
  screen.id = "contactScreen";
  screen.hidden = true;
  tasks.id = "contactTasks";
  merchants.id = "contactMerchants";
  terminal.id = "merchantTerminal";
  terminal.setAttribute("aria-labelledby", "merchantTerminalName");
  header.append(element("span", "muted", "联络终端"));
  content.append(tasks, merchants);
  main.append(header, content);
  screen.append(main);
  document.body.append(screen, terminal);
  let trader = null,
    view = "home",
    query = "",
    purchasing = false;
  let selectedTask="efsf-1", dialogue=null;
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
      image.src = PilotSystem.portrait({ portraitId: merchant.portraitId });
      image.alt = "";
      image.draggable = false;
      frame.append(image);
      stats.append(
        element("dt", "", "好感度"),
        element("dd", "", merchant.id==="efsf"?Economy.liaisonAffinity().toFixed(1):"0"),
        element("dt", "", "等级"),
        element("dd", "", "Lv1"),
      );
      info.append(element("h3", "", merchant.name), stats);
      card.append(frame, info);
      merchants.append(card);
    }
  }
  function renderTasks() {
    tasks.replaceChildren();
    for(const entry of Economy.snapshot().contactTasks.filter(e=>e.status!=="claimed")){
      const task=ContactTasks.byId.get(entry.id),row=element("article","contact-accepted-task"),open=button("联络",()=>{openMerchant("efsf");if(!dialogue){view="tasks";selectedTask=task.id;renderTerminal();}});
      row.append(element("strong","",task.name),element("span","",task.objective),element("span","",entry.progress+" / "+task.required+(entry.status==="ready"?" · 可交付":"")),open);tasks.append(row);
    }
    if(!tasks.children.length)tasks.append(element("p","muted contact-empty","暂无已接受任务"));
  }
  function playDialogue(lines, done, title) {
    dialogue={lines,index:0,done,title};view="dialogue";renderTerminal();
  }
  function renderDialogue(body) {
    const d=dialogue,line=d.lines[d.index],panel=element("section","liaison-dialogue"),portrait=element("img"),text=element("div");
    portrait.src=PilotSystem.portrait({portraitId:trader.portraitId});portrait.alt="";
    text.append(element("h3","",line[0]),element("p","",line[1].replaceAll("【玩家公司名】",PlayerProfile.name())));
    const next=button(d.index===d.lines.length-1?"结束通信":"继续",()=>{
      if(d.index<d.lines.length-1){d.index++;renderTerminal();return;}
      try{d.done();dialogue=null;view="home";renderMerchants();renderTasks();renderTerminal();}catch(error){note(Economy.errorMessage(error));}
    },"primary");
    next.disabled=Net.started;next.id="liaisonDialogueNext";
    panel.append(element("small","muted",d.title+" · "+(d.index+1)+" / "+d.lines.length),portrait,text,next);body.append(panel);
  }
  function taskPanel() {
    const box=element("div","contact-task-layout"),list=element("nav","contact-task-list"),detail=element("section","contact-task-detail"),state=Economy.snapshot();
    if(trader.id!=="efsf")return element("p","muted","暂无可用任务");
    for(const task of ContactTasks.tasks){
      const entry=state.contactTasks.find(e=>e.id===task.id),available=state.contactIntro&&(task.number===1||state.contactTasks.some(e=>e.id==="efsf-"+(task.number-1)&&e.status==="claimed"));
      const b=button(task.number+". "+task.name+(entry?" · "+({accepted:"进行中",ready:"可交付",claimed:"已完成"})[entry.status]:available?"":" · 未解锁"),()=>{selectedTask=task.id;renderTerminal();});
      b.dataset.taskId=task.id;b.setAttribute("aria-pressed",String(selectedTask===task.id));list.append(b);
    }
    const task=ContactTasks.byId.get(selectedTask)||ContactTasks.tasks[0],entry=state.contactTasks.find(e=>e.id===task.id),available=state.contactIntro&&(task.number===1||state.contactTasks.some(e=>e.id==="efsf-"+(task.number-1)&&e.status==="claimed"));
    detail.append(element("h3","",task.name),element("p","contact-task-description",task.description),element("h4","","任务目标"),element("p","",task.objective),element("strong","",(entry?.progress||0)+" / "+task.required),element("h4","","任务奖励"));
    const rewards=element("div","contact-task-rewards");ProductionUI.resources(rewards,{money:task.money},{compact:true});rewards.append(element("span","","好感度 +0.1"));
    for(const [id,count]of Object.entries(task.inventory)){const modelId=Economy.defaultModel(id),m=UnitModels[modelId],row=element("span","contact-unit-reward"),img=element("img");img.src=unitIcon(modelId);img.alt="";row.append(img,element("span","",m.name+" ×"+count));rewards.append(row);}
    if(task.licensePlan)rewards.append(element("p","","解锁先期量产型MS开发计划：直接获取对应单位许可"));
    if(task.facilityUnlock)rewards.append(element("p","","允许HQ、工厂、巨型工厂、士官学院升级到2级"));
    const action=button(entry?.status==="ready"?"交付任务":entry?.status==="claimed"?"已完成":entry?"进行中":"接受任务",()=>{
      if(Net.started)return;
      try{
        if(entry?.status==="ready")playDialogue(task.ending.split("\n").map(text=>["联邦联络人",text]),()=>{Economy.completeContactTask(task.id);note(task.licensePlan?"任务已交付，获得奖励及先期量产型MS计划对应单位许可":"任务已交付，奖励已发放；满仓单位保存在保管库。");},task.name);
        else {Economy.acceptContactTask(task.id);renderTerminal();note(task.grant?"任务已接取，苍白骑士已发放；机库满员时请到保管库接受。":"任务已接取");}
      }catch(error){note(Economy.errorMessage(error));}
    },"primary");action.id="contactTaskAction";action.disabled=Net.started||!available||!!entry&&entry.status!=="ready";
    detail.append(rewards,action);box.append(list,detail);return box;
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
      purchase.disabled = Net.started || !Economy.affordable(offer);
      card.append(
        UnitPreview.pluginCard(part),
        price,
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
  function renderTerminal() {
    if (!trader) return;
    const top = element("header", "contact-terminal-nav"),
      name = element("h2", "", trader.name),
      balance = element("div", "resource-balance"),
      body = element("div", "contact-terminal-body");
    name.id = "merchantTerminalName";
    ProductionUI.resources(balance, Economy.snapshot(), { compact: true });
    top.append(name, element("span", "", "好感度 "+(trader.id==="efsf"?Economy.liaisonAffinity().toFixed(1):"0")), element("span", "", "Lv1"), balance);
    if (view !== "home")
      top.append(
        button("返回", () => {
          dialogue=null;
          view = "home";
          renderTerminal();
        }),
      );
    top.append(button("关闭", () => terminal.close()));
    if(view==="dialogue"&&dialogue)renderDialogue(body);
    else if (view === "home") {
      const menu = element("div", "contact-terminal-menu");
      menu.append(
        button("任务", () => {
          view = "tasks";
          renderTerminal();
        }),
      );
      if (trader.sellsPlugins) menu.append(
        button("购买", () => {
          view = "shop";
          renderTerminal();
        }),
      );
      body.append(element("p", "contact-terminal-status", "通信链路已建立"), menu);
    } else if (view === "tasks") body.append(taskPanel());
    else body.append(shop());
    const scroll = terminal.querySelector(".contact-terminal-body")?.scrollTop || 0;
    terminal.replaceChildren(top, body);
    body.scrollTop = scroll;
  }
  function openMerchant(id) {
    trader = Economy.merchants.find((merchant) => merchant.id === id);
    if (!trader) return;
    view = "home";
    dialogue=null;
    query = "";
    renderTerminal();
    terminal.showModal();
    if(id==="efsf"&&!Economy.snapshot().contactIntro)playDialogue(ContactTasks.intro,()=>{Economy.meetLiaison();note("已获取反MS计划对应单位许可");},"初见联络人");
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
    open(view) {
      tasks.hidden = view !== "contactTasks";
      merchants.hidden = view !== "contactMerchants";
      renderTasks();
      setPageView(view);
    },
  };
})();

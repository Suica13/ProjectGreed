/* Catalog and formation share the exact portrait renderer and tag layout. */
const UnitPreview = (() => {
  // One percentage always means the same world scale. Start ordinary chassis
  // closer, then pull the whole category back if its inventory contains giants.
  const zoomLevels = { units: 1.5, ships: 1 };
  // Preview framing retains the original size independently of battle cells.
  const cellPixels = () => 160;
  const visibleBounds = new Map();
  const category = (model) =>
    typeof Warehouse !== "undefined" ? Warehouse.category(model) : model.ship ? "ships" : "units";
  const storageScale = (model) => category(model) === "ships" ? .25 : model.unitTags?.includes("MA") ? .5 : 1.15;
  function pluginCard(part) {
    const card=element("span","plugin-card"),image=element("img"),name=element("strong","",part.name),
      info=element("span","plugin-card-info"),visual=element("span","plugin-card-visual"),cost=element("span","plugin-cost",part.costPercent?"COST +10%":"COST +"+part.cost);
    image.src=ART.assets[ART.pluginIcons[part.id]];image.width=image.height=64;image.alt="";
    visual.append(image,cost);
    const merchants={anaheim:"阿纳海姆",efsf:"地球联邦军",zeon:"吉翁公国军"};
    const unlockTask=part.merchant==="anaheim" && typeof ContactTasks!=="undefined"
      ? ContactTasks.tasks.find(task=>task.contactId==="anaheim"&&task.pluginUnlocks?.includes(part.id)) : null;
    const unlockText=part.merchant==="anaheim" ? I18n.text("前提任务：")+I18n.text(unlockTask?.name || "委托解锁")
      : I18n.text("好感度等级")+" "+(part.merchantLevel||1);
    info.append(name,element("span","plugin-rarity","★".repeat(part.rarity)),element("span","plugin-effect",part.description),
      element("small","plugin-origin",[part.era?.replace(/^UC_00(\d+)_T/,"00$1T"),I18n.text(part.applicability || (part.nonShip?"非战舰":"所有")),I18n.text(part.category || ""),I18n.text(merchants[part.merchant]||""),unlockText].filter(Boolean).join(" · ")));
    card.append(visual,info);return card;
  }
  function roleIcon(model) {
    const roles={general:["泛用","✂\uFE0E"],support:["支援","✋\uFE0E"],raid:["突击","✊\uFE0E"],normal:["一般","●"]},
      key=Object.hasOwn(roles,model.combatRole)?model.combatRole:"normal",[name,glyph]=roles[key],
      icon=element("span","unit-role-icon role-"+key);
    icon.append(element("span","unit-role-symbol",glyph));
    icon.dataset.combatRole=key;icon.setAttribute("role","img");icon.setAttribute("aria-label",I18n.text(name));
    icon.title=I18n.text(name)+" · "+I18n.text("泛用克制支援，支援克制突击，突击克制泛用；受到自身克制的单位攻击时减伤10%、回避率+5个百分点；一般不参与克制");
    return icon;
  }
  function skillList(model, prefix, unit) {
    const root=element("div","unit-skill-list");
    function section(title,suffix){const block=element("section"),list=element("div","unit-detail-slots");
      block.id=prefix+"Detail"+suffix+"Block";list.id=prefix+"Detail"+suffix;
      block.append(element("h4","",title),list);root.append(block);return list;}
    const mechanics=section("技能与机制","Mechanics"),pending=section("未开放机制","Pending");
    function card(list,title,description){const node=element("div","formation-weapon-detail");node.append(element("strong","",title),element("p","muted",description));list.append(node);return node;}
    if(model.supplyAura)card(mechanics,"自动补给",`范围 ${model.supplyAura.range} · 每个己方回合范围内友军HP +5%、EN +10% · 不消耗EN，不消耗行动`);
    for(const skill of [...SkillControls.commandAbilities(model,unit),...SkillControls.defensiveAbilities(model),...(model.skills||[])]){
      const node=card(mechanics,I18n.language==="zh"?skill.name:I18n.localized(skill),SkillControls.description(skill));
      if(WeaponClasses.isWeaponSkill(skill))node.append(WeaponInfo.classBadge(skill),WeaponInfo.conversionRules(skill));
      if(skill.sourceWeapon)node.append(WeaponInfo.encyclopediaLink(skill),Encyclopedia.usersButton(skill));
    }
    for(const weapon of model.hiddenWeapons||[])card(pending,weapon.name+"（暂时隐藏）",weapon.reasons.map(reason=>({pilot_skill:"驾驶员条件待核对",source_missing:"原 MOD 缺少对应攻击流程",secondary_loadout:"可换装副武器：保留配置，暂不开放"})[reason]||reason).join(" · "));
    for(const mechanic of model.mechanics||[]){
      if(["CmdAtk","CmdDef","CmdCom"].includes(mechanic.id)&&model.commandAuras?.length)continue;
      card(["implemented","adapted"].includes(mechanic.status)?mechanics:pending,mechanic.name,({implemented:"已接入",adapted:"回合制改编",review:"原MOD机制：待接入",not_applicable:"本项目未接入对应科技／驾驶员系统"})[mechanic.status]||mechanic.status);
    }
    if(!mechanics.children.length)mechanics.append(element("p","muted","无"));
    pending.parentElement.hidden=!pending.children.length;
    return root;
  }
  function attributePages(model, prefix = "warehouse", unit = null, options = {}) {
    const baseline = typeof UnitPlugins !== "undefined" ? UnitPlugins.baseOf(model) : model;
    const changed = key => {
      const read = source => key.split(".").reduce((value, name) => value?.[name], source);
      return read(model) !== read(baseline);
    };
    const number=value=>typeof formatNumber==="function"?formatNumber(value):String(value??0);
    const reference=prefix==="formation",block=element("section",(reference?"unit-detail-block":"warehouse-detail-basic")+" unit-attribute-block"),
      tabs=element("nav","warehouse-attribute-tabs"),pages=element("div","unit-attribute-pages"),
      primary=element("div","unit-attribute-page"),secondary=element("div","unit-attribute-page"),skills=element("div","unit-attribute-page unit-skill-page");
    primary.id=prefix+"PrimaryAttributes";secondary.id=prefix+"SecondaryAttributes";skills.id=prefix+"SkillList";secondary.hidden=skills.hidden=true;
    const names={melee:"格斗",shooting:"射击",beam:"光束",shell:"实弹",dp:"DP",sp:"SP"},
      movements={ground:"地面移动",air:"空中移动",naval:"水上移动",amphibious:"两栖移动",hover:"气垫移动"};
    function group(title){const section=element("section");section.append(element("h4","",title));return section;}
    function metrics(id,rows){const list=element("dl","warehouse-detail-metrics unit-detail-metrics");list.id=id;
      for(const [label,value,key] of rows)list.append(element("dt","",label),element("dd",key&&changed(key)?"plugin-modified-value":"",String(value??"—")));return list;}
    const main=group("主要参数"),bonuses=group("伤害加成"),defense=group("防护与结构"),adaptation=group("适应性"),other=group("移动与生产");
    main.append(metrics(reference?"formationDetailStats":"warehouseMainStats",[
      ["COST",model.cost],["HP",number(model.hp),"hp"],["EN",number(model.en),"en"],
      ["移动",model.move,"move"],
      ["机动",model.speed??100,"speed"],["反应系数",model.mobility,"mobility"],["命中系数",model.accuracy+"%","accuracy"],
      ["视野距离",formatDistance(model.sensors?.sight),"sensors.sight"],["侦察距离",formatDistance(model.sensors?.radar),"sensors.radar"],
      ...(model.ship?[["战舰占地",model.footprint.width+"×"+model.footprint.height],["炮塔模块",model.modules.length]]:[])
    ]));
    bonuses.append(metrics(reference?"formationDetailBonuses":"warehouseAttackBonuses",Object.entries(model.attackBonuses||{}).map(([type,value])=>[names[type]||type.toUpperCase(),(value>=0?"+":"")+value+"%","attackBonuses."+type])));
    const table=element("table","warehouse-detail-defense unit-defense-table"),heading=element("tr"),tableHost=element("div");
    tableHost.id=reference?"formationDetailDefense":"warehouseDefenses";
    for(const label of ["防护","抗性","固定减伤"])heading.append(element("th","",label));table.append(heading);
    for(const [type,value] of Object.entries(model.defenses||{})){const row=element("tr");row.append(element("td","",names[type]||type.toUpperCase()),element("td",changed("defenses."+type+".percent")?"plugin-modified-value":"",value.percent+"%"),element("td",changed("defenses."+type+".flat")?"plugin-modified-value":"",number(value.flat)));table.append(row);}
    tableHost.append(table);defense.append(tableHost,metrics(reference?"formationDetailShield":"warehouseSecondaryStats",[
      ["零件强度",model.partStructuralStrength,"partStructuralStrength"],["护盾耐久",number(model.shield.hp),"shield.hp"],["格挡率",Math.round(model.shield.blockChance*100)+"%","shield.blockChance"],
      ...(reference?[["AP参考",model.actionPoints??5]]:[])
    ]));
    adaptation.append(metrics(reference?"formationDetailMovement":"warehouseAdaptability",[
      ["ground","地面"],["mountain","山地"],["space","宇宙"],["water","水中"],["atmosphere","大气层"],
      ["air","空中"],["forest","树林"],["snow","雪地"],["desert","沙漠"],["rubble","废墟"]
    ].map(([key,label])=>[label,(model.adaptability?.[key]??0)+"%","adaptability."+key])));
    other.append(metrics(prefix+"SecondaryParameters",[
      ["移动方式",I18n.text(movements[model.movementType||"ground"]||model.movementType)],
      ...(!model.formOnly&&typeof Economy!=="undefined"&&typeof Economy.productionTiming==="function"?[["生产周期",Economy.productionTiming(model.prefabId,model.kitId).turns+"回合／台"]]:[])
    ]));
    primary.append(main,defense,bonuses,other);secondary.append(adaptation);
    skills.append(skillList(model,prefix,unit));
    const entries=[["主要属性",primary],["次要属性",secondary],["技能列表",skills]];
    const weapons=reference?null:element("div","unit-attribute-page unit-weapon-page");
    if(weapons){weapons.id=prefix+"WeaponList";weapons.hidden=true;entries.push(["武装列表",weapons]);}
    const panels=entries.map(([,panel])=>panel);
    for(const [label,panel] of entries){
      const button=element("button","",label);button.type="button";button.setAttribute("aria-controls",panel.id);button.setAttribute("aria-pressed",String(!panel.hidden));
      button.onclick=()=>{
        if(panel===weapons&&!weapons.childElementCount){
          const list=element("div","unit-weapon-list");
          for(const weapon of model.weapons||[])list.append(WeaponInfo.card(weapon, null, {unit}));
          if(!list.childElementCount)list.append(element("p","muted","无"));
          weapons.append(list);
        }
        for(const page of panels)page.hidden=page!==panel;for(const tab of tabs.children)tab.setAttribute("aria-pressed",String(tab===button));
        options.onPageChange?.(panel.id);
      };tabs.append(button);
    }
    pages.append(...panels);block.append(element("h3","","基本属性"),tabs,pages);
    if(options.selectedPage) [...tabs.children].find(tab=>tab.getAttribute("aria-controls")===options.selectedPage)?.click();
    return block;
  }
  function refreshPreviews() {
    if (typeof document === "undefined") return;
    for (const canvas of document.querySelectorAll("canvas[data-preview-model]")) {
      if (!canvas.isConnected || canvas.closest("[hidden]")) continue;
      renderPreview(canvas.dataset.previewModel, canvas, Number(canvas.dataset.previewAngle), canvas.dataset.previewFraming || "map");
    }
    window.dispatchEvent(new Event("unit-preview-zoom-changed"));
  }
  function zoom(kind, value) {
    if (value !== undefined) {
      const next = Math.max(0.05, Math.min(4, value));
      if (Math.abs(zoomLevels[kind] - next) > 0.00001) {
        zoomLevels[kind] = next;
        refreshPreviews();
      }
    }
    return zoomLevels[kind];
  }
  async function fitModels(modelIds, width = 360, height = 320, onlyShrink = false, angle = 180, applyZoom = true) {
    const ids = [...new Set(modelIds)].filter((id) => UnitModels[id]);
    if (!ids.length) return;
    await SpriteRenderer.ensureModels(ids);
    const kind = category(UnitModels[ids[0]]),
      cells = 1;
    let halfWidth = 0,
      halfHeight = 0;
    for (const id of ids) {
      const model = UnitModels[id],
        idle = model.presentation?.idle;
      const key = id + ":" + angle,
        cached = visibleBounds.get(key);
      if (cached?.source === SpriteRenderer.models[id]) {
        halfWidth = Math.max(halfWidth, cached.x);
        halfHeight = Math.max(halfHeight, cached.y);
        continue;
      }
      let modelHalfWidth = 0,
        modelHalfHeight = 0;
      const pose = SpriteRenderer.sample(SpriteRenderer.models[id].animations[idle], 0);
      for (const layer of SpriteRenderer.visibleLayers(
        id,
        model.weapons[0]?.id,
        true,
        false,
        idle,
        0,
        false,
        {},
        false,
        true,
        "ground",
      )) {
        const image = SpriteRenderer.images[layer.asset];
        if (!image || layer.effect || layer.visibleWhen?.thrustActive) continue;
        const t = SpriteRenderer.layerTransform(id, layer, angle, pose),
          w = (layer.frameWidth || image.width / (layer.frames || 1)) / 2,
          h = (layer.frameHeight || image.height) / 2,
          scale = model.presentation?.mapScale ?? 1;
        for (const x of [-w, w])
          for (const y of [-h, h]) {
            modelHalfWidth = Math.max(
              modelHalfWidth,
              Math.abs(
                t.x + Math.cos(t.rotation) * x * t.scaleX - Math.sin(t.rotation) * y * t.scaleY,
              ) * scale,
            );
            modelHalfHeight = Math.max(
              modelHalfHeight,
              Math.abs(
                t.y + Math.sin(t.rotation) * x * t.scaleX + Math.cos(t.rotation) * y * t.scaleY,
              ) * scale,
            );
          }
      }
      if (typeof document !== "undefined" && modelHalfWidth && modelHalfHeight) {
        // Frame images can contain large transparent margins. Measure the
        // actual composed idle sprite once, only for fitting the shared camera.
        // Drawing scale remains the native map scale for every model.
        const raster = document.createElement("canvas");
        const sampleScale = Math.min(1, 1024 / (Math.max(modelHalfWidth, modelHalfHeight) * 2 + 8));
        raster.width = Math.ceil(modelHalfWidth * 2 * sampleScale) + 8;
        raster.height = Math.ceil(modelHalfHeight * 2 * sampleScale) + 8;
        const ctx = raster.getContext("2d", { willReadFrequently: true });
        SpriteRenderer.draw(
          ctx,
          id,
          raster.width / 2,
          raster.height / 2,
          (model.presentation?.mapScale ?? 1) * sampleScale,
          angle,
          idle,
          0,
          model.weapons[0]?.id,
          false,
          true,
          false,
          {},
          angle,
          false,
          true,
          "ground",
        );
        const pixels = ctx.getImageData(0, 0, raster.width, raster.height).data;
        let xExtent = 0,
          yExtent = 0;
        for (let y = 0; y < raster.height; y++)
          for (let x = 0; x < raster.width; x++) {
            if (pixels[(y * raster.width + x) * 4 + 3] < 4) continue;
            xExtent = Math.max(xExtent, Math.abs(x + 0.5 - raster.width / 2) + 0.5);
            yExtent = Math.max(yExtent, Math.abs(y + 0.5 - raster.height / 2) + 0.5);
          }
        if (xExtent && yExtent) {
          modelHalfWidth = xExtent / sampleScale;
          modelHalfHeight = yExtent / sampleScale;
        }
      }
      if (visibleBounds.size >= 128) visibleBounds.delete(visibleBounds.keys().next().value);
      visibleBounds.set(key, {
        source: SpriteRenderer.models[id],
        x: modelHalfWidth,
        y: modelHalfHeight,
      });
      halfWidth = Math.max(halfWidth, modelHalfWidth);
      halfHeight = Math.max(halfHeight, modelHalfHeight);
    }
    // This changes one camera for the whole category, never an individual model.
    const base =
      ((Math.min(width, height) - 48) / (cellPixels() * cells)) * ART.presentation.unitMapScale;
    const target =
      Math.min(
        (width - 40) / Math.max(1, halfWidth * 2),
        (height - 40) / Math.max(1, halfHeight * 2),
      ) / base;
    if (applyZoom) zoom(kind, onlyShrink ? Math.min(zoom(kind), target) : target);
    return Math.max(0.05, Math.min(4, target));
  }
  function controls(canvas) {
    if (!canvas.isConnected || canvas.classList.contains("warehouse-sprite") || canvas.dataset.previewFraming === "card") return;
    let host = canvas.closest(".unit-preview-camera");
    if (!host) {
      host = element("div", "unit-preview-camera");
      canvas.replaceWith(host);
      host.append(canvas);
      const toolbar = element("div", "unit-preview-camera-controls");
      for (const [label, action] of [
        ["−", -1],
        ["", 0],
        ["+", 1],
        ["全貌", 2],
      ]) {
        const button = element("button", "", label);
        button.type = "button";
        if (!action) {
          button.disabled = true;
          button.className = "unit-preview-zoom-label";
        } else
          button.onclick = () => {
            const kind = category(UnitModels[canvas.dataset.previewModel]);
            if (action === 2)
              fitModels(
                [canvas.dataset.previewModel],
                canvas.width,
                canvas.height,
                false,
                Number(canvas.dataset.previewAngle),
              ).catch((error) => note(error.message));
            else zoom(kind, zoom(kind) * (action > 0 ? 1.25 : 0.8));
          };
        toolbar.append(button);
      }
      host.append(toolbar);
    }
    host.querySelector(".unit-preview-zoom-label").textContent =
      Math.round(zoom(category(UnitModels[canvas.dataset.previewModel])) * 100) + "%";
  }
  function renderPreview(
    modelId,
    canvas = byId("formationDetailPreview"),
    previewAngle = 180,
    framing = "map",
  ) {
    const ctx = canvas.getContext("2d"),
      model = UnitModels[modelId];
    const required = [modelId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.setAttribute("aria-label", model.name);
    if (!assetsReady) return;
    canvas.dataset.previewModel = modelId;
    canvas.dataset.previewAngle = String(previewAngle);
    canvas.dataset.previewFraming = framing;
    if (!SpriteRenderer.modelsReady(required)) {
      SpriteRenderer.ensureModels(required)
        .then(() => {
          if (
            canvas.dataset.previewModel === modelId &&
            canvas.dataset.previewAngle === String(previewAngle) &&
            canvas.dataset.previewFraming === framing
          )
            renderPreview(modelId, canvas, previewAngle, framing);
        })
        .catch((error) => note(error.message));
      return;
    }
    if (typeof document !== "undefined" && !canvas.classList.contains("warehouse-sprite") && framing !== "card") {
      const frameKey = [modelId, previewAngle, canvas.width, canvas.height].join(":");
      if (canvas.dataset.previewFitKey !== frameKey) {
        canvas.dataset.previewFitKey = frameKey;
        fitModels([modelId], canvas.width, canvas.height, true, previewAngle).catch((error) =>
          note(error.message),
        );
      }
    }
    const held = model.weapons[0]?.id;
    {
      // Each scene is a fixed-size view of map cells, rather than a camera
      // fitted to a particular model's image. All chassis, ships and weapon
      // kits retain their map ratios at the same displayed camera percentage.
      const cells = 1;
      const scale =
        ((Math.min(canvas.width, canvas.height) - 48) / (cellPixels() * cells)) *
        ART.presentation.unitMapScale *
        (model.presentation?.mapScale ?? 1) *
        (framing === "card" ? Number(canvas.dataset.cardZoom || 1) : zoom(category(model)));
      canvas.dataset.previewScale = String(scale);
      canvas.dataset.previewCells = String(cells);
      if (typeof document !== "undefined") queueMicrotask(() => controls(canvas));
      SpriteRenderer.draw(
        ctx,
        modelId,
        canvas.width / 2,
        canvas.height / 2,
        scale,
        previewAngle,
        model.presentation?.idle,
        0,
        held,
        false,
        true,
        false,
        canvas.previewParts || {},
        previewAngle,
        false,
        true,
        "ground",
        null,
        null,
        false,
        null,
        false,
        false,
        [],
        0,
        true,
        canvas.dataset.previewParked === "true",
      );
      return;
    }
  }
  function environmentLabel(environment, value) {
    const label = I18n.text(environment === "ground" ? "地面" : "宇宙");
    return value === 100 ? label : label + " " + value + "%";
  }

  function unitSummaryTags(adaptability, kitName, cost) {
    const tags = element("span", "unit-summary-tags");
    for (const environment of ["ground", "space"]) {
      const value = UnitCatalog.environmentValue(adaptability, environment);
      tags.append(
        element(
          "span",
          "unit-summary-tag " + environment + (value < 90 ? " is-dim" : ""),
          environmentLabel(environment, value),
        ),
      );
    }
    tags.append(element("span", "unit-summary-tag cost", cost + "C"));
    if (kitName) tags.append(element("span", "unit-summary-tag kit", kitName));
    return tags;
  }

  // One ordered collection serves every list and its complete-tag panel.
  function tagDefinitions(model, kitName) {
    const result = [];
    const factionIds = new Set(["PMC", ...Rules.factions]);
    const factions = [
      ...new Set([
        model.faction,
        ...(model.availableFactions || []),
        ...(model.tags || []).filter((tag) => factionIds.has(tag)),
      ]),
    ].filter(Boolean);
    for (const faction of factions)
      result.push({
        label: ["OMNI", "ZAFT"].includes(faction)
          ? Rules.factionInfo?.[faction]?.name || faction
          : faction,
        value: faction,
        className: "faction-tag",
        faction,
      });
    const otherTags = [...new Set((model.tags || []).filter((tag) => !factionIds.has(tag)))];
    for (const tag of otherTags.filter((tag) => Rules.eras.includes(tag)))
      result.push({ label: tag, value: tag, className: "era-tag" });
    const adaptability = model.adaptability || model.stats?.adaptability;
    for (const environment of ["ground", "space"]) {
      const value = UnitCatalog.environmentValue(adaptability, environment);
      result.push({
        label: environmentLabel(environment, value),
        value: environment,
        className: "unit-summary-tag " + environment + (value < 90 ? " is-dim" : ""),
      });
    }
    const size = Rules.unitSize(model);
    result.push({
      label: I18n.text({ small: "小型", medium: "中型", large: "大型" }[size]),
      value: size + "Unit",
      className: "type-tag unit-size-tag",
    });
    for (const tag of [...new Set(model.unitTags || [])]) {
      if (["SmallUnit", "LargeUnit", "MediumUnit"].includes(tag)) continue;
      result.push({ label: I18n.text(Rules.unitTagName(tag)), value: tag, className: "type-tag" });
    }
    for (const tag of otherTags.filter((tag) => !Rules.eras.includes(tag)))
      result.push({ label: I18n.text(tag), value: tag, className: "type-tag" });
    if (kitName) result.push({ label: kitName, value: "kit", className: "unit-summary-tag kit" });
    return result;
  }

  function tagElement(definition) {
    const tag = element("span", definition.className, definition.label);
    tag.dataset.tag = definition.value;
    if (definition.faction) {
      tag.dataset.faction = definition.faction;
      const color = Rules.factionInfo?.[definition.faction]?.color;
      if (color) {
        tag.style.color = color;
        tag.style.borderColor = color;
      }
    }
    return tag;
  }

  let tagsDialog = null;
  function openTags(model, definitions, trigger) {
    if (!tagsDialog) {
      tagsDialog = element("dialog", "unit-tags-dialog");
      tagsDialog.id = "unitTagsDialog";
      document.body.append(tagsDialog);
      tagsDialog.addEventListener("click", (event) => {
        const bounds = tagsDialog.getBoundingClientRect();
        if (
          event.target === tagsDialog &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom)
        )
          tagsDialog.close();
      });
    }
    const header = element("header", "unit-tags-dialog-heading");
    const title = element("h3", "", I18n.text("全部标签"));
    title.id = "unitTagsDialogTitle";
    tagsDialog.setAttribute("aria-labelledby", title.id);
    const close = element("button", "", I18n.text("关闭"));
    close.type = "button";
    close.onclick = () => tagsDialog.close();
    header.append(title, close);
    const name = element("p", "", [model.code, model.name].filter(Boolean).join(" "));
    const content = element("div", "unit-tags unit-tags-complete");
    content.append(...definitions.map(tagElement));
    tagsDialog.replaceChildren(header, name, content);
    tagsDialog.onclose = () => {
      if (trigger.isConnected) trigger.focus();
    };
    if (!tagsDialog.open) tagsDialog.showModal();
  }

  function unitTags(
    model,
    {
      cost,
      kitName,
      twoRows = false,
      limit = matchMedia("(max-width:720px)").matches ? 4 : 8,
    } = {},
  ) {
    const tags = element("span", "unit-tags");
    const primary = element("span", "unit-tags-primary");
    const types = element("span", "unit-tags-types");
    const definitions = tagDefinitions(model, kitName);
    if (twoRows) {
      tags.classList.add("unit-tags-two-rows");
      const identity = definitions.filter(
        (d) => d.value === "kit" || d.faction || d.className === "era-tag",
      );
      identity.sort((a, b) => Number(b.value === "kit") - Number(a.value === "kit"));
      const traits = definitions.filter((d) => !identity.includes(d));
      if (cost !== undefined)
        identity.unshift({
          label: cost + "C",
          value: "cost",
          className: "unit-summary-tag cost",
        });
      for (const [group, items] of [
        [primary, identity],
        [types, traits],
      ]) {
        group.append(...items.slice(0, 5).map(tagElement));
        if (items.length > 5) {
          const more = element("button", "unit-tags-more", "...");
          more.type = "button";
          more.title = I18n.text("查看全部标签");
          more.setAttribute("aria-label", more.title);
          more.setAttribute("aria-haspopup", "dialog");
          more.addEventListener("keydown", (event) => event.stopPropagation());
          more.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            openTags(model, items, more);
          };
          group.append(more);
        }
      }
      tags.append(primary, types);
      return tags;
    }
    for (const definition of definitions.slice(0, limit)) {
      const group =
        definition.className.startsWith("type-tag") || definition.value === "kit" ? types : primary;
      group.append(tagElement(definition));
    }
    tags.append(primary);
    if (types.children.length) tags.append(types);
    if (definitions.length > limit) {
      const more = element("button", "unit-tags-more", "...");
      more.type = "button";
      more.title = I18n.text("查看全部标签");
      more.setAttribute("aria-label", more.title);
      more.setAttribute("aria-haspopup", "dialog");
      more.addEventListener("keydown", (event) => event.stopPropagation());
      more.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTags(model, definitions, more);
      };
      tags.append(more);
    }
    // COST stays visible independently and never consumes a tag slot.
    if (cost !== undefined) tags.prepend(element("span", "unit-summary-tag cost", cost + "C"));
    return tags;
  }
  function identityTags(model, cost) {
    const tags = element("span", "unit-tags warehouse-card-tags"),
      definitions = tagDefinitions(model).filter((tag) => tag.faction || tag.className === "era-tag"),
      primaryFaction = definitions.find((tag) => tag.faction),
      primaryEra = definitions.find((tag) => tag.className === "era-tag");
    if (cost !== undefined) tags.append(element("span", "unit-summary-tag cost", cost + "C"));
    for (const tag of [primaryEra, primaryFaction].filter(Boolean)) tags.append(tagElement(tag));
    const extra = definitions.filter((tag) => tag !== primaryFaction && tag !== primaryEra);
    if (extra.length) {
      const more = element("button", "unit-tags-more", "...");
      more.type = "button";
      more.title = I18n.text("查看全部标签");
      more.setAttribute("aria-label", more.title);
      more.setAttribute("aria-haspopup", "dialog");
      more.onclick = (event) => { event.stopPropagation(); openTags(model, definitions, more); };
      tags.append(more);
    }
    return tags;
  }
  return { renderPreview, unitSummaryTags, unitTags, identityTags, zoom, fitModels, storageScale, roleIcon, attributePages, pluginCard };
})();

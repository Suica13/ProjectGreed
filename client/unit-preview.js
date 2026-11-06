/* Catalog and formation share the exact portrait renderer and tag layout. */
const UnitPreview = (() => {
  function renderPreview(modelId, canvas = byId("formationDetailPreview")) {
    const ctx = canvas.getContext("2d"),
      model = UnitModels[modelId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.setAttribute("aria-label", model.name);
    if (!assetsReady) return;
    canvas.dataset.previewModel = modelId;
    if (!SpriteRenderer.modelsReady([modelId])) {
      SpriteRenderer.ensureModels([modelId])
        .then(() => {
          if (canvas.dataset.previewModel === modelId) renderPreview(modelId, canvas);
        })
        .catch((error) => note(error.message));
      return;
    }
    const previewAngle = 90;
    const held = model.weapons[0]?.id,
      points = [];
    for (const layer of SpriteRenderer.visibleLayers(
      modelId,
      held,
      true,
      false,
      null,
      0,
      false,
      {},
      false,
      true,
      "ground",
    )) {
      const image = SpriteRenderer.images[layer.asset];
      if (!image) continue;
      const t = SpriteRenderer.layerTransform(modelId, layer, previewAngle, {}),
        w = (layer.frameWidth || Math.floor(image.width / (layer.frames || 1))) / 2,
        h = (layer.frameHeight || image.height) / 2;
      for (const x of [-w, w])
        for (const y of [-h, h])
          points.push({
            x: t.x + Math.cos(t.rotation) * x * t.scaleX - Math.sin(t.rotation) * y * t.scaleY,
            y: t.y + Math.sin(t.rotation) * x * t.scaleX + Math.cos(t.rotation) * y * t.scaleY,
          });
    }
    if (!points.length) return;
    const left = Math.min(...points.map((p) => p.x)),
      right = Math.max(...points.map((p) => p.x)),
      top = Math.min(...points.map((p) => p.y)),
      bottom = Math.max(...points.map((p) => p.y)),
      scale =
        Math.min(
          (canvas.width - 48) / Math.max(1, right - left),
          (canvas.height - 48) / Math.max(1, bottom - top),
        ) * (UnitModels[modelId].presentation?.previewScale ?? 1);
    SpriteRenderer.draw(
      ctx,
      modelId,
      canvas.width / 2 - ((left + right) / 2) * scale,
      canvas.height / 2 - ((top + bottom) / 2) * scale,
      scale,
      previewAngle,
      null,
      0,
      held,
      false,
      true,
      false,
      {},
      previewAngle,
      false,
      true,
      "ground",
    );
  }
  function environmentLabel(environment, value) {
    const label = I18n.text(environment === "ground" ? "地面" : "宇宙");
    return value === 100 ? label : label + " " + value + "%";
  }

  function unitSummaryTags(adaptability, kitName, cost) {
    const tags = element("span", "unit-summary-tags");
    for (const environment of ["ground", "space"]) {
      const value = adaptability?.[environment] ?? 0;
      tags.append(
        element(
          "span",
          "unit-summary-tag " + environment + (value < 90 ? " is-dim" : ""),
          environmentLabel(environment, value),
        ),
      );
    }
    tags.append(element("span", "unit-summary-tag cost", "COST " + cost));
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
      result.push({ label: faction, value: faction, className: "faction-tag", faction });
    const otherTags = [...new Set((model.tags || []).filter((tag) => !factionIds.has(tag)))];
    for (const tag of otherTags.filter((tag) => /^\d{4}(?:T[12])?$/.test(tag)))
      result.push({ label: tag, value: tag, className: "era-tag" });
    const adaptability = model.adaptability || model.stats?.adaptability;
    for (const environment of ["ground", "space"]) {
      const value = adaptability?.[environment] ?? 0;
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
    for (const tag of otherTags.filter((tag) => !/^\d{4}(?:T[12])?$/.test(tag)))
      result.push({ label: I18n.text(tag), value: tag, className: "type-tag" });
    if (kitName) result.push({ label: kitName, value: "kit", className: "unit-summary-tag kit" });
    return result;
  }

  function tagElement(definition) {
    const tag = element("span", definition.className, definition.label);
    tag.dataset.tag = definition.value;
    if (definition.faction) tag.dataset.faction = definition.faction;
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

  function unitTags(model, { cost, kitName, limit = matchMedia("(max-width:720px)").matches ? 4 : 8 } = {}) {
    const tags = element("span", "unit-tags");
    const primary = element("span", "unit-tags-primary");
    const types = element("span", "unit-tags-types");
    const definitions = tagDefinitions(model, kitName);
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
    if (cost !== undefined) tags.prepend(element("span", "unit-summary-tag cost", "COST " + cost));
    return tags;
  }
  return { renderPreview, unitSummaryTags, unitTags };
})();

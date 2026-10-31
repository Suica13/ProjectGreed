/* Catalog and formation share the exact portrait renderer and tag layout. */
const UnitPreview = (() => {
  function renderPreview(modelId, canvas = byId("formationDetailPreview")) {
    const ctx = canvas.getContext("2d"),
      model = UnitModels[modelId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.setAttribute("aria-label", model.code + " " + model.name);
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
  function unitSummaryTags(adaptability, kitName, cost) {
    const tags = element("span", "unit-summary-tags");
    const add = (label, kind, dim = false) =>
      tags.append(element("span", "unit-summary-tag " + kind + (dim ? " is-dim" : ""), label));
    const ground = adaptability?.ground ?? 0,
      space = adaptability?.space ?? 0;
    add(I18n.text("\u5730\u9762") + " " + ground + "%", "ground", ground < 90);
    add(I18n.text("\u5b87\u5b99") + " " + space + "%", "space", space < 90);
    add("COST " + cost, "cost");
    if (kitName) add(kitName, "kit");
    return tags;
  }

  function unitTags(model) {
    const tags = element("span", "unit-tags"),
      primary = element("span", "unit-tags-primary"),
      types = element("span", "unit-tags-types");
    for (const value of model.tags) {
      const tag = element("span", value === model.faction ? "faction-tag" : "era-tag", value);
      tag.dataset.tag = value;
      if (value === model.faction) tag.dataset.faction = value;
      primary.append(tag);
    }
    const size = Rules.unitSize(model);
    const sizeTag = element(
      "span",
      "type-tag unit-size-tag",
      { small: "小型", medium: "中型", large: "大型" }[size],
    );
    sizeTag.dataset.tag = size + "Unit";
    types.append(sizeTag);
    for (const value of model.unitTags || []) {
      if (value === "SmallUnit" || value === "LargeUnit" || value === "MediumUnit") continue;
      const tag = element("span", "type-tag", I18n.text(Rules.unitTagName(value)));
      tag.dataset.tag = value;
      types.append(tag);
    }
    tags.append(primary);
    if (types.children.length) tags.append(types);
    return tags;
  }
  return { renderPreview, unitSummaryTags, unitTags };
})();

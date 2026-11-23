/* Supply presentation consumes an already committed reward batch. It never rolls or grants rewards. */
window.SupplyDelivery = (() => {
  function sprite(modelId, { angle = 210, shooting = false, flying = false, pixelRatio = 1 } = {}) {
    const canvas = element("canvas", "supply-unit-preview");
    canvas.width = 480 * pixelRatio;
    canvas.height = 360 * pixelRatio;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", UnitModels[modelId].name);
    canvas.dataset.previewModel = modelId;
    canvas.dataset.previewAngle = String(angle);
    canvas.dataset.shooting = String(shooting);
    canvas.spriteReady = SpriteRenderer.ensureModels([modelId]).then(() => {
      const model = UnitModels[modelId], weapon = model.weapons[0];
      const clip = shooting ? weapon.clip : model.presentation.idle;
      const time = shooting ? Math.max(0, (weapon.attack?.shots?.[0] || .3) - .01) : .2;
      canvas.dataset.previewClip = clip;
      const raster = document.createElement("canvas");
      raster.width = raster.height = Math.ceil(Math.min(2048, Math.max(256, SpriteRenderer.radius(modelId) * 2 + 48)));
      const ctx = raster.getContext("2d", { willReadFrequently: true });
      const drawPose = (context, x, y, scale) => SpriteRenderer.draw(context, modelId, x, y, scale, angle, clip, time,
          weapon?.id, false, true, flying, {}, angle, shooting, false, "ground",
          shooting ? weapon : null, shooting ? weapon.attack?.steps?.find(step => step.weaponDisplayIndex !== undefined)?.weaponDisplayIndex : null,
          flying, null, false, false, [], 0, true, !flying);
      drawPose(ctx, raster.width / 2, raster.height / 2, 1);
      // Fit the actual visible pose, including its held weapon, without changing global camera zoom.
      const pixels = ctx.getImageData(0, 0, raster.width, raster.height).data;
      let left = raster.width, right = 0, top = raster.height, bottom = 0;
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
        if (pixels[(y * raster.width + x) * 4 + 3] < 4) continue;
        left = Math.min(left, x); right = Math.max(right, x + 1);
        top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      }
      if (right > left && bottom > top) {
        const width = right - left, height = bottom - top;
        const scale = Math.min(canvas.width * .9 / width, canvas.height * .9 / height);
        const output = canvas.getContext("2d");
        output.imageSmoothingEnabled = false;
        // Render source layers directly at final resolution; never enlarge the measuring raster.
        drawPose(output, canvas.width / 2 - ((left + right) / 2 - raster.width / 2) * scale,
          canvas.height / 2 - ((top + bottom) / 2 - raster.height / 2) * scale, scale);
      }
      canvas.dataset.spriteReady = "true";
    }).catch(error => note(error.message));
    return canvas;
  }
  function open(results, rewardCard, { revealOnly = false } = {}) {
    return new Promise(resolve => {
      const dialog = element("dialog", "supply-delivery"), heading = element("header"),
        title = element("h2", "", "补给运输中"), stage = element("div", "supply-delivery-stage"),
        status = element("p", "supply-delivery-status", "运输机正在接近投放区域…"),
        crate = element("button", "supply-crate"), ground = element("div", "supply-drop-zone"),
        aircraft = element("div", "supply-aircraft"), rewardPanel = element("section", "supply-reward-panel");
      const timers = new Set();
      let active = true, phase = "loading";
      const later = (callback, delay) => {
        const timer = setTimeout(() => { timers.delete(timer); if (active) callback(); }, delay);
        timers.add(timer);
      };
      const sound = async key => {
        const stamp = phase, cue = ART.presentation[key];
        try {
          await WeaponAudio.unlock();
          await WeaponAudio.prepare([cue]);
          if (active && phase === stamp && !document.hidden) WeaponAudio.play(cue, undefined, 1, "supply");
        } catch { /* Audio availability never blocks opening an already awarded supply. */ }
      };
      const setPhase = value => { phase = value; dialog.dataset.phase = value; };
      const close = element("button", "", "关闭演出");
      close.type = "button";
      close.onclick = () => dialog.close();
      dialog.setAttribute("aria-labelledby", "supplyDeliveryTitle");
      title.id = "supplyDeliveryTitle";
      status.setAttribute("aria-live", "polite");
      heading.append(title, close);
      const transport = Math.random() < .5 ? "Medea" : "FatUncle";
      const image = sprite(Economy.defaultModel(transport), { angle: 90, flying: true });
      aircraft.dataset.transport = transport;
      aircraft.append(image, element("span", "", UnitModels[Economy.defaultModel(transport)].name));
      ground.append(element("span", "", "SUPPLY DROP ZONE"));
      crate.type = "button";
      crate.disabled = true;
      crate.id = "supplyOpenCrate";
      crate.setAttribute("aria-label", "打开补给箱");
      crate.dataset.buttonSound = "off";
      crate.append(element("span", "supply-parachute"), element("span", "supply-crate-lid"),
        element("span", "supply-crate-mark", "◈"), element("span", "supply-crate-label", "SUPPLY"));
      const flash = element("div", "supply-open-flash");
      flash.setAttribute("aria-hidden", "true");
      stage.append(ground, aircraft, crate, flash);
      rewardPanel.hidden = true;
      rewardPanel.setAttribute("aria-label", "本次补给奖励");
      const cards = element("div", "supply-result-cards");
      cards.append(...results.map(rewardCard));
      const done = element("button", "primary", "收下补给");
      done.type = "button";
      done.onclick = () => dialog.close();
      rewardPanel.append(element("p", "", `已获得 ${results.length} 项奖励`), cards,
        element("p", "muted", "抽取的单位已送至保管库，请前往领取；零件与资源已存入仓库。"), done);
      const reveal = () => {
        setPhase("rewards");
        title.textContent = I18n.text("补给抵达");
        stage.hidden = status.hidden = true;
        rewardPanel.hidden = false;
        close.textContent = I18n.text("关闭");
        if (!revealOnly) sound("researchSound");
        done.focus({ preventScroll: true });
        dialog.scrollTop = 0;
      };
      crate.onclick = () => {
        if (phase !== "landed") return;
        crate.disabled = true;
        setPhase("opening");
        status.textContent = I18n.text("正在开启补给箱…");
        sound("changeEquipmentSound");
        later(reveal, 650);
      };
      const cleanup = () => {
        active = false;
        WeaponAudio.stopChannel?.("supply");
        for (const timer of timers) clearTimeout(timer);
        window.removeEventListener("page-changing", dismiss);
        window.removeEventListener("pagehide", dismiss);
        dialog.remove();
        resolve();
      };
      const dismiss = () => dialog.close();
      dialog.addEventListener("close", cleanup, { once: true });
      window.addEventListener("page-changing", dismiss);
      window.addEventListener("pagehide", dismiss);
      for (const type of ["keydown", "keyup"]) dialog.addEventListener(type, event => event.stopPropagation());
      dialog.append(heading, stage, status, rewardPanel);
      setPhase("loading");
      document.body.append(dialog);
      dialog.showModal();
      if (revealOnly) { reveal(); return; }
      image.spriteReady.then(() => {
        if (!active) return;
        setPhase("flying");
        dialog.classList.add("is-delivering");
        sound("moveSound");
        const dropAt = window.matchMedia("(max-width:720px)").matches ? 1320 : 1480;
        later(() => {
          setPhase("dropping");
          status.textContent = I18n.text("补给箱已投放，正在降落…");
        }, dropAt);
        later(() => {
          setPhase("landed");
          title.textContent = I18n.text("补给箱已抵达");
          status.textContent = I18n.text("点击补给箱打开本次全部奖励");
          crate.disabled = false;
          sound("deploymentSound");
          crate.focus();
        }, dropAt + 1400);
      });
    });
  }
  return { sprite, open };
})();

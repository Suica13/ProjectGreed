/* Explicit creation flow. Faction chooses equipment only, never the PMC identity. */
const ProfileOnboarding = (() => {
  const dialog = document.createElement("dialog");
  dialog.id = "profileOnboarding";
  dialog.setAttribute("aria-labelledby", "profileOnboardingTitle");
  dialog.innerHTML = `<form>
    <header><small>PMC / COMPANY REGISTRATION</small><h2 id="profileOnboardingTitle">创建PMC公司</h2></header>
    <label class="setup-name">PMC公司名称<input id="profileCompanyName" autocomplete="organization" placeholder="请输入PMC公司名称" required></label>
    <fieldset><legend>初始势力</legend><small>仅影响初始单位</small><div class="setup-factions"></div></fieldset>
    <p class="setup-resources">初始资源：8000资金 · 8000物资</p>
    <p id="profileOnboardingError" role="alert"></p>
    <footer><button id="profileOnboardingCancel" type="button">取消</button><button id="profileOnboardingConfirm" type="submit">创建PMC公司</button></footer>
  </form>`;
  const style = document.createElement("style");
  style.textContent = `#profileOnboarding{position:fixed;inset:0;margin:auto;width:min(760px,calc(100vw - 28px));max-height:90dvh;padding:24px;background:#102b3e;color:#ddecf5;border:1px solid #5696b5;border-radius:7px;box-sizing:border-box;z-index:6000}#profileOnboarding::backdrop{background:#030c18cf}#profileOnboarding header{display:block;padding:0;text-align:left}#profileOnboarding h2{margin:4px 0 22px;color:#92d9f3}#profileOnboarding header small{font-size:11px;letter-spacing:.13em;color:#7faec3}#profileOnboarding .setup-name{display:grid;gap:8px}#profileCompanyName{width:100%;box-sizing:border-box;padding:10px;background:#0a1d2b;border:1px solid #47728b;color:#edf8ff}#profileOnboarding fieldset{margin:20px 0 0;padding:0;border:0}#profileOnboarding legend{font-size:16px}#profileOnboarding fieldset>small{display:block;color:#9cb8ca;margin:2px 0 12px}.setup-factions{display:grid;grid-template-columns:1fr 1fr;gap:14px}.setup-faction{display:block;border:1px solid #3a627b;background:#102434;padding:15px;cursor:pointer;border-radius:5px}.setup-faction:has(input:checked){border-color:#6fd9f5;background:#1d4861;box-shadow:inset 0 0 0 1px #70d5ee}.setup-faction input{width:auto!important;min-width:0!important;margin-right:8px}.setup-faction strong{color:#d3f0fc}.setup-faction ul{padding-left:20px;margin:12px 0 0;color:#aac6d8;font-size:14px;line-height:1.8}.setup-resources{font-size:13px;color:#d8c98f;margin:18px 0 0}#profileOnboardingError{color:#ffadb7;min-height:1.5em;font-size:13px;margin:10px 0}#profileOnboarding footer{display:flex;gap:12px;justify-content:flex-end}#profileOnboarding footer button{padding:10px 20px}#profileOnboardingConfirm{background:#24668b;border:1px solid #7bd8f1} @media(max-width:600px){#profileOnboarding{padding:18px}.setup-factions{grid-template-columns:1fr}.setup-faction{padding:12px}.setup-faction ul{margin-top:7px}.setup-faction ul li{display:inline;margin-right:12px}}`;
  document.head.append(style);
  document.body.append(dialog);
  let pending = null, mandatory = false;
  const nameInput = dialog.querySelector("input"),
    error = dialog.querySelector("[role=alert]");
  function choose({ initial = false } = {}) {
    if (pending) return Promise.reject(Error("公司创建面板已打开"));
    mandatory = initial;
    nameInput.value = initial ? "" : PlayerProfile.name();
    error.textContent = "";
    dialog.querySelector(".setup-factions").replaceChildren();
    for (const [id, faction] of Object.entries(Economy.startingFactions())) {
      const label = document.createElement("label"),
        radio = document.createElement("input"),
        title = document.createElement("strong"),
        list = document.createElement("ul");
      label.className = "setup-faction";
      radio.type = "radio";
      radio.name = "startingFaction";
      radio.value = id;
      radio.checked = id === "EFSF";
      title.textContent = I18n.text(faction.name);
      for (const [unitId, count] of Object.entries(faction.inventory)) {
        const item = document.createElement("li"),
          prefab = Rules.catalog.prefabs.find((p) => p.id === unitId);
        item.textContent = (prefab ? I18n.localized(prefab, "name") : unitId) + " ×" + count;
        list.append(item);
      }
      label.append(radio, title, list);
      dialog.querySelector(".setup-factions").append(label);
    }
    dialog.querySelector("#profileOnboardingCancel").hidden = initial;
    dialog.querySelector("#profileOnboardingCancel").textContent = I18n.text("取消");
    dialog.showModal();
    nameInput.focus();
    return new Promise((resolve) => (pending = resolve));
  }
  function finish(value) {
    if (mandatory && value === null) return;
    const resolve = pending;
    pending = null;
    dialog.close();
    resolve?.(value);
  }
  dialog.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    const name = nameInput.value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
    if (!name || Array.from(name).length > 24) {
      error.textContent = I18n.text("请填写1至24个字的PMC公司名称");
      return;
    }
    finish({
      companyName: name,
      faction: dialog.querySelector("input[name=startingFaction]:checked").value,
    });
  };
  dialog.querySelector("#profileOnboardingCancel").onclick = () => finish(null);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!mandatory) finish(null);
  });
  return { choose };
})();

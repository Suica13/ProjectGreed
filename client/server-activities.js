/* Server-owned mail and receipts; rewards are credited before acknowledging delivery. */
const ServerActivities = (() => {
  let socket = null,
    serverId = null,
    mail = [],
    activities = [],
    selected = null;
  let supportsDeletion = false, dismissed = new Set();
  const pending = new Set(),
    deleting = new Set();
  const dialog = element("dialog", "server-activities-dialog");
  dialog.id = "serverActivitiesDialog";
  dialog.setAttribute("aria-labelledby", "serverActivitiesTitle");
  const heading = element("header", "server-activities-heading"),
    title = element("h2", "", "服务器活动"),
    close = element("button", "", "关闭");
  title.id = "serverActivitiesTitle";
  close.type = "button";
  close.onclick = () => dialog.close();
  heading.append(title, close);
  const layout = element("div", "server-activities-layout"),
    list = element("nav", "server-activities-list"),
    detail = element("article", "server-activities-detail");
  list.setAttribute("aria-label", "活动项目");
  layout.append(list, detail);
  const status = element("p", "muted"),
    accept = element("button", "primary", "接收");
  status.id = "serverActivityStatus";
  status.setAttribute("role", "status");
  accept.id = "acceptServerActivity";
  accept.type = "button";
  const remove = element("button", "danger", "删除奖励记录"),
    actions = element("div", "net-buttons");
  remove.id = "deleteServerActivityReward";
  remove.type = "button";
  remove.hidden = true;
  actions.append(accept, remove);
  dialog.append(heading, layout, status, actions);
  document.body.append(dialog);
  function request(message) {
    if (socket?.readyState !== WebSocket.OPEN) throw Error("服务器连接已中断，请重新连接。");
    socket.send(JSON.stringify(message));
  }
  function claim(item) {
    const receipt = item && mail.find((receipt) => receipt.id === (item.claimId || item.id));
    if (!receipt || receipt.confirmedAt !== null || pending.has(receipt.id)) return;
    pending.add(receipt.id);
    try {
      request({ type: "activity_claim", mailId: receipt.id });
    } catch (error) {
      pending.delete(receipt.id);
      status.textContent = error.message;
    }
    render();
  }
  function dismissalKey() {
    return "projectgreed.serverMailDismissed.v1." + serverId + "." + ProfileIdentity.snapshot().id;
  }
  function loadDismissed() {
    try {
      const value = JSON.parse(localStorage.getItem(dismissalKey()) || "[]");
      dismissed = new Set(Array.isArray(value) ? value.filter(id => typeof id === "string") : []);
    } catch { dismissed = new Set(); }
  }
  function dismissLegacy(ids) {
    // Older servers retain confirmed receipts, which already prevent duplicate rewards.
    const next = new Set(dismissed);
    for (const id of ids) {
      const receipt = mail.find(item => item.id === id);
      if (receipt?.confirmedAt != null) next.add(id);
    }
    localStorage.setItem(dismissalKey(), JSON.stringify([...next]));
    dismissed = next;
    if (!rows().some(item => item.id === selected)) selected = rows()[0]?.id || null;
    status.textContent = I18n.text("奖励记录已删除");
  }
  function rows() {
    const represented = new Set();
    const listings = activities.map((activity) => {
      const receipt = mail.find(
        (item) =>
          item.activityId === activity.id && (item.occurrence ?? null) === activity.occurrence,
      );
      if (receipt) represented.add(receipt.id);
      return {
        ...activity,
        id: "activity:" + activity.id,
        activityId: activity.id,
        persistent: true,
        claimId: receipt && !dismissed.has(receipt.id) ? receipt.id : null,
        createdAt: receipt?.createdAt ?? activity.createdAt ?? 0,
        confirmedAt: receipt?.confirmedAt ?? activity.confirmedAt ?? null,
        claimedAt: receipt?.claimedAt ?? null,
      };
    });
    // Past-cycle mail, including unclaimed rewards, remains accessible as history.
    return [...mail.filter(item => !represented.has(item.id) && !dismissed.has(item.id)), ...listings]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (b.item.createdAt ?? 0) - (a.item.createdAt ?? 0) || b.index - a.index)
      .map(entry => entry.item);
  }
  function stateLabel(item) {
    if (item.persistent && item.status !== "active")
      return I18n.text({ paused: "已暂停", upcoming: "未开始", ended: "已结束" }[item.status]);
    if (item.persistent && item.mode === "battle_bonus") return I18n.text("自动生效");
    if (item.confirmedAt !== null) return I18n.text("已接受");
    if (item.persistent && !item.claimId) return I18n.text("暂不可领取");
    return "";
  }
  function unitLabel(id) {
    const prefab = Rules.catalog.prefabs.find((unit) => unit.id === id);
    return prefab ? prefab.code + " " + I18n.localized(prefab) : id;
  }
  function render() {
    list.replaceChildren();
    detail.replaceChildren();
    const entries = rows();
    const bonusIds = new Set(
      activities.filter((item) => item.mode === "battle_bonus").map((item) => item.id),
    );
    const unread = mail.filter(
      (item) => item.confirmedAt === null && !bonusIds.has(item.activityId),
    ).length;
    byId("openServerActivities").textContent =
      I18n.text("服务器活动") + (unread ? " (" + unread + ")" : "");
    const source = byId("openServerActivities");
    source.dataset.unread = String(unread);
    source.classList.toggle("has-unclaimed", unread > 0);
    window.dispatchEvent(new Event("server-activities-changed"));
    for (const item of entries) {
      const button = element(
        "button",
        "",
        item.title + (item.occurrence ? " · " + item.occurrence : ""),
      );
      button.type = "button";
      button.setAttribute("aria-pressed", String(item.id === selected));
      if (stateLabel(item)) button.append(element("small", "", stateLabel(item)));
      button.onclick = () => {
        selected = item.id;
        status.textContent = "";
        render();
      };
      list.append(button);
    }
    const item = entries.find((item) => item.id === selected);
    const receiptId = item?.claimId || item?.id;
    const automatic = item?.persistent && item.mode === "battle_bonus";
    const receipt = mail.find((entry) => entry.id === receiptId);
    remove.hidden = !receipt || receipt.confirmedAt === null;
    remove.disabled = deleting.has(receiptId);
    accept.disabled =
      !item ||
      automatic ||
      (item.persistent && !item.claimId) ||
      item.confirmedAt !== null ||
      pending.has(receiptId);
    accept.textContent = I18n.text(
      automatic
        ? stateLabel(item) || "自动生效"
        : item?.confirmedAt != null
          ? "已接受"
          : pending.has(receiptId)
            ? "正在接收…"
            : item?.persistent && !item.claimId
              ? stateLabel(item) || "暂不可领取"
              : "接收",
    );
    if (!item) {
      detail.append(element("p", "muted", I18n.text("暂无服务器活动")));
      return;
    }
    detail.append(element("h3", "", item.title), element("p", "server-activity-body", item.text));
    if (item.persistent && item.mode === "cumulative_login")
      detail.append(
        element(
          "p",
          "muted",
          I18n.text("累计登录") +
            " " +
            item.loggedDays +
            " / " +
            item.loginDays +
            " " +
            I18n.text("天"),
        ),
      );
    if (item.multipliers) {
      detail.append(element("h4", "", I18n.text("服务器房间收益倍率")));
      for (const [key, label] of [
        ["experience", "驾驶员经验"],
        ["money", "资金"],
        ["supplies", "物资"],
        ["technology", "科技点"],
      ])
        detail.append(element("p", "", I18n.text(label) + " ×" + item.multipliers[key]));
      detail.append(
        element(
          "p",
          "muted",
          new Date(item.startsAt).toLocaleString() + " — " + new Date(item.endsAt).toLocaleString(),
        ),
      );
      detail.append(
        element("p", "muted", I18n.text("活动期间自动生效，无需领取；不影响单机和存档对局。")),
      );
    }
    const rewards = element("div", "server-activity-rewards");
    if (item.rewards.money || item.rewards.supplies) {
      const wallet = element("div", "resource-balance");
      ProductionUI.resources(wallet, item.rewards);
      rewards.append(wallet);
    }
    for (const [id, count] of Object.entries(item.rewards.inventory || {})) {
      const row = element("div", "server-activity-unit"),
        image = element("img");
      const model = Economy.baseModel(id);
      if (model) {
        image.src = unitIcon(model);
        image.alt = "";
        row.append(image);
      }
      row.append(element("span", "", unitLabel(id) + " ×" + count));
      rewards.append(row);
    }
    for (const id of item.rewards.unlockUnits || [])
      rewards.append(element("p", "", I18n.text("立即开发") + " · " + unitLabel(id)));
    if (rewards.childElementCount) {
      detail.append(element("h4", "", I18n.text("奖励内容")), rewards);
    }
  }
  function attach(connection) {
    socket = connection;
    serverId = null;
    mail = [];
    activities = [];
    selected = null;
    supportsDeletion = false;
    dismissed = new Set();
    pending.clear();
    deleting.clear();
    status.textContent = "";
    byId("openServerActivities").disabled = true;
    render();
    try {
      request({
        type: "activity_hello",
        version: PROJECT.version,
        identity: ProfileIdentity.snapshot(),
        name: PlayerProfile.name(),
      });
    } catch (error) {
      status.textContent = error.message;
      note(error.message);
    }
  }
  function detach(connection) {
    if (connection !== socket) return;
    socket = null;
    serverId = null;
    mail = [];
    activities = [];
    selected = null;
    supportsDeletion = false;
    dismissed = new Set();
    pending.clear();
    deleting.clear();
    byId("openServerActivities").disabled = true;
    if (dialog.open) dialog.close();
    render();
  }
  function receive(message, connection) {
    if (!message.type?.startsWith("activity_")) return false;
    if (connection !== socket) return true;
    if (message.type === "activity_mailbox") {
      serverId = message.serverId;
      supportsDeletion = message.capabilities?.deleteAcceptedRewards === true;
      loadDismissed();
      mail = message.mail;
      activities = message.activities || [];
      for (const id of deleting)
        if (!mail.some((item) => item.id === id)) {
          deleting.delete(id);
          status.textContent = I18n.text("奖励记录已删除");
        }
      const entries = rows();
      if (!entries.some((item) => item.id === selected))
        selected =
          entries.find(
            (item) =>
              item.confirmedAt === null &&
              (!item.persistent || (item.claimId && item.mode !== "battle_bonus")),
          )?.id ||
          entries[0]?.id ||
          null;
      byId("openServerActivities").disabled = false;
      render();
      // A disconnect between local persistence and acknowledgement must not lose a claim.
      for (const item of mail)
        if (item.claimedAt !== null && item.confirmedAt === null) claim(item);
    } else if (message.type === "activity_reward") {
      if (message.serverId !== serverId) return true;
      try {
        if (
          message.award.id !== "server-mail:" + serverId + ":" + message.mailId ||
          message.award.matchId !== serverId
        )
          throw Error("活动奖励标识无效");
        Development.receiveActivity(message.award);
        request({ type: "activity_ack", mailId: message.mailId });
        status.textContent = I18n.text("奖励已接收");
        Formation.refresh();
      } catch (error) {
        status.textContent = I18n.text("接收失败：") + Economy.errorMessage(error);
      }
      pending.delete(message.mailId);
      render();
    } else if (message.type === "activity_error") {
      if (message.message === "未知活动操作" && deleting.size) {
        try { dismissLegacy(deleting); }
        catch (error) { status.textContent = Economy.errorMessage(error); }
        deleting.clear();
        render();
        return true;
      }
      pending.clear();
      deleting.clear();
      status.textContent = message.message;
      render();
    }
    return true;
  }
  byId("openServerActivities").onclick = () => {
    status.textContent = "";
    render();
    dialog.showModal();
    try {
      request({ type: "activity_list" });
    } catch (error) {
      status.textContent = error.message;
    }
  };
  accept.onclick = () => claim(rows().find((item) => item.id === selected));
  remove.onclick = async () => {
    const item = rows().find((entry) => entry.id === selected);
    const id = item?.claimId || item?.id;
    const receipt = mail.find((entry) => entry.id === id);
    if (!receipt || receipt.confirmedAt === null || deleting.has(id)) return;
    if (
      !(await GameDialog.confirm("删除这条已接受的奖励记录？已获得的奖励不受影响。", {
        danger: true,
      }))
    )
      return;
    if (!supportsDeletion) {
      try { dismissLegacy([id]); }
      catch (error) { status.textContent = Economy.errorMessage(error); }
      render();
      return;
    }
    deleting.add(id);
    try {
      request({ type: "activity_delete", mailId: id });
    } catch (error) {
      deleting.delete(id);
      status.textContent = error.message;
    }
    render();
  };
  window.addEventListener("language-change", render);
  window.addEventListener("page-changing", () => {
    if (dialog.open) dialog.close();
  });
  return { attach, detach, receive };
})();

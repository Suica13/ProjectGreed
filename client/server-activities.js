/* Server-owned mail and receipts; rewards are credited before acknowledging delivery. */
const ServerActivities = (() => {
  let socket = null,
    serverId = null,
    mail = [],
    activities = [],
    selected = null;
  const pending = new Set();
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
  dialog.append(heading, layout, status, accept);
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
        claimId: receipt?.id || null,
        confirmedAt: receipt?.confirmedAt ?? null,
        claimedAt: receipt?.claimedAt ?? null,
      };
    });
    // Past-cycle mail, including unclaimed rewards, remains accessible as history.
    return [...mail.filter((item) => !represented.has(item.id)), ...listings];
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
    pending.clear();
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
  function receive(message, connection) {
    if (!message.type?.startsWith("activity_")) return false;
    if (connection !== socket) return true;
    if (message.type === "activity_mailbox") {
      serverId = message.serverId;
      mail = message.mail;
      activities = message.activities || [];
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
      pending.clear();
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
  window.addEventListener("language-change", render);
  window.addEventListener("page-changing", () => {
    if (dialog.open) dialog.close();
  });
  return { attach, receive };
})();

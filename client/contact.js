/* Contact pages are presentation only; merchant transactions are not yet enabled. */
window.ContactUI = (() => {
  const screen = element("section", "warehouse-screen contact-screen");
  screen.id = "contactScreen";
  screen.hidden = true;
  const main = element("section", "warehouse-main"), header = element("header"),
    content = element("div", "contact-content"), tasks = element("div", "contact-tasks"),
    merchants = element("div", "contact-merchants");
  tasks.id = "contactTasks";
  merchants.id = "contactMerchants";
  tasks.append(element("p", "muted", "任务内容开发中"));
  header.append(element("span", "muted", "联络终端"));
  const traders = [
    { id: "supply", name: "补给商人", portraitId: "Pilot_EFSF_0079_Common_1" },
    { id: "arms", name: "军火商人", portraitId: "Pilot_EFSF_0079_Common_2" },
    { id: "intel", name: "情报商人", portraitId: "Pilot_EFSF_0079_Common_3" },
  ];
  for (const trader of traders) {
    const card = element("article", "merchant-card"), frame = element("div", "merchant-portrait"),
      image = element("img"), info = element("div", "merchant-information"), stats = element("dl");
    card.dataset.merchantId = trader.id;
    image.src = PilotSystem.portrait({ portraitId: trader.portraitId });
    image.alt = "";
    image.draggable = false;
    frame.append(image);
    stats.append(element("dt", "", "好感度"), element("dd", "", "0"),
      element("dt", "", "等级"), element("dd", "", "Lv1"));
    info.append(element("h3", "", trader.name), stats);
    card.append(frame, info);
    merchants.append(card);
  }
  content.append(tasks, merchants);
  main.append(header, content);
  screen.append(main);
  document.body.append(screen);
  return {
    open(view) {
      tasks.hidden = view !== "contactTasks";
      merchants.hidden = view !== "contactMerchants";
      setPageView(view);
    },
  };
})();

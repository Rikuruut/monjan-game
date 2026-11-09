// モンじゃん! 大画面の起動(shared.js・core.js・dev.js のあとに読む)

async function loadInfo() {
  try {
    const info = await fetchJson("/api/info");
    el("phone-url").textContent = info.phone_url;
    setPhoneStatus(info.phone_connected);
  } catch (e) {
    el("phone-url").textContent = "(読めませんでした)";
  }
}

// 動物のアイコン(写真が届いたときの「とどいたもの」)と、名前のテストの動物の一覧
async function loadAnimals() {
  try {
    const data = await fetchJson("/api/animals");
    animalIcons = data.icons || {};
    defaultAnimalIcon = data.default_icon || defaultAnimalIcon;
    addOptions(el("nt-animal"), data.animals.map((name) => ({ value: name, text: name })));
    if (state.animal) el("animal-icon").textContent = iconFor(state.animal);
  } catch (e) { /* アイコンがなくても動くので無視 */ }
}

loadThemes();
showAutoplay();
loadAnimals().then(() => {
  if (params.get("demo")) runDemo();
  // 通しの自動プレイの途中(バトルのタイトルから来た)・ページの「テストプレイ」(?autotest=1)
  else if (readAutoplay().on) runAutoplayStep();
  else if (params.get("autotest")) playTestRun();
});
if (params.get("dev")) toggleDev(true);   // 確認用:?dev=1 で開発者メニューを開いた状態にする
renderScene("s1");
if (!params.get("demo")) {
  loadInfo();
  connectPc();
}

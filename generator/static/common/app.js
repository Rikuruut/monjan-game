// モンじゃん! 大画面(展示のモニター)の共通の動き
//
// 画面の見た目はテーマごとに static/themes/<テーマ名>/ に分けてあり、このファイルはどのテーマでも共通。
// テーマの切りかえ:/?theme=fusion のように付ける(何も付けないときは .env の PC_THEME)。
//
// 場面は4つ。#stage の data-scene で切りかえる。
//   s1 しゃしんを とろう      … 中ボタンでスマホに撮影の合図。写真が届いたら s2 へ
//   s2 しゃしん × どうぶつ = ? … 中ボタン「がったい!」で生成を始めて s3 へ。左ボタンで撮り直し
//   s3 がったい中            … サーバーからの progress に合わせて、進み具合を画面に渡す。結果が届いたら s4 へ
//   s4 たんじょう            … カードを見せる。左「もう一回」/中「たたかう!」(じゃんけんバトル /battle/ へ)/右「いんさつ」
// 操作は3つのボタン。キーボードの ← / Enter(Space)/ → でも押せる(USB の大きなボタンはキーとして届く)。
// 開発者メニューは右下のボタンか D キーで開く(このファイルが画面に足す)。
//
// ── テーマとの約束(新しいテーマを作るときは、index.html にこれらを用意する)──
//   #stage(data-scene / data-level / --progress をこのファイルが付ける)、#headline、
//   .lamps li[data-step="s1〜s4"](段階の印。done / now の class が付く)、
//   #photo(写真)、#animal-icon、#animal-name、
//   #btn-left / #btn-center / #btn-right(中に .knob-label。押せないときは disabled、出さないときは class="empty")、
//   #toast(class="show" が付く)、#tip、#name-help、#name-list、#st-naming / #st-drawing / #st-soon、
//   #card-name、#card-element、#card-recipe、#card-desc、#card-img
//   (なくてもよい)#partial-img:画像生成の途中の絵。届くと src が入り、#stage に data-partial(何枚目か。1から)が付く
// ── 進み具合の見せ方 ──
//   #stage に CSS 変数 --progress(0〜1)と data-level(0〜5)を付ける。
//   level:0 まだ / 1 なまえを考えている / 2 絵をかき始めた / 3 半分すぎ / 4 もうすぐ / 5 できた
//   テーマはこれを CSS で見せ方に変える(研究所:液体とメーター、たまご:ひび)。JavaScript は書かなくてよい。
//   段が変わったときは、#stage に levelchange イベント(detail: { level, prev })も送る。
// ── テーマの演出(なくてもよい)──
//   テーマが window.themeFx.birth(showCard) を用意していれば、誕生の演出をまかせる。
//   テーマは「ため」の演出のあと showCard()(s4 にする)を呼び、演出が終わったら Promise を終える。
//   用意していないテーマ・途中で失敗したときは、すぐに s4 にして CSS の演出で見せる。
//   誕生の効果音(crack・fanfare)も、themeFx を用意したテーマは自分で鳴らす(演出に合わせるため)。
// ── 効果音 ──
//   static/common/sound.js(window.sfx)を app.js より前に読む。読んでいなければ鳴らないだけ。
// ── 場面転換 ──
//   切りかえのあいだ #stage に class="shut" が付く。閉じる・開く時間は、テーマの CSS 変数
//   --scene-close-ms / --scene-open-ms で変えられる(初期値 340 / 140)。
// 確認用:?demo=1&scene=s3&progress=0.8&photo=…&img=…&animal=…&name=… で、APIを使わずにその場面を表示する。&dev=1 で開発者メニューを開く。
//   ?demo=1&play=birth で、割れる直前から誕生後までの流れを見本のデータで動かす。
//   同じことは、開発者メニューの「確認用(APIなし)」のボタンからもできる(ふつうの画面のまま使える)。

const el = (id) => document.getElementById(id);
const sound = (name) => { if (window.sfx) window.sfx.play(name); };
const stage = el("stage");
const params = new URLSearchParams(location.search);

const state = {
  scene: "s1",
  photoId: null,
  animal: "",
  generating: false,   // がったい中か(この間に届いた写真は無視する)
  nameChoices: [],
  chosenName: "",
};

// ----------------------------------------------------------------------
// 舞台の拡大・縮小(1920×1080 を、モニターの大きさに合わせる)
// ----------------------------------------------------------------------
function fitStage() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty("--scale", scale);
}
window.addEventListener("resize", fitStage);
fitStage();

// ----------------------------------------------------------------------
// 場面ごとの見出しとボタン
// ----------------------------------------------------------------------
const SCENES = ["s1", "s2", "s3", "s4"];

function headlineFor(scene) {
  if (scene === "s1") return "スマホで しゃしんを とってね";
  if (scene === "s2") return "しゃしん × " + (state.animal || "どうぶつ") + " = ?";
  if (scene === "s3") return "がったい ちゅう…";
  return "たんじょう!";
}

// ボタンの中身。null は「ボタンを出さない」、disabled は「出すが押せない」
function buttonsFor(scene) {
  if (scene === "s1") return { left: null, center: { label: "スマホで とる", action: requestCapture }, right: null };
  if (scene === "s2") return {
    left: { label: "とりなおす", action: requestCapture },
    center: { label: "がったい!", action: startFusion },
    right: null,
  };
  if (scene === "s3") return { left: null, center: { label: "まってね", disabled: true }, right: null };
  return {
    left: { label: "もう一回", action: restart },
    center: { label: "たたかう!", action: goBattle },
    right: { label: "いんさつ", action: () => toast("いんさつは じゅんびちゅう") },
  };
}

// じゃんけんバトル(友人の担当。/battle/)へ。できたモンスターは、バトルが /api/battle-monster/<photo_id> から読む。
// テストプレイ・確認用の見本(写真の ID がない)では、見本のゴリラ × はさみで戦う(名前は選んだことにしたもの)
function goBattle() {
  const id = state.photoId || "";
  location.href = /^[0-9a-f]{32}$/.test(id)
    ? "/battle/?photo=" + id
    : "/battle/?play=demo&name=" + encodeURIComponent(state.chosenName || demoName());
}

let currentButtons = buttonsFor("s1");

function renderScene(scene) {
  state.scene = scene;
  stage.dataset.scene = scene;
  el("headline").textContent = headlineFor(scene);

  // 段階のランプ
  const index = SCENES.indexOf(scene);
  document.querySelectorAll(".lamps li").forEach((li) => {
    const i = SCENES.indexOf(li.dataset.step);
    li.classList.toggle("done", i < index);
    li.classList.toggle("now", i === index);
  });

  // 操作盤
  currentButtons = buttonsFor(scene);
  ["left", "center", "right"].forEach((pos) => {
    const btn = el("btn-" + pos);
    const conf = currentButtons[pos];
    btn.classList.toggle("empty", !conf);
    btn.disabled = !conf || !!conf.disabled;
    btn.querySelector(".knob-label").textContent = conf ? conf.label : "";
  });
}

// 場面を切りかえる。ふつうは鉄のシャッターが閉じて開く。instant のときはすぐ切りかえる(誕生の演出など)
function setScene(scene, { instant = false } = {}) {
  if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderScene(scene);
    return Promise.resolve();
  }
  const style = getComputedStyle(stage);
  const closeMs = parseInt(style.getPropertyValue("--scene-close-ms"), 10) || 340;
  const openMs = parseInt(style.getPropertyValue("--scene-open-ms"), 10) || 140;
  return new Promise((resolve) => {
    stage.classList.add("shut");
    setTimeout(() => {
      renderScene(scene);
      setTimeout(() => {
        stage.classList.remove("shut");
        resolve();
      }, openMs);
    }, closeMs);
  });
}

// ----------------------------------------------------------------------
// ボタン(クリックとキーボードの両方)
// ----------------------------------------------------------------------
function press(pos) {
  const btn = el("btn-" + pos);
  const conf = currentButtons[pos];
  if (!conf || conf.disabled || btn.disabled) return;
  btn.classList.add("pressed");
  setTimeout(() => btn.classList.remove("pressed"), 160);
  sound("press");
  conf.action();
}

["left", "center", "right"].forEach((pos) => {
  el("btn-" + pos).addEventListener("click", () => press(pos));
});

document.addEventListener("keydown", (ev) => {
  // 開発者メニューの入力欄に文字を打っているときは、ボタンの操作にしない
  const tag = (ev.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (ev.repeat) return;
  // 開発者メニューのボタンを押したあとは、そこにフォーカスが残る。
  // そのまま Enter・Space を押すと、メニューのボタンと大きなボタンの両方が動くので、D キーだけを受け付ける
  const inDev = ev.target.closest && ev.target.closest("#dev");
  if (inDev && ev.key !== "d" && ev.key !== "D") return;

  if (ev.key === "ArrowLeft") press("left");
  else if (ev.key === "ArrowRight") press("right");
  else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); press("center"); }
  else if (ev.key === "d" || ev.key === "D") toggleDev();
});

// ----------------------------------------------------------------------
// 短いお知らせ
// ----------------------------------------------------------------------
let toastTimer = null;
function toast(text, seconds = 2.5) {
  const t = el("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), seconds * 1000);
}

// ----------------------------------------------------------------------
// s1 → s2:撮影の合図と、写真の受け取り
// ----------------------------------------------------------------------
async function requestCapture() {
  try {
    const res = await fetch("/api/capture-request", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      toast("スマホを みてね!");
      if (state.scene !== "s1") setScene("s1");
    } else {
      toast("スマホが つながっていないよ");
      showDevError(data.error || "合図を送れませんでした");
    }
  } catch (e) {
    toast("つうしんに しっぱいしたよ");
    showDevError("通信に失敗しました: " + e.message);
  }
}

function onPhotoReceived(msg) {
  if (state.generating) return;   // がったい中は、新しい写真で場面を変えない
  clearTimeout(endTimer);         // 撮り直し・失敗のあとに s1 へ戻る予定があれば取り消す(届いた写真を消さないように)
  state.photoId = msg.photo_id;
  state.animal = msg.animal || "";
  el("photo").src = msg.photo_url + "?t=" + Date.now();
  el("animal-icon").textContent = iconFor(state.animal);
  el("animal-name").textContent = state.animal || "どうぶつ";
  stage.classList.add("has-photo", "has-animal");
  setScene("s2");
}

// ----------------------------------------------------------------------
// s2 → s3 → s4:がったい と たんじょう
// ----------------------------------------------------------------------
async function startFusion() {
  if (!state.photoId || state.generating) return;
  await beginFusion();

  const body = new FormData();
  body.append("photo_id", state.photoId);
  try {
    const res = await fetch("/api/generate", { method: "POST", body });
    const data = await res.json();
    showDevResult(data);
    if (!data.ok) {
      showDevError((data.step ? "【" + data.step + "】で失敗\n" : "") + (data.error || "生成に失敗しました"));
      endWithMessage("うまく できなかったよ…", "もういちど とってね");
    } else if (data.needs_retake) {
      endWithMessage("もういちど とってね", data.retake_reason || "");
    } else {
      await birth(data);
      reportRevealed(state.photoId);   // スマホにも絵を見せてよい(誕生の演出が終わった)
    }
  } catch (e) {
    showDevError("通信に失敗しました: " + e.message);
    endWithMessage("うまく できなかったよ…", "もういちど とってね");
  }
}

// がったい中(s3)にして、ローディングを始める(本番とテストプレイで共通)
async function beginFusion() {
  state.generating = true;
  resetMachine();
  await setScene("s3");
  startTips();
  startNaming();
}

// 撮り直し・失敗:見出しで知らせて、少ししたら s1 に戻る
let endTimer = null;
function endWithMessage(headline, detail) {
  state.generating = false;
  stopTimers();
  el("headline").textContent = headline;
  if (detail) toast(detail, 4.5);
  clearTimeout(endTimer);
  endTimer = setTimeout(restart, 5000);
}

// たんじょう:カードを用意し、画像を読みこんでから、ガラスが割れる演出で見せる
function birth(data) {
  stopTimers();
  setProgress(1);
  fillCard(data);
  state.generating = false;
  return new Promise((resolve) => {
    const img = el("card-img");
    const show = () => playBirth().then(resolve);
    if (!img.getAttribute("src") || (img.complete && img.naturalWidth)) show();
    else { img.onload = show; img.onerror = show; }
  });
}

// PC で誕生の演出が終わったことをサーバーに知らせる(サーバーがスマホに revealed を送り、スマホが絵を見せる)
async function reportRevealed(photoId) {
  if (!photoId) return;
  const body = new FormData();
  body.append("photo_id", photoId);
  try {
    await fetch("/api/revealed", { method: "POST", body });
  } catch (e) {
    // 送れなくても、スマホは少し待てば絵を見せる(phone.js の REVEAL_FALLBACK_SECONDS)
  }
}

const CSS_BIRTH_MS = 1800;   // themeFx のないテーマで、CSS のカードの登場が終わるまで(テーマの card-born。いちばん長いガチャが 0.95秒待って 0.8秒)

// 誕生の演出。テーマの演出(window.themeFx.birth)があればまかせ、なければすぐ s4 にする
async function playBirth() {
  const fx = window.themeFx;
  if (!fx || typeof fx.birth !== "function") {
    sound("crack");
    setTimeout(() => sound("fanfare"), 500);   // CSS のカードの登場(0.5秒あと)に合わせる
    await setScene("s4", { instant: true });
    // CSS のカードの登場が終わるまで待つ(終わってからスマホに絵を見せるため)
    return new Promise((resolve) => setTimeout(resolve, CSS_BIRTH_MS));
  }
  let shown = false;
  const showCard = () => { if (!shown) { shown = true; renderScene("s4"); } };
  try {
    await fx.birth(showCard);
  } catch (e) {
    console.error("テーマの演出に失敗しました", e);
  }
  showCard();   // テーマが呼ばなかった・失敗したときも、かならずカードは見せる
}

// 性質ごとのアイコンと色(カードの右上のバッジ)
const ELEMENT_STYLES = {
  "あつい":     { icon: "🔥", cls: "el-fire" },
  "みず":       { icon: "💧", cls: "el-water" },
  "でんき":     { icon: "⚡", cls: "el-thunder" },
  "かたい":     { icon: "🪨", cls: "el-rock" },
  "とがってる": { icon: "🗡️", cls: "el-sharp" },
  "やわらかい": { icon: "☁️", cls: "el-soft" },
};

function fillCard(data) {
  const m = data.monster || {};
  el("card-name").textContent = state.chosenName || m.monster_name || "???";
  const st = ELEMENT_STYLES[m.element] || { icon: "", cls: "" };
  el("card-element").className = "card-element " + st.cls;
  el("card-element").textContent = m.element ? st.icon + " " + m.element : "";
  const animal = (data.settings || {}).animal || state.animal;
  el("card-recipe").textContent = animal && m.object_name ? animal + " × " + m.object_name : "";
  el("card-desc").textContent = m.description || "";
  if (data.monster_url) el("card-img").src = data.monster_url + "?t=" + Date.now();
}

function restart() {
  clearTimeout(endTimer);
  stopTestPlay();
  state.photoId = null;
  state.animal = "";
  state.generating = false;
  state.nameChoices = [];
  state.chosenName = "";
  stopTimers();
  resetMachine();
  el("photo").removeAttribute("src");
  el("animal-icon").textContent = "";
  el("animal-name").textContent = "どうぶつ";
  el("card-img").removeAttribute("src");
  stage.classList.remove("has-photo", "has-animal");
  setScene("s1");
}

// ----------------------------------------------------------------------
// がったい中のマシン(液体・メーター・進み具合・あそびかた・なまえ)
// ----------------------------------------------------------------------
const SOON_RATIO = 0.7;
let drawTimer = null;
let tipTimer = null;

// ※ あそびかたの説明は仮の文。対戦システム(友人の担当)のルールが決まったら差しかえる
const TIPS = [
  "モンスターは 3つの ボタンで たたかうよ",
  "せいしつは 6しゅるい 🔥💧⚡🪨🗡️☁️",
  "いろんな ものを とると ちがう モンスターに なるよ",
  "うまれた モンスターは カードに なるよ",
];

// 進み具合(0〜1)を画面に渡す。見せ方はテーマの CSS が決める(--progress と data-level)
function setProgress(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  stage.style.setProperty("--progress", r);
  const prev = Number(stage.dataset.level || 0);
  const level = r <= 0 ? 0 : r < 0.3 ? 1 : r < 0.5 ? 2 : r < 0.7 ? 3 : r < 1 ? 4 : 5;
  stage.dataset.level = level;
  if (level !== prev) stage.dispatchEvent(new CustomEvent("levelchange", { detail: { level, prev } }));
  if (state.scene === "s3" && level > prev && level < 5) sound("tick");
}

function setSteps(now) {
  const order = ["naming", "drawing", "soon"];
  const index = order.indexOf(now);
  order.forEach((name, i) => {
    const li = el("st-" + name);
    li.classList.toggle("done", i < index);
    li.classList.toggle("now", i === index);
  });
}

function startNaming() {
  setSteps("naming");
  setProgress(0.12);
}

function onProgress(msg) {
  if (state.scene !== "s3") return;
  if (msg.stage === "naming") {
    startNaming();
  } else if (msg.stage === "drawing") {
    setSteps("drawing");
    setNameChoices(msg.name_choices || (msg.monster_name ? [msg.monster_name] : []));
    // 画像生成の目安の時間にあわせて、液体を 30% → 95% まで満たす(目安を過ぎても 95% で止める)
    const expected = Math.max(5, msg.expected_seconds || 30);
    const started = Date.now();
    clearInterval(drawTimer);
    drawTimer = setInterval(() => {
      const r = (Date.now() - started) / 1000 / expected;
      setProgress(0.3 + Math.min(r, 1) * 0.65);
      if (r >= SOON_RATIO) setSteps("soon");
    }, 400);
  } else if (msg.stage === "names") {
    // 短いプロンプトでは、名前の候補は絵を作っているあいだに届く
    setNameChoices(msg.name_choices || (msg.monster_name ? [msg.monster_name] : []));
  } else if (msg.stage === "partial") {
    showPartial(msg.image_url, msg.index);
  } else if (msg.stage === "done") {
    clearInterval(drawTimer);
    setProgress(1);
  }
}

// 画像生成の途中の絵。テーマに #partial-img があるときだけ見せる(今は たまご のテーマだけ)。
// 見せ方はテーマの CSS が決める(#stage の data-partial = 何枚目か。1 から)
function showPartial(url, index) {
  const img = el("partial-img");
  if (!img) return;
  img.onload = () => { stage.dataset.partial = index; };   // 読みこめてから見せる(読みこみ中に空の枠が出ないように)
  img.src = url;
}

function clearPartial() {
  delete stage.dataset.partial;
  const img = el("partial-img");
  if (img) { img.onload = null; img.removeAttribute("src"); }
}

function setNameChoices(names) {
  state.nameChoices = names;
  const ul = el("name-list");
  ul.innerHTML = "";
  names.forEach((n) => {
    const li = document.createElement("li");
    li.textContent = n;
    li.classList.toggle("chosen", n === state.chosenName);
    ul.appendChild(li);
  });
  el("name-help").textContent = state.chosenName ? "けってい!" : "スマホで えらんでね";
}

// 子供がスマホで名前を選んだ
function onNameChosen(msg) {
  state.chosenName = msg.name;
  setNameChoices(state.nameChoices.length ? state.nameChoices : [msg.name]);
  const name = el("card-name");
  name.textContent = msg.name;
  name.classList.remove("pop");
  void name.offsetWidth;
  name.classList.add("pop");
  if (state.scene === "s4") toast("なまえは「" + msg.name + "」に けってい!");
}

function startTips() {
  let i = 0;
  el("tip").textContent = TIPS[0];
  clearInterval(tipTimer);
  tipTimer = setInterval(() => {
    i = (i + 1) % TIPS.length;
    el("tip").textContent = TIPS[i];
  }, 6000);
}

function stopTimers() {
  clearInterval(drawTimer);
  clearInterval(tipTimer);
}

function resetMachine() {
  setProgress(0);
  setSteps("");
  state.nameChoices = [];
  state.chosenName = "";
  el("name-list").innerHTML = "";
  el("name-help").textContent = "スマホで えらんでね";
  el("card-name").textContent = "???";
  clearPartial();
}

// ----------------------------------------------------------------------
// 動物のアイコン
// ----------------------------------------------------------------------
let animalIcons = {};
let defaultAnimalIcon = "🐾";
function iconFor(animal) {
  return animalIcons[animal] || (animal ? defaultAnimalIcon : "");
}

// ----------------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------------
function connectWebSocket() {
  const ws = new WebSocket("ws://" + location.host + "/ws?role=pc");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "phone_status") setPhoneStatus(msg.connected);
    else if (msg.type === "photo_received") onPhotoReceived(msg);
    else if (msg.type === "progress") onProgress(msg);
    else if (msg.type === "name_chosen") onNameChosen(msg);
  };
  ws.onclose = () => {
    setPhoneStatus(false);
    setTimeout(connectWebSocket, 2000);
  };
}

function setPhoneStatus(connected) {
  const s = el("phone-status");
  s.textContent = connected ? "接続中" : "未接続";
  s.className = "status " + (connected ? "status-on" : "status-off");
}

// ----------------------------------------------------------------------
// 開発者メニュー(検証用の情報)。どのテーマでも同じものを、このファイルが画面に足す
// ----------------------------------------------------------------------
document.body.insertAdjacentHTML("beforeend", `
<button id="dev-toggle" class="dev-toggle" title="開発者メニュー(D キー)" aria-label="開発者メニュー">⚙</button>
<aside id="dev" class="dev" hidden>
  <header class="dev-head">
    <strong>開発者メニュー</strong>
    <button id="dev-close" class="dev-close" aria-label="とじる">×</button>
  </header>
  <section>
    <h4>テーマ</h4>
    <p><select id="theme-select"></select></p>
  </section>
  <section>
    <h4>確認用(APIなし)</h4>
    <p class="dev-muted">見本のデータ(ゴリラ × はさみ)で、場面や演出を動かします。料金はかかりません。</p>
    <p class="dev-row">
      <button id="demo-testplay"><strong>▶ テストプレイ</strong></button>
      <span class="dev-muted">「がったい!」から誕生後まで通しで(がったい中 約25秒)</span>
    </p>
    <p class="dev-row">場面
      <button data-demo-scene="s1">s1 とる</button>
      <button data-demo-scene="s2">s2 あわせる</button>
      <button data-demo-scene="s3">s3 がったい</button>
      <button data-demo-scene="s4">s4 たんじょう</button>
    </p>
    <p class="dev-row">進み具合
      <input id="demo-progress" type="range" min="0" max="1" step="0.05" value="0.55">
      <span id="demo-progress-value">0.55</span>
    </p>
    <p class="dev-row">
      <button id="demo-birth">誕生の演出</button>
      <button id="demo-partial">途中の絵</button>
      <button id="demo-name">名前が選ばれた</button>
      <button id="demo-retake">撮り直しの表示</button>
      <button id="demo-reset">はじめに もどす</button>
    </p>
    <p class="dev-row">効果音
      <button data-demo-sfx="press">press</button>
      <button data-demo-sfx="tick">tick</button>
      <button data-demo-sfx="crack">crack</button>
      <button data-demo-sfx="fanfare">fanfare</button>
    </p>
  </section>
  <section>
    <h4>スマホ</h4>
    <p>接続:<span id="phone-status" class="status status-off">未接続</span></p>
    <p><code id="phone-url">読み込み中...</code></p>
    <img id="qr" src="/api/qr" alt="QRコード" width="140" height="140">
  </section>
  <section>
    <h4>かかった時間</h4>
    <ul id="timings"></ul>
    <h4>使った設定</h4>
    <ul id="settings"></ul>
    <h4>APIの使用量と料金(試算)</h4>
    <ul id="usage"></ul>
    <p id="output-dir" class="dev-muted"></p>
    <p id="error-msg" class="dev-error"></p>
  </section>
  <section>
    <h4>判定結果</h4>
    <pre id="result-json"></pre>
    <div id="notes-area" hidden>
      <h4>補正したところ</h4>
      <ul id="notes"></ul>
    </div>
  </section>
  <section>
    <h4>名前のテスト</h4>
    <p class="dev-muted">動物と物の名前だけから、モンスター名を作ります(写真・画像生成なし。1回 0.1円以下)。</p>
    <p class="nt-form">
      <select id="nt-animal"></select>
      <input id="nt-object" type="text" value="はさみ" maxlength="30">
      <input id="nt-count" type="number" value="5" min="1" max="10">
      <button id="btn-name-test">名前を作る</button>
    </p>
    <p id="nt-msg" class="dev-muted"></p>
    <table id="nt-table" hidden>
      <thead><tr><th>回</th><th>採用</th><th>候補(× は使わなかったもの)</th><th>場所</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
</aside>`);

// テーマの切りかえ(開発者メニューから)
async function loadThemes() {
  try {
    const data = await fetch("/api/themes").then((r) => r.json());
    const select = el("theme-select");
    data.themes.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name + "(" + t.id + ")";
      opt.selected = t.id === document.documentElement.dataset.theme;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      const p = new URLSearchParams(location.search);
      p.set("theme", select.value);
      location.search = p.toString();
    });
  } catch (e) { /* 一覧が読めなくても、画面は動く */ }
}

function toggleDev(force) {
  const dev = el("dev");
  dev.hidden = typeof force === "boolean" ? !force : !dev.hidden;
}
el("dev-toggle").addEventListener("click", () => toggleDev());
el("dev-close").addEventListener("click", () => toggleDev(false));

function showDevError(message) {
  el("error-msg").textContent = message || "";
}

function showDevResult(data) {
  showDevError("");
  el("result-json").textContent = JSON.stringify(data.monster || {}, null, 2);

  const allNotes = (data.validator_notes || []).concat(data.generator_notes || []);
  el("notes").innerHTML = "";
  allNotes.forEach((n) => {
    const li = document.createElement("li");
    li.textContent = n;
    el("notes").appendChild(li);
  });
  el("notes-area").hidden = allNotes.length === 0;

  showUsage(data.usage);
  el("output-dir").textContent = data.output_dir ? "保存先: outputs/" + data.output_dir : "";

  const t = data.timings || {};
  el("timings").innerHTML = "";
  [["判定", t.recognize], ["判定(物の名前・撮り直し)", t.check], ["名前・説明", t.describe],
   ["画像生成", t.generate], ["合計", t.total]].forEach(([label, sec]) => {
    if (sec === undefined || sec === null) return;
    const li = document.createElement("li");
    li.textContent = label + ": " + Number(sec).toFixed(1) + " 秒";
    el("timings").appendChild(li);
  });

  const s = data.settings || {};
  const dp = (data.monster || {}).design_plan || {};
  const st = dp.staging || {};
  el("settings").innerHTML = "";
  [["動物", s.animal], ["判定モデル", s.text_model],
   ["画像生成モデル", s.image_model], ["画質", s.image_quality],
   ["画像サイズ", s.image_size],
   ["画像プロンプト", s.image_prompt_style === "simple" ? "短い(simple)" : s.image_prompt_style ? "詳しい(detailed)" : ""],
   ["取り込む場所", s.image_prompt_style === "simple" ? dp.fusion_part_label : ""],
   ["ポーズ", s.image_prompt_style === "simple" ? [st.pose, st.view, st.expression].filter(Boolean).join(" / ") : ""],
   ["背景", s.image_prompt_style === "simple" && dp.background_place ? [st.scene, dp.background_place].filter(Boolean).join("の") : ""],
  ].forEach(([label, v]) => {
    if (!v) return;
    const li = document.createElement("li");
    li.textContent = label + ": " + v;
    el("settings").appendChild(li);
  });
}

function showUsage(usage) {
  const ul = el("usage");
  ul.innerHTML = "";
  if (!usage) return;
  const add = (text) => {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  };
  const line = (label, u) => {
    if (!u || u.total_tokens === undefined) return;
    // 円の目安はサーバーが計算したもの(換算は app/pricing.py の YEN_PER_USD)
    const cost = u.estimated_cost_usd;
    const yen = cost === null || cost === undefined ? "" :
                "  →  $" + cost.toFixed(4) + "(およそ " + Number(u.estimated_cost_yen).toFixed(1) + "円)";
    // 途中の絵の分(1枚 100 画像出力トークン)は、API の使用量に入っていないので、サーバーが試算に足している
    const partial = u.partial_images ? "(途中の絵 " + u.partial_images + "枚の +" + u.partial_image_output_tokens + " トークンを含む)" : "";
    add(label + ": " + u.total_tokens + " トークン(入力 " + (u.input_tokens || 0) + " / 出力 " + (u.output_tokens || 0) + ")" + yen + partial);
  };
  line("判定", usage.recognize);
  line("判定(物の名前・撮り直し)", usage.check);
  line("名前・説明", usage.describe);
  line("画像生成", usage.generate);
  if (usage.total_cost_usd !== null && usage.total_cost_usd !== undefined) {
    add("この1回の合計: $" + usage.total_cost_usd.toFixed(4) + "(およそ " + usage.total_cost_yen.toFixed(1) + "円)");
  }
  if (usage.cumulative_cost_usd !== undefined) {
    add("これまでの累計: $" + usage.cumulative_cost_usd.toFixed(4) + "(およそ " + usage.cumulative_cost_yen.toFixed(1) + "円)");
  }
  if (usage.note) add(usage.note);
}

// 名前のテスト(写真も画像生成も使わず、モンスター名だけを何回か作る)
el("btn-name-test").addEventListener("click", async () => {
  const body = new FormData();
  body.append("animal", el("nt-animal").value);
  body.append("object_name", el("nt-object").value);
  body.append("count", el("nt-count").value);
  el("btn-name-test").disabled = true;
  el("nt-msg").textContent = "名前を作っています…";
  const tbody = el("nt-table").querySelector("tbody");
  tbody.innerHTML = "";
  try {
    const res = await fetch("/api/name-test", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    data.runs.forEach((run, i) => {
      const tr = document.createElement("tr");
      const cells = [String(i + 1)];
      if (run.error) cells.push("(失敗)", run.error, "");
      else cells.push(
        run.name,
        (run.candidates || []).map((c) => (c.ok ? c.name : "× " + c.name + "(" + c.reason + ")")).join(" / "),
        run.fusion_place || ""
      );
      cells.forEach((text, j) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (j === 1) td.style.fontWeight = "bold";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    el("nt-table").hidden = false;
    let msg = data.animal + " × " + data.object_name + " を " + data.runs.length + " 回作りました。料金(試算):約 " + data.total_cost_yen + " 円";
    if (data.cumulative_cost_yen != null) msg += "(これまでの累計 約 " + data.cumulative_cost_yen + " 円)";
    el("nt-msg").textContent = msg;
  } catch (e) {
    el("nt-msg").textContent = "名前のテストに失敗しました: " + e.message;
  } finally {
    el("btn-name-test").disabled = false;
  }
});

// ----------------------------------------------------------------------
// 起動
// ----------------------------------------------------------------------
async function loadInfo() {
  try {
    const info = await fetch("/api/info").then((r) => r.json());
    el("phone-url").textContent = info.phone_url;
    setPhoneStatus(info.phone_connected);
  } catch (e) {
    el("phone-url").textContent = "(読めませんでした)";
  }
}

async function loadAnimals() {
  try {
    const data = await fetch("/api/animals").then((r) => r.json());
    animalIcons = data.icons || {};
    defaultAnimalIcon = data.default_icon || defaultAnimalIcon;
    data.animals.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      el("nt-animal").appendChild(opt);
    });
    if (state.animal) el("animal-icon").textContent = iconFor(state.animal);
  } catch (e) { /* アイコンがなくても動くので無視 */ }
}

// 確認用:?demo=1&scene=s3&photo=…&img=…&animal=…&name=… で、APIを使わずにその場面を表示する
// photo・img を付けないときは、見本の写真と絵(static/demo/)を使う
// 開発者メニューの「確認用(APIなし)」のボタンも、同じ関数を使う
const DEMO_PHOTO = "/static/demo/photo.jpg";
const DEMO_IMG = "/static/demo/monster.jpg";
const DEMO_OTHER_NAMES = ["ガブリザミ", "ゴリシザー"];
const DEMO_PARTIAL_COUNT = 2;   // 途中の絵の枚数(サーバーの IMAGE_PARTIAL_IMAGES の既定と同じ)

function demoName() { return params.get("name") || "ゴリザミ"; }

function demoSample() {
  return {
    monster: { monster_name: demoName(), element: "とがってる", object_name: "はさみ",
               description: "はさみの つのを ふりかざし、なんでも きりひらく ちからもち。" },
    settings: { animal: state.animal },
    monster_url: params.get("img") || DEMO_IMG,
  };
}

// 見本のデータで、その場面を表示する。progress は s3 の進み具合(0〜1)
function showDemo(scene, { progress = 0.55 } = {}) {
  clearTimeout(endTimer);
  stopTestPlay();
  stopTimers();
  state.generating = false;
  state.chosenName = "";
  state.animal = params.get("animal") || "ゴリラ";
  el("animal-name").textContent = state.animal;
  el("animal-icon").textContent = iconFor(state.animal) || "🦍";
  el("photo").src = params.get("photo") || DEMO_PHOTO;
  stage.classList.toggle("has-photo", scene !== "s1");
  stage.classList.toggle("has-animal", scene !== "s1");
  el("card-img").removeAttribute("src");
  clearPartial();
  renderScene(scene);
  if (scene === "s3") {
    startTips();
    setSteps(progress >= SOON_RATIO ? "soon" : "drawing");
    setProgress(progress);
    setNameChoices([demoName(), ...DEMO_OTHER_NAMES]);
    el("demo-progress").value = progress;
    el("demo-progress-value").textContent = Number(progress).toFixed(2);
  }
  if (scene === "s4") fillCard(demoSample());
}

// 誕生の演出を、割れる直前(ひびが出そろった所)から誕生後(カードと名前が出た所)まで流す。
// 終わったら s4 のまま止まる(「はじめに もどす」か場面のボタンで戻る)
const BIRTH_DEMO_DELAY_MS = 300;   // がったい中の画面が描かれるのを待つだけの短い間
function playBirthDemo() {
  showDemo("s3", { progress: 1 });
  setTimeout(() => birth(demoSample()), BIRTH_DEMO_DELAY_MS);
}

function runDemo() {
  if (params.get("play") === "birth") {
    playBirthDemo();
    return;
  }
  const scene = SCENES.includes(params.get("scene")) ? params.get("scene") : "s1";
  showDemo(scene, { progress: parseFloat(params.get("progress") || "0.55") });
}

// ----------------------------------------------------------------------
// テストプレイ:見本のデータで、「がったい!」から誕生後までを通しで流す(API は呼ばない)
// ----------------------------------------------------------------------
// サーバーから届くメッセージ(progress)を、本番と同じ順・同じくらいの間で、このページの中で作って渡す。
// 見せ方の処理(onProgress・birth など)は本番と同じものを使うので、本番の見た目をそのまま確かめられる。
// 時間は「がったい!」から 約25秒(すぐ要る判定 3秒 + 画像生成 20秒 + 誕生の演出)。
const TEST_PLAY_DRAW_SECONDS = 20;   // 画像生成にかかる時間(drawing の expected_seconds に入れる)
let testPlayTimers = [];
let testPlayRun = 0;   // 何回目のテストプレイか(止めたあとに、途中の続きが動かないように見分ける)

function stopTestPlay() {
  testPlayRun += 1;
  testPlayTimers.forEach(clearTimeout);
  testPlayTimers = [];
}

function afterSeconds(seconds, fn) {
  testPlayTimers.push(setTimeout(fn, seconds * 1000));
}

function playTestRun() {
  // s2(しゃしん × どうぶつ)から始める
  showDemo("s2");
  const photoId = "testplay";
  const names = [demoName(), ...DEMO_OTHER_NAMES];
  const img = params.get("img") || DEMO_IMG;
  const draw = TEST_PLAY_DRAW_SECONDS;
  const run = testPlayRun;

  // 1.5秒後に「がったい!」を押したことにする
  afterSeconds(1.5, async () => {
    const btn = el("btn-center");
    btn.classList.add("pressed");
    setTimeout(() => btn.classList.remove("pressed"), 160);
    sound("press");
    await beginFusion();
    if (run !== testPlayRun) return;   // 場面の切りかえ中に止められた
    // すぐ要る判定(3秒)→ 画像生成を始める
    afterSeconds(3, () => onProgress({ stage: "drawing", expected_seconds: draw, photo_id: photoId }));
    // 名前・説明は、画像生成と同時に作られて先に届く
    afterSeconds(3 + 5, () => onProgress({ stage: "names", name_choices: names, monster_name: names[0], photo_id: photoId }));
    // 途中の絵(たまごのテーマだけ見える)
    afterSeconds(3 + draw * 0.4, () => onProgress({ stage: "partial", image_url: img, index: 1, total: 2, photo_id: photoId }));
    afterSeconds(3 + draw * 0.75, () => onProgress({ stage: "partial", image_url: img, index: 2, total: 2, photo_id: photoId }));
    // 子供がスマホで名前を選んだことにする(2つ目の候補)
    afterSeconds(3 + draw * 0.55, () => onNameChosen({ name: names[1] }));
    // できあがり → 誕生
    afterSeconds(3 + draw, () => {
      onProgress({ stage: "done", photo_id: photoId, image_url: img });
      birth(demoSample());
    });
  });
}

// 開発者メニューの「確認用(APIなし)」
el("demo-testplay").addEventListener("click", () => {
  toggleDev(false);   // メニューを閉じて、画面全体で見る
  playTestRun();
});
document.querySelectorAll("[data-demo-scene]").forEach((btn) => {
  btn.addEventListener("click", () => showDemo(btn.dataset.demoScene, { progress: Number(el("demo-progress").value) }));
});
el("demo-progress").addEventListener("input", () => {
  const value = Number(el("demo-progress").value);
  el("demo-progress-value").textContent = value.toFixed(2);
  if (state.scene !== "s3") showDemo("s3", { progress: value });
  else {
    setSteps(value >= SOON_RATIO ? "soon" : "drawing");
    setProgress(value);
  }
});
el("demo-birth").addEventListener("click", playBirthDemo);
el("demo-name").addEventListener("click", () => {
  // 名前の候補を順番に「選ばれた」ことにする(スマホで名前を選んだときと同じ動き)
  const names = state.nameChoices.length ? state.nameChoices : [demoName(), ...DEMO_OTHER_NAMES];
  const current = state.chosenName || names[0];   // まだ選ばれていなければ、いまの名前(先頭)の次から
  const next = names[(names.indexOf(current) + 1) % names.length];
  onNameChosen({ name: next });
});
el("demo-partial").addEventListener("click", () => {
  // 途中の絵を、見本の絵で 1枚目 → 2枚目 → 1枚目… と進める(たまごのテーマだけ見える)
  if (state.scene !== "s3") showDemo("s3", { progress: 0.6 });
  if (!el("partial-img")) { toast("このテーマには 途中の絵が ないよ"); return; }
  const next = (Number(stage.dataset.partial || 0) % DEMO_PARTIAL_COUNT) + 1;
  showPartial(params.get("img") || DEMO_IMG, next);
});
el("demo-retake").addEventListener("click", () => {
  showDemo("s3");
  endWithMessage("もういちど とってね", "ひとが うつっているよ");
});
el("demo-reset").addEventListener("click", restart);
document.querySelectorAll("[data-demo-sfx]").forEach((btn) => {
  btn.addEventListener("click", () => sound(btn.dataset.demoSfx));
});

loadThemes();
loadAnimals().then(() => { if (params.get("demo")) runDemo(); });
if (params.get("dev")) toggleDev(true);   // 確認用:?dev=1 で開発者メニューを開いた状態にする
renderScene("s1");
if (!params.get("demo")) {
  loadInfo();
  connectWebSocket();
}

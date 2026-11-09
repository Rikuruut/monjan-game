// モンじゃん! 大画面(展示のモニター)の共通の動き(本体)
//
// 読む順:shared.js → core.js(このファイル)→ dev.js(開発者メニュー・見本・テストプレイ)→ boot.js(起動)。
// どれも素の script なので、関数はページ全体で共有される。このファイルは読み込んだときに画面を動かさない
// (ボタン・キーの受け付けを登録するだけ。起動は boot.js)。
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
//   テーマはこれを CSS で見せ方に変える(fusion:うずの帯・風の筋の明るさ)。JavaScript は書かなくてよい。
//   段が変わったときは、#stage に levelchange イベント(detail: { level, prev })も送る。
// ── テーマの演出(なくてもよい)──
//   テーマが window.themeFx.birth(showCard) を用意していれば、誕生の演出をまかせる。
//   テーマは「ため」の演出のあと showCard()(s4 にする)を呼び、演出が終わったら Promise を終える。
//   用意していないテーマ・途中で失敗したときは、すぐに s4 にして CSS の演出で見せる。
//   誕生の効果音(crack・fanfare)も、themeFx を用意したテーマは自分で鳴らす(演出に合わせるため)。
// ── 効果音 ──
//   static/common/sound.js(window.sfx)を core.js より前に読む。読んでいなければ鳴らないだけ。
// ── 場面転換 ──
//   切りかえのあいだ #stage に class="shut" が付く。閉じる・開く時間は、テーマの CSS 変数
//   --scene-close-ms / --scene-open-ms で変えられる(初期値 340 / 140)。
// 確認用:?demo=1&scene=s3&progress=0.8&photo=…&img=…&animal=…&name=… で、APIを使わずにその場面を表示する。&dev=1 で開発者メニューを開く。
//   ?demo=1&play=birth で、割れる直前から誕生後までの流れを見本のデータで動かす。
//   同じことは、開発者メニューの「演出を見る」のボタンからもできる(ふつうの画面のまま使える。dev.js)。

const sound = (name) => { if (window.sfx) window.sfx.play(name); };
const fusionBgm = (on) => { if (window.sfx && window.sfx.fusionBgm) window.sfx.fusionBgm(on); };
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
  if (scene === "s3") return "なにが うまれるかな...?";
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
    right: { label: "いんさつ", action: printCard },
  };
}

// ----------------------------------------------------------------------
// カードの印刷(2026年11月9日の試作。カードのページは /card。static/card/・app/card.py)
// ----------------------------------------------------------------------
// いまのモンスターのカードの id。テストプレイ・見本(写真の ID がない)は demo
function cardId() {
  const id = state.photoId || "";
  return /^[0-9a-f]{32}$/.test(id) ? id : "demo";
}

// 見本(demo)のモンスターの名前(テストプレイで選んだことにした名前。なければ見本の名前)
function shownDemoName() { return state.chosenName || demoName(); }

function cardUrl(id, extra = "") {
  const name = id === "demo" ? "&name=" + encodeURIComponent(shownDemoName()) : "";
  return "/card?id=" + encodeURIComponent(id) + name + extra;
}

// カードの PDF を outputs/<フォルダ>/card.pdf に残す(見本は残さない)。終わるまで画面は待たない
function saveCardPdf(id) {
  if (id === "demo") return Promise.resolve(null);
  return fetchJson("/api/card-pdf/" + encodeURIComponent(id), { method: "POST" })
    .catch((e) => ({ ok: false, error: String(e) }));
}

// カードを、いまの画面の上に重ねて見せる(開発者メニュー用)。
// ※ 2026年11月9日:はじめは新しいタブで開いていたが、キオスクにはタブの切りかえがなく、戻れなかった。
//   閉じるのは「とじる」・外側のクリック・どのキーでも(カードの中でキーを押したときは card.js が知らせてくる)
function showCardPreview(id) {
  closeCardPreview();
  const box = document.createElement("div");
  box.id = "card-preview";
  box.className = "card-preview";
  box.innerHTML = '<iframe class="card-preview-frame" title="カード"></iframe>' +
    '<button type="button" class="card-preview-close">× とじる(どのキーでも)</button>';
  box.querySelector("iframe").src = cardUrl(id);
  box.addEventListener("click", (ev) => { if (ev.target === box) closeCardPreview(); });
  box.querySelector("button").addEventListener("click", closeCardPreview);
  document.body.appendChild(box);
}

function closeCardPreview() {
  const box = el("card-preview");
  if (!box) return false;
  box.remove();
  return true;
}

window.addEventListener("message", (ev) => {
  if (ev.origin === location.origin && ev.data === "monjan-card-close") closeCardPreview();
});

// 「いんさつ」:誕生の画面のまま、見えない iframe でカードのページを開いて印刷する(ページが自分で印刷する)。
// .env の KIOSK_PRINTING=true のキオスクでは、ダイアログを出さずに既定のプリンターで刷る
function printCard() {
  const id = cardId();
  el("print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "print-frame";
  frame.className = "print-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.src = cardUrl(id, "&print=1");
  document.body.appendChild(frame);
  toast("いんさつ しているよ");
  saveCardPdf(id).then((res) => {
    if (res && !res.ok) console.warn("カードの PDF を作れませんでした:", res.error);
  });
}

// じゃんけんバトル(友人の担当。/battle/)へ。できたモンスターは、バトルが /api/battle-monster/<photo_id> から読む。
// テストプレイ・確認用の見本(写真の ID がない)では、見本のゴリラ × はさみで戦う(名前は選んだことにしたもの)
function goBattle() {
  const id = cardId();
  location.href = id !== "demo"
    ? "/battle/?photo=" + id
    : "/battle/?play=demo&name=" + encodeURIComponent(shownDemoName());
}

let currentButtons = buttonsFor("s1");

function renderScene(scene) {
  state.scene = scene;
  stage.dataset.scene = scene;
  el("headline").textContent = headlineFor(scene);
  fusionBgm(scene === "s3");   // がったい中の BGM(sound.js)

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

// 場面転換の時間(テーマの CSS 変数)。テーマの CSS は途中で変わらないので、最初に使うときに1回だけ読む
let sceneTimes = null;
function getSceneTimes() {
  if (!sceneTimes) {
    const style = getComputedStyle(stage);
    sceneTimes = {
      closeMs: parseInt(style.getPropertyValue("--scene-close-ms"), 10) || 340,
      openMs: parseInt(style.getPropertyValue("--scene-open-ms"), 10) || 140,
    };
  }
  return sceneTimes;
}

// 場面を切りかえる。ふつうは鉄のシャッターが閉じて開く。instant のときはすぐ切りかえる(誕生の演出など)
function setScene(scene, { instant = false } = {}) {
  if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderScene(scene);
    return Promise.resolve();
  }
  const { closeMs, openMs } = getSceneTimes();
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
// ボタンを押した見た目と音(テストプレイで「押したことにする」ときも使う)
function flashButton(pos) {
  const btn = el("btn-" + pos);
  btn.classList.add("pressed");
  setTimeout(() => btn.classList.remove("pressed"), 160);
  sound("press");
}

function press(pos) {
  const btn = el("btn-" + pos);
  const conf = currentButtons[pos];
  if (!conf || conf.disabled || btn.disabled) return;
  flashButton(pos);
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
  // カードを重ねて見せているあいだは、どのキーでも閉じるだけにする(うしろの画面は動かさない)
  if (el("card-preview")) {
    ev.preventDefault();
    closeCardPreview();
    return;
  }
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
    const data = await fetchJson("/api/capture-request", { method: "POST" });
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

  try {
    const data = await postForm("/api/generate", { photo_id: state.photoId }).then((r) => r.json());
    showDevResult(data);
    if (!data.ok) {
      failFusion((data.step ? "【" + data.step + "】で失敗\n" : "") + (data.error || "生成に失敗しました"));
    } else if (data.needs_retake) {
      endWithMessage("もういちど とってね", data.retake_reason || "");
    } else {
      await birth(data);
      reportRevealed(state.photoId);   // スマホにも絵を見せてよい(誕生の演出が終わった)
    }
  } catch (e) {
    failFusion("通信に失敗しました: " + e.message);
  }
}

// 生成の失敗:開発者メニューに理由を出し、画面には「うまく できなかったよ…」
function failFusion(devMessage) {
  showDevError(devMessage);
  endWithMessage("うまく できなかったよ…", "もういちど とってね");
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
  fusionBgm(false);   // 撮り直し・エラーの表示のあいだは、がったい中の BGM を止める
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
  try {
    await postForm("/api/revealed", { photo_id: photoId });
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

// タイプごとのアイコンと色(カードの右上のバッジ)。タイプと色はじゃんけんバトルの属性と同じ
const ELEMENT_STYLES = {
  "火": { icon: "🔥", cls: "el-fire" },
  "水": { icon: "💧", cls: "el-water" },
  "草": { icon: "🌿", cls: "el-nature" },
  "光": { icon: "✨", cls: "el-light" },
  "闇": { icon: "🌙", cls: "el-dark" },
  "風": { icon: "🌪️", cls: "el-wind" },
  "土": { icon: "🪨", cls: "el-earth" },
  "無": { icon: "⚪", cls: "el-neutral" },
};

function fillCard(data) {
  const m = data.monster || {};
  el("card-name").textContent = state.chosenName || m.monster_name || "???";
  const st = ELEMENT_STYLES[m.element] || { icon: "", cls: "" };
  el("card-element").className = "card-element " + st.cls;
  el("card-element").textContent = m.element ? st.icon + " " + m.element + "タイプ" : "";
  const animal = (data.settings || {}).animal || state.animal;
  el("card-recipe").textContent = animal && m.object_name ? animal + " × " + m.object_name : "";
  el("card-desc").textContent = m.description || "";
  if (data.monster_url) el("card-img").src = data.monster_url + "?t=" + Date.now();
}

// 動いているもの(撮り直しのあとの戻り・テストプレイ・ローディングのタイマー)を止める
function cancelRunning() {
  clearTimeout(endTimer);
  stopTestPlay();
  stopTimers();
  state.generating = false;
}

function restart() {
  cancelRunning();
  state.photoId = null;
  state.animal = "";
  resetMachine();   // 名前の候補・選んだ名前も消す
  el("photo").removeAttribute("src");
  el("animal-icon").textContent = "";
  el("animal-name").textContent = "どうぶつ";
  el("card-img").removeAttribute("src");
  stage.classList.remove("has-photo", "has-animal");
  setScene("s1");
}

// ----------------------------------------------------------------------
// がったい中(進み具合・あそびかた・なまえ)
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

// 進み具合(0〜1)を画面に渡す。見せ方はテーマの CSS が決める(--progress と data-level)。
// 同じ値のときは書かない(#stage に書くと、舞台全体のスタイルを計算し直すため。目安の時間を過ぎると 0.95 のまま続く)
let shownProgress = null;
function setProgress(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  if (r !== shownProgress) {
    stage.style.setProperty("--progress", r);
    shownProgress = r;
  }
  const prev = Number(stage.dataset.level || 0);
  const level = r <= 0 ? 0 : r < 0.3 ? 1 : r < 0.5 ? 2 : r < 0.7 ? 3 : r < 1 ? 4 : 5;
  if (stage.dataset.level !== String(level)) stage.dataset.level = level;
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

// 決まった進み具合で止めて見せる(見本・開発者メニュー)
function showProgressAt(ratio) {
  setSteps(ratio >= SOON_RATIO ? "soon" : "drawing");
  setProgress(ratio);
}


function onProgress(msg) {
  if (state.scene !== "s3") return;
  if (msg.stage === "naming") {
    startNaming();
  } else if (msg.stage === "drawing") {
    setSteps("drawing");
    setNameChoices(nameChoicesOf(msg));
    // 画像生成の目安の時間にあわせて、30% → 95% まで進める(目安を過ぎても 95% で止める)
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
    setNameChoices(nameChoicesOf(msg));
  } else if (msg.stage === "partial") {
    showPartial(msg.image_url, msg.index);
  } else if (msg.stage === "done") {
    clearInterval(drawTimer);
    setProgress(1);
  }
}

// 画像生成の途中の絵。テーマに #partial-img があるときだけ見せる(fusion はうずの中心に透かす)。
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
  replayAnimation(name, "pop");
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
function connectPc() {
  connectWebSocket("pc", (msg) => {
    if (msg.type === "phone_status") setPhoneStatus(msg.connected);
    else if (msg.type === "photo_received") onPhotoReceived(msg);
    else if (msg.type === "progress") onProgress(msg);
    else if (msg.type === "name_chosen") onNameChosen(msg);
  }, () => setPhoneStatus(false));
}

// スマホの接続の表示(開発者メニューの「スマホ」タブ。dev.js が画面に足す)
function setPhoneStatus(connected) {
  const s = el("phone-status");
  s.textContent = connected ? "接続中" : "未接続";
  s.className = "status " + (connected ? "status-on" : "status-off");
}

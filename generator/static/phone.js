// スマホ用ページの処理(common/shared.js のあとに読む)

const VIEWS = ["view-wait", "view-ready", "view-sending", "view-done", "view-progress", "view-error"];

// 表示する画面を切り替える
function showView(id) {
  VIEWS.forEach((v) => el(v).classList.toggle("hidden", v !== id));
}

// ----------------------------------------------------------------------
// 動物のプルダウンを作る
// ----------------------------------------------------------------------
async function loadAnimals() {
  const data = await fetchJson("/api/animals");
  const select = el("animal");
  addOptions(select, data.animals.map((name) => ({ value: name, text: name })));
  // 最初から1つ選ばれている状態にする
  select.selectedIndex = 0;
}

// ----------------------------------------------------------------------
// WebSocket(PCからの撮影の合図を受け取る)
// ----------------------------------------------------------------------
// 切れたら少し待って入り直す(shared.js の connectWebSocket)
function connectPhone() {
  connectWebSocket("phone", (msg) => {
    if (msg.type === "capture_request") {
      // 待機中に戻る予定があれば取り消す(撮影の画面が、あとから待機中に戻されないように)
      cancelBackToWait();
      clearPendingResult();
      showView("view-ready");
    } else if (msg.type === "revealed") {
      // PC の大画面で、モンスターが登場し終わった(ここで初めてスマホにも絵を見せる)
      if (pendingResult && msg.photo_id === pendingResult.photoId) revealResult(msg.name);
    } else if (msg.type === "progress") {
      // 生成の進み具合(ローディングと名前えらび。下の showProgress を参照)
      showProgress(msg);
    }
  });
}

// ----------------------------------------------------------------------
// 撮影 → JPEGに変換 → 送信
// ----------------------------------------------------------------------
el("camera").addEventListener("change", async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  // 同じ写真でもまた選べるように値を消す
  ev.target.value = "";
  if (!file) return;

  // 選んだ動物。撮影した時点の値を使う
  const animal = el("animal").value;

  showView("view-sending");

  try {
    const blob = await toJpeg(file, 1024);
    const body = new FormData();
    body.append("photo", blob, "photo.jpg");   // ファイル名を付けるので postForm は使わない
    body.append("animal", animal);

    const res = await fetch("/api/upload", { method: "POST", body });
    if (!res.ok) {
      let detail = "";
      try {
        const data = await res.json();
        detail = data.detail || "";
      } catch (parseError) {
        detail = "";
      }
      throw new Error(detail || ("サーバーエラー (" + res.status + ")"));
    }

    showView("view-done");
    // 数秒後に待機中に戻る(そのあいだに生成が始まってローディングに変わっていたら、戻さない)
    setTimeout(() => {
      if (!el("view-done").classList.contains("hidden")) showView("view-wait");
    }, 3000);

  } catch (e) {
    el("phone-error").textContent = e.message;
    showView("view-error");
  }
});

el("btn-retry").addEventListener("click", () => showView("view-ready"));

/**
 * 写真を長辺 maxSize px のJPEGに変換する。
 * 容量を減らすためと、iPhoneのHEIC形式への対策のためにcanvasを通す。
 */
function toJpeg(file, maxSize) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      // 長辺を maxSize に合わせる(小さい写真は拡大しない)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("JPEGに変換できませんでした"))),
        "image/jpeg",
        0.9
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("写真を読み込めませんでした(対応していない形式かもしれません)"));
    };

    img.src = url;
  });
}

// ----------------------------------------------------------------------
showView("view-wait");
loadAnimals().catch((e) => {
  el("phone-error").textContent = "どうぶつの一覧を読めませんでした: " + e.message;
  showView("view-error");
});
connectPhone();

// ----------------------------------------------------------------------
// 生成中のローディングと、できあがりの絵
// ----------------------------------------------------------------------
// 名前は PC の大画面で、3つのボタンから選ぶ(2026年11月9日。それまではスマホで選んでいたが、
// スマホ → PC → スマホ と行き来するのが分かりにくかった。元は archive/20261109_before_pc_naming/)。
// スマホは写真と動物を送るまで。そのあとは進み具合を出すだけ。
// PCで「がったい!」が押されると、サーバーから進み具合(progress)が届く。
//   naming :なまえを かんがえているよ
//   drawing:え を かいているよ
//   names  :名前の候補が届いた(PC で選んでいる)→「おおきい がめんで なまえを えらんでね」
//   partial:途中の絵(スマホでは使わない)
//   done   :できたよ!(絵はまだ見せない。PC で誕生の演出が終わると revealed が届くので、そこで絵と決まった名前を見せる)
//   retake / error:とりなおし・しっぱい
const BACK_TO_WAIT_SECONDS = 6;   // 撮り直し・失敗のあと、待機中に戻るまでの秒数

let barTimer = null;
let backTimer = null;   // 少ししてから待機中に戻すタイマー(撮影の合図・次の生成が来たら取り消す)
let pendingResult = null;        // できあがったが、まだ見せていない絵(PC の登場が終わるのを待っている)
let revealFallbackTimer = null;
// PC から登場の知らせが来なくても、この秒数たったら絵を見せる。
// PC で名前を選ぶまで誕生を待つので、PC の自動決定(core.js の AUTO_NAME_SECONDS = 60秒)より長くする
const REVEAL_FALLBACK_SECONDS = 90;

function setStage(html) { el("ph-stage").innerHTML = html; }
function setBar(percent) { el("ph-bar-fill").style.width = Math.max(0, Math.min(100, percent)) + "%"; }
function stopBarTimer() { if (barTimer) clearInterval(barTimer); barTimer = null; }

// できあがったモンスターの絵(ためし。あとで、しっかり作ったカードに差しかえる)
// 絵を見せているあいだは待機中に戻さない。次の子が PC で「スマホでとる」を押すと、撮影の画面に切りかわる
function showResult(imageUrl, name) {
  document.querySelector(".ph-bar").classList.add("hidden");
  el("ph-result-name").textContent = name || "";
  el("ph-result-img").src = imageUrl;
  el("ph-result").classList.remove("hidden");
}

function hideResult() {
  document.querySelector(".ph-bar").classList.remove("hidden");
  el("ph-result").classList.add("hidden");
  el("ph-result-img").removeAttribute("src");
}

function hideNote() { el("ph-name-decided").classList.add("hidden"); }

function showProgress(msg) {
  const stage = msg.stage;

  if (stage === "naming") {
    cancelBackToWait();
    clearPendingResult();
    hideNote();
    hideResult();
    showView("view-progress");
    setStage("なまえを<br>かんがえているよ");
    setBar(10);

  } else if (stage === "drawing") {
    showView("view-progress");
    setStage("え を かいているよ");
    // 画像生成の目安の時間にあわせてバーを進める(目安を過ぎても 95% で止める)
    const expected = Math.max(5, msg.expected_seconds || 30);
    const started = Date.now();
    stopBarTimer();
    barTimer = setInterval(() => {
      const ratio = (Date.now() - started) / 1000 / expected;
      setBar(30 + Math.min(ratio, 1) * 65);
    }, 500);
    if (nameChoicesOf(msg).length) askToLookAtPc();

  } else if (stage === "names") {
    askToLookAtPc();

  } else if (stage === "done") {
    stopBarTimer();
    setBar(100);
    // 絵はまだ見せない。PC の大画面で誕生の演出が終わってから(revealed が届いてから)見せる
    // ※ 2026年11月2日:(当時の)たまごのテーマで、たまごが割れる前にスマホにモンスターが出てしまったため
    setStage("できたよ!<br>おおきい がめんを みてね");
    if (msg.image_url) {
      pendingResult = { photoId: msg.photo_id || "", imageUrl: msg.image_url, monsterName: msg.monster_name };
      // PC から知らせが来ないとき(PC の画面を読みこみ直したときなど)も、少し待てば見せる
      revealFallbackTimer = setTimeout(() => revealResult(), REVEAL_FALLBACK_SECONDS * 1000);
    } else {
      backToWaitLater();
    }

  } else if (stage === "retake") {
    stopBarTimer();
    showView("view-progress");
    hideResult();
    setStage("もういちど<br>とってね");
    el("ph-name-decided").textContent = msg.reason || "";
    el("ph-name-decided").classList.remove("hidden");
    backToWaitLater();

  } else if (stage === "error") {
    stopBarTimer();
    hideNote();
    hideResult();
    setStage("うまく できなかったよ…");
    backToWaitLater();
  }
}

// 名前の候補が届いた:PC の大画面で選んでもらう
function askToLookAtPc() {
  showView("view-progress");
  setStage("おおきい がめんで<br>なまえを えらんでね");
}

// PC で登場し終わったら、スマホにもモンスターの絵を見せる。name は PC で決めた名前(revealed に入っている)
function revealResult(name) {
  if (!pendingResult) return;
  const result = pendingResult;
  clearPendingResult();
  setStage("できたよ!");
  showResult(result.imageUrl, name || result.monsterName);
}

function clearPendingResult() {
  pendingResult = null;
  if (revealFallbackTimer) clearTimeout(revealFallbackTimer);
  revealFallbackTimer = null;
}

function backToWaitLater() {
  cancelBackToWait();
  backTimer = setTimeout(() => {
    backTimer = null;
    hideNote();
    showView("view-wait");
  }, BACK_TO_WAIT_SECONDS * 1000);
}

function cancelBackToWait() {
  if (backTimer) clearTimeout(backTimer);
  backTimer = null;
}

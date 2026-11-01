// スマホ用ページの処理

const el = (id) => document.getElementById(id);

const VIEWS = ["view-wait", "view-ready", "view-sending", "view-done", "view-progress", "view-error"];

// 表示する画面を切り替える
function showView(id) {
  VIEWS.forEach((v) => el(v).classList.toggle("hidden", v !== id));
}

// ----------------------------------------------------------------------
// 動物のプルダウンを作る
// ----------------------------------------------------------------------
async function loadAnimals() {
  const data = await fetch("/api/animals").then((r) => r.json());
  const select = el("animal");
  data.animals.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
  // 最初から1つ選ばれている状態にする
  select.selectedIndex = 0;
}

// ----------------------------------------------------------------------
// WebSocket(PCからの撮影の合図を受け取る)
// ----------------------------------------------------------------------
function connectWebSocket() {
  const ws = new WebSocket("ws://" + location.host + "/ws?role=phone");

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "capture_request") {
      showView("view-ready");
    } else if (msg.type === "progress") {
      // 生成の進み具合(ローディングと名前えらび。下の showProgress を参照)
      showProgress(msg);
    }
  };

  // 切れたら少し待って入り直す
  ws.onclose = () => setTimeout(connectWebSocket, 2000);
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
    body.append("photo", blob, "photo.jpg");
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
connectWebSocket();

// ----------------------------------------------------------------------
// 生成中のローディングと、名前えらび
// ----------------------------------------------------------------------
// PCで「つくる!」が押されると、サーバーから進み具合(progress)が届く。
//   naming :なまえを かんがえているよ
//   drawing:え を かいているよ(このとき名前の候補も届くので、名前えらびを出す)
//   done   :できたよ!(モンスターの絵を見せる。まだ名前を選んでいなければ、少し待ってから今の名前に決める)
//   retake / error:とりなおし・しっぱい
const AUTO_DECIDE_SECONDS = 20;   // できてから、この秒数たっても選ばなければ、今の名前に決める
const BACK_TO_WAIT_SECONDS = 6;   // 名前が決まってから、待機中に戻るまでの秒数

let nameChoices = [];
let nameIndex = 0;
let namePhotoId = "";
let nameDecided = false;
let barTimer = null;
let autoDecideTimer = null;

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

function isShowingResult() { return !el("ph-result").classList.contains("hidden"); }

function showProgress(msg) {
  const stage = msg.stage;

  if (stage === "naming") {
    resetNameChooser();
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
      if (ratio >= 0.7) setStage("もうすぐ!");
    }, 500);
    // 名前えらびを出す
    nameChoices = msg.name_choices || (msg.monster_name ? [msg.monster_name] : []);
    namePhotoId = msg.photo_id || "";
    nameIndex = 0;
    if (nameChoices.length) {
      showName();
      el("name-chooser").classList.remove("hidden");
    }

  } else if (stage === "done") {
    stopBarTimer();
    setBar(100);
    if (msg.image_url) {
      setStage("できたよ!");
      showResult(msg.image_url, nameDecided || !nameChoices.length ? msg.monster_name : nameChoices[nameIndex]);
    } else {
      setStage("できたよ!<br>おおきい がめんを みてね");
    }
    if (nameDecided || !nameChoices.length) {
      if (!isShowingResult()) backToWaitLater();
    } else {
      // しばらく選ばなければ、今出ている名前に決める
      autoDecideTimer = setTimeout(decideName, AUTO_DECIDE_SECONDS * 1000);
    }

  } else if (stage === "retake") {
    stopBarTimer();
    showView("view-progress");
    resetNameChooser();
    hideResult();
    setStage("もういちど<br>とってね");
    el("ph-name-decided").textContent = msg.reason || "";
    el("ph-name-decided").classList.remove("hidden");
    setTimeout(() => showView("view-wait"), BACK_TO_WAIT_SECONDS * 1000);

  } else if (stage === "error") {
    stopBarTimer();
    resetNameChooser();
    hideResult();
    setStage("うまく できなかったよ…");
    setTimeout(() => showView("view-wait"), BACK_TO_WAIT_SECONDS * 1000);
  }
}

function showName() {
  el("ph-name").textContent = nameChoices[nameIndex];
  el("ph-name").classList.remove("ph-name-pop");
  void el("ph-name").offsetWidth;
  el("ph-name").classList.add("ph-name-pop");
  el("ph-name-count").textContent = nameChoices.length > 1
    ? "(" + (nameIndex + 1) + " / " + nameChoices.length + ")" : "";
  // 候補が1つしかないときは「ほかに さがす」を出さない
  el("btn-name-next").classList.toggle("hidden", nameChoices.length <= 1);
  // 絵ができていれば、絵の上の名前も今の候補にそろえる
  if (isShowingResult()) el("ph-result-name").textContent = nameChoices[nameIndex];
}

function resetNameChooser() {
  nameChoices = [];
  nameIndex = 0;
  nameDecided = false;
  if (autoDecideTimer) clearTimeout(autoDecideTimer);
  autoDecideTimer = null;
  el("name-chooser").classList.add("hidden");
  el("ph-name-decided").classList.add("hidden");
  el("btn-name-ok").disabled = false;
  el("btn-name-next").disabled = false;
}

// 「ほかに さがす」:次の候補を見せる(最後まで行ったら最初に戻る)
el("btn-name-next").addEventListener("click", () => {
  if (!nameChoices.length) return;
  nameIndex = (nameIndex + 1) % nameChoices.length;
  showName();
});

// 「この なまえに する!」
el("btn-name-ok").addEventListener("click", decideName);

async function decideName() {
  if (nameDecided || !nameChoices.length) return;
  nameDecided = true;
  if (autoDecideTimer) clearTimeout(autoDecideTimer);
  el("btn-name-ok").disabled = true;
  el("btn-name-next").disabled = true;

  const name = nameChoices[nameIndex];
  const body = new FormData();
  body.append("photo_id", namePhotoId);
  body.append("name", name);
  try {
    await fetch("/api/choose-name", { method: "POST", body });
  } catch (e) {
    // 送れなくても、ゲームは止めない(最初の名前のまま進む)
  }
  el("name-chooser").classList.add("hidden");
  el("ph-name-decided").textContent = "「" + name + "」に けってい!";
  el("ph-name-decided").classList.remove("hidden");

  // もう絵ができていれば、絵の上の名前を決めた名前にする(絵を見せたまま、待機中には戻さない)
  if (isShowingResult()) {
    el("ph-result-name").textContent = name;
  } else if (el("ph-bar-fill").style.width === "100%") {
    backToWaitLater();
  }
}

function backToWaitLater() {
  setTimeout(() => {
    resetNameChooser();
    showView("view-wait");
  }, BACK_TO_WAIT_SECONDS * 1000);
}

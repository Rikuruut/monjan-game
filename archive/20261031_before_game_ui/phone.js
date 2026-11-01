// スマホ用ページの処理

const el = (id) => document.getElementById(id);

const VIEWS = ["view-wait", "view-ready", "view-sending", "view-done", "view-error"];

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
    // 数秒後に待機中に戻る
    setTimeout(() => showView("view-wait"), 3000);

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

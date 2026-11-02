// PC用ページの処理

const el = (id) => document.getElementById(id);

let currentPhotoId = null;   // 届いている写真のID
let currentAnimal = "";      // スマホで選ばれた動物
let phoneConnected = false;  // スマホの接続状態

// ----------------------------------------------------------------------
// 画面の更新
// ----------------------------------------------------------------------
function setPhoneStatus(connected) {
  phoneConnected = connected;
  const s = el("phone-status");
  s.textContent = connected ? "接続中" : "未接続";
  s.className = "status " + (connected ? "status-on" : "status-off");
  el("btn-capture").disabled = !connected;
}

function showError(message) {
  el("error-msg").textContent = message || "";
}

// ----------------------------------------------------------------------
// 起動時の読み込み
// ----------------------------------------------------------------------
async function loadInfo() {
  // スマホ用URLと接続状態
  // (動物はスマホ側でえらぶので、PCでは一覧を読み込まない)
  const info = await fetch("/api/info").then((r) => r.json());
  el("phone-url").textContent = info.phone_url;
  setPhoneStatus(info.phone_connected);
}

// ----------------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------------
function connectWebSocket() {
  const ws = new WebSocket("ws://" + location.host + "/ws?role=pc");

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "phone_status") {
      setPhoneStatus(msg.connected);

    } else if (msg.type === "progress") {
      // 生成の進み具合(ローディングの表示。下の showLoading を参照)
      showLoading(msg.stage, msg);

    } else if (msg.type === "photo_received") {
      // 写真と、スマホで選ばれた動物が届いた
      currentPhotoId = msg.photo_id;
      currentAnimal = msg.animal || "";
      // キャッシュ回避のため時刻を付ける
      el("photo").src = msg.photo_url + "?t=" + Date.now();
      el("animal-name").textContent = currentAnimal || "(不明)";
      el("photo-id").textContent = "photo_id: " + msg.photo_id;
      el("btn-generate").disabled = false;
      el("capture-msg").textContent = "写真が届きました";
      showError("");
      el("result-area").classList.add("hidden");
    }
  };

  // 切れたら少し待って入り直す
  ws.onclose = () => {
    setPhoneStatus(false);
    setTimeout(connectWebSocket, 2000);
  };
}

// ----------------------------------------------------------------------
// ボタンの処理
// ----------------------------------------------------------------------
el("btn-capture").addEventListener("click", async () => {
  showError("");
  el("capture-msg").textContent = "スマホに合図を送っています...";

  try {
    const res = await fetch("/api/capture-request", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      el("capture-msg").textContent = "スマホで動物をえらんで「とる!」を押してください";
    } else {
      el("capture-msg").textContent = "";
      showError(data.error || "合図を送れませんでした");
    }
  } catch (e) {
    el("capture-msg").textContent = "";
    showError("通信に失敗しました: " + e.message);
  }
});

el("btn-generate").addEventListener("click", async () => {
  if (!currentPhotoId) return;

  showError("");
  el("btn-generate").disabled = true;
  el("generate-msg").textContent = "生成中です...(しばらくかかります)";
  // ローディングを出す(サーバーからの知らせより先に出しておく)
  showLoading("naming", {});

  // 動物はサーバー側が photo_id に紐づけて覚えているので送らない
  const body = new FormData();
  body.append("photo_id", currentPhotoId);

  try {
    const res = await fetch("/api/generate", { method: "POST", body });
    const data = await res.json();
    el("generate-msg").textContent = "";

    // 撮り直し・失敗のときはローディングを消す(成功のときは「done」の知らせで消える)
    if (!data.ok || data.needs_retake) hideLoading();

    if (!data.ok) {
      // どの処理で失敗したかも出す
      showError((data.step ? "【" + data.step + "】で失敗\n" : "") +
                (data.error || "生成に失敗しました"));
      // 判定まで進んでいれば、その内容も見せる
      if (data.monster) showResult(data);
    } else {
      showResult(data);
    }
  } catch (e) {
    el("generate-msg").textContent = "";
    hideLoading();
    showError("通信に失敗しました: " + e.message);
  } finally {
    el("btn-generate").disabled = false;
  }
});

// ----------------------------------------------------------------------
// 結果の表示(中身は段階5でそろう)
// ----------------------------------------------------------------------
function showResult(data) {
  el("result-area").classList.remove("hidden");
  el("result-json").textContent = JSON.stringify(data.monster || {}, null, 2);

  // 撮り直しの判定が出たとき
  const retake = el("retake-msg");
  if (data.needs_retake) {
    retake.textContent = "撮り直しが必要です:" + (data.retake_reason || "");
    retake.classList.remove("hidden");
  } else {
    retake.textContent = "";
    retake.classList.add("hidden");
  }

  // 値を補正したところがあれば出す(検証用)
  const allNotes = (data.validator_notes || []).concat(data.generator_notes || []);
  const notesEl = el("notes");
  notesEl.innerHTML = "";
  allNotes.forEach((n) => {
    const li = document.createElement("li");
    li.textContent = n;
    notesEl.appendChild(li);
  });
  el("notes-area").classList.toggle("hidden", allNotes.length === 0);

  // モンスター画像(撮り直しや失敗のときは出さない)
  if (data.monster_url) {
    el("monster").src = data.monster_url + "?t=" + Date.now();
    el("monster").classList.remove("hidden");
  } else {
    el("monster").removeAttribute("src");
    el("monster").classList.add("hidden");
  }

  // APIの使用量と料金の試算
  showUsage(data.usage);

  // 保存先のフォルダ
  el("output-dir").textContent = data.output_dir ? "保存先: outputs/" + data.output_dir : "";

  const t = data.timings || {};
  el("timings").innerHTML = "";
  [["判定", t.recognize], ["画像生成", t.generate], ["合計", t.total]].forEach((pair) => {
    const label = pair[0], sec = pair[1];
    if (sec === undefined || sec === null) return;
    const li = document.createElement("li");
    li.textContent = label + ": " + Number(sec).toFixed(1) + " 秒";
    el("timings").appendChild(li);
  });

  const s = data.settings || {};
  el("settings").innerHTML = "";
  [["動物", s.animal], ["判定モデル", s.text_model],
   ["画像生成モデル", s.image_model], ["画質", s.image_quality],
   ["画像サイズ", s.image_size],
   ["画像プロンプト", s.image_prompt_style === "simple" ? "短い(simple)"
     : s.image_prompt_style ? "詳しい(detailed)" : ""],
   // 物を取り込む場所のパターン(短いプロンプトで使う)
   ["取り込む場所", s.image_prompt_style === "simple"
     ? ((data.monster || {}).design_plan || {}).fusion_part_label : ""],
   // ポーズ・視点・表情(短いプロンプトで使う。時間帯・天気は使わない)
   ["ポーズ", s.image_prompt_style === "simple" ? (function () {
     const st = ((data.monster || {}).design_plan || {}).staging || {};
     return [st.pose, st.view, st.expression].filter(Boolean).join(" / ");
   })() : ""]].forEach((pair) => {
    const label = pair[0], v = pair[1];
    if (!v) return;
    const li = document.createElement("li");
    li.textContent = label + ": " + v;
    el("settings").appendChild(li);
  });
}

// ----------------------------------------------------------------------
// APIの使用量と料金の試算を出す
// ----------------------------------------------------------------------
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
    const cost = u.estimated_cost_usd;
    const yen = cost === null || cost === undefined ? "" :
                "  →  $" + cost.toFixed(4) + "(およそ " + (cost * 150).toFixed(1) + "円)";
    add(label + ": " + u.total_tokens + " トークン" +
        "(入力 " + (u.input_tokens || 0) + " / 出力 " + (u.output_tokens || 0) + ")" + yen);
  };

  line("判定", usage.recognize);
  line("画像生成", usage.generate);

  if (usage.total_cost_usd !== null && usage.total_cost_usd !== undefined) {
    add("この1回の合計: $" + usage.total_cost_usd.toFixed(4) +
        "(およそ " + usage.total_cost_yen.toFixed(1) + "円)");
  }
  if (usage.cumulative_cost_usd !== undefined) {
    add("これまでの累計: $" + usage.cumulative_cost_usd.toFixed(4) +
        "(およそ " + usage.cumulative_cost_yen.toFixed(1) + "円)");
  }
  if (usage.note) add(usage.note);
}

// ----------------------------------------------------------------------
loadInfo().catch((e) => showError("初期化に失敗しました: " + e.message));
connectWebSocket();

// ----------------------------------------------------------------------
// 7. 名前のテスト(写真も画像生成も使わず、モンスター名だけを何回か作る)
// ----------------------------------------------------------------------
(async function setupNameTest() {
  // 動物の一覧はスマホのプルダウンと同じものを使う
  try {
    const data = await fetch("/api/animals").then((r) => r.json());
    data.animals.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      el("nt-animal").appendChild(opt);
    });
  } catch (e) {
    el("nt-msg").textContent = "動物の一覧を読めませんでした: " + e;
  }
})();

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
      if (run.error) {
        cells.push("(失敗)", run.error, "");
      } else {
        cells.push(
          run.name,
          (run.candidates || []).map((c) => (c.ok ? c.name : "× " + c.name + "(" + c.reason + ")")).join(" / "),
          run.fusion_place || ""
        );
      }
      cells.forEach((text, j) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (j === 1) td.style.fontWeight = "bold";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    el("nt-table").classList.remove("hidden");

    let msg = data.animal + " × " + data.object_name + " を " + data.runs.length + " 回作りました。"
      + " 料金(試算):約 " + data.total_cost_yen + " 円";
    if (data.cumulative_cost_yen != null) msg += "(これまでの累計 約 " + data.cumulative_cost_yen + " 円)";
    el("nt-msg").textContent = msg;
  } catch (e) {
    el("nt-msg").textContent = "名前のテストに失敗しました: " + e.message;
  } finally {
    el("btn-name-test").disabled = false;
  }
});

// ----------------------------------------------------------------------
// ローディング(生成のあいだ、今の段階を見せる)
// ----------------------------------------------------------------------
// サーバーから WebSocket で届く段階(naming → drawing → done)に合わせて表示する。
// 「もうすぐ!」は、画像生成にかかる時間の目安(サーバーが前回の実測を送ってくる)の7割を過ぎたら切り替える。
// 本番の大きい画面のローディング(ゲーム説明つき)のたたき台。
const LOADING_STEPS = ["naming", "drawing", "soon"];
const SOON_RATIO = 0.7;
let loadingTimer = null;

function setLoadingStep(step) {
  const index = LOADING_STEPS.indexOf(step);
  LOADING_STEPS.forEach((name, i) => {
    const li = el("step-" + name);
    li.classList.toggle("done", i < index);
    li.classList.toggle("active", i === index);
  });
}

function setLoadingBar(percent) {
  el("loading-bar-fill").style.width = Math.max(0, Math.min(100, percent)) + "%";
}

function stopLoadingTimer() {
  if (loadingTimer) clearInterval(loadingTimer);
  loadingTimer = null;
}

function showLoading(stage, msg) {
  el("loading").classList.remove("hidden");

  if (stage === "naming") {
    stopLoadingTimer();
    setLoadingStep("naming");
    setLoadingBar(10);
    el("loading-sub").textContent = "";

  } else if (stage === "drawing") {
    // 判定が終わった:名前が決まったので、ちょっとだけ見せる
    setLoadingStep("drawing");
    el("loading-sub").textContent = msg.monster_name ? "なまえは「" + msg.monster_name + "」に きまったよ!" : "";
    const expected = Math.max(5, msg.expected_seconds || 30);
    const started = Date.now();
    stopLoadingTimer();
    loadingTimer = setInterval(() => {
      const ratio = (Date.now() - started) / 1000 / expected;
      // 判定までで 30%、画像生成で残りを進める(目安を過ぎても 95% で止める)
      setLoadingBar(30 + Math.min(ratio, 1) * 65);
      if (ratio >= SOON_RATIO) setLoadingStep("soon");
    }, 500);

  } else if (stage === "done") {
    stopLoadingTimer();
    LOADING_STEPS.forEach((name) => {
      el("step-" + name).classList.add("done");
      el("step-" + name).classList.remove("active");
    });
    setLoadingBar(100);
    // 結果が出たら、少し見せてから消す
    setTimeout(hideLoading, 1200);

  } else if (stage === "retake" || stage === "error") {
    hideLoading();
  }
}

function hideLoading() {
  stopLoadingTimer();
  el("loading").classList.add("hidden");
  setLoadingBar(0);
}

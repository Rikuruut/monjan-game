// モンじゃん! 大画面の開発者メニュー・見本の表示・テストプレイ・通しの自動プレイ
//
// core.js のあとに読む。開発者メニューの HTML は、どのテーマでも同じものをこのファイルが画面に足す。
// ここの操作は「名前のテスト」のほか API を使わない(見本のデータ:ゴリラ × はさみ)。

document.body.insertAdjacentHTML("beforeend", `
<button id="dev-toggle" class="dev-toggle" title="開発者メニュー(D キー)" aria-label="開発者メニュー">⚙</button>
<aside id="dev" class="dev" aria-label="開発者メニュー" hidden>
  <div class="dev-top">
    <header class="dev-head">
      <strong>開発者メニュー <small>撮影・合体</small></strong>
      <button id="dev-close" class="dev-close" aria-label="とじる" title="とじる(D キー)">×</button>
    </header>
    <nav class="dev-tabs" role="tablist" aria-label="開発者メニューのタブ">
      <button role="tab" data-dev-tab="common">よく使う</button>
      <button role="tab" data-dev-tab="fx">演出を見る</button>
      <button role="tab" data-dev-tab="result" id="dev-tab-result">前回の結果</button>
      <button role="tab" data-dev-tab="phone">スマホ</button>
      <button role="tab" data-dev-tab="names">名前のテスト</button>
    </nav>
  </div>

  <div class="dev-panel" role="tabpanel" data-dev-panel="common">
    <section>
      <h4>ページを開く <span class="dev-badge dev-free">無料</span></h4>
      <p class="dev-desc">そのページへ移ります。</p>
      <p class="dev-row">
        <button class="dev-link" data-dev-page="/battle/" title="バトルのタイトル画面(会場で最初に出る画面)">タイトル</button>
        <button class="dev-link" data-dev-page="/" title="撮影・合体の画面を最初から">撮影</button>
        <button class="dev-link" data-dev-page="/?autotest=1" title="見本のゴリラ × はさみで、がったいから誕生まで自動で流す">テストプレイ</button>
        <button class="dev-link" data-dev-page="/battle/?play=demo" title="見本のゴリラ × はさみで、バトルのルール説明から">見本でバトル</button>
      </p>
    </section>
    <section>
      <h4>通しの自動プレイ <span class="dev-badge dev-free">無料</span></h4>
      <p class="dev-desc">タイトル → テストプレイ → バトル(手はランダム)→ 結果 → タイトル を、止めるまでくり返します。展示前の耐久テスト用。メニューを開いているあいだは止まります。</p>
      <p class="dev-row">
        <button id="dev-autoplay" class="dev-primary"></button>
        <span id="dev-autoplay-state" class="dev-state"></span>
      </p>
    </section>
    <section>
      <h4>作ったモンスターで戦う</h4>
      <p class="dev-desc">outputs/ の新しい順に30件。行を押すとそのモンスターでバトルへ。「カード」はカードを重ねて見る、「PDF」は outputs/ に card.pdf を残します(約8秒)。</p>
      <ul id="dev-monsters" class="dev-monsters"></ul>
      <p id="dev-monsters-msg" class="dev-muted"></p>
    </section>
  </div>

  <div class="dev-panel" role="tabpanel" data-dev-panel="fx" hidden>
    <p class="dev-note">ここの操作はすべて <b>API を使いません(無料)</b>。見本のデータ(ゴリラ × はさみ)で場面や演出を動かします。</p>
    <section>
      <h4>テストプレイ</h4>
      <p class="dev-desc">「がったい!」から誕生後まで通しで流します(がったい中 約25秒)。メニューは閉じます。</p>
      <p class="dev-row">
        <button id="demo-testplay" class="dev-primary">▶ テストプレイ</button>
        <button id="demo-reset" title="撮影まちの最初の状態に戻す">はじめに もどす</button>
      </p>
    </section>
    <section>
      <h4>場面へとぶ</h4>
      <p class="dev-row">
        <button data-demo-scene="s1" title="しゃしんを とろう">s1 撮影まち</button>
        <button data-demo-scene="s2" title="しゃしん × どうぶつ = ?">s2 写真がとどいた</button>
        <button data-demo-scene="s3" title="うずの中で合体中(下の「進み具合」で止める位置を決める)">s3 がったい中</button>
        <button data-demo-scene="s4" title="モンスターのカードが出たところ">s4 たんじょう</button>
      </p>
      <p class="dev-row dev-field"><span class="dev-label">s3 の進み具合</span>
        <input id="demo-progress" type="range" min="0" max="1" step="0.05" value="0.55" title="動かすと s3 になり、その進み具合で止まる">
        <span id="demo-progress-value" class="dev-state">0.55</span>
      </p>
    </section>
    <section>
      <h4>演出を流す</h4>
      <p class="dev-row">
        <button id="demo-birth" title="割れる直前から、誕生の演出を最後まで">誕生の演出</button>
        <button id="demo-partial" title="がったい中のうずの中心に出る、途中の絵(押すたびに 1枚目 → 2枚目)">途中の絵(がったい中)</button>
        <button id="demo-name" title="スマホで名前が選ばれたときの動き(押すたびに次の候補)">名前が選ばれた</button>
        <button id="demo-retake" title="人が写っていたときの「もういちど とってね」">撮り直しの表示</button>
      </p>
    </section>
    <section>
      <h4>カード</h4>
      <p class="dev-desc">いまのモンスターのカード(テストプレイ・見本なら ゴリラ × はさみ)。</p>
      <p class="dev-row">
        <button id="dev-card-open" title="カードを画面に重ねて見る">カードを見る</button>
        <button id="dev-card-print" title="誕生の「いんさつ」と同じ。プリンターに送る">いんさつ</button>
      </p>
    </section>
    <section>
      <h4>音</h4>
      <p class="dev-row dev-field"><span class="dev-label">効果音</span>
        <button data-demo-sfx="press" title="press">ボタン</button>
        <button data-demo-sfx="tick" title="tick">段が上がる</button>
        <button data-demo-sfx="crack" title="crack">割れる</button>
        <button data-demo-sfx="fanfare" title="fanfare">誕生</button>
      </p>
      <p class="dev-row dev-field"><span class="dev-label">がったい中の BGM</span>
        <span id="fusion-bgm-choices" class="dev-row"></span>
      </p>
      <p class="dev-desc">BGM は s3(がったい中)で流れます。選んだものは次のがったいから使います。</p>
    </section>
    <section>
      <h4>テーマ</h4>
      <p class="dev-desc">画面の見た目。変えるとページを読み直します。</p>
      <p><select id="theme-select"></select></p>
    </section>
  </div>

  <div class="dev-panel" role="tabpanel" data-dev-panel="result" hidden>
    <p class="dev-note">いちばん最近の「がったい!」の記録です(このページを開いてから)。</p>
    <p id="error-msg" class="dev-error"></p>
    <section>
      <h4>かかった時間</h4>
      <ul id="timings"></ul>
    </section>
    <section>
      <h4>使った設定</h4>
      <ul id="settings"></ul>
    </section>
    <section>
      <h4>API の使用量と料金(試算)</h4>
      <ul id="usage"></ul>
      <p id="output-dir" class="dev-muted"></p>
    </section>
    <section>
      <h4>判定結果(JSON)</h4>
      <pre id="result-json"></pre>
      <div id="notes-area" hidden>
        <h4>チェックで直したところ</h4>
        <ul id="notes"></ul>
      </div>
    </section>
  </div>

  <div class="dev-panel" role="tabpanel" data-dev-panel="phone" hidden>
    <section>
      <h4>スマホとの接続</h4>
      <p class="dev-desc">スマホで下の URL を開くか、QR コードを読みます(同じ Wi-Fi)。</p>
      <p>接続:<span id="phone-status" class="status status-off">未接続</span></p>
      <p><code id="phone-url">読み込み中...</code></p>
      <img id="qr" src="/api/qr" alt="QRコード" width="160" height="160">
    </section>
  </div>

  <div class="dev-panel" role="tabpanel" data-dev-panel="names" hidden>
    <section>
      <h4>名前のテスト <span class="dev-badge dev-paid">API 有料・1回 0.1円以下</span></h4>
      <p class="dev-desc">動物と物の名前だけから、モンスター名を何回か作ります(写真・画像生成なし)。結果は outputs/name_tests.jsonl にも残ります。</p>
      <p class="nt-form">
        <label>動物 <select id="nt-animal"></select></label>
        <label>物 <input id="nt-object" type="text" value="はさみ" maxlength="30"></label>
        <label>回数 <input id="nt-count" type="number" value="5" min="1" max="10"></label>
        <button id="btn-name-test" class="dev-primary">名前を作る</button>
      </p>
      <p id="nt-msg" class="dev-muted"></p>
      <table id="nt-table" hidden>
        <thead><tr><th>回</th><th>採用</th><th>候補(× は使わなかったもの)</th><th>場所</th></tr></thead>
        <tbody></tbody>
      </table>
    </section>
  </div>
</aside>`);

// localStorage・sessionStorage は、使えないとき(プライベートモードなど)に例外になるので、まとめて受け止める
function safely(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

// 開発者メニューのタブ。最後に開いたタブを覚えておく(読めなければ「よく使う」)
const DEV_TAB_KEY = "monjan-dev-tab-generator";
function showDevTab(name) {
  const tabs = [...document.querySelectorAll("[data-dev-tab]")];
  if (!tabs.some((t) => t.dataset.devTab === name)) name = "common";
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.devTab === name)));
  document.querySelectorAll("[data-dev-panel]").forEach((p) => { p.hidden = p.dataset.devPanel !== name; });
  if (name === "result") el("dev-tab-result").classList.remove("dev-tab-alert");
  safely(() => localStorage.setItem(DEV_TAB_KEY, name));   // 覚えられなくても動く
}
document.querySelectorAll("[data-dev-tab]").forEach((t) => t.addEventListener("click", () => showDevTab(t.dataset.devTab)));
showDevTab(safely(() => localStorage.getItem(DEV_TAB_KEY), null));

// テーマの切りかえ(開発者メニューから)
async function loadThemes() {
  try {
    const data = await fetchJson("/api/themes");
    const select = el("theme-select");
    addOptions(select, data.themes.map((t) => ({
      value: t.id, text: t.name + "(" + t.id + ")", selected: t.id === document.documentElement.dataset.theme,
    })));
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
  if (!dev.hidden) loadRecentMonsters();   // 作ったモンスターの一覧は、開くたびに読み直す
}
el("dev-toggle").addEventListener("click", () => toggleDev());
el("dev-close").addEventListener("click", () => toggleDev(false));

function showDevError(message) {
  el("error-msg").textContent = message || "";
  // エラーは「前回の結果」タブにある。ほかのタブを見ていても気づけるよう、タブに赤い点を付ける
  const tab = el("dev-tab-result");
  const showing = tab.getAttribute("aria-selected") === "true" && !el("dev").hidden;
  tab.classList.toggle("dev-tab-alert", Boolean(message) && !showing);
}

function showDevResult(data) {
  showDevError("");
  el("result-json").textContent = JSON.stringify(data.monster || {}, null, 2);

  const allNotes = (data.validator_notes || []).concat(data.generator_notes || []);
  fillList(el("notes"), allNotes);
  el("notes-area").hidden = allNotes.length === 0;

  showUsage(data.usage);
  el("output-dir").textContent = data.output_dir ? "保存先: outputs/" + data.output_dir : "";

  const t = data.timings || {};
  fillList(el("timings"), [["判定", t.recognize], ["判定(物の名前・撮り直し)", t.check], ["名前・説明", t.describe],
                          ["画像生成", t.generate], ["合計", t.total]]
    .filter(([, sec]) => sec !== undefined && sec !== null)
    .map(([label, sec]) => label + ": " + Number(sec).toFixed(1) + " 秒"));

  const s = data.settings || {};
  const dp = (data.monster || {}).design_plan || {};
  const st = dp.staging || {};
  fillList(el("settings"), [["動物", s.animal], ["判定モデル", s.text_model],
   ["画像生成モデル", s.image_model], ["画質", s.image_quality],
   ["画像サイズ", s.image_size],
   ["画像プロンプト", s.image_prompt_style === "simple" ? "短い(simple)" : s.image_prompt_style ? "詳しい(detailed)" : ""],
   ["取り込む場所", s.image_prompt_style === "simple" ? dp.fusion_part_label : ""],
   ["ポーズ", s.image_prompt_style === "simple" ? [st.pose, st.view, st.expression].filter(Boolean).join(" / ") : ""],
   ["背景", s.image_prompt_style === "simple" && dp.background_place ? [st.scene, dp.background_place].filter(Boolean).join("の") : ""],
  ].filter(([, v]) => v).map(([label, v]) => label + ": " + v));
}

function showUsage(usage) {
  const lines = [];
  const add = (text) => lines.push(text);
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
  if (!usage) {
    fillList(el("usage"), lines);
    return;
  }
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
  fillList(el("usage"), lines);
}

// 名前のテスト(写真も画像生成も使わず、モンスター名だけを何回か作る)
el("btn-name-test").addEventListener("click", async () => {
  el("btn-name-test").disabled = true;
  el("nt-msg").textContent = "名前を作っています…";
  const tbody = el("nt-table").querySelector("tbody");
  tbody.innerHTML = "";
  try {
    const res = await postForm("/api/name-test", {
      animal: el("nt-animal").value, object_name: el("nt-object").value, count: el("nt-count").value,
    });
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
    monster: { monster_name: demoName(), element: "風", object_name: "はさみ",
               description: "はさみの つのを ふりかざし、なんでも きりひらく ちからもち。" },
    settings: { animal: state.animal },
    monster_url: params.get("img") || DEMO_IMG,
  };
}

// 見本のデータで、その場面を表示する。progress は s3 の進み具合(0〜1)
function showDemo(scene, { progress = 0.55 } = {}) {
  cancelRunning();
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
    showProgressAt(progress);
    setNameChoices([demoName(), ...DEMO_OTHER_NAMES]);
    el("demo-progress").value = progress;
    el("demo-progress-value").textContent = Number(progress).toFixed(2);
  }
  if (scene === "s4") fillCard(demoSample());
}

// 誕生の演出を、がったいの終わり(進み具合 1)から誕生後(カードと名前が出た所)まで流す。
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

// onDone:誕生の演出が終わったら呼ぶ(通しの自動プレイで、そのあと「たたかう!」へ進むため)
function playTestRun(onDone) {
  // s2(しゃしん × どうぶつ)から始める
  showDemo("s2");
  const photoId = "testplay";
  const names = [demoName(), ...DEMO_OTHER_NAMES];
  const img = params.get("img") || DEMO_IMG;
  const draw = TEST_PLAY_DRAW_SECONDS;
  const run = testPlayRun;

  // 1.5秒後に「がったい!」を押したことにする
  afterSeconds(1.5, async () => {
    flashButton("center");
    await beginFusion();
    if (run !== testPlayRun) return;   // 場面の切りかえ中に止められた
    // すぐ要る判定(3秒)→ 画像生成を始める
    afterSeconds(3, () => onProgress({ stage: "drawing", expected_seconds: draw, photo_id: photoId }));
    // 名前・説明は、画像生成と同時に作られて先に届く
    afterSeconds(3 + 5, () => onProgress({ stage: "names", name_choices: names, monster_name: names[0], photo_id: photoId }));
    // 途中の絵(うずの中心に透けて見える)
    afterSeconds(3 + draw * 0.4, () => onProgress({ stage: "partial", image_url: img, index: 1, total: 2, photo_id: photoId }));
    afterSeconds(3 + draw * 0.75, () => onProgress({ stage: "partial", image_url: img, index: 2, total: 2, photo_id: photoId }));
    // 子供がスマホで名前を選んだことにする(2つ目の候補)
    afterSeconds(3 + draw * 0.55, () => onNameChosen({ name: names[1] }));
    // できあがり → 誕生
    afterSeconds(3 + draw, () => {
      onProgress({ stage: "done", photo_id: photoId, image_url: img });
      birth(demoSample()).then(() => { if (run === testPlayRun && onDone) onDone(); });
    });
  });
}

// 開発者メニューの「演出を見る」
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
  else showProgressAt(value);
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
  // 途中の絵を、見本の絵で 1枚目 → 2枚目 → 1枚目… と進める(#partial-img のあるテーマだけ見える)
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
el("dev-card-open").addEventListener("click", () => showCardPreview(cardId()));
el("dev-card-print").addEventListener("click", printCard);
document.querySelectorAll("[data-demo-sfx]").forEach((btn) => {
  btn.addEventListener("click", () => sound(btn.dataset.demoSfx));
});

// がったい中の BGM を選ぶ(1〜3・なし)。選んでいるものを太字にする
function renderFusionBgmChoices() {
  const box = el("fusion-bgm-choices");
  if (!window.sfx || !window.sfx.fusionBgmNumbers) return;
  box.replaceChildren();
  const current = window.sfx.getFusionBgm();
  [...window.sfx.fusionBgmNumbers, 0].forEach((number) => {
    const btn = document.createElement("button");
    btn.textContent = number ? "曲" + number : "なし";
    btn.title = number ? "sounds/fusion" + number + ".mp3" : "がったい中も いつもの BGM";
    btn.setAttribute("aria-pressed", String(number === current));
    btn.addEventListener("click", () => {
      window.sfx.setFusionBgm(number);
      renderFusionBgmChoices();
    });
    box.appendChild(btn);
  });
}
renderFusionBgmChoices();

// ----------------------------------------------------------------------
// 開発者メニューの共通の項目(バトルの開発者メニュー battle/src/DevMenu.tsx と同じ中身)
// ----------------------------------------------------------------------
document.querySelectorAll("[data-dev-page]").forEach((btn) => {
  btn.addEventListener("click", () => { location.href = btn.dataset.devPage; });
});

// 通しの自動プレイ。/ と /battle/ で sessionStorage を共有して受け渡す(battle/src/devTools.ts と同じ形)
const AUTOPLAY_KEY = "monjan-autoplay";
const AUTOPLAY_BATTLE_DELAY_MS = 3000;   // 誕生のあと、「たたかう!」を押すまで

function readAutoplay() {
  return safely(() => {
    const value = JSON.parse(sessionStorage.getItem(AUTOPLAY_KEY) || "null");
    return value && value.on === true ? { on: true, loops: Number(value.loops) || 0 } : { on: false, loops: 0 };
  }, { on: false, loops: 0 });
}

function writeAutoplay(autoplay) {
  // 保存できなくても、このページの中では動く
  safely(() => {
    if (autoplay.on) sessionStorage.setItem(AUTOPLAY_KEY, JSON.stringify(autoplay));
    else sessionStorage.removeItem(AUTOPLAY_KEY);
  });
  showAutoplay();
}

function showAutoplay() {
  const a = readAutoplay();
  el("dev-autoplay").innerHTML = a.on ? "■ 停止" : "<strong>▶ 開始</strong>";
  el("dev-autoplay-state").textContent = a.on ? "動いています(" + a.loops + "周)" : "止まっています";
  let badge = el("dev-autoplay-badge");
  if (a.on && !badge) {
    document.body.insertAdjacentHTML("beforeend", '<p id="dev-autoplay-badge" class="dev-autoplay-badge"></p>');
    badge = el("dev-autoplay-badge");
  }
  if (badge) {
    badge.hidden = !a.on;
    badge.textContent = "自動プレイ中 " + a.loops + "周(D でメニュー → 停止)";
  }
}

// テストプレイを流し、誕生が終わったら少し待って「たたかう!」へ(止められていたら進まない)
function runAutoplayStep() {
  playTestRun(() => setTimeout(() => { if (readAutoplay().on) goBattle(); }, AUTOPLAY_BATTLE_DELAY_MS));
}

el("dev-autoplay").addEventListener("click", () => {
  const on = !readAutoplay().on;
  writeAutoplay({ on, loops: 0 });
  if (on) {
    toggleDev(false);
    runAutoplayStep();
  } else {
    stopTestPlay();
  }
});

// 作ったモンスターで戦う(outputs/ に残っている絵から選ぶ)。メニューを開くたびに読み直す
async function loadRecentMonsters() {
  const list = el("dev-monsters");
  const msg = el("dev-monsters-msg");
  try {
    const data = await fetchJson("/api/recent-monsters");
    list.innerHTML = "";
    data.monsters.forEach((m) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      const img = document.createElement("img");
      img.src = m.image;
      img.width = img.height = 56;
      img.loading = "lazy";
      img.alt = "";
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = m.name;
      const sub = document.createElement("small");
      sub.textContent = m.animal + " × " + m.object + "・" + String(m.created_at).replace("T", " ");
      text.append(name, sub);
      btn.append(img, text);
      btn.title = "このモンスターでバトルへ";
      btn.addEventListener("click", () => { location.href = "/battle/?photo=" + encodeURIComponent(m.id); });
      li.appendChild(btn);
      // カード(撮影側だけ。バトルの開発者メニューにはない)
      const cardBtn = document.createElement("button");
      cardBtn.className = "dev-monster-sub";
      cardBtn.textContent = "カード";
      cardBtn.title = "このモンスターのカードを重ねて見る";
      cardBtn.addEventListener("click", () => showCardPreview(m.id));
      const pdfBtn = document.createElement("button");
      pdfBtn.className = "dev-monster-sub";
      pdfBtn.textContent = "PDF を作る";
      pdfBtn.title = "outputs/ のフォルダに card.pdf を残す(約8秒)";
      pdfBtn.addEventListener("click", async () => {
        pdfBtn.disabled = true;
        pdfBtn.textContent = "作っています…";
        const res = await saveCardPdf(m.id);
        pdfBtn.disabled = false;
        pdfBtn.textContent = res && res.ok ? "PDF ✓" : "PDF を作る";
        msg.textContent = res && res.ok
          ? "outputs/" + res.output_dir + "/" + res.file + " に保存しました"
          : "PDF を作れませんでした(" + ((res && res.error) || "?") + ")";
      });
      li.append(cardBtn, pdfBtn);
      list.appendChild(li);
    });
    msg.textContent = data.monsters.length ? "" : "まだ ありません(outputs/ が空)。";
  } catch (e) {
    msg.textContent = "一覧を読めませんでした。";
  }
}

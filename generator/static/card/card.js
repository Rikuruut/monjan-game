// モンスターカードのページ(/card?id=<photo_id か outputs のフォルダ名か demo>)。
//   ?print=1:絵とフォントを読み終えたら印刷する(撮影の画面の「いんさつ」が、見えない iframe で開く)
//   ?name=  :demo のときの名前
// 中身は /api/card-data/<id>(app/card.py の to_card)。載せる項目を変えるときは、そこと card.html を直す
"use strict";

const params = new URLSearchParams(location.search);
// ?embed=1:ほかの画面にはめこむ(バトルのありがとうの画面)。背景なしで、カードを窓いっぱいに
const embed = params.get("embed") === "1";
document.documentElement.classList.toggle("embed", embed);
const cardEl = document.getElementById("card");

// タイプのバッジ:アイコン(撮影の画面 static/common/core.js の ELEMENT_STYLES と同じ)と、子供向けのひらがな
const ELEMENT_LABELS = {
  "火": { icon: "🔥", label: "ほのお" },
  "水": { icon: "💧", label: "みず" },
  "草": { icon: "🌿", label: "くさ" },
  "光": { icon: "✨", label: "ひかり" },
  "闇": { icon: "🌙", label: "やみ" },
  "風": { icon: "🌪️", label: "かぜ" },
  "土": { icon: "🪨", label: "つち" },
  "無": { icon: "⚪", label: "ノーマル" },
};

// ⚔♥ の枠の数(いちばん多いときの数だけ並べ、数だけ「満」にする。こうげきは 1〜3、たいりょくは 3〜5)。
// 文字と見た目は じゃんけんバトルと同じ(battle/src/App.tsx の Swords・Hearts、styles/base.css)
const ATTACK_SLOTS = 3;
const HP_SLOTS = 5;

// 名前の文字の大きさ(mm)。枠に収まるまで小さくする
const NAME_SIZE_MAX = 5;
const NAME_SIZE_MIN = 3;
const NAME_SIZE_STEP = 0.2;

function set(id, text) {
  document.getElementById(id).textContent = text;
}

// ⚔⚔⚔ / ♥♥♥♥♥ を作り、数だけ「満」(.on)にする。色は card.css
function fillIcons(id, glyph, count, slots) {
  const box = document.getElementById(id);
  box.innerHTML = "";
  for (let i = 0; i < slots; i++) {
    const icon = document.createElement("span");
    icon.className = "icon" + (i < count ? " on" : "");
    icon.textContent = glyph;
    box.appendChild(icon);
  }
  box.setAttribute("aria-label", count + " / " + slots);
}

// 名前が枠からはみ出さない大きさにする(フォントを読み終えてから呼ぶ。印刷・PDF も同じ大きさになる)。
// ※ 2026年11月9日:文字数で小さくしていたころ、「ワニタップ」の「プ」の右が切れた
function fitName() {
  const name = document.getElementById("card-name");
  let size = NAME_SIZE_MAX;
  name.style.fontSize = size + "mm";
  // 枠の幅は、名前の要素の幅(バッジの残り)。zoom の影響を受けないよう、要素の中の比で比べる
  while (size > NAME_SIZE_MIN && name.scrollWidth > name.clientWidth + 0.5) {
    size = Math.max(NAME_SIZE_MIN, +(size - NAME_SIZE_STEP).toFixed(2));
    name.style.fontSize = size + "mm";
  }
  return size;
}

// No.(その日に作った順)。4けた。番号のないもの(CPU 用など)は ----
function formatNo(no) {
  return "No." + (Number.isInteger(no) ? String(no).padStart(4, "0") : "----");
}

// 画面で見るときは、カードを窓いっぱいに大きく見せる(印刷は CSS の @media print で実寸)
function fitPreview() {
  const mm = 96 / 25.4;   // 1mm の CSS ピクセル
  const zoom = Math.min(window.innerWidth / (63 * mm), window.innerHeight / (88 * mm)) * (embed ? 1 : 0.9);
  document.documentElement.style.setProperty("--zoom", Math.max(zoom, 1).toFixed(3));
}
window.addEventListener("resize", fitPreview);
fitPreview();

function fill(card) {
  cardEl.dataset.element = card.element;
  const name = document.getElementById("card-name");
  name.textContent = card.name;
  const el = ELEMENT_LABELS[card.element] || { icon: "", label: card.element };
  set("card-element-icon", el.icon);
  set("card-element-label", el.label);
  set("card-recipe", card.animal && card.object ? card.animal + " × " + card.object : "");
  fillIcons("card-attack", "⚔", card.attack, ATTACK_SLOTS);
  fillIcons("card-hp", "♥", card.hp, HP_SLOTS);
  set("card-desc", card.description);
  set("card-no", formatNo(card.no));
}

// 絵が読み終わるのを待つ(読めなくても止めない)
function loadImage(src) {
  const img = document.getElementById("card-img");
  return new Promise((resolve) => {
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}

async function main() {
  const id = params.get("id") || "demo";
  const query = params.get("name") ? "?name=" + encodeURIComponent(params.get("name")) : "";
  try {
    const res = await fetch("/api/card-data/" + encodeURIComponent(id) + query);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.status);
    const card = await res.json();
    fill(card);
    // 絵・ロゴ・フォントを読み終えてから印刷する(ロゴは読めなくても止めない)
    const logo = document.getElementById("card-logo");
    await Promise.all([loadImage(card.image), document.fonts.ready, logo.decode().catch(() => {})]);
    fitName();
    cardEl.dataset.ready = "1";
    if (params.get("print") === "1") window.print();
  } catch (e) {
    const err = document.getElementById("card-error");
    err.hidden = false;
    err.textContent = "カードを つくれませんでした(" + e.message + ")";
  }
}

// 撮影の画面に重ねて見せているときは、カードの中でキーを押しても閉じられるように知らせる(static/common/core.js の showCardPreview)
if (window.parent !== window && params.get("print") !== "1" && !embed) {
  document.addEventListener("keydown", () => window.parent.postMessage("monjan-card-close", location.origin));
}

main();

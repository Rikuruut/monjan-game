// 大画面(core.js・dev.js・boot.js)とスマホ(phone.js)で共通の小さな道具。どちらのページでも最初に読む。

const el = (id) => document.getElementById(id);

// JSON を返す API を呼ぶ(返事の中身を返す)
function fetchJson(url, options) {
  return fetch(url, options).then((r) => r.json());
}

// フォームの形で POST する(返事そのものを返す。値は { 名前: 値 })
function postForm(url, fields) {
  const body = new FormData();
  Object.entries(fields).forEach(([name, value]) => body.append(name, value));
  return fetch(url, { method: "POST", body });
}

// <select> に選択肢を足す(items は { value, text, selected })
function addOptions(select, items) {
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.text;
    if (item.selected !== undefined) opt.selected = item.selected;
    select.appendChild(opt);
  });
}

// <ul> の中身を、文字の行で置きかえる
function fillList(ul, texts) {
  ul.replaceChildren(...texts.map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
}

// CSS のアニメーションを、はじめからもう一度流す(class を外し、描き直させてから付け直す)
function replayAnimation(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

// progress で届いた名前の候補(なければ採用した名前だけ)
function nameChoicesOf(msg) {
  return msg.name_choices || (msg.monster_name ? [msg.monster_name] : []);
}

// サーバーの WebSocket につなぐ(role は pc / phone)。切れたら少し待って入り直す
const WS_RETRY_MS = 2000;
function connectWebSocket(role, onMessage, onClose) {
  const ws = new WebSocket("ws://" + location.host + "/ws?role=" + role);
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    if (onClose) onClose();
    setTimeout(() => connectWebSocket(role, onMessage, onClose), WS_RETRY_MS);
  };
}

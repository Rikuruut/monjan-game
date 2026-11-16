// ページをまたぐ画面の移り方「葉のカーテン」(2026年11月16日。依頼者が選んだ)
//
//   葉と花びらが うずを巻いて画面を覆い(閉じる)→ 次のページへ移る → 次のページは 覆われた状態から始まり、
//   葉が 右上へ 風に飛ばされて開く。撮影側(themes/fusion/index.html)と バトル側(battle/index.html)の両方が <head> で読む。
//   window.monjanCurtain.leave(url) で 閉じてから移る(撮影側の core.js の goBattle・バトル側の integration.ts の navigateTo)。
//   読めないとき・使わないときは、これまでどおり すぐ移る(呼ぶ側が location.href にする)。
//
//   ・前のページで sessionStorage の monjan-curtain に印を付け、次のページは 読みこまれた瞬間に <html> に curtain-closed を付けて
//     CSS の ::after で 最初の描画から覆う(前のページの終わりと つながる)。load のあと(おそくとも 3秒で)開く
//   ・依存なし。動きは Web Animations(element.animate)で 位置・大きさ・回転・透明度だけ(内蔵 GPU でも軽く)
//   ・動きを減らす設定では 葉を出さず、幕のフェードだけ

(() => {
  const KEY = "monjan-curtain";
  const CLOSE_MS = 700;
  const OPEN_MS = 850;
  const OPEN_TIMEOUT_MS = 3000;   // load が来なくても この時間で開く
  const LEAF_COUNT = 36;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const BACK = "radial-gradient(ellipse at 50% 50%, #1F4D3A 0%, #173A2E 55%, #0d2219 100%)";
  const svg = (viewBox, body) =>
    "url(\"data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`) + "\")";
  const leaf = (fill) => svg("0 0 40 24",
    `<path d="M2 12 C10 0 30 0 38 12 C30 24 10 24 2 12Z" fill="${fill}"/><path d="M5 12 H35" stroke="#173A2E" stroke-width="1.6" opacity=".4"/>`);
  const petal = (fill) => svg("0 0 24 24", `<path d="M12 2 C20 6 20 18 12 22 C4 18 4 6 12 2Z" fill="${fill}"/>`);
  const spark = (fill) => svg("0 0 24 24", `<path d="M12 0 L15 9 L24 12 L15 15 L12 24 L9 15 L0 12 L9 9Z" fill="${fill}"/>`);
  // 葉が多め。fusion の effects.js の 舞い散る葉と同じ形・色
  const SHAPES = [
    { img: leaf("#6CC04A"), w: 1, h: 0.6 }, { img: leaf("#3F8F4A"), w: 1, h: 0.6 }, { img: leaf("#9FD86C"), w: 1, h: 0.6 },
    { img: leaf("#6CC04A"), w: 1, h: 0.6 }, { img: petal("#F7A8C4"), w: 0.6, h: 0.6 }, { img: spark("#FFE9A8"), w: 0.45, h: 0.45 },
  ];

  const style = document.createElement("style");
  style.textContent = `
    html.curtain-closed::after {
      content: ""; position: fixed; inset: 0; z-index: 2147483646; background: ${BACK};
    }
    .monjan-curtain { position: fixed; inset: 0; z-index: 2147483647; overflow: hidden; pointer-events: none; }
    .monjan-curtain__back { position: absolute; inset: 0; background: ${BACK}; }
    .monjan-curtain__leaf {
      position: absolute; left: 50%; top: 50%;
      background-size: contain; background-repeat: no-repeat; background-position: center;
      will-change: transform, opacity;
    }
  `;
  document.head.appendChild(style);

  // 前のページが 閉じてから移ってきたか(印は すぐ消す。再読みこみで また覆わないように)
  let arrived = false;
  try {
    arrived = sessionStorage.getItem(KEY) === "1";
    if (arrived) sessionStorage.removeItem(KEY);
  } catch (e) { /* 読めなければ 覆わない */ }
  if (arrived) document.documentElement.classList.add("curtain-closed");

  // 葉1枚ごとの 閉じたときの位置(黄金角で 画面ぜんたいに散らす。vmax = 画面の長い辺)と 大きさ・向き
  const leaves = Array.from({ length: LEAF_COUNT }, (_, i) => {
    const shape = SHAPES[i % SHAPES.length];
    const size = 9 + ((i * 7) % 8);   // 9〜16vmin
    return {
      shape,
      w: size * shape.w,
      h: size * shape.h,
      angle: (i * 137.5) % 360,
      radius: 6 + 58 * Math.sqrt((i + 0.5) / LEAF_COUNT),   // 中心から 6〜64vmax
      spin: (i * 53) % 360,
    };
  });
  const at = (l, { angle = l.angle, radius = l.radius, spin = l.spin, scale = 1, shift = "" } = {}) =>
    `${shift} rotate(${angle}deg) translateX(${radius}vmax) rotate(${spin}deg) scale(${scale})`;

  function build() {
    const root = document.createElement("div");
    root.className = "monjan-curtain";
    root.setAttribute("aria-hidden", "true");
    const back = document.createElement("div");
    back.className = "monjan-curtain__back";
    root.appendChild(back);
    const els = reduce ? [] : leaves.map((l) => {
      const el = document.createElement("i");
      el.className = "monjan-curtain__leaf";
      el.style.width = l.w + "vmin";
      el.style.height = l.h + "vmin";
      el.style.margin = `${-l.h / 2}vmin 0 0 ${-l.w / 2}vmin`;
      el.style.backgroundImage = l.shape.img;
      root.appendChild(el);
      return el;
    });
    (document.body || document.documentElement).appendChild(root);
    return { root, back, els };
  }

  // 閉じる:葉が 画面の外から うずを巻いて(時計回りに 200度)集まり、幕が濃くなる
  let leaving = false;
  function leave(url) {
    if (leaving) return;
    leaving = true;
    const { back, els } = build();
    const ms = reduce ? 300 : CLOSE_MS;
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "ease-in", fill: "both" });
    els.forEach((el, i) => {
      const l = leaves[i];
      el.animate(
        [
          { transform: at(l, { angle: l.angle - 200, radius: 95, spin: l.spin - 300, scale: 0.6 }), opacity: 0 },
          { opacity: 1, offset: 0.3 },
          { transform: at(l), opacity: 1 },
        ],
        { duration: ms * (0.75 + (i % 5) * 0.05), easing: "cubic-bezier(.3,.6,.4,1)", fill: "both" },
      );
    });
    if (window.sfx && typeof window.sfx.play === "function") window.sfx.play("gust");
    const go = () => {
      try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* 残せなくても 移る(次のページは 覆わずに始まる) */ }
      location.href = url;
    };
    setTimeout(go, ms + 30);
  }

  // 開く:閉じた形で 作ってから 覆いの ::after を外し、葉が 右上へ 風に飛ばされ、幕が うすくなって消える
  let opened = false;
  function open() {
    if (opened) return;
    opened = true;
    const { root, back, els } = build();
    document.documentElement.classList.remove("curtain-closed");
    const ms = reduce ? 300 : OPEN_MS;
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, delay: reduce ? 0 : 150, easing: "ease-out", fill: "both" });
    // 終わったら 幕を消す(アニメーションの終わりの知らせに頼らず、時間で)
    setTimeout(() => root.remove(), ms + 250);
    els.forEach((el, i) => {
      const l = leaves[i];
      const delay = (i % 9) * 25;
      el.animate(
        [
          { transform: at(l), opacity: 1 },
          { transform: at(l, { spin: l.spin + 240, scale: 0.8, shift: `translate(${70 + (i % 4) * 15}vw, ${-45 - (i % 3) * 15}vh)` }), opacity: 0 },
        ],
        { duration: ms - delay, delay, easing: "cubic-bezier(.5,0,.75,.4)", fill: "both" },
      );
    });
  }

  if (arrived) {
    // requestAnimationFrame は 画面が描かれないあいだ止まり、幕が閉じたまま残るおそれがあるので タイマーで呼ぶ
    const start = () => setTimeout(open, 30);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    setTimeout(start, OPEN_TIMEOUT_MS);
  }

  window.monjanCurtain = { leave };
})();

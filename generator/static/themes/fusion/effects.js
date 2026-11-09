// 森のつむじ風テーマの演出(GSAP と tsParticles)。core.js より前に読む
//
//   - s2・がったい中(s3):葉・花びら・光の粒・風の筋が、うずのふちから らせんを描いて中心へ吸いこまれる(段が上がるほど増える)。
//                         段が上がるたびに、うずが「どくん」と脈打ち、小さな衝撃波が広がる
//   - 誕生(s3 → s4):うずと、まわりを回る玉が、加速しながら中心の一点に縮む → ピタッと止まる
//                     → 風が はじける(白い風の三日月が回りながら広がる)・閃光・衝撃波 → 葉と花びらが舞い、ゆっくり落ちる
//                     → 画面がゆれ、うずが大きく広がって残る → カードが回りながら出る → 名前が1文字ずつ跳ねる
//
// うずの明るさ・玉の公転(--progress / data-level)は style.css の指定のまま。ここでは1回きりの動きだけを足す。
// GSAP が読めないとき・動きを減らす設定のときは何もしない(style.css の CSS の演出で動く)。

(() => {
  if (!window.gsap) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.SplitText) gsap.registerPlugin(SplitText);

  // style.css は、<html> に fx が付いているあいだ、誕生の CSS アニメーションを止める(ここで動かすため)
  document.documentElement.classList.add("fx");

  const stage = document.getElementById("stage");
  const $ = (sel) => stage.querySelector(sel);
  const $$ = (sel) => Array.from(stage.querySelectorAll(sel));
  const vortex = $(".vortex");
  const inflow = $(".inflow");
  const point = $(".vortex-point");
  const gust = $(".gust");
  const flash = $(".fx-flash");
  const area = $(".vortex-area");

  // 演出で動かした要素(場面が s4 から変わったら、GSAP が付けた style を消して元に戻す)
  const moved = () => [vortex, point, gust, flash, area, ...$$(".orb"), $("#card"), ...$$(".shock")];

  // ----------------------------------------------------------------------
  // 吸いこまれる粒(DOM の小さな点。外側を回しながら、中の点を中心へ動かして、らせんを描く)
  // 種類は 葉・花びら・光の粒・風の筋(見た目は style.css の .m-*。葉は少し大きく、風は細長く)
  // ※ 動かすのは GSAP ではなく Web Animations(element.animate)。GSAP は作った要素ごとにスタイルを読み直すので、
  //   誕生の始めに40個まとめて作ると、画面が2秒ほど止まった(2026年11月2日、CPU を4倍遅くして測った)。
  //   element.animate はスタイルを読まず、transform と opacity だけなので GPU 側で動く
  // ----------------------------------------------------------------------
  // 段ごとの、1秒あたりの粒の数(0 まだ / 1 なまえ / 2 絵をかき始めた / 3 半分すぎ / 4 もうすぐ / 5 できた)
  const MOTES_PER_SEC = [0, 4, 7, 11, 16, 22];
  const MOTES_PER_SEC_S2 = 3;
  const MAX_MOTES = 90;
  const MOTE_KINDS = [
    { cls: "m-leaf", w: [12, 18], h: 0.6 },
    { cls: "m-petal", w: [8, 12], h: 1 },
    { cls: "m-light", w: [5, 10], h: 1 },
    { cls: "m-wind", w: [14, 24], h: 0.25 },
  ];
  let moteTimer = null;
  let moteCarry = 0;

  function spawnMote(speed = 1) {
    if (inflow.childElementCount >= MAX_MOTES) return;
    const mote = document.createElement("span");
    mote.className = "mote";
    const dot = document.createElement("i");
    const kind = MOTE_KINDS[Math.floor(Math.random() * MOTE_KINDS.length)];
    dot.className = kind.cls;
    mote.appendChild(dot);
    inflow.appendChild(mote);
    const size = gsap.utils.random(kind.w[0], kind.w[1]);
    dot.style.width = size + "px";
    dot.style.height = size * kind.h + "px";
    const start = gsap.utils.random(0, 360);
    const turn = gsap.utils.random(150, 240);
    const radius = gsap.utils.random(250, 330);
    const tilt = kind.cls === "m-wind" ? 90 : gsap.utils.random(0, 360);
    const ms = gsap.utils.random(1100, 1800) / speed;
    const easeIn = "cubic-bezier(.55, .085, .68, .53)";   // だんだん速く(GSAP の power2.in に近い)
    // うずと同じ時計回りに回りながら、中心へ近づくほど速くなる
    mote.animate(
      [{ transform: `rotate(${start}deg)` }, { transform: `rotate(${start + turn}deg)` }],
      { duration: ms, easing: easeIn, fill: "both" },
    ).onfinish = () => mote.remove();
    dot.animate(
      [{ transform: `translate(calc(-50% + ${radius}px), -50%) rotate(${tilt}deg) scale(1)` },
       { transform: `translate(calc(-50% + 8px), -50%) rotate(${tilt}deg) scale(0.3)` }],
      { duration: ms, easing: easeIn, fill: "both" },
    );
    dot.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: ms, fill: "both" });
  }

  function startMotes() {
    stopMotes();
    const tickMs = 100;
    moteTimer = setInterval(() => {
      const scene = stage.dataset.scene;
      const level = Number(stage.dataset.level || 0);
      const rate = scene === "s3" ? (MOTES_PER_SEC[level] || 0) : scene === "s2" ? MOTES_PER_SEC_S2 : 0;
      moteCarry += rate * tickMs / 1000;
      const n = Math.floor(moteCarry);
      moteCarry -= n;
      for (let i = 0; i < n; i++) spawnMote();
    }, tickMs);
  }

  function stopMotes() {
    clearInterval(moteTimer);
    moteTimer = null;
    moteCarry = 0;
  }

  function clearMotes() {
    inflow.replaceChildren();   // 要素を消せば、その動き(element.animate)も止まる
  }

  // ----------------------------------------------------------------------
  // 舞い散る 葉と花びら(tsParticles。たまごのテーマの紙吹雪と同じく、ゆれて回りながら、ゆっくり落ちる)
  // ----------------------------------------------------------------------
  const svg = (viewBox, body) =>
    "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`);
  const petalSvg = (fill) => svg("0 0 24 24", `<path d="M12 2 C20 6 20 18 12 22 C4 18 4 6 12 2Z" fill="${fill}"/>`);
  const leafSvg = (fill) => svg("0 0 40 24",
    `<path d="M2 12 C10 0 30 0 38 12 C30 24 10 24 2 12Z" fill="${fill}"/><path d="M5 12 H35" stroke="#173A2E" stroke-width="1.6" opacity=".4"/>`);
  const sparkSvg = (fill) => svg("0 0 24 24", `<path d="M12 0 L15 9 L24 12 L15 15 L12 24 L9 15 L0 12 L9 9Z" fill="${fill}"/>`);

  let shards = null;
  async function initParticles() {
    if (!window.tsParticles) return;
    if (window.loadFull) await loadFull(tsParticles);
    shards = await tsParticles.load({
      id: "fx-shards",
      options: {
        fullScreen: { enable: false },
        background: { color: "transparent" },
        detectRetina: true,
        fpsLimit: 60,
        particles: {
          number: { value: 0 },
          shape: {
            type: "image",
            options: {
              image: [
                { src: leafSvg("#6CC04A"), width: 40, height: 24 },
                { src: leafSvg("#3F8F4A"), width: 40, height: 24 },
                { src: leafSvg("#9FD86C"), width: 40, height: 24 },
                { src: petalSvg("#F7A8C4"), width: 24, height: 24 },
                { src: petalSvg("#FFF8E6"), width: 24, height: 24 },
                { src: sparkSvg("#FFE9A8"), width: 24, height: 24 },
              ],
            },
          },
          size: { value: { min: 12, max: 24 } },
          opacity: { value: 1 },
          rotate: { value: { min: 0, max: 360 }, direction: "random", animation: { enable: true, speed: 30 } },
          wobble: { enable: true, distance: 30, speed: { min: -15, max: 15 } },
          // 向きを決めないと、それぞれ ばらばらの向きへ飛ぶ(中心から放射状に広がり、勢いが落ちると ゆっくり落ちる)
          move: {
            enable: true,
            direction: "none",
            speed: { min: 18, max: 46 },
            decay: 0.05,
            gravity: { enable: true, acceleration: 6 },
            outModes: { default: "destroy" },
          },
          life: { count: 1, duration: { value: { min: 2.2, max: 3.2 } } },
        },
      },
    });
  }
  // 準備ができたら、使うときまで描くのを止めておく
  const particlesReady = initParticles()
    .then(() => { if (shards && typeof shards.pause === "function") shards.pause(); })
    .catch((e) => console.error("葉と花びらの準備に失敗しました", e));

  // 舞台の座標で、canvas に粒を足す
  function addParticleAt(container, host, x, y) {
    const canvas = host.querySelector("canvas");
    if (!container || !canvas || !host.offsetWidth) return;
    const ratio = canvas.width / host.offsetWidth;
    container.particles.addParticle({ x: x * ratio, y: y * ratio });
  }

  // 葉と花びらが消えたら、描くのを止める(粒が0でも、動かしたままだと毎フレーム描き直すため)
  const SHARD_LIFE_MS = 3400;
  let shardTimer = null;

  function burstShards() {
    const host = $("#fx-shards");
    if (!shards) return;
    clearTimeout(shardTimer);
    if (typeof shards.play === "function") shards.play();
    shardTimer = setTimeout(() => { if (typeof shards.pause === "function") shards.pause(); }, SHARD_LIFE_MS);
    const cx = area.offsetLeft + area.offsetWidth / 2;
    const cy = area.offsetTop + area.offsetHeight / 2;
    for (let i = 0; i < 60; i++) {
      addParticleAt(shards, host, cx + gsap.utils.random(-20, 20), cy + gsap.utils.random(-20, 20));
    }
  }

  // 衝撃波の輪を1つ広げる
  function shockwave(el, { scale = 4, duration = 1, delay = 0 } = {}) {
    return gsap.fromTo(el, { opacity: 1, scale: 0.1 }, { opacity: 0, scale, duration, delay, ease: "power2.out" });
  }

  // ----------------------------------------------------------------------
  // がったい中:段が上がるたびに「どくん」
  // ----------------------------------------------------------------------
  stage.addEventListener("levelchange", (ev) => {
    const { level, prev } = ev.detail;
    if (stage.dataset.scene !== "s3" || level <= prev || level >= 5) return;
    // 終わったら style を消す(残ると、s4 の CSS の大きさより優先されてしまう)
    gsap.timeline({ onComplete: () => gsap.set(vortex, { clearProps: "transform" }) })
      .to(vortex, { scale: 1.08, duration: 0.14, ease: "power2.out" })
      .to(vortex, { scale: 1, duration: 0.7, ease: "elastic.out(1, 0.45)" });
    shockwave($(".shock-2"), { scale: 2.4, duration: 0.8 });
    for (let i = 0; i < 8 + level * 3; i++) spawnMote(1.4);
  });

  // 場面が変わったら、粒を出す・止める。s4 から離れたら、演出で動かした要素を元に戻す
  let lastScene = stage.dataset.scene;
  const onScene = () => {
    const scene = stage.dataset.scene;
    if (scene === "s2" || scene === "s3") { if (!moteTimer) startMotes(); }
    else { stopMotes(); clearMotes(); }
  };
  new MutationObserver(() => {
    const scene = stage.dataset.scene;
    if (scene === lastScene) return;
    if (lastScene === "s4") {
      gsap.killTweensOf(moved());
      gsap.set(moved(), { clearProps: "all" });
      stage.classList.remove("fx-hold");
    }
    lastScene = scene;
    onScene();
  }).observe(stage, { attributes: true, attributeFilter: ["data-scene"] });
  onScene();

  // ----------------------------------------------------------------------
  // 誕生(core.js の playBirth から呼ばれる)
  // ----------------------------------------------------------------------
  function birth(showCard) {
    stopMotes();
    // カードの絵を、うずが縮んでいるあいだに先に展開しておく(カードを出す瞬間に、大きな絵の展開で止まらないように)
    const img = $("#card-img");
    if (img.getAttribute("src") && img.decode) img.decode().catch(() => {});
    const card = $("#card");
    const nameEl = $("#card-name");
    stage.classList.add("fx-hold");
    gsap.set(card, { autoAlpha: 0 });  // s4 になった瞬間にカードが見えないように
    // 動かす要素の形を、ここで1回にまとめて読ませる(GSAP は動かし始めるときに要素の形を読み、そのたびに画面の再計算が起きるため)。
    // カードはまだ隠れているので入れない(隠れた要素は、GSAP が一時的に表示して測るので、かえって重い)
    gsap.set([vortex, point, gust, area, ...$$(".orb"), ...$$(".shock")], { x: "+=0" });

    const tl = gsap.timeline();

    // 1. うずが加速しながら、中心の一点に縮む(まわりを回る玉と、光の粒も、いっせいに吸いこまれる)
    tl.to(vortex, { rotation: "+=600", scale: 0.06, duration: 1.0, ease: "power3.in" });
    tl.to($$(".orb"), { scale: 0, duration: 0.7, ease: "power2.in" }, 0);
    tl.add(() => { for (let i = 0; i < 40; i++) spawnMote(2.2); }, 0);
    tl.fromTo(point, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.in" }, 0.55);

    // 2. ピタッと止まる(ここの「間」が大事)。光の点だけが、小さくふるえる
    tl.to(point, { keyframes: { x: [0, -3, 3, -2, 2, 0], scale: [1, 1.1, 0.95, 1.15, 1] }, duration: 0.4, ease: "none" });

    // 3. 風がはじける:白い風の三日月が、回りながら一気に広がって消える。同時に閃光・衝撃波・葉と花びら・画面のゆれ
    tl.add("pop");
    tl.fromTo(gust, { opacity: 1, scale: 0.1, rotation: -160 },
      { scale: 2.1, rotation: 40, duration: 1.0, ease: "power2.out" }, "pop");
    tl.to(gust, { opacity: 0, duration: 0.5, ease: "power1.in" }, "pop+=0.5");
    tl.to(point, { scale: 4, opacity: 0, duration: 0.4, ease: "power2.out" }, "pop");
    tl.add(() => { showCard(); gsap.set(card, { autoAlpha: 0 }); if (window.sfx) sfx.play("crack"); }, "pop");
    tl.fromTo(flash, { opacity: 0 }, { opacity: 0.95, duration: 0.07, ease: "power1.in" }, "pop");
    tl.to(flash, { opacity: 0, duration: 0.8, ease: "power2.out" }, "pop+=0.07");
    tl.add(() => {
      shockwave($(".shock-1"), { scale: 4.5, duration: 1.0 });
      shockwave($(".shock-2"), { scale: 3.4, duration: 1.1, delay: 0.12 });
    }, "pop");
    tl.add(() => particlesReady.then(burstShards), "pop");
    // ゆらすのは、うずのまわりだけ(画面ぜんたいをゆらすと、カードや背景まで描き直しになって重い)
    tl.to(area, { keyframes: { x: [0, -18, 16, -12, 10, -6, 4, 0], y: [0, 10, -8, 6, -4, 2, 0, 0] }, duration: 0.5, ease: "none" }, "pop");
    // うずは大きく広がって、カードのうしろに薄く残る(style.css の s4 と同じ見た目で終わる)
    tl.fromTo(vortex, { scale: 0.06, opacity: 1 }, { scale: 1.35, opacity: 0.6, rotation: "+=180", duration: 1.4, ease: "power2.out" }, "pop");

    // 4. カードが中心から回りながら出る
    tl.fromTo(card,
      // ※ filter(明るさ)を動かすと、大きなカードを毎フレーム描き直して重いので、大きさと回転だけにする
      { autoAlpha: 0, scale: 0.15, rotationY: -540, transformPerspective: 1400 },
      { autoAlpha: 1, scale: 1, rotationY: 0, duration: 1.1, ease: "back.out(1.3)" },
      "pop+=0.2");
    tl.add(() => { if (window.sfx) sfx.play("fanfare"); }, "pop+=0.4");

    // 5. 名前が1文字ずつ跳ねる
    if (window.SplitText && nameEl.textContent.trim()) {
      let split = null;
      tl.add(() => {
        split = SplitText.create(nameEl, { type: "chars" });
        gsap.from(split.chars, {
          y: -70, scale: 0.3, autoAlpha: 0, duration: 0.55, ease: "back.out(3)", stagger: 0.07,
          // 途中でスマホから名前が選ばれて書きかわっていたら、元に戻さない
          onComplete: () => { if (nameEl.contains(split.chars[0])) split.revert(); },
        });
      }, "pop+=1.1");
      // 名前の演出が終わるまで待つ
      tl.to({}, { duration: 0.55 + 0.07 * nameEl.textContent.length }, "pop+=1.1");
    }

    return new Promise((resolve) => {
      tl.eventCallback("onComplete", () => {
        stage.classList.remove("fx-hold");
        clearMotes();
        resolve();
      });
    });
  }

  window.themeFx = { birth };
})();

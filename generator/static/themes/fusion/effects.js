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
    const mote = document.createElement("i");
    const kind = MOTE_KINDS[Math.floor(Math.random() * MOTE_KINDS.length)];
    mote.className = "mote " + kind.cls;
    inflow.appendChild(mote);
    const size = gsap.utils.random(kind.w[0], kind.w[1]);
    mote.style.width = size + "px";
    mote.style.height = size * kind.h + "px";
    const start = gsap.utils.random(0, 360);
    const turn = gsap.utils.random(150, 240);
    const radius = gsap.utils.random(250, 330);
    const tilt = kind.cls === "m-wind" ? 90 : gsap.utils.random(0, 360);
    const ms = gsap.utils.random(1100, 1800) / speed;
    const easeIn = "cubic-bezier(.55, .085, .68, .53)";   // だんだん速く(GSAP の power2.in に近い)
    // うずと同じ時計回りに回りながら、中心へ近づくほど速くなる。
    // 回る(うずの中心が軸)・中心へ動く・自分の向き(粒の真ん中が軸)を1つの transform にまとめてある。
    // ※ 2026年11月9日:それまでは外の span を回し、中の i を動かしていた(要素2つ・動き3つ)。
    //   同じ長さ・同じ速さの変化なので、まとめても通り道は同じ。粒が多い「もうすぐ」で軽くなる
    const at = (angle, distance, scale) =>
      `rotate(${angle}deg) translate(calc(-50% + ${distance}px), -50%) ` +
      `translate(50%, 50%) rotate(${tilt}deg) scale(${scale}) translate(-50%, -50%)`;
    mote.animate(
      [{ transform: at(start, radius, 1) }, { transform: at(start + turn, 8, 0.3) }],
      { duration: ms, easing: easeIn, fill: "both" },
    ).onfinish = () => mote.remove();
    mote.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: ms, fill: "both" });
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
  // 舞い散る 葉と花びら(tsParticles。ゆれて回りながら、ゆっくり落ちる)
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

  // count:葉と花びらの数(がったい中の連打のパワーで 60〜120)
  function burstShards(count = 60) {
    const host = $("#fx-shards");
    if (!shards) return;
    clearTimeout(shardTimer);
    if (typeof shards.play === "function") shards.play();
    shardTimer = setTimeout(() => { if (typeof shards.pause === "function") shards.pause(); }, SHARD_LIFE_MS);
    const cx = area.offsetLeft + area.offsetWidth / 2;
    const cy = area.offsetTop + area.offsetHeight / 2;
    for (let i = 0; i < count; i++) {
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
    // 段ごとの嵐(段がとんだときは、いまの段の分だけ)。雲・暗さ・雨を なめらかに寄せ、続く天気を 段の強さにする
    easeWeather();
    const show = LEVEL_SHOWS[level];
    if (show) show();
    startWeather(level);
  });

  // ----------------------------------------------------------------------
  // がったい中:進むほど 天気が悪くなり、嵐の雷で生まれる(2026年11月16日。依頼者と決めた。音は足さない・本格的な嵐)
  //   段ごとの 雲・暗さ・雨 は style.css の静的な指定。ここは 段が上がった瞬間の見せ場と、段のあいだ続く 風・稲光・落雷
  //   1 なまえ       … 雲がかかる。写真と動物の玉が ぽわっと ふくらむ
  //   2 絵をかき始めた … 突風(風の筋が走りぬけ、画面のふちが緑に光る)。小雨。このあと 風の筋が 流れ続ける
  //   3 半分すぎ     … 大雨。遠くの稲光(雲の奥が光る)が ときどき
  //   4 もうすぐ     … 「もうすぐ!」+ うずへ 大きな落雷。このあと 2〜3.5秒ごとに落雷(うず と 画面のあちこち)・鼓動
  //   誕生(birth)  … うずへ 特大の落雷 → はじける → 雲と雨が消え(s4 の CSS)、上から光の筋が差しこむ
  //   動かすのは 位置・大きさ・回転・透明度だけ。光の点滅は 1秒に3回以下(落雷どうしは 2秒以上あける)
  // ----------------------------------------------------------------------
  const orbs = $$(".orb");
  const gales = $$(".gale");
  const edgeGlow = $(".edge-glow");
  const soonBanner = $(".soon-banner");
  const dim = $(".dim");
  const clouds = $(".clouds");
  const cloudFlash = $(".cloud-flash");
  const rains = $$(".rain");
  const bolts = $$(".bolt");
  const sunBreak = $(".sun-break");
  const land = $(".land");
  const sceneArt = $(".scene-art");
  const halo = $(".vortex-halo");
  const groundGlow = $(".ground-glow");
  const weatherLayers = [clouds, dim, ...rains];
  const showParts = [...orbs, ...gales, edgeGlow, soonBanner, cloudFlash, ...bolts, sunBreak, flash, ...weatherLayers, halo, groundGlow];
  // 消すのは 動かした transform と opacity だけ(風の筋の top など、HTML に書いた style は残す)
  const clear = (targets) => () => gsap.set(targets, { clearProps: "transform,opacity" });

  // 段が変わると style.css の 雲・暗さ・雨 が一気に変わるので、前の段の値から 1.2秒で寄せる(終わったら CSS の値のまま)。
  // ※ 雲と雨は CSS アニメーションで transform を使っているので、ここで動かすのは 透明度だけ
  const shownOpacity = new Map();
  function easeWeather() {
    weatherLayers.forEach((layer) => {
      gsap.killTweensOf(layer, "opacity");
      gsap.set(layer, { clearProps: "opacity" });
      const target = Number(getComputedStyle(layer).opacity);
      const from = shownOpacity.get(layer) ?? 0;
      shownOpacity.set(layer, target);
      if (from !== target) gsap.fromTo(layer, { opacity: from }, { opacity: target, duration: 1.2, ease: "power2.out", onComplete: clear(layer) });
    });
  }

  // 画面をゆらす(うずの まわり と 森の手前。背景の絵は #stage にあるので 動かない)
  // 2026年11月16日:依頼者の希望で 強くした(落雷 9〜22px → 20〜42px、0.4 → 0.5秒、大きいほど 少し回る)。
  // 強い揺れの最中に 弱い揺れ(連打)が来ても、強いほうを 消さない
  let shakeUntil = 0;
  let shakePx = 0;
  function shakeScene(px) {
    const now = performance.now();
    if (now < shakeUntil && px < shakePx) return;
    const duration = px >= 10 ? 0.5 : 0.25;
    shakeUntil = now + duration * 1000;
    shakePx = px;
    const turn = Math.min(1, px / 40);   // 回転(度)
    gsap.killTweensOf([land, sceneArt], "x,y,rotation");
    gsap.timeline({ onComplete: clear([land, sceneArt]) })
      .to([land, sceneArt], {
        keyframes: {
          x: [0, -px, px * 0.8, -px * 0.55, px * 0.35, -px * 0.15, 0],
          y: [0, px * 0.6, -px * 0.5, px * 0.35, -px * 0.2, 0, 0],
          rotation: [0, -turn, turn * 0.7, -turn * 0.4, turn * 0.2, 0, 0],
        },
        duration,
        ease: "none",
      });
  }

  // 風の筋を1本 走らせる(6本を順に使い回す)
  let galeIndex = 0;
  function blowGale(delay = 0) {
    const gale = gales[galeIndex++ % gales.length];
    gsap.killTweensOf(gale);
    gsap.timeline({ delay, onComplete: clear(gale) })
      .fromTo(gale,
        { x: 1920, y: gsap.utils.random(-50, 50), rotation: -14, opacity: 0, scaleX: 0.6 },
        { x: -600, opacity: 1, scaleX: 1.2, duration: gsap.utils.random(0.45, 0.65), ease: "power2.in" })
      .to(gale, { opacity: 0, duration: 0.12 }, ">-0.12");
  }

  // 効果音(sound.js。?sound=0 や Howler がないときは 鳴らさない)。rate で 少し高さを変えて、同じ音の くり返しに聞こえないように
  const sound = (name, options) => { if (window.sfx) window.sfx.play(name, options); };

  // 遠くの稲光:雲の奥が 2回 ちらつく(落雷より弱い光。上のほうだけ)。withSound:遠くのゴロゴロも鳴らす(落雷の中から呼ぶときは 鳴らさない)
  function distantGlow(withSound = true) {
    if (withSound) sound("rumble", { rate: gsap.utils.random(0.85, 1.1) });
    gsap.killTweensOf(cloudFlash);
    gsap.timeline({ onComplete: clear(cloudFlash) })
      .to(cloudFlash, { opacity: 0.7, duration: 0.06 })
      .to(cloudFlash, { opacity: 0.15, duration: 0.1 })
      .to(cloudFlash, { opacity: 0.5, duration: 0.05 })
      .to(cloudFlash, { opacity: 0, duration: 0.45, ease: "power2.out" });
  }

  // ジグザグの稲妻の形(上の はしの startX から (x, y) まで)。spread:横のゆれ幅。
  // startX を省くと、上の はしの どこからでも(落ちる先から 遠すぎると ほぼ横になるので ±700px まで)
  function boltPath(x, y, spread, startX = gsap.utils.clamp(60, 1860, x + gsap.utils.random(-700, 700))) {
    const steps = 9;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jitter = i === 0 || i === steps ? 0 : gsap.utils.random(-spread, spread) * (1 - t * 0.5);
      points.push([startX + (x - startX) * t + jitter, -30 + (y + 30) * t]);
    }
    return points;
  }
  const toD = (points) => "M" + points.map(([px, py]) => `${px.toFixed(0)} ${py.toFixed(0)}`).join(" L");
  // 稲妻1本(<g class="bolt"> の 光のにじみ と 芯)に 同じ形を入れる
  const setBolt = (bolt, d) => bolt.querySelectorAll("path").forEach((path) => path.setAttribute("d", d));

  const FLASH_GAP_MS = 500;
  let lastFlashAt = -Infinity;

  // 落雷:稲妻が 一瞬光って 1回 ちらつき 消える・画面が白く光る(1回)・雲の奥も光る・ゆれ。
  // onVortex:うずに落ちる(うずが どくん・衝撃波・粒)。big:誕生の 特大の落雷
  function strike({ onVortex = false, big = false } = {}) {
    const x = onVortex ? 960 : gsap.utils.random(0, 1) < 0.5 ? gsap.utils.random(140, 640) : gsap.utils.random(1280, 1780);
    const y = onVortex ? 520 : gsap.utils.random(700, 840);
    const main = boltPath(x, y, big ? 90 : 60);
    setBolt(bolts[0], toD(main));
    // 枝わかれ:幹の途中から 斜め下へ 短く
    const from = main[gsap.utils.random(2, 5, 1)];
    const branch = [from];
    for (let i = 1; i <= 4; i++) branch.push([from[0] + i * gsap.utils.random(20, 45) * (x > 960 ? 1 : -1), from[1] + i * gsap.utils.random(30, 50)]);
    setBolt(bolts[1], toD(branch));
    // 特大のときは もう1本(うずへ 別の向きから)
    setBolt(bolts[2], big ? toD(boltPath(x, y, 70)) : "");
    const used = big ? bolts : bolts.slice(0, 2);
    gsap.killTweensOf(bolts);
    // 特大は 太く(style.css の .bolt-big)
    bolts.forEach((bolt) => bolt.classList.toggle("bolt-big", big));
    gsap.set(bolts, { opacity: 0 });
    gsap.timeline({ onComplete: () => gsap.set(bolts, { clearProps: "opacity" }) })
      .to(used, { opacity: 1, duration: 0.04 })
      .to(used, { opacity: 0.25, duration: 0.06 })
      .to(used, { opacity: 1, duration: 0.04 })
      .to(used, { opacity: 0, duration: big ? 0.5 : 0.3, ease: "power2.in" });
    // 画面ぜんたいの白い光は、前の光から FLASH_GAP_MS 以上あいたときだけ(嵐・パワー MAX・誕生が重なっても 1秒に3回を こえない)
    if (performance.now() - lastFlashAt >= FLASH_GAP_MS) {
      lastFlashAt = performance.now();
      gsap.killTweensOf(flash);
      gsap.timeline({ onComplete: clear(flash) })
        .fromTo(flash, { opacity: 0 }, { opacity: big ? 0.8 : 0.45, duration: 0.05 })
        .to(flash, { opacity: 0, duration: big ? 0.6 : 0.4, ease: "power2.out" });
    }
    distantGlow(false);
    // 特大はいちばん大きく 低めに、ふつうは 少し小さく 高さをばらつかせる
    sound("thunder", big ? { rate: 0.85, volume: 1 } : { rate: gsap.utils.random(0.9, 1.12), volume: onVortex ? 0.95 : 0.75 });
    shakeScene(big ? 42 : onVortex ? 30 : 20);
    if (onVortex) {
      // 特大(誕生)のときは、うずは birth() が縮めるので ここでは動かさない
      if (!big) gsap.timeline({ onComplete: () => gsap.set(vortex, { clearProps: "transform" }) })
        .to(vortex, { scale: big ? 1.18 : 1.1, duration: 0.1, ease: "power2.out" })
        .to(vortex, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.4)" });
      shockwave($(".shock-2"), { scale: big ? 3.4 : 2.6, duration: 0.8 });
      for (let i = 0; i < (big ? 24 : 12); i++) spawnMote(2);
    }
  }

  const LEVEL_SHOWS = {
    1() {
      // 玉の大きさは style.css が --progress で決めているので、いまの大きさからの相対で ふくらませて戻す
      gsap.timeline({ onComplete: clear(orbs) })
        .to(orbs, { scale: "+=0.18", duration: 0.2, ease: "power2.out" })
        .to(orbs, { scale: "-=0.18", duration: 0.7, ease: "elastic.out(1, 0.4)" });
    },
    2() {
      // 突風:風の筋が 少しずつ ずれて 走りぬけ、画面のふちが 緑に ふわっと光る(1回)
      gales.forEach((_, i) => blowGale(i * 0.09));
      sound("gust");
      gsap.timeline({ onComplete: clear(edgeGlow) })
        .to(edgeGlow, { opacity: 1, duration: 0.25, ease: "power2.out" })
        .to(edgeGlow, { opacity: 0, duration: 0.9, ease: "power2.in" });
      shakeScene(14);
    },
    3() {
      distantGlow();
      shockwave($(".shock-1"), { scale: 3, duration: 0.9, delay: 0.1 });
      for (let i = 0; i < 20; i++) spawnMote(1.8);
    },
    4() {
      // 「もうすぐ!」:1文字ずつ 上から はねて出て、少し見せて 消える
      gsap.killTweensOf(soonBanner);
      gsap.set(soonBanner, { opacity: 1 });
      if (window.SplitText) {
        const split = SplitText.create(soonBanner, { type: "chars" });
        gsap.from(split.chars, { y: -90, scale: 0.3, opacity: 0, duration: 0.5, ease: "back.out(3)", stagger: 0.06 });
        gsap.to(soonBanner, {
          opacity: 0, scale: 1.15, duration: 0.4, delay: 1.5, ease: "power2.in",
          onComplete: () => { split.revert(); clear(soonBanner)(); },
        });
      } else {
        gsap.fromTo(soonBanner, { scale: 0.4 }, { scale: 1, duration: 0.5, ease: "back.out(3)" });
        gsap.to(soonBanner, { opacity: 0, duration: 0.4, delay: 1.5, onComplete: clear(soonBanner) });
      }
      strike({ onVortex: true });
      startBeat();
    },
  };

  // 段のあいだ続く天気:風の筋・遠くの稲光・落雷の間隔(秒。[最小, 最大] は その間でばらつく)。
  // 4段目は 遠くの稲光をやめて 落雷だけ(光の点滅が 1秒に3回を こえないように)
  const WEATHER = {
    2: { gale: 0.5 },
    3: { gale: 0.35, glow: [3, 5] },
    4: { gale: 0.2, strike: [2, 3.5] },
  };
  const weatherCalls = new Set();
  function every(interval, fn) {
    const schedule = () => {
      const wait = Array.isArray(interval) ? gsap.utils.random(interval[0], interval[1]) : interval;
      const call = gsap.delayedCall(wait, () => {
        weatherCalls.delete(call);
        if (stage.dataset.scene !== "s3") return;
        fn();
        schedule();
      });
      weatherCalls.add(call);
    };
    schedule();
  }
  // 嵐の環境音(雨と風)の大きさ(0〜1。sound.js の STORM_MAX_VOLUME に対する割合)。2段目から
  const STORM_LEVEL = { 2: 0.4, 3: 0.75, 4: 1 };
  function startWeather(level) {
    stopWeather();
    if (window.sfx && window.sfx.storm) window.sfx.storm(STORM_LEVEL[Math.min(level, 4)] || 0);
    const weather = WEATHER[Math.min(level, 4)];
    if (!weather) return;
    if (weather.gale) every(weather.gale, () => blowGale());
    if (weather.glow) every(weather.glow, distantGlow);
    // 落雷は 3回に1回 うずへ、ほかは 画面のあちこちへ
    if (weather.strike) every(weather.strike, () => strike({ onVortex: Math.random() < 0.34 }));
  }
  function stopWeather() {
    weatherCalls.forEach((call) => call.kill());
    weatherCalls.clear();
  }

  // もうすぐ の鼓動:うずのまわりの光と 足もとの光が 0.6秒ごとに どくん、うずのまわりが 小さく ゆれる。
  // 誕生(birth)・場面が変わったら 止める
  let beat = null;
  function startBeat() {
    if (beat) return;
    beat = gsap.timeline({ repeat: -1, delay: 0.6 })
      .to(halo, { scale: 1.12, duration: 0.12, ease: "power2.out" }, 0)
      .to(halo, { scale: 1, duration: 0.4, ease: "power2.inOut" }, 0.12)
      .to(groundGlow, { scale: 1.25, duration: 0.12, ease: "power2.out" }, 0)
      .to(groundGlow, { scale: 1, duration: 0.4, ease: "power2.inOut" }, 0.12)
      .to(area, { keyframes: { x: [0, -8, 6, -2, 0] }, duration: 0.24, ease: "none" }, 0)
      .to({}, { duration: 0.6 }, 0);   // 1拍の長さ
  }
  function stopBeat() {
    if (beat) { beat.kill(); beat = null; }
    gsap.set([halo, groundGlow, area], { clearProps: "transform" });
  }
  // 嵐の動きを ぜんぶ止めて、style.css の見た目に戻す(誕生のはじめ・場面が変わったとき)
  function stopShows() {
    stopWeather();
    // 雨と風の音も フェードして止める(誕生では 晴れて静かになり、はじける音が よく聞こえる)
    if (window.sfx && window.sfx.storm) window.sfx.storm(0);
    stopBeat();
    gsap.killTweensOf([...showParts, land, sceneArt]);
    clear([...showParts, land, sceneArt])();
    shownOpacity.clear();
    stopPowerFx();
  }

  // ----------------------------------------------------------------------
  // がったい中の連打:雷パワーを ためる(2026年11月16日。core.js が数えて powertap を送る。ゲージの たまり具合は style.css)
  //   押すたびに 細い雷が 落ちる(3本を使い回す。7割は うずの ふち、3割は 地面。始まりは 上の はしの どこでも。画面は光らせない)
  //   → 落ちたところから 火花が ゲージの たまった先へ 飛び、着くと ゲージが はずむ・画面が 小さく揺れる(たまるほど強く)
  //   見た目は 0.08秒に1回まで。1/3「いいぞ!」・2/3「もっと!」・満タン「パワー MAX!」+ 落雷(この回で はじめて こえたときだけ)
  //   満タンのあいだは ゲージが 脈打つ
  // ----------------------------------------------------------------------
  const boltTaps = $$(".bolt-tap");
  const powerGauge = $(".power-gauge");
  const powerTube = $(".power-tube");
  const powerLabel = $(".power-label");
  const powerPop = $(".power-pop");
  const sparks = $$(".power-sparks i");
  const powerParts = [...boltTaps, powerGauge, powerTube, powerLabel, powerPop, ...sparks];
  const POWER_MARKS = [[1 / 3, "いいぞ!"], [2 / 3, "もっと!"], [1, "パワー MAX!"]];
  const TAP_FX_GAP_MS = 80;
  const TUBE_HEIGHT = 460;   // style.css の .power-tube の 中の高さ
  let lastTapFx = -Infinity;
  let boltTapIndex = 0;
  let sparkIndex = 0;
  let fullPulse = null;
  let seenPeak = 0;   // ひとことを出し終えた いちばん高い値

  // 連打の雷の 落ちる先(舞台の座標)
  function tapTarget() {
    if (Math.random() < 0.7) {
      const angle = gsap.utils.random(0, Math.PI * 2);
      const radius = gsap.utils.random(40, 150);
      return [960 + Math.cos(angle) * radius, 520 + Math.sin(angle) * radius * 0.8];
    }
    const left = Math.random() < 0.5;
    return [left ? gsap.utils.random(300, 760) : gsap.utils.random(1160, 1560), gsap.utils.random(760, 840)];
  }

  // ゲージの たまった先(舞台の座標。舞台は 画面に合わせて 縮めて映しているので、見た目の px を 舞台の px に直す)
  // ※ 軽くするため(2026年11月16日):押すたびに getBoundingClientRect で測ると、そのたびに 画面の形を計算し直させて重かった。
  //   ゲージは動かないので、舞台の中での位置(offset。揺れ・はずみ・舞台の拡大縮小の影響を受けない)を 1回だけ測って覚える
  let tubeAt = null;
  function gaugeTip(ratio) {
    if (!tubeAt && powerTube.offsetWidth) {
      tubeAt = {
        x: powerGauge.offsetLeft + powerTube.offsetLeft + powerTube.offsetWidth / 2,
        top: powerGauge.offsetTop + powerTube.offsetTop + 6,   // 6:管のふちの太さ
      };
    }
    const at = tubeAt || { x: 1660, top: 330 };
    return [at.x, at.top + (1 - ratio) * TUBE_HEIGHT];
  }

  // 火花:(x, y) から ゲージへ 弧を描いて飛び、着いたら(withBounce なら)ゲージが はずむ
  function flySpark(x, y, ratio, withBounce) {
    const spark = sparks[sparkIndex++ % sparks.length];
    const [tx, ty] = gaugeTip(ratio);
    gsap.killTweensOf(spark);
    gsap.timeline({ onComplete: clear(spark) })
      .set(spark, { x, y, opacity: 1, scale: gsap.utils.random(0.8, 1.4) })
      .to(spark, {
        keyframes: { x: [x, (x + tx) / 2 + gsap.utils.random(-60, 60), tx], y: [y, Math.min(y, ty) - gsap.utils.random(80, 180), ty] },
        duration: gsap.utils.random(0.32, 0.42),
        ease: "power1.in",
      })
      .add(() => {
        if (!withBounce) return;
        gsap.fromTo(powerTube, { scaleX: 1.16, scaleY: 0.95 },
          { scaleX: 1, scaleY: 1, duration: 0.35, ease: "back.out(3)", overwrite: "auto", onComplete: clear(powerTube) });
      })
      .to(spark, { scale: 2.2, opacity: 0, duration: 0.15, ease: "power2.out" });
  }

  stage.addEventListener("powertap", (ev) => {
    if (stage.dataset.scene !== "s3") return;
    const { power, peak, max } = ev.detail;
    const ratio = power / max;
    // 区切りを この回で はじめて こえた1回だけ ひとこと(減ってから また こえても・満タンのまま押しても 出さない)。
    // いちばん たまった値(peak)が 上がったときだけ 見る。peak が下がった = 新しい がったい
    if (peak < seenPeak) seenPeak = 0;
    if (peak > seenPeak) {
      const mark = POWER_MARKS.find(([r]) => {
        const at = Math.ceil(r * max);
        return seenPeak < at && peak >= at;
      });
      seenPeak = peak;
      if (mark) popPower(mark[1], mark[0] === 1);
    }

    const now = performance.now();
    if (now - lastTapFx < TAP_FX_GAP_MS) return;
    lastTapFx = now;
    const [x, y] = tapTarget();
    const bolt = boltTaps[boltTapIndex++ % boltTaps.length];
    bolt.setAttribute("d", toD(boltPath(x, y, 35)));
    gsap.killTweensOf(bolt);
    gsap.timeline({ onComplete: clear(bolt) })
      .set(bolt, { opacity: 1 })
      .to(bolt, { opacity: 0.3, duration: 0.05 })
      .to(bolt, { opacity: 1, duration: 0.04 })
      .to(bolt, { opacity: 0, duration: 0.2, ease: "power2.in" });
    flySpark(x, y, ratio, true);
    flySpark(x, y, ratio, false);
    shakeScene(3 + 4 * ratio);
    for (let i = 0; i < 3; i++) spawnMote(2.4);
  });

  function popPower(text, full) {
    gsap.killTweensOf(powerPop);
    powerPop.textContent = text;
    gsap.timeline({ onComplete: clear(powerPop) })
      .fromTo(powerPop, { opacity: 1, scale: 0.3, y: 30 }, { scale: 1, y: 0, duration: 0.4, ease: "back.out(3)" })
      .to(powerPop, { opacity: 0, y: -30, duration: 0.35, ease: "power2.in" }, "+=0.6");
    if (full) {
      strike({ onVortex: true });
      gsap.fromTo(powerLabel, { scale: 1.4 }, { scale: 1, duration: 0.5, ease: "back.out(3)", onComplete: clear(powerLabel) });
      // 満タンのあいだ ゲージが 脈打つ(誕生・場面が変わったら stopPowerFx で止める)
      if (!fullPulse) fullPulse = gsap.to(powerGauge, { scale: 1.06, duration: 0.35, ease: "sine.inOut", repeat: -1, yoyo: true });
    }
  }

  function stopPowerFx() {
    if (fullPulse) { fullPulse.kill(); fullPulse = null; }
    seenPeak = 0;
    gsap.killTweensOf(powerParts);
    clear(powerParts)();
  }

  // いまの パワー(0〜1。core.js が #stage に付ける --power)
  const powerRatio = () => Number(powerGauge.style.getPropertyValue("--power")) || 0;   // core.js が #power-meter に書く

  // ----------------------------------------------------------------------
  // がったい中:途中の絵が届いたら「みえてきた!」(game-feel の small〜medium。揺れ・ヒットストップは使わない)
  //   中心の光が ぽわっと ふくらむ → 窓が強いぼかしから 段の見た目(style.css)へ晴れる → 金の輪が 広がって戻る
  //   → ひとことが はずむ → 粒が吸いこまれる。光るのは 1回だけ(点滅は 1秒に3回以下)
  //   終わったら style を消す(style.css の段の指定と s4 の見た目を上書きしないように)
  // ----------------------------------------------------------------------
  const peek = $(".vortex-peek");
  const peekRing = $(".peek-ring");
  const peekCaption = $(".peek-caption-text");
  const core = $(".vortex-core");
  const peekParts = [peek, peekRing, peekCaption, core];
  stage.addEventListener("partialchange", () => {
    if (stage.dataset.scene !== "s3") return;
    gsap.killTweensOf(peekParts);
    gsap.set(peekParts, { clearProps: "all" });
    const done = () => gsap.set(peekParts, { clearProps: "all" });
    // 窓は「まぶしく・強くぼかした」ところから 段の見た目へ晴れる。
    // filter は関数の並びがそろっていないと なめらかに動かないので、いまの段の値(style.css)から 明るさとぼかしだけを変えて作る
    const { filter: target, opacity: targetOpacity } = getComputedStyle(peek);
    const glare = target === "none" ? "brightness(1.6) blur(24px)"
      : target.replace(/brightness\([^)]*\)/, "brightness(1.6)").replace(/blur\([^)]*\)/, "blur(24px)");
    gsap.timeline({ onComplete: done })
      // 中心の光の大きさは style.css が --progress で決めているので、いまの大きさからの相対で ふくらませて戻す
      .to(core, { scale: "+=0.5", duration: 0.18, ease: "power2.out" }, 0)
      .to(core, { scale: "-=0.5", duration: 0.6, ease: "power2.inOut" }, 0.18)
      .fromTo(peek, { scale: 0.85, opacity: 0, filter: glare }, { scale: 1, opacity: targetOpacity, filter: target, duration: 0.8, ease: "power2.out" }, 0.1)
      .fromTo(peekRing, { scale: 0.9, opacity: 1 }, { scale: 1.12, duration: 0.25, ease: "power2.out" }, 0.1)
      .to(peekRing, { scale: 1, duration: 0.6, ease: "back.out(2)" }, 0.35)
      .fromTo(peekCaption, { scale: 0.6, y: 10 }, { scale: 1, y: 0, duration: 0.5, ease: "back.out(3)" }, 0.2);
    shockwave($(".shock-2"), { scale: 2, duration: 0.7 });
    for (let i = 0; i < 12; i++) spawnMote(1.6);
    if (window.sfx) window.sfx.play("tick");
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
    }
    // がったい中から 誕生以外(撮り直し・エラー・開発者メニュー)へ移ったら、段ごとの見せ場を止める。
    // 誕生(s4)へは birth() が先に止めている(ここで止めると、誕生の揺れまで消してしまう)
    if (lastScene === "s3" && scene !== "s4") stopShows();
    lastScene = scene;
    onScene();
  }).observe(stage, { attributes: true, attributeFilter: ["data-scene"] });
  onScene();

  // ----------------------------------------------------------------------
  // 誕生(core.js の playBirth から呼ばれる)
  // ----------------------------------------------------------------------
  function birth(showCard) {
    stopMotes();
    // 途中の絵の「みえてきた!」の動きが残っていたら止める(s4 で 途中の絵が見えないように)
    gsap.killTweensOf(peekParts);
    gsap.set(peekParts, { clearProps: "all" });
    // 嵐(落雷・風・鼓動)も止める。雲・雨・暗さは style.css の [data-level="5"] のまま残り、s4 で消える(= 晴れる)
    stopShows();
    // 嵐の しめくくり:うずへ 特大の落雷(このあと うずが縮んで はじける)
    strike({ onVortex: true, big: true });
    // 連打のパワーが 満タンなら、特大の落雷を もう1本(画面の白い光は 1回目だけ。strike の見張り)
    const power = powerRatio();
    if (power >= 1) gsap.delayedCall(0.3, () => strike({ onVortex: true, big: true }));
    // カードの絵を、うずが縮んでいるあいだに先に展開しておく(カードを出す瞬間に、大きな絵の展開で止まらないように)
    const img = $("#card-img");
    if (img.getAttribute("src") && img.decode) img.decode().catch(() => {});
    const card = $("#card");
    const nameEl = $("#card-name");
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
    // 葉と花びらは 連打のパワーに合わせて 60〜120
    tl.add(() => particlesReady.then(() => burstShards(60 + Math.round(60 * power))), "pop");
    // 嵐が晴れる:雲・雨・暗さは s4 の CSS で消え、上から光の筋が差しこんで ゆっくり消える
    // (tl とは別の動きにする。光が消えるまで 誕生の終わりを 待たせない)
    tl.add(() => {
      gsap.timeline({ onComplete: clear(sunBreak) })
        .fromTo(sunBreak, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.6, ease: "power2.out" })
        .to(sunBreak, { opacity: 0, duration: 2.2, ease: "power1.in" }, "+=0.8");
    }, "pop+=0.05");
    // ゆらすのは、うずのまわりだけ(画面ぜんたいをゆらすと、カードや背景まで描き直しになって重い)
    tl.to(area, { keyframes: { x: [0, -30, 26, -20, 15, -9, 5, 0], y: [0, 17, -14, 10, -6, 3, 0, 0] }, duration: 0.6, ease: "none" }, "pop");
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
          // 途中で名前が選ばれて書きかわっていたら、元に戻さない
          onComplete: () => { if (nameEl.contains(split.chars[0])) split.revert(); },
        });
      }, "pop+=1.1");
      // 名前の演出が終わるまで待つ
      tl.to({}, { duration: 0.55 + 0.07 * nameEl.textContent.length }, "pop+=1.1");
    }

    return new Promise((resolve) => {
      tl.eventCallback("onComplete", () => {
        clearMotes();
        resolve();
      });
    });
  }

  window.themeFx = { birth };
})();

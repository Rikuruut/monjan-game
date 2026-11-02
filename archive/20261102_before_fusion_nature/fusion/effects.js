// 融合のうずテーマの演出(GSAP と tsParticles)。app.js より前に読む
//
//   - s2・がったい中(s3):光の粒が、うずのふちから らせんを描いて中心へ吸いこまれる(段が上がるほど増える)。
//                         段が上がるたびに、うずが「どくん」と脈打ち、小さな衝撃波が広がる
//   - 誕生(s3 → s4):うずが加速しながら中心の一点に縮む → ピタッと止まる → 白い閃光と衝撃波 → 光のかけらが飛び散る
//                     → 画面がゆれ、うずが大きく広がって残る → カードが回りながら出る → 名前が1文字ずつ跳ねる
//
// うずの明るさ・玉の位置(--progress / data-level)は style.css の静的な指定のまま。ここでは1回きりの動きだけを足す。
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
  const flash = $(".fx-flash");
  const art = $(".scene-art");

  // 演出で動かした要素(場面が s4 から変わったら、GSAP が付けた style を消して元に戻す)
  const moved = () => [vortex, point, flash, art, $("#card"), ...$$(".shock")];

  // ----------------------------------------------------------------------
  // 吸いこまれる光の粒(DOM の小さな点。外側を回しながら、中の点を中心へ動かして、らせんを描く)
  // ----------------------------------------------------------------------
  // 段ごとの、1秒あたりの粒の数(0 まだ / 1 なまえ / 2 絵をかき始めた / 3 半分すぎ / 4 もうすぐ / 5 できた)
  const MOTES_PER_SEC = [0, 4, 7, 11, 16, 22];
  const MOTES_PER_SEC_S2 = 3;
  const MAX_MOTES = 90;
  let moteTimer = null;
  let moteCarry = 0;

  function spawnMote(speed = 1) {
    if (inflow.childElementCount >= MAX_MOTES) return;
    const mote = document.createElement("span");
    mote.className = "mote";
    const dot = document.createElement("i");
    mote.appendChild(dot);
    inflow.appendChild(mote);
    const size = gsap.utils.random(5, 12);
    const start = gsap.utils.random(0, 360);
    const radius = gsap.utils.random(250, 330);
    const dur = gsap.utils.random(1.1, 1.8) / speed;
    gsap.set(dot, { width: size, height: size, xPercent: -50, yPercent: -50, x: radius, opacity: 0 });
    gsap.set(mote, { rotation: start });
    // うずと同じ時計回りに回りながら、中心へ近づくほど速くなる
    gsap.to(mote, { rotation: start + gsap.utils.random(150, 240), duration: dur, ease: "power2.in" });
    gsap.timeline({ onComplete: () => mote.remove() })
      .to(dot, { x: 8, scale: 0.3, duration: dur, ease: "power2.in" }, 0)
      .to(dot, { opacity: 1, duration: dur * 0.25 }, 0)
      .to(dot, { opacity: 0, duration: dur * 0.2 }, dur * 0.8);
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
    Array.from(inflow.children).forEach((m) => { gsap.killTweensOf([m, m.firstChild]); m.remove(); });
  }

  // ----------------------------------------------------------------------
  // はじけて飛び散る光のかけら(tsParticles)
  // ----------------------------------------------------------------------
  const shardSvg = (fill) =>
    "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 0 L15 9 L24 12 L15 15 L12 24 L9 15 L0 12 L9 9Z" fill="${fill}"/></svg>`);
  const diamondSvg = (fill) =>
    "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 28"><path d="M8 0 L16 14 L8 28 L0 14Z" fill="${fill}"/></svg>`);

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
                { src: shardSvg("#FFFFFF"), width: 24, height: 24 },
                { src: shardSvg("#7FE3FF"), width: 24, height: 24 },
                { src: diamondSvg("#F4FBFF"), width: 16, height: 28 },
                { src: diamondSvg("#2E7BFF"), width: 16, height: 28 },
                { src: diamondSvg("#8A6BFF"), width: 16, height: 28 },
              ],
            },
          },
          size: { value: { min: 10, max: 24 } },
          opacity: { value: { min: 0, max: 1 }, animation: { enable: true, speed: 0.5, startValue: "max", destroy: "min" } },
          rotate: { value: { min: 0, max: 360 }, direction: "random", animation: { enable: true, speed: 40 } },
          // 向きを決めないと、それぞれ ばらばらの向きへ飛ぶ(中心から放射状に広がる)
          move: {
            enable: true,
            direction: "none",
            speed: { min: 20, max: 55 },
            decay: 0.04,
            outModes: { default: "destroy" },
          },
          life: { count: 1, duration: { value: { min: 1.6, max: 2.6 } } },
        },
      },
    });
  }
  const particlesReady = initParticles().catch((e) => console.error("光のかけらの準備に失敗しました", e));

  // 舞台の座標で、canvas に粒を足す
  function addParticleAt(container, host, x, y) {
    const canvas = host.querySelector("canvas");
    if (!container || !canvas || !host.offsetWidth) return;
    const ratio = canvas.width / host.offsetWidth;
    container.particles.addParticle({ x: x * ratio, y: y * ratio });
  }

  function burstShards() {
    const host = $("#fx-shards");
    const area = $(".vortex-area");
    const cx = area.offsetLeft + area.offsetWidth / 2;
    const cy = area.offsetTop + area.offsetHeight / 2;
    for (let i = 0; i < 90; i++) {
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
  // 誕生(app.js の playBirth から呼ばれる)
  // ----------------------------------------------------------------------
  function birth(showCard) {
    stopMotes();
    const card = $("#card");
    const nameEl = $("#card-name");
    stage.classList.add("fx-hold");
    gsap.set(card, { autoAlpha: 0 });  // s4 になった瞬間にカードが見えないように

    const tl = gsap.timeline();

    // 1. うずが加速しながら、中心の一点に縮む(まわりの光の粒も、いっせいに吸いこまれる)
    tl.to(vortex, { rotation: "+=600", scale: 0.06, duration: 1.0, ease: "power3.in" });
    tl.add(() => { for (let i = 0; i < 40; i++) spawnMote(2.2); }, 0);
    tl.fromTo(point, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.in" }, 0.55);

    // 2. ピタッと止まる(ここの「間」が大事)。光の点だけが、小さくふるえる
    tl.to(point, { keyframes: { x: [0, -3, 3, -2, 2, 0], scale: [1, 1.1, 0.95, 1.15, 1] }, duration: 0.4, ease: "none" });

    // 3. はじける:白い閃光・衝撃波・光のかけら・画面のゆれ
    tl.add("pop");
    tl.add(() => { showCard(); gsap.set(card, { autoAlpha: 0 }); if (window.sfx) sfx.play("crack"); }, "pop");
    tl.fromTo(flash, { opacity: 0 }, { opacity: 0.95, duration: 0.07, ease: "power1.in" }, "pop");
    tl.to(flash, { opacity: 0, duration: 0.8, ease: "power2.out" }, "pop+=0.07");
    tl.to(point, { scale: 5, opacity: 0, duration: 0.5, ease: "power2.out" }, "pop");
    tl.add(() => {
      shockwave($(".shock-1"), { scale: 4.5, duration: 1.0 });
      shockwave($(".shock-2"), { scale: 3.4, duration: 1.1, delay: 0.12 });
    }, "pop");
    tl.add(() => particlesReady.then(burstShards), "pop");
    tl.to(art, { keyframes: { x: [0, -18, 16, -12, 10, -6, 4, 0], y: [0, 10, -8, 6, -4, 2, 0, 0] }, duration: 0.5, ease: "none" }, "pop");
    // うずは大きく広がって、カードのうしろに薄く残る(style.css の s4 と同じ見た目で終わる)
    tl.fromTo(vortex, { scale: 0.06, opacity: 1 }, { scale: 1.35, opacity: 0.6, rotation: "+=180", duration: 1.4, ease: "power2.out" }, "pop");

    // 4. カードが中心から回りながら出る
    tl.fromTo(card,
      { autoAlpha: 0, scale: 0.15, rotationY: -720, transformPerspective: 1400, filter: "brightness(3)" },
      { autoAlpha: 1, scale: 1, rotationY: 0, filter: "brightness(1)", duration: 1.1, ease: "back.out(1.3)" },
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

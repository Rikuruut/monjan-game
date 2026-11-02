// たまごテーマの演出(GSAP と tsParticles)。app.js より前に読む
//
//   - がったい中(s3):ひびのすき間から光の粒がもれる(段が上がるほど増える)。段が上がるたびに、たまごが「ぴょこっ」と跳ねる
//   - 誕生(s3 → s4):はげしく揺れる → ピタッと止まる → まぶしく光る → 割れる(かけらが落ちて跳ねる・葉っぱが舞う)
//                     → カードが回りながら出る → 名前が1文字ずつ跳ねる
//
// ひびの伸び具合(--progress / data-level)は style.css の静的な指定のまま。ここでは1回きりの動きだけを足す。
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
  const area = $(".egg-area");
  const egg = $(".egg");

  // まぶしい光(誕生の瞬間だけ使う)
  const flash = document.createElement("div");
  flash.className = "egg-flash";
  area.appendChild(flash);

  // 演出で動かした要素(場面が s4 から変わったら、GSAP が付けた style を消して元に戻す)
  const moved = () => [area, flash, $(".egg-glow"), $(".shell-top"), $(".shell-bottom"), $(".big-nest"), $("#card"), ...$$(".chip")];

  // ----------------------------------------------------------------------
  // 光の粒(tsParticles)
  // ----------------------------------------------------------------------
  // 段ごとの、1秒あたりの粒の数(0 まだ / 1 なまえ / 2 絵をかき始めた / 3 半分すぎ / 4 もうすぐ / 5 できた)
  const SPARKS_PER_SEC = [0, 2, 4, 7, 12, 16];
  // 葉っぱ・花びらの紙吹雪の絵(テーマの色:若葉・深い緑・殻の白・孵化の光の橙)
  const leafSvg = (fill) =>
    "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 24"><path d="M2 12 C10 0 30 0 38 12 C30 24 10 24 2 12Z" fill="${fill}"/>` +
      `<path d="M5 12 H35" stroke="#23423A" stroke-width="1.6" opacity=".45"/></svg>`);
  const petalSvg = (fill) =>
    "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 C20 6 20 18 12 22 C4 18 4 6 12 2Z" fill="${fill}"/></svg>`);

  let sparks = null;     // ひびからもれる光の粒(たまごのまわり)
  let confetti = null;   // 誕生の紙吹雪(舞台ぜんたい)
  let sparkTimer = null;
  let sparkCarry = 0;

  async function initParticles() {
    if (!window.tsParticles) return;
    if (window.loadFull) await loadFull(tsParticles);
    sparks = await tsParticles.load({
      id: "egg-particles",
      options: {
        fullScreen: { enable: false },
        background: { color: "transparent" },
        detectRetina: true,
        fpsLimit: 60,
        particles: {
          number: { value: 0 },
          // 白いたまごの上でも見えるように、あたたかい色で少し大きめ
          // ※ tsParticles 4 では、色は paint の中に書く(particles.color では効かず、白になる)
          paint: { color: { value: ["#FFC93C", "#FFB13C", "#F28C28"] } },
          shape: { type: "circle" },
          size: { value: { min: 4, max: 9 } },
          // だんだん薄くなって消える(min と max を同じにすると、出た瞬間に消える)
          opacity: { value: { min: 0, max: 1 }, animation: { enable: true, speed: 0.7, startValue: "max", destroy: "min" } },
          shadow: { enable: true, color: "#FFC93C", blur: 14 },
          move: {
            enable: true,
            direction: "top",
            speed: { min: 1.2, max: 3.5 },
            random: true,
            outModes: { default: "destroy" },
          },
          life: { count: 1, duration: { value: { min: 1.2, max: 2.4 } } },
        },
      },
    });
    confetti = await tsParticles.load({
      id: "fx-confetti",
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
                { src: leafSvg("#8CCB5E"), width: 40, height: 24 },
                { src: leafSvg("#6FAF45"), width: 40, height: 24 },
                { src: leafSvg("#B7DE8C"), width: 40, height: 24 },
                { src: petalSvg("#FFF4DC"), width: 24, height: 24 },
                { src: petalSvg("#FFC93C"), width: 24, height: 24 },
              ],
            },
          },
          size: { value: { min: 12, max: 22 } },
          opacity: { value: 1 },
          rotate: { value: { min: 0, max: 360 }, direction: "random", animation: { enable: true, speed: 30 } },
          tilt: { enable: true, value: { min: 0, max: 360 }, direction: "random", animation: { enable: true, speed: 30 } },
          wobble: { enable: true, distance: 30, speed: { min: -15, max: 15 } },
          move: {
            enable: true,
            direction: "top",
            angle: { value: 70, offset: 0 },
            speed: { min: 18, max: 42 },
            decay: 0.06,
            gravity: { enable: true, acceleration: 14 },
            outModes: { default: "destroy", top: "none" },
          },
          life: { count: 1, duration: { value: { min: 3, max: 4.5 } } },
        },
      },
    });
  }
  const particlesReady = initParticles().catch((e) => console.error("光の粒の準備に失敗しました", e));

  // 粒の位置(要素の中の座標)を、canvas の座標に変える
  function addParticleAt(container, host, x, y) {
    const canvas = host.querySelector("canvas");
    if (!container || !canvas || !host.offsetWidth) return;
    const ratio = canvas.width / host.offsetWidth;
    container.particles.addParticle({ x: x * ratio, y: y * ratio });
  }

  // いま見えている ひび の上の、どこか1点(.egg-area の中の座標)
  function crackPoint() {
    const progress = parseFloat(getComputedStyle(stage).getPropertyValue("--progress")) || 0;
    const visible = $$(".crack").map((path) => {
      const a = parseFloat(path.style.getPropertyValue("--a"));
      const w = parseFloat(path.style.getPropertyValue("--w"));
      return { path, grow: Math.min(1, Math.max(0, (progress - a) / w)) };
    }).filter((c) => c.grow > 0);
    if (!visible.length) return null;
    const c = visible[Math.floor(Math.random() * visible.length)];
    const p = c.path.getPointAtLength(Math.random() * c.grow * c.path.getTotalLength());
    // ひびの座標は .egg(380×480)の中。.egg は .egg-area の中の (190, 20) にある
    return { x: egg.offsetLeft + p.x, y: egg.offsetTop + p.y };
  }

  function emitSparks(count) {
    const host = $("#egg-particles");
    for (let i = 0; i < count; i++) {
      const p = crackPoint();
      if (p) addParticleAt(sparks, host, p.x, p.y);
    }
  }

  function startSparks() {
    stopSparks();
    const tickMs = 100;
    sparkTimer = setInterval(() => {
      const level = Number(stage.dataset.level || 0);
      sparkCarry += (SPARKS_PER_SEC[level] || 0) * tickMs / 1000;
      const n = Math.floor(sparkCarry);
      sparkCarry -= n;
      if (n) emitSparks(n);
    }, tickMs);
  }

  function stopSparks() {
    clearInterval(sparkTimer);
    sparkTimer = null;
    sparkCarry = 0;
  }

  function burstConfetti() {
    const host = $("#fx-confetti");
    // たまごの真ん中あたり(舞台の座標)から、上に向かって飛び出す
    const cx = area.offsetLeft + egg.offsetLeft + egg.offsetWidth / 2;
    const cy = area.offsetTop + egg.offsetTop + egg.offsetHeight * 0.45;
    for (let i = 0; i < 70; i++) {
      addParticleAt(confetti, host, cx + gsap.utils.random(-90, 90), cy + gsap.utils.random(-40, 40));
    }
  }

  // ----------------------------------------------------------------------
  // がったい中:段が上がるたびに「ぴょこっ」
  // ----------------------------------------------------------------------
  stage.addEventListener("levelchange", (ev) => {
    const { level, prev } = ev.detail;
    if (stage.dataset.scene !== "s3" || level <= prev || level >= 5) return;
    gsap.timeline()
      .to(area, { y: -26, scaleY: 1.03, duration: 0.16, ease: "power2.out" })
      .to(area, { y: 0, scaleY: 1, duration: 0.55, ease: "bounce.out" });
    particlesReady.then(() => emitSparks(8 + level * 3));
  });

  // 場面が変わったら、粒を出す・止める。s4 から離れたら、演出で動かした要素を元に戻す
  let lastScene = stage.dataset.scene;
  new MutationObserver(() => {
    const scene = stage.dataset.scene;
    if (scene === lastScene) return;
    if (lastScene === "s4") {
      gsap.killTweensOf(moved());
      gsap.set(moved(), { clearProps: "all" });
      stage.classList.remove("fx-hold");
    }
    lastScene = scene;
    if (scene === "s3") particlesReady.then(() => { if (stage.dataset.scene === "s3") startSparks(); });
    else stopSparks();
  }).observe(stage, { attributes: true, attributeFilter: ["data-scene"] });

  // ----------------------------------------------------------------------
  // 誕生(app.js の playBirth から呼ばれる)
  // ----------------------------------------------------------------------
  function birth(showCard) {
    stopSparks();
    const glow = $(".egg-glow");
    const card = $("#card");
    const nameEl = $("#card-name");
    const chips = $$(".chip");
    stage.classList.add("fx-hold");    // CSS のゆれを止めて、ここで揺らす
    gsap.set(card, { autoAlpha: 0 });  // s4 になった瞬間にカードが見えないように

    const tl = gsap.timeline();

    // 1. はげしく揺れる(光もふくらむ)
    tl.to(area, {
      keyframes: { x: [0, -16, 16, -14, 14, -10, 10, -6, 6, 0], rotation: [0, -3, 3, -3, 3, -2, 2, -1, 1, 0] },
      duration: 0.7,
      ease: "none",
    });
    tl.to(glow, { opacity: 1, scale: 1.25, duration: 0.7, ease: "power1.in" }, 0);
    tl.add(() => particlesReady.then(() => emitSparks(30)), 0.3);

    // 2. ピタッと止まる(ここの「間」が大事)
    tl.to({}, { duration: 0.35 });

    // 3. まぶしく光る
    tl.fromTo(flash, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1.6, duration: 0.22, ease: "power2.in" });

    // 4. 割れる:s4 にして、上の殻は回りながら飛び、下の殻は沈み、巣は消える
    tl.add("pop");
    tl.add(() => { showCard(); gsap.set(card, { autoAlpha: 0 }); if (window.sfx) sfx.play("crack"); }, "pop");
    tl.to(flash, { opacity: 0, scale: 2.6, duration: 0.9, ease: "power2.out" }, "pop");
    tl.to(glow, { opacity: 0, scale: 2.2, duration: 1.0, ease: "power2.out" }, "pop");
    tl.fromTo($(".shell-top"), { x: 0, y: 0, rotation: 0 },
      { x: -90, y: -470, rotation: -48, duration: 0.95, ease: "power3.out" }, "pop");
    tl.to($(".shell-top"), { opacity: 0, duration: 0.35 }, "pop+=0.6");
    tl.to($(".shell-bottom"), { y: 160, opacity: 0, duration: 0.8, ease: "power2.in" }, "pop");
    tl.to($(".big-nest"), { opacity: 0, duration: 0.8 }, "pop");
    tl.add(() => particlesReady.then(burstConfetti), "pop");

    // 5. かけら:上に跳ね上がってから地面に落ちて跳ね、消える
    const ground = 300;   // かけらの出発点(たまごの真ん中)から地面までの高さ
    chips.forEach((chip, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const dx = side * gsap.utils.random(140, 460);
      const peak = -gsap.utils.random(140, 340);
      const up = gsap.utils.random(0.28, 0.4);
      const down = gsap.utils.random(0.8, 1.0);
      tl.set(chip, { xPercent: -50, yPercent: -50, x: 0, y: 0, rotation: 0, opacity: 1 }, "pop");
      tl.to(chip, { x: dx, duration: up + down, ease: "power1.out" }, "pop");
      tl.to(chip, { rotation: side * gsap.utils.random(240, 540), duration: up + down, ease: "power1.out" }, "pop");
      tl.to(chip, { y: peak, duration: up, ease: "power2.out" }, "pop");
      tl.to(chip, { y: ground, duration: down, ease: "bounce.out" }, `pop+=${up}`);
      tl.to(chip, { opacity: 0, duration: 0.4 }, `pop+=${up + down + 0.25}`);
    });

    // 6. カードが回りながら出る
    tl.fromTo(card,
      { autoAlpha: 0, scale: 0.25, rotationY: -540, transformPerspective: 1400, filter: "brightness(2.5)" },
      { autoAlpha: 1, scale: 1, rotationY: 0, filter: "brightness(1)", duration: 1.1, ease: "back.out(1.3)" },
      "pop+=0.35");
    tl.add(() => { if (window.sfx) sfx.play("fanfare"); }, "pop+=0.5");

    // 7. 名前が1文字ずつ跳ねる
    if (window.SplitText && nameEl.textContent.trim()) {
      let split = null;
      tl.add(() => {
        split = SplitText.create(nameEl, { type: "chars" });
        gsap.from(split.chars, {
          y: -70, scale: 0.3, autoAlpha: 0, duration: 0.55, ease: "back.out(3)", stagger: 0.07,
          // 途中でスマホから名前が選ばれて書きかわっていたら、元に戻さない
          onComplete: () => { if (nameEl.contains(split.chars[0])) split.revert(); },
        });
      }, "pop+=1.25");
      // 名前の演出が終わるまで待つ
      tl.to({}, { duration: 0.55 + 0.07 * nameEl.textContent.length }, "pop+=1.25");
    }

    return new Promise((resolve) => {
      tl.eventCallback("onComplete", () => {
        stage.classList.remove("fx-hold");
        resolve();
      });
    });
  }

  window.themeFx = { birth };
})();

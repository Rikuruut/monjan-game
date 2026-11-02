// 効果音(Howler.js)。どのテーマでも使う。app.js より前に読む
//
//   window.sfx.play("press") のように鳴らす。音の名前とファイルは下の SOUNDS。
//   音のファイルは static/sounds/ にある(今は仮の音。素材が決まったら、同じ名前のファイルを置きかえる)。
//   ?sound=0 を付けると鳴らさない。Howler が読めないときも、何もしないだけで画面は動く。
//
// ※ ブラウザは、画面を一度も押していないうちは音を鳴らさない(自動再生の制限)。
//   展示ではボタン(キー)を押してから音が出る流れなので、ふつうは困らない。
//   キオスク(--autoplay-policy=no-user-gesture-required)では、ページを開いたらすぐ鳴る。
//
// BGM(BGM の定数)は、ページを開いたらくり返し流す。止められたときは、最初の操作のあとに鳴らす。
//
// がったい中の BGM(FUSION_BGMS)は、window.sfx.fusionBgm(true) から false までくり返し流す(app.js が場面 s3 で呼ぶ)。
//   そのあいだ、いつもの BGM は BGM_DUCK_VOLUME まで小さくする。
//   どれを流すかは開発者メニューで選ぶ(window.sfx.setFusionBgm(番号)。0 は流さない)。選んだ番号はこのブラウザに残す。

(() => {
  const SOUNDS = {
    press:   { src: "/static/sounds/press.wav",   volume: 0.5 },   // ボタンを押した
    tick:    { src: "/static/sounds/tick.wav",    volume: 0.7 },   // ひびが増えた・進み具合が上がった
    crack:   { src: "/static/sounds/crack.wav",   volume: 0.8 },   // 割れる・ひらく(誕生の瞬間)
    fanfare: { src: "/static/sounds/fanfare.wav", volume: 0.6 },   // モンスターが生まれた
  };
  // 撮影・合体の BGM「光差し込む森」(OpenTracks(旧 DOVA-SYNDROME)のフリー BGM)
  const BGM = { src: "/static/sounds/bgm.mp3", volume: 0.3 };
  const BGM_DUCK_VOLUME = 0.08;   // がったい中の、いつもの BGM の音量

  // がったい中の BGM(番号 → ファイル)。2026年11月2日に依頼者が足した3曲
  const FUSION_BGMS = {
    1: "/static/sounds/fusion1.mp3",
    2: "/static/sounds/fusion2.mp3",
    3: "/static/sounds/fusion3.mp3",
  };
  const FUSION_BGM_VOLUME = 0.5;
  const DEFAULT_FUSION_BGM = 1;
  const FUSION_BGM_KEY = "monjan-fusion-bgm";   // localStorage。開発者メニューで選んだ番号
  const FADE_MS = 600;   // BGM の切りかえのフェード

  function readFusionNumber() {
    try {
      const value = localStorage.getItem(FUSION_BGM_KEY);
      if (value === "0" || FUSION_BGMS[value]) return Number(value);
    } catch (e) { /* 読めなければ既定の曲 */ }
    return DEFAULT_FUSION_BGM;
  }

  const muted = new URLSearchParams(location.search).get("sound") === "0";
  const howls = {};
  let bgm = null;
  if (window.Howl && !muted) {
    for (const [name, conf] of Object.entries(SOUNDS)) {
      howls[name] = new Howl({ src: [conf.src], volume: conf.volume, preload: true });
    }
    // html5:ファイルを全部読んで変換し終わるのを待たず、読みながら鳴らす(ページを移ってから鳴るまでが遅かった)
    bgm = new Howl({ src: [BGM.src], volume: BGM.volume, loop: true, html5: true, autoplay: true });
    // 自動再生を止められたら、最初の操作のあとに鳴らす(Howler の README の書き方)
    bgm.once("playerror", () => bgm.once("unlock", () => bgm.play()));
  }

  let fusionNumber = readFusionNumber();
  let fusionOn = false;
  let fusionHowl = null;

  // 音量を変える。鳴っていればフェード、まだ鳴っていなければ次に鳴るときの音量にする
  function fadeTo(howl, volume) {
    if (howl.playing()) howl.fade(howl.volume(), volume, FADE_MS);
    else howl.volume(volume);
  }

  function startFusionBgm() {
    const src = FUSION_BGMS[fusionNumber];
    if (!bgm || !src) return;
    fusionHowl = new Howl({ src: [src], volume: 0, loop: true, html5: true });
    fusionHowl.play();
    fusionHowl.fade(0, FUSION_BGM_VOLUME, FADE_MS);
  }

  function stopFusionBgm() {
    const howl = fusionHowl;
    fusionHowl = null;
    if (!howl) return;
    howl.fade(howl.volume(), 0, FADE_MS);
    howl.once("fade", () => howl.unload());
  }

  // がったい中の BGM が流れているあいだだけ、いつもの BGM を小さくする(「なし」のときは下げない)
  function duckBgm() {
    fadeTo(bgm, fusionHowl ? BGM_DUCK_VOLUME : BGM.volume);
  }

  window.sfx = {
    play(name) {
      const h = howls[name];
      if (h) h.play();
    },
    // がったい中の BGM を流す(true)・止める(false)。同じ値で何度呼んでもよい
    fusionBgm(on) {
      if (on === fusionOn) return;
      fusionOn = on;
      if (!bgm) return;
      if (on) startFusionBgm();
      else stopFusionBgm();
      duckBgm();
    },
    fusionBgmNumbers: Object.keys(FUSION_BGMS).map(Number),
    getFusionBgm() { return fusionNumber; },
    // がったい中の BGM を選ぶ(0 は流さない)。流している最中なら、その場で切りかえる
    setFusionBgm(number) {
      if (number !== 0 && !FUSION_BGMS[number]) return;
      fusionNumber = number;
      try { localStorage.setItem(FUSION_BGM_KEY, String(number)); } catch (e) { /* 残せなくても、このページでは切りかわる */ }
      if (fusionOn && bgm) {
        stopFusionBgm();
        startFusionBgm();
        duckBgm();
      }
    },
  };
})();

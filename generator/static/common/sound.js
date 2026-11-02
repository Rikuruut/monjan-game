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

(() => {
  const SOUNDS = {
    press:   { src: "/static/sounds/press.wav",   volume: 0.5 },   // ボタンを押した
    tick:    { src: "/static/sounds/tick.wav",    volume: 0.7 },   // ひびが増えた・進み具合が上がった
    crack:   { src: "/static/sounds/crack.wav",   volume: 0.8 },   // 割れる・ひらく(誕生の瞬間)
    fanfare: { src: "/static/sounds/fanfare.wav", volume: 0.6 },   // モンスターが生まれた
  };
  // 撮影・合体の BGM「光差し込む森」(OpenTracks(旧 DOVA-SYNDROME)のフリー BGM)
  const BGM = { src: "/static/sounds/bgm.mp3", volume: 0.3 };

  const muted = new URLSearchParams(location.search).get("sound") === "0";
  const howls = {};
  if (window.Howl && !muted) {
    for (const [name, conf] of Object.entries(SOUNDS)) {
      howls[name] = new Howl({ src: [conf.src], volume: conf.volume, preload: true });
    }
    // html5:ファイルを全部読んで変換し終わるのを待たず、読みながら鳴らす(ページを移ってから鳴るまでが遅かった)
    const bgm = new Howl({ src: [BGM.src], volume: BGM.volume, loop: true, html5: true, autoplay: true });
    // 自動再生を止められたら、最初の操作のあとに鳴らす(Howler の README の書き方)
    bgm.once("playerror", () => bgm.once("unlock", () => bgm.play()));
  }

  window.sfx = {
    play(name) {
      const h = howls[name];
      if (h) h.play();
    },
  };
})();

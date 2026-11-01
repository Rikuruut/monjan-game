// 効果音(Howler.js)。どのテーマでも使う。app.js より前に読む
//
//   window.sfx.play("press") のように鳴らす。音の名前とファイルは下の SOUNDS。
//   音のファイルは static/sounds/ にある(今は仮の音。素材が決まったら、同じ名前のファイルを置きかえる)。
//   ?sound=0 を付けると鳴らさない。Howler が読めないときも、何もしないだけで画面は動く。
//
// ※ ブラウザは、画面を一度も押していないうちは音を鳴らさない(自動再生の制限)。
//   展示ではボタン(キー)を押してから音が出る流れなので、ふつうは困らない。

(() => {
  const SOUNDS = {
    press:   { src: "/static/sounds/press.wav",   volume: 0.5 },   // ボタンを押した
    tick:    { src: "/static/sounds/tick.wav",    volume: 0.7 },   // ひびが増えた・進み具合が上がった
    crack:   { src: "/static/sounds/crack.wav",   volume: 0.8 },   // 割れる・ひらく(誕生の瞬間)
    fanfare: { src: "/static/sounds/fanfare.wav", volume: 0.6 },   // モンスターが生まれた
  };

  const muted = new URLSearchParams(location.search).get("sound") === "0";
  const howls = {};
  if (window.Howl && !muted) {
    for (const [name, conf] of Object.entries(SOUNDS)) {
      howls[name] = new Howl({ src: [conf.src], volume: conf.volume, preload: true });
    }
  }

  window.sfx = {
    play(name) {
      const h = howls[name];
      if (h) h.play();
    },
  };
})();

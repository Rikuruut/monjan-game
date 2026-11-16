import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/title.css';
import './styles/battle.css';
import './styles/effects.css';
import './styles/result.css';
import './styles/cardbattle.css';
import './styles/devmenu.css';

// 字体は撮影・合体の画面と同じもの(Dela Gothic One・M PLUS Rounded 1c)を、サーバー(generator)の static/vendor/fonts/ から読む。
// index.html に書くとビルドが /battle/ の中のファイルとして扱おうとするので、ここで足す。
// サーバーがないとき(npm run dev で単体のとき)は、代わりの字体で表示される
const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = '/static/vendor/fonts/gacha.css';
document.head.appendChild(fonts);

// キオスクで 右クリック・長押しのメニュー(画像検索など)・ドラッグ・文字の選択を 始めさせない(CSS の base.css と2重に)。
// 入力欄と 開発者メニューの中は ふつうのまま(撮影側は generator/static/common/core.js に同じもの)
for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
  document.addEventListener(type, (ev) => {
    // selectstart は 文字(テキストノード)が対象になることがあるので、そのときは 親の要素で見る
    const target = ev.target instanceof Text ? ev.target.parentElement : ev.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], .dev")) return;
    ev.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

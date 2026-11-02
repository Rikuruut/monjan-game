import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/title.css';
import './styles/battle.css';
import './styles/effects.css';
import './styles/result.css';
import './styles/devmenu.css';

// 字体は撮影・合体の画面と同じもの(Dela Gothic One・M PLUS Rounded 1c)を、サーバー(generator)の static/vendor/fonts/ から読む。
// index.html に書くとビルドが /battle/ の中のファイルとして扱おうとするので、ここで足す。
// サーバーがないとき(npm run dev で単体のとき)は、代わりの字体で表示される
const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = '/static/vendor/fonts/gacha.css';
document.head.appendChild(fonts);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

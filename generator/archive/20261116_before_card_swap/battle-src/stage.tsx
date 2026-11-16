import { useEffect, type ReactNode } from 'react';

// 1920×1080 の「舞台」を、窓の大きさに合わせて拡大・縮小する。
// 撮影・合体の画面(generator/static/common/core.js の fitStage)と同じ式。中はすべて px で配置する
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

function fitStage() {
  const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
  document.documentElement.style.setProperty('--scale', String(scale));
}

export function Stage({ children }: { children: ReactNode }) {
  useEffect(() => {
    fitStage();
    window.addEventListener('resize', fitStage);
    return () => window.removeEventListener('resize', fitStage);
  }, []);

  return <div className="stage">{children}</div>;
}

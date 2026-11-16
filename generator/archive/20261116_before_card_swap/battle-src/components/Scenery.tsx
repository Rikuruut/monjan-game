import { Drift } from '../BattleEffects';
import { assetUrl } from '../integration';

export const TITLE_LOGO_PATH = assetUrl('/assets/monjan-title-logo.png');

/** モンじゃん! のロゴ(タイトル・バトルの立て札・結果の画面で、大きさは CSS で変える) */
export function Logo({ className, alt = 'モンじゃん！' }: { className: string; alt?: string }) {
  return <img className={className} src={TITLE_LOGO_PATH} alt={alt} width={1774} height={887} draggable={false} />;
}

/** 画面のうしろの飾り:ふちの暗がり・(結果の画面は)回る光・舞い落ちる葉と花びら */
export function Backdrop({ rays = false }: { rays?: boolean }) {
  return (
    <>
      <div className="scene-vignette" aria-hidden="true" />
      {rays && <div className="result-rays" aria-hidden="true" />}
      <Drift />
    </>
  );
}

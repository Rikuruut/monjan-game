import { createContext, useContext, type CSSProperties } from 'react';
import { HAND_META, HandIcon } from '../components/HandIcon';
import { cx } from '../cx';
import type { CardFace, SkillName } from '../game/cards';
import { DEFAULT_BATTLE_CONFIG } from '../game/config';

// スキル・必殺技のカードの絵と名前(アイコンの差しかえは ここだけ)。
// icon が 'draw-stack' のときは 絵文字ではなく 裏向きのカード3枚 +「+3」(DrawStackIcon。2026年11月18日 依頼者が選んだ)。
// reset の 🔄 は まだ仮
const SKILL_META: Record<SkillName, { icon: string; label: string }> = {
  heal: { icon: '💚', label: '回復' },
  seal: { icon: '⛓️', label: 'ふうじて' },
  draw3: { icon: 'draw-stack', label: '3まい ひく' },
  reset: { icon: '🔄', label: 'いれかえ' },
};

/**
 * 必殺技カードの絵と名前(2026年11月18日 依頼者が選んだ):
 * 絵は 自分のモンスターの絵(それまでは ⚡ で、雷タイプのアイコンと同じに見えた)、
 * 下の名前は タイプの技の言葉(カットインの技名の後ろ半分。雷 → サンダー。それまでは「技」)。上の札は「ひっさつ」。
 * CardBattle が 自分のモンスターの絵の URL と 言葉を 渡す。ないとき(テスト・単体の見本)は 💥 と「わざ」
 */
export const FinisherArtContext = createContext<{ image?: string; word?: string }>({});

/** 長い言葉(スプラッシュ など)は 横に縮めて 枠に収める(4文字まで そのまま) */
function nameSqueeze(text: string): number {
  return Math.min(1, 4.2 / Math.max(1, [...text].length));
}

function FinisherArt() {
  const { image } = useContext(FinisherArtContext);
  if (!image) return <>💥</>;
  return (
    <span className="cb-finisher-art">
      <img className="cb-finisher-art__img" src={image} alt="" draggable={false} />
    </span>
  );
}

/**
 * 「3まい ひく」の絵:山札と同じ裏面の 小さなカード3枚を ずらして重ね、右下に「+3」。
 * 大きさは em(親の .cb-card__icon の字の大きさ)で決まるので、どの大きさのカードでも そのまま縮む(cardbattle.css の .cb-draw-icon)
 */
function DrawStackIcon() {
  return (
    <span className="cb-draw-icon">
      <span className="cb-draw-icon__card" />
      <span className="cb-draw-icon__card" />
      <span className="cb-draw-icon__card" />
      <span className="cb-draw-icon__plus">+{DEFAULT_BATTLE_CONFIG.drawSkillCount}</span>
    </span>
  );
}

/** カードの名前(読み上げ・説明に使う) */
export function cardLabel(card: CardFace): string {
  if (card.kind === 'janken') return `${HAND_META[card.hand].label} ★${card.star}`;
  if (card.kind === 'skill') return SKILL_META[card.skill].label;
  return '必殺技';
}

/** カードの名前だけ(★なし) */
export function cardName(card: CardFace): string {
  if (card.kind === 'janken') return HAND_META[card.hand].label;
  if (card.kind === 'skill') return SKILL_META[card.skill].label;
  return '必殺';
}

/**
 * カード1枚(見た目は styles/cardbattle.css の .cb-card)。上の札(★・スキル・ひっさつ)/ 絵 / 名前 の3段。
 * back:裏向き / hideStar:手のマークだけ見せる(相手の手札。★は めくるまで わからない)
 * size:hand(手札)・field(場)・small(相手の手札)・tiny(説明パネルの見本)・clash(じゃんけんの見せ場)
 */
export function CardView({
  card,
  back = false,
  hideStar = false,
  size = 'hand',
  className,
}: {
  card: CardFace;
  back?: boolean;
  hideStar?: boolean;
  size?: 'hand' | 'small' | 'field' | 'tiny' | 'clash';
  className?: string;
}) {
  if (back) {
    return (
      <div className={cx('cb-card', `cb-card--${size}`, 'cb-card--back', className)} role="img" aria-label="ふせたカード">
        {/* 三すくみのマーク(絵は cardbattle.css の .cb-card__back の背景) */}
        <span className="cb-card__back" aria-hidden="true" />
      </div>
    );
  }
  if (card.kind === 'janken') {
    return (
      <div
        className={cx('cb-card', `cb-card--${size}`, `cb-card--${card.hand}`, !hideStar && `cb-card--star${card.star}`, className)}
        role="img"
        aria-label={hideStar ? HAND_META[card.hand].label : cardLabel(card)}
      >
        <span className={cx('cb-card__badge', hideStar && 'cb-card__badge--unknown')} aria-hidden="true">
          {hideStar ? '★？' : '★'.repeat(card.star)}
        </span>
        <span className="cb-card__icon" aria-hidden="true"><HandIcon hand={card.hand} alt="" /></span>
        <span className="cb-card__name" aria-hidden="true">{HAND_META[card.hand].label}</span>
      </div>
    );
  }
  const icon = card.kind === 'skill' ? SKILL_META[card.skill].icon : 'finisher-art';
  return (
    <div
      className={cx('cb-card', `cb-card--${size}`, card.kind === 'skill' ? `cb-card--skill cb-card--${card.skill}` : 'cb-card--finisher', className)}
      role="img"
      aria-label={cardLabel(card)}
    >
      <span className="cb-card__badge cb-card__badge--word" aria-hidden="true">{card.kind === 'skill' ? 'スキル' : 'ひっさつ'}</span>
      <span className="cb-card__icon cb-card__icon--emoji" aria-hidden="true">{icon === 'draw-stack' ? <DrawStackIcon /> : icon === 'finisher-art' ? <FinisherArt /> : icon}</span>
      {card.kind === 'skill' ? (
        <span className="cb-card__name" aria-hidden="true">{cardName(card)}</span>
      ) : (
        <FinisherName />
      )}
    </div>
  );
}

function FinisherName() {
  const word = useContext(FinisherArtContext).word || 'わざ';
  return (
    <span className="cb-card__name cb-card__name--finisher" aria-hidden="true" style={{ '--name-squeeze': nameSqueeze(word) } as CSSProperties}>
      {word}
    </span>
  );
}

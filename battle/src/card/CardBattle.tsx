import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { burstAt, chargeAt, createParticleFire, healAt, stopParticleFire, type ParticleFire } from '../attackParticles';
import { getAttributeTheme, type AttributeTheme } from '../attributes';
import type { GameSound, GameSoundOptions } from '../audio/gameAudio';
import { SpecialCutin } from '../battle/BattleScreen';
import { MashDuel } from '../battle/MashDuel';
import { AttackProjectile, ImpactBurst, ParticleLayer } from '../BattleEffects';
import { HAND_META } from '../components/HandIcon';
import { Backdrop, Logo } from '../components/Scenery';
import { cx } from '../cx';
import { mergedFace, type JankenCard } from '../game/cards';
import { attackFromLegacy, attackIcons, hpFromLegacy, loadBattleConfig, type BattleConfig } from '../game/config';
import type { BattleState, Side } from '../game/engine';
import type { RandomSource } from '../game/logic';
import { assetUrl, usePadButtons } from '../integration';
import type { Hand, Monster } from '../types';
import { cardLabel, CardView } from './CardView';
import { ClashStage } from './ClashStage';
import { FighterPanel } from './FighterPanel';
import { HandZone } from './HandGuide';
import { PackOpening } from './PackOpening';
import { useCardFx } from './useCardFx';
import { Flip, gsap, useGSAP } from '../fx/gsap';
import {
  shownPair,
  skillBlockedReason,
  useCardBattle,
  type CardBattleApi,
  type ChargeNote,
  type DamageShown,
  type HandItem,
  type Notice,
} from './useCardBattle';

type PlaySound = (sound: GameSound, options?: GameSoundOptions) => void;

// カードの絵の中心の高さ(左右のモンスターを 0.8倍にしているので、main の 490 より上。cardbattle.css の .projectile の top と同じ)
const CARD_IMAGE_Y = 422;
// カードの絵の中心の 横の位置(左右のパネルを 画面のはしへ はなしたので、main の 510 / 1410 より外。cardbattle.css の上書きと同じ)
const CARD_CENTER_X = { player: 330, cpu: 1590, center: 960 } as const;
// 全ラウンドの数(上の帯の ●○○)
const ROUND_COUNT = 3;

// ---- 場の ひとこと(1行目は短く大きく、くわしいことは2行目に小さく) ----

interface FieldCopy {
  main: string;
  sub?: string;
}

const CHARGE_COPY: Record<ChargeNote, FieldCopy> = {
  charged: { main: 'ダメージ 2ばい！', sub: 'ためわざが きまった…' },
  blocked: { main: 'ふせいだ！', sub: 'ためわざを はねかえした！' },
};

function noticeCopy(notice: Notice): FieldCopy {
  if (notice.type === 'merge') return { main: 'がったい！', sub: `${cardLabel(notice.card)} に なった` };
  if (notice.type === 'heal') return { main: 'かいふく！', sub: `HPが ${notice.amount} もどった` };
  if (notice.type === 'seal') return { main: `${HAND_META[notice.hand].label}を ふうじた！`, sub: 'あいては カードを だしなおした' };
  if (notice.type === 'cpu-heal') return { main: 'あいての かいふく！', sub: `HPが ${notice.amount} もどった` };
  return { main: 'ちからを ためている…！', sub: 'つぎの ターン まけると ダメージ 2ばい' };
}

function fieldCopy(battle: CardBattleApi): FieldCopy | null {
  const { view, clash, notice, chargeNote, state, turnBanner, cpuStep } = battle;
  if (view === 'notice' && notice) return noticeCopy(notice);
  if (view === 'cpu-turn') {
    return cpuStep === 'think'
      ? { main: 'あいての ターン', sub: 'カードを えらんでいる…' }
      : { main: 'カードを ふせた！', sub: 'なにを だしたかな？' };
  }
  // ため技のターン:手札をえらぶあいだ 注意を出す(「あなたの ターン!」より さき)
  if (view === 'player' && state.cpu.charging) return { main: 'ためわざ が くる！', sub: 'まけると ダメージ 2ばい！' };
  if (view === 'player' && turnBanner) return { main: 'あなたの ターン！', sub: 'カードを えらぼう' };
  if (view === 'damage' && chargeNote) return CHARGE_COPY[chargeNote];
  // じゃんけんと めくった結果は 見せ場(ClashStage)が出す
  if (!clash || !['rendan-result', 'attack', 'damage'].includes(view)) return null;
  if (clash.winner === 'rendan') return { main: 'あいこ！', sub: '★も おなじ！ れんだで しょうぶ' };
  const main = clash.winner === 'player' ? 'あなたの かち！' : 'あいての かち…';
  return clash.by === 'star' ? { main, sub: 'あいこ → ★が おおい ほうの かち' } : { main };
}

// 1行目の字の大きさ:場の円(直径 420px)の下のほうに1行で収まる大きさ(上限 46px)
function mainCopySize(text: string): number {
  return Math.min(46, Math.floor(400 / Math.max(1, [...text].length)));
}

function FieldCopyBand({ copy }: { copy: FieldCopy }) {
  return (
    // key で出しなおして、1回ずつ はねて出る
    <div key={copy.main + (copy.sub ?? '')} className="cb-copy" role="status" aria-live="assertive">
      <strong className="cb-copy__main" style={{ fontSize: `${mainCopySize(copy.main)}px` }}>{copy.main}</strong>
      {copy.sub && <span className="cb-copy__sub">{copy.sub}</span>}
    </div>
  );
}

// ---- 手札 ----

// 合成のペアに入っているカード(カーソルが「がったい!」の枠にあるときは全部、ペアをえらんでいるときは えらんだペアだけ)
function pairCardIds(battle: CardBattleApi): Set<string> {
  const { items, cursor, pairs, mergePick, view } = battle;
  if (view !== 'player') return new Set();
  if (mergePick !== null) return new Set(pairs[mergePick]?.map((card) => card.id) ?? []);
  if (items[cursor]?.kind !== 'merge') return new Set();
  return new Set(pairs.flat().map((card) => card.id));
}

// 扇形の手札:1枚あたりの傾き(度)と、はしほど下げる量(真ん中からの枚数の2乗 × px)
const FAN_ANGLE = 6;
const FAN_DROP = 3;

// 舞台は 画面に合わせて縮めて映しているので、見た目の px(getBoundingClientRect)を 要素の px に直す倍率
function stageScale(el: HTMLElement): number {
  const box = el.getBoundingClientRect();
  return el.offsetWidth > 0 && box.width > 0 ? box.width / el.offsetWidth : 1;
}

/**
 * 「がったい」の枠:手札の左はしに、扇形とは別に まっすぐ立てる(cardbattle.css の .cb-hand__merge-panel)。
 * 上に「がったい!」の帯、真ん中に できあがりのカード(★が1つ上)、下に「★1 → ★2」。ペアが2組以上なら「2くみ」
 */
function MergePanel({ battle, index }: { battle: CardBattleApi; index: number }) {
  const { view, cursor, armed, mergePick, pairs } = battle;
  const pair = shownPair(battle);
  if (!pair) return null;
  const result = mergedFace(pair[0]);
  const choosing = view === 'player';
  // ペアをえらんでいるあいだも、枠は えらばれたまま(決定の2回目のあと)
  const selected = choosing && index === cursor;
  return (
    <div className="cb-hand__merge-panel">
      <div
        className={cx(
          'cb-hand__slot',
          'cb-hand__slot--merge',
          selected && 'cb-hand__slot--selected',
          selected && (armed || mergePick !== null) && 'cb-hand__slot--armed',
        )}
        data-testid={`hand-item-${index}`}
        aria-current={selected && mergePick === null ? 'true' : undefined}
      >
        <div className="cb-merge" role="img" aria-label="がったい">
          <span className="cb-merge__label">がったい！</span>
          <span className="cb-merge__result" aria-hidden="true">
            <CardView card={result} size="small" />
            <span className="cb-merge__sparkle">✨</span>
          </span>
          <span className="cb-merge__stars" aria-hidden="true">★{pair[0].star} → ★{result.star}</span>
          {pairs.length > 1 && <span className="cb-merge__count">{pairs.length}くみ</span>}
        </div>
      </div>
    </div>
  );
}

function HandRow({ battle }: { battle: CardBattleApi }) {
  const { state, view, items, cursor, armed, mergePick, pairs, clash, notice, mergeHint, mergedFrom } = battle;
  const choosing = view === 'player';
  // 場に出したカードは、手札からは消して見せる(状態は 命中のところで入れかわる)
  const shown = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'card' && item.card.id !== clash?.playerCard.id);
  // 「がったい」の枠(扇形とは別)。じゃんけんのあいだは出さない
  const mergeIndex = items.findIndex((item) => item.kind === 'merge');
  const showMerge = mergeIndex >= 0 && (choosing || view === 'notice' || view === 'cpu-turn');
  const highlighted = pairCardIds(battle);
  const mergeable = new Set(pairs.flat().map((card) => card.id));
  const skillUsed = state.player.skillsUsed >= state.config.skillPerTurn;
  const newCardId = notice?.type === 'merge' ? notice.card.id : null;

  // 扇形:手札の並び(「しようずみ」の置き場も ふくむ)の真ん中からの位置で、少しずつ傾けて、はしほど下げる
  const count = shown.length + (skillUsed ? 1 : 0);
  const fan = (position: number) => {
    const offset = position - (count - 1) / 2;
    return { '--fan-angle': `${offset * FAN_ANGLE}deg`, '--fan-drop': `${offset * offset * FAN_DROP}px` } as CSSProperties;
  };
  const usedOffset = skillUsed ? 1 : 0;

  // ---- 動き(GSAP の Flip):並びが変わったら(出した・ドロー・合成)、のこりのカードが すべって つめる。
  // 新しく来たカードは 右下(山札のほう)から飛んでくる。最初の手札は 1枚ずつ配る。
  // 合体は:ペアの2枚(の写し)が 枠のほうへ浮いて 回りながら重なる → 光る → できたカードが ポンと出て ★が はずむ ----
  const sectionRef = useRef<HTMLElement>(null);
  const layoutKey = [skillUsed ? 'used' : '', ...shown.map(({ item }) => (item.kind === 'card' ? item.card.id : ''))].join('|');
  const committedKeyRef = useRef<string | null>(null);
  const flipStateRef = useRef<Flip.FlipState | null>(null);
  // 並びが変わる前の、カードごとの位置(合体した2枚の写しを 元の場所から飛ばすため)
  const rectsRef = useRef<Map<string, DOMRect>>(new Map());
  // 描きかえる前(DOM が まだ前の並び)に、並びが変わるときだけ 位置を控える
  if (sectionRef.current && committedKeyRef.current !== null && committedKeyRef.current !== layoutKey && !flipStateRef.current) {
    const cells = sectionRef.current.querySelectorAll<HTMLElement>('.cb-hand__cell');
    flipStateRef.current = Flip.getState(cells);
    rectsRef.current = new Map([...cells].map((cell) => [cell.dataset.flipId ?? '', cell.getBoundingClientRect()]));
  }

  // 合体の演出(できたカードの枠 made に向かって、2枚の写しが寄って重なる)
  const playMerge = (section: HTMLElement, made: Element) => {
    const ghosts = [...section.querySelectorAll<HTMLElement>('.cb-merge-fx__card')];
    const flash = section.querySelector('.cb-merge-fx__flash');
    const scale = stageScale(section);
    const base = section.getBoundingClientRect();
    const local = (rect: DOMRect) => ({ x: (rect.left - base.left) / scale, y: (rect.top - base.top) / scale });
    const target = local(made.getBoundingClientRect());
    const meetY = target.y - 150;
    const tl = gsap.timeline();
    gsap.set(made, { opacity: 0 });
    ghosts.forEach((ghost, i) => {
      const from = rectsRef.current.get(mergedFrom?.[i] ?? '');
      const start = from ? local(from) : target;
      const side = i === 0 ? -1 : 1;
      gsap.set(ghost, { left: 0, top: 0, x: start.x, y: start.y, rotation: 0, opacity: 1 });
      tl.to(ghost, { x: target.x + side * 60, y: meetY, rotation: side * 12, scale: 1.08, duration: 0.3, ease: 'power2.out' }, 0)
        .to(ghost, { x: target.x, y: meetY, rotation: side * 360, scale: 0.9, duration: 0.4, ease: 'power2.in' }, 0.32);
    });
    tl.to(ghosts, { opacity: 0, duration: 0.08 }, 0.72);
    if (flash) {
      tl.fromTo(flash, { x: target.x, y: meetY, scale: 0.2, opacity: 1 }, { scale: 2.4, opacity: 0, duration: 0.45, ease: 'power2.out' }, 0.7);
    }
    tl.fromTo(made, { opacity: 0, y: -150, scale: 1.5 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(2.2)' }, 0.74);
    // ★が「カチッ」と増える
    const badge = made.querySelector('.cb-card__badge');
    if (badge) tl.fromTo(badge, { scale: 2.2, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.45, ease: 'elastic.out(1, 0.35)' }, 1.0);
  };

  useGSAP(() => {
    const section = sectionRef.current;
    if (!section) return;
    const cells = section.querySelectorAll('.cb-hand__cell');
    const first = committedKeyRef.current === null;
    committedKeyRef.current = layoutKey;
    if (first) {
      gsap.from(cells, { y: 260, rotation: gsap.utils.wrap([-16, 16]), opacity: 0, duration: 0.5, ease: 'back.out(1.6)', stagger: 0.07 });
      return;
    }
    const state = flipStateRef.current;
    flipStateRef.current = null;
    if (!state) return;
    // 出した:手札にあった位置から、裏向きのカードが 場の自分の枠へ 弧をえがいて飛び、つぶれて着地(相手の ふせる と同じ動き)
    if (view === 'place' && clash) {
      const fly = section.closest('.cb-screen')?.querySelector<HTMLElement>('.cb-field__fly--player');
      const from = rectsRef.current.get(clash.playerCard.id);
      if (fly && from) {
        const scale = stageScale(fly);
        const box = fly.getBoundingClientRect();
        const dx = (from.left + from.width / 2 - (box.left + box.width / 2)) / scale;
        const dy = (from.top + from.height / 2 - (box.top + box.height / 2)) / scale;
        gsap.timeline()
          .fromTo(
            fly,
            // 手札のカード(168×226)の大きさから、場のカード(124×166)へ
            { x: dx, y: dy, rotation: 0, scale: 1.35 },
            {
              keyframes: [
                { x: dx * 0.45, y: dy * 0.5 - 120, rotation: 10, scale: 1.2, duration: 0.3, ease: 'power1.out' },
                { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.24, ease: 'power2.in' },
              ],
            },
          )
          .to(fly, { scaleX: 1.14, scaleY: 0.84, duration: 0.06, ease: 'power1.out' })
          .to(fly, { scaleX: 1, scaleY: 1, duration: 0.35, ease: 'elastic.out(1, 0.4)' });
      }
    }
    // 合体でできたカードは Flip に まかせず、合体の演出の中で 出す(Flip が 先に見せてしまうので)
    const made = [...cells].find((cell) => cell.querySelector('.cb-hand__slot--new'));
    if (made) playMerge(section, made);
    Flip.from(state, {
      targets: [...cells].filter((cell) => cell !== made),
      duration: 0.4,
      ease: 'power3.out',
      onEnter: (drawn) => {
        if (drawn.length) {
          gsap.fromTo(
            drawn,
            { x: 260, y: 240, rotation: 28, opacity: 0 },
            { x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.5)', stagger: 0.08 },
          );
        }
      },
    });
  }, { scope: sectionRef, dependencies: [layoutKey] });

  // カーソルを動かした・決定の1回目:えらんだカードが 少し つぶれて はずむ(small の段。揺れは なし)
  useGSAP(() => {
    if (!choosing) return;
    const card = sectionRef.current?.querySelector('.cb-hand__slot--selected .cb-card, .cb-hand__slot--selected .cb-merge');
    if (!card) return;
    const squash = armed ? { scaleX: 1.12, scaleY: 0.86 } : { scaleX: 1.06, scaleY: 0.94 };
    gsap.fromTo(card, squash, { scaleX: 1, scaleY: 1, duration: armed ? 0.5 : 0.35, ease: 'elastic.out(1, 0.4)' });
  }, { scope: sectionRef, dependencies: [cursor, armed, choosing] });

  // 合体に気づかせる:新しいペアができたターンの はじめ、枠が ぴょんぴょん はねる
  useGSAP(() => {
    if (!mergeHint) return;
    const panel = sectionRef.current?.querySelector('.cb-merge');
    if (!panel) return;
    gsap.timeline({ delay: 0.2 })
      .to(panel, { y: -34, scaleX: 0.94, scaleY: 1.06, duration: 0.2, ease: 'power2.out', repeat: 3, yoyo: true })
      .to(panel, { scaleX: 1.08, scaleY: 0.92, duration: 0.06 })
      .to(panel, { y: 0, scaleX: 1, scaleY: 1, duration: 0.4, ease: 'elastic.out(1, 0.4)' });
  }, { scope: sectionRef, dependencies: [mergeHint] });

  const slotFor = ({ item, index }: { item: HandItem; index: number }, position: number) => {
    if (item.kind !== 'card') return null;
    const { card } = item;
    const selected = choosing && mergePick === null && index === cursor;
    return (
      // 外の枠(.cb-hand__cell)は 並びの位置だけ(Flip が動かす)。中の .cb-hand__slot が 扇形の傾き・持ち上げ(CSS)
      <div key={card.id} className="cb-hand__cell" data-flip-id={card.id}>
        <div
          style={fan(position + usedOffset)}
          className={cx(
            'cb-hand__slot',
            selected && 'cb-hand__slot--selected',
            selected && armed && 'cb-hand__slot--armed',
            highlighted.has(card.id) && 'cb-hand__slot--pair',
            card.id === newCardId && 'cb-hand__slot--new',
            skillBlockedReason(state, card) && 'cb-hand__slot--blocked',
          )}
          data-testid={`hand-item-${index}`}
          aria-current={selected ? 'true' : undefined}
        >
          <CardView card={card} />
          {/* 合体できるカードには いつも小さな札(どれと どれが がったいできるかが わかる) */}
          {choosing && mergeable.has(card.id) && <span className="cb-pair-tag" aria-label="がったい できる">✨</span>}
        </div>
      </div>
    );
  };

  // 合体の写し:合体した2枚(★が1つ下の 同じ手)を、演出のあいだだけ 手札の上に出す
  const mergeGhost = notice?.type === 'merge' && mergedFrom
    ? { ...notice.card, star: Math.max(1, notice.card.star - 1) as JankenCard['star'] }
    : null;

  return (
    <section ref={sectionRef} className={cx('cb-hand', choosing ? 'cb-hand--choosing' : 'cb-hand--locked')} aria-label="じぶんの てふだ">
      {showMerge && <MergePanel battle={battle} index={mergeIndex} />}
      {/* スキルを使ったターンは、置き場所が「しようずみ」になる */}
      {skillUsed && (
        <div className="cb-hand__cell" data-flip-id="used">
          <div className="cb-hand__slot cb-hand__slot--used" style={fan(0)} aria-label="スキルは しようずみ">
            <span className="cb-used">スキル<br />しようずみ</span>
          </div>
        </div>
      )}
      {shown.map((entry, position) => slotFor(entry, position))}
      {mergeGhost && (
        <div className="cb-merge-fx" aria-hidden="true">
          <div className="cb-merge-fx__card"><CardView card={mergeGhost} /></div>
          <div className="cb-merge-fx__card"><CardView card={mergeGhost} /></div>
          <span className="cb-merge-fx__flash" />
        </div>
      )}
    </section>
  );
}

// ---- 相手の手札 ----

// 封じ手の鎖が 割れる長さ(cardbattle.css の .cb-chain--break と そろえる)
const CHAIN_BREAK_MS = 700;

function CpuHand({
  state,
  clash,
  revealed,
  view,
}: {
  state: BattleState;
  clash: CardBattleApi['clash'];
  revealed: boolean;
  view: CardBattleApi['view'];
}) {
  const sealed = state.cpu.sealedHand;
  // 封じ手は 命中のところで解ける(engine の closeTurn)。鎖は ターンの終わり(ドロー)まで残して、そこで パキッと割る(設計書8章)
  const [leftover, setLeftover] = useState<Hand | null>(null);
  const [breaking, setBreaking] = useState(false);
  const prevSealRef = useRef(sealed);
  useEffect(() => {
    if (prevSealRef.current && !sealed) setLeftover(prevSealRef.current);
    prevSealRef.current = sealed;
  }, [sealed]);
  useEffect(() => {
    if (!leftover || !['draw', 'notice', 'cpu-turn', 'round-end'].includes(view)) return;
    setBreaking(true);
    const timer = window.setTimeout(() => {
      setLeftover(null);
      setBreaking(false);
    }, CHAIN_BREAK_MS);
    return () => window.clearTimeout(timer);
  }, [leftover, view]);
  const chained = sealed ?? leftover;
  return (
    <div className="cb-cpu-hand" aria-label="あいての てふだ">
      {/* うっすら桃色の暗い板。見出しは 板の上のふち(読み上げは 上の aria-label) */}
      <p className="cb-cpu-hand__title" aria-hidden="true">あいての てふだ</p>
      <div className="cb-cpu-hand__cards">
        {state.cpu.hand.map((card: JankenCard, index) => (
          // --i:相手のターンに 1枚ずつ ずらして ゆらす
          <div
            key={card.id}
            className={cx('cb-cpu-hand__slot', card.hand === chained && !breaking && 'cb-cpu-hand__slot--sealed')}
            style={{ '--i': index } as CSSProperties}
          >
            <CardView
              card={card}
              hideStar
              size="small"
              // めくったあとは、出したカードを うすくする(どれを出したかが わかる)
              className={cx(revealed && card.id === clash?.cpuCard.id && 'cb-card--used')}
            />
            {card.hand === sealed && <span className="cb-chain" aria-label="ふうじられている">⛓️</span>}
            {/* 解けた鎖:ターンの終わりまで残し、左右に割れて 飛んでいく */}
            {!sealed && card.hand === leftover && (
              <span className={cx('cb-chain', 'cb-chain--left', breaking && 'cb-chain--break')} aria-hidden="true">
                <i>⛓️</i>
                <i>⛓️</i>
                {breaking && <b className="cb-chain__spark">✦</b>}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- 攻撃の粒(main の BattleScreen.tsx の useParticleFx と同じ作り) ----

/** 攻撃で 攻撃する側に粒をため、命中で当たった側に はじけさせる。粒を描く canvas の ref を返す */
function useCardParticles(
  view: CardBattleApi['view'],
  damage: DamageShown | null,
  themes: Record<Side, AttributeTheme>,
  notice: Notice | null,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fireRef = useRef<ParticleFire | null>(null);
  useEffect(() => {
    if (canvasRef.current) fireRef.current = createParticleFire(canvasRef.current, { centerY: CARD_IMAGE_Y, centerX: CARD_CENTER_X });
    return () => {
      stopParticleFire(fireRef.current);
      fireRef.current = null;
    };
  }, []);
  useEffect(() => {
    const fire = fireRef.current;
    if (!fire || !damage) return;
    const attacker: Side = damage.target === 'cpu' ? 'player' : 'cpu';
    const theme = themes[attacker];
    if (view === 'attack') {
      chargeAt(fire, attacker, theme);
      // 必殺技は、ためを2回重ねる
      if (damage.finisher) chargeAt(fire, attacker, theme);
    } else if (view === 'damage') {
      const dir = attacker === 'player' ? 1 : -1;
      burstAt(fire, damage.target, theme, { dir, power: damage.power, final: damage.final || damage.finisher });
      if (damage.finisher) burstAt(fire, 'center', theme, { power: 3, final: true });
    }
  }, [view, damage]);
  // 回復:回復した側の足もとから 粒が立ちのぼる
  useEffect(() => {
    if (notice?.type === 'heal') healAt(fireRef.current, 'player');
    else if (notice?.type === 'cpu-heal') healAt(fireRef.current, 'cpu');
  }, [notice]);
  return canvasRef;
}

/**
 * カードバトルの画面(戦闘システム設計書 12章)。いまは1ラウンドだけ(パック選び・3ラウンドは段階2b)。
 * 配置:上に細い帯 / 左右のはしに モンスター / 真ん中に 相手の手札・場の円と2枚・場の ひとこと /
 * 下に 手札のゾーン(説明と案内の1行 + 手札)(cardbattle.css)
 */
export function CardBattle({
  player,
  cpu,
  config,
  playSound,
  random,
  setup,
  packIntro = false,
  round = 1,
}: {
  player: Monster;
  cpu: Monster;
  config: BattleConfig;
  /** 何たいめか(上の帯の ●○○。1 = 練習・2 = 2体目・3 = ボス) */
  round?: number;
  playSound: PlaySound;
  random?: RandomSource;
  /** パックを開けたあとの状態を差しかえる(テスト・開発者メニュー用) */
  setup?: (state: BattleState) => BattleState;
  /** ラウンドのはじめに パック選び・開封を出す(本番。テストは 既定の false で すぐ戦闘から) */
  packIntro?: boolean;
}) {
  const battle = useCardBattle({
    config,
    playerAttack: attackFromLegacy(player.attack, config),
    // 最大 HP は カードの ♥ の数から(印刷カードと そろえる)
    playerHp: hpFromLegacy(player.hp, config),
    random,
    playSound,
    attributes: { player: player.attribute, cpu: cpu.attribute },
    setup,
    packIntro,
  });
  const { state, view, clash, damage, mash, cpuMash, rendanWinner, notice, chargeNote, finisherHit } = battle;
  usePadButtons(battle.press);

  const themes: Record<Side, AttributeTheme> = { player: getAttributeTheme(player.attribute), cpu: getAttributeTheme(cpu.attribute) };
  const canvasRef = useCardParticles(view, damage, themes, notice);
  const striking = view === 'attack' || view === 'damage';
  const attacker: Side | null = damage ? (damage.target === 'cpu' ? 'player' : 'cpu') : null;
  // 相手のカードが おもてになっている(ぽん!のあと)
  const revealed = clash !== null && view !== 'place' && view !== 'janken';
  const decided = revealed && clash.winner !== 'rendan'
    ? clash.winner
    : ['rendan-result', 'attack', 'damage'].includes(view) ? rendanWinner : null;
  const copy = fieldCopy(battle);
  // ため技:予告してから その結果が出るまで、相手にオーラ(こちらが勝ったら すぐ消す)
  const charging = (state.cpu.chargeAnnounced || state.cpu.charging) && chargeNote !== 'blocked';
  // 立て札の横の ターンの札(相手のターン:考えている・相手のスキル / 自分のターン:えらぶ・自分のスキル)
  const turnSide: Side | null = view === 'cpu-turn' || (view === 'notice' && notice?.type.startsWith('cpu-'))
    ? 'cpu'
    : view === 'player' || view === 'notice' ? 'player' : null;
  // じゃんけんの見せ場を出しているあいだ(場の小さなカードは隠す)
  const staging = clash !== null && (view === 'janken' || view === 'reveal');
  // 当たりの揺れ(main と同じ 1〜3。必殺技は いちばん強い special)
  const shake = damage ? (damage.finisher ? 'special' : damage.power) : null;
  // 手ざわり(ヒットストップ・揺れ・のけぞり・はずみ。GSAP)。揺れの class は テストと これまでの目印のため残し、動きは useCardFx が出す
  const rootRef = useRef<HTMLElement>(null);
  useCardFx(rootRef, battle, turnSide);

  return (
    <main
      ref={rootRef}
      className={cx(
        'screen',
        'battle-screen',
        'cb-screen',
        `cb-screen--${view}`,
        view === 'cpu-turn' && `cb-screen--cpu-${battle.cpuStep}`,
        notice && `cb-screen--notice-${notice.type}`,
        // main と同じ:攻撃のあいだは 画面のふちが 攻撃した側のタイプの色(effects.css)
        view === 'attack' && 'battle-screen--attack',
        view === 'attack' && attacker && `battle-screen--attack-${themes[attacker]}`,
        view === 'damage' && 'battle-screen--impact',
        striking && damage?.final && 'battle-screen--final-blow',
        // 必殺技:飛び道具・命中・ダメージの数字を特大に
        (view === 'finisher' || (striking && finisherHit)) && 'battle-screen--special',
        (view === 'finisher' || (striking && finisherHit)) && `battle-screen--special-${themes.player}`,
      )}
    >
      <Backdrop />
      {/* 卓の上の置き場(自分・相手のマットと 場の台)。位置は UI に合わせて CSS で描く(cardbattle.css の .cb-mat) */}
      <div className="cb-mats" aria-hidden="true">
        <span className="cb-mat cb-mat--player" />
        <span className="cb-mat cb-mat--cpu" />
        <span className="cb-mat cb-mat--field" />
      </div>
      {/* 上の帯(細い1行):左に ロゴ・何たいめ(●○○)・ターン、まんなかに だれの ターンか */}
      <div className="battle-topbar cb-topbar">
        <div className="cb-topbar__left">
          <Logo className="battle-logo cb-topbar__logo" />
          <span className="cb-topbar__round" aria-label={`${round}たいめ`}>
            <span className="cb-topbar__dots" aria-hidden="true">
              {Array.from({ length: ROUND_COUNT }, (_, i) => (
                <i key={i} className={cx('cb-topbar__dot', i < round && 'cb-topbar__dot--on')} />
              ))}
            </span>
            {round}たいめ
          </span>
          <span className="round-chip cb-topbar__turn">ターン <b>{state.turn}</b></span>
        </div>
        {turnSide && (
          <span key={turnSide} className={`cb-turn-chip cb-turn-chip--${turnSide}`} role="status">
            {turnSide === 'cpu' ? 'あいての ターン' : 'あなたの ターン'}
          </span>
        )}
      </div>

      <div
        className={cx(
          'battlefield',
          view === 'damage' && shake !== null && `battlefield--shake-${shake}`,
          view === 'finisher' && 'battlefield--shake-special',
        )}
      >
        <FighterPanel
          monster={player}
          side="player"
          hp={state.player.hp}
          maxHp={state.player.maxHp}
          swords={attackIcons(state.player.attack, state.config)}
          damage={view === 'damage' ? damage : null}
          attacking={view === 'attack' && attacker === 'player'}
          striking={striking && attacker === 'player'}
          healed={notice?.type === 'heal' ? notice.amount : null}
          defeated={state.player.hp <= 0}
        />
        <FighterPanel
          monster={cpu}
          side="cpu"
          hp={state.cpu.hp}
          maxHp={state.cpu.maxHp}
          swords={attackIcons(state.cpu.attack, state.config)}
          damage={view === 'damage' ? damage : null}
          attacking={view === 'attack' && attacker === 'cpu'}
          striking={striking && attacker === 'cpu'}
          healed={notice?.type === 'cpu-heal' ? notice.amount : null}
          charging={charging}
          defeated={state.cpu.hp <= 0}
        />
        {view === 'attack' && attacker && <AttackProjectile from={attacker} theme={themes[attacker]} />}
        {view === 'damage' && damage && attacker && <ImpactBurst at={damage.target} theme={themes[attacker]} />}
      </div>

      {/* 真ん中:相手の手札(箱なし)・場の円の中の2枚(自分の出したカード・相手の ふせたカード)・場の ひとこと */}
      <section className="cb-center">
        <CpuHand state={state} clash={clash} revealed={revealed} view={view} />
        {/* 場:自分(緑の枠)と 相手(ピンクの枠)。上に「あなた」「あいて」の札 */}
        <div className={cx('cb-field', staging && 'cb-field--staging')}>
          <div className="cb-field__side cb-field__side--player">
            <span className="cb-field__who">あなた</span>
            <div
              className={cx(
                'cb-field__slot',
                'cb-field__slot--player',
                `cb-type-${themes.player}`,
                decided === 'player' && 'cb-field__slot--won',
                decided === 'cpu' && 'cb-field__slot--lost',
              )}
            >
              {clash
                ? (
                  <CardView
                    card={clash.playerCard}
                    size="field"
                    back={view === 'place' || view === 'janken'}
                    // 置く:手札から 飛んできて置かれる(HandRow の GSAP)
                    className={cx(view === 'place' && 'cb-field__fly cb-field__fly--player')}
                  />
                )
                : <span className="cb-field__empty" aria-hidden="true" />}
            </div>
          </div>
          <span className="cb-field__vs" aria-hidden="true">VS</span>
          <div className="cb-field__side cb-field__side--cpu">
            <span className="cb-field__who">あいて</span>
            <div
              className={cx(
                'cb-field__slot',
                'cb-field__slot--cpu',
                `cb-type-${themes.cpu}`,
                decided === 'cpu' && 'cb-field__slot--won',
                decided === 'player' && 'cb-field__slot--lost',
                // 封じ手で出し直したとき、ふせたカードが はずんで置き直される(key を変えて やり直す)
                notice?.type === 'seal' && 'cb-field__slot--replaced',
              )}
              key={state.cpu.placedId ?? 'none'}
            >
              {clash ? (
                <CardView card={clash.cpuCard} size="field" back={!revealed} />
              ) : (view === 'cpu-turn' && battle.cpuStep === 'think') || !state.cpu.placedId ? (
                // 相手が考えているあいだは 置き場が空
                <span className="cb-field__empty cb-field__empty--cpu" aria-hidden="true" />
              ) : (
                // ふせる:相手の手札のパネルから 裏向きのカードが飛んできて置かれる(.cb-field__fly)
                <CardView card={{ kind: 'finisher' }} size="field" back className={cx(view === 'cpu-turn' && 'cb-field__fly cb-field__fly--cpu')} />
              )}
            </div>
          </div>
        </div>
        <div className="cb-copy-area">{copy && <FieldCopyBand copy={copy} />}</div>
      </section>

      {/* 手札のゾーン(うすい線の囲み)と、その上の1行(説明・案内)。手札は その上に重ねる */}
      {view !== 'pack' && <HandZone battle={battle} />}
      {view !== 'pack' && <HandRow battle={battle} />}
      {/* ラウンドのはじめ:パック選び・開封(手札は バトル スタートで 配られる) */}
      {view === 'pack' && <PackOpening battle={battle} />}

      {staging && clash && <ClashStage clash={clash} view={view} beat={battle.beat} themes={themes} />}

      {(view === 'rendan' || view === 'rendan-result') && (
        <MashDuel
          phase={view === 'rendan' ? 'mash-duel' : 'mash-result'}
          playerCount={mash}
          cpuCount={cpuMash}
          winner={rendanWinner}
          onMash={battle.pressMash}
        />
      )}

      {view === 'finisher' && <SpecialCutin monster={player} theme={themes.player} />}
      {view === 'damage' && finisherHit && <div className={`special-impact-flash special-impact-flash--${themes.player}`} aria-hidden="true" />}
      {view === 'damage' && <div className="hit-flash" aria-hidden="true" />}
      <ParticleLayer ref={canvasRef} />

      {view === 'round-end' && (
        <div className={`cb-round-end cb-round-end--${state.roundResult}`} role="status" aria-live="assertive">
          <strong>{state.roundResult === 'win' ? 'かった！' : 'まけちゃった…'}</strong>
          <button type="button" className="cb-round-end__again" onClick={battle.restart}>● もういちど</button>
        </div>
      )}
    </main>
  );
}

// 3ラウンドの通し(段階2b)を作るまでのあいだだけ:1ラウンドだけにする。round は 1 = 練習・2 = 2体目・3 = ボス
// (通しを作ったら、この関数ごと外す)
export function trialConfig(config: BattleConfig, round = 2): BattleConfig {
  const index = Math.min(config.rounds.length, Math.max(1, Math.round(round))) - 1;
  return { ...config, rounds: [config.rounds[index]] };
}

/** 設定ファイル(public/data/battle-config.json)を読んでから、カードバトルを始める */
export function CardBattleEntry({
  player,
  cpu,
  practiceCpu,
  round = 2,
  playSound,
  packIntro = true,
}: {
  player: Monster;
  cpu: Monster;
  /** 練習(round = 1)の相手 */
  practiceCpu: Monster;
  /** 戦う相手(`?round=`)。1 = 練習・2 = 2体目・3 = ボス */
  round?: number;
  playSound: PlaySound;
  /** ラウンドのはじめに パック選び(`?pack=0` で 飛ばす) */
  packIntro?: boolean;
}) {
  const [config, setConfig] = useState<BattleConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBattleConfig(assetUrl('/data/battle-config.json')).then((loaded) => {
      if (alive) setConfig(loaded);
    });
    return () => { alive = false; };
  }, []);
  const trial = useMemo(() => (config ? trialConfig(config, round) : null), [config, round]);
  if (!trial) return <main className="screen loading-screen"><div className="loader" /><p>カードを じゅんびしているよ…</p></main>;
  return <CardBattle player={player} cpu={round === 1 ? practiceCpu : cpu} config={trial} playSound={playSound} packIntro={packIntro} round={round} />;
}

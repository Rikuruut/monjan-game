// バトルの場面(screen)と、バトル画面の中の段階(phase)

export type Screen = 'title' | 'battle' | 'practice-clear' | 'victory' | 'defeat' | 'draw' | 'thanks';

// 立て札のルール説明は、「📖 ルール」の見直しだけ。最初は本物のバトル画面で練習ラウンド(practice)をする
export type TutorialMode = 'review';

export type BattlePhase =
  | 'summon'
  // 本番のはじまりの登場シーン:相手があらわれる → 自分が出る → VS(練習は summon だけ)
  | 'intro-cpu'
  | 'intro-player'
  | 'intro-vs'
  | 'choosing'
  | 'selected'
  | 'janken-jan'
  | 'janken-ken'
  | 'janken-pon'
  | 'reveal'
  // 同じ手(あいこ)のとき:CPU と連打勝負(mash-duel)→ どちらが勝ったか(mash-result)
  | 'mash-duel'
  | 'mash-result'
  // とどめのチャンス(相手の♡が1)に じゃんけんで勝ったとき:必殺技のカットイン → 攻撃
  | 'special'
  | 'attack'
  | 'impact'
  | 'result'
  | 'next-round';

export type HandWinner = 'player' | 'cpu' | 'tie';

/** phase がその中のどれかか */
export function phaseIn(phase: BattlePhase, phases: readonly BattlePhase[]): boolean {
  return phases.includes(phase);
}

// 勝負がついてから(攻撃・命中・結果)。勝った側を光らせ、負けた側を暗くする
export const DECIDED_PHASES: readonly BattlePhase[] = ['attack', 'impact', 'result'];
// CPU の手が見えている(ぽん!のあと)
export const CPU_VISIBLE_PHASES: readonly BattlePhase[] = ['reveal', 'mash-duel', 'mash-result', 'special', 'attack', 'impact', 'result'];
// あいこで、連打勝負の勝ち負けが出てから
export const MASH_DECIDED_PHASES: readonly BattlePhase[] = ['mash-result', 'special', 'attack', 'impact', 'result'];
// とどめのチャンスの予告(相手のカードを光らせる):手を選んでから攻撃まで
export const FINISH_CHANCE_PHASES: readonly BattlePhase[] = [
  'choosing', 'selected', 'janken-jan', 'janken-ken', 'janken-pon', 'reveal', 'mash-duel', 'mash-result', 'special',
];
// 必殺技の演出(カットイン・ため・命中)
export const SPECIAL_PHASES: readonly BattlePhase[] = ['special', 'attack', 'impact'];
// 本番のはじまりの登場シーン
export const INTRO_PHASES: readonly BattlePhase[] = ['intro-cpu', 'intro-player', 'intro-vs'];

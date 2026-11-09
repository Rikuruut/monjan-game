import { useState } from 'react';
import { HandIcon } from '../components/HandIcon';
import { Deck } from '../Deck';
import { usePadButtons } from '../integration';

// ルールの見直し(「📖 ルール」)。3ページの立て札。左「もどる」・中「つぎへ」
export function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const isLastStep = step === 2;
  const next = () => { if (isLastStep) onClose(); else setStep((current) => current + 1); };
  const back = () => setStep((current) => Math.max(0, current - 1));

  usePadButtons((button) => {
    if (button === 'center') next();
    else if (button === 'left' && step > 0) back();
  });

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <section className="tutorial-card">
        <div className="tutorial-progress" aria-label={`ルール ${step + 1} / 3`}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={index === step ? 'is-current' : index < step ? 'is-done' : ''}>
              {index + 1}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="tutorial-page">
            <h2 id="tutorial-title">じゃんけんで 勝負！</h2>
            <p>グー・チョキ・パーから<br /><strong>1つ えらぼう！</strong></p>
            <div className="tutorial-example tutorial-rps" aria-label="じゃんけんの勝ち方">
              <div><b aria-hidden="true"><HandIcon hand="rock" alt="" /></b><span>は</span><b aria-hidden="true"><HandIcon hand="scissors" alt="" /></b><strong>に かつ！</strong></div>
              <div><b aria-hidden="true"><HandIcon hand="scissors" alt="" /></b><span>は</span><b aria-hidden="true"><HandIcon hand="paper" alt="" /></b><strong>に かつ！</strong></div>
              <div><b aria-hidden="true"><HandIcon hand="paper" alt="" /></b><span>は</span><b aria-hidden="true"><HandIcon hand="rock" alt="" /></b><strong>に かつ！</strong></div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="tutorial-page">
            <h2 id="tutorial-title">あいこなら れんだ しょうぶ！</h2>
            <p>同じ手が出たら、<br /><strong>ボタンを たくさん おした方の かち！</strong></p>
            <div className="tutorial-example tutorial-mash" aria-label="ボタンをれんだ">
              <strong>◀ ● ▶</strong><b>どれでも</b><strong>れんだ！</strong>
            </div>
            <p className="tutorial-note">おなじ かずなら <strong>あいこ！</strong><br />おたがいの♡が 1つへるよ！</p>
          </div>
        )}

        {step === 2 && (
          <div className="tutorial-page">
            <h2 id="tutorial-title">相手の ハートをへらそう！</h2>
            <p>じゃんけんに勝つと、<br /><strong>⚔の数だけ 相手の♡がへるよ！</strong></p>
            <div className="tutorial-example tutorial-damage" aria-label="剣2つならハート2つのダメージ">
              <span><b aria-hidden="true">⚔⚔</b><small>こうげき</small></span>
              <strong aria-hidden="true">→</strong>
              <span><b aria-hidden="true">♡♡♡ → ♡</b><small>2ダメージ！</small></span>
            </div>
            <p className="tutorial-note"><strong>相手の♡を ぜんぶなくしたら かち！</strong></p>
          </div>
        )}
      </section>

      <Deck
        knobs={{
          left: step > 0 ? { label: 'もどる', onClick: back } : undefined,
          center: {
            label: isLastStep ? 'バトルにもどる' : 'つぎへ',
            onClick: next,
            call: true,
          },
        }}
      />
    </div>
  );
}

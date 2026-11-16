import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Monster } from '../types';
import { CardResultScreen } from './CardResultScreen';
import { ThanksScreen } from './ThanksScreen';

const monster = (name: string): Monster => ({
  id: name,
  name,
  source: { animal: 'ゴリラ', object: 'はさみ' },
  attribute: '風',
  attack: 2000,
  hp: 4000,
  description: 'テスト用',
  image: '/monsters/test.png',
});

describe('カードバトルのリザルト → カードゲット', () => {
  it('勝ち:見出し・あいて・ターン・のこり HP・必殺技を出し、「つぎへ」で進む', () => {
    const onContinue = vi.fn();
    render(
      <CardResultScreen
        monster={monster('ゴリザミ')}
        outcome={{ result: 'win', turns: 6, playerHp: 42, playerMaxHp: 100, cpu: monster('ドライオン'), finisherUsed: true }}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByRole('heading', { name: 'しょうり！' })).toBeInTheDocument();
    expect(screen.getByText('ゴリザミ')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual(['あいてドライオン', 'ターン6 ターン', 'のこり HP42 / 100', '✨ ひっさつわざ を きめた！']);
    expect(screen.getByText('✨ ひっさつわざ を きめた！')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /つぎへ/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('負け:「おしかった！」で、必殺技の札は出ない', () => {
    render(
      <CardResultScreen
        monster={monster('ゴリザミ')}
        outcome={{ result: 'lose', turns: 8, playerHp: 0, playerMaxHp: 100, cpu: monster('ドライオン'), finisherUsed: false }}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'おしかった！' })).toBeInTheDocument();
    expect(screen.queryByText(/ひっさつわざ/)).not.toBeInTheDocument();
  });

  it('カードゲット:刷るカードを iframe で見せ、「この カードを ゲット！」', () => {
    render(<ThanksScreen monster={monster('ゴリザミ')} cardUrl="/card?id=abc&embed=1" onTitle={vi.fn()} lead="この カードを" />);
    expect(screen.getByRole('heading').textContent).toBe('この カードをゲット！');
    expect(screen.getByTitle('もらえるカード')).toHaveAttribute('src', '/card?id=abc&embed=1');
  });
});

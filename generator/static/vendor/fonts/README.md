# フォント(手元に置いたもの)

展示の会場でネットが切れても字体が変わらないように、Google Fonts から CSS とフォント(woff2)を保存して置いている。
2026年11月1日に保存。

- `<ページ名>.css`:各ページが読む CSS(`gacha`:PC 画面のテーマ fusion / `phone`:スマホ)。
  Google Fonts の CSS の URL を、`/static/vendor/fonts/files/...` に書きかえたもの
- `files/`:フォントの本体。日本語のフォントは文字の範囲ごとに細かく分かれていて、ブラウザは使う文字の入ったファイルだけを読む

| フォント | 使っているページ |
|---|---|
| Dela Gothic One | gacha・phone |
| M PLUS Rounded 1c | gacha・phone |

ほかのテーマで使っていたフォント(Rampart One・Zen Maru Gothic など)は、テーマをやめたときに消した(2026年11月2日。Git の履歴に残っている)。

ライセンス:どれも **SIL Open Font License 1.1**(商用・展示で使える。フォントだけを売ることは禁止)。
https://openfontlicense.org

フォントを足す・変えるときは、Google Fonts の CSS の URL から同じように保存し直す。

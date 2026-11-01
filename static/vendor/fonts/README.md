# フォント(手元に置いたもの)

展示の会場でネットが切れても字体が変わらないように、Google Fonts から CSS とフォント(woff2)を保存して置いている。
2026年11月1日に保存。

- `<ページ名>.css`:各ページが読む CSS(`lab` / `fantasy` / `cardpack` / `pot` / `gacha` / `summon` / `phone`)。
  Google Fonts の CSS の URL を、`/static/vendor/fonts/files/...` に書きかえたもの
- `files/`:フォントの本体。日本語のフォントは文字の範囲ごとに細かく分かれていて、ブラウザは使う文字の入ったファイルだけを読む

| フォント | 使っているページ |
|---|---|
| Rampart One | lab |
| Zen Maru Gothic | lab・pot・summon |
| Mochiy Pop One・Kiwi Maru | fantasy |
| RocknRoll One | cardpack |
| Hachi Maru Pop | pot |
| Dela Gothic One | gacha・phone |
| M PLUS Rounded 1c | cardpack・gacha・phone |
| Yusei Magic | summon |

ライセンス:どれも **SIL Open Font License 1.1**(商用・展示で使える。フォントだけを売ることは禁止)。
https://openfontlicense.org

フォントを足す・変えるときは、Google Fonts の CSS の URL から同じように保存し直す。

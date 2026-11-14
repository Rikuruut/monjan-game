# このプロジェクトで使うエージェントのスキル

AI エージェント(Claude Code など)が、作業の内容に合わせて自動で読む知識です(2026年11月14日に入れた)。
中身は そのままコピーしてあり、変えていない。新しくするときは 出どころから入れ直す。

| フォルダ | 中身 | 出どころ(コミット) | ライセンス |
|---|---|---|---|
| `gsap-core` `gsap-timeline` `gsap-react` `gsap-performance` `gsap-utils` `gsap-plugins` | GSAP(アニメーションのライブラリ)の正しい書き方。公式 | [greensock/gsap-skills](https://github.com/greensock/gsap-skills)(`aed9cfd`) | MIT(`LICENSE-gsap-skills`) |
| `game-feel` | ゲームの手ざわり(juice):揺れ・ヒットストップ・イージング・スカッシュ&ストレッチ・点滅の上限。例のコードは Godot / Unity だが、考え方はエンジンに依らない | [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) の `skills/disciplines/game-feel`(`c6ca6c4`) | Apache-2.0(`LICENSE-awesome-gamedev-agent-skills`・`NOTICE-awesome-gamedev-agent-skills`) |

入れなかったもの:gsap-skills の `gsap-scrolltrigger`(スクロールに合わせた動き)と `gsap-frameworks`(Vue・Svelte など)。このゲームでは使わないため。

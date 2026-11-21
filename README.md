# 秒速架電 LP（STUDIO → Vercel 移行版）

STUDIO（fast-call.canvi.co.jp）から書き出したページを、Vercelでそのまま公開できる静的サイトにしたものです。
ビルドは不要です。

## ページ構成

| URL | ファイル | 内容 |
|---|---|---|
| `/` | `index.html` | トップ（LP本体） |
| `/1` | `1/index.html` | お問い合わせフォーム |
| `/1-1` | `1-1/index.html` | 下層ページ（プライバシーポリシー） |
| `/1-2` | `1-2/index.html` | 下層ページ（利用規約） |

- `css/top.css` … トップ用 / `css/lp.css` … 下層ページ共通
- `assets/images/` … 画像（全ページ共通）
- `js/studio-runtime.js` … STUDIOのJSの代わり（スクロールアニメーション・FAQの開閉・フォーム送信）
- `vercel.json` … `/1/index.html` を `/1` で開けるようにする設定

## Vercelへのデプロイ

### GitHub経由（おすすめ）
1. このフォルダの中身をGitHubリポジトリのルートに置いてpush
2. Vercelで「Add New → Project」→ リポジトリを選択
3. Framework Preset は **Other**、Build Command・Output Directory は空のまま → Deploy

### CLIの場合
```bash
npm i -g vercel
cd fast-call-lp
vercel        # プレビュー
vercel --prod # 本番
```

### 独自ドメイン
Vercelの Project → Settings → Domains で `fast-call.canvi.co.jp` を追加し、
表示されるCNAMEをDNSに設定します（STUDIO側のドメイン設定は外しておく）。

## お問い合わせフォーム（/1）の設定 ※要対応

STUDIOのフォームはSTUDIOのサーバーに送信していたため、そのままでは送れません。
`1/index.html` の `<form name="form1" data-endpoint="">` に送信先URLを入れると動きます。
未設定のまま送信すると「送信先が未設定です」と表示されます。

送信はJSON形式のPOSTです（`Accept: application/json` 付き）。例：Formspree の場合
```html
<form name="form1" data-endpoint="https://formspree.io/f/xxxxxxx" ...>
```

## 補足
- ファビコン（`assets/images/favicon.png`）とOGP画像（`assets/images/ogp.png`）はサイト内のファイルを使っています。
  OGP画像はSNSの仕様上、絶対URL `https://fast-call.canvi.co.jp/assets/images/ogp.png` で指定しているため、
  ドメインをVercelに向けた後に有効になります。別のドメインで公開する場合は各HTMLの `og:image` / `twitter:image` を書き換えてください。
- STUDIOの「Made in STUDIO」バナーと、読み込めないSTUDIOのスクリプト参照は削除済みです。
- 下層ページのヘッダーの「特徴／料金プラン／導入まで流れ」はトップの該当箇所へ飛ぶように直しています。

# 秒速架電 LP（STUDIO → Vercel 移行版）

STUDIO（fast-call.canvi.co.jp）から書き出したページを、Vercel で公開する静的サイトにしたものです。ビルドは不要です。

## フォルダ構成

| URL | ファイル | 内容 |
|---|---|---|
| `/` | `index.html` | トップ（LP本体） |
| `/1` | `1/index.html` | お問い合わせフォーム |
| `/1-1` | `1-1/index.html` | プライバシーポリシー |
| `/1-2` | `1-2/index.html` | 利用規約 |

※ `/1` `/1-1` `/1-2` は STUDIO 時代からの公開URLなので、フォルダ名は変えていません。

```
.
├── css/top.css / css/lp.css  トップ用 / 下層ページ共通
├── assets/images/            画像（全ページ共通）
├── js/
│   ├── studio-runtime.js     STUDIO の JS の代わり（スクロールアニメーション・FAQ の開閉・フォーム送信）
│   └── lp-analytics.js       GA4イベント・流入元の記録（canvi-lp-analytics からの自動コピー。直接編集しない）
├── api/
│   ├── contact.js            フォーム送信API（メール通知 → Canvas登録 → Slack通知）
│   └── _lib/lp-leads.cjs     Canvas・Slack の共通処理（canvi-lp-analytics からの自動コピー。直接編集しない）
├── tests/                    送信APIのテスト（外部送信はモック）
├── robots.txt / sitemap.xml
├── .env.example              Vercel に登録する環境変数の一覧（値は書かない）
└── vercel.json               Vercel設定（cleanUrls・送信APIのタイムアウト）
```

## 本番公開

本番URL：`https://fast-call.canvi.co.jp/`（Vercel プロジェクト `fast-call-lp`。`main` へのマージで本番デプロイ）。

### 環境変数
`.env.example` の項目を Vercel（Production / Preview）に登録します。値は Git に入れません。
`RESEND_API_KEY`・`INQUIRY_FROM` が未設定だと送信APIは 503 を返します。`CANVAS_API_KEY`・`SLACK_LEADS_WEBHOOK_URL` は未設定ならその連携だけをスキップします。
`INQUIRY_FROM` は Resend で認証済みの `lp.canvi.co.jp` のアドレス（`秒速架電 <info@lp.canvi.co.jp>`）。`canvi.co.jp` 本体のアドレスは Resend が 403 で拒否します。

### 本番DNS
管理先はお名前.com。STUDIO の A レコード（`fast-call` → `34.111.141.225`）を削除し、Vercel の Domains 画面に表示される CNAME と TXT（`_vercel`）を追加します。

## フォーム送信

- フォームは `/api/contact` に JSON で送ります。会社名/屋号名・お名前・メール・電話番号・お問い合わせ内容（1つ以上選択）・プライバシーポリシーへの同意が必須、お問い合わせ詳細は任意です。
- 電話番号は全角数字・ハイフンをそろえ、数字10〜15桁か確認します。送信中・送信後はボタンを押せません（二重登録防止）。
- Resend で社内通知（既定 `info@canvi.co.jp`、`INQUIRY_TO` で変更可）と自動返信 → Canvas にリード登録 → Slack に通知 → `lead_id` を返します。
- メール送信の失敗はエラーを返します。Canvas・Slack の失敗はログに残し、メール送信済みの申込は成功扱いです。隠し欄 `website` に入力がある送信は破棄します。Preview からのリードは会社名に「【テスト】」が付きます。
- サイト内の「お問い合わせ」「お申し込みはこちら」は同じタブで `/1` を開きます（別タブだと最初のページで記録した流入元が引き継がれないため）。

## 計測

- GA4：統合プロパティ `G-94VP2CRKS8`（`js/lp-analytics.js` が追加）と、STUDIO から引き継いだLP別プロパティ `G-JEKEG6XP99` の両方に送ります。`lp_name=fast_call`。
- イベント：`page_view`（全ページ）、`form_view`、`form_start`、送信成功後の `generate_lead`。フォームの入力内容は GA4 に送りません。
- UTM・参照元・着地パスを保存し、送信時のURLと合わせて Canvas に渡します。Canvas の `sourceDetail` は「秒速架電」。
- 週次レポート・ダッシュボードは `canvi-lp-analytics/lib/ga4.cjs` のホスト対応表で判定します（`fast-call.canvi.co.jp` と `fast-call-lp.vercel.app`）。
- `js/lp-analytics.js` と `api/_lib/lp-leads.cjs` は `../canvi-lp-analytics/shared/` の正本を `npm run sync` でコピーしたものです。

## ローカルで確認する
計測スクリプトのパスが `/` から始まるため、ファイルを直接開かず簡易サーバーで開きます。
```
npx serve .
```

## テスト
```
npm test
```
実際のメール送信・Canvas登録・Slack投稿は行いません。

## 補足
- ファビコン（`assets/images/favicon.png`）とOGP画像（`assets/images/ogp.png`）はサイト内のファイルです。OGP画像は絶対URL `https://fast-call.canvi.co.jp/assets/images/ogp.png` で指定しています。
- STUDIO の「Made in STUDIO」バナーと、読み込めない STUDIO のスクリプト参照は削除済みです。

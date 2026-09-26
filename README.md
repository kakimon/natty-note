# natty note

Nuxt 4 + Supabase Authでログインし、RLSを通して`products`を表示します。

## 開発

```sh
npm install
cp .env.example .env # .envがまだ存在しない場合のみ
```

`.env`にSupabaseのProject URLとanon public keyを入力します。

```ini
NUXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NUXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

ブラウザー公開用のanon public key（またはpublishable key）を使用してください。`service_role`やsecret keyは使用しません。`.env`はGit管理対象外です。

```sh
npm run dev
```

環境変数を変更した場合は開発サーバーを再起動してください。接続情報が空の場合は設定案内が表示されます。

## Supabase側の前提

- Email / Passwordログインを有効にし、利用する2人のユーザーをSupabaseのAuthenticationで事前に作成します。
- このアプリには新規登録画面はありません。2人専用にする場合はSupabase側でも新規サインアップを無効にします。画面を隠すだけでは登録を防げません。
- `public.products`に`id`と`name`列が必要です。
- RLSを有効にし、対象ユーザーのSELECTを許可する既存ポリシーを利用します。anon向けのSELECT許可は追加しません。
- RLSがSELECTを許可していない場合、エラーではなく空の一覧が返ることがあります。データがあるのに表示されない場合はポリシーを確認してください。

アプリはログイン状態を復元し、ログイン後だけ商品を名前順で取得します。ログアウト時は一覧をクリアします。

## 確認

```sh
npm run build
```

実接続後は、未ログイン時に一覧が取得されないこと、ログイン成功・失敗、商品一覧、再読み込み時のログイン維持、ログアウトを確認してください。

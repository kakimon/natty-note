// X OAuth 1.0a 認可の callback
// X から oauth_token / oauth_verifier（キャンセル時は denied）付きで戻ってくる。
// ブラウザの natty note セッションは届かないため、JWT検証は無効にしてデプロイする（config.toml）。
// 代わりに「一時保存済み・未使用・10分以内の request token」と一致することを確認し、1回で使い切る。
//
// 取得した Access Token / Secret は Supabase Vault に暗号化保存する（store_x_access_token）。
// ブラウザ・URL・ログには一切出さない。
// Edge Function は *.supabase.co では HTML を返せないため、結果は natty note の画面へリダイレクトして表示する。
//
// Secrets: X_API_KEY / X_API_KEY_SECRET / X_EXPECTED_USERNAME / NATTY_NOTE_APP_URL（任意）
// 自動で設定: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  REQUEST_TOKEN_TTL_MS,
  TOKEN_PARAM_RE,
  appCredentials,
  fetchAccessToken,
  fetchMe,
  normalizeUsername
} from '../_shared/x-oauth-flow.ts'

const DEFAULT_APP_URL = 'https://kakimon.github.io/natty-note/'

type Result =
  | 'success'
  | 'cancelled'
  | 'expired'
  | 'used'
  | 'invalid'
  | 'wrong_account'
  | 'x_error'
  | 'save_error'
  | 'config_error'

const appUrl = () => {
  const v = Deno.env.get('NATTY_NOTE_APP_URL') || DEFAULT_APP_URL
  // https か localhost だけ許可（オープンリダイレクト防止）
  return /^https:\/\/|^http:\/\/localhost(:\d+)?\//.test(v) ? v.replace(/\/?$/, '/') : DEFAULT_APP_URL
}

// 結果画面へ。クエリには秘密でない値（結果コード・@ユーザー名）だけを載せる
const redirect = (result: Result, username = '') => {
  const url = new URL('settings/x', appUrl())
  url.searchParams.set('result', result)
  if (username) url.searchParams.set('username', username)
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  })
}

Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('method_not_allowed', { status: 405 })

  const app = appCredentials()
  const expected = normalizeUsername(Deno.env.get('X_EXPECTED_USERNAME') ?? '')
  if (!app.apiKey || !app.apiKeySecret || !expected) return redirect('config_error')

  const params = new URL(req.url).searchParams
  const denied = params.get('denied') ?? ''
  const oauthToken = params.get('oauth_token') ?? ''
  const verifier = params.get('oauth_verifier') ?? ''

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  })

  // ---- キャンセル ----
  if (denied) {
    if (TOKEN_PARAM_RE.test(denied)) {
      // キャンセルされた request token は使えないようにしておく
      await admin
        .from('x_oauth_requests')
        .update({ consumed_at: new Date().toISOString() })
        .eq('oauth_token', denied)
        .is('consumed_at', null)
    }
    return redirect('cancelled')
  }

  if (!TOKEN_PARAM_RE.test(oauthToken) || !TOKEN_PARAM_RE.test(verifier)) return redirect('invalid')

  // ---- 一時保存した request token と照合 ----
  const { data: row, error: rowError } = await admin
    .from('x_oauth_requests')
    .select('oauth_token, oauth_token_secret, user_id, created_at, consumed_at')
    .eq('oauth_token', oauthToken)
    .maybeSingle()
  if (rowError) return redirect('save_error')
  if (!row) return redirect('invalid') // natty note が発行していない token（すり替え対策）
  if (row.consumed_at) return redirect('used')

  const expiredAt = new Date(new Date(row.created_at).getTime() + REQUEST_TOKEN_TTL_MS)
  if (Date.now() > expiredAt.getTime()) {
    await admin.from('x_oauth_requests').update({ consumed_at: new Date().toISOString() }).eq('oauth_token', oauthToken)
    return redirect('expired')
  }

  // ---- 1回だけ使えるように、先に使用済みにする（同時アクセスでも片方しか通らない）----
  const { data: consumed, error: consumeError } = await admin
    .from('x_oauth_requests')
    .update({ consumed_at: new Date().toISOString() })
    .eq('oauth_token', oauthToken)
    .is('consumed_at', null)
    .gt('created_at', new Date(Date.now() - REQUEST_TOKEN_TTL_MS).toISOString())
    .select('oauth_token')
    .maybeSingle()
  if (consumeError) return redirect('save_error')
  if (!consumed) return redirect('used')

  // ---- access token を取得 ----
  let access: Awaited<ReturnType<typeof fetchAccessToken>>
  try {
    access = await fetchAccessToken(app, row.oauth_token, row.oauth_token_secret, verifier)
  } catch (error) {
    console.error('x-oauth-callback: access token exchange failed:', error instanceof Error ? error.message : 'unknown')
    return redirect('x_error')
  }

  // ---- どのアカウントのトークンかを確認 ----
  let account = { id: access.userId, username: access.screenName, name: '' }
  try {
    const me = await fetchMe({ ...app, accessToken: access.accessToken, accessTokenSecret: access.accessTokenSecret })
    if (me.username) account = me
  } catch (error) {
    // users/me が使えなくても、access_token の応答に含まれる user_id / screen_name で判定する
    console.warn('x-oauth-callback: users/me failed, using access_token response:', error instanceof Error ? error.message : 'unknown')
  }
  if (!account.username || !account.id) return redirect('x_error')

  if (normalizeUsername(account.username) !== expected) {
    // natty 以外のアカウントで認可された → 保存しない
    return redirect('wrong_account', account.username)
  }

  // ---- Vault に暗号化保存 ----
  const { error: saveError } = await admin.rpc('store_x_access_token', {
    p_access_token: access.accessToken,
    p_access_token_secret: access.accessTokenSecret,
    p_x_user_id: account.id,
    p_username: account.username,
    p_display_name: account.name || null,
    p_connected_by: row.user_id
  })
  if (saveError) {
    console.error('x-oauth-callback: store_x_access_token failed:', saveError.message)
    return redirect('save_error')
  }

  return redirect('success', account.username)
})

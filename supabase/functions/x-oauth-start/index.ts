// X OAuth 1.0a 認可の開始
// ログイン済みの natty note ユーザーだけが実行できる。
// request token を取得して DB（x_oauth_requests・service_role 専用）に一時保存し、X の認可URLだけを返す。
// request token secret はブラウザへ返さない。
//
// Secrets: X_API_KEY / X_API_KEY_SECRET / X_EXPECTED_USERNAME
// 自動で設定: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  AUTHORIZE_URL,
  appCredentials,
  callbackUrl,
  fetchRequestToken,
  normalizeUsername
} from '../_shared/x-oauth-flow.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const app = appCredentials()
  if (!app.apiKey || !app.apiKeySecret) {
    return json({ error: 'X_API_KEY / X_API_KEY_SECRET が設定されていません' }, 500)
  }
  const expected = normalizeUsername(Deno.env.get('X_EXPECTED_USERNAME') ?? '')
  if (!expected) {
    return json({ error: 'X_EXPECTED_USERNAME（認可する natty のXユーザー名）が設定されていません' }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!

  // ログイン確認
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  })
  const { data: userData, error: userError } = await userClient.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, '')
  )
  if (userError || !userData.user) return json({ error: 'ログインが必要です' }, 401)

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  })

  try {
    // 古い一時データを掃除（1日以上前のもの）
    await admin
      .from('x_oauth_requests')
      .delete()
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    const { token, secret } = await fetchRequestToken(app, callbackUrl(supabaseUrl))

    const { error: insertError } = await admin
      .from('x_oauth_requests')
      .insert({ oauth_token: token, oauth_token_secret: secret, user_id: userData.user.id })
    if (insertError) throw new Error(`request token を保存できませんでした: ${insertError.message}`)

    // force_login: いま X にログインしているアカウント（imagimo など）で自動的に認可されないよう、ログインし直してもらう
    // screen_name: natty のユーザー名を入力欄に入れておく
    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set('oauth_token', token)
    url.searchParams.set('force_login', 'true')
    url.searchParams.set('screen_name', expected)

    return json({ authorize_url: url.toString(), expected_username: expected })
  } catch (error) {
    // エラー文に秘密値は含めていない
    console.error('x-oauth-start failed:', error instanceof Error ? error.message : 'unknown')
    return json({ error: 'Xとの認証を開始できませんでした。Developer Console の設定（Callback URL・権限）を確認してください' }, 502)
  }
})

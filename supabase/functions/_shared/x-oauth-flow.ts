// X OAuth 1.0a 認可フロー（3-legged）の共通定義
// 公式: https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens
import { oauthHeader, type XCredentials } from './x-oauth1.ts'

export const X_OAUTH_BASE = 'https://api.x.com'
export const REQUEST_TOKEN_URL = `${X_OAUTH_BASE}/oauth/request_token`
export const AUTHORIZE_URL = `${X_OAUTH_BASE}/oauth/authorize`
export const ACCESS_TOKEN_URL = `${X_OAUTH_BASE}/oauth/access_token`

// request token の有効時間（これより古いものは拒否）
export const REQUEST_TOKEN_TTL_MS = 10 * 60 * 1000

// X に登録する callback URL（SUPABASE_URL から組み立てる）
export const callbackUrl = (supabaseUrl: string) =>
  `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/x-oauth-callback`

// X が返す oauth_token / oauth_verifier の形式チェック（英数字・-・_ のみ）
export const TOKEN_PARAM_RE = /^[A-Za-z0-9_-]{1,200}$/

export const appCredentials = (): Pick<XCredentials, 'apiKey' | 'apiKeySecret'> => ({
  apiKey: Deno.env.get('X_API_KEY') ?? '',
  apiKeySecret: Deno.env.get('X_API_KEY_SECRET') ?? ''
})

// X の OAuth エンドポイントは application/x-www-form-urlencoded で返す
const postForm = async (url: string, authorization: string) => {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: authorization } })
  const text = await res.text()
  if (!res.ok) {
    // レスポンス本文に秘密値は含まれないが、長さだけ制限しておく
    throw new Error(`X OAuth error ${res.status}: ${text.slice(0, 200)}`)
  }
  return new URLSearchParams(text)
}

export const fetchRequestToken = async (app: Pick<XCredentials, 'apiKey' | 'apiKeySecret'>, callback: string) => {
  const auth = await oauthHeader(
    'POST',
    REQUEST_TOKEN_URL,
    { ...app, accessToken: '', accessTokenSecret: '' },
    {},
    { oauth_callback: callback }
  )
  const params = await postForm(REQUEST_TOKEN_URL, auth)
  const token = params.get('oauth_token') ?? ''
  const secret = params.get('oauth_token_secret') ?? ''
  if (!token || !secret) throw new Error('X OAuth error: request token が返りませんでした')
  if (params.get('oauth_callback_confirmed') !== 'true') {
    throw new Error('X OAuth error: callback URL が確認されませんでした（Developer Console の Callback URL を確認してください）')
  }
  return { token, secret }
}

export const fetchAccessToken = async (
  app: Pick<XCredentials, 'apiKey' | 'apiKeySecret'>,
  requestToken: string,
  requestTokenSecret: string,
  verifier: string
) => {
  const auth = await oauthHeader(
    'POST',
    ACCESS_TOKEN_URL,
    { ...app, accessToken: requestToken, accessTokenSecret: requestTokenSecret },
    {},
    { oauth_verifier: verifier }
  )
  const params = await postForm(ACCESS_TOKEN_URL, auth)
  const accessToken = params.get('oauth_token') ?? ''
  const accessTokenSecret = params.get('oauth_token_secret') ?? ''
  if (!accessToken || !accessTokenSecret) throw new Error('X OAuth error: access token が返りませんでした')
  return {
    accessToken,
    accessTokenSecret,
    userId: params.get('user_id') ?? '',
    screenName: params.get('screen_name') ?? ''
  }
}

// 取得したトークンでアカウント情報を確認（GET /2/users/me）
export const fetchMe = async (cred: XCredentials) => {
  const url = `${X_OAUTH_BASE}/2/users/me`
  const res = await fetch(url, { headers: { Authorization: await oauthHeader('GET', url, cred) } })
  if (!res.ok) throw new Error(`X users/me error ${res.status}`)
  const body = await res.json()
  return {
    id: String(body?.data?.id ?? ''),
    username: String(body?.data?.username ?? ''),
    name: String(body?.data?.name ?? '')
  }
}

export const normalizeUsername = (v: string) => v.trim().replace(/^@/, '').toLowerCase()

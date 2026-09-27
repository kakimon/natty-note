// X API 用の OAuth 1.0a 署名（HMAC-SHA1）
// JSON / multipart のボディは署名に含めない（OAuth 1.0a の仕様どおり）
//
// 使い方:
// - 通常のAPI呼び出し … accessToken / accessTokenSecret を渡す
// - 認可フローの request_token … トークンなし（accessToken='' / accessTokenSecret=''）、extra に oauth_callback
// - 認可フローの access_token … request token とその secret を渡し、extra に oauth_verifier

export type XCredentials = {
  apiKey: string
  apiKeySecret: string
  accessToken: string
  accessTokenSecret: string
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const hmacSha1Base64 = async (key: string, data: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export const oauthHeader = async (
  method: string,
  url: string,
  cred: XCredentials,
  fixed: { nonce?: string; timestamp?: string } = {}, // テスト用
  extra: Record<string, string> = {} // oauth_callback / oauth_verifier など、署名に含める oauth_* パラメータ
) => {
  const u = new URL(url)
  const oauth: Record<string, string> = {
    oauth_consumer_key: cred.apiKey,
    oauth_nonce: fixed.nonce ?? crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extra
  }
  // request_token の段階ではトークンがないので oauth_token を付けない
  if (cred.accessToken) oauth.oauth_token = cred.accessToken
  // クエリ文字列も署名対象に含める
  const params: [string, string][] = [...Object.entries(oauth)]
  u.searchParams.forEach((v, k) => params.push([k, v]))
  const paramString = params
    .map(([k, v]) => [enc(k), enc(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const baseUrl = `${u.origin}${u.pathname}`
  const base = `${method.toUpperCase()}&${enc(baseUrl)}&${enc(paramString)}`
  const signingKey = `${enc(cred.apiKeySecret)}&${enc(cred.accessTokenSecret)}`
  oauth.oauth_signature = await hmacSha1Base64(signingKey, base)
  return 'OAuth ' + Object.entries(oauth).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ')
}

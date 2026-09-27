// X（旧Twitter）への自動投稿
//
// ブラウザからは social_post_id だけを受け取り、投稿内容・状態・写真はここでDBから読み直す。
// X API は OAuth 1.0a（natty の X アカウントで発行した Access Token）で呼ぶ。
//
// 二重投稿防止:
//   1. status='posted' の投稿は送らない
//   2. 送信前に「status='approved' かつ external_post_id が空」の行だけを
//      external_post_id='sending:…' に更新して確保する（同時に押されても X へ送るのは1回）
//   3. 成功したら posted＋本物の投稿IDで上書き、失敗したら確保を外して approved に戻す
//
// 認証情報:
//   X_API_KEY / X_API_KEY_SECRET … Supabase Secrets
//   natty の Access Token / Secret … OAuth 認可（x-oauth-callback）が Supabase Vault に保存したもの。
//     service_role だけが実行できる get_x_access_credentials() で、呼び出しのたびに取得する
//     （再認可で Vault が更新されれば、次の呼び出しから新しい値を使う）
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で設定する。

import { createClient } from 'npm:@supabase/supabase-js@2'
import { oauthHeader, type XCredentials } from '../_shared/x-oauth1.ts'

const X_API = 'https://api.x.com'
const X_LIMIT = 280
const X_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const X_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const PHOTO_BUCKET = 'natty-photos'
const SENDING_PREFIX = 'sending:'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// URL（http(s)://… / www.… / ドメインらしき文字列）を含むか。URL入り投稿は料金が高い
export const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|jp|net|org|co\.jp|shop|me|io|app|link|ly)\b/i

// Xの文字数（日本語・絵文字は2、半角は1）
const xWeightedLength = (text: string) =>
  Array.from(text).reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) <= 0x10ff ? 1 : 2), 0)

// X API のエラーを、画面に出せる短い日本語にする
const describeXError = (status: number, body: any) => {
  const detail = body?.detail || body?.title || body?.errors?.[0]?.message || ''
  if (status === 401) return `Xの認証に失敗しました（キーの設定を確認してください）${detail ? `: ${detail}` : ''}`
  if (status === 402) return 'Xのクレジット残高が不足しています。Developer Consoleでクレジットを追加してください'
  if (status === 403) return `Xに投稿を拒否されました${detail ? `: ${detail}` : '（アプリの権限が「Read and write」か確認してください）'}`
  if (status === 429) return 'Xの利用回数の上限に達しました。しばらく待ってからお試しください'
  return `Xからエラーが返りました（${status}）${detail ? `: ${detail}` : ''}`
}

class XApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(describeXError(status, body))
  }
}

const xFetch = async (cred: XCredentials, method: string, url: string, init: RequestInit = {}) => {
  const res = await fetch(url, {
    ...init,
    method,
    headers: { ...(init.headers ?? {}), Authorization: await oauthHeader(method, url, cred) }
  })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { detail: text.slice(0, 200) }
  }
  if (!res.ok) throw new XApiError(res.status, body)
  return body
}

const uploadImage = async (cred: XCredentials, image: Blob) => {
  const form = new FormData()
  form.append('media', image)
  form.append('media_category', 'tweet_image')
  const body = await xFetch(cred, 'POST', `${X_API}/2/media/upload`, { body: form })
  const id = body?.data?.id ?? body?.id ?? body?.media_id_string
  if (!id) throw new Error('Xへの画像アップロードで media_id を受け取れませんでした')
  return String(id)
}

const createPost = async (cred: XCredentials, text: string, mediaId: string | null) => {
  const payload: Record<string, unknown> = { text }
  if (mediaId) payload.media = { media_ids: [mediaId] }
  const body = await xFetch(cred, 'POST', `${X_API}/2/tweets`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const id = body?.data?.id
  if (!id) throw new Error('Xへの投稿で投稿IDを受け取れませんでした')
  return String(id)
}

// Vault から natty の Access Token / Secret を取得する。
// 値そのものはログにもレスポンスにも出さない（失敗理由も値を含まない固定文言だけ）
const loadAccessTokens = async (): Promise<Pick<XCredentials, 'accessToken' | 'accessTokenSecret'> | null> => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  })
  const { data, error } = await admin.rpc('get_x_access_credentials')
  if (error) {
    console.error('post-to-x: get_x_access_credentials failed (code:', error.code ?? 'unknown', ')')
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  const accessToken = typeof row?.access_token === 'string' ? row.access_token : ''
  const accessTokenSecret = typeof row?.access_token_secret === 'string' ? row.access_token_secret : ''
  if (!accessToken || !accessTokenSecret) return null
  return { accessToken, accessTokenSecret }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const apiKey = Deno.env.get('X_API_KEY') ?? ''
  const apiKeySecret = Deno.env.get('X_API_KEY_SECRET') ?? ''
  if (!apiKey || !apiKeySecret) {
    return json({ error: 'XのAPIキーが設定されていません（Supabase Secrets を確認してください）' }, 500)
  }

  // ログインユーザーとしてDBを読む（RLSがそのまま効く）
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: userData, error: userError } = await supabase.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, '')
  )
  if (userError || !userData.user) return json({ error: 'ログインが必要です' }, 401)

  // natty の Access Token / Secret を Vault から取得（取れなければ X へは何も送らない）
  const tokens = await loadAccessTokens()
  if (!tokens) {
    return json({
      error: 'Xアカウントが連携されていません。「Xアカウント連携」から natty のアカウントを認可してください',
      code: 'not_connected'
    }, 500)
  }
  const cred: XCredentials = { apiKey, apiKeySecret, ...tokens }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    // 下で弾く
  }

  // ---- 接続確認: どのXアカウントに投稿されるかを返す（投稿はしない）----
  if (body?.action === 'whoami') {
    try {
      const me = await xFetch(cred, 'GET', `${X_API}/2/users/me`)
      return json({ username: me?.data?.username ?? null, name: me?.data?.name ?? null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return json({ error: message }, error instanceof XApiError ? 502 : 500)
    }
  }

  const postId = typeof body?.social_post_id === 'string' ? body.social_post_id : ''
  const allowUrl = body?.allow_url === true
  if (!UUID_RE.test(postId)) return json({ error: 'social_post_id が正しくありません' }, 400)

  // ---- 投稿内容をDBから読み直す ----
  const { data: post, error: postError } = await supabase
    .from('social_posts')
    .select('id, platform, status, content, photo_id, external_post_id, posted_at')
    .eq('id', postId)
    .maybeSingle()
  if (postError) return json({ error: postError.message }, 500)
  if (!post) return json({ error: '投稿が見つかりません' }, 404)
  if (post.platform !== 'x') return json({ error: 'Xの投稿ではありません' }, 400)
  if (post.status === 'posted') {
    return json({ error: 'この投稿はすでに投稿済みです', code: 'already_posted', posted_at: post.posted_at, external_post_id: post.external_post_id }, 409)
  }
  if (post.status !== 'approved') {
    return json({ error: '先に「コピーする」で投稿準備を完了してください', code: 'not_approved' }, 409)
  }
  if (post.external_post_id?.startsWith(SENDING_PREFIX)) {
    return json({ error: 'この投稿は送信中です。少し待ってから画面を開き直してください', code: 'sending' }, 409)
  }

  const text = (post.content ?? '').trim()
  if (!text) return json({ error: '投稿する文章がありません' }, 400)
  if (xWeightedLength(text) > X_LIMIT) return json({ error: 'Xの文字数上限（全角140文字）を超えています' }, 400)
  if (URL_RE.test(text) && !allowUrl) {
    return json({ error: 'URLが含まれています', code: 'contains_url' }, 422)
  }

  // ---- 写真を private Storage から取得（送信前に確認して、ダメならXへは何も送らない）----
  let image: Blob | null = null
  if (post.photo_id) {
    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('id, storage_path')
      .eq('id', post.photo_id)
      .maybeSingle()
    if (photoError) return json({ error: photoError.message }, 500)
    if (!photo) return json({ error: '選択した写真が見つかりません。写真を選び直してください' }, 404)

    const { data: file, error: dlError } = await supabase.storage.from(PHOTO_BUCKET).download(photo.storage_path)
    if (dlError || !file) return json({ error: '写真を読み込めませんでした' }, 500)
    if (file.size > X_IMAGE_MAX_BYTES) {
      return json({ error: '写真が5MBを超えているため、Xへ自動投稿できません。小さい写真を選ぶか、手動で投稿してください', code: 'image_too_large' }, 422)
    }
    if (file.type && !X_IMAGE_TYPES.includes(file.type)) {
      return json({ error: 'この写真の形式はXへ投稿できません', code: 'image_type' }, 422)
    }
    image = file
  }

  // ---- 送信権を確保（同時押し対策）----
  const marker = `${SENDING_PREFIX}${new Date().toISOString()}`
  const { data: claimed, error: claimError } = await supabase
    .from('social_posts')
    .update({ external_post_id: marker })
    .eq('id', postId)
    .eq('status', 'approved')
    .is('external_post_id', null)
    .select('id')
    .maybeSingle()
  if (claimError) return json({ error: claimError.message }, 500)
  if (!claimed) return json({ error: 'この投稿は送信中か、すでに投稿済みです', code: 'sending' }, 409)

  const release = () =>
    supabase.from('social_posts').update({ external_post_id: null }).eq('id', postId).eq('external_post_id', marker)

  // ---- Xへ送信 ----
  let tweetId: string
  try {
    const mediaId = image ? await uploadImage(cred, image) : null
    tweetId = await createPost(cred, text, mediaId)
  } catch (error) {
    await release()
    console.error('post-to-x failed', error instanceof XApiError ? { status: error.status, body: error.body } : error)
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message, code: 'x_error' }, 502)
  }

  // ---- 成功: posted にする ----
  const postedAt = new Date().toISOString()
  const { error: saveError } = await supabase
    .from('social_posts')
    .update({ status: 'posted', posted_at: postedAt, external_post_id: tweetId })
    .eq('id', postId)
    .eq('external_post_id', marker)
  if (saveError) {
    // Xには投稿済み。送信中の印は残して再送を防ぐ
    console.error('post-to-x: posted to X but failed to save', { postId, tweetId, saveError })
    return json({
      error: `Xには投稿できましたが、natty noteへの記録に失敗しました（投稿ID: ${tweetId}）。再送はせず、「投稿しました」で記録してください`,
      code: 'saved_failed',
      external_post_id: tweetId
    }, 500)
  }

  // ---- 写真を使用済みに（失敗しても投稿の記録は残す）----
  let photoUpdateFailed = false
  if (post.photo_id) {
    const { error: photoUpdateError } = await supabase
      .from('photos')
      .update({ is_used: true })
      .eq('id', post.photo_id)
    if (photoUpdateError) {
      console.error('post-to-x: photos.is_used update failed', photoUpdateError)
      photoUpdateFailed = true
    }
  }

  return json({
    status: 'posted',
    posted_at: postedAt,
    external_post_id: tweetId,
    url: `https://x.com/i/web/status/${tweetId}`,
    photo_update_failed: photoUpdateFailed
  })
})

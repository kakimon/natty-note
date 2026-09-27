// 投稿履歴（social_posts のうち approved / posted だけ）
import type { SupabaseClient } from '@supabase/supabase-js'
import { signedPhotoUrls } from '~/utils/photos'
import { postTypeLabels } from '~/utils/postTemplates'

export const HISTORY_STATUSES = ['posted', 'approved'] as const

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X',
  threads: 'Threads',
  instagram: 'Instagram'
}

export const HISTORY_STATUS_LABELS: Record<string, string> = {
  posted: '投稿済み',
  approved: '投稿準備済み'
}

const POST_TYPE_LABELS: Record<string, string> = {
  ai_recommended: 'おすすめ投稿',
  ...postTypeLabels
}

export const platformLabel = (v?: string | null) => (v && PLATFORM_LABELS[v]) || 'SNS'
export const historyStatusLabel = (v?: string | null) => (v && HISTORY_STATUS_LABELS[v]) || ''
export const postTypeLabel = (v?: string | null) => (v && POST_TYPE_LABELS[v]) || '投稿'

export type HistoryPost = {
  id: string
  platform: string
  post_type: string | null
  status: 'posted' | 'approved'
  content: string
  generated_by_ai: boolean | null
  posted_at: string | null
  updated_at: string
  external_post_id: string | null
  product_id: string | null
  photo_id: string | null
  productName: string | null
  photoUrl: string | null
}

const SELECT = `id, platform, post_type, status, content, generated_by_ai, posted_at, updated_at,
  external_post_id, product_id, photo_id, products(name), photos(storage_path)`

// 並び順: 投稿済みを posted_at の新しい順 → posted_at のない投稿準備済みを updated_at の新しい順
export const loadPostHistory = async (
  supabase: SupabaseClient,
  opts: { limit?: number; id?: string } = {}
) => {
  let query = supabase
    .from('social_posts')
    .select(SELECT)
    .in('status', HISTORY_STATUSES as unknown as string[])
    .order('posted_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
  if (opts.id) query = query.eq('id', opts.id)
  if (opts.limit) query = query.limit(opts.limit)
  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as any[]
  const paths = [...new Set(rows.map(r => r.photos?.storage_path).filter(Boolean) as string[])]
  // 写真が読めなくても履歴自体は表示する
  let urls: Record<string, string> = {}
  try {
    urls = await signedPhotoUrls(supabase, paths)
  } catch {
    urls = {}
  }

  return rows.map(r => ({
    id: r.id,
    platform: r.platform,
    post_type: r.post_type,
    status: r.status,
    content: r.content ?? '',
    generated_by_ai: r.generated_by_ai,
    posted_at: r.posted_at,
    updated_at: r.updated_at,
    external_post_id: r.external_post_id,
    product_id: r.product_id,
    photo_id: r.photo_id,
    productName: r.products?.name ?? null,
    photoUrl: r.photos?.storage_path ? urls[r.photos.storage_path] ?? null : null
  })) as HistoryPost[]
}

// 表示用の日時（日本時間）。投稿準備済みは posted_at がないので更新日時を使う
export const historyDate = (p: HistoryPost) => {
  const d = new Date(p.posted_at ?? p.updated_at)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d)
  const get = (t: string) => parts.find(x => x.type === t)?.value ?? ''
  const nowYear = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric' })
    .formatToParts(new Date()).find(x => x.type === 'year')?.value
  const date = get('year') === nowYear ? `${get('month')}/${get('day')}` : `${get('year')}/${get('month')}/${get('day')}`
  return `${date} ${get('hour')}:${get('minute')}`
}

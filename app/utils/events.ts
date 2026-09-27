// 出店予定（events）の共通処理
import type { SupabaseClient } from '@supabase/supabase-js'

export const EVENT_STATUS_OPTIONS = [
  { value: 'scheduled', label: '出店予定' },
  { value: 'open', label: '出店中' },
  { value: 'finished', label: '終了' },
  { value: 'cancelled', label: '中止' }
] as const

export type EventStatus = typeof EVENT_STATUS_OPTIONS[number]['value']

// 販売記録・投稿履歴があるか（あれば完全削除しない）
// event_products はイベントの一部なので、ここでは数えない
export const eventHistoryCounts = async (supabase: SupabaseClient, eventId: string) => {
  const [sales, posts] = await Promise.all([
    supabase.from('sales_results').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('social_posts').select('id', { count: 'exact', head: true }).eq('event_id', eventId)
  ])
  if (sales.error) throw sales.error
  if (posts.error) throw posts.error
  return { sales: sales.count ?? 0, posts: posts.count ?? 0 }
}

// 完全削除（履歴がない場合だけ呼ぶ）。販売予定商品のつながりも一緒に消す
export const deleteEventCompletely = async (supabase: SupabaseClient, eventId: string) => {
  const links = await supabase.from('event_products').delete().eq('event_id', eventId)
  if (links.error) throw links.error
  const ev = await supabase.from('events').delete().eq('id', eventId)
  if (ev.error) throw ev.error
}

// ---- 一覧表示用 ----
export type EventSummary = {
  id: string
  name: string
  event_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  status: string
  sale_type: string | null
  productNames: string[]
}

// 日本時間の今日 "YYYY-MM-DD"
export const jstTodayString = () => {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

// 販売予定と、登録された商品名をまとめて取得する
// upcomingOnly: 今日以降の scheduled / open だけ（中止・終了は除く）
export const loadEventSummaries = async (
  supabase: SupabaseClient,
  options: { upcomingOnly?: boolean; limit?: number } = {}
): Promise<EventSummary[]> => {
  let query = supabase
    .from('events')
    .select('id, name, event_date, start_time, end_time, location, status, sale_type, event_products ( products ( name ) )')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })

  if (options.upcomingOnly) {
    query = query.gte('event_date', jstTodayString()).in('status', ['scheduled', 'open'])
  }
  if (options.limit) query = query.limit(options.limit)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((e: any) => ({
    id: e.id,
    name: e.name,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    location: e.location,
    status: e.status,
    sale_type: e.sale_type,
    productNames: (e.event_products ?? []).map((ep: any) => ep.products?.name).filter(Boolean)
  }))
}

// "2026-10-01" → "10/1(木)"
export const formatShortDate = (value: string) => {
  const [y, m, d] = value.split('-').map(Number)
  const week = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()]
  return `${m}/${d}(${week})`
}

// 商品名を短く（3つまで＋ほか○件）
export const shortProductList = (names: string[], max = 3) =>
  names.length === 0
    ? '商品未登録'
    : names.length > max
      ? `${names.slice(0, max).join('、')} ほか${names.length - max}件`
      : names.join('、')

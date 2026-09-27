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

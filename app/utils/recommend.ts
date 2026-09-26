// AIおまかせ投稿の候補抽出（ブラウザ側）
// 判定ロジック本体は Edge Function と共通の recommend-core.ts にある。
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HISTORY_STATUSES,
  INTRO_POST_TYPES,
  evaluateProducts,
  jstToday,
  type RecResult
} from '~~/supabase/functions/_shared/recommend-core'

export { reasonLines, reasonSentence } from '~~/supabase/functions/_shared/recommend-core'
export type { ProductFacts, RecEvent, RecResult } from '~~/supabase/functions/_shared/recommend-core'

export const loadRecommendations = async (
  supabase: SupabaseClient,
  startDate: string | null
): Promise<RecResult> => {
  const [productsRes, eventsRes, linksRes, salesRes, postsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category, description, created_at')
      .eq('active', true),
    supabase.from('events').select('id, name, event_date, start_time, location, status'),
    supabase.from('event_products').select('event_id, product_id'),
    supabase.from('sales_results').select('event_id, product_id, status'),
    supabase
      .from('social_posts')
      .select('product_id, post_type, status, posted_at, updated_at')
      .in('status', [...HISTORY_STATUSES])
      .in('post_type', [...INTRO_POST_TYPES])
  ])

  for (const r of [productsRes, eventsRes, linksRes, salesRes, postsRes]) {
    if (r.error) throw r.error
  }

  return evaluateProducts({
    today: jstToday(),
    startDate,
    products: productsRes.data ?? [],
    events: eventsRes.data ?? [],
    eventProducts: linksRes.data ?? [],
    salesResults: salesRes.data ?? [],
    posts: postsRes.data ?? []
  })
}

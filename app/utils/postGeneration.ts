// AI文章生成（Edge Function generate-recommended-post）の呼び出し
// おすすめ候補の選び方（recommend.ts）とは独立していて、product_id を渡せばどの商品でも作れる。
// 将来の「商品を選んで投稿」からも、この関数をそのまま使う想定。
import type { SupabaseClient } from '@supabase/supabase-js'

export type GeneratedPost = {
  reason: string
  content_angle: string
  angle_label: string
  use_event_info: boolean
  allowed_angles: string[]
  posts: { id: string; platform: 'x' | 'threads'; content: string }[]
}

export const generatePostForProduct = async (
  supabase: SupabaseClient,
  productId: string,
  options: { excludeAngles?: string[]; avoidPostIds?: string[] } = {}
): Promise<GeneratedPost> => {
  const { data, error } = await supabase.functions.invoke('generate-recommended-post', {
    body: {
      product_id: productId,
      exclude_angles: options.excludeAngles ?? [],
      avoid_post_ids: (options.avoidPostIds ?? []).slice(-4)
    }
  })
  if (error) {
    // Function が返したエラーメッセージを取り出す
    let message = ''
    try {
      message = (await (error as any).context?.json())?.error ?? ''
    } catch {
      // 取れなければ下の共通メッセージ
    }
    throw new Error(message || '文章を作れませんでした。時間をおいてもう一度お試しください。')
  }
  return data as GeneratedPost
}

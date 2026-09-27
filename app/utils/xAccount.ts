// 連携中のXアカウント（表示用の @username だけ。秘密情報は含まないテーブル）
import type { SupabaseClient } from '@supabase/supabase-js'

export const loadXUsername = async (supabase: SupabaseClient) => {
  const { data, error } = await supabase
    .from('x_account_connection')
    .select('username')
    .maybeSingle()
  if (error) throw error
  return (data as { username: string } | null)?.username ?? null
}

// X投稿のURL。username が分からないときも開ける /i/web/status 形式にする
export const xPostUrl = (externalPostId: string, username?: string | null) =>
  username
    ? `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(externalPostId)}`
    : `https://x.com/i/web/status/${encodeURIComponent(externalPostId)}`

// 投稿処理中の仮の値（sending:…）は実際の投稿IDではない
export const isRealXPostId = (id?: string | null): id is string => !!id && /^\d+$/.test(id)

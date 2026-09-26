import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl.trim()
  const key = config.public.supabaseAnonKey.trim()
  let supabase: SupabaseClient | null = null
  let supabaseConfigError = ''

  if (!url || !key) {
    supabaseConfigError = 'Supabaseの接続情報が未設定です。プロジェクト直下の.envにProject URLとanon public keyを入力し、開発サーバーを再起動してください。'
  } else {
    try {
      supabase = createClient(url, key)
    } catch {
      supabaseConfigError = 'Supabaseの接続情報を確認してください。Project URLはhttps://から始まるURLを指定してください。'
    }
  }

  return { provide: { supabase, supabaseConfigError } }
})

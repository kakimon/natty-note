export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: false,

  app: {
    // GitHub Pages では /natty-note/ 配下で公開する（Actions で NUXT_APP_BASE_URL を渡す）
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      // viewport-fit=cover: iPhone の safe-area（env(safe-area-inset-bottom)）を使うため
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }]
    }
  },

  runtimeConfig: {
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      // ④新商品の判定開始日
      aiRecommendationStartDate: process.env.AI_RECOMMENDATION_START_DATE || '2026-10-01'
    }
  }
})

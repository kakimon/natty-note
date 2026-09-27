<script setup lang="ts">
// 投稿メニュー: おすすめ投稿を作る / 商品を選んで投稿する
import { categoryLabel } from '~/utils/products'
import { loadPostHistory, type HistoryPost } from '~/utils/postHistory'
import { loadXUsername } from '~/utils/xAccount'

type PickProduct = { id: string; name: string; category: string | null }

const { $supabase, $supabaseConfigError } = useNuxtApp()
const products = ref<PickProduct[]>([])
const loading = ref(true)
const errorMessage = ref('')

const load = async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const { data, error } = await $supabase
      .from('products')
      .select('id, name, category')
      .eq('active', true)
      .order('category')
      .order('name')
    if (error) throw error
    products.value = (data ?? []) as PickProduct[]
  } catch {
    errorMessage.value = '商品を読み込めませんでした。通信状態を確認してください。'
  } finally {
    loading.value = false
  }
}

// 最近の投稿（approved / posted の直近5件）
const recent = ref<HistoryPost[]>([])
const recentLoading = ref(true)
const recentError = ref('')
const xUsername = ref<string | null>(null)

const loadRecent = async () => {
  if (!$supabase) {
    recentLoading.value = false
    return
  }
  recentLoading.value = true
  recentError.value = ''
  loadXUsername($supabase).then(u => { xUsername.value = u }).catch(() => {})
  try {
    recent.value = await loadPostHistory($supabase, { limit: 5 })
  } catch {
    recentError.value = '最近の投稿を読み込めませんでした。'
  } finally {
    recentLoading.value = false
  }
}

onMounted(() => {
  load()
  loadRecent()
})
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>投稿</h1>

      <NuxtLink to="/posts/recommended" class="featured">✨ おすすめ投稿を作る</NuxtLink>
      <p class="hint">販売予定や紹介のタイミングから、今日おすすめの商品を選んで文章を作ります。</p>

      <h2>商品を選んで投稿</h2>
      <p class="hint">紹介したい商品を選ぶと、その商品の投稿文を作ります。</p>

      <p v-if="loading" role="status">読み込み中...</p>
      <div v-else-if="errorMessage" role="alert">
        <p class="error">{{ errorMessage }}</p>
        <button type="button" class="retry" @click="load">再試行</button>
      </div>
      <p v-else-if="products.length === 0" class="empty">
        販売中の商品がありません。
        <NuxtLink to="/products">商品を登録する</NuxtLink>
      </p>
      <ul v-else class="list">
        <li v-for="p in products" :key="p.id">
          <NuxtLink :to="{ path: '/posts/recommended', query: { product: p.id } }" class="pick">
            <span class="pick-body">
              <span class="name">{{ p.name }}</span>
              <span class="meta">{{ categoryLabel(p.category) }}</span>
            </span>
            <span class="arrow" aria-hidden="true">›</span>
          </NuxtLink>
        </li>
      </ul>

      <h2>最近の投稿</h2>
      <p v-if="recentLoading" role="status">読み込み中...</p>
      <div v-else-if="recentError" role="alert">
        <p class="error">{{ recentError }}</p>
        <button type="button" class="retry" @click="loadRecent">再試行</button>
      </div>
      <p v-else-if="recent.length === 0" class="empty-box">まだ投稿履歴はありません</p>
      <div v-else class="recent">
        <PostHistoryCard v-for="p in recent" :key="p.id" :post="p" :x-username="xUsername" compact />
      </div>
      <NuxtLink to="/posts/history" class="history-link">すべての投稿履歴を見る</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }
h2 { margin: 32px 0 6px; font-size: 18px; }

.featured {
  display: block;
  padding: 20px 16px;
  border-radius: 14px;
  background: #31694f;
  color: white;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
}

.hint { margin: 10px 0 0; font-size: 14px; line-height: 1.7; opacity: .75; }

.list { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }

.pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 14px 16px;
  border: 1px solid #dbe3dc;
  border-radius: 14px;
  color: #243b32;
  text-decoration: none;
}
.pick:active { background: #f1f7f3; }
.pick-body { display: grid; gap: 2px; min-width: 0; }
.name { font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
.meta { font-size: 13px; opacity: .7; }
.arrow { flex-shrink: 0; font-size: 26px; color: #31694f; }

.retry { padding: 12px 18px; border: 0; border-radius: 10px; background: #eef2ee; color: #294638; font: inherit; font-weight: 700; cursor: pointer; }
.error { color: #b42318; }
.empty { margin: 12px 0 0; opacity: .7; line-height: 1.7; }
.empty-box { margin: 12px 0 0; padding: 20px; border-radius: 12px; background: #f6f7f2; text-align: center; opacity: .8; }
.recent { display: grid; gap: 10px; margin-top: 12px; }
.history-link { display: block; margin-top: 14px; padding: 14px; border-radius: 12px; background: #eef2ee; color: #294638; font-weight: 700; text-align: center; text-decoration: none; }
.empty a { color: #31694f; font-weight: 700; }

a:focus-visible, button:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

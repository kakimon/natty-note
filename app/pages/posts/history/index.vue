<script setup lang="ts">
// 投稿履歴（approved / posted の全件。draft と cancelled は出さない）
import { loadPostHistory, type HistoryPost } from '~/utils/postHistory'
import { loadXUsername } from '~/utils/xAccount'

const { $supabase, $supabaseConfigError } = useNuxtApp()
const posts = ref<HistoryPost[]>([])
const xUsername = ref<string | null>(null)
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
  loadXUsername($supabase).then(u => { xUsername.value = u }).catch(() => {})
  try {
    posts.value = await loadPostHistory($supabase)
  } catch {
    errorMessage.value = '投稿履歴を読み込めませんでした。通信状態を確認してください。'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>投稿履歴</h1>
      <p class="hint">投稿済みと投稿準備済み（コピー済み）の投稿を、新しい順に表示しています。</p>

      <p v-if="loading" role="status">読み込み中...</p>
      <div v-else-if="errorMessage" role="alert">
        <p class="error">{{ errorMessage }}</p>
        <button type="button" class="retry" @click="load">再試行</button>
      </div>
      <p v-else-if="posts.length === 0" class="empty">まだ投稿履歴はありません</p>
      <div v-else class="list">
        <PostHistoryCard v-for="p in posts" :key="p.id" :post="p" :x-username="xUsername" />
      </div>

      <NuxtLink to="/posts" class="back">投稿メニューへ</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 8px; font-size: 24px; }
.hint { margin: 0 0 16px; font-size: 14px; line-height: 1.7; opacity: .75; }
.list { display: grid; gap: 12px; }
.empty { padding: 20px; border-radius: 12px; background: #f6f7f2; text-align: center; opacity: .8; }
.error { color: #b42318; }
.retry { padding: 12px 18px; border: 0; border-radius: 10px; background: #eef2ee; color: #294638; font: inherit; font-weight: 700; cursor: pointer; }
.back { display: block; margin-top: 24px; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }
a:focus-visible, button:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
@media (max-width: 480px) { .card { padding: 16px; } }
</style>

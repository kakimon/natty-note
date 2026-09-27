<script setup lang="ts">
// 投稿の詳細（表示のみ。posted の投稿は書き換えない）
import { loadPostHistory, type HistoryPost } from '~/utils/postHistory'
import { loadXUsername } from '~/utils/xAccount'

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()
const post = ref<HistoryPost | null>(null)
const xUsername = ref<string | null>(null)
const loading = ref(true)
const errorMessage = ref('')

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  loadXUsername($supabase).then(u => { xUsername.value = u }).catch(() => {})
  try {
    const rows = await loadPostHistory($supabase, { id: String(route.params.id) })
    post.value = rows[0] ?? null
    if (!post.value) errorMessage.value = 'この投稿は履歴にありません（下書きや削除済みの投稿は表示されません）'
  } catch {
    errorMessage.value = '投稿を読み込めませんでした。通信状態を確認してください。'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>投稿の詳細</h1>

      <p v-if="loading" role="status">読み込み中...</p>
      <p v-else-if="errorMessage" class="message" role="alert">{{ errorMessage }}</p>
      <template v-else-if="post">
        <PostHistoryCard :post="post" :x-username="xUsername" full />
        <img v-if="post.photoUrl" :src="post.photoUrl" alt="投稿の写真" class="photo">
      </template>

      <NuxtLink to="/posts/history" class="back">投稿履歴へ戻る</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 16px; font-size: 24px; }
.photo { display: block; width: 100%; max-height: 480px; margin-top: 12px; object-fit: contain; border-radius: 14px; background: #f6f7f2; }
.message { padding: 14px; border-radius: 12px; background: #f6f7f2; line-height: 1.7; }
.back { display: block; margin-top: 24px; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }
a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
@media (max-width: 480px) { .card { padding: 16px; } }
</style>

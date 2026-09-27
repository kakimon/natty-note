<script setup lang="ts">
// 設定メニュー。Xの連携状態は DB（x_account_connection）の表示用情報だけを読む（X APIは呼ばない）
const { $supabase } = useNuxtApp()
const loading = ref(true)
const username = ref<string | null>(null)
const loadFailed = ref(false)

onMounted(async () => {
  if (!$supabase) {
    loadFailed.value = true
    loading.value = false
    return
  }
  try {
    const { data, error } = await $supabase
      .from('x_account_connection')
      .select('username')
      .maybeSingle()
    if (error) throw error
    username.value = (data as { username: string } | null)?.username ?? null
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>設定</h1>

      <NuxtLink to="/settings/x" class="item">
        <span class="item-body">
          <span class="title">Xアカウント連携</span>
          <span v-if="loading" class="state">確認中...</span>
          <span v-else-if="loadFailed" class="state">連携状態を確認できませんでした</span>
          <span v-else-if="username" class="state ok">連携済み：@{{ username }}</span>
          <span v-else class="state">未連携</span>
        </span>
        <span class="arrow" aria-hidden="true">›</span>
      </NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  padding: 16px;
  border: 1px solid #dbe3dc;
  border-radius: 14px;
  color: #243b32;
  text-decoration: none;
}
.item:active { background: #f1f7f3; }
.item-body { display: grid; gap: 4px; min-width: 0; }
.title { font-size: 17px; font-weight: 700; }
.state { font-size: 14px; opacity: .7; overflow-wrap: anywhere; }
.state.ok { color: #31694f; opacity: 1; font-weight: 700; }
.arrow { flex-shrink: 0; font-size: 26px; color: #31694f; }

a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

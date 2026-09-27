<script setup lang="ts">
// 共通レイアウト: ログイン中だけ下部メニューを出す（ログイン画面では出さない）
const { $supabase } = useNuxtApp()
const loggedIn = ref(false)
let unsubscribe: (() => void) | undefined

onMounted(async () => {
  if (!$supabase) return
  const { data } = await $supabase.auth.getSession()
  loggedIn.value = !!data.session
  const { data: { subscription } } = $supabase.auth.onAuthStateChange((_event, session) => {
    loggedIn.value = !!session
  })
  unsubscribe = () => subscription.unsubscribe()
})

onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div class="layout" :class="{ 'with-nav': loggedIn }">
    <slot />
    <BottomNavigation v-if="loggedIn" />
  </div>
</template>

<style>
:root {
  /* 下部メニューの高さ（ボタンの押しやすさ優先） */
  --nav-height: 64px;
  /* 本文の下に空ける余白（メニュー＋iPhoneのホームバー） */
  --nav-space: calc(var(--nav-height) + env(safe-area-inset-bottom) + 16px);
}

.layout.with-nav {
  padding-bottom: var(--nav-space);
}

/* 各ページの .page(min-height:100vh) と下部余白が足されて無駄なスクロールにならないように */
.layout.with-nav .page {
  min-height: calc(100vh - var(--nav-space));
}
</style>

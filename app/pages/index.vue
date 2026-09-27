<script setup lang="ts">
import type { Session } from '@supabase/supabase-js'

const { $supabase, $supabaseConfigError } = useNuxtApp()
const session = shallowRef<Session | null>(null)
const initializing = ref(Boolean($supabase))
const email = ref('')
const password = ref('')
const submitting = ref(false)
const signingOut = ref(false)
const authError = ref('')
let authRevision = 0
let disposed = false
let unsubscribe: (() => void) | undefined

onMounted(async () => {
  if (!$supabase) return
  const { data: { subscription } } = $supabase.auth.onAuthStateChange((_event, nextSession) => {
    authRevision++
    session.value = nextSession
    initializing.value = false
  })
  unsubscribe = () => subscription.unsubscribe()
  const revision = authRevision
  try {
    const { data, error } = await $supabase.auth.getSession()
    if (disposed || revision !== authRevision) return
    if (error) authError.value = 'ログイン状態を確認できませんでした。もう一度ログインしてください。'
    else session.value = data.session
  } catch {
    if (!disposed && revision === authRevision) authError.value = 'ログイン状態を確認できませんでした。通信状態を確認してください。'
  } finally {
    if (!disposed) initializing.value = false
  }
})

onBeforeUnmount(() => {
  disposed = true
  unsubscribe?.()
})

async function signIn() {
  if (!$supabase || submitting.value) return
  submitting.value = true
  authError.value = ''
  try {
    const { error } = await $supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value
    })
    if (error) {
      authError.value = error.code === 'invalid_credentials'
        ? 'メールアドレスまたはパスワードが正しくありません。'
        : error.code === 'email_not_confirmed'
          ? 'メールアドレスの確認が完了していません。確認メールをご確認ください。'
          : 'ログインできませんでした。接続設定と通信状態を確認し、しばらくしてから再試行してください。'
    }
  } catch {
    authError.value = 'ログインできませんでした。通信状態を確認してください。'
  } finally {
    password.value = ''
    submitting.value = false
  }
}

async function signOut() {
  if (!$supabase || signingOut.value) return
  signingOut.value = true
  authError.value = ''
  try {
    const { error } = await $supabase.auth.signOut({ scope: 'local' })
    if (error) authError.value = 'ログアウトできませんでした。もう一度お試しください。'
  } catch {
    authError.value = 'ログアウトできませんでした。通信状態を確認してください。'
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <main>
    <header>
      <h1>natty note</h1>
      <p>ふたりの暮らしのメモ</p>
    </header>

    <section v-if="$supabaseConfigError" class="card" role="alert">
      <h2>接続設定</h2>
      <p>{{ $supabaseConfigError }}</p>
    </section>

    <p v-else-if="initializing" role="status">ログイン状態を確認中...</p>

    <section v-else-if="!session" class="card">
      <h2>ログイン</h2>
      <p>登録済みのアカウントでログインしてください。</p>
      <form @submit.prevent="signIn">
        <label for="email">メールアドレス</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required :disabled="submitting">
        <label for="password">パスワード</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required :disabled="submitting">
        <p v-if="authError" class="error" role="alert">{{ authError }}</p>
        <button type="submit" :disabled="submitting">{{ submitting ? 'ログイン中...' : 'ログイン' }}</button>
      </form>
    </section>

    <section v-else class="card">
      <div class="account">
        <p>{{ session.user.email }}</p>
        <button class="secondary" :disabled="signingOut" @click="signOut">{{ signingOut ? 'ログアウト中...' : 'ログアウト' }}</button>
      </div>
      <p v-if="authError" class="error" role="alert">{{ authError }}</p>
      <nav class="menu" aria-label="投稿">
        <NuxtLink to="/posts/recommended" class="menu-link menu-featured">✨ おすすめ投稿を作る</NuxtLink>
        <NuxtLink to="/posts" class="menu-link">🍰 商品を選んで投稿</NuxtLink>
      </nav>
      <UpcomingEvents :limit="3" />
      <p class="manage"><NuxtLink to="/products" class="manage-link">商品を管理する</NuxtLink></p>
    </section>
  </main>
</template>

<style scoped>
main { max-width: 640px; margin: 0 auto; padding: 40px 24px 24px; }
header { margin-bottom: 32px; }
h1 { margin: 0; font-size: 32px; letter-spacing: -.04em; }
h2 { margin: 0 0 16px; font-size: 22px; }
p { line-height: 1.7; overflow-wrap: anywhere; }
header p { color: #627269; }
.card { padding: 28px; border: 1px solid #dce3da; border-radius: 16px; background: white; }
form { display: grid; gap: 12px; margin-top: 24px; }
label { font-size: 14px; font-weight: 600; }
input { width: 100%; min-width: 0; padding: 12px; margin-bottom: 8px; border: 1px solid #8c9e91; border-radius: 8px; font: inherit; }
button { padding: 12px 18px; border: 1px solid #315f47; border-radius: 8px; background: #315f47; color: white; font: inherit; cursor: pointer; }
button:disabled { opacity: .6; cursor: wait; }
button.secondary { color: #315f47; background: white; }
input:focus-visible, button:focus-visible { outline: 3px solid #91b8a1; outline-offset: 3px; }
.account { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
.account p { margin: 0; min-width: 0; }
.error { color: #a12d28; }
.manage { margin: 0; text-align: center; }
.manage-link { display: inline-block; padding: 12px 16px; color: #31694f; font-weight: 700; }
.manage-link:focus-visible { outline: 3px solid #91b8a1; outline-offset: 3px; }
.menu { display: grid; gap: 10px; margin-bottom: 28px; }
.menu-link { display: block; padding: 16px; min-height: 52px; border-radius: 10px; background: #eef2ee; color: #294638; font-weight: 700; text-align: center; text-decoration: none; }
.menu-featured { padding: 20px 16px; background: #31694f; color: white; font-size: 18px; }
.menu-link:focus-visible { outline: 3px solid #91b8a1; outline-offset: 3px; }
@media (max-width: 480px) { main { padding: 24px 16px 16px; } .card { padding: 20px; } }
</style>

<script setup lang="ts">
// X アカウント連携（OAuth 1.0a）
// - 「認可する」で x-oauth-start を呼び、返ってきた X の認可URLへ移動する
// - X から戻ると x-oauth-callback がこの画面へ ?result=…&username=… 付きでリダイレクトしてくる
// トークンや secret はこの画面には一切届かない（URLにも載らない）

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()

type Connection = { username: string; display_name: string | null; connected_at: string }

const connection = ref<Connection | null>(null)
const loading = ref(true)
const starting = ref(false)
const errorMessage = ref('')

const result = typeof route.query.result === 'string' ? route.query.result : ''
const resultUsername = typeof route.query.username === 'string' ? route.query.username : ''

const resultMessages: Record<string, { ok: boolean; text: string }> = {
  success: { ok: true, text: 'Xアカウントの認証が完了しました' },
  cancelled: { ok: false, text: '認証がキャンセルされました' },
  expired: { ok: false, text: '認証情報の有効期限が切れています。もう一度「Xアカウントを認可する」からやり直してください' },
  used: { ok: false, text: 'この認証リンクはすでに使われています。もう一度最初からやり直してください' },
  invalid: { ok: false, text: '認証情報が正しくありません。もう一度最初からやり直してください' },
  wrong_account: { ok: false, text: 'natty 以外のアカウントで認可されたため、保存しませんでした。natty のアカウントでログインし直してください' },
  x_error: { ok: false, text: 'Xとの認証に失敗しました。時間をおいてもう一度お試しください' },
  save_error: { ok: false, text: '認証情報を保存できませんでした。もう一度お試しください' },
  config_error: { ok: false, text: 'X連携の設定（Supabase Secrets）が不足しています' }
}
const resultInfo = computed(() => (result ? resultMessages[result] ?? null : null))

const formatDate = (v: string) => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(async () => {
  // 結果表示は1回だけ（再読み込みで同じメッセージを出さない）
  if (result) navigateTo({ path: '/settings/x' }, { replace: true })
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  try {
    const { data } = await $supabase
      .from('x_account_connection')
      .select('username, display_name, connected_at')
      .maybeSingle()
    connection.value = data as Connection | null
  } catch {
    // テーブル未作成など。表示だけなので止めない
  } finally {
    loading.value = false
  }
})

const startAuth = async () => {
  if (!$supabase || starting.value) return
  starting.value = true
  errorMessage.value = ''
  try {
    const { data, error } = await $supabase.functions.invoke('x-oauth-start', { body: {} })
    if (error) {
      let message = ''
      try {
        message = (await (error as any).context?.json())?.error ?? ''
      } catch {
        // 下の共通メッセージ
      }
      throw new Error(message || 'Xとの認証を開始できませんでした')
    }
    if (typeof data?.authorize_url !== 'string' || !data.authorize_url.startsWith('https://')) {
      throw new Error('認可URLを受け取れませんでした')
    }
    window.location.href = data.authorize_url
  } catch (error: any) {
    errorMessage.value = error?.message ?? 'Xとの認証を開始できませんでした'
    starting.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>Xアカウント連携</h1>

      <div v-if="resultInfo" class="result" :class="{ ok: resultInfo.ok }" role="status">
        <p class="result-title">{{ resultInfo.text }}</p>
        <p v-if="resultUsername && (result === 'success' || result === 'wrong_account')">
          {{ result === 'success' ? '認証されたアカウント' : '認可に使われたアカウント' }}：@{{ resultUsername }}
        </p>
      </div>

      <p v-if="loading" role="status">読み込み中...</p>
      <template v-else>
        <div class="current">
          <p class="label">現在の連携</p>
          <p v-if="connection" class="account">
            @{{ connection.username }}
            <span v-if="connection.display_name">（{{ connection.display_name }}）</span>
            <small>{{ formatDate(connection.connected_at) }} に認可</small>
          </p>
          <p v-else class="none">まだ連携していません</p>
        </div>

        <p class="hint">
          X の画面が開いたら、<strong>natty のアカウント</strong>でログインして「連携アプリを認証」を押してください。
          別のアカウントで認可した場合は保存されません。
        </p>

        <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

        <button type="button" class="primary" :disabled="starting" @click="startAuth">
          {{ starting ? 'Xへ移動しています...' : (connection ? 'Xアカウントを認可し直す' : 'Xアカウントを認可する') }}
        </button>
      </template>

      <NuxtLink to="/settings" class="back">設定へ戻る</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }
.result { margin-bottom: 20px; padding: 14px; border-radius: 12px; background: #fdecea; color: #7a1f16; line-height: 1.7; }
.result.ok { background: #e3efe7; color: #31694f; }
.result p { margin: 0; }
.result-title { font-weight: 700; }
.current { padding: 14px; border-radius: 12px; background: #f6f7f2; }
.label { margin: 0 0 4px; font-size: 13px; opacity: .65; }
.account { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
.account small { display: block; margin-top: 4px; font-weight: 400; opacity: .7; }
.none { margin: 0; opacity: .7; }
.hint { font-size: 14px; line-height: 1.7; }
.error { color: #b42318; }
.primary { width: 100%; min-height: 54px; border: 0; border-radius: 12px; background: #111; color: white; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
.primary:disabled { opacity: .5; cursor: wait; }
.back { display: block; margin-top: 20px; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }
button:focus-visible, a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

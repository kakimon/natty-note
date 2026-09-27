<script setup lang="ts">
import type { ProductInput, ProductRow } from '~/utils/products'

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()
const productId = route.params.id as string

const product = ref<ProductRow | null>(null)
const loading = ref(true)
const saving = ref(false)
const toggling = ref(false)
const errorMessage = ref('')
const notice = ref('')

// 完全削除
const deleteDialog = ref(false)
const deleting = ref(false)
const checkingHistory = ref(false)
const historyBlocked = ref(false)
const photosBlocked = ref(false)

const photoCount = async () => {
  const { count, error } = await $supabase!
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId)
  if (error) throw error
  return count ?? 0
}

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  try {
    const { data, error } = await $supabase
      .from('products')
      .select('id, name, category, price, description, active')
      .eq('id', productId)
      .maybeSingle()
    if (error) throw error
    if (!data) errorMessage.value = '商品が見つかりませんでした'
    product.value = data as ProductRow | null
  } catch (error: any) {
    errorMessage.value = error?.message ?? '商品を読み込めませんでした'
  } finally {
    loading.value = false
  }
})

const save = async (value: ProductInput) => {
  if (!$supabase || !product.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    if (value.name !== product.value.name) {
      const { data: same, error: sameError } = await $supabase
        .from('products')
        .select('id')
        .eq('name', value.name)
        .neq('id', productId)
        .limit(1)
      if (sameError) throw sameError
      if (same && same.length) {
        errorMessage.value = `「${value.name}」という商品はすでにあります`
        return
      }
    }
    const { error } = await $supabase.from('products').update(value).eq('id', productId)
    if (error) throw error
    await navigateTo({ path: '/products', query: { notice: `「${value.name}」を保存しました` } })
  } catch (error: any) {
    errorMessage.value = error?.message ?? '保存できませんでした'
  } finally {
    saving.value = false
  }
}

// 販売終了 / 再開（active の切り替え）
const setActive = async (active: boolean) => {
  if (!$supabase || !product.value || toggling.value) return
  toggling.value = true
  errorMessage.value = ''
  try {
    const { error } = await $supabase.from('products').update({ active }).eq('id', productId)
    if (error) throw error
    const name = product.value.name
    await navigateTo({
      path: '/products',
      query: { notice: active ? `「${name}」の販売を再開しました` : `「${name}」の販売を終了しました` }
    })
  } catch {
    errorMessage.value = '変更できませんでした。もう一度お試しください。'
  } finally {
    toggling.value = false
  }
}

// 出店・販売・投稿の履歴があるか
const hasHistory = async () => {
  const tables = ['event_products', 'sales_results', 'social_posts'] as const
  const results = await Promise.all(
    tables.map(t =>
      $supabase!.from(t).select('id', { count: 'exact', head: true }).eq('product_id', productId)
    )
  )
  for (const r of results) if (r.error) throw r.error
  return results.some(r => (r.count ?? 0) > 0)
}

const askDelete = async () => {
  if (!$supabase || checkingHistory.value) return
  checkingHistory.value = true
  historyBlocked.value = false
  photosBlocked.value = false
  errorMessage.value = ''
  try {
    if (await hasHistory()) historyBlocked.value = true
    else if (await photoCount()) photosBlocked.value = true
    else deleteDialog.value = true
  } catch {
    errorMessage.value = '履歴を確認できませんでした。もう一度お試しください。'
  } finally {
    checkingHistory.value = false
  }
}

const confirmDelete = async () => {
  if (!$supabase || !product.value || deleting.value) return
  deleting.value = true
  try {
    // 確認ダイアログを開いている間に履歴ができていないか、もう一度確認
    if (await hasHistory()) {
      deleteDialog.value = false
      historyBlocked.value = true
      return
    }
    if (await photoCount()) {
      deleteDialog.value = false
      photosBlocked.value = true
      return
    }
    const { error } = await $supabase.from('products').delete().eq('id', productId)
    if (error) throw error
    const name = product.value.name
    await navigateTo({ path: '/products', query: { notice: `「${name}」を削除しました` } })
  } catch {
    deleteDialog.value = false
    errorMessage.value = '削除できませんでした。もう一度お試しください。'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>商品を編集</h1>

      <p v-if="loading" role="status">読み込み中...</p>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>

      <template v-if="product">
        <ProductForm :initial="product" submit-label="保存する" :saving="saving" @submit="save" />

        <NuxtLink :to="`/products/${productId}/photos`" class="photos-link">📷 写真を管理</NuxtLink>

        <hr>

        <button
          v-if="product.active"
          type="button"
          class="end"
          :disabled="toggling"
          @click="setActive(false)"
        >
          販売を終了する
        </button>
        <button
          v-else
          type="button"
          class="resume"
          :disabled="toggling"
          @click="setActive(true)"
        >
          販売を再開する
        </button>
        <p class="hint">
          販売を終了すると、出店の商品選びやAIのおすすめから外れます。過去の販売・投稿の記録は残ります。
        </p>

        <div class="danger">
          <button type="button" class="delete-link" :disabled="checkingHistory" @click="askDelete">
            {{ checkingHistory ? '確認中...' : '完全に削除する' }}
          </button>
          <p class="delete-hint">登録間違いのときだけ使ってください</p>
          <div v-if="photosBlocked" class="blocked" role="alert">
            <p>この商品には写真が登録されています。</p>
            <p>完全に削除する場合は、先に「写真を管理」から写真を削除してください。</p>
          </div>
          <div v-if="historyBlocked" class="blocked" role="alert">
            <p>この商品には過去の販売・投稿履歴があります。</p>
            <p>履歴を残すため完全削除はできません。</p>
            <p>「販売を終了する」を使用してください。</p>
          </div>
        </div>
      </template>

      <div class="footer">
        <NuxtLink to="/products" class="back">商品管理へ戻る</NuxtLink>
      </div>
    </section>

    <div v-if="deleteDialog && product" class="overlay" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div class="dialog">
        <p id="delete-title" class="dialog-title">「{{ product.name }}」を完全に削除しますか？</p>
        <p>この操作は元に戻せません。</p>
        <div class="dialog-buttons">
          <button type="button" class="cancel" :disabled="deleting" @click="deleteDialog = false">キャンセル</button>
          <button type="button" class="delete" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '削除中...' : '削除する' }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }
hr { margin: 32px 0 24px; border: 0; border-top: 1px solid #dbe3dc; }

button { font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: wait; }

.end,
.resume {
  width: 100%;
  min-height: 52px;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 700;
}
.end { border: 2px solid #8a5a00; background: white; color: #8a5a00; }
.resume { border: 0; background: #31694f; color: white; }

.photos-link { display: block; margin-top: 16px; padding: 14px; border-radius: 12px; background: #eef2ee; color: #294638; font-weight: 700; text-align: center; text-decoration: none; }
.hint { margin: 10px 0 0; font-size: 13px; line-height: 1.7; opacity: .7; }

.danger { margin-top: 32px; text-align: center; }
.delete-link { padding: 8px; border: 0; background: none; color: #b42318; font-size: 14px; text-decoration: underline; }

.delete-hint { margin: 2px 0 0; font-size: 12px; opacity: .6; }
.blocked { margin-top: 12px; padding: 14px; border-radius: 12px; background: #fdecea; color: #7a1f16; text-align: left; line-height: 1.7; }
.blocked p { margin: 0; }

.error { margin: 0 0 16px; padding: 12px; border-radius: 10px; background: #fdecea; color: #b42318; }
.notice { margin: 0 0 16px; padding: 12px; border-radius: 10px; background: #e3efe7; color: #31694f; }

.footer { margin-top: 28px; }
.back { display: block; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }

.overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, .4); }
.dialog { width: 100%; max-width: 420px; padding: 24px; border-radius: 18px; background: white; }
.dialog-title { margin: 0 0 8px; font-size: 18px; font-weight: 700; overflow-wrap: anywhere; }
.dialog-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
.cancel, .delete { min-height: 50px; border: 0; border-radius: 12px; font-weight: 700; }
.cancel { background: #eef2ee; color: #294638; }
.delete { background: #b42318; color: white; }

button:focus-visible, a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

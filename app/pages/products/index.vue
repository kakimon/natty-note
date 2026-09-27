<script setup lang="ts">
import { categoryLabel, formatPrice, type ProductRow } from '~/utils/products'

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()

const products = ref<ProductRow[]>([])
const loading = ref(true)
const errorMessage = ref('')
const notice = ref(typeof route.query.notice === 'string' ? route.query.notice : '')
const updating = reactive<Record<string, boolean>>({})

const activeProducts = computed(() => products.value.filter(p => p.active))
const endedProducts = computed(() => products.value.filter(p => !p.active))

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
      .select('id, name, category, price, description, active')
      .order('category')
      .order('name')
    if (error) throw error
    products.value = (data ?? []) as ProductRow[]
  } catch (error: any) {
    errorMessage.value = error?.message ?? '商品を読み込めませんでした'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // 「保存しました」などの表示は1回だけ。再読み込みで古いメッセージが出ないようURLから外す
  if (route.query.notice) navigateTo({ path: '/products' }, { replace: true })
  load()
})

const resume = async (product: ProductRow) => {
  if (!$supabase || updating[product.id]) return
  updating[product.id] = true
  notice.value = ''
  try {
    const { error } = await $supabase
      .from('products')
      .update({ active: true })
      .eq('id', product.id)
    if (error) throw error
    product.active = true
    notice.value = `「${product.name}」の販売を再開しました`
  } catch {
    errorMessage.value = '販売を再開できませんでした。もう一度お試しください。'
  } finally {
    updating[product.id] = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>商品管理</h1>

      <NuxtLink to="/products/new" class="add-button">＋ 商品を追加</NuxtLink>

      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

      <p v-if="loading" role="status">読み込み中...</p>

      <template v-else>
        <h2>販売中の商品</h2>
        <p v-if="activeProducts.length === 0" class="empty">販売中の商品はありません</p>

        <ul class="list">
          <li v-for="p in activeProducts" :key="p.id" class="item">
            <div class="item-body">
              <p class="name">{{ p.name }}</p>
              <p class="meta">{{ categoryLabel(p.category) }} ｜ {{ formatPrice(p.price) }}</p>
              <p v-if="!p.description" class="warn">商品説明が未入力です</p>
            </div>
            <div class="item-actions">
              <NuxtLink :to="`/products/${p.id}/edit`" class="edit">編集</NuxtLink>
              <NuxtLink :to="`/products/${p.id}/photos`" class="edit">写真を管理</NuxtLink>
            </div>
          </li>
        </ul>

        <details v-if="endedProducts.length" class="ended">
          <summary>販売終了の商品（{{ endedProducts.length }}）</summary>
          <ul class="list">
            <li v-for="p in endedProducts" :key="p.id" class="item ended-item">
              <div class="item-body">
                <p class="name">{{ p.name }}</p>
                <p class="meta">{{ categoryLabel(p.category) }} ｜ {{ formatPrice(p.price) }}</p>
              </div>
              <div class="item-actions">
                <button type="button" class="resume" :disabled="updating[p.id]" @click="resume(p)">
                  販売を再開する
                </button>
                <NuxtLink :to="`/products/${p.id}/edit`" class="edit">編集</NuxtLink>
              </div>
            </li>
          </ul>
        </details>
      </template>

      <div class="footer">
        <NuxtLink to="/" class="back">トップへ戻る</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }
h2 { margin: 28px 0 8px; font-size: 17px; }

.add-button {
  display: block;
  padding: 16px;
  border-radius: 12px;
  background: #31694f;
  color: white;
  font-size: 17px;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
}

.list { margin: 0; padding: 0; list-style: none; }

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  padding: 16px;
  border: 1px solid #dbe3dc;
  border-radius: 14px;
}

.item-body { min-width: 0; }
.name { margin: 0; font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
.meta { margin: 4px 0 0; font-size: 14px; opacity: .7; }
.warn { margin: 6px 0 0; font-size: 13px; color: #8a5a00; }

.item-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }

.edit,
.resume {
  flex-shrink: 0;
  min-width: 72px;
  padding: 10px 14px;
  border: 0;
  border-radius: 10px;
  background: #eef2ee;
  color: #294638;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}

.resume { background: #31694f; color: white; }
.resume:disabled { opacity: .5; }

.ended { margin-top: 28px; }
.ended summary { padding: 12px 0; font-weight: 700; cursor: pointer; }
.ended-item { background: #f6f7f2; }

.notice { margin: 16px 0 0; padding: 12px; border-radius: 10px; background: #e3efe7; color: #31694f; font-weight: 700; }
.error { color: #b42318; }
.empty { opacity: .65; }

.footer { margin-top: 28px; }
.back { display: block; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }

a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

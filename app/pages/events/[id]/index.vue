<script setup lang="ts">
const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()

const event = ref<any>(null)
const products = ref<any[]>([])
const loading = ref(true)
const errorMessage = ref('')

// "10:00:00" → "10:00"
const formatTime = (value?: string | null) => (value ? value.slice(0, 5) : '未入力')

const statusLabels: Record<string, string> = {
  scheduled: '出店予定',
  open: '出店中',
  finished: '終了',
  cancelled: '中止'
}

const formatStatus = (value?: string | null) =>
  value ? statusLabels[value] ?? value : '未設定'

// "2026-10-04" → "2026年10月4日(日)"
const formatDate = (value?: string | null) => {
  if (!value) return '未入力'
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return value
  const week = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
  return `${y}年${m}月${d}日(${week})`
}

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }

  const eventId = route.params.id as string

  try {
    const { data: eventData, error: eventError } = await $supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!eventData) {
      errorMessage.value = '出店予定が見つかりませんでした'
      return
    }

    event.value = eventData

    const { data: productLinks, error: productError } = await $supabase
      .from('event_products')
      .select(`
        product_id,
        products (
          id,
          name,
          category
        )
      `)
      .eq('event_id', eventId)

    if (productError) throw productError

    products.value =
      productLinks?.map((row: any) => row.products).filter(Boolean) ?? []
  } catch (error: any) {
    errorMessage.value = error?.message ?? '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
})

const chiffonProducts = computed(() =>
  products.value.filter(p => p.category === 'chiffon')
)

const muffinProducts = computed(() =>
  products.value.filter(p => p.category === 'muffin')
)

const otherProducts = computed(() =>
  products.value.filter(p => p.category !== 'chiffon' && p.category !== 'muffin')
)
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>

      <p v-if="loading" role="status">読み込み中...</p>

      <div v-else-if="errorMessage" role="alert">
        <p class="error">{{ errorMessage }}</p>
        <div class="buttons">
          <NuxtLink to="/" class="button secondary">トップへ</NuxtLink>
        </div>
      </div>

      <template v-else-if="event">
        <p class="label">出店予定</p>
        <h1>{{ event.name }}</h1>

        <dl>
          <dt>出店日</dt>
          <dd>{{ formatDate(event.event_date) }}</dd>

          <dt>場所</dt>
          <dd>{{ event.location || '未入力' }}</dd>

          <dt>時間</dt>
          <dd>
            {{ formatTime(event.start_time) }}
            〜
            {{ formatTime(event.end_time) }}
          </dd>

          <dt>状態</dt>
          <dd>
            <span class="status" :class="`status-${event.status}`">
              {{ formatStatus(event.status) }}
            </span>
          </dd>
        </dl>

        <h2>販売予定商品</h2>

        <p v-if="products.length === 0" class="empty">
          商品が選ばれていません
        </p>

        <template v-else>
          <template v-if="chiffonProducts.length">
            <h3>シフォン</h3>
            <ul>
              <li v-for="product in chiffonProducts" :key="product.id">
                {{ product.name }}
              </li>
            </ul>
          </template>

          <template v-if="muffinProducts.length">
            <h3>マフィン</h3>
            <ul>
              <li v-for="product in muffinProducts" :key="product.id">
                {{ product.name }}
              </li>
            </ul>
          </template>

          <template v-if="otherProducts.length">
            <h3>その他</h3>
            <ul>
              <li v-for="product in otherProducts" :key="product.id">
                {{ product.name }}
              </li>
            </ul>
          </template>
        </template>

        <div class="buttons">
          <NuxtLink to="/" class="button secondary">
            トップへ
          </NuxtLink>

          <NuxtLink
            :to="`/events/${event.id}/today`"
            class="button primary"
          >
            当日画面へ
          </NuxtLink>
        </div>

        <NuxtLink to="/posts/recommended" class="button secondary recommend">
          ✨ おすすめ投稿を見る
        </NuxtLink>
      </template>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24px;
  background: #f6f7f2;
  color: #243b32;
}

.card {
  max-width: 620px;
  margin: 0 auto;
  padding: 28px;
  background: white;
  border: 1px solid #dbe3dc;
  border-radius: 22px;
}

.brand {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 24px;
}

.label {
  margin: 0;
  font-size: 14px;
  opacity: .65;
}

h1 {
  margin: 4px 0 24px;
  overflow-wrap: anywhere;
}

h2 {
  margin-top: 32px;
  font-size: 18px;
}

h3 {
  margin: 20px 0 4px;
  font-size: 14px;
  opacity: .7;
}

dt {
  margin-top: 16px;
  font-size: 13px;
  opacity: .65;
}

dd {
  margin: 4px 0 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: 12px 0;
  border-bottom: 1px solid #edf0ed;
  overflow-wrap: anywhere;
}

.empty {
  opacity: .65;
}

.buttons {
  display: flex;
  gap: 12px;
  margin-top: 32px;
}

.button {
  flex: 1;
  padding: 14px;
  border-radius: 10px;
  font-size: 16px;
  text-align: center;
  text-decoration: none;
}

.recommend {
  display: block;
  margin-top: 12px;
}

.button.primary {
  background: #31694f;
  color: white;
}

.button.secondary {
  background: #eef2ee;
  color: #294638;
}

.button:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: 3px;
}

.error {
  color: #b42318;
}

.status {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 14px;
  background: #eef2ee;
  color: #294638;
}

.status-open {
  background: #31694f;
  color: white;
}

.status-finished {
  background: #e7e9e7;
  color: #5b665f;
}

.status-cancelled {
  background: #fdecea;
  color: #b42318;
}

@media (max-width: 480px) {
  .page { padding: 16px; }
  .card { padding: 20px; }
}
</style>

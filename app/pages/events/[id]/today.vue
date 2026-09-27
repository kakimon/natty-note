<script setup lang="ts">
import { saleTypeLabel, statusLabelFor } from '~/utils/saleTypes'

type SalesStatus = 'available' | 'few_left' | 'sold_out'

type Product = {
  id: string
  name: string
  category: string | null
}

type SalesResult = {
  product_id: string
  status: SalesStatus
  updated_at: string
}

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()

const eventId = route.params.id as string

const event = ref<any>(null)
const products = ref<Product[]>([])
// product_id → 現在の販売状態（行がない商品は「販売中」扱い）
const results = reactive<Record<string, SalesResult>>({})
// 保存中の product_id
const saving = reactive<Record<string, boolean>>({})

// 状態変更直後に出す「おしらせを作る」案内
const notice = ref<{ product: Product; status: SalesStatus } | null>(null)

const postLink = (type: string, productId?: string) => ({
  path: '/posts/new',
  query: productId
    ? { event: eventId, product: productId, type }
    : { event: eventId, type }
})

const loading = ref(true)
const errorMessage = ref('')
const saveError = ref('')

const statusOptions: { value: SalesStatus; label: string }[] = [
  { value: 'available', label: '販売中' },
  { value: 'few_left', label: '残りわずか' },
  { value: 'sold_out', label: '完売' }
]

const statusLabel = (status: SalesStatus) =>
  statusOptions.find(o => o.value === status)?.label ?? status

const statusOf = (productId: string): SalesStatus =>
  results[productId]?.status ?? 'available'

// "10:00:00" → "10:00"
const formatTime = (value?: string | null) => (value ? value.slice(0, 5) : '')

// timestamptz → "14:12"
const formatClock = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

// "2026-10-04" → "10月4日(日)"
const formatDate = (value?: string | null) => {
  if (!value) return ''
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return value
  const week = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
  return `${m}月${d}日(${week})`
}

const timeRange = computed(() => {
  if (!event.value) return ''
  const start = formatTime(event.value.start_time)
  const end = formatTime(event.value.end_time)
  if (!start && !end) return ''
  return `${start || '--:--'} 〜 ${end || '--:--'}`
})

// ---- events.status の自動切替 ----
// scheduled → open（当日・開始時刻以降）→ finished（終了時刻以降）。
// 逆戻りはさせない。cancelled は触らない。
type EventStatus = 'scheduled' | 'open' | 'finished' | 'cancelled'

const eventStatusLabels: Record<EventStatus, string> = {
  scheduled: '出店予定',
  open: '出店中',
  finished: '終了',
  cancelled: '中止'
}

const statusRank: Record<string, number> = { scheduled: 0, open: 1, finished: 2 }

const pad = (n: number) => String(n).padStart(2, '0')

// 端末の現在日時を "YYYY-MM-DD" / "HH:MM" で
const nowParts = () => {
  const d = new Date()
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

const expectedEventStatus = (ev: any): EventStatus | null => {
  if (!ev?.event_date) return null
  const { date, time } = nowParts()
  const start = formatTime(ev.start_time)
  const end = formatTime(ev.end_time)

  if (ev.event_date < date) return 'finished'
  if (ev.event_date > date) return 'scheduled'

  // 当日
  if (end && time >= end) return 'finished'
  if (!start || time >= start) return 'open'
  return 'scheduled'
}

let syncingEventStatus = false

const syncEventStatus = async () => {
  const ev = event.value
  if (!$supabase || !ev || syncingEventStatus) return
  if (ev.status === 'cancelled') return

  const next = expectedEventStatus(ev)
  if (!next) return
  // 前に進むときだけ更新する
  if ((statusRank[next] ?? -1) <= (statusRank[ev.status] ?? -1)) return

  syncingEventStatus = true
  try {
    const { data, error } = await $supabase
      .from('events')
      .update({ status: next })
      .eq('id', ev.id)
      .eq('status', ev.status) // 他の端末で変わっていたら上書きしない
      .select('status')
      .maybeSingle()

    if (error) throw error
    if (data) event.value = { ...ev, status: data.status }
  } catch (error) {
    // 販売記録の邪魔をしないよう、画面には出さずに記録だけ残す
    console.warn('events.status の自動更新に失敗しました', error)
  } finally {
    syncingEventStatus = false
  }
}

let statusTimer: ReturnType<typeof setInterval> | undefined

onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
})

const categoryOrder: Record<string, number> = { chiffon: 0, muffin: 1 }

const sortedProducts = computed(() =>
  [...products.value].sort((a, b) => {
    const ca = categoryOrder[a.category ?? ''] ?? 9
    const cb = categoryOrder[b.category ?? ''] ?? 9
    return ca - cb || a.name.localeCompare(b.name, 'ja')
  })
)

const counts = computed(() => {
  const c = { available: 0, few_left: 0, sold_out: 0 }
  for (const p of products.value) c[statusOf(p.id)]++
  return c
})

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }

  try {
    const { data: eventData, error: eventError } = await $supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!eventData) {
      errorMessage.value = '販売予定が見つかりませんでした'
      return
    }
    event.value = eventData

    const [linksRes, resultsRes] = await Promise.all([
      $supabase
        .from('event_products')
        .select('product_id, products ( id, name, category )')
        .eq('event_id', eventId),
      $supabase
        .from('sales_results')
        .select('product_id, status, updated_at')
        .eq('event_id', eventId)
    ])

    if (linksRes.error) throw linksRes.error
    if (resultsRes.error) throw resultsRes.error

    products.value =
      (linksRes.data ?? []).map((row: any) => row.products).filter(Boolean)

    for (const row of (resultsRes.data ?? []) as SalesResult[]) {
      results[row.product_id] = row
    }
  } catch (error: any) {
    errorMessage.value = error?.message ?? '読み込みに失敗しました'
  } finally {
    loading.value = false
  }

  if (event.value) {
    void syncEventStatus()
    // 画面を開いたまま開始・終了時刻をまたいでも切り替わるように1分ごとに確認
    statusTimer = setInterval(() => void syncEventStatus(), 60_000)
  }
})

// 当日の販売状況（販売中／残りわずか／完売）と速報はイベント出店だけ。
// 直売所への納品・受注販売・その他は、natty 側でリアルタイムの在庫が分からないため使わない
const liveSalesEnabled = computed(() => (event.value?.sale_type ?? 'event') === 'event')

const changeStatus = async (product: Product, status: SalesStatus) => {
  if (!$supabase || saving[product.id] || !liveSalesEnabled.value) return
  if (statusOf(product.id) === status) return

  const previous = results[product.id]

  // 先に画面を切り替える（タップの反応を早く）。時刻は保存後にDBの値で置き換える
  results[product.id] = {
    product_id: product.id,
    status,
    updated_at: new Date().toISOString()
  }
  saving[product.id] = true
  saveError.value = ''

  try {
    const { data, error } = await $supabase
      .from('sales_results')
      .upsert(
        {
          event_id: eventId,
          product_id: product.id,
          status
        },
        { onConflict: 'event_id,product_id' }
      )
      .select('product_id, status, updated_at')
      .single()

    if (error) throw error
    if (data) results[product.id] = data as SalesResult

    // 完売・残りわずかにしたときだけ、おしらせ作成を案内する
    notice.value =
      status === 'sold_out' || status === 'few_left' ? { product, status } : null
  } catch (error: any) {
    // 失敗したら元の状態に戻す
    if (previous) results[product.id] = previous
    else delete results[product.id]
    saveError.value =
      `「${product.name}」を保存できませんでした。通信状態を確認してもう一度押してください。`
  } finally {
    saving[product.id] = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p v-if="loading" role="status">読み込み中...</p>

      <div v-else-if="errorMessage" role="alert">
        <p class="brand">natty note</p>
        <p class="error">{{ errorMessage }}</p>
        <div class="footer">
          <NuxtLink to="/" class="link-button">トップへ</NuxtLink>
        </div>
      </div>

      <template v-else-if="event">
        <header class="header">
          <p class="label">
            {{ (event.sale_type ?? 'event') === 'event' ? '今日の出店' : `今日の${saleTypeLabel(event.sale_type)}` }}<span v-if="event.event_date">　{{ formatDate(event.event_date) }}</span>
          </p>
          <h1>{{ event.name }}</h1>
          <p class="time">
            <span v-if="timeRange">{{ timeRange }}</span>
            <span
              v-if="event.status"
              class="event-status"
              :class="`event-status-${event.status}`"
            >
              {{ statusLabelFor(event.sale_type, event.status) }}
            </span>
          </p>
        </header>

        <div v-if="!liveSalesEnabled" class="no-live" role="status">
          <p>この販売方法では、当日の販売状況の記録と速報のおしらせは使いません。</p>
          <p>（販売状況の記録はイベント出店のときだけ使えます）</p>
        </div>

        <template v-else>
        <div v-if="products.length" class="summary">
          <span class="chip chip-available">販売中 {{ counts.available }}</span>
          <span class="chip chip-few_left">残りわずか {{ counts.few_left }}</span>
          <span class="chip chip-sold_out">完売 {{ counts.sold_out }}</span>
        </div>

        <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>

        <p v-if="products.length === 0" class="empty">
          販売する商品が登録されていません
        </p>

        <ul class="products">
          <li
            v-for="product in sortedProducts"
            :key="product.id"
            class="product"
            :class="`is-${statusOf(product.id)}`"
          >
            <div class="product-head">
              <p class="product-name">{{ product.name }}</p>
              <p class="product-status">
                {{ statusLabel(statusOf(product.id)) }}
                <span v-if="results[product.id]" class="updated">
                  {{ formatClock(results[product.id].updated_at) }}
                </span>
              </p>
            </div>

            <div class="status-buttons" role="group" :aria-label="`${product.name}の販売状態`">
              <button
                v-for="option in statusOptions"
                :key="option.value"
                type="button"
                class="status-button"
                :class="[`opt-${option.value}`, { active: statusOf(product.id) === option.value }]"
                :aria-pressed="statusOf(product.id) === option.value"
                :disabled="saving[product.id]"
                @click="changeStatus(product, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </li>
        </ul>
        </template>

        <div class="footer">
          <NuxtLink
            v-if="products.length && (event.sale_type ?? 'event') === 'event'"
            :to="postLink('closing_soon')"
            class="link-button"
          >
            まもなく終了のおしらせを作る
          </NuxtLink>

          <NuxtLink :to="`/events/${event.id}`" class="link-button">
            販売予定の詳細へ
          </NuxtLink>
        </div>

        <div v-if="notice && liveSalesEnabled" class="notice" role="status">
          <p class="notice-text">
            {{ notice.product.name }}を{{ statusLabel(notice.status) }}にしました
          </p>
          <div class="notice-buttons">
            <NuxtLink
              :to="postLink(notice.status, notice.product.id)"
              class="notice-primary"
            >
              おしらせを作る
            </NuxtLink>
            <button type="button" class="notice-secondary" @click="notice = null">
              今は作らない
            </button>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 16px;
  background: #f6f7f2;
  color: #243b32;
}

.card {
  max-width: 620px;
  margin: 0 auto;
  padding: 24px;
  background: white;
  border: 1px solid #dbe3dc;
  border-radius: 22px;
}

.brand {
  font-size: 28px;
  font-weight: 800;
}

.header {
  margin-bottom: 16px;
}

.label {
  margin: 0;
  font-size: 14px;
  opacity: .65;
}

h1 {
  margin: 4px 0 0;
  font-size: 26px;
  overflow-wrap: anywhere;
}

.time {
  margin: 6px 0 0;
  font-size: 18px;
  font-weight: 700;
}

.time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.event-status {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  background: #eef2ee;
  color: #294638;
}

.event-status-open {
  background: #31694f;
  color: white;
}

.event-status-finished {
  background: #e7e9e7;
  color: #5b665f;
}

.event-status-cancelled {
  background: #fdecea;
  color: #b42318;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}

.chip {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}

.chip-available { background: #e3efe7; color: #31694f; }
.chip-few_left  { background: #fff1d6; color: #8a5a00; }
.chip-sold_out  { background: #e7e9e7; color: #5b665f; }

.products {
  margin: 0;
  padding: 0;
  list-style: none;
}

.product {
  padding: 18px 0;
  border-bottom: 1px solid #edf0ed;
}

.product-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.product-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.product-status {
  flex-shrink: 0;
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.is-available .product-status { color: #31694f; }
.is-few_left .product-status  { color: #8a5a00; }
.is-sold_out .product-status  { color: #5b665f; }
.is-sold_out .product-name    { opacity: .5; }

.updated {
  margin-left: 4px;
  font-weight: 400;
  opacity: .75;
}

.status-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.status-button {
  min-height: 52px;
  padding: 8px 4px;
  border: 2px solid #dbe3dc;
  border-radius: 12px;
  background: white;
  color: #294638;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.status-button:disabled {
  opacity: .6;
  cursor: wait;
}

.status-button:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: 2px;
}

.status-button.opt-available.active {
  border-color: #31694f;
  background: #31694f;
  color: white;
}

.status-button.opt-few_left.active {
  border-color: #c98a00;
  background: #f5b82e;
  color: #3d2a00;
}

.status-button.opt-sold_out.active {
  border-color: #5b665f;
  background: #5b665f;
  color: white;
}

.empty {
  opacity: .65;
}

.notice {
  position: fixed;
  right: 12px;
  bottom: 12px;
  left: 12px;
  max-width: 596px;
  margin: 0 auto;
  padding: 16px;
  border-radius: 18px;
  background: #243b32;
  color: white;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
}

.notice-text {
  margin: 0 0 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.notice-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.notice-primary,
.notice-secondary {
  min-height: 48px;
  padding: 12px 8px;
  border: 0;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}

.notice-primary {
  background: #f5b82e;
  color: #3d2a00;
}

.notice-secondary {
  background: rgba(255, 255, 255, .14);
  color: white;
}

.no-live {
  margin: 16px 0;
  padding: 14px;
  border-radius: 12px;
  background: #f6f7f2;
  line-height: 1.7;
}

.no-live p {
  margin: 0;
}

.footer {
  display: grid;
  gap: 10px;
  /* 案内パネルにボタンが隠れないよう余白を確保 */
  padding-bottom: 120px;
  margin-top: 28px;
}

.link-button {
  display: block;
  padding: 14px;
  border-radius: 10px;
  background: #eef2ee;
  color: #294638;
  text-align: center;
  text-decoration: none;
}

.link-button:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: 3px;
}

.error {
  color: #b42318;
}
</style>

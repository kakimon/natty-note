<script setup lang="ts">
import { deleteEventCompletely, eventHistoryCounts } from '~/utils/events'

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

// ---- 中止・完全削除 ----
const dialog = ref<'cancel' | 'restore' | 'delete' | null>(null)
const busy = ref(false)
const actionError = ref('')
const deleteBlocked = ref('')
const checkingHistory = ref(false)

const setStatus = async (status: 'cancelled' | 'scheduled') => {
  if (!$supabase || !event.value || busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    const { error } = await $supabase.from('events').update({ status }).eq('id', event.value.id)
    if (error) throw error
    event.value = { ...event.value, status }
    dialog.value = null
  } catch {
    actionError.value = '変更できませんでした。もう一度お試しください。'
    dialog.value = null
  } finally {
    busy.value = false
  }
}

const askDelete = async () => {
  if (!$supabase || !event.value || checkingHistory.value) return
  checkingHistory.value = true
  deleteBlocked.value = ''
  actionError.value = ''
  try {
    const counts = await eventHistoryCounts($supabase, event.value.id)
    if (counts.sales || counts.posts) {
      deleteBlocked.value = 'この出店予定には販売記録または投稿履歴があります。\n履歴を残すため完全削除はできません。\n開催しなかった場合は「中止にする」、開催済みなら状態を「終了」にしてください。'
    } else {
      dialog.value = 'delete'
    }
  } catch {
    actionError.value = '履歴を確認できませんでした。もう一度お試しください。'
  } finally {
    checkingHistory.value = false
  }
}

const confirmDelete = async () => {
  if (!$supabase || !event.value || busy.value) return
  busy.value = true
  try {
    // 確認中に記録ができていないか、削除直前にもう一度確認
    const counts = await eventHistoryCounts($supabase, event.value.id)
    if (counts.sales || counts.posts) {
      dialog.value = null
      deleteBlocked.value = 'この出店予定には販売記録または投稿履歴があります。\n履歴を残すため完全削除はできません。'
      return
    }
    await deleteEventCompletely($supabase, event.value.id)
    await navigateTo('/')
  } catch {
    dialog.value = null
    actionError.value = '削除できませんでした。もう一度お試しください。'
  } finally {
    busy.value = false
  }
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

          <template v-if="event.memo">
            <dt>メモ</dt>
            <dd class="memo">{{ event.memo }}</dd>
          </template>

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

        <section class="manage">
          <h2>この出店予定の管理</h2>

          <NuxtLink :to="`/events/${event.id}/edit`" class="button secondary">
            編集する
          </NuxtLink>

          <button
            v-if="event.status !== 'cancelled'"
            type="button"
            class="button cancel-event"
            @click="dialog = 'cancel'"
          >
            中止にする
          </button>
          <button
            v-else
            type="button"
            class="button secondary"
            @click="dialog = 'restore'"
          >
            出店予定に戻す
          </button>

          <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>

          <div class="danger">
            <button type="button" class="delete-link" :disabled="checkingHistory" @click="askDelete">
              {{ checkingHistory ? '確認中...' : '完全に削除する' }}
            </button>
            <p class="delete-hint">登録間違いのときだけ使ってください</p>
            <p v-if="deleteBlocked" class="blocked" role="alert">{{ deleteBlocked }}</p>
          </div>
        </section>
      </template>
    </section>

    <ConfirmDialog
      v-if="dialog === 'cancel' && event"
      :title="`「${event.name}」を中止にしますか？`"
      message="出店予定は残り、状態が「中止」になります。あとで「出店予定に戻す」こともできます。"
      confirm-label="中止にする"
      :busy="busy"
      danger
      @confirm="setStatus('cancelled')"
      @cancel="dialog = null"
    />
    <ConfirmDialog
      v-if="dialog === 'restore' && event"
      :title="`「${event.name}」を出店予定に戻しますか？`"
      confirm-label="出店予定に戻す"
      :busy="busy"
      @confirm="setStatus('scheduled')"
      @cancel="dialog = null"
    />
    <ConfirmDialog
      v-if="dialog === 'delete' && event"
      :title="`「${event.name}」を完全に削除しますか？`"
      message="この操作は元に戻せません。"
      confirm-label="削除する"
      :busy="busy"
      danger
      @confirm="confirmDelete"
      @cancel="dialog = null"
    />
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

.memo { white-space: pre-wrap; font-weight: 400; }

.manage { margin-top: 40px; padding-top: 8px; border-top: 1px solid #dbe3dc; }
.manage h2 { font-size: 16px; }
.manage .button { display: block; width: 100%; margin-top: 10px; box-sizing: border-box; border: 0; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
.cancel-event { background: white; color: #8a5a00; outline: 2px solid #8a5a00; outline-offset: -2px; }
.danger { margin-top: 28px; text-align: center; }
.delete-link { padding: 8px; border: 0; background: none; color: #b42318; font: inherit; font-size: 14px; text-decoration: underline; cursor: pointer; }
.delete-link:disabled { opacity: .5; }
.delete-hint { margin: 2px 0 0; font-size: 12px; opacity: .6; }
.blocked { margin-top: 12px; padding: 14px; border-radius: 12px; background: #fdecea; color: #7a1f16; text-align: left; line-height: 1.7; white-space: pre-line; }

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

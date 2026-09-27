<script setup lang="ts">
// トップページ用: 今日以降の販売予定（中止・終了を除く）を日付の近い順に5件
import { formatShortDate, loadEventSummaries, shortProductList, type EventSummary } from '~/utils/events'
import { saleTypeDef, statusLabelFor } from '~/utils/saleTypes'

const { $supabase } = useNuxtApp()
const events = ref<EventSummary[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  if (!$supabase) {
    loading.value = false
    return
  }
  try {
    events.value = await loadEventSummaries($supabase, { upcomingOnly: true, limit: 5 })
  } catch {
    error.value = '販売予定を読み込めませんでした'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="upcoming">
    <div class="head">
      <h2>販売予定</h2>
      <NuxtLink to="/events" class="all-link">すべて見る</NuxtLink>
    </div>

    <p v-if="loading" role="status">読み込み中...</p>
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="events.length === 0" class="empty">これからの販売予定はありません</p>

    <ul v-else class="list">
      <li v-for="e in events" :key="e.id" class="item">
        <div class="body">
          <p class="date">
            {{ formatShortDate(e.event_date) }}
            <span class="type">{{ saleTypeDef(e.sale_type).icon }} {{ saleTypeDef(e.sale_type).label }}</span>
            <span v-if="e.status === 'open'" class="open">{{ statusLabelFor(e.sale_type, e.status) }}</span>
          </p>
          <p class="name">{{ e.name }}</p>
          <p class="products">{{ shortProductList(e.productNames) }}</p>
        </div>
        <NuxtLink :to="`/events/${e.id}`" class="open-link">見る・編集</NuxtLink>
      </li>
    </ul>

    <div class="actions">
      <NuxtLink to="/events/new" class="action primary">＋ 販売予定を追加</NuxtLink>
      <NuxtLink to="/events" class="action">すべての販売予定を見る</NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.upcoming { margin-bottom: 28px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.head h2 { margin: 0; }
.all-link { font-size: 14px; color: #31694f; }
.list { margin: 0; padding: 0; list-style: none; }
.item { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; padding: 12px 14px; border: 1px solid #dbe3dc; border-radius: 12px; }
.body { min-width: 0; }
.body p { margin: 0; line-height: 1.5; }
.date { font-weight: 700; }
.type { margin-left: 6px; font-size: 13px; font-weight: 400; opacity: .75; }
.open { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #31694f; color: white; font-size: 12px; }
.name { font-size: 15px; overflow-wrap: anywhere; }
.products { font-size: 13px; opacity: .7; overflow-wrap: anywhere; }
.open-link { flex-shrink: 0; padding: 10px 12px; border-radius: 10px; background: #eef2ee; color: #294638; font-size: 14px; font-weight: 700; text-decoration: none; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.action { display: block; padding: 12px 8px; border-radius: 10px; background: #eef2ee; color: #294638; font-size: 14px; font-weight: 700; text-align: center; text-decoration: none; }
.action.primary { background: #31694f; color: white; }
.empty { opacity: .7; }
.error { color: #b42318; }
a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

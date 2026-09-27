<script setup lang="ts">
// 販売予定の一覧（中止も履歴として表示）。編集・中止・完全削除は各予定の詳細画面（/events/[id]）で行う
import { formatShortDate, jstTodayString, loadEventSummaries, shortProductList, type EventSummary } from '~/utils/events'
import { saleTypeDef, statusLabelFor } from '~/utils/saleTypes'

const { $supabase, $supabaseConfigError } = useNuxtApp()
const events = ref<EventSummary[]>([])
const loading = ref(true)
const errorMessage = ref('')

const today = jstTodayString()
// 今日以降: 日付の近い順 / 過去: 新しい順
const upcoming = computed(() => events.value.filter(e => e.event_date >= today))
const past = computed(() => events.value.filter(e => e.event_date < today).reverse())

const formatTime = (v: string | null) => (v ? v.slice(0, 5) : '')

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  try {
    events.value = await loadEventSummaries($supabase)
  } catch (error: any) {
    errorMessage.value = error?.message ?? '販売予定を読み込めませんでした'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>販売予定</h1>

      <NuxtLink to="/events/new" class="add-button">＋ 販売予定を追加</NuxtLink>

      <p v-if="loading" role="status">読み込み中...</p>
      <p v-else-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

      <template v-else>
        <h2>これからの予定</h2>
        <p v-if="upcoming.length === 0" class="empty">これからの販売予定はありません</p>
        <ul class="list">
          <li v-for="e in upcoming" :key="e.id">
            <NuxtLink :to="`/events/${e.id}`" class="row" :class="`st-${e.status}`">
              <span class="row-top">
                <span class="date">{{ formatShortDate(e.event_date) }}</span>
                <span v-if="e.start_time" class="time">{{ formatTime(e.start_time) }}〜{{ formatTime(e.end_time) }}</span>
                <span class="status" :class="`status-${e.status}`">{{ statusLabelFor(e.sale_type, e.status) }}</span>
              </span>
              <span class="type">{{ saleTypeDef(e.sale_type).icon }} {{ saleTypeDef(e.sale_type).label }}</span>
              <span class="name">{{ e.name }}</span>
              <span class="products">{{ shortProductList(e.productNames) }}</span>
            </NuxtLink>
          </li>
        </ul>

        <details v-if="past.length" class="past">
          <summary>過去の予定（{{ past.length }}）</summary>
          <ul class="list">
            <li v-for="e in past" :key="e.id">
              <NuxtLink :to="`/events/${e.id}`" class="row past-row" :class="`st-${e.status}`">
                <span class="row-top">
                  <span class="date">{{ formatShortDate(e.event_date) }}</span>
                  <span class="status" :class="`status-${e.status}`">{{ statusLabelFor(e.sale_type, e.status) }}</span>
                </span>
                <span class="type">{{ saleTypeDef(e.sale_type).icon }} {{ saleTypeDef(e.sale_type).label }}</span>
                <span class="name">{{ e.name }}</span>
                <span class="products">{{ shortProductList(e.productNames) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </details>
      </template>

      <p class="hint">予定を押すと、内容の確認・編集・中止ができます。</p>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }
h2 { margin: 28px 0 4px; font-size: 17px; }
.add-button { display: block; padding: 16px; border-radius: 12px; background: #31694f; color: white; font-size: 17px; font-weight: 700; text-align: center; text-decoration: none; }
.list { margin: 0; padding: 0; list-style: none; }
.row { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; padding: 14px 16px; border: 1px solid #dbe3dc; border-radius: 14px; color: #243b32; text-decoration: none; }
.row:hover { border-color: #91b8a1; }
.row-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.date { font-weight: 700; font-size: 16px; }
.time { font-size: 13px; opacity: .7; }
.status { margin-left: auto; padding: 2px 10px; border-radius: 999px; background: #eef2ee; font-size: 12px; font-weight: 700; }
.status-open { background: #31694f; color: white; }
.status-finished { background: #e7e9e7; color: #5b665f; }
.status-cancelled { background: #fdecea; color: #b42318; }
.type { font-size: 13px; opacity: .75; }
.name { font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
.products { font-size: 13px; opacity: .7; overflow-wrap: anywhere; }
.st-cancelled .name { text-decoration: line-through; opacity: .6; }
.past { margin-top: 28px; }
.past summary { padding: 10px 0; font-weight: 700; cursor: pointer; }
.past-row { background: #f6f7f2; }
.hint { margin-top: 24px; font-size: 13px; opacity: .7; }
.back { display: block; margin-top: 12px; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }
.empty { opacity: .65; }
.error { color: #b42318; }
a:focus-visible, summary:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

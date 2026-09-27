<script setup lang="ts">
import { EVENT_STATUS_OPTIONS } from '~/utils/events'
import { SALE_TYPES, resolveSaleName, saleTypeDef, statusLabelFor } from '~/utils/saleTypes'

type Product = { id: string; name: string; category: string | null; active: boolean }

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()
const eventId = route.params.id as string

const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const found = ref(false)

const form = reactive({
  saleType: 'event',
  eventDate: '',
  name: '',
  location: '',
  startTime: '',
  endTime: '',
  memo: '',
  status: 'scheduled',
  productIds: [] as string[]
})
const errors = reactive({ eventDate: '', name: '', time: '' })
const typeDef = computed(() => saleTypeDef(form.saleType))
const statusOptions = computed(() =>
  EVENT_STATUS_OPTIONS.map(o => ({ value: o.value, label: statusLabelFor(form.saleType, o.value) }))
)

const products = ref<Product[]>([])
const originalProductIds = ref<string[]>([])
// このイベントで販売記録がある商品（外すと記録と合わなくなるので外せない）
const recordedProductIds = ref<string[]>([])

const categoryGroups = computed(() => {
  // 販売中の商品＋（販売終了でも）このイベントに入っている商品
  const visible = products.value.filter(p => p.active || originalProductIds.value.includes(p.id))
  const groups = [
    { key: 'chiffon', label: 'シフォン', items: visible.filter(p => p.category === 'chiffon') },
    { key: 'muffin', label: 'マフィン', items: visible.filter(p => p.category === 'muffin') },
    { key: 'other', label: 'その他', items: visible.filter(p => p.category !== 'chiffon' && p.category !== 'muffin') }
  ]
  return groups.filter(g => g.items.length)
})

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  try {
    const [eventRes, productsRes, linksRes, salesRes] = await Promise.all([
      $supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      $supabase.from('products').select('id, name, category, active').order('category').order('name'),
      $supabase.from('event_products').select('product_id').eq('event_id', eventId),
      $supabase.from('sales_results').select('product_id').eq('event_id', eventId)
    ])
    for (const r of [eventRes, productsRes, linksRes, salesRes]) if (r.error) throw r.error
    if (!eventRes.data) {
      errorMessage.value = '販売予定が見つかりませんでした'
      return
    }
    const ev = eventRes.data
    form.saleType = ev.sale_type ?? 'event'
    form.eventDate = ev.event_date ?? ''
    form.name = ev.name ?? ''
    form.location = ev.location ?? ''
    form.startTime = ev.start_time ? ev.start_time.slice(0, 5) : ''
    form.endTime = ev.end_time ? ev.end_time.slice(0, 5) : ''
    form.memo = ev.memo ?? ''
    form.status = ev.status ?? 'scheduled'

    products.value = (productsRes.data ?? []) as Product[]
    originalProductIds.value = (linksRes.data ?? []).map((r: any) => r.product_id)
    form.productIds = [...originalProductIds.value]
    recordedProductIds.value = (salesRes.data ?? []).map((r: any) => r.product_id)
    found.value = true
  } catch (error: any) {
    errorMessage.value = error?.message ?? '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
})

const validate = () => {
  errors.eventDate = form.eventDate ? '' : `${typeDef.value.dateLabel}を入力してください`
  errors.name = !typeDef.value.nameRequired || form.name.trim() ? '' : `${typeDef.value.nameLabel}を入力してください`
  errors.time =
    form.startTime && form.endTime && form.endTime <= form.startTime
      ? '終了時間は開始時間より後にしてください'
      : ''
  return !errors.eventDate && !errors.name && !errors.time
}

const save = async () => {
  if (!$supabase || saving.value || !validate()) return
  saving.value = true
  errorMessage.value = ''
  try {
    const { error: updateError } = await $supabase
      .from('events')
      .update({
        sale_type: form.saleType,
        event_date: form.eventDate,
        name: resolveSaleName(form.saleType, form.name, form.location),
        location: form.location.trim() || null,
        start_time: form.startTime || null,
        end_time: form.endTime || null,
        memo: form.memo.trim() || null,
        status: form.status
      })
      .eq('id', eventId)
    if (updateError) throw updateError

    // 販売予定商品の差分だけ追加・削除する
    const added = form.productIds.filter(id => !originalProductIds.value.includes(id))
    const removed = originalProductIds.value.filter(
      id => !form.productIds.includes(id) && !recordedProductIds.value.includes(id)
    )
    if (added.length) {
      const { error } = await $supabase
        .from('event_products')
        .insert(added.map(productId => ({ event_id: eventId, product_id: productId })))
      if (error) throw error
    }
    if (removed.length) {
      const { error } = await $supabase
        .from('event_products')
        .delete()
        .eq('event_id', eventId)
        .in('product_id', removed)
      if (error) throw error
    }

    await navigateTo(`/events/${eventId}`)
  } catch (error: any) {
    errorMessage.value = error?.message ?? '保存できませんでした'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>販売予定を編集</h1>

      <p v-if="loading" role="status">読み込み中...</p>
      <p v-if="errorMessage" class="error-box" role="alert">{{ errorMessage }}</p>

      <form v-if="found" novalidate @submit.prevent="save">
        <label>
          販売方法
          <select v-model="form.saleType">
            <option v-for="t in SALE_TYPES" :key="t.value" :value="t.value">{{ t.icon }} {{ t.label }}</option>
          </select>
        </label>

        <label>
          {{ typeDef.dateLabel }}
          <input v-model="form.eventDate" type="date" :aria-invalid="!!errors.eventDate">
          <span v-if="errors.eventDate" class="error">{{ errors.eventDate }}</span>
        </label>

        <label>
          {{ typeDef.nameLabel }}
          <input v-model="form.name" type="text" :placeholder="typeDef.namePlaceholder" :aria-invalid="!!errors.name">
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </label>

        <label>
          {{ typeDef.locationLabel }}
          <input v-model="form.location" type="text" :placeholder="typeDef.locationPlaceholder">
        </label>

        <div class="time-row">
          <label>
            開始
            <input v-model="form.startTime" type="time">
          </label>
          <label>
            終了
            <input v-model="form.endTime" type="time">
          </label>
        </div>
        <p v-if="errors.time" class="error">{{ errors.time }}</p>

        <label>
          メモ
          <textarea v-model="form.memo" rows="3" placeholder="搬入時間、持ち物など" />
        </label>

        <label>
          状態
          <select v-model="form.status">
            <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>

        <h2>販売予定商品</h2>
        <template v-for="group in categoryGroups" :key="group.key">
          <h3>{{ group.label }}</h3>
          <label v-for="p in group.items" :key="p.id" class="product">
            <input
              v-model="form.productIds"
              type="checkbox"
              :value="p.id"
              :disabled="recordedProductIds.includes(p.id) && form.productIds.includes(p.id)"
            >
            <span>
              {{ p.name }}
              <small v-if="!p.active" class="tag">販売終了</small>
              <small v-if="recordedProductIds.includes(p.id)" class="tag">販売記録あり</small>
            </span>
          </label>
        </template>
        <p v-if="recordedProductIds.length" class="hint">
          「販売記録あり」の商品は、当日の記録を残すため外せません。
        </p>

        <div class="buttons">
          <NuxtLink :to="`/events/${eventId}`" class="button secondary">キャンセル</NuxtLink>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? '保存中...' : '保存する' }}
          </button>
        </div>
      </form>

      <div v-else-if="!loading" class="footer">
        <NuxtLink to="/events" class="button secondary">販売予定一覧へ</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 16px; font-size: 24px; }
h2 { margin: 28px 0 4px; font-size: 18px; }
h3 { margin: 16px 0 0; font-size: 14px; opacity: .7; }

label { display: block; margin: 16px 0; font-weight: 600; }

input[type="text"], input[type="date"], input[type="time"], select, textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 8px;
  padding: 13px;
  border: 1px solid #9aac9f;
  border-radius: 10px;
  background: white;
  font: inherit;
  font-size: 16px;
  font-weight: 400;
}
textarea { line-height: 1.7; resize: vertical; }
[aria-invalid="true"] { border-color: #b42318; }

.time-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.time-row label { margin-bottom: 0; }

.product { display: flex; align-items: center; gap: 12px; margin: 0; padding: 12px 0; border-bottom: 1px solid #edf0ed; font-weight: 400; }
.product input { transform: scale(1.25); }
.tag { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #eef2ee; font-size: 12px; }

.error { display: block; margin-top: 6px; color: #b42318; font-size: 14px; font-weight: 400; }
.error-box { padding: 12px; border-radius: 10px; background: #fdecea; color: #b42318; }
.hint { font-size: 13px; opacity: .7; }

.buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 28px; }
.footer { margin-top: 20px; }
.button { display: block; min-height: 50px; padding: 14px; border: 0; border-radius: 10px; font: inherit; font-size: 16px; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; box-sizing: border-box; }
.button.primary { background: #31694f; color: white; }
.button.secondary { background: #eef2ee; color: #294638; }
.button:disabled { opacity: .5; cursor: wait; }
.button:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

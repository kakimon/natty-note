<script setup lang="ts">
import { SALE_TYPES, resolveSaleName, saleTypeDef, type SaleType } from '~/utils/saleTypes'

const { $supabase, $supabaseConfigError } = useNuxtApp()

const step = ref(1)
const loading = ref(false)
const errorMessage = ref('')

const products = ref<any[]>([])

const form = reactive({
  saleType: 'event' as SaleType,
  eventDate: '',
  name: '',
  location: '',
  startTime: '',
  endTime: '',
  productIds: [] as string[]
})

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabaseに接続できません'
    return
  }

  const { data, error } = await $supabase
    .from('products')
    .select('id, name, category')
    .eq('active', true)
    .order('category')
    .order('name')

  if (error) {
    errorMessage.value = error.message
    return
  }

  products.value = data ?? []
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

const selectedProducts = computed(() =>
  products.value.filter(p => form.productIds.includes(p.id))
)

const typeDef = computed(() => saleTypeDef(form.saleType))
// イベント出店は名前が必須。それ以外は空なら自動で名前を付ける
const canLeaveStep2 = computed(() => !typeDef.value.nameRequired || !!form.name.trim())
const resolvedName = computed(() => resolveSaleName(form.saleType, form.name, form.location))

const nextStep = () => {
  if (step.value < 4) step.value++
}

const previousStep = () => {
  if (step.value > 1) step.value--
}

const saveEvent = async () => {
  if (!$supabase) return
  loading.value = true
  errorMessage.value = ''

  try {
    const { data: event, error: eventError } = await $supabase
      .from('events')
      .insert({
        sale_type: form.saleType,
        event_date: form.eventDate,
        name: resolvedName.value,
        location: form.location.trim() || null,
        start_time: form.startTime || null,
        end_time: form.endTime || null
      })
      .select('id')
      .single()

    if (eventError) throw eventError

    if (form.productIds.length > 0) {
      const rows = form.productIds.map(productId => ({
        event_id: event.id,
        product_id: productId
      }))

      const { error: productsError } = await $supabase
        .from('event_products')
        .insert(rows)

      if (productsError) throw productsError
    }

    await navigateTo(`/events/${event.id}`)
  } catch (error: any) {
    errorMessage.value = error.message ?? '登録に失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>

      <p class="step">STEP {{ step }} / 4</p>

      <div v-if="step === 1">
        <h1>どの方法で販売しますか？</h1>

        <div class="sale-types" role="radiogroup" aria-label="販売方法">
          <label
            v-for="t in SALE_TYPES"
            :key="t.value"
            class="sale-type"
            :class="{ selected: form.saleType === t.value }"
          >
            <input v-model="form.saleType" type="radio" name="sale-type" :value="t.value">
            <span class="sale-icon" aria-hidden="true">{{ t.icon }}</span>
            <span>{{ t.label }}</span>
          </label>
        </div>

        <label>
          {{ typeDef.dateLabel }}
          <input v-model="form.eventDate" type="date">
        </label>

        <button
          :disabled="!form.eventDate"
          @click="nextStep"
        >
          次へ
        </button>
      </div>

      <div v-else-if="step === 2">
        <h1>{{ typeDef.stepTitle }}</h1>

        <label>
          {{ typeDef.nameLabel }}
          <input
            v-model="form.name"
            type="text"
            :placeholder="typeDef.namePlaceholder"
          >
        </label>

        <label>
          {{ typeDef.locationLabel }}
          <input
            v-model="form.location"
            type="text"
            :placeholder="typeDef.locationPlaceholder"
          >
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

        <div class="buttons">
          <button class="secondary" @click="previousStep">
            戻る
          </button>

          <button
            :disabled="!canLeaveStep2"
            @click="nextStep"
          >
            次へ
          </button>
        </div>
      </div>

      <div v-else-if="step === 3">
        <h1>販売する商品を選んでください</h1>

        <h2>シフォン</h2>

        <label
          v-for="product in chiffonProducts"
          :key="product.id"
          class="product"
        >
          <input
            v-model="form.productIds"
            type="checkbox"
            :value="product.id"
          >
          {{ product.name }}
        </label>

        <h2>マフィン</h2>

        <label
          v-for="product in muffinProducts"
          :key="product.id"
          class="product"
        >
          <input
            v-model="form.productIds"
            type="checkbox"
            :value="product.id"
          >
          {{ product.name }}
        </label>

        <template v-if="otherProducts.length">
          <h2>その他</h2>

          <label
            v-for="product in otherProducts"
            :key="product.id"
            class="product"
          >
            <input
              v-model="form.productIds"
              type="checkbox"
              :value="product.id"
            >
            {{ product.name }}
          </label>
        </template>

        <div class="buttons">
          <button class="secondary" @click="previousStep">
            戻る
          </button>

          <button @click="nextStep">
            次へ
          </button>
        </div>
      </div>

      <div v-else>
        <h1>内容を確認してください</h1>

        <dl>
          <dt>販売方法</dt>
          <dd>{{ typeDef.label }}</dd>

          <dt>{{ typeDef.dateLabel }}</dt>
          <dd>{{ form.eventDate }}</dd>

          <dt>名前</dt>
          <dd>{{ resolvedName }}</dd>

          <dt>{{ typeDef.locationLabel }}</dt>
          <dd>{{ form.location || '未入力' }}</dd>

          <dt>時間</dt>
          <dd>
            {{ form.startTime || '未入力' }}
            〜
            {{ form.endTime || '未入力' }}
          </dd>
        </dl>

        <h2>販売予定</h2>

        <ul>
          <li
            v-for="product in selectedProducts"
            :key="product.id"
          >
            {{ product.name }}
          </li>
        </ul>

        <p v-if="errorMessage" class="error">
          {{ errorMessage }}
        </p>

        <div class="buttons">
          <button class="secondary" @click="previousStep">
            修正する
          </button>

          <button
            :disabled="loading"
            @click="saveEvent"
          >
            {{ loading ? '登録中...' : 'この内容で登録' }}
          </button>
        </div>
      </div>

      <p v-if="errorMessage && step !== 4" class="error">
        {{ errorMessage }}
      </p>

      <!-- どのSTEPからでもトップへ戻れる（保存前なので確認なし） -->
      <NuxtLink to="/" class="back-home">
        トップへ戻る
      </NuxtLink>
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

.step {
  font-size: 14px;
  opacity: .65;
}

h1 {
  margin-bottom: 24px;
}

h2 {
  margin-top: 28px;
  font-size: 18px;
}

label {
  display: block;
  margin: 18px 0;
  font-weight: 600;
}

input[type="text"],
input[type="date"],
input[type="time"] {
  box-sizing: border-box;
  width: 100%;
  margin-top: 8px;
  padding: 13px;
  border: 1px solid #9aac9f;
  border-radius: 10px;
  font-size: 16px;
}

.time-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.product {
  padding: 12px 0;
  border-bottom: 1px solid #edf0ed;
}

.product input {
  margin-right: 10px;
  transform: scale(1.25);
}

.buttons {
  display: flex;
  gap: 12px;
  margin-top: 28px;
}

button {
  flex: 1;
  padding: 14px;
  border: 0;
  border-radius: 10px;
  background: #31694f;
  color: white;
  font-size: 16px;
  cursor: pointer;
}

button.secondary {
  background: #eef2ee;
  color: #294638;
}

button:disabled {
  opacity: .45;
  cursor: not-allowed;
}

dt {
  margin-top: 16px;
  font-size: 13px;
  opacity: .65;
}

dd {
  margin: 4px 0 0;
  font-weight: 600;
}

.sale-types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 8px;
}

.sale-type {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 88px;
  margin: 0;
  padding: 12px 8px;
  border: 2px solid #dbe3dc;
  border-radius: 14px;
  text-align: center;
  cursor: pointer;
}

.sale-type.selected {
  border-color: #31694f;
  background: #f1f7f3;
}

.sale-type input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.sale-type input:focus-visible + .sale-icon {
  outline: 3px solid #91b8a1;
  outline-offset: 2px;
}

.sale-icon {
  font-size: 26px;
}

.back-home {
  display: block;
  margin-top: 24px;
  padding: 12px;
  color: #294638;
  font-size: 14px;
  text-align: center;
  text-decoration: underline;
}

.back-home:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: 2px;
}

.error {
  color: #b42318;
}
</style>

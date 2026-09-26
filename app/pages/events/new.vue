<script setup lang="ts">
const { $supabase, $supabaseConfigError } = useNuxtApp()

const step = ref(1)
const loading = ref(false)
const errorMessage = ref('')

const products = ref<any[]>([])

const form = reactive({
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

const selectedProducts = computed(() =>
  products.value.filter(p => form.productIds.includes(p.id))
)

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
        event_date: form.eventDate,
        name: form.name,
        location: form.location || null,
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
        <h1>いつ出店しますか？</h1>

        <label>
          出店日
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
        <h1>どこで販売しますか？</h1>

        <label>
          イベント名
          <input
            v-model="form.name"
            type="text"
            placeholder="○○マルシェ"
          >
        </label>

        <label>
          場所
          <input
            v-model="form.location"
            type="text"
            placeholder="○○交流センター"
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
            :disabled="!form.name"
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
          <dt>出店日</dt>
          <dd>{{ form.eventDate }}</dd>

          <dt>イベント</dt>
          <dd>{{ form.name }}</dd>

          <dt>場所</dt>
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

.error {
  color: #b42318;
}
</style>

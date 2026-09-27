<script setup lang="ts">
import { CATEGORY_OPTIONS, type ProductInput } from '~/utils/products'

const props = defineProps<{
  initial?: Partial<ProductInput>
  submitLabel: string
  saving?: boolean
}>()

const emit = defineEmits<{ submit: [value: ProductInput] }>()

const form = reactive({
  name: props.initial?.name ?? '',
  category: props.initial?.category ?? CATEGORY_OPTIONS[0].value,
  price: props.initial?.price != null ? String(props.initial.price) : '',
  description: props.initial?.description ?? '',
  active: props.initial?.active ?? true
})

const errors = reactive({ name: '', price: '' })

const submit = () => {
  errors.name = ''
  errors.price = ''

  const name = form.name.trim()
  if (!name) errors.name = '商品名を入力してください'
  else if (name.length > 50) errors.name = '商品名は50文字以内にしてください'

  // 全角数字やカンマも受け付ける
  const priceText = form.price
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，円\s]/g, '')
  let price: number | null = null
  if (priceText) {
    if (!/^\d+$/.test(priceText)) errors.price = '価格は数字で入力してください'
    else price = Number(priceText)
  }

  if (errors.name || errors.price) return

  emit('submit', {
    name,
    category: form.category,
    price,
    description: form.description.trim() || null,
    active: form.active
  })
}
</script>

<template>
  <form class="product-form" novalidate @submit.prevent="submit">
    <label class="field">
      <span class="label">商品名 <span class="required">必須</span></span>
      <input v-model="form.name" type="text" placeholder="例：プレーンシフォン" :aria-invalid="!!errors.name">
      <span v-if="errors.name" class="error">{{ errors.name }}</span>
    </label>

    <label class="field">
      <span class="label">カテゴリ</span>
      <select v-model="form.category">
        <option v-for="o in CATEGORY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
    </label>

    <label class="field">
      <span class="label">価格</span>
      <span class="price-row">
        <input v-model="form.price" type="text" inputmode="numeric" placeholder="例：1200" :aria-invalid="!!errors.price">
        <span>円</span>
      </span>
      <span v-if="errors.price" class="error">{{ errors.price }}</span>
    </label>

    <label class="field">
      <span class="label">商品説明</span>
      <span class="hint">
        商品の特徴や味など、SNSで紹介してよい内容を書いてください。<br>
        AIのおすすめ投稿は、ここに書かれたことだけを商品の特徴として使います
        （例：「ふんわり」「しっとり」も、ここに書いてあれば使われます）。
      </span>
      <textarea v-model="form.description" rows="5" placeholder="例：自家栽培の風さやかの米粉で焼いた、ふんわり軽い食感のシフォンです。" />
    </label>

    <fieldset class="field">
      <legend class="label">販売状態</legend>
      <label class="radio">
        <input v-model="form.active" type="radio" :value="true"> 販売中
      </label>
      <label class="radio">
        <input v-model="form.active" type="radio" :value="false"> 販売終了
      </label>
    </fieldset>

    <button type="submit" class="primary" :disabled="saving">
      {{ saving ? '保存中...' : submitLabel }}
    </button>
  </form>
</template>

<style scoped>
.product-form {
  display: grid;
  gap: 20px;
}

.field {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.label {
  font-weight: 700;
}

.required {
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #fdecea;
  color: #b42318;
  font-size: 12px;
}

.hint {
  font-size: 13px;
  line-height: 1.7;
  opacity: .75;
}

input[type="text"],
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 13px;
  border: 1px solid #9aac9f;
  border-radius: 10px;
  background: white;
  font: inherit;
  font-size: 16px;
}

textarea {
  line-height: 1.7;
  resize: vertical;
}

[aria-invalid="true"] {
  border-color: #b42318;
}

.price-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.price-row input {
  max-width: 200px;
}

.radio {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
}

.radio input {
  transform: scale(1.3);
}

.error {
  color: #b42318;
  font-size: 14px;
}

button.primary {
  min-height: 54px;
  border: 0;
  border-radius: 12px;
  background: #31694f;
  color: white;
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  opacity: .5;
  cursor: wait;
}
</style>

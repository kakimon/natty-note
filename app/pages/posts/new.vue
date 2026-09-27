<script setup lang="ts">
import {
  buildPost,
  postTypeLabels,
  templateCount,
  xWeightedLength,
  type PostType,
  type TemplateInput
} from '~/utils/postTemplates'
import { copyText, threadsIntentUrl, xIntentUrl } from '~/utils/clipboard'

type Platform = 'x' | 'threads'

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()

const eventId = typeof route.query.event === 'string' ? route.query.event : ''
const productId = typeof route.query.product === 'string' ? route.query.product : ''
const rawType = typeof route.query.type === 'string' ? route.query.type : ''
const postType = (rawType in postTypeLabels ? rawType : '') as PostType | ''

const platformOptions: { value: Platform; label: string; limit?: number }[] = [
  { value: 'x', label: 'X', limit: 280 },
  { value: 'threads', label: 'Threads', limit: 500 }
]

const loading = ref(true)
const errorMessage = ref('')
const draftWarning = ref('')
const copyMessage = ref('')
const copying = ref(false)
const copied = ref(false)
const editing = ref(false)

const event = ref<any>(null)
const product = ref<any>(null)
const templateInput = ref<TemplateInput | null>(null)

const platforms = ref<Platform[]>(['x', 'threads'])
const content = ref('')
const variant = ref(0)
// 保存済みの social_posts.id（投稿先ごと）
const postIds = reactive<Partial<Record<Platform, string>>>({})

const title = computed(() =>
  product.value?.name ?? event.value?.name ?? ''
)

const xLength = computed(() => xWeightedLength(content.value))
const threadsLength = computed(() => Array.from(content.value).length)

const overLimit = computed(() =>
  (platforms.value.includes('x') && xLength.value > 280) ||
  (platforms.value.includes('threads') && threadsLength.value > 500)
)

const baseRow = (platform: Platform) => ({
  platform,
  post_type: postType,
  source_type: postType === 'closing_soon' ? 'event' : 'sales_result',
  event_id: eventId,
  product_id: productId || null,
  generated_by_ai: false,
  image_mode: 'none'
})

// 生成した投稿案を下書きとして保存（投稿先ごとに1行）
const saveDrafts = async () => {
  if (!$supabase || !content.value) return
  const rows = platforms.value.map(p => ({
    ...baseRow(p),
    content: content.value,
    status: 'draft'
  }))
  if (rows.length === 0) return

  const { data, error } = await $supabase
    .from('social_posts')
    .insert(rows)
    .select('id, platform')

  if (error) {
    draftWarning.value = '下書きを保存できませんでした（コピーはできます）'
    console.warn('social_posts の下書き保存に失敗しました', error)
    return
  }
  for (const row of data ?? []) postIds[row.platform as Platform] = row.id
}

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  if (!eventId || !postType) {
    errorMessage.value = 'おしらせの種類またはイベントが指定されていません'
    loading.value = false
    return
  }
  if (postType !== 'closing_soon' && !productId) {
    errorMessage.value = '商品が指定されていません'
    loading.value = false
    return
  }

  try {
    const [eventRes, linksRes, resultsRes] = await Promise.all([
      $supabase
        .from('events')
        .select('id, name, location, end_time, sale_type')
        .eq('id', eventId)
        .maybeSingle(),
      $supabase
        .from('event_products')
        .select('product_id, products ( id, name, category )')
        .eq('event_id', eventId),
      $supabase
        .from('sales_results')
        .select('product_id, status')
        .eq('event_id', eventId)
    ])

    if (eventRes.error) throw eventRes.error
    if (linksRes.error) throw linksRes.error
    if (resultsRes.error) throw resultsRes.error
    if (!eventRes.data) {
      errorMessage.value = '出店予定が見つかりませんでした'
      return
    }
    event.value = eventRes.data

    // 「まもなく終了」はイベント出店だけ（直売所・受注・その他では作らない）
    // 当日速報（完売・残りわずか・まもなく終了）はイベント出店だけ
    if ((event.value.sale_type ?? 'event') !== 'event') {
      errorMessage.value = '当日速報のおしらせはイベント出店のときだけ作れます'
      return
    }

    const statusByProduct: Record<string, string> = {}
    for (const r of resultsRes.data ?? []) statusByProduct[r.product_id] = r.status

    const eventProducts: any[] =
      (linksRes.data ?? []).map((row: any) => row.products).filter(Boolean)

    if (productId) {
      product.value = eventProducts.find(p => p.id === productId) ?? null
      if (!product.value) {
        const { data, error } = await $supabase
          .from('products')
          .select('id, name, category')
          .eq('id', productId)
          .maybeSingle()
        if (error) throw error
        product.value = data
      }
      if (!product.value) {
        errorMessage.value = '商品が見つかりませんでした'
        return
      }
    }

    const others = eventProducts.filter(p => p.id !== productId)
    templateInput.value = {
      eventName: event.value.name,
      location: event.value.location,
      endTime: event.value.end_time,
      productName: product.value?.name ?? null,
      // sales_results がない商品は「販売中」扱い
      availableNames: others
        .filter(p => (statusByProduct[p.id] ?? 'available') === 'available')
        .map(p => p.name),
      fewLeftNames: others
        .filter(p => statusByProduct[p.id] === 'few_left')
        .map(p => p.name)
    }

    content.value = buildPost(postType, templateInput.value, variant.value)
  } catch (error: any) {
    errorMessage.value = error?.message ?? '読み込みに失敗しました'
    return
  } finally {
    loading.value = false
  }

  await saveDrafts()
})

const regenerate = () => {
  if (!templateInput.value || !postType) return
  variant.value = (variant.value + 1) % templateCount(postType)
  content.value = buildPost(postType, templateInput.value, variant.value)
  editing.value = false
  copied.value = false
}

// コピーしたら approved にする（SNS API連携後に posted 管理へ移行）
const markApproved = async () => {
  if (!$supabase) return
  const tasks = platforms.value.map(async platform => {
    const id = postIds[platform]
    if (id) {
      const { error } = await $supabase
        .from('social_posts')
        .update({ content: content.value, status: 'approved' })
        .eq('id', id)
      if (error) throw error
    } else {
      const { data, error } = await $supabase
        .from('social_posts')
        .insert({ ...baseRow(platform), content: content.value, status: 'approved' })
        .select('id')
        .single()
      if (error) throw error
      postIds[platform] = data.id
    }
  })
  await Promise.all(tasks)
}

const copy = async () => {
  if (copying.value || !content.value) return
  copying.value = true
  copyMessage.value = ''

  const ok = await copyText(content.value)
  if (!ok) {
    copyMessage.value = 'コピーできませんでした。文章を長押しして選択してください。'
    editing.value = true
    copying.value = false
    return
  }

  copied.value = true
  editing.value = false
  copyMessage.value = 'コピーしました'

  try {
    await markApproved()
  } catch (error) {
    console.warn('social_posts の更新に失敗しました', error)
    copyMessage.value = 'コピーしました（投稿履歴は保存できませんでした）'
  } finally {
    copying.value = false
  }
}

const backLink = computed(() => (eventId ? `/events/${eventId}/today` : '/'))

const xIntent = computed(() => xIntentUrl(content.value))
const threadsIntent = computed(() => threadsIntentUrl(content.value))
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>

      <p v-if="loading" role="status">読み込み中...</p>

      <div v-else-if="errorMessage" role="alert">
        <p class="error">{{ errorMessage }}</p>
        <div class="footer">
          <NuxtLink :to="backLink" class="link-button">戻る</NuxtLink>
        </div>
      </div>

      <template v-else>
        <header class="header">
          <h1>{{ title }}</h1>
          <p class="subtitle">{{ postType ? postTypeLabels[postType] : '' }}</p>
        </header>

        <fieldset class="platforms">
          <legend>投稿先</legend>
          <label
            v-for="option in platformOptions"
            :key="option.value"
            class="platform"
          >
            <input v-model="platforms" type="checkbox" :value="option.value">
            {{ option.label }}
          </label>
        </fieldset>

        <p class="section-label">文章</p>

        <textarea
          v-if="editing"
          v-model="content"
          class="content-edit"
          rows="9"
          aria-label="投稿する文章"
          @input="copied = false"
        />
        <p v-else class="content-preview">{{ content }}</p>

        <p class="count" :class="{ over: overLimit }">
          <span v-if="platforms.includes('x')">X {{ xLength }} / 280</span>
          <span v-if="platforms.includes('threads')">Threads {{ threadsLength }} / 500</span>
        </p>
        <p v-if="overLimit" class="error">文字数が多すぎます。少し短くしてください。</p>

        <p v-if="draftWarning" class="warning">{{ draftWarning }}</p>

        <div class="actions">
          <button type="button" class="secondary" @click="regenerate">
            文章を作り直す
          </button>
          <button type="button" class="secondary" @click="editing = !editing">
            {{ editing ? '編集を終える' : '編集する' }}
          </button>
        </div>

        <button
          type="button"
          class="primary copy"
          :disabled="copying || !content || platforms.length === 0 || overLimit"
          @click="copy"
        >
          {{ copied ? 'もう一度コピーする' : 'コピーする' }}
        </button>

        <p v-if="copyMessage" class="copy-message" role="status">{{ copyMessage }}</p>

        <div v-if="copied" class="open-apps">
          <a
            v-if="platforms.includes('x')"
            :href="xIntent"
            target="_blank"
            rel="noopener"
            class="link-button"
          >Xを開く</a>
          <a
            v-if="platforms.includes('threads')"
            :href="threadsIntent"
            target="_blank"
            rel="noopener"
            class="link-button"
          >Threadsを開く</a>
        </div>

        <div class="footer">
          <NuxtLink :to="backLink" class="link-button">当日画面へ戻る</NuxtLink>
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
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 20px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
  overflow-wrap: anywhere;
}

.subtitle {
  margin: 4px 0 0;
  font-weight: 700;
  color: #8a5a00;
}

.platforms {
  display: flex;
  gap: 20px;
  margin: 24px 0 0;
  padding: 0;
  border: 0;
}

.platforms legend {
  margin-bottom: 8px;
  font-size: 13px;
  opacity: .65;
}

.platform {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 17px;
  font-weight: 700;
}

.platform input {
  transform: scale(1.3);
}

.section-label {
  margin: 20px 0 8px;
  font-size: 13px;
  opacity: .65;
}

.content-preview,
.content-edit {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 16px;
  border-radius: 12px;
  font: inherit;
  font-size: 16px;
  line-height: 1.8;
}

.content-preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f6f7f2;
  border: 1px solid #edf0ed;
}

.content-edit {
  border: 2px solid #31694f;
  resize: vertical;
}

.count {
  display: flex;
  gap: 16px;
  justify-content: flex-end;
  margin: 6px 0 0;
  font-size: 13px;
  opacity: .65;
}

.count.over {
  color: #b42318;
  opacity: 1;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 16px;
}

button {
  min-height: 48px;
  padding: 12px;
  border: 0;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

button.secondary {
  background: #eef2ee;
  color: #294638;
}

button.primary {
  background: #31694f;
  color: white;
}

button.copy {
  width: 100%;
  min-height: 56px;
  margin-top: 12px;
  font-size: 17px;
}

button:disabled {
  opacity: .45;
  cursor: not-allowed;
}

button:focus-visible,
.link-button:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: 2px;
}

.copy-message {
  margin: 10px 0 0;
  text-align: center;
  font-weight: 700;
  color: #31694f;
}

.open-apps {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}

.link-button {
  display: block;
  padding: 14px;
  border-radius: 10px;
  background: #eef2ee;
  color: #294638;
  text-align: center;
  text-decoration: none;
  font-weight: 700;
}

.footer {
  margin-top: 28px;
}

.warning {
  margin: 12px 0 0;
  font-size: 14px;
  color: #8a5a00;
}

.error {
  color: #b42318;
}
</style>

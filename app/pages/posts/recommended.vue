<script setup lang="ts">
import { loadRecommendations, reasonLines, reasonSentence, type ProductFacts, type RecEvent } from '~/utils/recommend'
import { copyText, threadsIntentUrl, xIntentUrl } from '~/utils/clipboard'
import { xWeightedLength } from '~/utils/postTemplates'

type Platform = 'x' | 'threads'
type Draft = {
  id: string
  platform: Platform
  content: string
  editing: boolean
  copied: boolean
  saving: boolean
  message: string
}

const { $supabase, $supabaseConfigError } = useNuxtApp()
const config = useRuntimeConfig()

const loading = ref(true)
const errorMessage = ref('')

const candidates = ref<ProductFacts[]>([])
const nextEvent = ref<RecEvent | null>(null)
const selectedIndex = ref(0)

const generating = ref(false)
const generateError = ref('')
const aiReason = ref('')
const angle = ref('')
const angleLabel = ref('')
// この商品で作り直しに使った切り口（次は別の切り口で作る）
const triedAngles = ref<string[]>([])
// この商品で作った案（次は同じ言い回しを避ける）
const triedPostIds = ref<string[]>([])
const drafts = ref<Draft[]>([])

const selected = computed(() => candidates.value[selectedIndex.value] ?? null)
const others = computed(() =>
  candidates.value
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i !== selectedIndex.value)
    .slice(0, 2)
)

const platformLabel: Record<Platform, string> = { x: 'X', threads: 'Threads' }
const platformLimit: Record<Platform, number> = { x: 280, threads: 500 }

const lengthOf = (d: Draft) =>
  d.platform === 'x' ? xWeightedLength(d.content) : Array.from(d.content).length

const intentUrl = (d: Draft) =>
  d.platform === 'x' ? xIntentUrl(d.content) : threadsIntentUrl(d.content)

onMounted(async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  try {
    const result = await loadRecommendations(
      $supabase,
      config.public.aiRecommendationStartDate || null
    )
    candidates.value = result.candidates
    nextEvent.value = result.nextEvent
  } catch (error: any) {
    errorMessage.value = error?.message ?? '読み込みに失敗しました'
  } finally {
    loading.value = false
  }
})

const choose = (index: number) => {
  selectedIndex.value = index
  drafts.value = []
  aiReason.value = ''
  angle.value = ''
  angleLabel.value = ''
  triedAngles.value = []
  triedPostIds.value = []
  generateError.value = ''
}

const generate = async () => {
  if (!$supabase || !selected.value || generating.value) return
  generating.value = true
  generateError.value = ''

  try {
    const { data, error } = await $supabase.functions.invoke('generate-recommended-post', {
      body: {
        product_id: selected.value.product.id,
        exclude_angles: triedAngles.value,
        avoid_post_ids: triedPostIds.value.slice(-4)
      }
    })

    if (error) {
      // Functionが返したエラーメッセージを取り出す
      let message = ''
      try {
        message = (await (error as any).context?.json())?.error ?? ''
      } catch {
        // 取れなければ下の共通メッセージ
      }
      throw new Error(message || '文章を作れませんでした。時間をおいてもう一度お試しください。')
    }

    aiReason.value = data.reason ?? ''
    angle.value = data.content_angle ?? ''
    angleLabel.value = data.angle_label ?? ''
    triedPostIds.value = [
      ...triedPostIds.value,
      ...(data.posts ?? []).map((p: any) => p.id)
    ]
    if (angle.value && !triedAngles.value.includes(angle.value)) {
      triedAngles.value = [...triedAngles.value, angle.value]
    }
    const order: Platform[] = ['x', 'threads']
    drafts.value = (data.posts ?? [])
      .map((p: any) => ({
        id: p.id,
        platform: p.platform,
        content: p.content,
        editing: false,
        copied: false,
        saving: false,
        message: ''
      }))
      .sort((a: Draft, b: Draft) => order.indexOf(a.platform) - order.indexOf(b.platform))
  } catch (error: any) {
    generateError.value = error?.message ?? '文章を作れませんでした'
  } finally {
    generating.value = false
  }
}

// コピーしたら approved にする（SNS API連携後に posted 管理へ移行）
const copyDraft = async (d: Draft) => {
  if (!$supabase || d.saving) return
  d.message = ''

  const ok = await copyText(d.content)
  if (!ok) {
    d.message = 'コピーできませんでした。文章を長押しして選択してください。'
    d.editing = true
    return
  }

  d.copied = true
  d.editing = false
  d.message = 'コピーしました'
  d.saving = true

  try {
    const { error } = await $supabase
      .from('social_posts')
      .update({ content: d.content, status: 'approved' })
      .eq('id', d.id)
    if (error) throw error
  } catch (error) {
    console.warn('social_posts の更新に失敗しました', error)
    d.message = 'コピーしました（投稿履歴は保存できませんでした）'
  } finally {
    d.saving = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>

      <p v-if="loading" role="status">おすすめを探しています...</p>

      <div v-else-if="errorMessage" role="alert">
        <p class="error">{{ errorMessage }}</p>
      </div>

      <div v-else-if="!selected" class="empty">
        <h1>今はおすすめ投稿はありません</h1>
        <p>
          よく売れている商品や、次のイベントで販売する商品が出てきたら、ここでおすすめします。
        </p>
      </div>

      <template v-else>
        <p class="label">✨ natty noteからのおすすめ</p>
        <h1>{{ selected.product.name }}を<br>紹介してみませんか？</h1>

        <div class="reasons">
          <p class="reasons-title">natty noteがおすすめした理由</p>
          <p class="reasons-text">{{ reasonSentence(selected) }}</p>
        </div>

        <button
          v-if="drafts.length === 0"
          type="button"
          class="primary big"
          :disabled="generating"
          @click="generate"
        >
          {{ generating ? '宣伝のしかたを考えています...' : 'おまかせで作る' }}
        </button>

        <p v-if="generateError" class="error" role="alert">{{ generateError }}</p>

        <template v-if="drafts.length">
          <div class="strategy">
            <p v-if="angleLabel" class="angle">今回の切り口：<strong>{{ angleLabel }}</strong></p>
            <p v-if="aiReason" class="ai-reason">💡 {{ aiReason }}</p>
          </div>

          <article v-for="d in drafts" :key="d.id" class="draft">
            <header class="draft-head">
              <h2>{{ platformLabel[d.platform] }}用</h2>
              <span class="count" :class="{ over: lengthOf(d) > platformLimit[d.platform] }">
                {{ lengthOf(d) }} / {{ platformLimit[d.platform] }}
              </span>
            </header>

            <textarea
              v-if="d.editing"
              v-model="d.content"
              class="content-edit"
              rows="8"
              :aria-label="`${platformLabel[d.platform]}用の文章`"
              @input="d.copied = false"
            />
            <p v-else class="content-preview">{{ d.content }}</p>

            <div class="draft-buttons">
              <button type="button" class="secondary" @click="d.editing = !d.editing">
                {{ d.editing ? '編集を終える' : '編集する' }}
              </button>
              <button
                type="button"
                class="primary"
                :disabled="d.saving || !d.content || lengthOf(d) > platformLimit[d.platform]"
                @click="copyDraft(d)"
              >
                {{ d.copied ? 'もう一度コピー' : 'コピーする' }}
              </button>
            </div>

            <p v-if="d.message" class="copy-message" role="status">{{ d.message }}</p>

            <a
              v-if="d.copied"
              :href="intentUrl(d)"
              target="_blank"
              rel="noopener"
              class="link-button"
            >{{ platformLabel[d.platform] }}を開く</a>
          </article>

          <button
            type="button"
            class="secondary big"
            :disabled="generating"
            @click="generate"
          >
            {{ generating ? '文章を考えています...' : '別の切り口で作り直す' }}
          </button>
        </template>

        <div v-if="others.length" class="others">
          <p class="others-title">ほかの候補</p>
          <button
            v-for="{ c, i } in others"
            :key="c.product.id"
            type="button"
            class="other"
            :disabled="generating"
            @click="choose(i)"
          >
            <span class="other-name">{{ c.product.name }}</span>
            <span class="other-reason">{{ reasonLines(c, nextEvent)[0] }}</span>
          </button>
        </div>
      </template>

      <div class="footer">
        <NuxtLink to="/" class="link-button">トップへ</NuxtLink>
      </div>
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

.label {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #8a5a00;
}

h1 {
  margin: 6px 0 20px;
  font-size: 24px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.empty h1 {
  font-size: 20px;
}

.empty p {
  line-height: 1.8;
  opacity: .75;
}

.reasons {
  padding: 16px;
  border-radius: 14px;
  background: #f6f7f2;
}

.reasons-title {
  margin: 0 0 6px;
  font-size: 13px;
  opacity: .65;
}

.reasons-text {
  margin: 0;
  line-height: 1.8;
}

.reasons ul {
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
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

button.primary {
  background: #31694f;
  color: white;
}

button.secondary {
  background: #eef2ee;
  color: #294638;
}

button.big {
  width: 100%;
  min-height: 56px;
  margin-top: 20px;
  font-size: 17px;
}

button:disabled {
  opacity: .5;
  cursor: not-allowed;
}

button:focus-visible,
.link-button:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: 2px;
}

.strategy {
  margin-top: 24px;
}

.angle {
  margin: 0 0 8px;
  font-size: 14px;
}

.angle strong {
  display: inline-block;
  margin-left: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #e3efe7;
  color: #31694f;
}

.ai-reason {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fff7e3;
  line-height: 1.7;
  font-size: 14px;
}

.draft {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #edf0ed;
}

.draft-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}

.draft-head h2 {
  margin: 0;
  font-size: 17px;
}

.count {
  font-size: 13px;
  opacity: .65;
}

.count.over {
  color: #b42318;
  opacity: 1;
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

.draft-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

.copy-message {
  margin: 8px 0;
  text-align: center;
  font-weight: 700;
  color: #31694f;
}

.others {
  margin-top: 28px;
}

.others-title {
  margin: 0 0 8px;
  font-size: 13px;
  opacity: .65;
}

.other {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin-top: 8px;
  padding: 12px 14px;
  border: 1px solid #dbe3dc;
  background: white;
  color: #243b32;
  text-align: left;
}

.other-name {
  font-size: 16px;
}

.other-reason {
  font-size: 13px;
  font-weight: 400;
  opacity: .7;
}

.link-button {
  display: block;
  margin-top: 8px;
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

.error {
  color: #b42318;
}
</style>

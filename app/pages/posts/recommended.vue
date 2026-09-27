<script setup lang="ts">
import { loadRecommendations, reasonLines, reasonSentence, type ProductFacts, type RecEvent } from '~/utils/recommend'
import { copyText, threadsIntentUrl, xIntentUrl } from '~/utils/clipboard'
import { xWeightedLength } from '~/utils/postTemplates'
import { markPhotoUsed, signedPhotoUrls, unusedProductPhotos, type Photo } from '~/utils/photos'
import { generatePostForProduct } from '~/utils/postGeneration'

type Platform = 'x' | 'threads'
type PostStatus = 'draft' | 'approved' | 'posted'
type Draft = {
  id: string
  platform: Platform
  content: string
  status: PostStatus
  postedAt: string | null
  photoId: string | null
  editing: boolean
  copied: boolean
  saving: boolean
  message: string
  // 「投稿しました」の記録後、写真の使用済み更新だけ失敗したとき
  photoUpdateFailed: boolean
  // X自動投稿で得た投稿ID
  externalId: string | null
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

// ---- 投稿に使う写真（奥さんが最終選択。初期値は「画像なし」）----
const photoOptions = ref<(Photo & { url: string })[]>([])
const photosLoading = ref(false)
const selectedPhotoId = ref<string | null>(null)
const photoSaving = ref(false)
const photoMessage = ref('')
const selectedPhoto = computed(() => photoOptions.value.find(p => p.id === selectedPhotoId.value) ?? null)

const loadPhotos = async () => {
  if (!$supabase || !selected.value) return
  photosLoading.value = true
  photoOptions.value = []
  try {
    const list = await unusedProductPhotos($supabase, selected.value.product.id)
    const urls = await signedPhotoUrls($supabase, list.map(p => p.storage_path))
    photoOptions.value = list.map(p => ({ ...p, url: urls[p.storage_path] ?? '' }))
  } catch {
    // 写真が読めなくても投稿は作れるので、画面は止めない
    photoOptions.value = []
  } finally {
    photosLoading.value = false
  }
}

// 選んだ写真を今の下書き（X・Threads）に紐付ける
const applyPhotoToDrafts = async () => {
  if (!$supabase) return
  // 投稿済み（posted）の行の写真は変えない
  const targets = drafts.value.filter(d => d.status !== 'posted')
  if (targets.length === 0) return
  photoSaving.value = true
  photoMessage.value = ''
  try {
    const { error } = await $supabase
      .from('social_posts')
      .update({
        photo_id: selectedPhotoId.value,
        image_mode: selectedPhotoId.value ? 'original' : 'none'
      })
      .in('id', targets.map(d => d.id))
      .in('status', ['draft', 'approved'])
    if (error) throw error
    for (const d of targets) d.photoId = selectedPhotoId.value
    photoMessage.value = selectedPhotoId.value ? '写真を投稿に設定しました' : '画像なしにしました'
  } catch {
    photoMessage.value = '写真を設定できませんでした。もう一度選んでください。'
  } finally {
    photoSaving.value = false
  }
}

const choosePhoto = (id: string | null) => {
  if (photoSaving.value) return
  selectedPhotoId.value = id
  void applyPhotoToDrafts()
}

// ?product=<id> で商品を指定して開いた場合（将来の「商品を選んで投稿」用）。おすすめ候補でなくても作れる
const route = useRoute()
const pickedProductId = typeof route.query.product === 'string' ? route.query.product : ''
const picked = ref<ProductFacts | null>(null)
const selected = computed(() => picked.value ?? candidates.value[selectedIndex.value] ?? null)
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
    if (pickedProductId) {
      picked.value = result.all.find(f => f.product.id === pickedProductId) ?? null
      if (!picked.value) errorMessage.value = '指定した商品が見つかりません（販売終了の商品は選べません）'
    }
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
  selectedPhotoId.value = null
  photoOptions.value = []
  photoMessage.value = ''
}

const generate = async () => {
  if (!$supabase || !selected.value || generating.value) return
  generating.value = true
  generateError.value = ''

  try {
    const data = await generatePostForProduct($supabase, selected.value.product.id, {
      excludeAngles: triedAngles.value,
      avoidPostIds: triedPostIds.value
    })

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
        status: 'draft' as PostStatus,
        postedAt: null,
        photoId: null,
        editing: false,
        copied: false,
        saving: false,
        message: '',
        photoUpdateFailed: false,
        externalId: null
      }))
      .sort((a: Draft, b: Draft) => order.indexOf(a.platform) - order.indexOf(b.platform))

    // 写真候補を読み込む。作り直しのときは、選んでいた写真を新しい下書きにも引き継ぐ
    if (photoOptions.value.length === 0) await loadPhotos()
    if (selectedPhotoId.value) await applyPhotoToDrafts()
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
  // 投稿済みの行はコピーだけ（状態を approved に戻さない）
  if (d.status === 'posted') return
  d.saving = true

  try {
    const { error } = await $supabase
      .from('social_posts')
      .update({ content: d.content, status: 'approved' })
      .eq('id', d.id)
      .in('status', ['draft', 'approved'])
    if (error) throw error
    d.status = 'approved'
  } catch (error) {
    console.warn('social_posts の更新に失敗しました', error)
    d.message = 'コピーしました（投稿履歴は保存できませんでした）'
  } finally {
    d.saving = false
  }
}

// ---- 「投稿しました」（手動投稿の完了を記録）----
const postingTarget = ref<Draft | null>(null)
const posting = ref(false)

const formatPostedAt = (value: string | null) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const updatePhotoUsed = async (d: Draft) => {
  if (!$supabase || !d.photoId) return
  try {
    await markPhotoUsed($supabase, d.photoId)
    d.photoUpdateFailed = false
    if (d.message.startsWith('投稿は記録しましたが')) d.message = ''
  } catch (error) {
    console.warn('photos.is_used の更新に失敗しました', error)
    d.photoUpdateFailed = true
    d.message = '投稿は記録しましたが、写真を「使用済み」にできませんでした。下のボタンからもう一度お試しください。'
  }
}

// ---- Xへ自動投稿（Edge Function post-to-x）----
// URL入りの投稿は X API の料金が高い（通常 $0.015 → $0.20）ので、送る前に確認する
const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|jp|net|org|co\.jp|shop|me|io|app|link|ly)\b/i
const xPostTarget = ref<Draft | null>(null)
const xPosting = ref(false)
const xTargetHasUrl = computed(() => !!xPostTarget.value && URL_RE.test(xPostTarget.value.content))

const functionError = async (error: any) => {
  try {
    return (await error?.context?.json())?.error ?? ''
  } catch {
    return ''
  }
}

const confirmXPost = async () => {
  const d = xPostTarget.value
  if (!$supabase || !d || xPosting.value || d.saving || d.status !== 'approved') return
  xPosting.value = true
  d.saving = true
  d.message = ''
  const allowUrl = xTargetHasUrl.value
  xPostTarget.value = null
  try {
    // コピー後に編集した場合もあるので、送る文章を先に保存しておく
    const { error: saveError } = await $supabase
      .from('social_posts')
      .update({ content: d.content })
      .eq('id', d.id)
      .eq('status', 'approved')
    if (saveError) throw new Error('文章を保存できませんでした')

    const { data, error } = await $supabase.functions.invoke('post-to-x', {
      body: { social_post_id: d.id, allow_url: allowUrl }
    })
    if (error) {
      const message = await functionError(error)
      throw new Error(message || '通信に失敗しました')
    }
    d.status = 'posted'
    d.postedAt = data.posted_at
    d.externalId = data.external_post_id
    d.copied = true
    if (data.photo_update_failed) {
      d.photoUpdateFailed = true
      d.message = 'Xに投稿しましたが、写真を「使用済み」にできませんでした。下のボタンからもう一度お試しください。'
    }
  } catch (error: any) {
    d.message = `Xへの投稿に失敗しました：${error?.message ?? '不明なエラー'}`
    // すでに投稿済みだった場合などに備えて、最新の状態を読み直す
    const { data: current } = await $supabase
      .from('social_posts')
      .select('status, posted_at, external_post_id')
      .eq('id', d.id)
      .maybeSingle()
    if (current?.status === 'posted') {
      d.status = 'posted'
      d.postedAt = current.posted_at
      d.externalId = current.external_post_id?.startsWith('sending:') ? null : current.external_post_id
    }
  } finally {
    d.saving = false
    xPosting.value = false
  }
}

// ---- Xの接続確認（どのアカウントに投稿されるか。投稿はしない）----
const xAccount = ref('')
const xAccountChecking = ref(false)
const checkXAccount = async () => {
  if (!$supabase || xAccountChecking.value) return
  xAccountChecking.value = true
  xAccount.value = ''
  try {
    const { data, error } = await $supabase.functions.invoke('post-to-x', { body: { action: 'whoami' } })
    if (error) throw new Error((await functionError(error)) || '確認できませんでした')
    xAccount.value = data?.username ? `@${data.username}（${data.name}）に投稿されます` : '確認できませんでした'
  } catch (error: any) {
    xAccount.value = `Xに接続できませんでした：${error?.message}`
  } finally {
    xAccountChecking.value = false
  }
}

const confirmPosted = async () => {
  const d = postingTarget.value
  if (!$supabase || !d || posting.value || d.saving) return
  posting.value = true
  d.saving = true
  d.message = ''
  try {
    // 1) social_posts を posted に。approved の行だけを対象にして二重更新を防ぐ
    const { data, error } = await $supabase
      .from('social_posts')
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', d.id)
      .eq('status', 'approved')
      .select('status, posted_at, photo_id')
      .maybeSingle()
    if (error) throw error

    if (!data) {
      // すでに posted などで対象外だった → 最新の状態を読み直す
      const { data: current } = await $supabase
        .from('social_posts')
        .select('status, posted_at, photo_id')
        .eq('id', d.id)
        .maybeSingle()
      if (current?.status === 'posted') {
        d.status = 'posted'
        d.postedAt = current.posted_at
        d.photoId = current.photo_id
      } else {
        d.message = '投稿済みにできませんでした。先に「コピーする」を押してください。'
      }
      return
    }

    d.status = 'posted'
    d.postedAt = data.posted_at
    d.photoId = data.photo_id

    // 2) posted にできたあとで、写真を使用済みにする（失敗しても投稿の記録は残す）
    await updatePhotoUsed(d)
  } catch (error) {
    console.warn('social_posts を posted にできませんでした', error)
    d.message = '投稿済みにできませんでした。通信状態を確認してもう一度お試しください。'
  } finally {
    d.saving = false
    posting.value = false
    postingTarget.value = null
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
          どの商品も最近14日以内にSNSで紹介済みです。しばらくすると、また紹介する商品をおすすめします。
        </p>
      </div>

      <template v-else>
        <p class="label">{{ picked ? '✏️ 選んだ商品' : '✨ natty noteからのおすすめ' }}</p>
        <h1>{{ selected.product.name }}を<br>紹介してみませんか？</h1>

        <div v-if="!picked" class="reasons">
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

            <p v-if="d.status === 'posted'" class="post-state posted">
              投稿済み ✓ <span v-if="d.postedAt" class="posted-at">{{ formatPostedAt(d.postedAt) }}</span>
              <a
                v-if="d.externalId"
                :href="`https://x.com/i/web/status/${d.externalId}`"
                target="_blank"
                rel="noopener"
                class="posted-link"
              >Xで見る</a>
            </p>
            <p v-else-if="d.status === 'approved' && !d.editing" class="post-state">コピー済み</p>

            <div v-if="d.status !== 'posted'" class="draft-buttons">
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

            <p
              v-if="d.message"
              class="copy-message"
              :class="{ warn: d.photoUpdateFailed }"
              role="status"
            >{{ d.message }}</p>

            <a
              v-if="d.copied && d.status !== 'posted'"
              :href="intentUrl(d)"
              target="_blank"
              rel="noopener"
              class="link-button"
            >{{ platformLabel[d.platform] }}を開く</a>

            <button
              v-if="d.platform === 'x' && d.status === 'approved' && !d.editing"
              type="button"
              class="x-post-button"
              :disabled="d.saving || posting || xPosting"
              @click="xPostTarget = d"
            >
              {{ d.saving && xPosting ? 'Xへ投稿中...' : 'Xへ投稿する' }}
            </button>

            <button
              v-if="d.status === 'approved' && !d.editing"
              type="button"
              class="posted-button"
              :disabled="d.saving || posting || xPosting"
              @click="postingTarget = d"
            >
              {{ d.saving ? '記録中...' : '投稿しました' }}
            </button>

            <button
              v-if="d.status === 'posted' && d.photoUpdateFailed"
              type="button"
              class="secondary retry"
              @click="updatePhotoUsed(d)"
            >
              写真を「使用済み」にする
            </button>
          </article>

          <section class="photo-pick">
            <h2>投稿に使う写真</h2>
            <p v-if="photosLoading" role="status">写真を読み込み中...</p>
            <template v-else>
              <div class="photo-options" role="radiogroup" aria-label="投稿に使う写真">
                <label class="photo-option none-option" :class="{ checked: selectedPhotoId === null }">
                  <input
                    type="radio"
                    name="post-photo"
                    :checked="selectedPhotoId === null"
                    :disabled="photoSaving"
                    @change="choosePhoto(null)"
                  >
                  <span>画像なし</span>
                </label>
                <label
                  v-for="p in photoOptions"
                  :key="p.id"
                  class="photo-option"
                  :class="{ checked: selectedPhotoId === p.id }"
                >
                  <input
                    type="radio"
                    name="post-photo"
                    :checked="selectedPhotoId === p.id"
                    :disabled="photoSaving"
                    @change="choosePhoto(p.id)"
                  >
                  <img v-if="p.url" :src="p.url" :alt="p.caption || '商品写真'" loading="lazy">
                  <span v-if="p.caption" class="photo-caption">{{ p.caption }}</span>
                </label>
              </div>
              <p v-if="photoOptions.length === 0" class="photo-note">
                この商品の未使用の写真はありません。
                <NuxtLink :to="`/products/${selected.product.id}/photos`">写真を追加する</NuxtLink>
              </p>
              <p v-if="photoMessage" class="photo-note" role="status">{{ photoMessage }}</p>
              <a
                v-if="selectedPhoto?.url"
                :href="selectedPhoto.url"
                target="_blank"
                rel="noopener"
                class="link-button"
              >写真を開く（長押しで保存して投稿に添付）</a>
            </template>
          </section>

          <button
            type="button"
            class="secondary big"
            :disabled="generating"
            @click="generate"
          >
            {{ generating ? '文章を考えています...' : '別の切り口で作り直す' }}
          </button>
        </template>

        <div v-if="others.length && !picked" class="others">
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
        <button type="button" class="x-check" :disabled="xAccountChecking" @click="checkXAccount">
          {{ xAccountChecking ? '確認中...' : 'Xの投稿先アカウントを確認' }}
        </button>
        <p v-if="xAccount" class="x-account" role="status">{{ xAccount }}</p>
      </div>
    </section>

    <ConfirmDialog
      v-if="xPostTarget"
      :title="xTargetHasUrl ? 'URLが含まれています。Xへ投稿しますか？' : 'Xへこの内容を投稿しますか？'"
      :message="xTargetHasUrl
        ? 'URL入りの投稿は X API の料金が通常の約13倍（1件 $0.20）になります。\nURLが不要なら「キャンセル」して文章から外してください。'
        : (xPostTarget.photoId ? '選んだ写真も一緒に投稿します。' : '画像なしで投稿します。')"
      :confirm-label="xTargetHasUrl ? 'URL入りで投稿する' : '投稿する'"
      :busy="xPosting"
      :danger="xTargetHasUrl"
      @confirm="confirmXPost"
      @cancel="xPostTarget = null"
    />

    <ConfirmDialog
      v-if="postingTarget"
      :title="`${platformLabel[postingTarget.platform]}への投稿は完了しましたか？`"
      message="実際に投稿したあとで押してください。natty noteに「投稿済み」として記録します。"
      confirm-label="投稿しました"
      :busy="posting"
      @confirm="confirmPosted"
      @cancel="postingTarget = null"
    />
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

.post-state {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 700;
  color: #8a5a00;
}

.post-state.posted {
  padding: 10px 12px;
  border-radius: 10px;
  background: #e3efe7;
  color: #31694f;
}

.posted-at {
  margin-left: 6px;
  font-size: 13px;
  font-weight: 400;
}

.x-post-button {
  display: block;
  width: 100%;
  min-height: 52px;
  margin-top: 8px;
  border: 0;
  border-radius: 12px;
  background: #111;
  color: white;
  font-size: 16px;
  font-weight: 700;
}

.posted-link {
  margin-left: 10px;
  font-size: 13px;
  color: #31694f;
}

.x-check {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  border: 0;
  background: none;
  color: #294638;
  font-size: 13px;
  text-decoration: underline;
}

.x-account {
  margin: 4px 0 0;
  font-size: 13px;
  text-align: center;
}

.posted-button {
  display: block;
  width: 100%;
  min-height: 50px;
  margin-top: 8px;
  border: 2px solid #31694f;
  border-radius: 12px;
  background: white;
  color: #31694f;
  font-size: 16px;
  font-weight: 700;
}

.retry {
  display: block;
  width: 100%;
  margin-top: 8px;
}

.copy-message.warn {
  color: #b42318;
  text-align: left;
}

.photo-pick {
  margin-top: 28px;
  padding-top: 16px;
  border-top: 1px solid #edf0ed;
}

.photo-pick h2 {
  margin: 0 0 10px;
  font-size: 17px;
}

.photo-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.photo-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 2px solid #dbe3dc;
  border-radius: 12px;
  cursor: pointer;
}

.photo-option.checked {
  border-color: #31694f;
  background: #f1f7f3;
}

.photo-option input {
  position: absolute;
  top: 12px;
  left: 12px;
  transform: scale(1.3);
}

.photo-option img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
}

.none-option {
  align-items: center;
  justify-content: center;
  min-height: 120px;
  font-weight: 700;
}

.none-option input {
  position: static;
}

.photo-caption {
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.photo-note {
  margin: 10px 0 0;
  font-size: 13px;
  opacity: .8;
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

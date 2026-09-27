<script setup lang="ts">
import {
  deletePhoto,
  photoUsedInPosts,
  signedPhotoUrls,
  uploadProductPhoto,
  validatePhotoFile,
  type Photo
} from '~/utils/photos'

type PhotoView = Photo & {
  url: string
  editing: boolean
  draftCaption: string
  saving: boolean
  message: string
  blocked: string
}

const route = useRoute()
const { $supabase, $supabaseConfigError } = useNuxtApp()
const productId = route.params.id as string

const productName = ref('')
const photos = ref<PhotoView[]>([])
const loading = ref(true)
const errorMessage = ref('')

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref('')
const uploadErrors = ref<string[]>([])

const deleteTarget = ref<PhotoView | null>(null)
const deleting = ref(false)

const toView = (p: Photo, url = ''): PhotoView => ({
  ...p,
  url,
  editing: false,
  draftCaption: p.caption ?? '',
  saving: false,
  message: '',
  blocked: ''
})

const load = async () => {
  if (!$supabase) {
    errorMessage.value = $supabaseConfigError || 'Supabase接続設定が見つかりません'
    loading.value = false
    return
  }
  try {
    const [productRes, photosRes] = await Promise.all([
      $supabase.from('products').select('id, name').eq('id', productId).maybeSingle(),
      $supabase
        .from('photos')
        .select('id, product_id, storage_path, caption, is_used, created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
    ])
    if (productRes.error) throw productRes.error
    if (photosRes.error) throw photosRes.error
    if (!productRes.data) {
      errorMessage.value = '商品が見つかりませんでした'
      return
    }
    productName.value = productRes.data.name
    const list = (photosRes.data ?? []) as Photo[]
    const urls = await signedPhotoUrls($supabase, list.map(p => p.storage_path))
    photos.value = list.map(p => toView(p, urls[p.storage_path] ?? ''))
  } catch (error: any) {
    errorMessage.value = error?.message ?? '写真を読み込めませんでした'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const pickFiles = () => fileInput.value?.click()

const onFilesSelected = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 同じファイルをもう一度選べるように
  if (!$supabase || files.length === 0 || uploading.value) return

  uploadErrors.value = []
  const valid: File[] = []
  for (const f of files) {
    const problem = validatePhotoFile(f)
    if (problem) uploadErrors.value.push(problem)
    else valid.push(f)
  }
  if (valid.length === 0) return

  uploading.value = true
  try {
    for (let i = 0; i < valid.length; i++) {
      uploadProgress.value = valid.length > 1 ? `アップロード中... (${i + 1}/${valid.length})` : 'アップロード中...'
      try {
        const photo = await uploadProductPhoto($supabase, productId, valid[i])
        const urls = await signedPhotoUrls($supabase, [photo.storage_path])
        photos.value = [toView(photo, urls[photo.storage_path] ?? ''), ...photos.value]
      } catch {
        uploadErrors.value.push(`「${valid[i].name}」をアップロードできませんでした`)
      }
    }
  } finally {
    uploading.value = false
    uploadProgress.value = ''
  }
}

const startEdit = (p: PhotoView) => {
  p.editing = true
  p.draftCaption = p.caption ?? ''
  p.message = ''
}

const saveCaption = async (p: PhotoView) => {
  if (!$supabase || p.saving) return
  p.saving = true
  p.message = ''
  const caption = p.draftCaption.trim() || null
  try {
    const { error } = await $supabase.from('photos').update({ caption }).eq('id', p.id)
    if (error) throw error
    p.caption = caption
    p.editing = false
    p.message = '保存しました'
  } catch {
    p.message = '保存できませんでした。もう一度お試しください。'
  } finally {
    p.saving = false
  }
}

const askDelete = async (p: PhotoView) => {
  if (!$supabase) return
  p.blocked = ''
  p.message = ''
  try {
    if (await photoUsedInPosts($supabase, p.id)) {
      p.blocked = 'この写真は過去の投稿で使用されています。削除できません。'
      return
    }
    deleteTarget.value = p
  } catch {
    p.message = '確認できませんでした。もう一度お試しください。'
  }
}

const confirmDelete = async () => {
  const p = deleteTarget.value
  if (!$supabase || !p || deleting.value) return
  deleting.value = true
  try {
    // 確認中に投稿で使われていないか、削除直前にもう一度確認
    if (await photoUsedInPosts($supabase, p.id)) {
      p.blocked = 'この写真は過去の投稿で使用されています。削除できません。'
      return
    }
    await deletePhoto($supabase, p.id)
    photos.value = photos.value.filter(x => x.id !== p.id)
  } catch {
    p.message = '削除できませんでした。もう一度お試しください。'
  } finally {
    deleting.value = false
    deleteTarget.value = null
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>
        <span v-if="productName" class="product-name">{{ productName }}</span>
        写真管理
      </h1>

      <p v-if="errorMessage" class="error-box" role="alert">{{ errorMessage }}</p>

      <template v-if="productName">
        <button type="button" class="add-button" :disabled="uploading" @click="pickFiles">
          {{ uploading ? uploadProgress : '＋ 写真を追加' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          @change="onFilesSelected"
        >
        <p class="hint">JPEG・PNG・WebP、1枚10MBまで。まとめて選ぶこともできます。</p>
        <ul v-if="uploadErrors.length" class="upload-errors" role="alert">
          <li v-for="e in uploadErrors" :key="e">{{ e }}</li>
        </ul>

        <h2>登録済みの写真</h2>
        <p v-if="loading" role="status">読み込み中...</p>
        <p v-else-if="photos.length === 0" class="empty">まだ写真がありません</p>

        <ul class="grid">
          <li v-for="p in photos" :key="p.id" class="photo">
            <a v-if="p.url" :href="p.url" target="_blank" rel="noopener" class="thumb-link">
              <img :src="p.url" :alt="p.caption || `${productName}の写真`" class="thumb" loading="lazy">
            </a>
            <div v-else class="thumb placeholder">表示できません</div>

            <span v-if="p.is_used" class="used">投稿で使用済み</span>

            <template v-if="p.editing">
              <textarea
                v-model="p.draftCaption"
                rows="3"
                class="caption-input"
                placeholder="例：焼き上がりを横から撮影"
                aria-label="キャプション"
              />
              <div class="photo-buttons">
                <button type="button" class="secondary" :disabled="p.saving" @click="p.editing = false">キャンセル</button>
                <button type="button" class="primary" :disabled="p.saving" @click="saveCaption(p)">
                  {{ p.saving ? '保存中...' : '保存' }}
                </button>
              </div>
            </template>
            <template v-else>
              <p class="caption" :class="{ none: !p.caption }">{{ p.caption || 'キャプションなし' }}</p>
              <div class="photo-buttons">
                <button type="button" class="secondary" @click="startEdit(p)">編集</button>
                <button type="button" class="danger" @click="askDelete(p)">削除</button>
              </div>
            </template>

            <p v-if="p.message" class="photo-message" role="status">{{ p.message }}</p>
            <p v-if="p.blocked" class="blocked" role="alert">{{ p.blocked }}</p>
          </li>
        </ul>
      </template>

      <div class="footer">
        <NuxtLink :to="`/products/${productId}/edit`" class="back">商品編集へ戻る</NuxtLink>
        <NuxtLink to="/products" class="back">商品管理へ戻る</NuxtLink>
      </div>
    </section>

    <ConfirmDialog
      v-if="deleteTarget"
      title="この写真を削除しますか？"
      message="この操作は元に戻せません。"
      confirm-label="削除する"
      :busy="deleting"
      danger
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 720px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 20px; }
.product-name { display: block; font-size: 24px; overflow-wrap: anywhere; }
h2 { margin: 28px 0 8px; font-size: 17px; }

button { font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: wait; }

.add-button { width: 100%; min-height: 56px; border: 0; border-radius: 12px; background: #31694f; color: white; font-size: 17px; font-weight: 700; }
.hint { margin: 8px 0 0; font-size: 13px; opacity: .7; }
.upload-errors { margin: 12px 0 0; padding: 12px 12px 12px 28px; border-radius: 10px; background: #fdecea; color: #b42318; font-size: 14px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin: 12px 0 0; padding: 0; list-style: none; }
.photo { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid #dbe3dc; border-radius: 14px; }
.thumb-link { display: block; }
.thumb { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; background: #f6f7f2; }
.placeholder { display: flex; align-items: center; justify-content: center; font-size: 13px; opacity: .6; }
.used { align-self: flex-start; padding: 2px 10px; border-radius: 999px; background: #e3efe7; color: #31694f; font-size: 12px; font-weight: 700; }

.caption { margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.caption.none { opacity: .5; }
.caption-input { box-sizing: border-box; width: 100%; padding: 10px; border: 1px solid #9aac9f; border-radius: 10px; font: inherit; font-size: 16px; line-height: 1.6; resize: vertical; }

.photo-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.photo-buttons button { min-height: 44px; border: 0; border-radius: 10px; font-weight: 700; }
.primary { background: #31694f; color: white; }
.secondary { background: #eef2ee; color: #294638; }
.danger { background: white; color: #b42318; outline: 1px solid #f0b7b1; outline-offset: -1px; }

.photo-message { margin: 0; font-size: 13px; color: #31694f; }
.blocked { margin: 0; padding: 10px; border-radius: 10px; background: #fdecea; color: #7a1f16; font-size: 13px; line-height: 1.6; }

.empty { opacity: .65; }
.error-box { padding: 12px; border-radius: 10px; background: #fdecea; color: #b42318; }

.footer { display: grid; gap: 10px; margin-top: 28px; }
.back { display: block; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }

button:focus-visible, a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>

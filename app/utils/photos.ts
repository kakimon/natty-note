// 商品写真（photos テーブル＋ private bucket natty-photos）の共通処理
import type { SupabaseClient } from '@supabase/supabase-js'

export const PHOTO_BUCKET = 'natty-photos'
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

// is_used: すでにSNS投稿で使った写真かどうか（MVPでは false で登録するだけ。投稿連携時に自動更新する）
export type Photo = {
  id: string
  product_id: string | null
  storage_path: string
  caption: string | null
  is_used: boolean
  created_at: string
}

export const validatePhotoFile = (file: File) => {
  if (!PHOTO_TYPES[file.type]) return `「${file.name}」はJPEG・PNG・WebPの画像ではありません`
  if (file.size > PHOTO_MAX_BYTES) return `「${file.name}」は10MBを超えています`
  return ''
}

// products/{product_id}/{uuid}.jpg に保存して photos に登録
export const uploadProductPhoto = async (supabase: SupabaseClient, productId: string, file: File) => {
  const path = `products/${productId}/${crypto.randomUUID()}.${PHOTO_TYPES[file.type]}`
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false
  })
  if (up.error) throw up.error

  const { data, error } = await supabase
    .from('photos')
    .insert({ product_id: productId, storage_path: path, caption: null, is_used: false })
    .select('id, product_id, storage_path, caption, is_used, created_at')
    .single()
  if (error) {
    // DB登録に失敗したら、置き去りの画像を消しておく
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    throw error
  }
  return data as Photo
}

// 投稿に使える写真（新しい順）
// - is_used = false（実際にSNSへ投稿した写真ではない）
// - approved / posted の投稿で選ばれていない（コピー済みの投稿で使う予定の写真も除く）
// draft で選ばれているだけの写真は候補に含める
export const unusedProductPhotos = async (supabase: SupabaseClient, productId: string, limit = 6) => {
  const { data, error } = await supabase
    .from('photos')
    .select('id, product_id, storage_path, caption, is_used, created_at')
    .eq('product_id', productId)
    .eq('is_used', false)
    .order('created_at', { ascending: false })
  if (error) throw error
  const photos = (data ?? []) as Photo[]
  if (photos.length === 0) return photos

  const { data: used, error: usedError } = await supabase
    .from('social_posts')
    .select('photo_id')
    .in('photo_id', photos.map(p => p.id))
    .in('status', ['approved', 'posted'])
  if (usedError) throw usedError
  const reserved = new Set((used ?? []).map((r: any) => r.photo_id as string))

  return photos.filter(p => !reserved.has(p.id)).slice(0, limit)
}

// 実際にSNSへ投稿した写真を使用済みにする（social_posts が posted になったあとに呼ぶ）
export const markPhotoUsed = async (supabase: SupabaseClient, photoId: string) => {
  const { error } = await supabase.from('photos').update({ is_used: true }).eq('id', photoId)
  if (error) throw error
}

// private bucket なので表示には期限付きURLを使う
export const signedPhotoUrls = async (supabase: SupabaseClient, paths: string[]) => {
  if (paths.length === 0) return {} as Record<string, string>
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60)
  if (error) throw error
  const map: Record<string, string> = {}
  for (const item of data ?? []) if (item.path && item.signedUrl) map[item.path] = item.signedUrl
  return map
}

// 投稿で使われた写真は削除しない
// 投稿履歴のルールどおり approved / posted だけを「使った」とみなす（draft は作っただけ）
export const photoUsedInPosts = async (supabase: SupabaseClient, photoId: string) => {
  const { count, error } = await supabase
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .eq('photo_id', photoId)
    .in('status', ['approved', 'posted'])
  if (error) throw error
  return (count ?? 0) > 0
}

// 削除: レコード確認 → Storageから画像削除 → DBレコード削除
export const deletePhoto = async (supabase: SupabaseClient, photoId: string) => {
  const { data: photo, error } = await supabase
    .from('photos')
    .select('id, storage_path')
    .eq('id', photoId)
    .maybeSingle()
  if (error) throw error
  if (!photo) return

  // 未使用の下書きからは写真の紐付けを外しておく（下書き自体は残す）
  const detach = await supabase
    .from('social_posts')
    .update({ photo_id: null, image_mode: 'none' })
    .eq('photo_id', photoId)
    .eq('status', 'draft')
  if (detach.error) throw detach.error

  const rm = await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path])
  if (rm.error) throw rm.error

  const del = await supabase.from('photos').delete().eq('id', photoId)
  if (del.error) throw del.error
}

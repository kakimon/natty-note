// 商品管理で使う共通の定義

export const CATEGORY_OPTIONS = [
  { value: 'chiffon', label: 'シフォン' },
  { value: 'muffin', label: 'マフィン' },
  { value: 'other', label: 'その他' }
] as const

export const categoryLabel = (value?: string | null) =>
  CATEGORY_OPTIONS.find(o => o.value === value)?.label ?? (value || '未設定')

export const formatPrice = (price?: number | null) =>
  price == null ? '価格未設定' : `¥${price.toLocaleString('ja-JP')}`

export type ProductInput = {
  name: string
  category: string
  price: number | null
  description: string | null
  active: boolean
}

export type ProductRow = ProductInput & { id: string }

// 販売方法（events.sale_type）の表示と入力ルール
// テーブル名は events のままだが、画面では「販売予定」として扱う

export type SaleType = 'event' | 'delivery' | 'order' | 'other'

type SaleTypeDef = {
  value: SaleType
  label: string // 選択肢・バッジ
  icon: string
  dateLabel: string
  nameLabel: string
  namePlaceholder: string
  nameRequired: boolean
  locationLabel: string
  locationPlaceholder: string
  stepTitle: string // 入力画面の見出し
}

export const SALE_TYPES: SaleTypeDef[] = [
  {
    value: 'event',
    label: 'イベント出店',
    icon: '🎪',
    dateLabel: '出店日',
    nameLabel: 'イベント名',
    namePlaceholder: '○○マルシェ',
    nameRequired: true,
    locationLabel: '場所',
    locationPlaceholder: '○○交流センター',
    stepTitle: 'どのイベントに出店しますか？'
  },
  {
    value: 'delivery',
    label: '直売所へ納品',
    icon: '🏪',
    dateLabel: '納品日',
    nameLabel: 'メモ用の名前（なくてもOK）',
    namePlaceholder: '例：週末分の納品',
    nameRequired: false,
    locationLabel: '納品先',
    locationPlaceholder: '○○農産物直売所',
    stepTitle: 'どこへ納品しますか？'
  },
  {
    value: 'order',
    label: '受注販売',
    icon: '📦',
    dateLabel: 'お渡し日',
    nameLabel: 'ご注文の名前（なくてもOK）',
    namePlaceholder: '例：○○様ご注文分',
    nameRequired: false,
    locationLabel: 'お渡し場所',
    locationPlaceholder: '例：発送／店頭受け取りなど',
    stepTitle: 'ご注文の内容を入力してください'
  },
  {
    value: 'other',
    label: 'その他',
    icon: '🧺',
    dateLabel: '販売日',
    nameLabel: '名前（なくてもOK）',
    namePlaceholder: '例：○○さんへのおすそ分け販売',
    nameRequired: false,
    locationLabel: '場所',
    locationPlaceholder: '',
    stepTitle: 'どこで販売しますか？'
  }
]

export const saleTypeDef = (value?: string | null) =>
  SALE_TYPES.find(t => t.value === value) ?? SALE_TYPES[0]

export const saleTypeLabel = (value?: string | null) => saleTypeDef(value).label

// name が空のとき（イベント以外）に自動で付ける名前。DBの name は必須のまま使う
// 例: 「直売所へ納品（○○直売所）」「受注販売」
export const resolveSaleName = (type: string, name: string, location: string) => {
  const trimmed = name.trim()
  if (trimmed) return trimmed
  const def = saleTypeDef(type)
  const loc = location.trim()
  return loc ? `${def.label}（${loc}）` : def.label
}

// 状態の表示（販売方法ごと）
const STATUS_LABELS: Record<SaleType, Record<string, string>> = {
  event: { scheduled: '出店予定', open: '出店中', finished: '終了', cancelled: '中止' },
  delivery: { scheduled: '納品予定', open: '納品日', finished: '納品済み', cancelled: '中止' },
  order: { scheduled: '受注予定', open: '受け渡し日', finished: '完了', cancelled: '中止' },
  other: { scheduled: '予定', open: '実施中', finished: '終了', cancelled: '中止' }
}

export const statusLabelFor = (saleType?: string | null, status?: string | null) => {
  const labels = STATUS_LABELS[saleTypeDef(saleType).value]
  return status ? labels[status] ?? status : '未設定'
}

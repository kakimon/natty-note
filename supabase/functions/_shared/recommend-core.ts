// AIおまかせ投稿の候補判定ロジック（純粋関数）
//
// ブラウザ（app/utils/recommend.ts）と Edge Function の両方から読み込むため、
// このファイルは import を持たない。
// 日付はすべて日本時間（Asia/Tokyo）の "YYYY-MM-DD" で扱う。

export const INTRO_POST_TYPES = ['product_intro', 'new_product', 'ai_recommended'] as const
export const HISTORY_STATUSES = ['approved', 'posted'] as const

export const RULES = {
  recentEventCount: 3, // ① 直近何回のイベントを見るか
  soldOutThreshold: 2, // ① 何回以上完売でよく売れているとするか
  notPostedDays: 14, // ② 何日以上紹介していなければ対象か
  newProductDays: 30 // ④ 登録から何日以内を新商品とするか
}

export const SCORES = {
  soldOutOften: 3,
  inNextEvent: 2,
  newProduct: 2
}

export type RecProduct = {
  id: string
  name: string
  category: string | null
  description?: string | null
  created_at: string
}

export type RecEvent = {
  id: string
  name: string
  event_date: string
  start_time?: string | null
  location?: string | null
  status: string
}

export type RecEventProduct = { event_id: string; product_id: string }
export type RecSalesResult = { event_id: string; product_id: string; status: string }

export type RecPost = {
  product_id: string | null
  post_type: string
  status: string
  posted_at: string | null
  updated_at: string
}

export type RecInput = {
  today: string // JSTの今日 "YYYY-MM-DD"
  startDate?: string | null // AI_RECOMMENDATION_START_DATE（未設定なら④は判定しない）
  products: RecProduct[]
  events: RecEvent[]
  eventProducts: RecEventProduct[]
  salesResults: RecSalesResult[]
  posts: RecPost[]
}

export type ReasonKey = 'sold_out_often' | 'in_next_event' | 'new_product' | 'not_posted_recently' | 'never_posted'

export type ProductFacts = {
  product: RecProduct
  soldOutCount: number // 直近イベントでの完売回数
  recentEventCount: number // 見た直近イベント数（最大3）
  lastIntroDate: string | null // 最後に紹介した日（JST）
  lastIntroDaysAgo: number | null // 何日前か（未紹介なら null）
  inNextEvent: boolean
  isNewProduct: boolean
  notPostedRecently: boolean // ②
  score: number
  eligible: boolean // ② かつ（① or ③ or ④）
  reasons: ReasonKey[]
}

export type RecResult = {
  nextEvent: RecEvent | null
  candidates: ProductFacts[] // eligible のみ、並び替え済み
  all: ProductFacts[]
}

// timestamptz → JSTの "YYYY-MM-DD"
export const toJstDate = (value: string | Date) => {
  const d = typeof value === 'string' ? new Date(value) : value
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

export const jstToday = () => toJstDate(new Date())

// "YYYY-MM-DD" 同士の日数差（a - b）
export const daysBetween = (a: string, b: string) => {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000)
}

export const findNextEvent = (events: RecEvent[], today: string) =>
  events
    .filter(e => e.event_date >= today && (e.status === 'scheduled' || e.status === 'open'))
    .sort((a, b) =>
      a.event_date.localeCompare(b.event_date) ||
      (a.start_time ?? '').localeCompare(b.start_time ?? '')
    )[0] ?? null

export const evaluateProducts = (input: RecInput): RecResult => {
  const { today, startDate } = input
  const nextEvent = findNextEvent(input.events, today)

  const eventById = new Map(input.events.map(e => [e.id, e]))
  const pastEventIds = new Set(
    input.events
      .filter(e => e.event_date < today && e.status !== 'cancelled')
      .map(e => e.id)
  )
  const nextEventProductIds = new Set(
    nextEvent
      ? input.eventProducts.filter(ep => ep.event_id === nextEvent.id).map(ep => ep.product_id)
      : []
  )
  const soldOutKeys = new Set(
    input.salesResults
      .filter(r => r.status === 'sold_out')
      .map(r => `${r.event_id}:${r.product_id}`)
  )

  const all = input.products.map((product): ProductFacts => {
    // ① 直近3回の過去イベントでの完売回数
    const recentEvents = input.eventProducts
      .filter(ep => ep.product_id === product.id && pastEventIds.has(ep.event_id))
      .map(ep => eventById.get(ep.event_id)!)
      .sort((a, b) => b.event_date.localeCompare(a.event_date))
      .slice(0, RULES.recentEventCount)
    const soldOutCount = recentEvents.filter(e => soldOutKeys.has(`${e.id}:${product.id}`)).length
    const soldOutOften = soldOutCount >= RULES.soldOutThreshold

    // ② 最後の紹介（approved / posted の紹介系投稿だけを履歴として扱う）
    const introDates = input.posts
      .filter(p =>
        p.product_id === product.id &&
        (HISTORY_STATUSES as readonly string[]).includes(p.status) &&
        (INTRO_POST_TYPES as readonly string[]).includes(p.post_type)
      )
      .map(p => toJstDate(p.posted_at ?? p.updated_at))
      .sort()
    const lastIntroDate = introDates.at(-1) ?? null
    const lastIntroDaysAgo = lastIntroDate ? daysBetween(today, lastIntroDate) : null
    const notPostedRecently = lastIntroDaysAgo === null || lastIntroDaysAgo >= RULES.notPostedDays

    // ③ 次回イベントで販売予定
    const inNextEvent = nextEventProductIds.has(product.id)

    // ④ 新商品（運用開始日以降に登録 かつ 登録30日以内 かつ 未紹介）
    const createdDate = toJstDate(product.created_at)
    const isNewProduct =
      !!startDate &&
      createdDate >= startDate &&
      daysBetween(today, createdDate) <= RULES.newProductDays &&
      lastIntroDate === null

    const score =
      (soldOutOften ? SCORES.soldOutOften : 0) +
      (inNextEvent ? SCORES.inNextEvent : 0) +
      (isNewProduct ? SCORES.newProduct : 0)

    const reasons: ReasonKey[] = []
    if (soldOutOften) reasons.push('sold_out_often')
    if (inNextEvent) reasons.push('in_next_event')
    if (isNewProduct) reasons.push('new_product')
    reasons.push(lastIntroDate === null ? 'never_posted' : 'not_posted_recently')

    return {
      product,
      soldOutCount,
      recentEventCount: recentEvents.length,
      lastIntroDate,
      lastIntroDaysAgo,
      inNextEvent,
      isNewProduct,
      notPostedRecently,
      score,
      eligible: notPostedRecently && score > 0,
      reasons
    }
  })

  // 並び順: 点数 → 次回販売予定 → 完売回数 → 最終紹介日が古い（未紹介が最優先）
  const candidates = all
    .filter(f => f.eligible)
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.inNextEvent) - Number(a.inNextEvent) ||
      b.soldOutCount - a.soldOutCount ||
      (a.lastIntroDate ?? '').localeCompare(b.lastIntroDate ?? '')
    )

  return { nextEvent, candidates, all }
}

// 画面表示用の理由（箇条書き）
export const reasonLines = (f: ProductFacts, nextEvent: RecEvent | null) => {
  const lines: string[] = []
  if (f.reasons.includes('sold_out_often')) {
    lines.push(`最近よく売れています（直近${f.recentEventCount}回中${f.soldOutCount}回完売）`)
  }
  if (f.reasons.includes('in_next_event') && nextEvent) {
    lines.push('次回の出店で販売予定です')
  }
  if (f.reasons.includes('new_product')) {
    lines.push('新しく登録した商品です')
  }
  if (f.reasons.includes('never_posted')) {
    lines.push('まだSNSで紹介していません')
  } else if (f.lastIntroDaysAgo !== null) {
    lines.push(`しばらくSNSで紹介していません（${f.lastIntroDaysAgo}日前）`)
  }
  return lines
}

// 画面用: natty noteがこの商品をおすすめした理由（1文）
// 例: 「次回の出店で販売する予定で、まだSNSで紹介していない商品なので、今回おすすめしました。」
export const reasonSentence = (f: ProductFacts) => {
  const parts: string[] = []
  if (f.reasons.includes('sold_out_often')) parts.push('最近のイベントでよく完売していて')
  if (f.reasons.includes('in_next_event')) parts.push('次回の出店で販売する予定で')
  if (f.reasons.includes('new_product')) parts.push('新しく登録した商品で')
  if (f.reasons.includes('never_posted')) parts.push('まだSNSで紹介していない')
  else if (f.lastIntroDaysAgo !== null) parts.push(`${f.lastIntroDaysAgo}日間SNSで紹介していない`)
  return `${parts.join('、')}商品なので、今回おすすめしました。`
}

// ============================================================
// 投稿の切り口（content_angle）
// 「何を宣伝するか」の次に「どう伝えるか」を決めるための候補。
// どの切り口を使ってよいかはプログラムで決め、AIはその中から選ぶ。
// ============================================================

export const CONTENT_ANGLES = [
  'product_feature',
  'rice_flour_story',
  'ingredient_story',
  'popular_item',
  'seasonal',
  'customer_scene',
  'behind_the_scenes',
  'brand_story',
  'event_notice',
  'event_thanks'
] as const

export type ContentAngle = typeof CONTENT_ANGLES[number]

export const ANGLE_LABELS: Record<ContentAngle, string> = {
  product_feature: '商品の魅力',
  rice_flour_story: '米粉ならではの良さ',
  ingredient_story: '素材の話',
  popular_item: '人気の商品',
  seasonal: '季節の楽しみ方',
  customer_scene: 'おやつ時間のシーン',
  behind_the_scenes: 'ものづくりの裏側',
  brand_story: 'nattyのこと',
  event_notice: '出店のおしらせ',
  event_thanks: '出店のお礼'
}

// AIに渡す各切り口の説明
export const ANGLE_GUIDES: Record<ContentAngle, string> = {
  product_feature: '商品名・説明文から分かる範囲で、商品の魅力（味の組み合わせなど）を伝える',
  rice_flour_story: '小麦粉ではなく自家栽培米の米粉で作っていることを伝える（食感などは説明文にある範囲で）',
  ingredient_story: 'プロフィールにある素材（自家栽培の風さやか、平飼い卵）の話をする',
  popular_item: 'イベントでよく売れている人気の商品として紹介する',
  seasonal: '今の季節に合う楽しみ方・食べ方を提案する',
  customer_scene: 'おやつ時間や手土産など、食べるシーンを想像させる',
  behind_the_scenes: '家族で作っていることを伝える（場所・工程・情景は創作しない）',
  brand_story: 'プロフィールにある範囲で、nattyがどんなブランドかを伝える',
  event_notice: '近く出店するイベントで買えることを伝える',
  event_thanks: '先日のイベントに来てくれた方へのお礼と、その商品の紹介'
}

export const ANGLE_RULES = {
  avoidRecentCount: 3, // 直近何件の投稿と同じ切り口を避けるか
  eventNoticeDays: 3, // 次回イベントまで何日以内なら出店情報を使ってよいか
  eventThanksDays: 3 // イベント後何日以内ならお礼を使ってよいか
}

export type AngleContext = {
  today: string
  facts: ProductFacts
  nextEvent: RecEvent | null
  lastPastEvent: RecEvent | null // この商品を販売した直近の過去イベント
  recentAngles: (string | null)[] // 紹介系投稿の切り口（新しい順）
  excludeAngles?: string[] // 作り直し時など、今回避けたい切り口
}

export type AnglePlan = {
  allowed: ContentAngle[]
  eventInfoAllowed: boolean
  daysUntilNextEvent: number | null
  daysSinceLastEvent: number | null
  avoided: string[] // 直近と同じなので避けた切り口
}

export const findLastPastEvent = (
  events: RecEvent[],
  eventProducts: RecEventProduct[],
  productId: string,
  today: string
) => {
  const ids = new Set(eventProducts.filter(ep => ep.product_id === productId).map(ep => ep.event_id))
  return events
    .filter(e => ids.has(e.id) && e.event_date < today && e.status !== 'cancelled')
    .sort((a, b) => b.event_date.localeCompare(a.event_date))[0] ?? null
}

export const planAngles = (ctx: AngleContext): AnglePlan => {
  const { today, facts, nextEvent, lastPastEvent } = ctx

  const daysUntilNextEvent =
    facts.inNextEvent && nextEvent ? daysBetween(nextEvent.event_date, today) : null
  const daysSinceLastEvent = lastPastEvent ? daysBetween(today, lastPastEvent.event_date) : null

  const eventInfoAllowed =
    daysUntilNextEvent !== null && daysUntilNextEvent <= ANGLE_RULES.eventNoticeDays

  const avoided = [
    ...ctx.recentAngles.slice(0, ANGLE_RULES.avoidRecentCount).filter((a): a is string => !!a),
    ...(ctx.excludeAngles ?? [])
  ]

  const conditionOk = (angle: ContentAngle) => {
    switch (angle) {
      case 'popular_item':
        return facts.reasons.includes('sold_out_often')
      case 'event_notice':
        return eventInfoAllowed
      case 'event_thanks':
        return daysSinceLastEvent !== null && daysSinceLastEvent <= ANGLE_RULES.eventThanksDays
      default:
        return true
    }
  }

  const possible = CONTENT_ANGLES.filter(conditionOk)
  let allowed = possible.filter(a => !avoided.includes(a))
  // 全部避けてしまった場合は、作り直しで指定されたものだけ除く
  if (allowed.length === 0) {
    allowed = possible.filter(a => !(ctx.excludeAngles ?? []).includes(a))
  }
  if (allowed.length === 0) allowed = ['product_feature']

  return { allowed, eventInfoAllowed, daysUntilNextEvent, daysSinceLastEvent, avoided }
}

// 季節（JST の月から）
export const seasonOf = (today: string) => {
  const m = Number(today.slice(5, 7))
  if (m >= 3 && m <= 5) return '春'
  if (m >= 6 && m <= 8) return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

// AIおまかせ投稿（AI宣伝広報部長）
//
// 1. 商品を選ぶ   … ブラウザ側のルール（recommend-core.ts）＋奥さんの選択。ここでは product_id を受け取る
// 2. 切り口を選ぶ … 使ってよい切り口をプログラムで絞り、その中から AI が選ぶ（API呼び出し1回目）
//                   この段階ではイベントの名前・日付・場所をAIに見せない
// 3. 文章を書く   … 選んだ切り口に必要な情報だけを渡して、X案・Threads案を書かせる（API呼び出し2回目）
//                   イベント情報を渡すのは event_notice（次回イベント）/ event_thanks（過去イベント）のときだけ
//
// 事実（販売実績・次回イベント・投稿履歴）はブラウザの値を信用せず、ここでDBから取り直す。
// 生成結果は social_posts に draft として保存して返す。
//
// Secrets:
//   OPENAI_API_KEY                 （必須）
//   AI_RECOMMENDATION_START_DATE   （例: 2026-10-01。未設定なら新商品判定をしない）
//   OPENAI_MODEL                   （任意。未設定なら DEFAULT_MODEL）
// SUPABASE_URL / SUPABASE_ANON_KEY は Supabase が自動で設定する。

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  ANGLE_GUIDES,
  ANGLE_LABELS,
  CONTENT_ANGLES,
  HISTORY_STATUSES,
  INTRO_POST_TYPES,
  daysBetween,
  evaluateProducts,
  findLastPastEvent,
  jstToday,
  planAngles,
  reasonLines,
  seasonOf,
  toJstDate,
  type ContentAngle,
  type RecEvent
} from '../_shared/recommend-core.ts'
import { profileForAi } from '../_shared/shop-profile.ts'

const DEFAULT_MODEL = 'gpt-5-nano'
const X_LIMIT = 280
const THREADS_LIMIT = 500

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Xの文字数（日本語・絵文字は2、半角は1）
const xWeightedLength = (text: string) =>
  Array.from(text).reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) <= 0x10ff ? 1 : 2), 0)

const categoryLabel = (c: string | null) =>
  c === 'chiffon' ? 'シフォンケーキ' : c === 'muffin' ? 'マフィン' : c === 'other' ? '焼き菓子' : c ?? ''

const formatEventDate = (value: string) => {
  const [y, m, d] = value.split('-').map(Number)
  const week = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}月${d}日(${week})`
}

// "2026-10-12" → ["10月12日", "10/12"]（文中への混入チェック用）
const eventDateWords = (value: string) => {
  const [, m, d] = value.split('-').map(Number)
  return [`${m}月${d}日`, `${m}/${d}`]
}

// ============================================================
// 1回目: 切り口を選ぶ
// ============================================================

const STRATEGY_PROMPT = `あなたは、米粉の焼き菓子ブランド「natty」の宣伝広報部長です。
あなたの仕事は、次のイベントを告知することではありません。
shop_profile.mission にあるとおり、売り込み一辺倒ではなく、nattyを知ってもらい、好きになってもらい、購入につながる発信を考えることです。

今回は文章はまだ書きません。この商品を「今日どんな切り口で伝えるか」だけを決めてください。

考えること:
- この商品の、まだ伝えていない魅力は何か
- shop_profile の target_customer（あれば）に、どんな話なら届くか
- recent_posts と比べて、同じような投稿が続いていないか
- 今の季節（today.season）に合う話題は何か
- 押し売りに聞こえず、nattyというブランドを好きになってもらえる内容か

ルール:
- 切り口は allowed_angles の中から必ず1つ選ぶ。
- event_notice（出店のおしらせ）は、出店の直前で、告知することが一番効果的なときだけ選ぶ。毎回選ばない。
- reason: なぜ今日この切り口にしたかを、お店の人向けに1〜2文で。

JSONで出力する: {"content_angle": "...", "reason": "..."}`

const strategySchema = (allowed: ContentAngle[]) => ({
  type: 'json_schema',
  name: 'post_strategy',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['content_angle', 'reason'],
    properties: {
      content_angle: { type: 'string', enum: allowed },
      reason: { type: 'string' }
    }
  }
})

// ============================================================
// 2回目: 文章を書く
// ============================================================

const WRITING_PROMPT = `あなたは、米粉の焼き菓子ブランド「natty」の宣伝広報部長です。
strategy で決めた切り口（angle）と理由（reason）に沿って、X用 と Threads用 の投稿文を書いてください。

守ること:
- nattyについて事実として書いてよいのは shop_profile.facts、商品については product と facts に書かれていることだけ。
  書かれていないこと（価格・個数・味の細かい特徴・材料・受賞歴・予定など）は創作しない。
- shop_profile.facts にない店舗・店内・工房・製造風景・お客様の反応・食感・香り・製法などを、事実として作らない。
  雰囲気を出すためであっても、「店内の香り」「店頭」「工房で焼く」など、確認できない情景を創作しない。
- nattyには常設の実店舗がない。「お店に来て」「店内」「当店」「〜のお店」など、実店舗があるように読める表現は使わない。
- 「nattyは〜のブランドです」のような企業紹介調は使わない。nattyに触れるときは「nattyでは、家族で米粉の焼き菓子を作っています」のように自然に。
  毎回nattyの自己紹介から書き始めない。

言い回しの重複を避ける:
- recent_texts は最近の投稿文と、今回の作り直し前の案。そこで使われている言い回し
  （例: 「やさしい味わい」「秋のおやつ」「ほっとひと息」、書き出しや締めの形）を繰り返さない。
- 同じ内容でも、書き出し・締め・言葉選びを変えて、人が運用しているSNSのように毎回違う表情にする。
- 「完売」「よく売れている」「人気」は facts.sold_out_often が true のときだけ使う。
- event が渡されていないときは、イベントや出店予定の話を一切書かない（「今週末」「次回」「お披露目」「お楽しみに」なども不要）。
  商品の魅力・季節感・nattyらしさだけで完結させる。
- shop_profile.avoid_phrases に挙げたことは書かない。文体は shop_profile.tone に従う。
- 店名は必ず小文字の「natty」。
- X用: 全角140文字以内（ハッシュタグ込み）。ハッシュタグは shop_profile.hashtags から1〜2個。
- Threads用: Xより少しゆったり、全角250文字以内。ハッシュタグは0〜1個。XとThreadsで同じ文をそのまま使わない。

食感・香り・味の表現:
- 「ふんわり」「しっとり」「もっちり」「口どけ」「香りが広がる」「香ばしい」などの食感・香りの表現は、
  product.description に書かれている場合だけ使ってよい。書かれていなければ使わない。
- 代わりに「やさしい味わい」「秋のおやつに」「米粉のおやつとして」のように、断定しない言い方にする。

自然な日本語:
- 実際にnattyの人がSNSに書くような、短く素直な文にする。広告コピーのような言い回しや凝った比喩は使わない。
- 「〜のようなひととき」「〜を演出します」「〜へ誘います」「至福の」「極上の」などは使わない。
- 締めの例（recent_texts で使われていなければ）: 「秋のおやつ時間にどうぞ」「秋らしいひとときを楽しみたい日に」「米粉のおやつとしてお楽しみください」

JSONで出力する: {"x": "...", "threads": "..."}`

const writingSchema = {
  type: 'json_schema',
  name: 'post_text',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'threads'],
    properties: {
      x: { type: 'string' },
      threads: { type: 'string' }
    }
  }
}

// ============================================================

// イベント情報を渡していないのに文中に出たらやり直す表現
// （「出店」「イベント」単体はブランド紹介で自然に出るので対象にしない）
const EVENT_PHRASES = [
  '今週末', 'この週末', '次回の', '次回出店', 'お披露目', 'イベント情報', '出店情報',
  '会場で', 'ブースで', 'お待ちしています', 'お待ちしてます'
]

// nattyには常設の実店舗がないので、実店舗があるように読める表現はやり直し
const STORE_WORDS = [
  '店内', '店舗', '店頭', '当店', '来店', '工房', 'お店に来', 'お店で', 'お店の', '焼き菓子店', 'ショップ'
]

// 食感・香りの表現（商品の説明文にない場合はやり直し）
const TEXTURE_WORDS = [
  'ふんわり', 'ふわふわ', 'ふわっ', 'しっとり', 'もっちり', 'もちもち', 'もちっ', '口どけ', '口溶け',
  'なめらか', 'とろける', 'サクサク', 'ほろほろ', '香りが広が', '香り広が', '香ばし', '芳醇', '風味豊か', '濃厚', '焼きたて'
]

// AIっぽい硬い言い回し・凝った比喩（やり直し）
const STIFF_PHRASES = [
  'のようなひととき', 'を演出', '演出します', 'へ誘', 'いざな', '至福', '極上', '魔法の', 'ブランドです'
]

// 便利だが続くと単調になる言い回し（最近の文に出ていたら今回は使わない）
const REPEAT_WATCH = [
  'やさしい味わい', '優しい味わい', '秋のおやつ', '冬のおやつ', '春のおやつ', '夏のおやつ',
  'おやつ時間', 'ほっとひと息', 'ほっと一息', 'ひと息', 'ぜひ一度', 'お楽しみください', 'ご賞味'
]

const callOpenAI = async (
  apiKey: string,
  model: string,
  instructions: string,
  messages: { role: string; content: string }[],
  format: unknown
) => {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions,
      input: messages,
      reasoning: { effort: 'low' },
      max_output_tokens: 3000,
      text: { format },
      store: false
    })
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  return (data.output ?? [])
    .filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content ?? [])
    .filter((content: any) => content.type === 'output_text')
    .map((content: any) => content.text)
    .join('')
}

const parseJson = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return json({ error: 'OPENAI_API_KEY が設定されていません' }, 500)
  const model = Deno.env.get('OPENAI_MODEL') || DEFAULT_MODEL
  const startDate = Deno.env.get('AI_RECOMMENDATION_START_DATE') || null

  // ログインユーザーとしてDBを読む（RLSがそのまま効く）
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: userData, error: userError } = await supabase.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, '')
  )
  if (userError || !userData.user) return json({ error: 'ログインが必要です' }, 401)

  let productId = ''
  let excludeAngles: string[] = []
  let avoidPostIds: string[] = []
  try {
    const body = await req.json()
    productId = typeof body?.product_id === 'string' ? body.product_id : ''
    // 作り直し時に「さっきと違う切り口で」と指定できる（除外にしか使わないので信用しても安全）
    // 作り直し前の案（言い回しの重複を避けるため。内容はDBから読む）
    if (Array.isArray(body?.avoid_post_ids)) {
      avoidPostIds = body.avoid_post_ids
        .filter((id: unknown) => typeof id === 'string' && UUID_RE.test(id))
        .slice(0, 4)
    }
    if (Array.isArray(body?.exclude_angles)) {
      excludeAngles = body.exclude_angles.filter((a: unknown) =>
        typeof a === 'string' && (CONTENT_ANGLES as readonly string[]).includes(a)
      )
    }
  } catch {
    // 下で弾く
  }
  if (!UUID_RE.test(productId)) return json({ error: 'product_id が正しくありません' }, 400)

  try {
    // ---- 事実の取り直し ----
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, category, description, created_at, active')
      .eq('id', productId)
      .maybeSingle()
    if (productError) throw productError
    if (!product || !product.active) return json({ error: '商品が見つかりません' }, 404)

    const [eventsRes, linksRes, salesRes, postsRes, recentRes] = await Promise.all([
      supabase.from('events').select('id, name, event_date, start_time, location, status, sale_type'),
      supabase.from('event_products').select('event_id, product_id').eq('product_id', productId),
      supabase.from('sales_results').select('event_id, product_id, status').eq('product_id', productId),
      supabase
        .from('social_posts')
        .select('product_id, post_type, status, posted_at, updated_at')
        .eq('product_id', productId)
        .in('status', [...HISTORY_STATUSES])
        .in('post_type', [...INTRO_POST_TYPES]),
      // 全商品の直近の紹介系投稿（切り口の重複を避けるため）
      supabase
        .from('social_posts')
        .select('product_id, content_angle, posted_at, updated_at, products ( name )')
        .in('status', [...HISTORY_STATUSES])
        .in('post_type', [...INTRO_POST_TYPES])
        .eq('platform', 'x') // X・Threadsで同じ投稿が2行あるので片方だけ見る
        .order('updated_at', { ascending: false })
        .limit(10)
    ])
    for (const r of [eventsRes, linksRes, salesRes, postsRes, recentRes]) if (r.error) throw r.error

    const today = jstToday()
    const events = (eventsRes.data ?? []) as RecEvent[]
    const eventProducts = linksRes.data ?? []

    const result = evaluateProducts({
      today,
      startDate,
      products: [product],
      events,
      eventProducts,
      salesResults: salesRes.data ?? [],
      posts: postsRes.data ?? []
    })
    const facts = result.all[0]
    const nextEvent = result.nextEvent
    const lastPastEvent = findLastPastEvent(events, eventProducts, productId, today)

    const recentPosts = (recentRes.data ?? []).map((p: any) => ({
      product: p.products?.name ?? null,
      content_angle: p.content_angle as string | null,
      days_ago: daysBetween(today, toJstDate(p.posted_at ?? p.updated_at))
    }))

    // ---- 使ってよい切り口をプログラムで決める ----
    // 「3日以内だからイベント情報を使ってよい」ではなく、
    // 「3日以内なら event_notice を選択肢に加えてよい」だけ
    const plan = planAngles({
      today,
      facts,
      nextEvent,
      lastPastEvent,
      recentAngles: recentPosts.map(p => p.content_angle),
      excludeAngles
    })

    const productForAi = {
      name: product.name,
      category: categoryLabel(product.category),
      description: product.description || null
    }
    const factsForAi = {
      sold_out_often: facts.reasons.includes('sold_out_often'),
      sold_out_count: facts.soldOutCount,
      recent_event_count: facts.recentEventCount,
      last_introduced_days_ago: facts.lastIntroDaysAgo,
      never_introduced: facts.lastIntroDate === null,
      is_new_product: facts.isNewProduct
    }

    // ================= 1回目: 切り口を選ぶ（イベントの中身は見せない）=================
    const strategyInput = {
      today: { date: today, season: seasonOf(today) },
      shop_profile: profileForAi(),
      product: productForAi,
      facts: factsForAi,
      recent_posts: recentPosts.slice(0, 5).map(p => ({
        product: p.product,
        angle: p.content_angle ? ANGLE_LABELS[p.content_angle as ContentAngle] ?? p.content_angle : '不明',
        days_ago: p.days_ago
      })),
      allowed_angles: plan.allowed.map(a => ({ key: a, label: ANGLE_LABELS[a], guide: ANGLE_GUIDES[a] }))
    }

    let angle: ContentAngle | null = null
    let reason = ''
    for (let attempt = 0; attempt < 2 && !angle; attempt++) {
      const text = await callOpenAI(apiKey, model, STRATEGY_PROMPT, [
        { role: 'user', content: JSON.stringify(strategyInput, null, 2) }
      ], strategySchema(plan.allowed))
      const data = parseJson(text)
      const picked = str(data?.content_angle) as ContentAngle
      if (plan.allowed.includes(picked)) {
        angle = picked
        reason = str(data?.reason)
      }
    }
    if (!angle) return json({ error: '切り口を決められませんでした。もう一度お試しください。' }, 502)

    // ================= 2回目: 文章を書く（切り口に必要な情報だけ渡す）=================
    // イベント情報を渡すのは sale_type='event' のときだけ（直売所・受注・その他の情報は渡さない）
    const isEventSale = (e: RecEvent | null) => !!e && (e.sale_type ?? 'event') === 'event'
    const eventForAi = angle === 'event_notice' && isEventSale(nextEvent) ? nextEvent : null
    const lastEventForAi = angle === 'event_thanks' && isEventSale(lastPastEvent) ? lastPastEvent : null
    const usesEvent = !!(eventForAi || lastEventForAi)

    const writingInput: Record<string, unknown> = {
      strategy: { angle: ANGLE_LABELS[angle], guide: ANGLE_GUIDES[angle], reason },
      today: { date: today, season: seasonOf(today) },
      shop_profile: profileForAi({ includeEventFacts: usesEvent }),
      product: productForAi,
      facts: factsForAi
    }
    if (eventForAi) {
      writingInput.event = {
        type: '次回の出店',
        name: eventForAi.name,
        date: formatEventDate(eventForAi.event_date),
        days_until: plan.daysUntilNextEvent,
        location: eventForAi.location || null
      }
    }
    if (lastEventForAi) {
      writingInput.event = {
        type: '先日の出店（お礼）',
        name: lastEventForAi.name,
        days_ago: plan.daysSinceLastEvent
      }
    }

    // イベントを渡していないときに混入していないかの検出用（実在するイベント名・場所・日付）
    const knownEventWords = usesEvent
      ? []
      : [
          ...events
            .filter(e => e.event_date >= (lastPastEvent?.event_date ?? today))
            .flatMap(e => [e.name, e.location ?? '', ...eventDateWords(e.event_date)]),
          ...EVENT_PHRASES
        ].filter(w => w && w.length >= 2)

    const validateText = (x: string, threads: string) => {
      const problems: string[] = []
      const inText = (w: string) => x.includes(w) || threads.includes(w)
      const description = product.description ?? ''
      const textureFound = [...new Set(TEXTURE_WORDS.filter(w => inText(w) && !description.includes(w)))]
      if (textureFound.length) {
        problems.push(`「${textureFound.join('」「')}」は商品の説明にない食感・香りの表現です。「やさしい味わい」「米粉のおやつとして」など、断定しない言い方に変えてください`)
      }
      const stiffFound = [...new Set(STIFF_PHRASES.filter(inText))]
      if (stiffFound.length) {
        problems.push(`「${stiffFound.join('」「')}」は広告っぽい言い回しです。お店の人が書くような素直な文に直してください`)
      }
      const repeated = overused.filter(inText)
      if (repeated.length) {
        problems.push(`「${repeated.join('」「')}」は最近の投稿でも使っています。別の言い回しにしてください`)
      }
      const storeFound = [...new Set(STORE_WORDS.filter(w => x.includes(w) || threads.includes(w)))]
      if (storeFound.length) {
        problems.push(`nattyには実店舗がありません。「${storeFound.join('」「')}」を含む表現をやめ、実店舗を連想させない文にしてください`)
      }
      if (!x || !threads) problems.push('x と threads の両方を書いてください')
      const found = [...new Set(knownEventWords.filter(w => x.includes(w) || threads.includes(w)))]
      if (found.length) {
        problems.push(`今回はイベントの話を入れません。「${found.join('」「')}」を含む文を削除し、商品の魅力や季節感だけで締めくくってください`)
      }
      if (xWeightedLength(x) > X_LIMIT) problems.push('x が長すぎます（全角140文字以内にしてください）')
      if (Array.from(threads).length > THREADS_LIMIT) problems.push('threads が長すぎます（全角250文字程度にしてください）')
      return problems
    }

    // ---- 最近の投稿文（言い回しの重複を避ける）----
    const [recentTextsRes, avoidTextsRes] = await Promise.all([
      supabase
        .from('social_posts')
        .select('content')
        .in('status', [...HISTORY_STATUSES])
        .eq('post_type', 'ai_recommended')
        .order('updated_at', { ascending: false })
        .limit(5),
      avoidPostIds.length
        ? supabase.from('social_posts').select('content').in('id', avoidPostIds)
        : Promise.resolve({ data: [], error: null })
    ])
    if (recentTextsRes.error) throw recentTextsRes.error
    if (avoidTextsRes.error) throw avoidTextsRes.error
    const recentTexts = [
      ...(avoidTextsRes.data ?? []).map((r: any) => r.content as string),
      ...(recentTextsRes.data ?? []).map((r: any) => r.content as string)
    ].filter(Boolean).slice(0, 8)
    if (recentTexts.length) writingInput.recent_texts = recentTexts

    // 最近の文で使われた「よく出る言い回し」は、今回は使わない
    const overused = REPEAT_WATCH.filter(w => recentTexts.some(t => t.includes(w)))

    const messages = [
      { role: 'user', content: JSON.stringify(writingInput, null, 2) }
    ]
    let written: { x: string; threads: string } | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      const text = await callOpenAI(apiKey, model, WRITING_PROMPT, messages, writingSchema)
      const data = parseJson(text)
      const x = str(data?.x)
      const threads = str(data?.threads)
      const problems = data ? validateText(x, threads) : ['指定のJSON形式で出力してください']
      if (problems.length === 0) {
        written = { x, threads }
        break
      }
      messages.push({ role: 'assistant', content: text })
      messages.push({ role: 'user', content: `修正してください: ${problems.join(' / ')}` })
    }
    if (!written) return json({ error: '文章を作れませんでした。もう一度お試しください。' }, 502)

    if (!reason) reason = reasonLines(facts, nextEvent).join('。')

    // ---- draft 保存 ----
    const base = {
      event_id: eventForAi?.id ?? lastEventForAi?.id ?? null,
      product_id: productId,
      post_type: 'ai_recommended',
      source_type: 'ai_recommended',
      generated_by_ai: true,
      ai_reason: reason,
      topic_key: `product:${productId}`,
      content_angle: angle,
      image_mode: 'none',
      status: 'draft'
    }
    const { data: saved, error: saveError } = await supabase
      .from('social_posts')
      .insert([
        { ...base, platform: 'x', content: written.x },
        { ...base, platform: 'threads', content: written.threads }
      ])
      .select('id, platform, content')
    if (saveError) throw saveError

    return json({
      reason,
      content_angle: angle,
      angle_label: ANGLE_LABELS[angle],
      use_event_info: usesEvent,
      allowed_angles: plan.allowed,
      posts: saved
    })
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : String((error as any)?.message ?? error)
    return json({ error: message }, 500)
  }
})

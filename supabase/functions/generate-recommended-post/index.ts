// AIおまかせ投稿の文章生成
//
// ブラウザからは product_id だけを受け取り、事実（販売実績・次回イベント・投稿履歴）は
// このFunctionでDBから取り直してから OpenAI Responses API に渡す。
// 生成した X案・Threads案は social_posts に draft として保存して返す。
//
// Secrets:
//   OPENAI_API_KEY                 （必須）
//   AI_RECOMMENDATION_START_DATE   （例: 2026-10-01。未設定なら新商品判定をしない）
//   OPENAI_MODEL                   （任意。未設定なら DEFAULT_MODEL）
// SUPABASE_URL / SUPABASE_ANON_KEY は Supabase が自動で設定する。

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  HISTORY_STATUSES,
  INTRO_POST_TYPES,
  evaluateProducts,
  jstToday,
  reasonLines,
  type RecEvent
} from '../_shared/recommend-core.ts'

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
  c === 'chiffon' ? 'シフォンケーキ' : c === 'muffin' ? 'マフィン' : c ?? ''

const formatEventDate = (value: string) => {
  const [y, m, d] = value.split('-').map(Number)
  const week = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}月${d}日(${week})`
}

const SYSTEM_PROMPT = `あなたは、米粉の焼き菓子店「natty」のSNS担当です。
natty は家族で営む小さなお店で、自家栽培の長野県産米「風さやか」の米粉を使ったシフォンケーキとマフィンを、マルシェなどのイベントで販売しています。
店名は必ず小文字で「natty」と書きます。

与えられた「事実データ」だけをもとに、商品を紹介するSNS投稿文を日本語で作ってください。

守ること:
- 事実データにないこと（価格、個数、味の細かい特徴、受賞歴、期間限定など）は書かない。説明文(description)がある場合はその範囲で触れてよい
- 「完売」「よく売れている」は事実データで完売回数が2回以上のときだけ使う
- 次回イベントがある場合は、イベント名と日付を入れて来場を呼びかける
- やわらかく親しみのある文体。絵文字は1〜2個まで
- X用は全角140文字程度まで（ハッシュタグ込み）。ハッシュタグは2個まで
- Threads用はXより少しだけ丁寧に、全角250文字程度まで。ハッシュタグは1個まで
- reason は、この商品をいま紹介するとよい理由を、お店の人向けに1〜2文で

出力は次のJSONだけにしてください。前後に説明文やコードブロックを付けないでください。
{"reason": "...", "x": "...", "threads": "..."}`

type Generated = { reason: string; x: string; threads: string }

const parseGenerated = (text: string): Generated | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const data = JSON.parse(text.slice(start, end + 1))
    const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const result = { reason: pick(data.reason), x: pick(data.x), threads: pick(data.threads) }
    if (!result.x || !result.threads) return null
    return result
  } catch {
    return null
  }
}

const validate = (g: Generated) => {
  const problems: string[] = []
  if (xWeightedLength(g.x) > X_LIMIT) problems.push(`x が長すぎます（全角140文字以内にしてください）`)
  if (Array.from(g.threads).length > THREADS_LIMIT) problems.push(`threads が長すぎます（500文字以内にしてください）`)
  if (g.reason.length > 300) problems.push('reason が長すぎます')
  return problems
}

const callOpenAI = async (apiKey: string, model: string, messages: { role: string; content: string }[]) => {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: messages,
      reasoning: { effort: 'minimal' },
      max_output_tokens: 1200,
      text: { format: { type: 'json_object' } },
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
  try {
    const body = await req.json()
    productId = typeof body?.product_id === 'string' ? body.product_id : ''
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

    const [eventsRes, linksRes, salesRes, postsRes] = await Promise.all([
      supabase.from('events').select('id, name, event_date, start_time, location, status'),
      supabase.from('event_products').select('event_id, product_id').eq('product_id', productId),
      supabase.from('sales_results').select('event_id, product_id, status').eq('product_id', productId),
      supabase
        .from('social_posts')
        .select('product_id, post_type, status, posted_at, updated_at')
        .eq('product_id', productId)
        .in('status', [...HISTORY_STATUSES])
        .in('post_type', [...INTRO_POST_TYPES])
    ])
    for (const r of [eventsRes, linksRes, salesRes, postsRes]) if (r.error) throw r.error

    const result = evaluateProducts({
      today: jstToday(),
      startDate,
      products: [product],
      events: (eventsRes.data ?? []) as RecEvent[],
      eventProducts: linksRes.data ?? [],
      salesResults: salesRes.data ?? [],
      posts: postsRes.data ?? []
    })
    const facts = result.all[0]
    const nextEvent = result.nextEvent

    const factData = {
      product: {
        name: product.name,
        category: categoryLabel(product.category),
        description: product.description || null
      },
      sold_out_count: facts.soldOutCount,
      recent_event_count: facts.recentEventCount,
      last_posted_days_ago: facts.lastIntroDaysAgo,
      is_new_product: facts.isNewProduct,
      next_event: facts.inNextEvent && nextEvent
        ? {
            name: nextEvent.name,
            date: formatEventDate(nextEvent.event_date),
            location: nextEvent.location || null
          }
        : null
    }

    // ---- 生成（形式・文字数が合わなければ1回だけやり直す）----
    const messages = [
      { role: 'user', content: `次の事実データをもとに、指定されたJSON形式だけで回答してください。\n事実データ:\n${JSON.stringify(factData, null, 2)}` }
    ]
    let generated: Generated | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await callOpenAI(apiKey, model, messages)
      const parsed = parseGenerated(text)
      const problems = parsed ? validate(parsed) : ['JSON形式で出力してください']
      if (parsed && problems.length === 0) {
        generated = parsed
        break
      }
      messages.push({ role: 'assistant', content: text })
      messages.push({ role: 'user', content: `修正してください: ${problems.join(' / ')}。JSONだけを出力してください。` })
    }
    if (!generated) return json({ error: '文章を作れませんでした。もう一度お試しください。' }, 502)

    const reason = generated.reason || reasonLines(facts, nextEvent).join('。')

    // ---- draft 保存 ----
    const base = {
      event_id: facts.inNextEvent && nextEvent ? nextEvent.id : null,
      product_id: productId,
      post_type: 'ai_recommended',
      source_type: 'ai_recommended',
      generated_by_ai: true,
      ai_reason: reason,
      topic_key: `product:${productId}`,
      image_mode: 'none',
      status: 'draft'
    }
    const { data: saved, error: saveError } = await supabase
      .from('social_posts')
      .insert([
        { ...base, platform: 'x', content: generated.x },
        { ...base, platform: 'threads', content: generated.threads }
      ])
      .select('id, platform, content')
    if (saveError) throw saveError

    return json({ reason, facts: factData, posts: saved })
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : String((error as any)?.message ?? error)
    return json({ error: message }, 500)
  }
})

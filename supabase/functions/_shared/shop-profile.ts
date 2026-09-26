// natty の宣伝方針とお店の知識。AI宣伝広報部長に毎回渡す。
// 将来は DB（shop_profile / 宣伝方針テーブル）へ移し、コードを書き換えずに調整できるようにする想定。
//
// ・facts に書いたことだけを、AIは事実として投稿に書ける
// ・空の項目（'' や []）はAIに渡さない。分かったものから埋めていけばよい
export const SHOP_PROFILE = {
  brand_name: 'natty',
  brand_name_rule: 'ブランド名は必ず小文字で「natty」と書く',

  // ---- 宣伝の目的・判断基準 ----
  mission:
    '売り込み一辺倒ではなく、nattyを知ってもらい、好きになってもらい、購入につなげる',
  target_customer: [] as string[], // 例: '小さな子どものいる家族' など、届けたい人
  appeal_points: [] as string[], // 例: 他の店との違いとして伝えたいこと
  seasonal_policy: '', // 例: 季節の行事（クリスマス・母の日など）の扱い方

  // ---- お店の事実 ----
  facts: {
    intro: 'nattyでは、家族で米粉の焼き菓子を作っています',
    products: 'シフォンケーキとマフィン',
    no_physical_store: '常設の実店舗はない（店内・店頭・工房の見学などは存在しない）',
    sales_channels: ['イベント出店', '受注販売', '農産物直売所への納品'],
    ingredients: [
      '自家栽培した長野県産のお米「風さやか」を米粉にして使っている',
      '平飼い卵を使っている'
    ]
  },

  // ---- 文体・表現 ----
  tone: 'やわらかく親しみのある文体。押し売りしない。絵文字は1〜2個まで',
  hashtags: ['#natty', '#米粉シフォン', '#米粉のおやつ', '#米粉マフィン'],
  avoid_phrases: [
    '価格・個数・在庫数など、データにない数字',
    '受賞歴、限定、日本一などの誇張表現',
    'グルテンフリー、アレルギー対応、健康効果などの断定',
    'データにない味の細かい特徴や材料',
    '店内・店頭・工房など、実店舗があるかのような表現（「店内の香り」「お店に来て」など）',
    '確認できない情景・製造風景・食感・香り・製法・お客様の反応や感想を、雰囲気づくりのために創作すること',
    '「今すぐ買って」のような強い売り込み'
  ]
}

// 空の項目を取り除いてAIに渡す。
// イベント情報を使わない投稿では、販売方法のうち「イベント出店」は渡さない（イベントに話が寄るため）。
export const profileForAi = (options: { includeEventFacts?: boolean } = {}) => {
  const isEmpty = (v: unknown) =>
    v === '' || v == null || (Array.isArray(v) && v.length === 0)
  const clean = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => !isEmpty(v))
        .map(([k, v]) =>
          v && typeof v === 'object' && !Array.isArray(v) ? [k, clean(v as Record<string, unknown>)] : [k, v]
        )
    )
  const profile = clean(SHOP_PROFILE as unknown as Record<string, unknown>)
  if (!options.includeEventFacts && profile.facts && typeof profile.facts === 'object') {
    const facts = { ...(profile.facts as Record<string, unknown>) }
    if (Array.isArray(facts.sales_channels)) {
      facts.sales_channels = (facts.sales_channels as string[]).filter(c => !c.includes('イベント'))
    }
    profile.facts = facts
  }
  return profile
}

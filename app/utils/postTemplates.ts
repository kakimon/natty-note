// 当日速報のおしらせ文をテンプレートで作る（AI APIは使わない）

export type PostType = 'sold_out' | 'few_left' | 'closing_soon'

export const postTypeLabels: Record<PostType, string> = {
  sold_out: '完売のおしらせ',
  few_left: '残りわずかのおしらせ',
  closing_soon: 'まもなく終了のおしらせ'
}

export type TemplateInput = {
  eventName: string
  location?: string | null
  endTime?: string | null // "15:00:00" / "15:00"
  productName?: string | null
  // 対象商品以外で、まだ買える商品
  availableNames: string[]
  fewLeftNames: string[]
}

// "15:00:00" → "15時" / "15:30:00" → "15時30分"
export const formatJpTime = (value?: string | null) => {
  if (!value) return ''
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h)) return ''
  return m ? `${h}時${m}分` : `${h}時`
}

// 3つまで並べて、それ以上は「など」
const joinNames = (names: string[]) =>
  names.length > 3 ? `${names.slice(0, 3).join('、')}など` : names.join('、')

const lines = (...parts: (string | false | null | undefined)[]) =>
  parts.filter((p): p is string => typeof p === 'string').join('\n')

type Template = (i: TemplateInput) => string

const templates: Record<PostType, Template[]> = {
  sold_out: [
    i => lines(
      `${i.productName}は`,
      'おかげさまで完売しました！',
      '',
      'ありがとうございます😊',
      (i.availableNames.length || i.fewLeftNames.length) && '',
      (i.availableNames.length || i.fewLeftNames.length) && 'ほかの商品はまだご用意しています。',
      i.endTime && `${i.eventName}は${formatJpTime(i.endTime)}までです。`
    ),
    i => lines(
      `${i.eventName}にお越しいただいた皆さま、ありがとうございます。`,
      `${i.productName}は完売となりました🙏`,
      i.availableNames.length > 0 && '',
      i.availableNames.length > 0 && `${joinNames(i.availableNames)}はまだございます。`,
      i.endTime && `${formatJpTime(i.endTime)}まで出店していますので、ぜひお立ち寄りください。`
    ),
    i => lines(
      `【完売】${i.productName}`,
      '',
      'たくさんのお客さまに手に取っていただき、ありがとうございました✨',
      i.endTime && `${i.eventName}は${formatJpTime(i.endTime)}までです。`
    )
  ],

  few_left: [
    i => lines(
      `${i.productName}、残りわずかになりました！`,
      '',
      '気になっている方はお早めにどうぞ😊',
      i.endTime
        ? `${i.eventName}${i.location ? `（${i.location}）` : ''}で${formatJpTime(i.endTime)}まで販売しています。`
        : `${i.eventName}${i.location ? `（${i.location}）` : ''}で販売しています。`
    ),
    i => lines(
      `【残りわずか】${i.productName}`,
      '',
      `${i.eventName}でお待ちしています✨`,
      i.endTime && `${formatJpTime(i.endTime)}までです。`
    ),
    i => lines(
      `${i.eventName}にお越しいただきありがとうございます！`,
      `${i.productName}は残りあと少しです。`,
      i.availableNames.length > 0 && `${joinNames(i.availableNames)}もご用意しています😊`
    )
  ],

  closing_soon: [
    i => lines(
      `${i.eventName}は${i.endTime ? `${formatJpTime(i.endTime)}まで` : 'まもなく終了'}です！`,
      '',
      i.availableNames.length > 0 && `まだ${joinNames(i.availableNames)}がございます。`,
      i.fewLeftNames.length > 0 && `${joinNames(i.fewLeftNames)}は残りわずかです。`,
      '最後までよろしくお願いします😊'
    ),
    i => lines(
      `本日の${i.eventName}、まもなく終了です${i.endTime ? `（${formatJpTime(i.endTime)}まで）` : ''}。`,
      '',
      'お越しいただいた皆さま、ありがとうございました✨',
      i.availableNames.length + i.fewLeftNames.length > 0 &&
        `${joinNames([...i.availableNames, ...i.fewLeftNames])}はまだ間に合います！`
    ),
    i => lines(
      '【まもなく終了】',
      `${i.eventName}${i.location ? `（${i.location}）` : ''}`,
      i.endTime && `${formatJpTime(i.endTime)}までです。`,
      '',
      'お近くの方はぜひお立ち寄りください😊'
    )
  ]
}

export const templateCount = (type: PostType) => templates[type].length

export const buildPost = (type: PostType, input: TemplateInput, variant = 0) => {
  const list = templates[type]
  return list[variant % list.length](input)
}

// Xの文字数（日本語・絵文字は2、半角は1として数える。上限280）
export const xWeightedLength = (text: string) =>
  Array.from(text).reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) <= 0x10ff ? 1 : 2), 0)

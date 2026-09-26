// クリップボードへコピー。
// iPhoneのhttp接続などで Clipboard API が使えないときは execCommand で代替する。
const fallbackCopy = (text: string) => {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  return ok
}

export const copyText = async (text: string) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 下の予備処理へ
  }
  return fallbackCopy(text)
}

export const xIntentUrl = (text: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}`

export const threadsIntentUrl = (text: string) =>
  `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`

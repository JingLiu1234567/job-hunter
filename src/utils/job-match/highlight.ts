/**
 * 在网页 JD 原文里定位某段 quote 并灰底高亮 + 滚动过去。
 * 用 CSS Custom Highlight API（不改 DOM、不破坏页面/React，可跨节点），
 * 浏览器不支持时退化为给最近的块元素加临时灰底。
 */

const HIGHLIGHT_NAME = "jobhunter-locate"
const STYLE_ID = "jobhunter-locate-style"
const GRAY = "rgba(148, 163, 184, 0.5)" // 灰色底纹

/** 跳过这些容器里的文字：脚本/样式，以及 Read Frog 注入的译文节点 */
const SKIP_SELECTOR = "script,style,noscript,.read-frog-translated-content-wrapper,.notranslate"

interface HighlightAPI {
  set: (name: string, h: unknown) => void
  delete: (name: string) => void
}
function highlightRegistry(): HighlightAPI | null {
  const reg = (CSS as unknown as { highlights?: HighlightAPI }).highlights
  const Ctor = (globalThis as unknown as { Highlight?: unknown }).Highlight
  return reg && typeof Ctor === "function" ? reg : null
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID))
    return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:${GRAY};color:inherit;border-radius:2px;}`
  document.head.appendChild(style)
}

/** 单字符归一化（1:1，不改长度）：统一卷曲/直引号、破折号、大小写。 */
function normChar(ch: string): string {
  if ("'‘’‚‛＇".includes(ch))
    return "'"
  if ("\"“”„‟＂".includes(ch))
    return "\""
  // 各种连字符/破折号（含非断行连字符 U+2011、减号 U+2212）统一成普通 "-"
  if ("‐‑‒–—―−﹘﹣－-".includes(ch))
    return "-"
  return ch.toLowerCase()
}

/** 把 quote 归一化成与 haystack 同样的形式（折叠空白、统一引号、小写、去首尾空白）。 */
function normalizeQuote(q: string): string {
  let out = ""
  let prevSpace = false
  for (const ch of q) {
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        out += " "
        prevSpace = true
      }
    }
    else {
      out += normChar(ch)
      prevSpace = false
    }
  }
  return out.trim()
}

interface DomIndex {
  /** 归一化后的整页文本（用于查找） */
  norm: string
  /** norm 第 i 个字符对应的 DOM 位置 */
  origin: { node: Text, offset: number }[]
}

/** 遍历页面文本节点，构建"归一化文本 → DOM 位置"的映射。 */
function buildIndex(root: Element): DomIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent)
        return NodeFilter.FILTER_REJECT
      if (parent.closest(SKIP_SELECTOR))
        return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let norm = ""
  const origin: { node: Text, offset: number }[] = []
  let prevSpace = false
  let current = walker.nextNode() as Text | null
  while (current) {
    const data = current.data
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      if (/\s/.test(ch)) {
        if (!prevSpace) {
          norm += " "
          origin.push({ node: current, offset: i })
          prevSpace = true
        }
      }
      else {
        norm += normChar(ch)
        origin.push({ node: current, offset: i })
        prevSpace = false
      }
    }
    current = walker.nextNode() as Text | null
  }
  return { norm, origin }
}

/** 在 norm 里找 quote：先整段，找不到再退而求其次找较长前缀。返回 [起, 止)（norm 下标）。 */
function findRange(norm: string, nq: string): [number, number] | null {
  if (nq.length < 4)
    return null
  const exact = norm.indexOf(nq)
  if (exact !== -1)
    return [exact, exact + nq.length]
  // 退化：取 quote 越来越短的前缀，命中较长片段即可
  for (let len = Math.min(nq.length, 120); len >= 20; len -= 10) {
    const prefix = nq.slice(0, len)
    const idx = norm.indexOf(prefix)
    if (idx !== -1)
      return [idx, idx + len]
  }
  return null
}

function scrollRangeIntoView(range: Range) {
  const el = range.startContainer.parentElement
  el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
}

// 不支持 Highlight API 时的退化方案：临时给元素上灰底，记录以便还原
let fallbackEl: HTMLElement | null = null
let fallbackPrevBg = ""

function clearFallback() {
  if (fallbackEl) {
    fallbackEl.style.backgroundColor = fallbackPrevBg
    fallbackEl = null
    fallbackPrevBg = ""
  }
}

/** 清除当前高亮。 */
export function clearQuoteHighlight() {
  highlightRegistry()?.delete(HIGHLIGHT_NAME)
  clearFallback()
}

/**
 * 在页面里定位并高亮 quote。成功返回 true。
 */
export function highlightQuoteOnPage(quote: string): boolean {
  clearQuoteHighlight()
  const root = document.body
  if (!root)
    return false

  const { norm, origin } = buildIndex(root)
  const found = findRange(norm, normalizeQuote(quote))
  if (!found)
    return false

  const [start, end] = found
  const startPos = origin[start]
  const endPos = origin[end - 1]
  if (!startPos || !endPos)
    return false

  const range = document.createRange()
  try {
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset + 1)
  }
  catch {
    return false
  }

  ensureStyle()
  const registry = highlightRegistry()
  if (registry) {
    const Ctor = (globalThis as unknown as { Highlight: new (r: Range) => unknown }).Highlight
    registry.set(HIGHLIGHT_NAME, new Ctor(range))
  }
  else {
    // 退化：给最近的元素上灰底
    const el = range.startContainer.parentElement
    if (el) {
      fallbackEl = el
      fallbackPrevBg = el.style.backgroundColor
      el.style.backgroundColor = GRAY
    }
  }

  scrollRangeIntoView(range)
  return true
}

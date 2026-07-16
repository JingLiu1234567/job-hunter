/**
 * 在网页 JD 原文里定位某段 quote：用脚本创建的绝对定位半透明色块叠加高亮 + 滚动过去。
 * 不用 CSS Custom Highlight API、不注入 <style> 标签——两者都可能被部分站点的
 * CSP（Content-Security-Policy）悄悄拦截，导致"定位到了、滚动成功了，但看不见高亮"。
 * 叠加层是独立创建的 DOM 节点、纯 JS 内联样式赋值（不进页面自身的 DOM/React 树），
 * 这类程序化设置的内联样式不受 style-src 类 CSP 限制。
 *
 * 搜索范围限定在 JD 容器元素内（复用 extract-jd.ts 的容器定位逻辑），而不是整个
 * document.body——否则 quote 精确匹配不到时的短前缀退化匹配，很容易在导航栏、
 * 筛选标签、侧边栏其它职位列表等无关文字里凑巧撞上，导致高亮/滚动定位到完全不相关的位置。
 */

import { findJdContainerElement } from "./extract-jd"

const GRAY = "rgba(148, 163, 184, 0.5)" // 灰色底纹
const OVERLAY_CLASS = "jobhunter-locate-overlay"

/** 跳过这些容器里的文字：脚本/样式，以及 Read Frog 注入的译文节点 */
const SKIP_SELECTOR = "script,style,noscript,.read-frog-translated-content-wrapper,.notranslate"

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

/**
 * 在 norm 里找 quote 的一次出现：先整段精确匹配，找不到再退而求其次找较长前缀。
 * `fromIndex` 用于跳过之前已经试过、但渲染不可见的匹配，找下一个出现位置。
 * 前缀退化只在第一次查找时用（fromIndex === 0），避免同一个短前缀在页面里到处误命中。
 * 返回 [起, 止)（norm 下标）。
 */
function findRange(norm: string, nq: string, fromIndex = 0): [number, number] | null {
  if (nq.length < 4)
    return null
  const exact = norm.indexOf(nq, fromIndex)
  if (exact !== -1)
    return [exact, exact + nq.length]
  if (fromIndex > 0)
    return null
  // 退化：取 quote 越来越短的前缀，命中较长片段即可
  for (let len = Math.min(nq.length, 120); len >= 20; len -= 10) {
    const prefix = nq.slice(0, len)
    const idx = norm.indexOf(prefix)
    if (idx !== -1)
      return [idx, idx + len]
  }
  return null
}

/**
 * 判断一个 Range 是否"真的渲染可见"——不少页面（含 LinkedIn 的"...更多"折叠描述）
 * 会把同一段文字在 DOM 里保留两份：一份折叠隐藏、一份展开可见。如果直接取文本里第一次
 * 出现的位置去高亮/滚动，很容易勾到隐藏那份，导致滚动结果和肉眼看到的内容对不上。
 * 这里综合三个信号：元素本身是否 display:none/visibility:hidden、Range 的渲染框是否有
 * 实际尺寸、以及是否被某个 overflow:hidden/clip 的祖先裁剪掉（常见的文字截断实现）。
 */
function isRangeVisible(range: Range): boolean {
  const rects = range.getClientRects()
  let hasSize = false
  for (const r of rects) {
    if (r.width > 0 && r.height > 0) {
      hasSize = true
      break
    }
  }
  if (!hasSize)
    return false

  const el = range.startContainer.parentElement
  if (!el)
    return false

  const checkVisibility = (el as unknown as { checkVisibility?: (opts?: Record<string, boolean>) => boolean }).checkVisibility
  if (typeof checkVisibility === "function" && !checkVisibility.call(el, { visibilityProperty: true, opacityProperty: true }))
    return false

  const rect = range.getBoundingClientRect()
  let ancestor = el.parentElement
  let depth = 0
  while (ancestor && depth < 12) {
    const style = getComputedStyle(ancestor)
    const clips = style.overflow === "hidden" || style.overflow === "clip" || style.overflowY === "hidden" || style.overflowY === "clip"
    if (clips) {
      const aRect = ancestor.getBoundingClientRect()
      const overlaps = rect.bottom > aRect.top && rect.top < aRect.bottom && rect.right > aRect.left && rect.left < aRect.right
      if (!overlaps || aRect.height < 4)
        return false
    }
    ancestor = ancestor.parentElement
    depth++
  }
  return true
}

// 当前高亮用的叠加层元素；requestToken 用来让"迟到"的滚动回调失效
// （用户很快点了下一条，旧的 setTimeout 才触发，不该再把旧高亮画出来）。
let overlays: HTMLElement[] = []
let requestToken = 0

/** 清除当前高亮。 */
export function clearQuoteHighlight() {
  requestToken++
  for (const el of overlays)
    el.remove()
  overlays = []
}

/** 按 range 当前的渲染矩形，画一批绝对定位的灰色叠加块（跨节点的一段文字可能对应多个矩形）。 */
function paintOverlays(range: Range) {
  for (const r of range.getClientRects()) {
    if (r.width <= 0 || r.height <= 0)
      continue
    const el = document.createElement("div")
    el.className = OVERLAY_CLASS
    el.style.position = "absolute"
    el.style.top = `${r.top + window.scrollY}px`
    el.style.left = `${r.left + window.scrollX}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
    el.style.backgroundColor = GRAY
    el.style.borderRadius = "2px"
    el.style.pointerEvents = "none"
    el.style.zIndex = "2147483647"
    el.style.opacity = "0"
    el.style.transition = "opacity 200ms ease-out"
    document.body.appendChild(el)
    overlays.push(el)
    // 先以 opacity:0 插入、强制触发一次 reflow，再改成 1——不这样浏览器会把两次赋值
    // 合并成一次，直接跳到最终值，不会有渐显效果。
    void el.offsetWidth
    el.style.opacity = "1"
  }
}

/**
 * 先滚动、等动画稳定了再画高亮——不在滚动前先画一次再挪一次，避免出现
 * "先出现在错误位置，滚动完再跳过去"的视觉跳动。`token` 用来丢弃过期回调。
 */
function scrollThenPaint(range: Range, token: number) {
  const el = range.startContainer.parentElement
  if (!el) {
    if (token === requestToken)
      paintOverlays(range)
    return
  }
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
  // LinkedIn 这类 SPA 页面滚动过程中常有异步布局变化（图片懒加载、面板展开等），
  // 滚动动画结束时目标位置可能已经偏移。偏差较大就再校正一次，动画稳定后才画高亮。
  window.setTimeout(() => {
    if (token !== requestToken)
      return
    const rect = el.getBoundingClientRect()
    const drift = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2)
    if (drift > 60) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
      window.setTimeout(() => {
        if (token === requestToken)
          paintOverlays(range)
      }, 400)
    }
    else {
      paintOverlays(range)
    }
  }, 400)
}

/**
 * 在页面里定位并高亮 quote。成功返回 true。
 */
export function highlightQuoteOnPage(quote: string): boolean {
  clearQuoteHighlight()
  const token = requestToken
  // 优先只在 JD 容器内找；抓不到容器（非 LinkedIn 页面/选择器失配）才退化到整页搜索。
  const root = findJdContainerElement() ?? document.body
  if (!root)
    return false

  const { norm, origin } = buildIndex(root)
  const nq = normalizeQuote(quote)

  // 同一段 quote 可能在页面里出现多次（如折叠/展开各一份）。逐个试，
  // 优先用第一个"真正渲染可见"的出现位置；都不可见就退而求其次用第一个匹配，
  // 保证至少还是能高亮/跳转，而不是直接判定失败。
  let range: Range | null = null
  let searchFrom = 0
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = findRange(norm, nq, searchFrom)
    if (!found)
      break
    const [start, end] = found
    const startPos = origin[start]
    const endPos = origin[end - 1]
    if (!startPos || !endPos)
      break

    const candidate = document.createRange()
    try {
      candidate.setStart(startPos.node, startPos.offset)
      candidate.setEnd(endPos.node, endPos.offset + 1)
    }
    catch {
      break
    }

    if (!range)
      range = candidate
    if (isRangeVisible(candidate)) {
      range = candidate
      break
    }
    searchFrom = end
  }
  if (!range)
    return false

  scrollThenPaint(range, token)
  return true
}

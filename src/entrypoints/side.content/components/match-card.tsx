import type { RefObject } from "react"
import type { ImplicitRequirement, MatchResult, RequirementMatch, Verdict } from "@/utils/job-match/analyze"
import { IconCheck, IconLoader2, IconMinus, IconX } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { i18n } from "#imports"
import { clearQuoteHighlight, highlightQuoteOnPage } from "@/utils/job-match/highlight"
import { getCardLayout, setCardLayout } from "@/utils/job-match/storage"
import { cn } from "@/utils/styles/utils"
import { matchStateAtom } from "../atoms"
import { useFloatingCard } from "./use-floating-card"

const VERDICT_LABEL_KEY = {
  recommend: "jobMatch.verdict.recommend",
  maybe: "jobMatch.verdict.maybe",
  skip: "jobMatch.verdict.skip",
} as const

const VERDICT_META: Record<Verdict, { emoji: string, badge: string }> = {
  recommend: {
    emoji: "🟢",
    badge: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  maybe: {
    emoji: "🟡",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  skip: {
    emoji: "🔴",
    badge: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
}

/** 把"其他要求"按来源板块分组，保留板块首次出现的顺序。 */
function groupBySection(items: ImplicitRequirement[]): { section: string, items: ImplicitRequirement[] }[] {
  const groups: { section: string, items: ImplicitRequirement[] }[] = []
  for (const item of items) {
    const key = item.section || ""
    let group = groups.find(g => g.section === key)
    if (!group) {
      group = { section: key, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

function MetIcon({ met }: { met: RequirementMatch["met"] }) {
  if (met === "yes")
    return <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" strokeWidth={3} />
  if (met === "no")
    return <IconX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={3} />
  return <IconMinus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={3} />
}

function RequirementRow({ req }: { req: RequirementMatch }) {
  return (
    <div className="flex items-start gap-1.5 text-[13px]">
      <MetIcon met={req.met} />
      <div className="min-w-0">
        <span>
          {req.text}
          {req.veto && req.met === "no" && (
            <span className="ml-1 inline-block rounded-sm bg-red-100 px-1 py-px align-middle text-[10px] font-semibold text-red-600 dark:bg-red-900 dark:text-red-300">
              {i18n.t("jobMatch.card.vetoBadge")}
            </span>
          )}
        </span>
        {req.note && (
          <span className="block text-[11px] leading-snug text-neutral-400">{req.note}</span>
        )}
        {req.met === "unclear" && req.unclearReason === "ambiguous" && (
          <span className="mt-0.5 block text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            ✎
            {" "}
            {i18n.t("jobMatch.card.ambiguousHint")}
          </span>
        )}
        {req.met === "unclear" && req.unclearReason !== "ambiguous" && (
          <span className="mt-0.5 block text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            ✎
            {" "}
            {i18n.t("jobMatch.card.resumeGapHint")}
          </span>
        )}
      </div>
    </div>
  )
}

function ResultView({ result, cardRef }: { result: MatchResult, cardRef: RefObject<HTMLDivElement | null> }) {
  const meta = VERDICT_META[result.verdict]
  const musts = result.requirements.filter(r => r.type === "must")
  const nices = result.requirements.filter(r => r.type === "nice")
  const mustMet = musts.filter(r => r.met === "yes").length
  const niceMet = nices.filter(r => r.met === "yes").length

  // 当前在网页上高亮定位的那条"其他要求"（用 quote 作标识）
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null)
  // 点了但没能在页面里定位到的那条
  const [failedQuote, setFailedQuote] = useState<string | null>(null)

  // 换了一次分析结果，或卡片卸载时，清掉页面上的高亮
  useEffect(() => {
    setSelectedQuote(null)
    setFailedQuote(null)
    clearQuoteHighlight()
    return () => clearQuoteHighlight()
  }, [result])

  // 点到卡片以外的地方（比如页面上弹出的 Apply 对话框）：高亮已经不相关了，主动清掉，
  // 避免残留的高亮块层级过高，穿模盖在后弹出的页面对话框上。
  // 用整个悬浮卡片（含拖动条/缩放手柄）判断"是否在卡片外"，避免拖动卡片本身也被误判成"点到外面"。
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        clearQuoteHighlight()
        setSelectedQuote(null)
        setFailedQuote(null)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [cardRef])

  const handleImplicitClick = (item: ImplicitRequirement) => {
    // 再点一次同一条 → 取消高亮
    if (selectedQuote === item.quote) {
      clearQuoteHighlight()
      setSelectedQuote(null)
      return
    }
    // 直接在实时网页里找；找到就高亮+滚动，找不到就提示
    const ok = highlightQuoteOnPage(item.quote)
    setSelectedQuote(ok ? item.quote : null)
    setFailedQuote(ok ? null : item.quote)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${meta.badge}`}>
          {meta.emoji}
          {" "}
          {i18n.t(VERDICT_LABEL_KEY[result.verdict])}
        </span>
        {result.requirements.length > 0 && (
          <span className="ml-auto text-xs text-neutral-500">
            {musts.length > 0 && `${i18n.t("jobMatch.card.required")} ${mustMet}/${musts.length}`}
            {nices.length > 0 && `${musts.length > 0 ? " · " : ""}${i18n.t("jobMatch.card.preferred")} ${niceMet}/${nices.length}`}
          </span>
        )}
      </div>

      <p className="rounded-md bg-neutral-100 p-2 text-[13px] leading-relaxed dark:bg-neutral-800">
        💡 {result.recommendation}
      </p>

      {(result.workMode || result.salary) && (
        <p className="text-[12px] leading-snug text-neutral-500 dark:text-neutral-400">
          {result.workMode && (
            <span>
              📍
              {" "}
              {i18n.t(`jobMatch.card.workMode.${result.workMode}`)}
            </span>
          )}
          {result.workMode && result.salary && " · "}
          {result.salary && (
            <span>
              💰
              {" "}
              {result.salary}
            </span>
          )}
        </p>
      )}

      {result.flexible && (
        <p className="rounded-md border border-red-400 bg-red-50 p-2 text-[13px] font-semibold leading-relaxed text-red-600 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
          {i18n.t("jobMatch.card.flexibleNote")}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {musts.length > 0 && (
          <>
            <span className="text-xs font-semibold text-neutral-500">{i18n.t("jobMatch.card.requiredSection")}</span>
            {musts.map(req => (
              <RequirementRow key={`must-${req.text}`} req={req} />
            ))}
          </>
        )}

        {nices.length > 0 && (
          <>
            {musts.length > 0 && <div className="my-1.5 border-t border-neutral-200 dark:border-neutral-700" />}
            <span className="text-xs font-semibold text-neutral-500">{i18n.t("jobMatch.card.preferredSection")}</span>
            {nices.map(req => (
              <RequirementRow key={`nice-${req.text}`} req={req} />
            ))}
          </>
        )}

        {result.softRequirements.length > 0 && (
          <>
            <div className="my-1.5 border-t border-dashed border-neutral-300 dark:border-neutral-700" />
            <span className="text-xs font-semibold text-neutral-400">{i18n.t("jobMatch.card.softSection")}</span>
            {result.softRequirements.map(text => (
              <div key={`soft-${text}`} className="text-[12px] leading-snug text-neutral-400">
                ·
                {" "}
                {text}
              </div>
            ))}
          </>
        )}

        {result.implicit.length > 0 && (
          <>
            <div className="my-1.5 border-t border-neutral-200 dark:border-neutral-700" />
            <span className="text-xs font-semibold text-indigo-500 dark:text-indigo-400">
              🔍 {i18n.t("jobMatch.card.implicitSection")}
            </span>
            {groupBySection(result.implicit).map(group => (
              <div key={group.section || "_"} className="mt-1">
                {group.section && (
                  <div className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    {i18n.t("jobMatch.card.inSection", [group.section])}
                  </div>
                )}
                {group.items.map(item => (
                  <div
                    key={`implicit-${item.quote}`}
                    role="button"
                    tabIndex={0}
                    title={i18n.t("jobMatch.card.locateHint")}
                    onClick={() => handleImplicitClick(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleImplicitClick(item)
                      }
                    }}
                    className={cn(
                      "mt-0.5 flex items-start gap-1.5 rounded-md px-1 py-0.5 text-[13px] cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800",
                      selectedQuote === item.quote && "bg-neutral-200 dark:bg-neutral-700",
                    )}
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <div className="min-w-0">
                      <span>
                        {item.text}
                        <span className="ml-1 align-middle text-[10px] text-indigo-400">📍</span>
                      </span>
                      {item.why && (
                        <span className="block text-[11px] leading-snug text-neutral-400">{item.why}</span>
                      )}
                      <span className="mt-0.5 block border-l-2 border-neutral-200 pl-1.5 text-[11px] italic leading-snug text-neutral-400 dark:border-neutral-700">
                        “{item.quote}”
                      </span>
                      {failedQuote === item.quote && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-red-500 dark:text-red-400">
                          {i18n.t("jobMatch.card.locateFailed")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

const MIN_W = 260
const MIN_H = 160

/** 页面上的匹配判断卡：标题栏可拖动、右下角可缩放、布局记忆到本地；默认右上角。 */
export default function MatchCard() {
  const [state, setState] = useAtom(matchStateAtom)
  const { cardRef, pos, size, onDragStart, onDragMove, onDragEnd, onResizeStart, onResizeMove, onResizeEnd }
    = useFloatingCard({ getLayout: getCardLayout, setLayout: setCardLayout, minWidth: MIN_W, minHeight: MIN_H })

  if (state.status === "idle")
    return null

  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed z-[2147483647] flex flex-col rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
        pos ? "" : "right-4 top-6",
      )}
      style={{
        width: size?.w ?? 320,
        height: size?.h,
        ...(pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : {}),
      }}
    >
      <div
        className="mb-2 flex flex-none cursor-move touch-none items-center justify-between select-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className="text-sm font-semibold">{i18n.t("jobMatch.card.title")}</span>
        <button
          type="button"
          aria-label={i18n.t("jobMatch.card.close")}
          className="cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
          onClick={() => setState({ status: "idle" })}
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      <div className={cn("min-h-0 flex-1", size ? "overflow-y-auto" : "max-h-[70vh] overflow-y-auto")}>
        {state.status === "loading" && (
          <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            {i18n.t("jobMatch.card.loading")}
          </div>
        )}

        {state.status === "error" && (
          <p className="py-1 text-[13px] leading-relaxed text-red-600 dark:text-red-400">
            {state.message}
          </p>
        )}

        {state.status === "done" && <ResultView result={state.result} cardRef={cardRef} />}
      </div>

      {/* 右下角缩放手柄 */}
      <div
        className="absolute right-0.5 bottom-0.5 h-3.5 w-3.5 cursor-se-resize touch-none"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      >
        <svg viewBox="0 0 10 10" className="h-full w-full text-neutral-400">
          <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>
    </div>
  )
}

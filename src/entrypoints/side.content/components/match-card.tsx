import type { MatchResult, RequirementMatch, Verdict } from "@/utils/job-match/analyze"
import { IconCheck, IconLoader2, IconMinus, IconX } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { useRef, useState } from "react"
import { cn } from "@/utils/styles/utils"
import { matchStateAtom } from "../atoms"

const VERDICT_META: Record<Verdict, { emoji: string, label: string, badge: string }> = {
  recommend: {
    emoji: "🟢",
    label: "值得投",
    badge: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  maybe: {
    emoji: "🟡",
    label: "可考虑",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  skip: {
    emoji: "🔴",
    label: "不建议投",
    badge: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
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
        <span>{req.text}</span>
        {req.note && (
          <span className="block text-[11px] leading-snug text-neutral-400">{req.note}</span>
        )}
      </div>
    </div>
  )
}

function ResultView({ result }: { result: MatchResult }) {
  const meta = VERDICT_META[result.verdict]
  const musts = result.requirements.filter(r => r.type === "must")
  const nices = result.requirements.filter(r => r.type === "nice")
  const mustMet = musts.filter(r => r.met === "yes").length
  const niceMet = nices.filter(r => r.met === "yes").length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${meta.badge}`}>
          {meta.emoji} {meta.label}
        </span>
        {result.requirements.length > 0 && (
          <span className="ml-auto text-xs text-neutral-500">
            {musts.length > 0 && `必须 ${mustMet}/${musts.length}`}
            {nices.length > 0 && `${musts.length > 0 ? " · " : ""}加分 ${niceMet}/${nices.length}`}
          </span>
        )}
      </div>

      <p className="rounded-md bg-neutral-100 p-2 text-[13px] leading-relaxed dark:bg-neutral-800">
        💡 {result.recommendation}
      </p>

      {result.flexible && (
        <p className="rounded-md border border-red-400 bg-red-50 p-2 text-[13px] font-semibold leading-relaxed text-red-600 dark:border-red-700 dark:bg-red-950 dark:text-red-400">
          ✱ 招聘方说明：不必满足全部要求，方向契合也欢迎投递
        </p>
      )}

      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {musts.length > 0 && (
          <>
            <span className="text-xs font-semibold text-neutral-500">必须要求</span>
            {musts.map(req => (
              <RequirementRow key={`must-${req.text}`} req={req} />
            ))}
          </>
        )}

        {nices.length > 0 && (
          <>
            {musts.length > 0 && <div className="my-1.5 border-t border-neutral-200 dark:border-neutral-700" />}
            <span className="text-xs font-semibold text-neutral-500">加分项</span>
            {nices.map(req => (
              <RequirementRow key={`nice-${req.text}`} req={req} />
            ))}
          </>
        )}

        {result.softRequirements.length > 0 && (
          <>
            <div className="my-1.5 border-t border-dashed border-neutral-300 dark:border-neutral-700" />
            <span className="text-xs font-semibold text-neutral-400">软性要求（招聘方提到，未计入评分）</span>
            {result.softRequirements.map(text => (
              <div key={`soft-${text}`} className="text-[12px] leading-snug text-neutral-400">
                ·
                {" "}
                {text}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** 页面上的匹配判断卡，顶部标题栏可拖动；默认在顶部居中。 */
export default function MatchCard() {
  const [state, setState] = useAtom(matchStateAtom)
  // null = 未拖动过（用居中样式）；否则用绝对像素坐标
  const [pos, setPos] = useState<{ x: number, y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number, startY: number, originX: number, originY: number } | null>(null)

  if (state.status === "idle")
    return null

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 点关闭按钮时不触发拖动
    if ((e.target as HTMLElement).closest("button"))
      return
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect)
      return
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag)
      return
    const rect = cardRef.current?.getBoundingClientRect()
    const w = rect?.width ?? 320
    const h = rect?.height ?? 80
    setPos({
      x: clamp(drag.originX + (e.clientX - drag.startX), 0, window.innerWidth - w),
      y: clamp(drag.originY + (e.clientY - drag.startY), 0, window.innerHeight - h),
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed z-[2147483647] w-[320px] rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
        pos ? "" : "left-1/2 top-6 -translate-x-1/2",
      )}
      style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : undefined}
    >
      <div
        className="mb-2 flex cursor-move touch-none items-center justify-between select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="text-sm font-semibold">职位匹配度</span>
        <button
          type="button"
          aria-label="关闭"
          className="cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
          onClick={() => setState({ status: "idle" })}
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      {state.status === "loading" && (
        <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
          <IconLoader2 className="h-4 w-4 animate-spin" />
          正在读取职位要求并比对你的简历…
        </div>
      )}

      {state.status === "error" && (
        <p className="py-1 text-[13px] leading-relaxed text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      {state.status === "done" && <ResultView result={state.result} />}
    </div>
  )
}

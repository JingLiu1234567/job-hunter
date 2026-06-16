import type { MatchResult, RequirementMatch, Verdict } from "@/utils/job-match/analyze"
import { IconCheck, IconLoader2, IconMinus, IconX } from "@tabler/icons-react"
import { useAtom } from "jotai"
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
        <span
          className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-medium ${
            req.type === "must"
              ? "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          }`}
        >
          {req.type === "must" ? "必须" : "加分"}
        </span>
        {req.note && (
          <span className="block text-[11px] leading-snug text-neutral-400">{req.note}</span>
        )}
      </div>
    </div>
  )
}

function ResultView({ result }: { result: MatchResult }) {
  const meta = VERDICT_META[result.verdict]
  const metCount = result.requirements.filter(r => r.met === "yes").length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${meta.badge}`}>
          {meta.emoji} {meta.label}
        </span>
        <span className="ml-auto text-xs text-neutral-500">
          匹配 {metCount}/{result.requirements.length} 条
        </span>
      </div>

      <p className="rounded-md bg-neutral-100 p-2 text-[13px] leading-relaxed dark:bg-neutral-800">
        💡 {result.recommendation}
      </p>

      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {result.requirements.map(req => (
          <RequirementRow key={`${req.type}-${req.text}`} req={req} />
        ))}
      </div>
    </div>
  )
}

/** 页面上的匹配判断卡，固定在顶部居中。 */
export default function MatchCard() {
  const [state, setState] = useAtom(matchStateAtom)

  if (state.status === "idle")
    return null

  return (
    <div className="fixed left-1/2 top-6 z-[2147483647] w-[320px] -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
      <div className="mb-2 flex items-center justify-between">
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

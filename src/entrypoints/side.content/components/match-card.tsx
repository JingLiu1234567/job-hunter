import type { MatchResult } from "@/utils/job-match/analyze"
import { IconAlertTriangle, IconCheck, IconLoader2, IconX } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { matchStateAtom } from "../atoms"

function scoreColorClass(score: number): string {
  if (score >= 75)
    return "text-green-600 dark:text-green-400"
  if (score >= 50)
    return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

function verdictBadgeClass(score: number): string {
  if (score >= 75)
    return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
  if (score >= 50)
    return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
  return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
}

function ResultView({ result }: { result: MatchResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${scoreColorClass(result.score)}`}>
          {result.score}
        </span>
        <span className="text-sm text-neutral-500">分</span>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictBadgeClass(result.score)}`}>
          {result.verdict}
        </span>
      </div>

      {result.matched.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">你符合</span>
          {result.matched.map(item => (
            <div key={item} className="flex items-start gap-1.5 text-[13px]">
              <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" strokeWidth={3} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {result.gaps.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">你欠缺</span>
          {result.gaps.map(item => (
            <div key={item} className="flex items-start gap-1.5 text-[13px]">
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2.5} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {result.summary && (
        <p className="rounded-md bg-neutral-100 p-2 text-[13px] leading-relaxed dark:bg-neutral-800">
          💡 {result.summary}
        </p>
      )}
    </div>
  )
}

/** 页面上的极简匹配判断卡，固定在顶部居中。 */
export default function MatchCard() {
  const [state, setState] = useAtom(matchStateAtom)

  if (state.status === "idle")
    return null

  return (
    <div className="fixed left-1/2 top-6 z-[2147483647] w-[300px] -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
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
          正在分析简历与这份职位的匹配度…
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

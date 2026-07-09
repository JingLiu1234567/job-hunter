import type { FloatingButtonSide } from "@/types/config/floating-button"
import { IconTargetArrow } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { analyzeMatch } from "@/utils/job-match/analyze"
import { extractJD, extractJobMeta } from "@/utils/job-match/extract-jd"
import { getResume } from "@/utils/job-match/storage"
import { cn } from "@/utils/styles/utils"
import { matchStateAtom } from "../../atoms"
import HiddenButton from "./components/hidden-button"

/**
 * 悬浮球上的「匹配打分」按钮：抓取当前页面 JD → 读本地简历 → 调 LLM 打分。
 * 结果写入 matchStateAtom，由 MatchCard 显示。
 */
export default function MatchButton({
  side = "right",
  expanded = false,
}: {
  side?: FloatingButtonSide
  expanded?: boolean
}) {
  const [matchState, setMatchState] = useAtom(matchStateAtom)
  const isLoading = matchState.status === "loading"

  const handleClick = async () => {
    if (isLoading)
      return

    setMatchState({ status: "loading" })
    try {
      const resume = await getResume()
      const jd = extractJD()
      const jobMeta = extractJobMeta(jd)
      const result = await analyzeMatch(resume, jd)
      setMatchState({ status: "done", result: { ...result, ...jobMeta } })
    }
    catch (error) {
      setMatchState({
        status: "error",
        message: error instanceof Error ? error.message : "分析失败，请重试",
      })
    }
  }

  return (
    <HiddenButton
      icon={<IconTargetArrow className={cn("h-5 w-5", isLoading && "animate-pulse")} />}
      side={side}
      expanded={expanded}
      onClick={() => void handleClick()}
    />
  )
}

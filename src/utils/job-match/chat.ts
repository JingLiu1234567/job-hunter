import type { JSONValue } from "ai"
import type { MatchResult } from "@/utils/job-match/analyze"
import { i18n } from "#imports"
import { streamBackgroundText } from "@/utils/content-script/background-stream-client"
import { outputLanguageName } from "@/utils/job-match/analyze"
import { pickLLMProviderId } from "@/utils/job-match/provider"

export interface ChatTurnMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatContext {
  jd: string
  resume: string
  /** 当前页面已有的匹配度分析结果，没跑过分析就是 null——聊天照样能用，只是少一块背景信息。 */
  matchResult: MatchResult | null
}

/** 把匹配度结果压缩成给 LLM 看的摘要，不需要 UI 那些展示细节。 */
function summarizeMatchResult(result: MatchResult): string {
  const lines: string[] = [`总体判定：${result.verdict}——${result.recommendation}`]
  for (const req of result.requirements) {
    const label = req.type === "must" ? "必须" : "加分"
    lines.push(`- [${label}] ${req.text} → ${req.met}${req.note ? `（${req.note}）` : ""}`)
  }
  if (result.implicit.length > 0) {
    lines.push("其他隐性要求：")
    for (const item of result.implicit) {
      lines.push(`- ${item.text}`)
    }
  }
  return lines.join("\n")
}

function buildSystemPrompt(context: ChatContext): string {
  const lang = outputLanguageName()
  const parts = [
    `你是一个求职助手，帮用户理解和讨论他当前正在看的这个职位、以及简历与这个职位的匹配情况。用「${lang}」回答，简洁、诚实，不夸大、不讨好；没有把握的地方要说清楚"不确定"，不要瞎编。`,
  ]
  if (context.jd.trim())
    parts.push(`【职位描述 JD】\n${context.jd}`)
  if (context.resume.trim())
    parts.push(`【候选人简历】\n${context.resume}`)
  if (context.matchResult)
    parts.push(`【已有的匹配度分析结果】\n${summarizeMatchResult(context.matchResult)}`)
  return parts.join("\n\n")
}

/**
 * 流式调 LLM 回一条聊天消息。`history` 是包含这次用户新消息在内的完整对话历史。
 * 用同一套 job-match 的 provider 选择逻辑，找不到可用的 LLM 就直接抛错。
 */
export async function streamChatReply(
  context: ChatContext,
  history: ChatTurnMessage[],
  options: { signal?: AbortSignal, onChunk?: (text: string) => void },
): Promise<string> {
  const providerId = await pickLLMProviderId()
  if (!providerId) {
    throw new Error(i18n.t("jobMatch.error.noLlm"))
  }

  const system = buildSystemPrompt(context)
  const result = await streamBackgroundText(
    {
      providerId,
      system,
      messages: history as unknown as JSONValue[],
    },
    {
      signal: options.signal,
      onChunk: snapshot => options.onChunk?.(snapshot.output),
    },
  )
  return result.output
}

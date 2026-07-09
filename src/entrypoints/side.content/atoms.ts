import type { MatchResult } from "@/utils/job-match/analyze"
import { atom, createStore } from "jotai"
import { createTranslationStateAtomForContentScript } from "@/utils/atoms/translation-state"

export const store = createStore()

export const isSideOpenAtom = atom(false)

export const isDraggingButtonAtom = atom(false)

/** 简历×JD 匹配分析的状态，按钮写、结果卡读。 */
export type MatchState
  = | { status: "idle" }
    | { status: "loading" }
    | { status: "done", result: MatchResult }
    | { status: "error", message: string }

export const matchStateAtom = atom<MatchState>({ status: "idle" })

export const enablePageTranslationAtom = createTranslationStateAtomForContentScript(
  { enabled: false },
)

/** 跟 LLM 聊天面板的单条消息。 */
export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

/** 聊天面板是否打开——跟匹配度卡片的开关状态完全独立，两个面板可以同时显示。 */
export const isChatOpenAtom = atom(false)

/** 聊天历史，只留在内存里；关掉插件面板/刷新页面/换页不会保留（有意为之，先做简单的）。 */
export const chatMessagesAtom = atom<ChatMessage[]>([])

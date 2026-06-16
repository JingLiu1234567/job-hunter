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

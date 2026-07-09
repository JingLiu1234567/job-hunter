import type { ChatMessage } from "../atoms"
import { IconLoader2, IconSend2, IconX } from "@tabler/icons-react"
import { useAtom, useAtomValue } from "jotai"
import { useEffect, useRef, useState } from "react"
import { i18n } from "#imports"
import { streamChatReply } from "@/utils/job-match/chat"
import { extractJD } from "@/utils/job-match/extract-jd"
import { pickLLMProvider } from "@/utils/job-match/provider"
import { getChatLayout, getResume, setChatLayout } from "@/utils/job-match/storage"
import { cn } from "@/utils/styles/utils"
import { chatMessagesAtom, isChatOpenAtom, matchStateAtom } from "../atoms"
import { useFloatingCard } from "./use-floating-card"

const MIN_W = 280
const MIN_H = 220
// 输入框最多长到这么高，再多就滚动，避免把消息列表挤没了
const MAX_TEXTAREA_HEIGHT = 120

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 悬浮的 AI 聊天面板：能看到当前 JD、简历、以及已有的匹配度分析结果作为背景，
 * 跟匹配度卡片各自独立开关、独立记忆位置，可以同时显示在页面上。
 */
export default function ChatPanel() {
  const [isOpen, setIsOpen] = useAtom(isChatOpenAtom)
  const [messages, setMessages] = useAtom(chatMessagesAtom)
  const matchState = useAtomValue(matchStateAtom)
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 用户在设置里给当前 LLM 起的名字（如 "Claude"），标题上指名道姓；拿到之前先用通用文案兜底
  const [providerName, setProviderName] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { cardRef, pos, size, onDragStart, onDragMove, onDragEnd, onResizeStart, onResizeMove, onResizeEnd }
    = useFloatingCard({ getLayout: getChatLayout, setLayout: setChatLayout, minWidth: MIN_W, minHeight: MIN_H })

  useEffect(() => {
    void pickLLMProvider().then(p => setProviderName(p?.name ?? null))
  }, [])

  // 新消息/流式更新时滚到底部
  useEffect(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current)
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }, [messages])

  // 面板关掉时，如果正在生成，直接中断
  useEffect(() => {
    if (!isOpen)
      abortRef.current?.abort()
  }, [isOpen])

  // 输入框跟着内容变高（有上限，超过就滚动），而不是固定一行高度把文字挤在里面
  useEffect(() => {
    const el = textareaRef.current
    if (!el)
      return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [input])

  if (!isOpen)
    return null

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || isStreaming)
      return
    if (overrideText == null)
      setInput("")
    setError(null)

    const userMessage: ChatMessage = { id: createMessageId(), role: "user", content: text }
    const assistantId = createMessageId()
    const history = [...messages, userMessage]
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }])

    const abortController = new AbortController()
    abortRef.current = abortController
    setIsStreaming(true)

    try {
      const jd = extractJD()
      const resume = await getResume()
      const matchResult = matchState.status === "done" ? matchState.result : null

      await streamChatReply(
        { jd, resume, matchResult },
        history.map(({ role, content }) => ({ role, content })),
        {
          signal: abortController.signal,
          onChunk: (chunkText) => {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: chunkText } : m))
          },
        },
      )
    }
    catch (err) {
      if (err instanceof DOMException && err.name === "AbortError")
        return
      setError(err instanceof Error ? err.message : i18n.t("jobMatch.chat.error"))
      setMessages(prev => prev.filter(m => m.id !== assistantId))
    }
    finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed z-[2147483647] flex flex-col rounded-xl border border-neutral-200 bg-white p-4 text-neutral-800 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
        pos ? "" : "right-4 bottom-6",
      )}
      style={{
        width: size?.w ?? 320,
        height: size?.h ?? 420,
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
        <span className="text-sm font-semibold">
          {providerName ? i18n.t("jobMatch.chat.titleWithProvider", [providerName]) : i18n.t("jobMatch.chat.title")}
        </span>
        <button
          type="button"
          aria-label={i18n.t("jobMatch.card.close")}
          className="cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
          onClick={() => setIsOpen(false)}
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-[12px] leading-relaxed text-neutral-400">
            {i18n.t("jobMatch.chat.placeholder")}
          </p>
        )}
        {messages.map(m => (
          <div
            key={m.id}
            className={cn(
              "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap",
              m.role === "user"
                ? "self-end bg-blue-500 text-white"
                : "self-start bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100",
            )}
          >
            {m.content || (isStreaming && m.role === "assistant" ? "…" : "")}
          </div>
        ))}
        {error && (
          <p className="text-[12px] leading-relaxed text-red-500 dark:text-red-400">{error}</p>
        )}
      </div>

      <div className="mt-2 flex flex-none flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void handleSend(i18n.t("jobMatch.chat.coverLetterPrompt"))}
          disabled={isStreaming}
          className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {i18n.t("jobMatch.chat.coverLetterAction")}
        </button>
      </div>

      <div className="mt-1.5 flex flex-none items-end gap-1.5">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          rows={1}
          placeholder={i18n.t("jobMatch.chat.inputPlaceholder")}
          className="min-h-8 flex-1 resize-none overflow-y-auto rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-neutral-400 dark:border-neutral-700"
          style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
        />
        {isStreaming
          ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label={i18n.t("jobMatch.chat.stop")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-200 text-neutral-600 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200"
              >
                <IconLoader2 className="h-4 w-4 animate-spin" />
              </button>
            )
          : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim()}
                aria-label={i18n.t("jobMatch.chat.send")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500 text-white disabled:opacity-40"
              >
                <IconSend2 className="h-4 w-4" />
              </button>
            )}
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

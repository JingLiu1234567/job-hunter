import type { FloatingButtonSide } from "@/types/config/floating-button"
import { IconMessageCircle } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { isChatOpenAtom } from "../../atoms"
import HiddenButton from "./components/hidden-button"

/**
 * 悬浮球上的「AI 聊天」按钮：开关聊天面板，跟匹配度按钮各自独立、可以同时打开。
 */
export default function ChatButton({
  side = "right",
  expanded = false,
}: {
  side?: FloatingButtonSide
  expanded?: boolean
}) {
  const [isOpen, setIsOpen] = useAtom(isChatOpenAtom)

  return (
    <HiddenButton
      icon={<IconMessageCircle className="h-5 w-5" />}
      side={side}
      expanded={expanded}
      onClick={() => setIsOpen(!isOpen)}
    />
  )
}

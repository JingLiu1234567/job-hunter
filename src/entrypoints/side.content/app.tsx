import FrogToast from "@/components/frog-toast"
import ChatPanel from "./components/chat-panel"
import FloatingButton from "./components/floating-button"
import MatchCard from "./components/match-card"

export default function App() {
  return (
    <>
      <FloatingButton />
      <MatchCard />
      <ChatPanel />
      <FrogToast />
    </>
  )
}

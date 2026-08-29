import { useState } from "react";
import LiveNotionEditor from "./components/LiveNotionEditor";
import VoiceToMermaid from "./components/VoiceToMermaid";

function App() {
  const [mode, setMode] = useState<"live" | "voice">("voice");
  return (
    <div>
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-black/80 backdrop-blur border border-white/10 rounded-full p-1 flex gap-1 text-sm">
        <button
          onClick={() => setMode("voice")}
          className={`px-4 py-1.5 rounded-full font-semibold ${mode === "voice" ? "bg-white text-black" : "text-white hover:bg-white/10"}`}
        >
          Voice → Mermaid (Test)
        </button>
        <button
          onClick={() => setMode("live")}
          className={`px-4 py-1.5 rounded-full font-semibold ${mode === "live" ? "bg-white text-black" : "text-white hover:bg-white/10"}`}
        >
          Live Notion
        </button>
      </div>
      {mode === "voice" ? <VoiceToMermaid /> : <LiveNotionEditor />}
    </div>
  );
}

export default App;

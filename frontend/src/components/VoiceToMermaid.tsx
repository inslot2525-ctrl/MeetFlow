import { useState, useRef, useEffect } from "react";
import mermaid from "mermaid";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

type Task = { task_description: string; owner?: string | null; deadline?: string | null; depends_on?: string | null };

export default function VoiceToMermaid() {
  const [transcript, setTranscript] = useState("");
  const [inputText, setInputText] = useState(
    "Rahul, can you set up the AWS account by Wednesday?\nOnce Rahul is done, Priya needs to connect the FastAPI.\nWe've decided to go with AWS over Azure."
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mermaidCode, setMermaidCode] = useState("graph TD\n Start[Meeting Started]");
  const [summary, setSummary] = useState("");
  const [segments, setSegments] = useState<any[]>([]);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mermaidRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
  }, []);

  useEffect(() => {
    if (!mermaidRef.current) return;
    const render = async () => {
      try {
        const id = `m2-${Date.now()}`;
        const { svg } = await mermaid.render(id, mermaidCode);
        if (mermaidRef.current) mermaidRef.current.innerHTML = svg;
      } catch (e) {
        if (mermaidRef.current) mermaidRef.current.textContent = mermaidCode;
        console.error(e);
      }
    };
    render();
  }, [mermaidCode]);

  const callVoiceToMermaid = async (opts: { text?: string; file?: File | Blob; filename?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      if (opts.text) form.append("text", opts.text);
      if (opts.file) form.append("file", opts.file, opts.filename || "recording.webm");
      const res = await fetch(`${API_BASE}/api/voice-to-mermaid`, { method: "POST", body: form });
      const data = await res.json();
      if (data.error && !data.transcript) {
        setError(data.error);
        return;
      }
      setTranscript(data.transcript || "");
      setTasks(data.tasks || []);
      setMermaidCode(data.mermaid || "graph TD\n Start[Meeting Started]");
      setSummary(data.summary || "");
      setSegments(data.segments || []);
      if (data.error) setError(data.error);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = () => {
    if (!inputText.trim()) return;
    callVoiceToMermaid({ text: inputText });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) callVoiceToMermaid({ file, filename: file.name });
  };

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        // Try browser Web Speech fallback + backend whisper
        // First send to backend; if it fails, use browser transcript if we have it
        await callVoiceToMermaid({ file: blob, filename: "recording.webm" });
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (e: any) {
      setError("Microphone permission denied or not available: " + String(e?.message || e));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-gradient-to-br from-[#0a0a0a] via-[#111827] to-[#0f172a] text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Voice → Transcript → Tasks → Mermaid</h1>
            <p className="text-sm text-gray-400 mt-1">Quick validation pipeline — record or paste text, verify summary + person-tasks + diagram before live meeting mode.</p>
          </div>
          <div className="text-xs text-gray-500">API: {API_BASE}</div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Left: Input */}
          <div className="col-span-12 lg:col-span-5 space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="font-semibold mb-3">1 — Record / Upload / Paste</h2>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={toggleRecording}
                  className={`px-5 py-2.5 rounded-full font-semibold border ${recording ? "bg-red-500 text-white border-red-500 animate-pulse" : "bg-white text-black border-white"}`}
                >
                  {recording ? "● Stop Recording" : "◎ Record Voice"}
                </button>
                <label className="px-4 py-2.5 rounded-full bg-white/10 border border-white/10 cursor-pointer hover:bg-white/20 text-sm">
                  Upload audio
                  <input type="file" accept="audio/*,.wav,.mp3,.webm,.m4a" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={7}
                placeholder="Paste transcript or meeting notes here... e.g. Rahul, set up AWS by Wednesday"
                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm outline-none focus:border-cyan-500/50"
              />
              <div className="flex gap-2 mt-3">
                <button onClick={handleTextSubmit} disabled={loading} className="flex-1 bg-cyan-500 text-black font-semibold py-2.5 rounded-full disabled:opacity-50">
                  {loading ? "Processing..." : "Generate →"}
                </button>
                <button onClick={() => setInputText("")} className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm">Clear</button>
              </div>
              {error && <div className="mt-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">{error}</div>}
              <p className="text-[11px] text-gray-500 mt-2">Tip: try the prefilled sample, then swap to your own voice recording.</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="font-semibold mb-2">Transcript</h3>
              <div className="bg-black/40 rounded-xl p-3 text-sm whitespace-pre-wrap min-h-[80px] border border-white/5">{transcript || <span className="text-gray-500">No transcript yet — record or click Generate.</span>}</div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="font-semibold mb-2">Segments (bouncer labels)</h3>
              <div className="space-y-1.5 max-h-[220px] overflow-auto">
                {segments.length === 0 ? (
                  <div className="text-xs text-gray-500">—</div>
                ) : (
                  segments.map((s, i) => (
                    <div key={i} className="text-xs flex gap-2 bg-black/30 rounded-lg px-2 py-1.5">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${s.label === "ACTION_ITEM" ? "bg-cyan-500/20 text-cyan-300" : s.label === "DECISION" ? "bg-purple-500/20 text-purple-300" : "bg-white/10 text-gray-400"}`}>{s.label}</span>
                      <span className="text-gray-300"><b>{s.speaker}:</b> {s.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Outputs */}
          <div className="col-span-12 lg:col-span-7 space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="font-semibold mb-3">2 — Meeting Summary</h2>
              <div className="bg-[#191919] rounded-xl p-4 text-sm whitespace-pre-wrap border border-white/10 min-h-[80px]">{summary || <span className="text-gray-500">Summary will appear after generation.</span>}</div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="font-semibold mb-3">3 — Person → Task Table</h2>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 border-b border-white/10">
                    <tr><th className="text-left py-2 px-2">Person</th><th className="text-left py-2">Task</th><th className="text-left py-2">Deadline</th><th className="text-left py-2">Depends on</th></tr>
                  </thead>
                  <tbody>
                    {tasks.length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-gray-500 py-6 text-xs">No tasks yet.</td></tr>
                    ) : (
                      tasks.map((t, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-2 px-2"><span className="bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded-full text-xs">@{t.owner || "Unassigned"}</span></td>
                          <td className="py-2">{t.task_description}</td>
                          <td className="py-2 text-gray-400">{t.deadline || "—"}</td>
                          <td className="py-2 text-gray-400">{t.depends_on || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="font-semibold mb-3">4 — Mermaid Flowchart</h2>
              <div ref={mermaidRef} className="bg-black/40 rounded-xl p-4 flex justify-center min-h-[160px] border border-white/5 overflow-auto" />
              <details className="mt-3">
                <summary className="text-xs text-gray-400 cursor-pointer">Show Mermaid code</summary>
                <pre className="mt-2 text-[11px] bg-black/40 rounded-lg p-3 whitespace-pre-wrap text-gray-300 border border-white/5">{mermaidCode}</pre>
              </details>
              <button
                onClick={() => navigator.clipboard.writeText(mermaidCode)}
                className="mt-2 text-xs bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 rounded-full"
              >
                Copy Mermaid
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

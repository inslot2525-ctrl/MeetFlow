"use client";

import { useState, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import mermaid from "mermaid";
import { VoicePoweredOrb } from "./VoicePoweredOrb";
import { DarkGradientBg } from "./DarkGradientBg";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

type Task = { task_description: string; owner?: string | null; deadline?: string | null };

export default function LiveNotionEditor() {
  const [diagramCode, setDiagramCode] = useState<string>("graph TD\n Start[Meeting Started]");
  const diagramRef = useRef(diagramCode);
  const [currentTasks, setCurrentTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);
const [liveText, setLiveText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [transcriptFeed, setTranscriptFeed] = useState<{ text: string; ts: string }[]>([]);
  const [liveMode, setLiveMode] = useState<"transcript" | "full">("transcript");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { diagramRef.current = diagramCode; }, [diagramCode]);
  useEffect(() => { tasksRef.current = currentTasks; }, [currentTasks]);
  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [transcriptFeed, interimTranscript]);

  // Cleanup mic stream on unmount or when listening stops
  useEffect(() => {
    return () => {
      micStream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!isListening && micStream) {
      micStream.getTracks().forEach(t => t.stop());
      setMicStream(null);
    }
  }, [isListening]);

  const editor = useEditor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
    content: `<h1>Product Sync</h1><p style="color:#9ca3af"><em>Transcript will appear below as you speak. Tasks & roadmap update only in Full mode.</em></p>`,
    editorProps: {
      attributes: {
        class: "tiptap max-w-none focus:outline-none min-h-[280px] text-left",
      },
    },
  });

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose", fontSize: 13 });
  }, []);

  // Debounced mermaid render
  useEffect(() => {
    if (!mermaidRef.current) return;
    const t = setTimeout(async () => {
      try {
        const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await mermaid.render(id, diagramRef.current);
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = svg;
          const svgEl = mermaidRef.current.querySelector("svg") as unknown as HTMLElement;
          if (svgEl) { svgEl.style.maxWidth = "100%"; svgEl.style.height = "auto"; }
        }
      } catch (e) {
        if (mermaidRef.current) mermaidRef.current.innerHTML = `<pre class="text-[11px] text-gray-500 whitespace-pre-wrap">${diagramRef.current}</pre>`;
        console.error(e);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [diagramCode]);

  const pushTranscript = (text: string) => {
    const entry = { text, ts: new Date().toLocaleTimeString() };
    setTranscriptFeed((prev) => [...prev, entry].slice(-80)); // keep last 80
    // also append compact line to TipTap without huge gaps
    if (editor) {
      editor.commands.insertContent(`<p style="color:#d1d5db; border-left: 2px solid rgba(6,182,212,0.5); padding-left:8px; margin:6px 0"><span style="color:#6b7280; font-size:11px">${entry.ts}</span> ${text}</p>`);
      editor.commands.scrollIntoView();
    }
  };

  const handleAIResponse = (data: any) => {
    if (!editor) return;
    if (data.updated_mermaid_diagram && data.updated_mermaid_diagram !== diagramRef.current) {
      setDiagramCode(data.updated_mermaid_diagram);
    }
    if (data.meeting_summary_bullet) {
      editor.commands.insertContent(`<p style="background:rgba(168,85,247,0.12); border:1px solid rgba(168,85,247,0.2); border-radius:8px; padding:6px 10px; margin:6px 0"><strong>● Decision:</strong> ${data.meeting_summary_bullet}</p>`);
    }
    if (data.new_tasks?.length) {
      // dedupe front-end too
      const newOnes = (data.new_tasks as Task[]).filter(nt => !tasksRef.current.some(t => t.task_description.toLowerCase() === nt.task_description.toLowerCase()));
      if (newOnes.length) {
        setCurrentTasks((prev) => [...prev, ...newOnes]);
        newOnes.forEach((task: any) => {
          editor.commands.insertContent(`<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p><strong>@${task.owner || "Unassigned"}</strong>: ${task.task_description} <em style="color:#9ca3af">(${task.deadline || "No date"})</em></p></li></ul>`);
        });
      }
    }
  };

  const sendToBackend = async (text: string) => {
    if (!text.trim()) return;
    pushTranscript(text);
    if (liveMode === "transcript") return; // fast path: transcript only, no backend
    try {
      const res = await fetch(`${API_BASE}/api/update-notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_spoken_text: text, current_diagram_code: diagramRef.current, current_tasks: tasksRef.current }),
      });
      const data = await res.json();
      handleAIResponse(data);
    } catch (e) {
      console.error(e);
    }
  };

  // Web Speech API continuous + mic stream for orb
  const toggleMic = async () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Web Speech API not supported in this browser. Use Chrome/Edge, or type in the box.");
      return;
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      micStream?.getTracks().forEach(t => t.stop());
      setMicStream(null);
      setIsListening(false);
      return;
    }
    // Get mic stream for visualizer
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setMicStream(stream);
    } catch (e) {
      console.warn("Mic permission denied, orb will be static:", e);
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalBuffer = "";
    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const tr = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalBuffer += tr + " ";
        else interim += tr;
      }
      setInterimTranscript(interim);
      // When we have a final sentence-ish, push it
      if (finalBuffer.trim() && (finalBuffer.trim().endsWith(".") || finalBuffer.trim().split(" ").length > 8 || event.results[event.results.length-1]?.isFinal)) {
        const toSend = finalBuffer.trim();
        finalBuffer = "";
        setInterimTranscript("");
        sendToBackend(toSend);
      }
    };
    rec.onend = () => { if (isListening) try { rec.start(); } catch {} };
    rec.onerror = (e: any) => { console.error(e); setIsListening(false); };
    try { rec.start(); recognitionRef.current = rec; setIsListening(true); } catch (e) { console.error(e); }
  };

  useEffect(() => { return () => { try { recognitionRef.current?.stop(); } catch {} }; }, []);

  const simulateLiveMeeting = async () => {
    const samples = ["Rahul, can you set up the AWS account by Wednesday?", "Once Rahul is done, Priya needs to connect the FastAPI.", "We've decided to go with AWS over Azure."];
    for (const s of samples) { await sendToBackend(s); await new Promise(r => setTimeout(r, 280)); }
  };

  return (
    <DarkGradientBg className="flex h-screen text-white overflow-hidden font-sans">
      {/* LEFT */}
      <div className="w-[380px] shrink-0 flex flex-col border-r border-white/10 p-5 gap-4 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 shrink-0"><VoicePoweredOrb hue={180} voiceSensitivity={2.2} active={isListening} audioStream={micStream} /></div>
          <div>
            <h2 className="text-base font-bold text-cyan-400 leading-none">MeetFlow AI</h2>
            <p className={`text-xs mt-1 ${isListening ? "text-green-400 animate-pulse" : "text-gray-500"}`}>{isListening ? "● Listening — transcript live" : "○ Mic off"}</p>
          </div>
          <button onClick={toggleMic} className={`ml-auto px-3.5 py-1.5 rounded-full text-xs font-bold border ${isListening ? "bg-red-500 border-red-500 text-white" : "bg-white text-black border-white"}`}>{isListening ? "Stop" : "Start Mic"}</button>
        </div>

        <div className="flex gap-1 bg-black/40 rounded-full p-1 border border-white/10">
          <button onClick={() => setLiveMode("transcript")} className={`flex-1 py-1.5 rounded-full text-xs font-semibold ${liveMode==="transcript"?"bg-white text-black":"text-gray-400"}`}>Transcript only (fast)</button>
          <button onClick={() => setLiveMode("full")} className={`flex-1 py-1.5 rounded-full text-xs font-semibold ${liveMode==="full"?"bg-cyan-500 text-black":"text-gray-400"}`}>Full + tasks</button>
        </div>

        <button onClick={simulateLiveMeeting} className="bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 py-2 rounded-full text-xs font-semibold hover:bg-cyan-500/25">Simulate Speaking</button>

        <div className="flex gap-2">
          <input value={liveText} onChange={(e)=>setLiveText(e.target.value)} onKeyDown={(e)=> e.key==="Enter" && (sendToBackend(liveText), setLiveText(""))} placeholder="Type utterance..." className="flex-1 bg-white/[0.06] border border-white/10 rounded-full px-3.5 py-2 text-xs outline-none placeholder:text-gray-500" />
          <button onClick={()=>{sendToBackend(liveText); setLiveText("");}} className="bg-white text-black px-4 rounded-full text-xs font-bold">Send</button>
        </div>

        {/* Interim transcript */}
        {(interimTranscript || isListening) && (
          <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-3 py-2 text-xs text-cyan-100 min-h-[36px]">{interimTranscript || <span className="text-cyan-300/60">Listening… speak now</span>}</div>
        )}

        {/* Live transcript feed */}
        <div className="flex-1 bg-black/30 rounded-xl border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between"><h3 className="text-[11px] font-semibold text-gray-400 tracking-widest">LIVE TRANSCRIPT</h3><span className="text-[10px] text-gray-500">{transcriptFeed.length}</span></div>
          <div className="flex-1 overflow-auto p-2 space-y-1.5">
            {transcriptFeed.length===0 ? <p className="text-xs text-gray-500 text-center py-8">No transcript yet. Hit Start Mic and speak.</p> : transcriptFeed.map((t,i)=>(
              <div key={i} className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5"><div className="text-[10px] text-gray-500">{t.ts}</div><div className="text-xs text-gray-200 leading-snug">{t.text}</div></div>
            ))}
            <div ref={feedEndRef} />
          </div>
        </div>

        {/* Roadmap compact */}
        <div className="h-[220px] shrink-0 bg-black/30 rounded-xl border border-white/10 p-2 flex flex-col overflow-hidden">
          <h3 className="text-[11px] font-semibold text-gray-400 tracking-widest px-1 mb-1">LIVE ROADMAP · {currentTasks.length} tasks</h3>
          <div ref={mermaidRef} className="flex-1 overflow-auto flex justify-center items-start p-1" style={{fontSize:"12px"}} />
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex-1 flex flex-col p-5 overflow-hidden">
        <div className="bg-[#191919] rounded-xl border border-white/10 flex-1 overflow-auto p-6 shadow-2xl">
          <EditorContent editor={editor} />
        </div>
        <div className="mt-2 text-[11px] text-gray-500 flex gap-3"><span>Tip: Start Mic for real-time transcript.</span><span>Mode: {liveMode}</span></div>
      </div>
    </DarkGradientBg>
  );
}

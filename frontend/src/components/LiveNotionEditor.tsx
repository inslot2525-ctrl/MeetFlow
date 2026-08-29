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
  const [currentTasks, setCurrentTasks] = useState<Task[]>([]);
  const [liveText, setLiveText] = useState("");
  const [isListening] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
    content: `
      <h1>Product Sync</h1>
      <p><em>AI is listening... Notes and tasks will auto-generate below.</em></p>
      <hr />
    `,
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none focus:outline-none min-h-[500px]",
      },
    },
  });

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
  }, []);

  useEffect(() => {
    if (!mermaidRef.current) return;
    const render = async () => {
      try {
        const id = `m-${Date.now()}`;
        const { svg } = await mermaid.render(id, diagramCode);
        if (mermaidRef.current) mermaidRef.current.innerHTML = svg;
      } catch (e) {
        if (mermaidRef.current) mermaidRef.current.textContent = diagramCode;
        console.error("mermaid render failed", e);
      }
    };
    render();
  }, [diagramCode]);

  const handleAIResponse = (data: any) => {
    if (!editor) return;

    if (data.updated_mermaid_diagram) {
      setDiagramCode(data.updated_mermaid_diagram);
    }

    if (data.meeting_summary_bullet) {
      editor.commands.insertContent(`
        <ul>
          <li><strong>Decision:</strong> ${data.meeting_summary_bullet}</li>
        </ul>
      `);
    }

    if (data.new_tasks && data.new_tasks.length > 0) {
      setCurrentTasks((prev) => [...prev, ...data.new_tasks]);
      data.new_tasks.forEach((task: any) => {
        editor.commands.insertContent(`
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <p><strong>@${task.owner || "Unassigned"}</strong>: ${task.task_description} <em>(${task.deadline || "No date"})</em></p>
            </li>
          </ul>
        `);
      });
    }

    editor.commands.scrollIntoView();
  };

  const sendToBackend = async (text: string) => {
    if (!text.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/update-notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_spoken_text: text,
          current_diagram_code: diagramCode,
          current_tasks: currentTasks,
        }),
      });
      const data = await res.json();
      // If backend returns ignored_filler style, it will have empty new_tasks
      handleAIResponse(data);
      if (editor) {
        editor.commands.insertContent(`<p style="color:#888"><em>Heard:</em> ${text}</p>`);
      }
    } catch (e) {
      console.error("API error, falling back to local handling", e);
      // optimistic local fallback
      if (editor) editor.commands.insertContent(`<p style="color:#888"><em>Heard (offline):</em> ${text}</p>`);
    }
  };

  const simulateLiveMeeting = async () => {
    const samples = [
      "We've decided to go with the AWS infrastructure over Azure.",
      "Rahul, can you set up the AWS account by Wednesday?",
      "Once Rahul is done, Priya needs to connect the FastAPI.",
    ];
    for (const s of samples) {
      await sendToBackend(s);
      await new Promise((r) => setTimeout(r, 600));
    }
  };

  const handleManualSend = () => {
    sendToBackend(liveText);
    setLiveText("");
  };

  return (
    <DarkGradientBg className="flex h-screen text-white p-8 overflow-hidden font-sans">
      {/* LEFT: Live Diagram & AI Status */}
      <div className="w-1/3 flex flex-col border-r border-white/10 pr-8">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 relative">
            <VoicePoweredOrb hue={180} voiceSensitivity={2.0} active={isListening || true} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-cyan-400">MeetFlow AI</h2>
            <p className="text-xs text-green-400 animate-pulse">● Live Tracking</p>
          </div>
        </div>

        <button
          onClick={simulateLiveMeeting}
          className="mb-4 bg-cyan-500/20 border border-cyan-500 text-cyan-300 px-4 py-2 rounded-full hover:bg-cyan-500/40"
        >
          Simulate Speaking
        </button>

        <div className="flex gap-2 mb-6">
          <input
            value={liveText}
            onChange={(e) => setLiveText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualSend()}
            placeholder="Type utterance e.g. Rahul, build front..."
            className="flex-1 bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm outline-none"
          />
          <button onClick={handleManualSend} className="bg-white text-black px-4 py-2 rounded-full text-sm font-semibold">
            Send
          </button>
        </div>

        <div className="flex-grow bg-black/40 rounded-xl border border-white/10 p-4 overflow-auto">
          <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">Live Roadmap</h3>
          <div ref={mermaidRef} className="flex justify-center text-sm" />
          <pre className="mt-4 text-[10px] text-gray-500 whitespace-pre-wrap">{diagramCode}</pre>
        </div>

        <div className="mt-4 text-xs text-gray-400">
          <div>Tasks: {currentTasks.length}</div>
          <div>API: {API_BASE}</div>
        </div>
      </div>

      {/* RIGHT: TipTap Notion Editor */}
      <div className="w-2/3 pl-8 flex flex-col">
        <div className="bg-[#191919] rounded-xl border border-white/10 p-12 h-full overflow-y-auto shadow-2xl">
          <EditorContent editor={editor} />
        </div>
      </div>
    </DarkGradientBg>
  );
}

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import os
import re
from typing import List, Optional

from .schema import MeetingChunk, NotionDocumentState, Task
from .pipeline import predict_sentence_class

app = FastAPI(title="MeetFlow Live Notion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sanitize_mermaid(code: str) -> str:
    code = code.strip()
    if not code.startswith("graph"):
        code = "graph TD\n " + code
    # Remove accidental markdown fences
    code = re.sub(r"```mermaid|```", "", code).strip()
    return code


def _build_prompt(chunk: MeetingChunk) -> str:
    tasks_str = "\n".join([f"- {t.task_description} (@{t.owner or 'Unassigned'}, {t.deadline or 'No date'})" for t in chunk.current_tasks]) or "(no tasks yet)"
    return f"""You are MeetFlow's Notion updater. Update the shared document.

Current tasks:
{tasks_str}

Current Flowchart Code:
{chunk.current_diagram_code}

New spoken text: "{chunk.new_spoken_text}"

Rules:
- Extract ONLY new tasks explicitly assigned in the new spoken text. Do not duplicate existing tasks.
- If dependency phrase like "once X is done" or "after X", reflect it as arrow in Mermaid.
- Output complete, valid Mermaid graph TD connecting ALL tasks (old + new). Use node IDs without spaces, labels in brackets.
- Add a one-sentence summary bullet if this was a decision or key commitment.
"""


def _heuristic_state(chunk: MeetingChunk) -> NotionDocumentState:
    """Fallback when Groq not configured — deterministic extraction for demo/offline."""
    text = chunk.new_spoken_text
    tasks = list(chunk.current_tasks)

    # Simple extraction: "Name, <verb> ... by <deadline>"
    # e.g. "Rahul, build the React frontend by Tuesday" or "Rahul can you set up the AWS account by Wednesday?"
    owner = None
    deadline = None
    # Find owner — handle "Once X is done, Y ..." by taking name after comma
    # e.g. "Once Rahul is done, Priya needs to connect the FastAPI"
    m_once_owner = re.search(r"once\s+\w+.*?[,\s]+([A-Z][a-z]+)\s+(?:needs|has|will|should|must|can)", text, re.I)
    if m_once_owner:
        owner = m_once_owner.group(1)
    else:
        m_owner = re.match(r"\s*([A-Z][a-z]+)\b", text)
        if m_owner and m_owner.group(1).lower() != "once":
            owner = m_owner.group(1)
        # fallback: find "@Name" or last capitalized name before verb
        if not owner:
            m_at = re.search(r"@(\w+)", text)
            if m_at:
                owner = m_at.group(1)
    # Find deadline
    m_dead = re.search(r"by\s+(Wednesday|Tuesday|Monday|Thursday|Friday|EOD|tomorrow|next sprint|next week|this week)", text, re.I)
    if m_dead:
        deadline = m_dead.group(1)
    # Depends on
    depends = None
    m_dep = re.search(r"once\s+(\w+).*?(?:is done|finished)", text, re.I)
    if m_dep:
        depends = m_dep.group(1)

    # Extract task description — strip owner prefix and deadline suffix
    desc = text
    # Remove leading "Once X is done, " clause for cleaner task text
    desc = re.sub(r"^\s*once\s+\w+.*?done,\s*", "", desc, flags=re.I)
    if owner:
        desc = re.sub(rf"^\s*{owner}[,\s]*", "", desc, flags=re.I)
        desc = re.sub(r"^\s*(can you|could you|please)\s*", "", desc, flags=re.I)
    desc = re.sub(r"\s+by\s+\w+.*$", "", desc, flags=re.I).strip(" .")
    if not desc:
        desc = text.strip()

    # Deduplicate: if same normalized text already seen, treat as filler
    normalized_new = re.sub(r"\s+", " ", text.strip().lower())
    for t in tasks:
        if re.sub(r"\s+", " ", (t.task_description or "").lower()) == re.sub(r"\s+", " ", desc.lower()):
            # already have this task, skip creation
            return NotionDocumentState(
                new_tasks=[],
                updated_mermaid_diagram=_sanitize_mermaid(chunk.current_diagram_code),
                meeting_summary_bullet=None,
            )

    new_tasks: List[Task] = []
    # Only create task if bouncer says action and looks actionable — DECISION alone is not a task
    label, _ = predict_sentence_class(text)
    # Ignore generic owner "We" — not a person task
    if owner and owner.lower() in ("we", "once", "that", "it", "this"):
        owner = None
    is_actiony = label == "ACTION_ITEM"
    # Require imperative verb for task
    has_action_verb = bool(re.search(r"\b(set up|build|connect|handle|create|migrate|review|prepare|send|write|fix|implement|deploy)\b", desc, re.I))
    if is_actiony and len(desc) > 5 and has_action_verb and not re.match(r"^(Alright|Sure|Yes|Okay|That|What about)", text, re.I):
        # Also dedupe by owner+desc
        exists = any(t.task_description.lower() == desc.lower() and (t.owner or "").lower() == (owner or "").lower() for t in tasks)
        if not exists:
            new_tasks.append(Task(task_description=desc, owner=owner, deadline=deadline, depends_on=depends))
            tasks.append(new_tasks[0])

    # Build mermaid: chain tasks in order, add dependency arrows if mentioned
    diagram = "graph TD\n Start[Meeting Started]"
    if tasks:
        for i, t in enumerate(tasks):
            node_id = f"T{i}"
            label_text = f"{t.owner + ': ' if t.owner else ''}{t.task_description[:28]}"
            label_text = label_text.replace('"', "'")
            diagram += f'\n {node_id}["{label_text}"]'
            if i == 0:
                diagram += f"\n Start --> {node_id}"
            else:
                # if this task depends_on previous owner, arrow from that owner's node
                if t.depends_on:
                    dep_idx = next((j for j, x in enumerate(tasks) if x.owner and x.owner.lower() == t.depends_on.lower()), None)
                    if dep_idx is not None:
                        diagram += f"\n T{dep_idx} --> {node_id}"
                    else:
                        diagram += f"\n T{i-1} --> {node_id}"
                else:
                    diagram += f"\n T{i-1} --> {node_id}"
    else:
        diagram = _sanitize_mermaid(chunk.current_diagram_code)

    # Summary bullet for decisions / actions
    bullet = None
    if label == "DECISION":
        bullet = text.strip()
    elif label == "ACTION_ITEM" and new_tasks:
        bullet = f"Assigned: {new_tasks[0].task_description} to {new_tasks[0].owner or 'Unassigned'}"

    return NotionDocumentState(
        new_tasks=new_tasks,
        updated_mermaid_diagram=_sanitize_mermaid(diagram),
        meeting_summary_bullet=bullet,
    )


def _groq_state(chunk: MeetingChunk) -> NotionDocumentState:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return _heuristic_state(chunk)
    try:
        # Lazy import so requirements don't hard-require groq/instructor for offline dev
        from groq import Groq
        import instructor

        client = instructor.from_groq(Groq(api_key=api_key))
        prompt = _build_prompt(chunk)
        result: NotionDocumentState = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
            response_model=NotionDocumentState,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=800,
        )
        result.updated_mermaid_diagram = _sanitize_mermaid(result.updated_mermaid_diagram)
        return result
    except Exception as e:
        print(f"[api] Groq call failed, heuristic fallback: {e}")
        return _heuristic_state(chunk)


@app.get("/health")
def health():
    return {"status": "ok", "groq_configured": bool(os.getenv("GROQ_API_KEY"))}


@app.post("/api/update-notion", response_model=NotionDocumentState)
async def update_notion_doc(chunk: MeetingChunk):
    label, conf = predict_sentence_class(chunk.new_spoken_text)

    if label not in ("ACTION_ITEM", "DECISION"):
        # Return no-op but keep diagram unchanged so frontend doesn't jump
        return NotionDocumentState(
            new_tasks=[],
            updated_mermaid_diagram=_sanitize_mermaid(chunk.current_diagram_code),
            meeting_summary_bullet=None,
        )

    # Specialist: stateful extraction
    state = _groq_state(chunk)
    return state


@app.post("/api/parse-transcript")
async def parse_transcript_endpoint(payload: dict):
    """Helper to parse a raw transcript string into Notion state steps (batch)."""
    from .parser import parse_transcript
    import tempfile, os
    text = payload.get("text", "")
    # Write temp file for parser
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(text)
        fname = f.name
    try:
        segments = parse_transcript(fname)
    finally:
        os.unlink(fname)
    # Sequentially apply bouncer + heuristic to simulate live feed
    diagram = "graph TD\n Start[Meeting Started]"
    tasks: List[Task] = []
    steps = []
    for seg in segments:
        chunk = MeetingChunk(new_spoken_text=seg["text"], current_diagram_code=diagram, current_tasks=tasks)
        state = _groq_state(chunk) if predict_sentence_class(seg["text"])[0] in ("ACTION_ITEM", "DECISION") else NotionDocumentState(new_tasks=[], updated_mermaid_diagram=diagram, meeting_summary_bullet=None)
        diagram = state.updated_mermaid_diagram
        tasks.extend(state.new_tasks)
        steps.append({"speaker": seg["speaker"], "text": seg["text"], "state": state.model_dump()})
    return {"steps": steps, "final_diagram": diagram, "tasks": [t.model_dump() for t in tasks]}


# ---- Single-shot pipeline for validation: voice/file -> transcript -> summary/tasks/mermaid ----

def _summarize_tasks(tasks: List[Task], transcript: str) -> str:
    """Heuristic summary + Groq summary if available."""
    api_key = os.getenv("GROQ_API_KEY")
    if api_key:
        try:
            from groq import Groq
            client = Groq(api_key=api_key)
            resp = client.chat.completions.create(
                model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                messages=[
                    {"role": "system", "content": "Summarize this meeting transcript into 3-5 concise bullet points. Focus on decisions and next steps."},
                    {"role": "user", "content": transcript[:6000]},
                ],
                temperature=0.3,
                max_tokens=400,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[summarize] Groq failed, heuristic fallback: {e}")
    # heuristic fallback
    if not tasks:
        return "No actionable tasks detected. " + transcript[:220]
    bullets = [f"- {t.owner or 'Unassigned'}: {t.task_description} ({t.deadline or 'no deadline'})" for t in tasks]
    return "Meeting summary (heuristic):\n" + "\n".join(bullets[:6])


@app.post("/api/voice-to-mermaid")
async def voice_to_mermaid(text: Optional[str] = Form(None), file: Optional[UploadFile] = File(None)):
    """
    Single-shot validation endpoint:
    - Accepts either raw text (transcript) or audio file (wav/mp3/webm)
    - Transcribes audio if provided (whisper if installed, else error)
    - Runs batch pipeline: transcript -> persons/tasks -> mermaid -> summary
    Returns {transcript, tasks, mermaid, summary, segments}
    """
    transcript = (text or "").strip()

    # If audio file provided, transcribe it
    if file is not None and file.filename:
        content = await file.read()
        if len(content) > 0:
            # Try whisper → groq whisper → fallback
            transcript_from_audio = None
            # Try local whisper
            try:
                import tempfile, os as _os
                suffix = _os.path.splitext(file.filename)[1] or ".webm"
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                    tmp.write(content)
                    tmp_path = tmp.name
                # attempt faster_whisper / whisper
                try:
                    import whisper  # openai-whisper
                    model = whisper.load_model("base")
                    result = model.transcribe(tmp_path)
                    transcript_from_audio = result.get("text", "").strip()
                except ImportError:
                    # try groq whisper if key exists
                    groq_key = os.getenv("GROQ_API_KEY")
                    if groq_key:
                        from groq import Groq
                        client = Groq(api_key=groq_key)
                        with open(tmp_path, "rb") as f:
                            tr = client.audio.transcriptions.create(model="whisper-large-v3", file=(file.filename, f))
                            transcript_from_audio = tr.text
                _os.unlink(tmp_path)
            except Exception as e:
                print(f"[voice] transcription failed: {e}")
            if transcript_from_audio:
                transcript = transcript_from_audio
            elif not transcript:
                transcript = ""  # will error below

    if not transcript:
        return {"error": "No transcript provided and audio transcription failed or not configured. Provide 'text' or install whisper / set GROQ_API_KEY."}

    # Run batch pipeline similar to /api/parse-transcript but with richer summary
    # If transcript has no speaker prefixes, treat each line/sentence as utterance
    normalized = transcript
    if ":" not in transcript:
        # Split into sentences for pipeline
        sentences = re.split(r"(?<=[.!?])\s+", transcript.strip())
        normalized = "\n".join([f"Speaker {i+1}: {s.strip()}" for i, s in enumerate(sentences) if s.strip()])

    # Reuse parse-transcript logic
    from .parser import parse_transcript
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(normalized)
        fname = f.name
    try:
        segments = parse_transcript(fname)
    finally:
        os.unlink(fname)

    diagram = "graph TD\n Start[Meeting Started]"
    tasks: List[Task] = []
    steps = []
    summary_bullets: List[str] = []
    for seg in segments:
        chunk = MeetingChunk(new_spoken_text=seg["text"], current_diagram_code=diagram, current_tasks=tasks)
        label, _ = predict_sentence_class(seg["text"])
        if label in ("ACTION_ITEM", "DECISION"):
            state = _groq_state(chunk)
        else:
            state = NotionDocumentState(new_tasks=[], updated_mermaid_diagram=diagram, meeting_summary_bullet=None)
        diagram = state.updated_mermaid_diagram
        tasks.extend(state.new_tasks)
        if state.meeting_summary_bullet:
            summary_bullets.append(state.meeting_summary_bullet)
        steps.append({"speaker": seg["speaker"], "text": seg["text"], "label": label, "state": state.model_dump()})

    summary = _summarize_tasks(tasks, transcript)
    # Also include per-segment bullets as fallback
    if summary_bullets and "heuristic" in summary.lower():
        summary += "\n\nDecisions:\n- " + "\n- ".join(summary_bullets[:5])

    return {
        "transcript": transcript,
        "segments": steps,
        "tasks": [t.model_dump() for t in tasks],
        "mermaid": diagram,
        "summary": summary,
    }


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Audio-only transcription endpoint — returns {transcript}."""
    content = await file.read()
    import tempfile
    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    transcript = None
    error = None
    try:
        try:
            import whisper
            model = whisper.load_model("base")
            result = model.transcribe(tmp_path)
            transcript = result.get("text", "").strip()
        except ImportError as e:
            groq_key = os.getenv("GROQ_API_KEY")
            if groq_key:
                from groq import Groq
                client = Groq(api_key=groq_key)
                with open(tmp_path, "rb") as f:
                    tr = client.audio.transcriptions.create(model="whisper-large-v3", file=(file.filename or "audio.webm", f))
                    transcript = tr.text
            else:
                error = f"whisper not installed and GROQ_API_KEY not set: {e}"
        except Exception as e:
            error = str(e)
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass
    if transcript:
        return {"transcript": transcript}
    return {"error": error or "Transcription failed", "transcript": ""}

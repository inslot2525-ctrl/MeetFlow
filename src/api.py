from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import re
from typing import List

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

    new_tasks: List[Task] = []
    # Only create task if bouncer says action/decision and looks actionable
    label, _ = predict_sentence_class(text)
    is_actiony = label in ("ACTION_ITEM", "DECISION")
    # Also treat any sentence with owner+verb as task for demo
    if is_actiony and len(desc) > 5 and not re.match(r"^(Alright|Sure|Yes|Okay|That|What about)", text, re.I):
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

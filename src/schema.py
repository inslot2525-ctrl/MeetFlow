from pydantic import BaseModel, Field
from typing import List, Optional


class Task(BaseModel):
    task_description: str = Field(description="Clear, actionable description of the task")
    owner: Optional[str] = Field(default=None, description="Person assigned to the task, if mentioned")
    deadline: Optional[str] = Field(default=None, description="Deadline or due date if mentioned")
    depends_on: Optional[str] = Field(default=None, description="ID or description of task this depends on, if dependency phrase exists e.g. 'once Rahul is done'")


class NotionDocumentState(BaseModel):
    new_tasks: List[Task] = Field(
        default_factory=list,
        description="Any NEW tasks mentioned in the latest spoken text. Empty if none."
    )
    updated_mermaid_diagram: str = Field(
        description="The complete, updated Mermaid.js flowchart (graph TD) connecting ALL tasks from the meeting so far. Use arrows (-->) to show dependencies. Must be valid Mermaid syntax. Start with 'graph TD'."
    )
    meeting_summary_bullet: Optional[str] = Field(
        default=None,
        description="A single bullet point summarizing the current decision or key point, to be appended to Notion notes. Null if filler."
    )


class MeetingChunk(BaseModel):
    new_spoken_text: str = Field(description="Latest transcribed utterance, e.g. 'Rahul, build the React frontend by Tuesday'")
    current_diagram_code: str = Field(default="graph TD\n Start[Meeting Started]", description="Current Mermaid flowchart code from frontend")
    current_tasks: List[Task] = Field(default_factory=list, description="Existing tasks already in the document, to preserve context")

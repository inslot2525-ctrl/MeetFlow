# MeetFlow

MeetFlow is a Python-based tool for processing meeting transcripts. It parses raw transcript text into structured objects and classifies content using a DeBERTa model.

## Project Structure

```
MeetFlow/
├── .gitignore
├── README.md
├── requirements.txt
├── test_install.py
├── data/
│   └── sample_transcript.txt
├── src/
│   ├── __init__.py
│   ├── parser.py         # parse_transcript + TranscriptParser
│   ├── classifier.py     # MeetingClassifier (DeBERTa wrapper)
│   ├── pipeline.py       # predict_sentence_class bouncer
│   ├── schema.py         # Task + NotionDocumentState + MeetingChunk
│   └── api.py            # FastAPI /api/update-notion (stateful)
└── frontend/             # Vite React + TipTap Live Notion Editor
    └── src/components/LiveNotionEditor.tsx
```

## Setup

1. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # Windows
   venv\Scripts\activate
   # macOS/Linux
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Verify installation:
   ```bash
   python test_install.py
   ```

## Usage

```python
from src.parser import TranscriptParser
from src.classifier import MeetingClassifier

# Parse a transcript
parser = TranscriptParser()
segments = parser.parse("path/to/transcript.txt")

# Classify segments (bouncer)
classifier = MeetingClassifier()
results = classifier.classify(segments)
```

### Live Notion API (stateful flowchart)

```bash
# set Groq key for LLM (or heuristic fallback works offline)
set GROQ_API_KEY=your_key
py -m uvicorn src.api:app --reload --port 8000
# POST /api/update-notion with {new_spoken_text, current_diagram_code, current_tasks}
```

### Frontend (TipTap headless)

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173 proxies /api to :8000
# LiveNotionEditor.tsx uses TipTap insertContent() to auto-drop tasks + mermaid roadmap
```

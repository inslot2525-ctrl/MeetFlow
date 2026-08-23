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
└── src/
    ├── __init__.py
    ├── parser.py
    └── classifier.py
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

# Classify segments
classifier = MeetingClassifier()
results = classifier.classify(segments)
```

from typing import List, Dict


class TranscriptParser:
    """Wrapper for backward-compat with test_install.py / README usage."""

    def parse(self, file_path: str) -> List[Dict[str, str]]:
        return parse_transcript(file_path)


def parse_transcript(file_path: str) -> List[Dict[str, str]]:
    """
    Reads a transcript file and breaks it down into individual utterances.
    
    Expected input line format: "Speaker Name: Utterance text"
    Returns a list of dictionaries: [{'id': 1, 'speaker': 'Speaker A', 'text': '...'}]
    """
    parsed_utterances = []
    
    with open(file_path, "r", encoding="utf-8") as file:
        for line_num, line in enumerate(file, 1):
            line = line.strip()
            
            if not line:
                continue
                
            if ":" in line:
                speaker, text = line.split(":", 1)
                parsed_utterances.append({
                    "id": line_num,
                    "speaker": speaker.strip(),
                    "text": text.strip()
                })
            else:
                print(f"Warning: Line {line_num} skipped (no colon found): '{line}'")
                
    return parsed_utterances


if __name__ == "__main__":
    sample_path = "data/sample_transcript.txt"
    data = parse_transcript(sample_path)
    
    print(f"Successfully parsed {len(data)} utterances from {sample_path}:\n")
    for item in data[:3]:
        print(item)
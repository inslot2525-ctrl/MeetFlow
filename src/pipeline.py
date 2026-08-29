"""
Stateful pipeline helpers: bouncer classifier + LLM state update helpers.
Uses DeBERTa if available, falls back to heuristic for fast local dev.
"""
from typing import Tuple
import re

# Labels expected by the bouncer
LABELS = ["ACTION_ITEM", "DECISION", "FILLER"]

# Heuristic keywords — fast fallback when transformer model not loaded
_ACTION_KEYWORDS = [
    r"\b(assign|todo|task|need to|have to|should|will do|can you|could you|please)\b",
    r"\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|next sprint|eod)\b",
    r"@\w+",
]
_DECISION_KEYWORDS = [
    r"\b(decided|decision|go with|choose|final|prioritize|agreed|approved)\b",
    r"\bwe will\b",
]

_action_re = re.compile("|".join(_ACTION_KEYWORDS), re.I)
_decision_re = re.compile("|".join(_DECISION_KEYWORDS), re.I)

_model = None
_tokenizer = None
_model_name = "microsoft/deberta-v3-base"  # override via env if needed


def _try_load_deberta():
    global _model, _tokenizer
    if _model is not None:
        return True
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        import os
        name = os.getenv("MEETFLOW_DEBERTA_MODEL", _model_name)
        _tokenizer = AutoTokenizer.from_pretrained(name)
        _model = AutoModelForSequenceClassification.from_pretrained(name)
        _model.eval()
        return True
    except Exception as e:
        print(f"[pipeline] DeBERTa not loaded, using heuristic bouncer: {e}")
        return False


def predict_sentence_class(text: str) -> Tuple[str, float]:
    """
    Bouncer: is this sentence worth sending to the LLM?
    Returns (label, confidence) where label in ACTION_ITEM|DECISION|FILLER.
    Tries DeBERTa if available, else heuristic.
    """
    text = text.strip()
    if not text:
        return "FILLER", 0.0

    # Try transformer if available
    if _try_load_deberta() and _model is not None:
        try:
            import torch
            inputs = _tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
            with torch.no_grad():
                logits = _model(**inputs).logits
                probs = torch.softmax(logits, dim=-1).squeeze().tolist()
                # Map assuming fine-tuned head; fallback to heuristic mapping
                idx = max(range(len(probs)), key=lambda i: probs[i])
                label = LABELS[idx] if idx < len(LABELS) else "FILLER"
                conf = float(probs[idx])
                # Low confidence -> fallback to heuristic to stay safe
                if conf < 0.55:
                    return _heuristic_classify(text)
                return label, conf
        except Exception as e:
            print(f"[pipeline] transformer inference failed, heuristic fallback: {e}")

    return _heuristic_classify(text)


def _heuristic_classify(text: str) -> Tuple[str, float]:
    # Owner pattern like "Rahul, ..." or "@Rahul" increases action likelihood
    has_owner = bool(re.search(r"^\s*[A-Z][a-z]+,|@\w+", text))
    if _action_re.search(text) or has_owner and re.search(r"\b(build|setup|handle|create|connect|migrate|review)\b", text, re.I):
        return "ACTION_ITEM", 0.86
    if _decision_re.search(text):
        return "DECISION", 0.82
    # "Once X is done, Y needs to" is strong action + dependency
    if re.search(r"\bonce\b.*\b(done|finished)\b", text, re.I):
        return "ACTION_ITEM", 0.88
    return "FILLER", 0.75

"""
MeetingClassifier wrapper — delegates to pipeline.predict_sentence_class.
Keeps the DeBERTa bouncer logic in pipeline.py but exposes a class for test_install.
"""
from typing import Tuple
from .pipeline import predict_sentence_class


class MeetingClassifier:
    """Classifier that predicts ACTION_ITEM / DECISION / FILLER."""

    def __init__(self, model_name: str = None):
        self.model_name = model_name

    def classify(self, segments):
        """
        Classify a list of segment dicts ({text: ...}) or raw strings.
        Returns list of dicts with label/conf.
        """
        results = []
        for seg in segments:
            text = seg.get("text") if isinstance(seg, dict) else str(seg)
            label, conf = predict_sentence_class(text)
            results.append({"text": text, "label": label, "confidence": conf})
        return results

    def predict(self, text: str) -> Tuple[str, float]:
        return predict_sentence_class(text)

"""Math problem data structures and validation."""

from dataclasses import dataclass
from typing import Union


@dataclass
class MathProblem:
    topic: str
    question: str
    answer: Union[int, float, str]
    hint: str
    explanation: str
    difficulty: str  # "easy", "medium", "hard"

    def check_answer(self, student_answer: str) -> bool:
        """Validate a student's answer against the correct answer."""
        try:
            if isinstance(self.answer, float):
                return abs(float(student_answer) - self.answer) < 0.01
            elif isinstance(self.answer, int):
                return int(student_answer.strip()) == self.answer
            else:
                return student_answer.strip().lower() == str(self.answer).lower()
        except (ValueError, TypeError):
            return False

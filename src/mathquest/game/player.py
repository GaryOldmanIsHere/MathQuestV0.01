"""Player character and progression management."""

from dataclasses import dataclass, field
from enum import Enum


class GradeLevel(Enum):
    K = "Kindergarten"
    GRADE_1 = "Grade 1"
    GRADE_2 = "Grade 2"
    GRADE_3 = "Grade 3"
    GRADE_4 = "Grade 4"
    GRADE_5 = "Grade 5"
    GRADE_6 = "Grade 6"
    GRADE_7 = "Grade 7"
    GRADE_8 = "Grade 8"
    GRADE_9 = "Grade 9"
    GRADE_10 = "Grade 10"
    GRADE_11 = "Grade 11"
    GRADE_12 = "Grade 12"


@dataclass
class Player:
    name: str
    grade: GradeLevel
    experience: int = 0
    level: int = 1
    health: int = 100
    gold: int = 0
    quests_completed: int = 0
    correct_answers: int = 0
    total_answers: int = 0

    @property
    def accuracy(self) -> float:
        if self.total_answers == 0:
            return 0.0
        return self.correct_answers / self.total_answers

    @property
    def xp_to_next_level(self) -> int:
        return self.level * 100

    def award_xp(self, amount: int) -> bool:
        """Award XP and return True if player leveled up."""
        self.experience += amount
        if self.experience >= self.xp_to_next_level:
            self.experience -= self.xp_to_next_level
            self.level += 1
            return True
        return False

    def record_answer(self, correct: bool) -> None:
        self.total_answers += 1
        if correct:
            self.correct_answers += 1

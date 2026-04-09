"""Quest system for the RPG game."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class QuestStatus(Enum):
    AVAILABLE = "available"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


class Difficulty(Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


@dataclass
class Quest:
    id: str
    title: str
    description: str
    difficulty: Difficulty
    math_topic: str
    problems_required: int
    xp_reward: int
    gold_reward: int
    status: QuestStatus = QuestStatus.AVAILABLE
    problems_solved: int = 0
    narrative: Optional[str] = None

    @property
    def is_complete(self) -> bool:
        return self.problems_solved >= self.problems_required

    def progress(self) -> str:
        return f"{self.problems_solved}/{self.problems_required}"

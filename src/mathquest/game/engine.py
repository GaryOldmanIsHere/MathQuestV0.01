"""Core game engine - manages game state and flow."""

from typing import Optional
from .player import Player, GradeLevel
from .quest import Quest, QuestStatus


class GameEngine:
    def __init__(self) -> None:
        self.player: Optional[Player] = None
        self.active_quest: Optional[Quest] = None
        self.available_quests: list[Quest] = []
        self.completed_quests: list[Quest] = []

    def create_player(self, name: str, grade: GradeLevel) -> Player:
        self.player = Player(name=name, grade=grade)
        return self.player

    def start_quest(self, quest: Quest) -> None:
        if self.active_quest is not None:
            raise ValueError("A quest is already active. Complete it first.")
        quest.status = QuestStatus.ACTIVE
        self.active_quest = quest

    def complete_problem(self, correct: bool) -> dict:
        """Process a problem answer and return result info."""
        if self.player is None or self.active_quest is None:
            raise ValueError("No active player or quest.")

        self.player.record_answer(correct)
        result = {"correct": correct, "leveled_up": False, "quest_complete": False}

        if correct:
            self.active_quest.problems_solved += 1
            xp_gain = 10 if self.active_quest.difficulty.value == "easy" else \
                       20 if self.active_quest.difficulty.value == "medium" else 30
            leveled_up = self.player.award_xp(xp_gain)
            result["leveled_up"] = leveled_up

            if self.active_quest.is_complete:
                self._finish_quest()
                result["quest_complete"] = True

        return result

    def _finish_quest(self) -> None:
        quest = self.active_quest
        quest.status = QuestStatus.COMPLETED
        self.player.gold += quest.gold_reward
        self.player.quests_completed += 1
        self.completed_quests.append(quest)
        self.active_quest = None

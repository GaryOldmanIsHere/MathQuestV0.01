"""Tests for player module."""

import pytest
from src.mathquest.game.player import Player, GradeLevel


def test_player_creation():
    player = Player(name="Alice", grade=GradeLevel.GRADE_3)
    assert player.name == "Alice"
    assert player.level == 1
    assert player.experience == 0


def test_player_accuracy_no_answers():
    player = Player(name="Bob", grade=GradeLevel.GRADE_5)
    assert player.accuracy == 0.0


def test_player_record_answer():
    player = Player(name="Carol", grade=GradeLevel.GRADE_2)
    player.record_answer(True)
    player.record_answer(False)
    assert player.total_answers == 2
    assert player.correct_answers == 1
    assert player.accuracy == 0.5


def test_player_level_up():
    player = Player(name="Dave", grade=GradeLevel.GRADE_4)
    leveled_up = player.award_xp(100)
    assert leveled_up is True
    assert player.level == 2


def test_player_no_level_up():
    player = Player(name="Eve", grade=GradeLevel.GRADE_4)
    leveled_up = player.award_xp(50)
    assert leveled_up is False
    assert player.level == 1

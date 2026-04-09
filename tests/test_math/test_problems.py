"""Tests for math problem validation."""

import pytest
from src.mathquest.math.problems import MathProblem


def test_correct_integer_answer():
    problem = MathProblem(
        topic="addition",
        question="What is 2 + 2?",
        answer=4,
        hint="Count on your fingers",
        explanation="2 + 2 = 4",
        difficulty="easy",
    )
    assert problem.check_answer("4") is True
    assert problem.check_answer("5") is False


def test_correct_float_answer():
    problem = MathProblem(
        topic="division",
        question="What is 1 / 4?",
        answer=0.25,
        hint="Divide the top by the bottom",
        explanation="1 ÷ 4 = 0.25",
        difficulty="medium",
    )
    assert problem.check_answer("0.25") is True
    assert problem.check_answer("0.26") is False


def test_correct_string_answer():
    problem = MathProblem(
        topic="geometry",
        question="What shape has 3 sides?",
        answer="triangle",
        hint="Think about a pyramid's face",
        explanation="A triangle has exactly 3 sides",
        difficulty="easy",
    )
    assert problem.check_answer("Triangle") is True
    assert problem.check_answer("square") is False


def test_invalid_answer_input():
    problem = MathProblem(
        topic="addition",
        question="What is 2 + 2?",
        answer=4,
        hint="",
        explanation="",
        difficulty="easy",
    )
    assert problem.check_answer("abc") is False

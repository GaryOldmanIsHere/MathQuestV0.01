"""LLM client for narrative generation and math problem creation."""

import os
import anthropic
from ..math.problems import MathProblem
from ..game.player import GradeLevel


class LLMClient:
    def __init__(self, api_key: str | None = None) -> None:
        self.client = anthropic.Anthropic(
            api_key=api_key or os.environ.get("ANTHROPIC_API_KEY")
        )
        self.model = "claude-sonnet-4-6"

    def generate_quest_narrative(
        self, topic: str, grade: GradeLevel, difficulty: str
    ) -> str:
        """Generate an RPG-style quest narrative for a math topic."""
        prompt = (
            f"You are a narrator for a math RPG game for {grade.value} students. "
            f"Create a short, exciting quest description (2-3 sentences) that involves "
            f"the math topic '{topic}' at a {difficulty} difficulty level. "
            f"Make it feel like a fantasy adventure where the hero must use math to succeed. "
            f"Do not include the actual math problems yet."
        )
        message = self.client.messages.create(
            model=self.model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    def generate_math_problem(
        self, topic: str, grade: GradeLevel, difficulty: str
    ) -> MathProblem:
        """Generate a math problem for a given topic and grade level."""
        prompt = (
            f"Generate a math problem for a {grade.value} student on the topic '{topic}' "
            f"at {difficulty} difficulty. Respond in this exact format:\n"
            f"QUESTION: <the math question>\n"
            f"ANSWER: <the exact answer, numbers only if numeric>\n"
            f"HINT: <a helpful hint without giving away the answer>\n"
            f"EXPLANATION: <step-by-step explanation of how to solve it>\n"
            f"Keep the question appropriate for the grade level."
        )
        message = self.client.messages.create(
            model=self.model,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        return self._parse_problem_response(message.content[0].text, topic, difficulty)

    def _parse_problem_response(
        self, text: str, topic: str, difficulty: str
    ) -> MathProblem:
        lines = {
            key: ""
            for key in ("QUESTION", "ANSWER", "HINT", "EXPLANATION")
        }
        current_key = None
        for line in text.strip().splitlines():
            for key in lines:
                if line.startswith(f"{key}:"):
                    current_key = key
                    lines[key] = line[len(key) + 1:].strip()
                    break
            else:
                if current_key:
                    lines[current_key] += " " + line.strip()

        answer: int | float | str
        try:
            answer = int(lines["ANSWER"])
        except ValueError:
            try:
                answer = float(lines["ANSWER"])
            except ValueError:
                answer = lines["ANSWER"]

        return MathProblem(
            topic=topic,
            question=lines["QUESTION"],
            answer=answer,
            hint=lines["HINT"],
            explanation=lines["EXPLANATION"],
            difficulty=difficulty,
        )

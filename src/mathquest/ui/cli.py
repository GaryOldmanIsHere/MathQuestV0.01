"""Command-line interface for MathQuest."""

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, IntPrompt
from rich.table import Table
from rich import print as rprint

from ..game.engine import GameEngine
from ..game.player import GradeLevel
from ..game.quest import Quest, Difficulty
from ..llm.client import LLMClient
from ..math.grades import get_topics_for_grade

console = Console()


def show_banner() -> None:
    console.print(Panel.fit(
        "[bold magenta]MathQuest[/bold magenta]\n"
        "[yellow]An Epic Adventure in Learning Math![/yellow]",
        border_style="cyan",
    ))


def select_grade() -> GradeLevel:
    grades = list(GradeLevel)
    table = Table(title="Select Your Grade Level", border_style="blue")
    table.add_column("#", style="cyan", width=4)
    table.add_column("Grade", style="green")
    for i, grade in enumerate(grades, 1):
        table.add_row(str(i), grade.value)
    console.print(table)
    choice = IntPrompt.ask("Enter grade number", default=1)
    return grades[max(0, min(choice - 1, len(grades) - 1))]


def show_player_status(engine: GameEngine) -> None:
    p = engine.player
    console.print(Panel(
        f"[bold]{p.name}[/bold] | Level {p.level} | "
        f"XP: {p.experience}/{p.xp_to_next_level} | "
        f"Gold: {p.gold} | "
        f"Accuracy: {p.accuracy:.0%}",
        title="Player Status",
        border_style="green",
    ))


def run_game() -> None:
    show_banner()
    llm = LLMClient()
    engine = GameEngine()

    name = Prompt.ask("[bold]Enter your hero's name[/bold]")
    grade = select_grade()
    engine.create_player(name, grade)
    console.print(f"\n[green]Welcome, {name}! Your adventure begins...[/green]\n")

    topics = get_topics_for_grade(grade)
    if not topics:
        console.print("[red]No topics found for this grade.[/red]")
        return

    while True:
        show_player_status(engine)
        console.print("\n[bold cyan]Choose a topic to quest:[/bold cyan]")
        for i, topic in enumerate(topics[:5], 1):
            console.print(f"  {i}. {topic.replace('_', ' ').title()}")
        console.print("  Q. Quit")

        choice = Prompt.ask("Your choice").strip().upper()
        if choice == "Q":
            console.print("\n[yellow]Farewell, brave adventurer![/yellow]")
            break

        try:
            topic_idx = int(choice) - 1
            topic = topics[topic_idx]
        except (ValueError, IndexError):
            console.print("[red]Invalid choice.[/red]")
            continue

        difficulty = Prompt.ask(
            "Difficulty", choices=["easy", "medium", "hard"], default="easy"
        )

        console.print("\n[italic]Generating quest...[/italic]")
        narrative = llm.generate_quest_narrative(topic, grade, difficulty)
        quest = Quest(
            id=f"{topic}_{difficulty}",
            title=f"{topic.replace('_', ' ').title()} Challenge",
            description=narrative,
            difficulty=Difficulty[difficulty.upper()],
            math_topic=topic,
            problems_required=3,
            xp_reward=50,
            gold_reward=20,
        )
        engine.start_quest(quest)
        console.print(Panel(narrative, title=f"[bold]{quest.title}[/bold]", border_style="magenta"))

        while not quest.is_complete:
            console.print(f"\n[dim]Progress: {quest.progress()}[/dim]")
            console.print("[italic]Generating problem...[/italic]")
            problem = llm.generate_math_problem(topic, grade, difficulty)
            console.print(Panel(problem.question, title="Math Challenge", border_style="yellow"))

            while True:
                answer = Prompt.ask("Your answer (or 'hint')")
                if answer.lower() == "hint":
                    console.print(f"[blue]Hint: {problem.hint}[/blue]")
                    continue
                break

            result = engine.complete_problem(problem.check_answer(answer))
            if result["correct"]:
                console.print("[bold green]Correct![/bold green]")
                if result["leveled_up"]:
                    console.print("[bold yellow]*** LEVEL UP! ***[/bold yellow]")
            else:
                console.print(f"[red]Incorrect.[/red] The answer was: [bold]{problem.answer}[/bold]")
                console.print(f"[dim]{problem.explanation}[/dim]")

        if quest.is_complete:
            console.print(Panel(
                f"[bold green]Quest Complete![/bold green]\n"
                f"Earned: {quest.xp_reward} XP, {quest.gold_reward} Gold",
                border_style="gold1",
            ))

"""Grade-level math curriculum mapping."""

from enum import Enum
from ..game.player import GradeLevel


CURRICULUM: dict[GradeLevel, list[str]] = {
    GradeLevel.K: [
        "counting", "number_recognition", "basic_addition", "basic_subtraction",
        "shapes", "patterns",
    ],
    GradeLevel.GRADE_1: [
        "addition_to_20", "subtraction_to_20", "place_value", "measurement",
        "time", "data_and_graphs",
    ],
    GradeLevel.GRADE_2: [
        "addition_to_100", "subtraction_to_100", "multiplication_intro",
        "fractions_intro", "geometry", "money",
    ],
    GradeLevel.GRADE_3: [
        "multiplication", "division", "fractions", "area_perimeter",
        "telling_time", "word_problems",
    ],
    GradeLevel.GRADE_4: [
        "multi_digit_multiplication", "long_division", "fractions_advanced",
        "decimals_intro", "angles", "factors_multiples",
    ],
    GradeLevel.GRADE_5: [
        "decimal_operations", "fraction_operations", "volume",
        "coordinate_plane", "order_of_operations", "data_analysis",
    ],
    GradeLevel.GRADE_6: [
        "ratios_proportions", "percents", "negative_numbers", "expressions",
        "equations", "statistics",
    ],
    GradeLevel.GRADE_7: [
        "proportional_relationships", "percent_change", "algebra_basics",
        "geometry_scale", "probability", "statistics_advanced",
    ],
    GradeLevel.GRADE_8: [
        "linear_equations", "systems_of_equations", "functions",
        "exponents", "pythagorean_theorem", "transformations",
    ],
    GradeLevel.GRADE_9: [
        "algebra_1", "quadratic_equations", "polynomials",
        "graphing_lines", "inequalities", "radicals",
    ],
    GradeLevel.GRADE_10: [
        "geometry", "trigonometry_intro", "proofs",
        "circles", "quadrilaterals", "coordinate_geometry",
    ],
    GradeLevel.GRADE_11: [
        "algebra_2", "logarithms", "complex_numbers",
        "sequences_series", "trigonometry", "conic_sections",
    ],
    GradeLevel.GRADE_12: [
        "precalculus", "limits_intro", "derivatives_intro",
        "statistics_ap", "discrete_math", "vectors",
    ],
}


def get_topics_for_grade(grade: GradeLevel) -> list[str]:
    return CURRICULUM.get(grade, [])

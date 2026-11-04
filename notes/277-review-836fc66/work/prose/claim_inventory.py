"""Pair each prose sentence with the hand-reviewed assessment in report.md."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
report = (ROOT / "work/prose/report.md").read_text()
sections = {
    "PR body": ("inputs/pr/pr-body-836fc66.md", "## PR body mechanism sentences", "## Hand-off mechanism sentences"),
    "Hand-off": ("inputs/pr/handoff-6994-6639793646.md", "## Hand-off mechanism sentences", "## PR style"),
}
for title, (path, begin, end) in sections.items():
    text = report.split(begin, 1)[1].split(end, 1)[0]
    assessments = {}
    for match in re.finditer(r"^\| (\d+)(?:[-–](\d+))? \| (.+) \|$", text, re.M):
        lo = int(match[1])
        hi = int(match[2] or lo)
        for line_number in range(lo, hi + 1):
            assessments[line_number] = match[3]
    print(title)
    for line_number, line in enumerate((ROOT / path).read_text().splitlines(), 1):
        if not line.strip() or re.match(r"^#{1,6} ", line) or line.startswith("|") or line == "---":
            continue
        sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z`#])", line.strip())
        for ordinal, sentence in enumerate(sentences, 1):
            print(f"{path}:{line_number}, sentence {ordinal}: {sentence}")
            print("Assessment:", assessments.get(line_number, "Not a code mechanism claim (scope, source/commit history, style, or logistics)."))
            print()

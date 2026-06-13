import csv
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from sessions_run import RUN
from sessions_ride import RIDE
from sessions_swim import SWIM

RUN  = RUN[:50]
RIDE = RIDE[:50]
SWIM = SWIM[:50]

headers = [
    "id", "sport", "request", "plan", "estimated_kcal",
    "rating_1_5",
    "intensity_accurate_Y_N",
    "structure_logical_Y_N",
    "durations_realistic_Y_N",
    "feedback_comments",
]

output = os.path.expanduser("~/Downloads/stravaeat_coach_eval.csv")

with open(output, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(headers)
    for i, s in enumerate(RUN + RIDE + SWIM, start=1):
        writer.writerow([
            i, s["sport"], s["request"], s["plan"], s["estimated_kcal"],
            "", "", "", "", "",
        ])

print(f"Written {len(RUN)+len(RIDE)+len(SWIM)} sessions → {output}")

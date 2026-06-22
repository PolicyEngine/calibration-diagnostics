"""Generate a static catalog of PolicyEngine-US variables for the lookup page.

Writes frontend/public/variable-catalog.json — a list of
{name, label, entity, unit} for every variable in the model, so the variable
lookup page can offer search/select without a per-keystroke API round-trip.

Run from the frontend dir:  python scripts/generate_variable_catalog.py
Refresh whenever policyengine-us is upgraded.
"""

import json
import os

from policyengine_us import Microsimulation


def main() -> None:
    sim = Microsimulation()
    variables = sim.tax_benefit_system.variables
    catalog = []
    for name, variable in sorted(variables.items()):
        catalog.append(
            {
                "name": name,
                "label": getattr(variable, "label", None) or None,
                "entity": getattr(getattr(variable, "entity", None), "key", None),
                "unit": getattr(variable, "unit", None),
            }
        )

    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "public")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "variable-catalog.json")
    with open(out_path, "w") as handle:
        json.dump(
            {"count": len(catalog), "variables": catalog},
            handle,
            separators=(",", ":"),
        )
    print(f"Wrote {len(catalog)} variables to {os.path.normpath(out_path)}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json

from .snapshot import compile_snapshot, diff_snapshots


def main() -> None:
    parser = argparse.ArgumentParser(prog="evaluation-harness")
    commands = parser.add_subparsers(dest="command", required=True)
    ledger = commands.add_parser("ledger")
    ledger_commands = ledger.add_subparsers(dest="ledger_command", required=True)

    snapshot = ledger_commands.add_parser("snapshot")
    snapshot.add_argument("--bundle", required=True)
    snapshot.add_argument("--out", required=True)

    diff = ledger_commands.add_parser("diff")
    diff.add_argument("--from", dest="from_path", required=True)
    diff.add_argument("--to", dest="to_path", required=True)

    args = parser.parse_args()
    if args.ledger_command == "snapshot":
        result = compile_snapshot(args.bundle, args.out)
        print(json.dumps(result.manifest, indent=2, sort_keys=True))
    else:
        result = diff_snapshots(args.from_path, args.to_path)
        print(json.dumps(result.to_dict(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()


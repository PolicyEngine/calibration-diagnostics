from __future__ import annotations

import argparse
import json

from .snapshot import compile_snapshot, diff_snapshots
from .update_review import compile_update_review, publish_update_review


def main() -> None:
    parser = argparse.ArgumentParser(prog="evaluation-harness")
    commands = parser.add_subparsers(dest="command", required=True)
    chronicle = commands.add_parser("chronicle")
    chronicle_commands = chronicle.add_subparsers(dest="chronicle_command", required=True)

    snapshot = chronicle_commands.add_parser("snapshot")
    snapshot.add_argument("--bundle", required=True)
    snapshot.add_argument("--out", required=True)

    diff = chronicle_commands.add_parser("diff")
    diff.add_argument("--from", dest="from_path", required=True)
    diff.add_argument("--to", dest="to_path", required=True)

    review = chronicle_commands.add_parser("review")
    review.add_argument("--from", dest="from_path", required=True)
    review.add_argument("--to", dest="to_path", required=True)
    review.add_argument(
        "--integration",
        dest="integrations",
        required=True,
        action="append",
        help="Integration directory or overview.yaml; repeat for every active source.",
    )
    review.add_argument("--out", required=True)

    args = parser.parse_args()
    if args.chronicle_command == "snapshot":
        result = compile_snapshot(args.bundle, args.out)
        print(json.dumps(result.manifest, indent=2, sort_keys=True))
    elif args.chronicle_command == "diff":
        result = diff_snapshots(args.from_path, args.to_path)
        print(json.dumps(result.to_dict(), indent=2, sort_keys=True))
    else:
        document = compile_update_review(
            args.from_path,
            args.to_path,
            args.integrations,
        )
        manifest = publish_update_review(document, args.out)
        print(
            json.dumps(
                {"manifest": manifest, "review": document},
                indent=2,
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()

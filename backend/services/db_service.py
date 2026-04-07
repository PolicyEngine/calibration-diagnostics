"""SQLModel ORM queries against policy_data.db."""

from sqlmodel import Session, select

from policyengine_us_data.db.create_database_tables import (
    Stratum,
    StratumConstraint,
    Target,
)


def batch_get_all_stratum_constraints(session: Session) -> dict[int, list[dict]]:
    """Return all constraints grouped by stratum_id in a single query."""
    all_constraints = session.exec(select(StratumConstraint)).all()
    result: dict[int, list[dict]] = {}
    for c in all_constraints:
        result.setdefault(c.stratum_id, []).append({
            "variable": c.constraint_variable,
            "operation": c.operation,
            "value": c.value,
        })
    return result


def get_target_provenance(
    session: Session,
    target_id: int,
) -> dict | None:
    """Full target metadata including stratum constraints."""
    target = session.get(Target, target_id)
    if target is None:
        return None

    constraints = session.exec(
        select(StratumConstraint).where(
            StratumConstraint.stratum_id == target.stratum_id
        )
    ).all()

    return {
        "target_id": target.target_id,
        "variable": target.variable,
        "value": target.value,
        "period": target.period,
        "source": target.source,
        "tolerance": target.tolerance,
        "notes": target.notes,
        "active": target.active,
        "stratum_id": target.stratum_id,
        "constraints": [
            {
                "variable": c.constraint_variable,
                "operation": c.operation,
                "value": c.value,
            }
            for c in constraints
        ],
    }


def search_targets(
    session: Session,
    pattern: str,
    active_only: bool = True,
) -> list[dict]:
    """Search targets by variable name pattern."""
    stmt = select(Target).where(Target.variable.like(f"%{pattern}%"))
    if active_only:
        stmt = stmt.where(Target.active == True)  # noqa: E712
    targets = session.exec(stmt).all()
    return [
        {
            "target_id": t.target_id,
            "variable": t.variable,
            "value": t.value,
            "period": t.period,
            "stratum_id": t.stratum_id,
            "source": t.source,
            "active": t.active,
        }
        for t in targets
    ]


def get_stratum_detail(
    session: Session,
    stratum_id: int,
) -> dict | None:
    """Stratum with constraints, children, and attached targets."""
    stratum = session.get(Stratum, stratum_id)
    if stratum is None:
        return None

    constraints = session.exec(
        select(StratumConstraint).where(
            StratumConstraint.stratum_id == stratum_id
        )
    ).all()

    children = session.exec(
        select(Stratum).where(Stratum.parent_stratum_id == stratum_id)
    ).all()

    targets = session.exec(
        select(Target).where(
            Target.stratum_id == stratum_id,
            Target.active == True,  # noqa: E712
        )
    ).all()

    return {
        "stratum_id": stratum.stratum_id,
        "parent_stratum_id": stratum.parent_stratum_id,
        "notes": stratum.notes,
        "constraints": [
            {
                "variable": c.constraint_variable,
                "operation": c.operation,
                "value": c.value,
            }
            for c in constraints
        ],
        "children": [
            {"stratum_id": ch.stratum_id, "notes": ch.notes}
            for ch in children
        ],
        "targets": [
            {
                "target_id": t.target_id,
                "variable": t.variable,
                "value": t.value,
                "period": t.period,
                "active": t.active,
            }
            for t in targets
        ],
    }


def get_target_constraints(
    session: Session,
    stratum_id: int,
) -> list[dict]:
    """Return all constraints for a stratum."""
    constraints = session.exec(
        select(StratumConstraint).where(
            StratumConstraint.stratum_id == stratum_id
        )
    ).all()
    return [
        {
            "variable": c.constraint_variable,
            "operation": c.operation,
            "value": c.value,
        }
        for c in constraints
    ]

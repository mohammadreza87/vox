#!/usr/bin/env python3
"""Validate Vox's planning graph and local references; optionally render its backlog.

Usage: python3 scripts/validate-vox-plan.py [--render]
Python 3.11+ additionally parses standalone agent TOML with the standard library.
This performs no model calls, product tests, external writes or deployment.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/implementation"


def render(data):
    lines = [
        "# Vox implementation backlog", "",
        "Generated from [BACKLOG.json](BACKLOG.json). "
        "All task status comes from that canonical file. Creating a plan does not implement it. "
        "Sizes describe complexity, not elapsed days. P0 is foundation; P1 is required before its "
        "associated capability is enabled; P2 is a follow-up.", "",
        "Every task has an independent reviewer. Capability dependencies apply only when enabling "
        "that capability; disabled features must be explicit in a release. Core device/provider "
        "qualification remains mandatory. Evidence stays empty until work is verified. "
        "Follow [QA_AND_RELEASE.md](QA_AND_RELEASE.md) "
        "for release gates.", "",
    ]
    for phase in data["phases"]:
        lines.extend([f"## {phase['id']} — {phase['name']}", ""])
        for task in (t for t in data["tasks"] if t["phase"] == phase["id"]):
            lines.extend([
                f"### {task['id']} — {task['title']}", "",
                f"**Owner:** `{task['owner']}` · **Reviewer:** `{task['reviewer']}` · "
                f"**Model:** `{task['model']}` · **Size:** {task['size']} · "
                f"**Priority:** {task['priority']} · **Status:** {task['status']}", "",
                f"**Requirements:** {', '.join(task['requirements'])}. "
                f"**Depends on:** {', '.join(task['depends_on']) or 'None'}.", "",
            ])
            for capability, deps in task.get("capability_dependencies", {}).items():
                lines.extend([f"**When enabling {capability}:** {', '.join(deps)}.", ""])
            if task.get("progress_note") or task.get("implementation_note"):
                lines.extend(["**Implementation progress:** " + (task.get("progress_note") or task["implementation_note"]), ""])
            lines.extend([task["scope"], "", "**Acceptance:**", ""])
            lines.extend("- [ ] " + item for item in task["acceptance_criteria"])
            lines.extend([
                "", "**Verification:** " + task["verification"], "",
                "**Deliverables:** " + "; ".join(task["deliverables"]) + ".", "",
            ])
            if task["evidence"]:
                lines.extend(["**Evidence:** " + json.dumps(task["evidence"], ensure_ascii=False), ""])
    (PLAN / "BACKLOG.md").write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    data = json.loads((PLAN / "BACKLOG.json").read_text())
    errors = []
    tasks = data["tasks"]
    by_id = {task["id"]: task for task in tasks}
    if len(by_id) != len(tasks):
        errors.append("Duplicate task IDs")
    phases = {p["id"] for p in data["phases"]}
    requirements = set(re.findall(r"\| (REQ-\d+) \|", (PLAN / "PLAN.md").read_text()))
    covered = set()
    agent_files = list((ROOT / ".codex/agents").glob("vox-*.toml"))
    agents = {}
    try:
        import tomllib
    except ImportError:
        tomllib = None
    for path in agent_files:
        raw = path.read_text()
        try:
            if tomllib is not None:
                agent = tomllib.loads(raw)
            else:
                agent = dict(re.findall(r'^([a-z_]+) = "([^"\n]*)"$', raw, re.M))
            name = agent["name"]
            if name in agents:
                errors.append(f"Duplicate agent: {name}")
            agents[name] = agent
            for key in ("name", "description", "model", "model_reasoning_effort"):
                if not agent.get(key):
                    errors.append(f"{path.name}: missing {key}")
            if tomllib is not None and not agent.get("developer_instructions"):
                errors.append(f"{path.name}: missing instructions")
            if agent["model"] not in {"gpt-6.1-sol", "gpt-6-luna"}:
                errors.append(f"{path.name}: unexpected model")
            skill = ROOT / ".agents/skills" / name.replace("_", "-") / "SKILL.md"
            if not skill.exists() or str(skill.relative_to(ROOT)) not in raw:
                errors.append(f"{name}: missing assigned skill/reference")
        except (KeyError, ValueError) as exc:
            errors.append(f"{path.name}: {exc}")
    for task in tasks:
        prefix = task["id"]
        if task["phase"] not in phases:
            errors.append(f"{prefix}: unknown phase")
        if task["owner"] == task["reviewer"]:
            errors.append(f"{prefix}: author is sole reviewer")
        for role in (task["owner"], task["reviewer"]):
            if role not in agents:
                errors.append(f"{prefix}: unknown role {role}")
        if task["owner"] in agents and task["model"] != agents[task["owner"]]["model"]:
            errors.append(f"{prefix}: model disagrees with role")
        if not task["acceptance_criteria"] or not task["verification"] or not task["deliverables"]:
            errors.append(f"{prefix}: incomplete task")
        if task["status"] in {"complete", "done"} and not task["evidence"]:
            errors.append(f"{prefix}: completed without evidence")
        for req in task["requirements"]:
            covered.add(req)
            if req not in requirements:
                errors.append(f"{prefix}: unknown requirement {req}")
        deps = task["depends_on"] + [dep for values in task.get("capability_dependencies", {}).values() for dep in values]
        for dep in deps:
            if dep not in by_id or dep == prefix:
                errors.append(f"{prefix}: invalid dependency {dep}")
    for req in sorted(requirements - covered):
        errors.append(f"Requirement has no task: {req}")
    visited, active = set(), set()

    def visit(key):
        if key in active:
            errors.append(f"Dependency cycle at {key}")
            return
        if key in visited or key not in by_id:
            return
        active.add(key)
        task = by_id[key]
        for dep in task["depends_on"] + [dep for vals in task.get("capability_dependencies", {}).values() for dep in vals]:
            visit(dep)
        active.remove(key)
        visited.add(key)

    for key in by_id:
        visit(key)
    if args.render and not errors:
        render(data)
    checked_links = 0
    for path in list(PLAN.glob("*.md")) + list((ROOT / ".agents/skills").glob("vox-*/SKILL.md")):
        text = path.read_text()
        if text.count("```") % 2:
            errors.append(f"Unbalanced code fence: {path.relative_to(ROOT)}")
        for target in re.findall(r"\]\(([^)]+)\)", text):
            target = target.strip("<>")
            if re.match(r"(?:https?://|mailto:|#)", target):
                continue
            target = target.split("#", 1)[0]
            if not target:
                continue
            match = re.match(r"^(.*):(\d+)$", target)
            line = int(match[2]) if match else None
            target = match[1] if match else target
            resolved = Path(target) if target.startswith("/") else path.parent / target
            checked_links += 1
            if not resolved.exists():
                errors.append(f"Missing link from {path.name}: {target}")
            elif line and resolved.is_file() and line > len(resolved.read_text().splitlines()):
                errors.append(f"Invalid line from {path.name}: {target}:{line}")
    print(json.dumps({"tasks": len(tasks), "phases": len(phases), "requirements": len(requirements),
                      "agents": len(agents), "checked_local_links": checked_links,
                      "toml_parse": "passed" if tomllib is not None else "UNAVAILABLE: use Python 3.11+",
                      "errors": errors}, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

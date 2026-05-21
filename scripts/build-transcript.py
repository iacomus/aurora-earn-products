#!/usr/bin/env python3
"""
build-transcript.py — render Claude Code session logs into a readable Markdown
transcript for the Aurora Bank assessment submission.

It reads every ``*.jsonl`` session log in a directory, drops harness noise
(hook output, file-history snapshots, context injections, internal metadata),
reconciles the one rewound-fork session pair, and writes a single
``ai-transcript.md``.

Rendering choices (agreed during planning):
  * human prompts and Claude's replies  -> verbatim
  * slash-command / skill invocations   -> one-line notes
  * tool calls                          -> compact one-liners
  * tool results                        -> truncated to 20 lines (errors: full)
  * Claude's thinking                   -> kept, inside collapsed <details>
  * a rewound fork                      -> both branches, the fork de-duplicated
                                           to just its divergent messages
  * timestamps                          -> America/Los_Angeles (local)

Usage:
    python3 scripts/build-transcript.py [JSONL_DIR] [OUTPUT_FILE]

Defaults:
    JSONL_DIR    ~/.claude/projects/-Users-james-dev-pws-se-assessment-20260506
    OUTPUT_FILE  ai-transcript.md
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

# --- timezone -------------------------------------------------------------
# Every session ran in May 2026 in America/Los_Angeles (PDT, UTC-7). Use the
# real zone if tz data is available; fall back to a fixed PDT offset.
try:
    from zoneinfo import ZoneInfo

    LOCAL_TZ = ZoneInfo("America/Los_Angeles")
except Exception:  # pragma: no cover - fallback for missing tz database
    LOCAL_TZ = timezone(timedelta(hours=-7))

DEFAULT_DIR = os.path.expanduser(
    "~/.claude/projects/-Users-james-dev-pws-se-assessment-20260506"
)

# Record types that carry no conversation content — harness bookkeeping only.
NOISE_TYPES = {
    "file-history-snapshot",
    "queue-operation",
    "permission-mode",
    "last-prompt",
    "ai-title",
    "agent-name",
    "custom-title",
    "attachment",
}

TOOL_RESULT_MAX_LINES = 20

# Populated by main(): AskUserQuestion tool-call id -> its `questions` list, so
# each result can be rendered against the question(s) it answered.
ASKQ_INPUTS: dict = {}

# Harness wrapper tags stripped from human messages so the transcript shows
# what the user actually typed, not injected context. `task-notification` is a
# background-agent completion ping injected as a user turn — not a real prompt.
WRAPPER_TAGS = (
    "system-reminder",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-caveat",
    "task-notification",
)


# --- parsing helpers ------------------------------------------------------
def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_local(dt: datetime | None) -> str:
    if dt is None:
        return "?"
    return dt.astimezone(LOCAL_TZ).strftime("%Y-%m-%d %H:%M")


def load_file(path: str) -> list[dict]:
    records: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def strip_tags(text: str, *tags: str) -> str:
    for tag in tags:
        text = re.sub(rf"<{tag}>.*?</{tag}>", "", text, flags=re.DOTALL)
    return text


def extract_command(text: str) -> str | None:
    match = re.search(r"<command-name>(.*?)</command-name>", text, re.DOTALL)
    return match.group(1).strip() if match else None


def fence_for(body: str) -> str:
    """A backtick fence guaranteed longer than any run inside ``body``."""
    longest = max((len(run) for run in re.findall(r"`+", body)), default=0)
    return "`" * max(3, longest + 1)


# --- rendering ------------------------------------------------------------
def render_tool_use(item: dict) -> str:
    name = item.get("name", "?")
    inp = item.get("input", {}) or {}

    if name == "Bash":
        lines = (inp.get("command", "") or "").strip().splitlines()
        first = lines[0] if lines else ""
        if len(first) > 110:
            first = first[:110] + "…"
        more = "  *(+ more lines)*" if len(lines) > 1 else ""
        return f"- 🔧 **Bash** — `{first}`{more}"
    if name in ("Read", "Edit", "Write", "NotebookEdit"):
        return f"- 🔧 **{name}** — `{inp.get('file_path', '?')}`"
    if name == "Skill":
        return f"- 🔧 **Skill** — `{inp.get('skill', '?')}`"
    if name in ("Task", "Agent"):
        sub = inp.get("subagent_type", "agent")
        return f"- 🔧 **Task** ({sub}) — {inp.get('description', '')}"
    if name in ("Grep", "Glob"):
        return f"- 🔧 **{name}** — `{inp.get('pattern', '?')}`"
    if name == "TodoWrite":
        return "- 🔧 **TodoWrite**"
    if name == "AskUserQuestion":
        return render_askq_prompt(inp.get("questions", []) or [])
    if name == "WebFetch":
        return f"- 🔧 **WebFetch** — {inp.get('url', '?')}"
    if name == "WebSearch":
        return f"- 🔧 **WebSearch** — `{inp.get('query', '?')}`"
    if name == "ToolSearch":
        return f"- 🔧 **ToolSearch** — `{inp.get('query', '?')}`"

    compact = json.dumps(inp, ensure_ascii=False)
    if len(compact) > 140:
        compact = compact[:140] + "…"
    return f"- 🔧 **{name}** — `{compact}`"


def render_askq_prompt(questions: list) -> str:
    """Render an AskUserQuestion call — a decision Claude put to the developer."""
    out = ["### ❓ Claude asked the developer to decide\n"]
    for q in questions:
        if not isinstance(q, dict):
            continue
        header = q.get("header", "").strip()
        qtext = q.get("question", "").strip()
        multi = " *(select multiple)*" if q.get("multiSelect") else ""
        out.append(f"**{header}{multi}** — {qtext}\n")
        for opt in q.get("options", []) or []:
            if isinstance(opt, dict):
                label = opt.get("label", "").strip()
                desc = opt.get("description", "").strip()
                out.append(f"- **{label}** — {desc}")
        out.append("")
    return "\n".join(out).rstrip()


def parse_askq_answers(result: str, question_texts: list) -> dict:
    """Slice each answer out of an AskUserQuestion result string.

    The result reads: `Your questions have been answered: "Q1"="A1", "Q2"="A2".`
    Answers can themselves contain quotes, so each one is sliced between the
    exact (known) question markers rather than parsed by a quote-counting regex.
    """
    answers: dict = {}
    for i, question in enumerate(question_texts):
        marker = f'"{question}"="'
        start = result.find(marker)
        if start == -1:
            continue
        a_start = start + len(marker)
        a_end = len(result)
        if i + 1 < len(question_texts):
            nxt = result.find(f'", "{question_texts[i + 1]}"="', a_start)
            if nxt != -1:
                a_end = nxt
        else:
            suffix = result.rfind('". You can now continue')
            if suffix >= a_start:
                a_end = suffix
        answers[i] = result[a_start:a_end].strip()
    return answers


def render_askq_answer(item: dict, questions: list) -> str:
    """Render an AskUserQuestion result — the developer's choice or typed reply."""
    result = result_to_text(item.get("content", "")).strip()
    q_texts = [q.get("question", "") for q in questions if isinstance(q, dict)]
    answers = parse_askq_answers(result, q_texts)

    out = ["### ✅ Developer's decision\n"]
    rendered_any = False
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        answer = answers.get(i, "").strip()
        if answer:
            rendered_any = True
            header = q.get("header", "").strip() or "Answer"
            out.append(f"**{header}:** {answer}\n")
    if not rendered_any:
        # Couldn't anchor the answers — show the raw result rather than hide it.
        return "### ✅ Developer's decision\n\n" + result
    return "\n".join(out).rstrip()


def result_to_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(item.get("text", ""))
                else:
                    parts.append(f"[{item.get('type', 'content')}]")
        return "\n".join(parts)
    return str(content)


def render_tool_result(item: dict) -> str:
    # An AskUserQuestion result is the developer making a decision — render it
    # in full as their voice, not as a collapsed tool result.
    askq = ASKQ_INPUTS.get(item.get("tool_use_id"))
    if askq is not None:
        return render_askq_answer(item, askq)

    text = result_to_text(item.get("content", "")).rstrip()
    is_error = bool(item.get("is_error"))
    lines = text.splitlines()

    if not is_error and len(lines) > TOOL_RESULT_MAX_LINES:
        omitted = len(lines) - TOOL_RESULT_MAX_LINES
        body = "\n".join(lines[:TOOL_RESULT_MAX_LINES])
        body += f"\n[… {omitted} more line(s) truncated …]"
    else:
        body = text

    label = "⚠️ tool result (error)" if is_error else "↳ tool result"
    if not body.strip():
        return f"_{label}: (empty)_"
    fence = fence_for(body)
    return (
        f"<details><summary>{label}</summary>\n\n"
        f"{fence}\n{body}\n{fence}\n\n</details>"
    )


def render_user(rec: dict) -> list[str]:
    """Render a user-role record: a human prompt, a slash command, or results."""
    content = rec.get("message", {}).get("content")
    blocks: list[str] = []

    if isinstance(content, str):
        command = extract_command(content)
        if command:
            blocks.append(f"> ⌨️ *slash command* — **{command}**")
        residual = strip_tags(content, "command-name", *WRAPPER_TAGS).strip()
        if residual:
            blocks.append("### 👤 Human\n\n" + residual)
        return blocks

    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                residual = strip_tags(item.get("text", ""), *WRAPPER_TAGS).strip()
                if residual:
                    blocks.append("### 👤 Human\n\n" + residual)
            elif item.get("type") == "tool_result":
                blocks.append(render_tool_result(item))
    return blocks


def render_assistant(rec: dict) -> list[str]:
    """Render an assistant-role record: thinking, text, and/or tool calls."""
    content = rec.get("message", {}).get("content")
    blocks: list[str] = []

    if isinstance(content, str):
        if content.strip():
            blocks.append("### 🤖 Claude\n\n" + content.strip())
        return blocks

    if not isinstance(content, list):
        return blocks

    has_prose = any(
        isinstance(i, dict) and i.get("type") in ("text", "thinking") and
        (i.get("text") or i.get("thinking", "")).strip()
        for i in content
    )
    if has_prose:
        blocks.append("### 🤖 Claude")

    for item in content:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind == "thinking":
            thinking = item.get("thinking", "").strip()
            if thinking:
                blocks.append(
                    "<details><summary>💭 Thinking</summary>\n\n"
                    f"{thinking}\n\n</details>"
                )
        elif kind == "text":
            text = item.get("text", "").strip()
            if text:
                blocks.append(text)
        elif kind == "tool_use":
            blocks.append(render_tool_use(item))
    return blocks


# --- session assembly -----------------------------------------------------
def session_metadata(records: list[dict]) -> dict:
    ai_title = custom_title = branch = version = None
    for rec in records:
        rec_type = rec.get("type")
        if rec_type == "ai-title":
            ai_title = rec.get("aiTitle") or ai_title
        elif rec_type == "custom-title":
            custom_title = rec.get("customTitle") or custom_title
        branch = branch or rec.get("gitBranch")
        version = version or rec.get("version")
    return {
        "title": custom_title or ai_title,
        "branch": branch,
        "version": version,
    }


def render_session(records: list[dict], exclude_uuids: set[str]) -> dict:
    blocks: list[str] = []
    human_count = 0
    thinking_count = 0
    decision_count = 0
    first_ts: datetime | None = None
    last_ts: datetime | None = None

    for rec in records:
        if rec.get("uuid") and rec["uuid"] in exclude_uuids:
            continue
        ts = parse_ts(rec.get("timestamp"))
        if ts:
            first_ts = first_ts or ts
            last_ts = ts

        rec_type = rec.get("type")
        if rec_type in NOISE_TYPES or rec_type == "system":
            continue
        # `isMeta` user records are injected skill bodies, not conversation.
        if rec.get("isMeta"):
            continue
        message = rec.get("message")
        if not isinstance(message, dict):
            continue

        if rec_type == "user":
            rendered = render_user(rec)
        elif rec_type == "assistant":
            content = message.get("content")
            if isinstance(content, list):
                thinking_count += sum(
                    1 for i in content
                    if isinstance(i, dict) and i.get("type") == "thinking"
                )
                decision_count += sum(
                    1 for i in content
                    if isinstance(i, dict) and i.get("type") == "tool_use"
                    and i.get("name") == "AskUserQuestion"
                )
            rendered = render_assistant(rec)
        else:
            rendered = []

        human_count += sum(1 for b in rendered if b.startswith("### 👤"))
        blocks.extend(rendered)

    return {
        "blocks": blocks,
        "human_count": human_count,
        "thinking_count": thinking_count,
        "decision_count": decision_count,
        "first_ts": first_ts,
        "last_ts": last_ts,
    }


def main() -> None:
    args = sys.argv[1:]
    jsonl_dir = args[0] if len(args) > 0 else DEFAULT_DIR
    out_path = args[1] if len(args) > 1 else "ai-transcript.md"

    paths = sorted(glob.glob(os.path.join(jsonl_dir, "*.jsonl")))
    if not paths:
        sys.exit(f"No .jsonl files found in {jsonl_dir}")

    loaded = {path: load_file(path) for path in paths}

    # Index every AskUserQuestion call by id, so its result can be rendered
    # against the question(s) and options the developer chose between.
    for records in loaded.values():
        for rec in records:
            msg = rec.get("message")
            content = msg.get("content") if isinstance(msg, dict) else None
            if not isinstance(content, list):
                continue
            for item in content:
                if (isinstance(item, dict)
                        and item.get("type") == "tool_use"
                        and item.get("name") == "AskUserQuestion"):
                    ASKQ_INPUTS[item.get("id")] = (
                        item.get("input", {}).get("questions", []) or []
                    )

    # Identify the rewound fork: a file whose records carry `forkedFrom`.
    parent_of: dict[str, str] = {}  # session id -> parent session id
    for path, records in loaded.items():
        for rec in records:
            forked = rec.get("forkedFrom")
            if isinstance(forked, dict) and forked.get("sessionId"):
                parent_of[session_id(path)] = forked["sessionId"]
                break

    uuids_by_session = {
        session_id(p): {r["uuid"] for r in recs if r.get("uuid")}
        for p, recs in loaded.items()
    }

    def first_timestamp(path: str) -> datetime:
        for rec in loaded[path]:
            ts = parse_ts(rec.get("timestamp"))
            if ts:
                return ts
        return datetime.max.replace(tzinfo=timezone.utc)

    # Order sessions chronologically; a fork sorts immediately after its parent.
    ordered = sorted(
        paths,
        key=lambda p: (first_timestamp(p), session_id(p) in parent_of),
    )

    sessions = []
    for index, path in enumerate(ordered, start=1):
        sid = session_id(path)
        parent_sid = parent_of.get(sid)
        exclude = uuids_by_session.get(parent_sid, set()) if parent_sid else set()
        result = render_session(loaded[path], exclude)
        result["index"] = index
        result["path"] = path
        result["session_id"] = sid
        result["parent_sid"] = parent_sid
        result["meta"] = session_metadata(loaded[path])
        sessions.append(result)

    write_output(out_path, sessions)


def session_id(path: str) -> str:
    return os.path.basename(path)[:-6]  # strip ".jsonl"


def write_output(out_path: str, sessions: list[dict]) -> None:
    index_by_sid = {s["session_id"]: s["index"] for s in sessions}
    total_prompts = sum(s["human_count"] for s in sessions)
    total_thinking = sum(s["thinking_count"] for s in sessions)
    total_decisions = sum(s["decision_count"] for s in sessions)

    lines: list[str] = []
    lines.append("# AI Transcript — Aurora Bank Earn Products Service\n")
    lines.append(
        "Full transcript of the Claude Code sessions used to build this "
        "assessment submission, rendered from the raw session logs.\n"
    )
    lines.append("**How to read this file:**\n")
    lines.append(
        "- Sessions appear in chronological order. Timestamps are local "
        "(America/Los_Angeles).\n"
        "- 👤 Human = prompts typed by the developer, verbatim. "
        "🤖 Claude = Claude's replies, verbatim.\n"
        "- 🔧 lines are tool calls; each tool result follows in a collapsed "
        "block, truncated to 20 lines (errors shown in full).\n"
        "- ❓ / ✅ blocks are `AskUserQuestion` exchanges — Claude posing a "
        "decision with options, and the developer's choice or typed reply. "
        "These are shown in full: they are the developer directing the work.\n"
        f"- Claude's internal *thinking* is **not shown**: Claude Code's logs "
        f"record that thinking occurred (with a verification signature) but do "
        f"not persist its text. {total_thinking} thinking steps ran across "
        f"these sessions; only the visible exchange is recoverable.\n"
        "- Harness noise (hook output, injected skill text, background-task "
        "notifications, context injections, file snapshots) is omitted.\n"
        "- One session is a *rewound fork* of another: its shared opening "
        "messages are shown once, under the parent session.\n"
    )
    lines.append(
        f"**Sessions:** {len(sessions)} · "
        f"**Human prompts:** {total_prompts} · "
        f"**Guided decisions (AskUserQuestion):** {total_decisions}\n"
    )

    lines.append("| # | Session | When (local) | Prompts | Decisions |")
    lines.append("|---|---|---|---|---|")
    for s in sessions:
        title = s["meta"]["title"] or "(untitled)"
        when = fmt_local(s["first_ts"])
        lines.append(
            f"| {s['index']} | {title} | {when} | "
            f"{s['human_count']} | {s['decision_count']} |"
        )
    lines.append("")
    lines.append("---\n")

    for s in sessions:
        meta = s["meta"]
        title = meta["title"] or "(untitled session)"
        lines.append(f"## Session {s['index']} — {title}\n")

        facts = [
            f"{fmt_local(s['first_ts'])} → {fmt_local(s['last_ts'])}",
            f"{s['human_count']} human prompt(s)",
        ]
        if s["decision_count"]:
            facts.append(f"{s['decision_count']} guided decision(s)")
        if meta["branch"]:
            facts.append(f"branch `{meta['branch']}`")
        if meta["version"]:
            facts.append(f"Claude Code {meta['version']}")
        lines.append("*" + "  ·  ".join(facts) + "*\n")

        if s["parent_sid"]:
            parent_index = index_by_sid.get(s["parent_sid"])
            ref = f"Session {parent_index}" if parent_index else "the parent session"
            lines.append(
                f"> ⚠️ **Rewound fork of {ref}.** The conversation was rewound "
                f"and continued down a different path. The shared opening "
                f"messages appear under {ref}; only this branch's divergent "
                f"messages are shown below.\n"
            )

        lines.append(f"<sub>source log: `{s['session_id']}.jsonl`</sub>\n")

        if s["blocks"]:
            lines.append("\n\n".join(s["blocks"]))
        else:
            lines.append("_(no conversation content in this session)_")
        lines.append("\n---\n")

    text = "\n".join(lines).rstrip() + "\n"
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(text)

    size_kb = len(text.encode("utf-8")) / 1024
    print(
        f"Wrote {out_path}: {len(sessions)} sessions, "
        f"{total_prompts} human prompts, "
        f"{text.count(chr(10)) + 1} lines, {size_kb:.0f} KB",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

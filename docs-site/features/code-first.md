# The Code-First Principle

CAP Pro is built on a single conviction: **code is the plan**. Documents about code drift the moment code changes; the code itself does not. So we make the code the source of truth and let the planning artefacts derive from it, not the other way around.

## The conventional flow (and why it fails)

Most engineering frameworks — agile, waterfall, "design-first", "doc-first", whatever you call it — follow some variant of:

```
plan → spec → design → implement → verify → ship
```

The plan and the spec exist *before* the code does. They are written by people who do not yet know what the code will look like, because the code does not exist yet. Then someone writes the code. The plan and the spec immediately start drifting from the code, because:

- Refactors don't update the spec
- Edge cases that surface in implementation don't update the plan
- The code is more honest about what's hard than the spec was

A month later, the only authoritative description of "what does the system do" is the code. The plan and the spec are wishful thinking about what someone hoped to build.

CAP Pro accepts this reality and inverts the flow.

## The Code-First flow

```
brainstorm → prototype → iterate → test → review
                │           │         │
                └─tags───────┴─tests───┘
                       │
                       ▼
                 FEATURE-MAP.md
            (auto-derived, always-fresh)
```

You build the prototype first. The prototype carries `@cap-feature` and `@cap-todo` tags inline. CAP Pro extracts those tags and updates `FEATURE-MAP.md` automatically. The Feature Map is *generated*, not *maintained*.

When the code changes, you re-scan, the Feature Map updates. There is no drift to worry about, because the plan literally is the code, viewed through a different lens.

## What you give up

To get this, you give up:

- **Comprehensive upfront design**. CAP Pro lets you do *some* upfront design (the `prototype --architecture` mode is for that), but discourages 200-page design docs that go stale.
- **Reading the spec before reading the code**. In a CAP Pro project, you read the Feature Map for a 30-second overview, then jump to the tagged code for the truth. If the Feature Map says one thing and the code says another, the code wins.
- **Estimation comfort blanket**. CAP Pro is honest: you don't know how long something takes until you've prototyped it. The brainstorm step doesn't ask for estimates — it asks for ACs.

## What you get

- **Zero drift between plan and code**. By construction.
- **Faster iteration**. No "update the doc" step.
- **Better learning**. The prototype is the experiment. The code is the lab notebook.
- **Smaller cognitive load**. Two tags. Five workflow steps. Nine focused agents.
- **Honest progress tracking**. "Feature is `prototyped`" means there's working code with tags, not "we wrote a design doc and someone said 'looks good'".

## Aligned with Modern Software Engineering

This is not a new idea. Dave Farley calls it "optimise for learning and managing complexity". Kent Beck calls it "make the change easy, then make the easy change". Test-Driven Development is a special case of Code-First (the test is the spec, the code follows).

CAP Pro just gives the principle a workflow, a tag system, and a multi-agent runtime that scales it across teams.

## When NOT to use Code-First

- **Hard regulatory pre-commitment**. If you must produce a 200-page spec to satisfy auditors before writing a line of code, Code-First isn't legally viable. (Though the *post-facto* docs you generate from CAP Pro's tags are usually richer than the upfront ones.)
- **Pure architectural research**. If you're sketching a system that won't be built for six months, you don't need code yet — sketch in diagrams.
- **One-shot scripts**. If you're writing a 30-line shell script, all this ceremony is overkill. Just write the script.

For everything else — features, products, services, refactors — CAP Pro's Code-First flow is faster, more honest, and produces better documentation as a side effect.

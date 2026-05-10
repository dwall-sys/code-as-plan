# Prototype-Driven Development

The single most important practice in CAP Pro. Everything else is downstream of this.

## What it means

**Build a working prototype before writing the spec.** Not a sketch, not a "design proposal" doc, not a 30-slide deck — actual running code that does the thing, even if half of it is hardcoded and the other half is broken.

The prototype is your **first honest answer** to "what does this look like?". It will be wrong in ways the spec can't predict, and right in ways the spec wouldn't have captured. Both are valuable.

## Why it works

LLMs and humans share a failure mode: when planning in the abstract, both produce plans that look reasonable but fall apart on contact with reality. Prototype-driven development forces the contact early.

| Step | What you learn |
|---|---|
| Sketch in your head | Roughly what you want |
| Write a design doc | What you can articulate clearly |
| **Build a prototype** | **What's actually hard, what surprises you, what doesn't work the way you assumed** |
| Refine | Now you know |

Skipping the prototype step means the "Refine" step has to do all the learning, which is much more expensive.

## How to prototype well

### 1. Hardcode aggressively

The first prototype shouldn't worry about edge cases, configurability, error handling, or test coverage. Get the **happy path** working end-to-end first. Tag the gaps with `@cap-todo`:

```ts
// @cap-feature(feature:F-Auth-OAuth, ac:1) Sign in with GitHub
async function signInWithGitHub() {
  // @cap-todo(ac:F-Auth-OAuth/AC-2, risk:high) Replace hardcoded redirect URI
  const redirect = 'http://localhost:3000/callback';

  // @cap-todo(ac:F-Auth-OAuth/AC-3) Token storage — currently using localStorage
  const tokens = await fetchTokens(redirect);
  localStorage.setItem('tokens', JSON.stringify(tokens));

  return tokens;
}
```

The hardcoded redirect URI is fine — it's tagged. The localStorage choice is fine — it's tagged. CAP Pro will surface these in `/cap:scan` as open work.

### 2. One feature at a time

Don't prototype five features at once. Pick one, get it green-path working, tag the gaps, then move on. Multi-feature prototypes are where commitment escalates and learning compounds badly.

### 3. Throw away prototypes that don't work

A prototype that doesn't work is **not a failure** — it's a successful experiment that taught you the approach is wrong. Throw it away, start fresh, take the lesson.

CAP Pro's `cap-historian MODE: FORK` is built for this. Fork the snapshot, try a different approach, keep the divergence rationale. If the new branch works, promote it; if not, fall back to the parent.

### 4. Don't prematurely abstract

A common LLM failure mode is generating a `BaseFeatureFactory` and a `FeatureRegistry` and an `IFeatureProvider` interface for the **first** prototype. Don't.

> Three similar lines of code is better than a premature abstraction.

Abstract on the **third** instance, not the first. The Code-First flow makes this cheap because you're building real code, not framework scaffolding.

## When the prototype reveals the plan was wrong

This is the **most valuable outcome**. Examples:

- Brainstorm said "users will paginate at 20 items per page" — prototype reveals the dataset is small enough that pagination is a hindrance, not a feature. Update the Feature Map, drop the AC.
- Brainstorm said "we'll use SSE for live updates" — prototype reveals SSE is blocked by the corporate proxy. Switch to long-polling, document the decision in `decisions.md`.
- Brainstorm said "this should be one component" — prototype reveals it's actually three components with different lifecycles. Split, update Feature Map.

CAP Pro encourages updating the Feature Map mid-prototype. The Feature Map is generated from code, not the other way around.

## The prototype IS the spec

After the prototype is built and tagged, you can read the `@cap-feature` tags and have a perfectly accurate spec — better than any document you'd have written upfront, because it describes what actually works, not what someone hoped would work.

This is the whole point.

## Anti-patterns

- **"Let me just write the design doc first."** No. Sketch in your head for 5 minutes, then prototype.
- **"This prototype isn't production-ready, I should refactor it before tagging."** Tag it first, then refactor. The tags survive the refactor; the refactor without tags loses the spec context.
- **"I'll add tests after I'm sure the design is right."** Tests should be part of the iteration, not a separate phase. RED-GREEN tests are the cheapest way to lock in design decisions you don't want to lose.
- **"Let me build out all five features in parallel for efficiency."** It is not more efficient. It is exponentially less efficient. One at a time.

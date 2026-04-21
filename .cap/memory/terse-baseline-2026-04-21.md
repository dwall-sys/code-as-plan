# F-060 Baseline — Output-Zeichenzahl-Messung

**Gemessen am:** 2026-04-21
**Gemessen vor:** Rollout der Terseness-Rules (F-060 "Terse Agent Prompts")
**Branch:** `feature/F-060-terse-agent-prompts`
**Feature:** F-060 (Decision — keine AC)
**Proxy:** Zeichenzahl als grobes Token-Proxy (1 Token ≈ 4 Zeichen)

## Sessions

### Session 1: 7297eeca (2026-04-20)
- Total Assistant-Output-Chars: 20.990
- Main-Agent-Output-Chars: 20.990
- Sub-Agent-Output-Chars (Tool-Results aus Task-Spawns): 24.265
- Combined Session Total: 45.255 Chars (~11.313 Tokens)
- Assistant-Messages: 708
- Task-Spawns: 5 (ø ~4.853 Chars/Result)

### Session 2: 3346eab1 (2026-04-21)
- Total Assistant-Output-Chars: 23.894
- Main-Agent-Output-Chars: 23.894
- Sub-Agent-Output-Chars: 0 (keine Task-Results im Transcript erfasst)
- Combined Session Total: 23.894 Chars (~5.973 Tokens)
- Assistant-Messages: 837
- Task-Spawns: 1

### Session 3: 23d9488b (2026-04-21)
- Total Assistant-Output-Chars: 46.445
- Main-Agent-Output-Chars: 46.445
- Sub-Agent-Output-Chars: 106.093
- Combined Session Total: 152.538 Chars (~38.134 Tokens)
- Assistant-Messages: 426
- Task-Spawns: 16 (ø ~6.631 Chars/Result) — **Hotspot**

## Aggregates

- **Durchschnitt Combined-Output pro Session:** ~73.895 Chars (~18.473 Tokens)
- **Durchschnitt Main-Agent-Output:** ~30.443 Chars
- **Durchschnitt Sub-Agent-Output:** ~43.452 Chars
- **Sub-Agent-Anteil am Gesamtvolumen (3 Sessions kombiniert):** 58%
- **Hotspot-Referenz:** Session 3 mit ~38.000 Tokens

## Messbasis für Post-Rollout-Vergleich

Nach Merge von F-060 (Rules aktiv in cap-prototyper, cap-reviewer, cap-brainstormer, cap-debugger) sollen 3 äquivalent-strukturierte Sessions (vergleichbare Task-Spawn-Verteilung) erneut vermessen werden.

**Vergleichsmetriken:**
- Total-Output-Chars-Reduktion in %
- Sub-Agent-Output-Reduktion in % (primärer Wirkungsbereich)
- Main-Agent-Reduktion in % (universelle Rules wirken auch hier)

**Zielmarge laut Brainstorm:** 15–25% Output-Token-Reduktion im Schnitt (nicht blockierend, kein AC).

## Methodik

- Main-Agent-Output über Assistant-Messages mit `parentUuid == null` gemessen.
- Sub-Agent-Output über Tool-Results von Task-Tool-Spawns (`tool_name: "Task"`) ermittelt.
- Per-Agent-Breakdown (cap-prototyper vs cap-reviewer vs ...) konnte nicht isoliert werden — `input.subagent_type` war aus Transcripts nicht reliable extrahierbar.

## Limitationen

- Zeichenzahl ≠ exakte Token-Zahl (Faktor variiert je nach Text-Typ).
- 3 Sessions sind Stichprobe, keine statistisch belastbare Baseline.
- Sub-Agent-Output wurde in Session 2 als 0 erfasst (1 Task-Spawn ohne Result im Transcript) — evtl. unvollständiger Log.
- Session 3 ist ein deutlicher Outlier (16 Spawns vs 1–5 in anderen); Durchschnitt dadurch verzerrt. Median wäre robuster, aber N=3 zu klein.

## Verwendete Raw-Daten

Source: `/Users/denniswall/.claude/projects/-Users-denniswall-Desktop-code-as-plan-code-as-plan/*.jsonl`

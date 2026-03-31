# GSD Code-First Fork — Implementierungsleitfaden

**Ziel:** Einen installierbaren Fork von GSD erstellen, der das Code-First-Prinzip umsetzt.
**Tool:** Claude Code + GSD als Orchestrator
**Ergebnis:** `npx gsd-code-first@latest` installierbar für dich und deine Kollegen

---

## Schritt 0: Repository aufsetzen

### 0.1 Fork erstellen

```bash
# Auf GitHub: https://github.com/gsd-build/cap → "Fork" Button
# Dein Fork wird z.B.: github.com/gi-consulting/gsd-code-first

# Lokal clonen
git clone git@github.com:gi-consulting/gsd-code-first.git
cd gsd-code-first
```

### 0.2 Umbenennung vorbereiten

```bash
# package.json anpassen — Name ändern für npm publish
# Originalname: "cap-cc"
# Dein Name z.B.: "gsd-code-first" oder "@gi-consulting/gsd"
```

In `package.json` ändern:
```json
{
  "name": "gsd-code-first",
  "version": "2.0.0-alpha.1",
  "description": "Code-First fork of Get Shit Done — AI-native development with code-as-planning",
  "bin": {
    "gsd-code-first": "bin/install.js"
  }
}
```

### 0.3 GSD im Fork-Repo installieren (Meta!)

```bash
# GSD lokal installieren um es als Orchestrator zu nutzen
npx cap-cc --claude --local
```

### 0.4 Repo-Struktur verstehen

Bevor du loslegst, mach dir die Struktur klar. Die relevanten Ordner:

```
gsd-code-first/
├── agents/                    # ← Agent-Prompts (Markdown-Dateien)
│   ├── gsd-executor.md
│   ├── gsd-planner.md
│   ├── gsd-researcher.md
│   ├── gsd-orchestrator.md
│   ├── gsd-plan-checker.md
│   ├── gsd-verifier.md
│   ├── gsd-debugger.md
│   ├── gsd-codebase-mapper.md
│   ├── gsd-prototyper.md      # NEU — zu erstellen
│   ├── gsd-code-planner.md    # NEU — zu erstellen
│   └── gsd-annotator.md       # NEU — zu erstellen
│
├── commands/gsd/              # ← Slash-Commands (Markdown-Dateien)
│   ├── new-project.md
│   ├── plan-phase.md
│   ├── execute-phase.md
│   ├── discuss-phase.md
│   ├── verify-work.md
│   ├── quick.md
│   ├── prototype.md           # NEU — zu erstellen
│   ├── iterate.md             # NEU — zu erstellen
│   ├── deep-plan.md           # NEU — zu erstellen
│   ├── annotate.md            # NEU — zu erstellen
│   ├── extract-plan.md        # NEU — zu erstellen
│   └── set-mode.md            # NEU — zu erstellen
│
├── bin/
│   ├── install.js             # Installer — muss angepasst werden
│   └── gsd-tools.cjs          # Tooling (config, commits, init) — muss erweitert werden
│
├── cap/
│   ├── templates/             # Plan-/Doc-Templates
│   ├── references/            # Referenz-Dokumente für Agents
│   └── workflows/             # Workflow-Definitionen
│
└── .planning/                 # GSD-Artefakte für DIESES Projekt (den Fork selbst)
```

---

## Schritt 1: GSD für den Fork selbst initialisieren

Öffne Claude Code im Fork-Verzeichnis:

```bash
cd gsd-code-first
claude --dangerously-skip-permissions
```

### 1.1 Projekt initialisieren

```
/gsd:new-project
```

Wenn GSD nach dem Projekt fragt, beschreibe es so:

> **Projektbeschreibung:**
> Ich forke das GSD-Framework (cap) um es auf ein "Code-First"-Prinzip
> umzubauen. Der Kerngedanke: Statt für jede Phase discuss → plan → execute
> durchzulaufen, soll ein Prototyp DIREKT gebaut werden. Der Code wird mit
> strukturierten Kommentaren (@gsd-Tags, "ARC"-System) annotiert, und diese
> Kommentare dienen als Planung für weitere Iterationen.
>
> **Was sich ändert:**
> - 3 neue Agents (gsd-prototyper, gsd-code-planner, gsd-annotator)
> - 6 neue Commands (prototype, iterate, deep-plan, annotate, extract-plan, set-mode)
> - Modifikation bestehender Agents (executor bekommt ARC-Pflicht, planner kann Code lesen)
> - Config-Erweiterung (phase_modes, arc-settings)
> - gsd-tools.cjs Erweiterung (Tag-Scanner, neues init-Subcommand)
> - Installer-Anpassung (neuer Package-Name)
>
> **Technologie:**
> - JavaScript/Node.js (wie Original-GSD)
> - Markdown für Agent-Prompts und Commands
> - JSON für Config
>
> **Ziel:**
> Installierbares npm-Package: `npx gsd-code-first@latest`

### 1.2 PRD-Datei mitgeben

Noch besser — gib das Redesign-Dokument direkt mit:

```
/gsd:new-project --auto @GSD-REDESIGN-CODE-FIRST.md
```

Kopiere dafür die Redesign-Datei ins Fork-Root:

```bash
cp ~/Downloads/GSD-REDESIGN-CODE-FIRST.md ./GSD-REDESIGN-CODE-FIRST.md
```

### 1.3 Roadmap bestätigen

GSD wird eine Roadmap vorschlagen. Stelle sicher, dass die Phasen ungefähr so aussehen:

```
Phase 1: ARC-Standard + Tag-Scanner (extract-plan Command + Tooling)
Phase 2: gsd-prototyper Agent + prototype Command
Phase 3: gsd-code-planner Agent + iterate Command
Phase 4: Bestehende Agents modifizieren (executor, planner)
Phase 5: deep-plan + annotate + set-mode Commands
Phase 6: Config-System erweitern
Phase 7: Installer anpassen (Package-Name, neue Dateien)
Phase 8: Dokumentation + Help-Command
```

Falls GSD eine andere Reihenfolge vorschlägt, ist das okay — Hauptsache die Abhängigkeiten stimmen (Phase 1 muss zuerst, weil alles auf ARC aufbaut).

---

## Schritt 2: Phase für Phase durcharbeiten

### Phase 1: ARC-Standard + extract-plan

```
/gsd:plan-phase 1
```

**Was hier passieren muss:**

1. **Referenz-Dokument erstellen:** `cap/references/arc-standard.md`
   - Alle @gsd-Tags definieren (context, decision, todo, constraint, pattern, ref, risk, api)
   - Syntax-Regeln (wo im Code, Format, Phase-Referenz-Syntax)
   - Beispiele pro Sprache (TypeScript, Python, etc.)

2. **Tag-Scanner in gsd-tools.cjs:**
   - Neues Subcommand: `gsd-tools.cjs extract-tags [--phase N] [--format md|json]`
   - Regex/Pattern-Matching für `@gsd-*` Tags
   - Gruppierung nach Phase-Referenz
   - Output: JSON (für Agents) und Markdown (CODE-INVENTORY.md)

3. **extract-plan Command:** `commands/gsd/extract-plan.md`
   - Ruft `gsd-tools.cjs extract-tags` auf
   - Schreibt `.planning/prototype/CODE-INVENTORY.md`
   - Zeigt Summary im Terminal

**Testbar:** Nach Phase 1 solltest du in irgendeinem Testprojekt manuell @gsd-Tags in Code schreiben und `/gsd:extract-plan` ausführen können.

```
/gsd:execute-phase 1
```

### Phase 2: Prototyper

```
/gsd:plan-phase 2
```

**Was hier passieren muss:**

1. **Agent erstellen:** `agents/gsd-prototyper.md`
   - System-Prompt wie im Redesign-Dokument Abschnitt 5.1
   - Muss ARC-Standard als Referenz laden
   - Muss CLAUDE.md-Enforcement haben (wie gsd-executor)

2. **Command erstellen:** `commands/gsd/prototype.md`
   - Liest PROJECT.md, REQUIREMENTS.md, ROADMAP.md
   - Spawnt gsd-prototyper mit zusammengebautem Kontext
   - Flags: `--phases <range>`, `--skip-annotate`
   - Nach Completion: Ruft automatisch `extract-plan` auf

3. **Template:** `cap/templates/PROTOTYPE-LOG.md`
   - Was wurde gebaut, welche Entscheidungen, welche @gsd-todos offen

**WICHTIG:** Schau dir an, wie `commands/gsd/quick.md` den Agent spawnt — das ist dein Template für den Prototype-Command. Quick mode ist am ähnlichsten zu dem, was du baust (weniger Overhead, direktes Ausführen).

```
/gsd:execute-phase 2
```

### Phase 3: Code-Planner + Iterate

```
/gsd:plan-phase 3
```

**Was hier passieren muss:**

1. **Agent erstellen:** `agents/gsd-code-planner.md`
   - Liest Code + @gsd-Tags als primären Input
   - Erzeugt kompakten Markdown-Plan (kein XML)
   - Kein Research, kein Plan-Check

2. **Command erstellen:** `commands/gsd/iterate.md`
   - Workflow: extract-tags → code-planner → User-Approval → executor
   - Flags: `--verify`, `--annotate`
   - Muss gsd-tools.cjs `init iterate` aufrufen

3. **gsd-tools.cjs erweitern:**
   - Neues init-Subcommand: `init iterate <phase>`
   - Gibt dem Command die nötigen Pfade und Config zurück

**Schau dir an:** Wie `commands/gsd/plan-phase.md` und `commands/gsd/execute-phase.md` die init-Chain aufbauen. Dein iterate-Command kombiniert beides in einem leichteren Flow.

```
/gsd:execute-phase 3
```

### Phase 4: Bestehende Agents modifizieren

```
/gsd:plan-phase 4
```

**Was hier passieren muss:**

1. **gsd-executor.md modifizieren:**
   - ARC-Kommentar-Pflicht hinzufügen (Abschnitt 5.4 im Redesign)
   - @gsd-todo Tags nach Completion entfernen
   - Neue @gsd-decision Tags bei eigenen Entscheidungen setzen

2. **gsd-planner.md modifizieren:**
   - Neuer Modus: Code-basierte Planung (Abschnitt 5.5)
   - Wenn iterate-Modus: @gsd-Tags als primären Input lesen
   - Wenn deep-plan-Modus: wie bisher + Code-Tags als Zusatz

**VORSICHT:** Diese Phase ändert bestehende Dateien. Mach vorher:
```bash
git add -A && git commit -m "checkpoint: before agent modifications"
```

```
/gsd:execute-phase 4
```

### Phase 5-8: Rest

Ab hier ist der Ablauf analog. Die wichtigsten Hinweise:

**Phase 5 (deep-plan + annotate + set-mode):**
- `deep-plan.md` ist im Grunde ein Wrapper der `discuss-phase` + `plan-phase` zusammenruft
- `annotate.md` spawnt den gsd-annotator und ruft danach extract-plan auf
- `set-mode.md` schreibt in `.planning/config.json`

**Phase 6 (Config):**
- Erweitere den Config-Schema in gsd-tools.cjs
- Neue Felder: `workflow.default_phase_mode`, `phase_modes`, `arc`
- Settings-Command muss die neuen Optionen anbieten

**Phase 7 (Installer):**
- `bin/install.js` muss die neuen Agent-Dateien + Commands mitkopieren
- Package-Name in package.json
- Teste mit: `node bin/install.js --claude --local` in einem Testprojekt

**Phase 8 (Docs):**
- `commands/gsd/help.md` aktualisieren
- README.md für den Fork
- `docs/USER-GUIDE.md` mit neuem Workflow

---

## Schritt 3: Testen

### 3.1 Lokaler Test

```bash
# In einem neuen Testprojekt
mkdir ~/test-gsd-cf && cd ~/test-gsd-cf
node ~/gsd-code-first/bin/install.js --claude --local

# Claude Code starten
claude --dangerously-skip-permissions

# Testen:
/gsd:new-project
# → Beschreibe eine simple Next.js App
/gsd:prototype
# → Sollte direkt bauen, mit ARC-Kommentaren
/gsd:extract-plan
# → Sollte CODE-INVENTORY.md erzeugen
/gsd:iterate 2
# → Sollte aus Code planen und iterieren
```

### 3.2 Für Kollegen installierbar machen

**Option A: npm publish (öffentlich oder scoped)**

```bash
cd gsd-code-first

# Wenn öffentlich:
npm publish

# Wenn scoped (@gi-consulting):
npm publish --access public
```

Dann können Kollegen installieren mit:
```bash
npx gsd-code-first@latest
# oder
npx @gi-consulting/gsd@latest
```

**Option B: Direkt von GitHub (ohne npm)**

```bash
# Kollegen installieren direkt vom Repo:
npx github:gi-consulting/gsd-code-first

# Oder als git dependency:
git clone git@github.com:gi-consulting/gsd-code-first.git
cd gsd-code-first
node bin/install.js --claude --global
```

**Option C: Private npm Registry (für intern)**

Falls ihr eine private Registry habt (z.B. GitHub Packages):
```bash
npm publish --registry https://npm.pkg.github.com
```

---

## Schritt 4: Upstream-Updates mergen

Um Updates vom Original-GSD zu bekommen:

```bash
# Einmalig: Upstream remote hinzufügen
git remote add upstream https://github.com/gsd-build/cap.git

# Updates holen:
git fetch upstream
git merge upstream/main
# Konflikte in agents/ und commands/ manuell auflösen
```

**Tipp:** Da du primär NEUE Dateien hinzufügst (nicht bestehende ersetzt), werden Merge-Konflikte selten sein. Die Modifikationen an executor und planner sind die einzigen Konflikt-Kandidaten.

---

## Quick Reference: Die wichtigsten Dateien die du anfassen musst

```
NEUE DATEIEN (erstellen):
├── agents/gsd-prototyper.md          # Prototyp-Builder Agent
├── agents/gsd-code-planner.md        # Code-basierter Planner Agent
├── agents/gsd-annotator.md           # Nachträglicher Annotator Agent
├── commands/gsd/prototype.md         # /gsd:prototype Command
├── commands/gsd/iterate.md           # /gsd:iterate Command
├── commands/gsd/deep-plan.md         # /gsd:deep-plan Command
├── commands/gsd/annotate.md          # /gsd:annotate Command
├── commands/gsd/extract-plan.md      # /gsd:extract-plan Command
├── commands/gsd/set-mode.md          # /gsd:set-mode Command
└── cap/references/arc-standard.md  # ARC-Kommentar-Standard

BESTEHENDE DATEIEN (modifizieren):
├── agents/gsd-executor.md            # + ARC-Kommentar-Pflicht
├── agents/gsd-planner.md             # + Code-basierte Planung
├── bin/gsd-tools.cjs                 # + extract-tags, init iterate
├── bin/install.js                    # + neue Dateien mitkopieren
├── commands/gsd/help.md              # + neue Commands dokumentieren
├── commands/gsd/settings.md          # + neue Config-Optionen
└── package.json                      # Name, Version
```

---

## Tipp: Reihenfolge in Claude Code

Wenn du in Claude Code sitzt und loslegst, ist der effizienteste Weg:

```
1. /gsd:new-project --auto @GSD-REDESIGN-CODE-FIRST.md
2. Roadmap genehmigen
3. /gsd:plan-phase 1
4. /gsd:execute-phase 1
5. Manuell testen (extract-plan in Testprojekt)
6. Weiter mit Phase 2...
```

Nach jeder Phase: `git push` damit dein Fork auf GitHub aktuell ist.

Nach Phase 2 (Prototyper): Ironischerweise kannst du ab hier `/gsd:prototype` im Fork selbst ausprobieren, indem du ein Testprojekt damit baust. Dogfooding vom Feinsten.

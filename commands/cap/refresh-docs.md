---
name: cap:refresh-docs
description: Fetch or refresh library documentation via Context7 and store in .cap/stack-docs/ for agent context injection.
argument-hint: "<library-name> [--query \"question\"]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
---

<!-- @gsd-context CAP v2.0 refresh-docs command -- fetches library documentation via Context7 CLI and caches it in .cap/stack-docs/. Agents read these docs for library-specific context without burning tokens on web searches. -->
<!-- @gsd-decision Uses Context7 CLI (npx ctx7@latest) -- the user's CLAUDE.md already mandates Context7 for library docs. This command makes it a first-class workflow step. -->
<!-- @gsd-decision Docs cached in .cap/stack-docs/ -- persists across conversations, can be committed for offline use. -->
<!-- @gsd-pattern Each library gets its own file: .cap/stack-docs/{library-name}.md -->

<objective>
Fetches library documentation via Context7 and stores it in .cap/stack-docs/ for agent context injection.

**Arguments:**
- `library-name` -- the library to fetch docs for (e.g., "react", "express", "prisma")
- `--query "question"` -- specific question to focus the documentation fetch
</objective>

<context>
$ARGUMENTS
</context>

<process>

<!-- @gsd-todo Implement Step 1: Parse library name and optional query -->
<!-- @gsd-todo Implement Step 2: Run npx ctx7@latest library <name> to find library ID -->
<!-- @gsd-todo Implement Step 3: Run npx ctx7@latest docs <id> to fetch documentation -->
<!-- @gsd-todo Implement Step 4: Write fetched docs to .cap/stack-docs/{library-name}.md -->
<!-- @gsd-todo Implement Step 5: Report what was cached and how agents can use it -->

</process>

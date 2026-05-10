# User Preferences (Merged Template)

> This file contains three logical sections, each consumed by a different
> generator. The CJS loader in `cap/bin/lib/profile-output.cjs` extracts the
> relevant section by anchor (`## Section: <name>`) before applying Mustache
> substitutions. Do not remove the `## Section:` markers — they are load-bearing.
>
> Sections:
>   - profile          (Mustache template for USER-PROFILE.md)
>   - setup            (Documentation/schema for {phase}-USER-SETUP.md)
>   - dev-preferences  (Mustache template for /gsd:dev-preferences command)

## Section: profile

# Developer Profile

> This profile was generated from session analysis. It contains behavioral directives
> for Claude to follow when working with this developer. HIGH confidence dimensions
> should be acted on directly. LOW confidence dimensions should be approached with
> hedging ("Based on your profile, I'll try X -- let me know if that's off").

**Generated:** {{generated_at}}
**Source:** {{data_source}}
**Projects Analyzed:** {{projects_list}}
**Messages Analyzed:** {{message_count}}

---

## Quick Reference

{{summary_instructions}}

---

## Communication Style

**Rating:** {{communication_style.rating}} | **Confidence:** {{communication_style.confidence}}

**Directive:** {{communication_style.claude_instruction}}

{{communication_style.summary}}

**Evidence:**

{{communication_style.evidence}}

---

## Decision Speed

**Rating:** {{decision_speed.rating}} | **Confidence:** {{decision_speed.confidence}}

**Directive:** {{decision_speed.claude_instruction}}

{{decision_speed.summary}}

**Evidence:**

{{decision_speed.evidence}}

---

## Explanation Depth

**Rating:** {{explanation_depth.rating}} | **Confidence:** {{explanation_depth.confidence}}

**Directive:** {{explanation_depth.claude_instruction}}

{{explanation_depth.summary}}

**Evidence:**

{{explanation_depth.evidence}}

---

## Debugging Approach

**Rating:** {{debugging_approach.rating}} | **Confidence:** {{debugging_approach.confidence}}

**Directive:** {{debugging_approach.claude_instruction}}

{{debugging_approach.summary}}

**Evidence:**

{{debugging_approach.evidence}}

---

## UX Philosophy

**Rating:** {{ux_philosophy.rating}} | **Confidence:** {{ux_philosophy.confidence}}

**Directive:** {{ux_philosophy.claude_instruction}}

{{ux_philosophy.summary}}

**Evidence:**

{{ux_philosophy.evidence}}

---

## Vendor Philosophy

**Rating:** {{vendor_philosophy.rating}} | **Confidence:** {{vendor_philosophy.confidence}}

**Directive:** {{vendor_philosophy.claude_instruction}}

{{vendor_philosophy.summary}}

**Evidence:**

{{vendor_philosophy.evidence}}

---

## Frustration Triggers

**Rating:** {{frustration_triggers.rating}} | **Confidence:** {{frustration_triggers.confidence}}

**Directive:** {{frustration_triggers.claude_instruction}}

{{frustration_triggers.summary}}

**Evidence:**

{{frustration_triggers.evidence}}

---

## Learning Style

**Rating:** {{learning_style.rating}} | **Confidence:** {{learning_style.confidence}}

**Directive:** {{learning_style.claude_instruction}}

{{learning_style.summary}}

**Evidence:**

{{learning_style.evidence}}

---

## Profile Metadata

| Field | Value |
|-------|-------|
| Profile Version | {{profile_version}} |
| Generated | {{generated_at}} |
| Source | {{data_source}} |
| Projects | {{projects_count}} |
| Messages | {{message_count}} |
| Dimensions Scored | {{dimensions_scored}}/8 |
| High Confidence | {{high_confidence_count}} |
| Medium Confidence | {{medium_confidence_count}} |
| Low Confidence | {{low_confidence_count}} |
| Sensitive Content Excluded | {{sensitive_excluded_summary}} |

## Section: setup

# User Setup Template

Template for `.planning/phases/XX-name/{phase}-USER-SETUP.md` - human-required configuration that Claude cannot automate.

**Purpose:** Document setup tasks that literally require human action - account creation, dashboard configuration, secret retrieval. Claude automates everything possible; this file captures only what remains.

---

## File Template

```markdown
# Phase {X}: User Setup Required

**Generated:** [YYYY-MM-DD]
**Phase:** {phase-name}
**Status:** Incomplete

Complete these items for the integration to function. Claude automated everything possible; these items require human access to external dashboards/accounts.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `ENV_VAR_NAME` | [Service Dashboard → Path → To → Value] | `.env.local` |
| [ ] | `ANOTHER_VAR` | [Service Dashboard → Path → To → Value] | `.env.local` |

## Account Setup

[Only if new account creation is required]

- [ ] **Create [Service] account**
  - URL: [signup URL]
  - Skip if: Already have account

## Dashboard Configuration

[Only if dashboard configuration is required]

- [ ] **[Configuration task]**
  - Location: [Service Dashboard → Path → To → Setting]
  - Set to: [Required value or configuration]
  - Notes: [Any important details]

## Verification

After completing setup, verify with:

```bash
# [Verification commands]
```

Expected results:
- [What success looks like]

---

**Once all items complete:** Mark status as "Complete" at top of file.
```

---

## When to Generate

Generate `{phase}-USER-SETUP.md` when plan frontmatter contains `user_setup` field.

**Trigger:** `user_setup` exists in PLAN.md frontmatter and has items.

**Location:** Same directory as PLAN.md and SUMMARY.md.

**Timing:** Generated during execute-plan.md after tasks complete, before SUMMARY.md creation.

---

## Frontmatter Schema

In PLAN.md, `user_setup` declares human-required configuration:

```yaml
user_setup:
  - service: stripe
    why: "Payment processing requires API keys"
    env_vars:
      - name: STRIPE_SECRET_KEY
        source: "Stripe Dashboard → Developers → API keys → Secret key"
      - name: STRIPE_WEBHOOK_SECRET
        source: "Stripe Dashboard → Developers → Webhooks → Signing secret"
    dashboard_config:
      - task: "Create webhook endpoint"
        location: "Stripe Dashboard → Developers → Webhooks → Add endpoint"
        details: "URL: https://[your-domain]/api/webhooks/stripe, Events: checkout.session.completed, customer.subscription.*"
    local_dev:
      - "Run: stripe listen --forward-to localhost:3000/api/webhooks/stripe"
      - "Use the webhook secret from CLI output for local testing"
```

---

## The Automation-First Rule

**USER-SETUP.md contains ONLY what Claude literally cannot do.**

| Claude CAN Do (not in USER-SETUP) | Claude CANNOT Do (→ USER-SETUP) |
|-----------------------------------|--------------------------------|
| `npm install stripe` | Create Stripe account |
| Write webhook handler code | Get API keys from dashboard |
| Create `.env.local` file structure | Copy actual secret values |
| Run `stripe listen` | Authenticate Stripe CLI (browser OAuth) |
| Configure package.json | Access external service dashboards |
| Write any code | Retrieve secrets from third-party systems |

**The test:** "Does this require a human in a browser, accessing an account Claude doesn't have credentials for?"
- Yes → USER-SETUP.md
- No → Claude does it automatically

---

## Service-Specific Examples

<stripe_example>
```markdown
# Phase 10: User Setup Required

**Generated:** 2025-01-14
**Phase:** 10-monetization
**Status:** Incomplete

Complete these items for Stripe integration to function.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → Secret key | `.env.local` |
| [ ] | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys → Publishable key | `.env.local` |
| [ ] | `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → [endpoint] → Signing secret | `.env.local` |

## Account Setup

- [ ] **Create Stripe account** (if needed)
  - URL: https://dashboard.stripe.com/register
  - Skip if: Already have Stripe account

## Dashboard Configuration

- [ ] **Create webhook endpoint**
  - Location: Stripe Dashboard → Developers → Webhooks → Add endpoint
  - Endpoint URL: `https://[your-domain]/api/webhooks/stripe`
  - Events to send:
    - `checkout.session.completed`
    - `customer.subscription.created`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`

- [ ] **Create products and prices** (if using subscription tiers)
  - Location: Stripe Dashboard → Products → Add product
  - Create each subscription tier
  - Copy Price IDs to:
    - `STRIPE_STARTER_PRICE_ID`
    - `STRIPE_PRO_PRICE_ID`

## Local Development

For local webhook testing:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Use the webhook signing secret from CLI output (starts with `whsec_`).

## Verification

After completing setup:

```bash
# Check env vars are set
grep STRIPE .env.local

# Verify build passes
npm run build

# Test webhook endpoint (should return 400 bad signature, not 500 crash)
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: Build passes, webhook returns 400 (signature validation working).

---

**Once all items complete:** Mark status as "Complete" at top of file.
```
</stripe_example>

<supabase_example>
```markdown
# Phase 2: User Setup Required

**Generated:** 2025-01-14
**Phase:** 02-authentication
**Status:** Incomplete

Complete these items for Supabase Auth to function.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL | `.env.local` |
| [ ] | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon public | `.env.local` |
| [ ] | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → service_role | `.env.local` |

## Account Setup

- [ ] **Create Supabase project**
  - URL: https://supabase.com/dashboard/new
  - Skip if: Already have project for this app

## Dashboard Configuration

- [ ] **Enable Email Auth**
  - Location: Supabase Dashboard → Authentication → Providers
  - Enable: Email provider
  - Configure: Confirm email (on/off based on preference)

- [ ] **Configure OAuth providers** (if using social login)
  - Location: Supabase Dashboard → Authentication → Providers
  - For Google: Add Client ID and Secret from Google Cloud Console
  - For GitHub: Add Client ID and Secret from GitHub OAuth Apps

## Verification

After completing setup:

```bash
# Check env vars
grep SUPABASE .env.local

# Verify connection (run in project directory)
npx supabase status
```

---

**Once all items complete:** Mark status as "Complete" at top of file.
```
</supabase_example>

<sendgrid_example>
```markdown
# Phase 5: User Setup Required

**Generated:** 2025-01-14
**Phase:** 05-notifications
**Status:** Incomplete

Complete these items for SendGrid email to function.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SENDGRID_API_KEY` | SendGrid Dashboard → Settings → API Keys → Create API Key | `.env.local` |
| [ ] | `SENDGRID_FROM_EMAIL` | Your verified sender email address | `.env.local` |

## Account Setup

- [ ] **Create SendGrid account**
  - URL: https://signup.sendgrid.com/
  - Skip if: Already have account

## Dashboard Configuration

- [ ] **Verify sender identity**
  - Location: SendGrid Dashboard → Settings → Sender Authentication
  - Option 1: Single Sender Verification (quick, for dev)
  - Option 2: Domain Authentication (production)

- [ ] **Create API Key**
  - Location: SendGrid Dashboard → Settings → API Keys → Create API Key
  - Permission: Restricted Access → Mail Send (Full Access)
  - Copy key immediately (shown only once)

## Verification

After completing setup:

```bash
# Check env var
grep SENDGRID .env.local

# Test email sending (replace with your test email)
curl -X POST http://localhost:3000/api/test-email \
  -H "Content-Type: application/json" \
  -d '{"to": "your@email.com"}'
```

---

**Once all items complete:** Mark status as "Complete" at top of file.
```
</sendgrid_example>

---

## Guidelines

**Never include:** Actual secret values. Steps Claude can automate (package installs, code changes).

**Naming:** `{phase}-USER-SETUP.md` matches the phase number pattern.
**Status tracking:** User marks checkboxes and updates status line when complete.
**Searchability:** `grep -r "USER-SETUP" .planning/` finds all phases with user requirements.

## Section: dev-preferences

---
description: Load developer preferences into this session
---

# Developer Preferences

> Generated by GSD on {{generated_at}} from {{data_source}}.
> Run `/gsd:profile-user --refresh` to regenerate.

## Behavioral Directives

Follow these directives when working with this developer. Higher confidence
directives should be applied directly. Lower confidence directives should be
tried with hedging ("Based on your profile, I'll try X -- let me know if
that's off").

{{behavioral_directives}}

## Stack Preferences

{{stack_preferences}}

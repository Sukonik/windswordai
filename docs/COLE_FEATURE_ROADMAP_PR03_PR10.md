# Cole CTO Roadmap — WindSwordAI PR 03 → PR 10

## Team model

**Cole = CTO / Lead Developer**
- implementation architecture
- code execution
- backend/frontend integration
- refactors
- CI/build systems
- security implementation
- technical QA

**Ari = CDO / Lead Design + Product Architecture**
- product architecture
- UX/UI
- responsive requirements
- visual/brand system
- security/product constraints
- PR sequencing
- acceptance review

**Nathan = Product Owner / Final Approval**

Working cadence:

> Ari architecture/spec → Cole implementation → Cole technical QA → Ari product/design review → Nathan approval → merge/publish

---

# Current state

The dedicated shell/brand phase is complete enough to move forward.

Implemented:
- Next.js + TypeScript foundation
- responsive mobile/web-first shell
- dark/light themes
- approved WindSwordAI brand system
- chat composer / + menu visual shell
- GitHub Pages publishing
- CI + review artifacts
- responsive browser QA

From this point forward, WindSwordAI development should follow the capability sequence already defined in main and Issues #3–#10.

---

# Global engineering rules for PR 03–10

## 1. Follow the dependency chain

Do not pull future PR functionality backward unless a small interface contract is genuinely required.

Sequence:

1. **PR 03** — Chat Runtime, Provider Gateway & Secure Local Mode
2. **PR 04** — Secure Document + Image Loader
3. **PR 05** — LQ.AI Retrieval, Citations & Legal RAG
4. **PR 06** — Matters, Sources & Citation Workspace
5. **PR 07** — Night Studio Team Project
6. **PR 08** — Document Repair 2.0
7. **PR 09** — OCR 3.0 + Vision Ingestion
8. **PR 10** — Harvey LAB Sandbox, Evaluation Harness & Alpha Review Gate

## 2. Preserve the data boundary

Primary rule:

> Uploaded legal documents must not leave the controlled deployment environment by default.

Therefore:
- UI never calls model vendors directly.
- All inference passes through the WindSwordAI gateway.
- Protected document text is blocked from cloud providers unless policy explicitly allows it.
- Cloud providers are opt-in, not fallback.
- Do not log raw legal-document contents.
- Do not log API keys.
- Synthetic data only in CI/public demo.
- Local/offline execution paths must remain possible.

## 3. Keep public demo safe

GitHub Pages remains a synthetic/demo surface.

Every capability PR should have:
- a mock/demo mode;
- no required cloud credentials;
- synthetic fixtures;
- safe screenshots;
- a downloadable windsword-pr-XX-review artifact.

## 4. Responsive-first remains mandatory

GoldenSunAI remains the responsiveness benchmark.

Every new capability must work at minimum on:
- 320
- 360
- 390
- 430
- 640
- 768
- 900
- 1024
- 1440

Do not introduce desktop-only functionality without a deliberate mobile equivalent.

## 5. PRs must be reviewable

For every major PR:
- PR link
- demo/review link where practical
- CI artifact
- screenshots for UI changes
- test summary
- security/data-egress impact note
- known limitations
- exact issue closed/advanced

Green CI is required but is not, by itself, product signoff.

---

# PR 03 — Chat Runtime, Provider Gateway & Secure Local Mode

Issue: https://github.com/Sukonik/windswordai/issues/3

## Goal

Turn the current interface into a functioning conversational system without letting the UI talk directly to AI vendors.

## Architecture contract

~~~text
Chat UI
  ↓
WindSwordAI API
  ↓
Policy / Inference Gateway
  ↓
Provider Adapter
  ├─ Local / Ollama
  ├─ OpenAI
  ├─ Anthropic
  └─ future approved providers
~~~

## Cole implementation priorities

### Backend foundation
- add isolated Python/FastAPI service or equivalent backend;
- define stable API boundary between Next.js and backend;
- health endpoint;
- streaming transport;
- structured error contract;
- session/conversation IDs.

### Provider abstraction
Define a provider-neutral adapter contract before adding multiple providers.

Suggested conceptual interface:
- provider ID
- model ID
- capabilities
- supports streaming
- supports tools
- supports vision
- local/cloud classification
- policy eligibility
- generate / stream
- normalized usage metadata
- normalized provider error

Implement order:
1. **Mock provider** for CI/demo
2. **Local/Ollama**
3. Optional cloud adapters behind explicit environment config

Do not make OpenAI/Anthropic a required dependency for the app to function.

### Policy gateway
Every inference call must pass through one auditable decision point.

Policy must be able to evaluate:
- conversation security state;
- whether protected documents are attached;
- provider local/cloud status;
- administrator configuration;
- requested capability;
- whether egress is allowed.

### Secure Local Mode
UI must clearly show Secure Local state.

Once protected/document-bearing context exists later, the architecture must be able to lock the session away from disallowed cloud providers.

### Streaming UX
Wire the current Chat UI to real streaming behavior:
- token/event stream;
- stop/cancel;
- retry;
- provider failure state;
- offline/local unavailable state;
- no layout regression on mobile.

## Do not include yet
- document parsing
- embeddings
- vector retrieval
- matter backend
- OCR
- repair

Only define the contracts later PRs need.

## Required evidence
- mock/local chat demo;
- provider gateway architecture diagram;
- policy unit tests;
- sample synthetic audit event;
- CI with zero API keys;
- test proving UI cannot bypass the gateway.

## PR 03 merge gate
- Chat streams through gateway.
- Local/mock works without cloud credentials.
- Provider can change without UI code changes.
- Secure Local visibly disables disallowed providers.
- Provider errors degrade gracefully.
- No raw prompts/secrets leak into logs.

---

# PR 04 — Secure Document + Image Loader

Issue: https://github.com/Sukonik/windswordai/issues/4

## Goal

Make the composer + control real and establish the secure ingestion boundary.

## UX
Implement:
- + → Add files
- + → Add photos
- drag/drop
- clipboard image paste where supported
- attachment preview
- remove/reorder
- progress/error states
- mobile attachment flow

## Initial formats
- PDF
- DOCX
- TXT / Markdown
- XLSX
- PPTX
- PNG
- JPG/JPEG
- TIFF where practical

## Loader boundary
Implement:
- MIME + signature validation;
- allowlist;
- size/page limits;
- hashing;
- duplicate detection;
- filename normalization;
- quarantine/staging;
- controlled local storage;
- parse status;
- safe metadata logging.

## Normalized document contract
Every accepted asset should normalize toward:
- document ID
- safe display name
- detected file type
- hash
- page/sheet/slide count
- parse status
- extracted blocks if available
- image/page references
- confidence/quality flags
- needs_repair
- needs_ocr

This contract becomes the bridge to PR 05, PR 08, and PR 09.

## Security rule
No document contents go to a cloud model during ingestion.

## Do not include yet
- full RAG
- citation engine
- document repair implementation
- OCR implementation

Hooks/flags only.

## Required evidence
- synthetic PDF/DOCX/image upload demo;
- spoofed executable rejection test;
- normalized JSON example;
- mobile capture;
- logs proving raw contents are not emitted.

---

# PR 05 — LQ.AI Retrieval, Citations & Legal RAG

Issue: https://github.com/Sukonik/windswordai/issues/5

Primary upstream:
https://github.com/LegalQuants/lq-ai

License: Apache-2.0

Secondary behavioral reference:
https://github.com/JustVugg/judicex

## Goal

Add document-grounded answering with verifiable citations.

## Research rule

Study/adapt LQ.AI patterns for:
- provider abstraction;
- retrieval architecture;
- chunking;
- embeddings;
- vector search;
- citation generation;
- citation verification;
- privacy deployment;
- reusable skills.

Do **not** blindly fork LQ.AI.

If code is incorporated:
- preserve Apache-2.0 notices;
- document origin;
- add/update third-party notices.

## Retrieval path

~~~text
Normalized document
  ↓
Chunk / segment
  ↓
Local embedding
  ↓
Local vector index
  ↓
Scoped retrieval
  ↓
Grounded generation
  ↓
Citation verifier
  ↓
Answer + citations
~~~

## Grounded answer contract
Return:
- answer;
- cited document;
- page/section if known;
- small supporting snippet;
- internal retrieval coverage/confidence;
- explicit insufficient-evidence state.

## Core behavior
- local embeddings must work without Internet;
- retrieved text stays local unless provider policy allows otherwise;
- unsupported questions should abstain rather than invent evidence;
- citations open the correct source location where possible.

## Required evidence
- synthetic multi-document RAG demo;
- citation click-through;
- retrieval trace artifact;
- unsupported-question/abstention test;
- offline embedding/retrieval test;
- attribution documentation.

---

# PR 06 — Matters, Sources & Citation Workspace

Issue: https://github.com/Sukonik/windswordai/issues/6

## Goal

Turn single Chat into a durable legal workspace.

## Matter model
Support:
- create
- rename
- archive
- description
- matter/reference number
- attached documents
- source list
- conversations
- recent matters
- search/filter

## Conversation organization
Support:
- rename chat;
- move chat to matter;
- conversation search;
- recent history;
- model/mode/security metadata retention.

## Source experience
Add:
- source/document side panel;
- citation cards;
- open citation to page/location;
- selected-source answering;
- whole-matter answering;
- include/exclude source controls;
- visible composer context.

## Critical security rule

Matter boundaries must be enforced server-side.

UI hiding is not isolation.

Required test:
> Matter A cannot retrieve Matter B documents unless explicitly authorized.

## Mobile requirement
Matter/source navigation must have a deliberate mobile drawer/sheet experience, not a desktop side panel squeezed onto a phone.

## Required evidence
- synthetic municipal matter demo;
- matter isolation test;
- citation/source navigation capture;
- mobile matter drawer;
- conversation move/search demo.

---

# PR 07 — Night Studio Team Project

Issue: https://github.com/Sukonik/windswordai/issues/7

## Goal

Build the long-running project/workflow surface.

Night Studio is not “Chat with more buttons.”

It should represent:

~~~text
Goal
 ↓
Plan
 ↓
Tasks
 ↓
Artifacts
 ↓
Review / Approval
 ↓
Final output
~~~

## Initial roles
- Ari — product/design/research/synthesis/review
- Cole — implementation/code/build/engineering review

These are configurable role profiles, not hard-coded model identities.

## Core capabilities
- workflow board;
- task assignment;
- sequential + parallel states;
- pause/resume/cancel;
- approval checkpoints;
- artifact tray;
- handoffs;
- action summaries;
- retries/failures;
- final project summary.

## Important reasoning rule

Do not expose private chain-of-thought.

Show concise action summaries / decisions / artifacts instead.

## Safety
Every workflow step inherits:
- Secure Local/cloud policy;
- scoped file access;
- approval requirements;
- provider eligibility.

High-impact actions require human approval.

## Demo mode
Night Studio must be demonstrable with synthetic workflow fixtures and no real AI provider.

## Required evidence
- clickable synthetic project demo;
- Ari → Cole handoff example;
- artifact bundle;
- workflow-state JSON;
- desktop + mobile captures.

---

# PR 08 — Document Repair 2.0

Issue: https://github.com/Sukonik/windswordai/issues/8

## Goal

Create non-destructive local document preparation for damaged/legacy files.

## Principle

Original source is immutable.

Pipeline produces:
- analysis;
- optional repaired derivative;
- provenance manifest.

## Candidate operations
- malformed PDF detection;
- xref/object recovery where safe;
- orientation/rotation;
- blank pages;
- PDF normalization;
- text-layer validation;
- image sanity;
- encryption/password detection;
- DOCX container validation;
- filename/extension mismatch;
- Unicode normalization;
- duplicate-page detection;
- split/merge recommendation;
- OCR-needed detection.

## Repair manifest
Must record:
- source hash;
- derivative hash;
- attempted operations;
- applied operations;
- warnings;
- affected pages;
- before/after quality;
- OCR recommendation;
- tool/version/timestamp.

## Rules
- never overwrite source;
- work offline;
- no third-party repair service;
- dry-run supported;
- failures preserve original;
- every transformation auditable.

## Required evidence
- synthetic damaged-document fixtures;
- before/after report;
- manifest examples;
- repair UI states;
- regression tests.

---

# PR 09 — OCR 3.0 + Vision Ingestion

Issue: https://github.com/Sukonik/windswordai/issues/9

## Goal

Make scans/photos/image-only PDFs searchable and citable.

## Pipeline
- detect image-only PDF;
- rasterize pages;
- orientation/deskew;
- local OCR abstraction;
- page confidence;
- block/line coordinates where available;
- searchable text;
- page provenance;
- low-quality flags;
- table/layout preservation where practical;
- photo/image ingestion;
- selected-page re-OCR;
- compare against existing text layer;
- language hooks.

## Data boundary
Local processing is the default.

Cloud vision:
- explicit opt-in only;
- never invisible fallback;
- governed by PR 03 policy gateway.

## UX
Add:
- OCR needed badge;
- page progress;
- confidence;
- original/text comparison;
- retry page;
- later correction hook.

## Important integration
OCR output must conform to the same normalized text/provenance contract used by PR 05 retrieval.

## Required evidence
- scanned PDF demo;
- photo ingestion demo;
- confidence report;
- searchable/citable OCR result;
- offline test.

---

# PR 10 — Harvey LAB Sandbox, Evaluation Harness & Alpha Review Gate

Issue: https://github.com/Sukonik/windswordai/issues/10

Primary upstream:
https://github.com/harveyai/harvey-labs

License: MIT

## Goal

Close the first major development cycle with sandboxing, repeatable evaluation, and one consolidated review center.

## Part A — isolated execution

Research/adapt Harvey LAB patterns:
- per-task disposable sandbox;
- network disabled by default for protected jobs;
- minimal capabilities;
- source docs read-only;
- writable output separate;
- explicit workspace boundaries;
- parsers/tools outside primary web process.

Target pattern:

~~~text
Upload / task
  ↓
Disposable sandbox
  ↓
Source mounts read-only
  ↓
Network OFF
  ↓
Constrained tools
  ↓
Writable artifact output
  ↓
Destroy sandbox
~~~

## Part B — constrained tool boundary

Initial tool surface:
- read
- search/grep
- glob/list
- write artifact
- edit generated artifact
- finish/report

Do not expose unrestricted host filesystem access.

## Part C — evaluation harness

Create repeatable synthetic evaluations for:
- grounded-answer accuracy;
- citation correctness;
- abstention;
- matter isolation;
- document parsing;
- OCR retrieval;
- repair;
- provider policy;
- offline/local execution;
- Night Studio completion.

Security regressions must fail CI.

## Part D — Alpha Review Center

One place for:
- live demo;
- PR 01–10 artifacts;
- screenshots;
- feature status;
- tests/evals;
- data-egress status;
- known issues;
- performance notes.

## Required evidence
- sandbox threat model;
- network-block test;
- read-only-source test;
- synthetic legal evaluation report;
- Alpha Review Center;
- consolidated artifact index.

## PR 10 outcome

WindSwordAI should now have a reviewable alpha architecture consisting of:
- polished responsive shell;
- real chat runtime;
- secure loaders;
- local-first RAG;
- matters;
- Night Studio;
- document repair;
- OCR;
- sandboxing;
- measurable evaluation.

---

# Open-source reference policy

## LQ.AI
Use as primary architecture/code research for PR 05 and useful gateway/provider patterns.

Apache-2.0.

## Harvey LAB
Use for sandboxing, model adapters, evaluation methodology.

MIT.

## Judicex
Use for grounded answer behavior, evidence awareness, abstention patterns.

Apache-2.0.

## Mike
Use mainly as UX/workflow research unless AGPL-3.0 code adoption is explicitly approved.

Do not casually copy AGPL-covered code into WindSwordAI.

## BlackBowAI
Sibling, not dependency.

BlackBowAI:
- migration
- classification
- archive/search
- records operations

WindSwordAI:
- secure AI chat
- reasoning
- drafting
- research
- grounded document intelligence

Future integration should use explicit handoff actions such as **Open in WindSwordAI**, without forcing either app to depend on the other.

---

# Cross-PR contracts Cole should stabilize early

These contracts should become durable so later PRs do not repeatedly rewrite the core.

## Provider contract
- provider/model IDs
- local/cloud
- capabilities
- streaming
- errors
- policy decision

## Conversation contract
- conversation ID
- matter ID optional
- model/mode
- security state
- message/event stream
- attachment references

## Document contract
- document ID
- hash
- file type
- provenance
- text blocks
- page/slide/sheet references
- repair/OCR flags

## Citation contract
- citation ID
- document ID
- page/section
- snippet
- source locator

## Audit event contract
- event ID
- action type
- synthetic-safe metadata
- actor/session
- provider/tool
- policy decision
- timestamps

Do not put raw protected document text into audit records.

---

# PR cadence

For each PR:

1. Read the issue and this roadmap.
2. Reconcile current main.
3. Make architecture decisions explicitly in the PR description.
4. Implement the smallest complete vertical slice.
5. Add tests before calling it done.
6. Run responsive/browser QA when UI changes.
7. Generate safe synthetic demo/review artifacts.
8. Document security/data-egress impact.
9. Hand back to Ari for product/design/security review.
10. Nathan approves merge/publish.

If a PR reveals a necessary architectural change to an earlier contract, make the smallest compatible correction rather than absorbing the next roadmap stage.

---

# What is intentionally NOT in PR 03–10

Do not let these derail the core cycle:
- slash-command typography system (/secret, /pixel, /catgirl);
- custom WindSword-Block / WindSwordism production font integration;
- speculative connector marketplace;
- broad BlackBowAI integration;
- production authentication/SSO unless required by a core security test;
- billing;
- enterprise admin suite;
- mobile native app.

Those can follow the alpha architecture unless Nathan explicitly reprioritizes them.

---

# Definition of success

The first WindSwordAI development cycle is complete when a user can:

1. open a responsive WindSwordAI workspace;
2. chat through a policy-controlled gateway;
3. run locally without cloud keys;
4. securely upload a legal document;
5. search/ask across it locally;
6. receive grounded answers with citations;
7. organize work by matter;
8. run a reviewable Night Studio workflow;
9. repair/OCR imperfect documents without modifying originals;
10. execute protected tooling inside an isolated no-network sandbox;
11. review measurable synthetic evaluation results.

That is the PR 03 → PR 10 target.
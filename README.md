# WindSwordAI

> **Open by code. Private by data.**

WindSwordAI is a secure AI workspace for legal teams, combining conversational AI, document analysis, grounded answers, citations, drafting, research, and matter-aware workflows.

WindSwordAI is designed as a sibling project to **BlackBowAI**: BlackBowAI focuses on records, migration, classification, search, and document operations; WindSwordAI focuses on secure AI chat, reasoning, research, drafting, and document intelligence.

> **Status:** Early development. Security and architecture items below describe project requirements and implementation targets unless specifically marked as complete.

## Core Product Direction

WindSwordAI should feel as natural to use as a modern general-purpose AI assistant while adding controls appropriate for legal work.

Planned core capabilities include:

- Conversational AI chat
- Secure file and photo upload
- PDF, DOCX, XLSX, PPTX, image, and email analysis
- Matter- and project-aware workspaces
- Grounded document answers with citations
- Drafting, summarization, comparison, timelines, and extraction
- Legal research workflows
- Multiple AI provider support
- Local/self-hosted model support
- Auditable document and model activity
- Responsive web/PWA experience

## The `+` Menu

The chat composer is intentionally simple:

```text
[ + ]  Ask WindSwordAI...  [voice]  [↑]
```

The **+** button is the expandable action hub for everything beyond plain text.

Initial actions:

- Add photos
- Add files
- Add from matter
- Add recent documents

Future actions may include:

- Connect source
- Legal research
- Compare documents
- Create draft
- Tools / skills
- External connectors

The goal is to keep the main chat interface clean while allowing new capabilities to be added without redesigning the composer.

## Security Principle

### Open source does not mean open data.

The WindSwordAI source code may be public while legal documents, prompts, matter data, embeddings, databases, credentials, and audit records remain inside the user's controlled environment.

The primary security target is:

> **Uploaded legal documents must not leave the controlled deployment environment by default.**

Planned safeguards include:

- Local/self-hosted document storage
- Local parsing and OCR
- Local embeddings and vector search
- Local or explicitly approved inference
- Encryption at rest and in transit
- Role-based access controls
- Matter/workspace isolation
- Audit logging
- Configurable retention and deletion
- No customer-document training
- Restricted outbound network access
- Sandboxed document processing
- Cloud-model access disabled for protected document workflows unless explicitly enabled by an administrator

A future secure deployment should be able to operate document workflows with **no document egress**.

### Secure Local Mode

A document-bearing conversation may be locked into a secure local mode:

```text
Legal Document
      ↓
Secure Upload
      ↓
Isolated Parser / OCR
      ↓
Local Embeddings
      ↓
Local Vector Search
      ↓
Local LLM
      ↓
Answer + Citations
```

Cloud research and external providers should remain a separate, policy-controlled lane.

## Planned Architecture

```text
                    WindSwordAI
                         │
              Chat / Matters / +
                         │
                Application Layer
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
   Authentication    Document Layer    Audit Layer
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                  Inference Gateway
                         │
          ┌──────────────┼──────────────┐
          │              │              │
      Local LLM       OpenAI        Other Approved
     / Ollama         Adapter          Providers
          │
          ▼
   Local Retrieval
   + Citation Layer
```

The **Inference Gateway** is intended to be the policy boundary between WindSwordAI and model providers. Documents should not be sent directly from the UI to third-party AI services.

## Secure Document Processing

WindSwordAI is exploring a disposable sandbox model for untrusted legal files:

```text
Upload
  ↓
Encrypted Storage
  ↓
Disposable Document Sandbox
  ↓
Network Disabled
  ↓
PDF / DOCX / XLSX / PPTX Parsing
  ↓
Sanitized Extracted Representation
  ↓
Local Retrieval / Indexing
  ↓
Sandbox Destroyed
```

This design is influenced by the isolated legal-agent workspace approach used in Harvey LAB.

## Technology Direction

Initial technical direction:

- **Frontend / web app:** Next.js + TypeScript
- **Backend / AI services:** Python + FastAPI
- **Local AI:** Ollama and compatible self-hosted runtimes
- **Retrieval:** local embeddings + vector search
- **Storage:** controlled local/self-hosted object storage
- **Database:** PostgreSQL-compatible architecture
- **Deployment:** web-first, with self-hosted/local deployment support

Technology choices may evolve as the project moves from prototype to production.

## Open-Source Research

WindSwordAI is an independent project, but several open-source legal AI projects provide useful technical reference points.

### LQ.AI

**LegalQuants/lq-ai** is a primary architectural research target for:

- Legal RAG
- Citation verification
- Inference gateway patterns
- Provider abstraction
- Skills/workflows
- Privacy-oriented deployment

LQ.AI is licensed under Apache License 2.0.

https://github.com/LegalQuants/lq-ai

### Harvey LAB

**harveyai/harvey-labs** is a primary research target for:

- Sandboxed legal-agent execution
- Closed workspaces
- Provider adapters
- Legal task evaluation
- Model benchmarking
- Agent tooling

Harvey LAB is licensed under the MIT License.

https://github.com/harveyai/harvey-labs

### Judicex

**JustVugg/judicex** is a useful reference for:

- Grounded-answer behavior
- Evidence-aware responses
- Abstention when support is insufficient
- Provider abstraction

Judicex is licensed under Apache License 2.0.

https://github.com/JustVugg/judicex

### Mike

**Open-Legal-Products/mike** is useful as a UX and workflow reference.

Because Mike is licensed under AGPL-3.0, WindSwordAI should treat it primarily as design/workflow inspiration unless AGPL-covered code is deliberately introduced.

https://github.com/Open-Legal-Products/mike

## Relationship to BlackBowAI

The projects intentionally solve different problems:

| BlackBowAI | WindSwordAI |
| --- | --- |
| File migration | AI conversation |
| Classification | Document reasoning |
| Archive search | Grounded Q&A |
| Review queues | Drafting |
| Migration reports | Legal research |
| Records operations | Matter-aware AI |

A future BlackBowAI interface may provide an **Open in WindSwordAI** action without making WindSwordAI a hard dependency.

## Visual Direction

WindSwordAI's design language is inspired by a wind-forged sword aesthetic:

- Steel / chrome
- Neon bright blue
- White controls and text
- Dark gray / black gradient surfaces
- Optional light and dark modes
- Blue hover, focus, and selection states
- Red glow reserved for key wake / processing interactions
- Responsive, atmospheric UI behavior

The bottom chat composer should keep the **+**, voice, and send controls prominent across desktop and mobile layouts.

## License

WindSwordAI is released under the **Mozilla Public License 2.0 (MPL-2.0)**.

MPL 2.0 keeps modifications to covered WindSwordAI source files open while allowing the project to interoperate with separately licensed or proprietary systems.

See [LICENSE](LICENSE).

## Security Notice

WindSwordAI is under active development and should not currently be treated as a certified legal-security or compliance product.

References to SOC 2, enterprise legal security practices, local-only processing, or comparable controls describe design goals unless and until those controls are implemented, tested, documented, and independently assessed.
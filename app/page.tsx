import Link from "next/link";
import { WindSwordMark } from "@/components/WindSwordMark";
import { demoWorkspace } from "@/lib/demo";

const experiences = [
  {
    eyebrow: "Chat",
    title: "Ask. Draft. Compare.",
    copy: "A focused legal AI workspace with secure-mode controls, attachments, and room for grounded citations.",
    href: "/chat",
    status: "Live shell",
  },
  {
    eyebrow: "Matters",
    title: "Keep context scoped.",
    copy: "Organize conversations, documents, and future retrieval around the matter that actually owns the work.",
    href: "/matters",
    status: "Preview",
  },
  {
    eyebrow: "Night Studio",
    title: "Hand work across a team.",
    copy: "A future team-project surface for visible plans, approvals, artifacts, and Ari ↔ Cole workflow handoffs.",
    href: "/night-studio",
    status: "Preview",
  },
];

export default function HomePage() {
  return (
    <section className="hero home-hero">
      <div className="home-hero-grid">
        <div className="home-hero-copy">
          <p className="eyebrow">Secure legal AI workspace</p>
          <h1>Legal AI with a boundary.</h1>
          <p className="hero-copy">
            WindSwordAI brings conversational AI, grounded document work, citations,
            drafting, research, and matter-aware workflows into one local-first workspace.
          </p>

          <div className="hero-actions">
            <Link className="primary-link" href="/chat">Open WindSwordAI</Link>
            <Link className="secondary-link" href="/night-studio">Explore Night Studio</Link>
          </div>

          <div className="home-trust-row" aria-label="Current demo characteristics">
            <span><i /> Local-first design</span>
            <span><i /> Synthetic demo data</span>
            <span><i /> Open-source core</span>
          </div>
        </div>

        <div className="home-sword-stage" aria-label="WindSwordAI visual identity">
          <div className="home-sword-halo home-sword-halo--outer" aria-hidden="true" />
          <div className="home-sword-halo home-sword-halo--inner" aria-hidden="true" />
          <WindSwordMark className="home-sword-mark" variant="shaded" title="WindSwordAI winged sword mark" />
          <div className="home-sword-caption">
            <span>Secure Local</span>
            <strong>WindSword</strong>
          </div>
        </div>
      </div>

      <div className="home-experience-grid">
        {experiences.map((experience) => (
          <Link className="experience-card" href={experience.href} key={experience.title}>
            <div className="experience-card__top">
              <span>{experience.eyebrow}</span>
              <small>{experience.status}</small>
            </div>
            <h2>{experience.title}</h2>
            <p>{experience.copy}</p>
            <span className="experience-card__arrow" aria-hidden="true">↗</span>
          </Link>
        ))}
      </div>

      <div className="demo-card home-demo-card">
        <div>
          <span>Demo workspace · Local Secure</span>
          <strong>{demoWorkspace.workspace}</strong>
        </div>
        <small>{demoWorkspace.notice}</small>
      </div>
    </section>
  );
}
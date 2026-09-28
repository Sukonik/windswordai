import Link from "next/link";
import { WindSwordMark } from "@/components/WindSwordMark";

const principles = [
  {
    title: "Controlled data",
    copy: "Protected legal material is designed to remain inside the deployment boundary unless policy explicitly allows otherwise.",
  },
  {
    title: "Grounded work",
    copy: "Document answers, citations, matter context, and research workflows are designed to make sources inspectable.",
  },
  {
    title: "Human review",
    copy: "WindSwordAI is built to assist legal work, preserve review checkpoints, and make automated activity visible.",
  },
];

export default function AboutPage() {
  return (
    <section className="about-page">
      <div className="about-grid">
        <div className="about-copy">
          <p className="eyebrow">About WindSwordAI</p>
          <h1>Legal AI with control at the center.</h1>
          <p className="about-lede">
            WindSwordAI is an open-source, local-first legal AI workspace for
            conversational work, document intelligence, grounded citations,
            drafting, research, and matter-aware workflows.
          </p>
          <p className="about-support">
            The public build currently uses synthetic demo data while the secure
            runtime, loaders, retrieval layer, and integrations are developed in
            separate reviewed pull requests.
          </p>
          <div className="hero-actions">
            <Link className="primary-link" href="/chat">Open WindSwordAI</Link>
            <Link className="secondary-link" href="/status">View build status</Link>
          </div>
        </div>

        <div className="about-logo-stage" aria-label="WindSwordAI full-color winged sword mark">
          <div className="about-aura" aria-hidden="true" />
          <div className="about-wind about-wind--one" aria-hidden="true" />
          <div className="about-wind about-wind--two" aria-hidden="true" />
          <div className="about-wind about-wind--three" aria-hidden="true" />
          <div className="about-light-sweep" aria-hidden="true" />
          <WindSwordMark className="about-logo" variant="color" title="WindSwordAI winged sword mark" />
          <div className="about-logo-state" aria-hidden="true">
            <span>Blue steel</span>
            <strong>WindSwordAI</strong>
          </div>
        </div>
      </div>

      <div className="about-principles" aria-label="WindSwordAI design principles">
        {principles.map((principle, index) => (
          <article className="about-principle" key={principle.title}>
            <span>0{index + 1}</span>
            <h2>{principle.title}</h2>
            <p>{principle.copy}</p>
          </article>
        ))}
      </div>

      <div className="about-note">
        <span>Current public mode</span>
        <strong>Interface demo · synthetic data · no live legal provider attached</strong>
      </div>
    </section>
  );
}

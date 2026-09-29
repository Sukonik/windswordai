import Link from "next/link";
import { asset } from "@/lib/assets";

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

        <div className="about-stage" role="img" aria-label="WindSwordAI blue-steel winged sword">
          <div className="about-stage__halo" aria-hidden="true" />
          <span className="about-stage__streak about-stage__streak--a" aria-hidden="true" />
          <span className="about-stage__streak about-stage__streak--b" aria-hidden="true" />
          {/* Same-canvas layers of the approved art; they register exactly over the base. */}
          {/* eslint-disable @next/next/no-img-element */}
          <img className="about-layer about-layer--wind" src={asset("/brand/layer-wind-560.webp")} srcSet={`${asset("/brand/layer-wind-560.webp")} 560w, ${asset("/brand/layer-wind.webp")} 960w`} sizes="(min-width: 900px) 560px, 80vw" alt="" aria-hidden="true" width={960} height={960} loading="lazy" decoding="async" />
          <img className="about-layer about-layer--aura" src={asset("/brand/layer-aura-560.webp")} srcSet={`${asset("/brand/layer-aura-560.webp")} 560w, ${asset("/brand/layer-aura.webp")} 960w`} sizes="(min-width: 900px) 560px, 80vw" alt="" aria-hidden="true" width={960} height={960} decoding="async" />
          <img className="about-layer about-layer--base" src={asset("/brand/layer-base-560.webp")} srcSet={`${asset("/brand/layer-base-560.webp")} 560w, ${asset("/brand/layer-base.webp")} 960w`} sizes="(min-width: 900px) 560px, 80vw" alt="" aria-hidden="true" width={960} height={960} decoding="async" />
          <img className="about-layer about-layer--beam" src={asset("/brand/layer-beam-560.webp")} srcSet={`${asset("/brand/layer-beam-560.webp")} 560w, ${asset("/brand/layer-beam.webp")} 960w`} sizes="(min-width: 900px) 560px, 80vw" alt="" aria-hidden="true" width={960} height={960} loading="lazy" decoding="async" />
          <img className="about-layer about-layer--gem" src={asset("/brand/layer-gem-560.webp")} srcSet={`${asset("/brand/layer-gem-560.webp")} 560w, ${asset("/brand/layer-gem.webp")} 960w`} sizes="(min-width: 900px) 560px, 80vw" alt="" aria-hidden="true" width={960} height={960} loading="lazy" decoding="async" />
          {/* eslint-enable @next/next/no-img-element */}
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

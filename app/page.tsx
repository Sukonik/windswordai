import Link from "next/link";
import { demoWorkspace } from "@/lib/demo";

export default function HomePage() {
  return (
    <section className="hero">
      <p className="eyebrow">Secure legal AI workspace</p>
      <h1>Clear thinking.<br />Controlled data.</h1>
      <p className="hero-copy">
        WindSwordAI brings conversational AI, grounded document work, citations,
        drafting, research, and matter-aware workflows into one local-first workspace.
      </p>
      <div className="hero-actions">
        <Link className="primary-link" href="/chat">Open WindSwordAI</Link>
        <Link className="secondary-link" href="/status">Build status</Link>
      </div>
      <div className="demo-card">
        <span>Demo workspace · Local Secure</span>
        <strong>{demoWorkspace.workspace}</strong>
        <small>{demoWorkspace.notice}</small>
      </div>
    </section>
  );
}

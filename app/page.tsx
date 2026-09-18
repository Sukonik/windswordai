import Link from "next/link";
import { demoWorkspace } from "@/lib/demo";

export default function HomePage() {
  return (
    <section className="hero">
      <p className="eyebrow">Secure legal AI workspace</p>
      <h1>Open by code.<br />Private by data.</h1>
      <p className="hero-copy">
        WindSwordAI is being built for conversational legal work, grounded
        document analysis, citations, drafting, research, and matter-aware workflows.
      </p>
      <div className="hero-actions">
        <Link className="primary-link" href="/chat">Enter WindSwordAI</Link>
        <Link className="secondary-link" href="/status">View build status</Link>
      </div>
      <div className="demo-card">
        <span>Synthetic workspace</span>
        <strong>{demoWorkspace.workspace}</strong>
        <small>{demoWorkspace.notice}</small>
      </div>
    </section>
  );
}

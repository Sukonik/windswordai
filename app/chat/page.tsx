import { demoWorkspace } from "@/lib/demo";

export default function ChatPage() {
  return (
    <section className="placeholder">
      <p className="eyebrow">PR 01 foundation</p>
      <h1>Chat shell</h1>
      <p>
        The interface foundation is active. PR 02 will replace this placeholder
        with the full WindSwordAI composer, history, themes, and interaction design.
      </p>
      <div className="demo-card">
        <span>{demoWorkspace.matter}</span>
        <strong>{demoWorkspace.conversation}</strong>
      </div>
    </section>
  );
}

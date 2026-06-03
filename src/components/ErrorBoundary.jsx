import { Component } from "react";
import { reportError } from "../lib/errorOverlay";

// Catches render/lifecycle errors anywhere in the tree and shows the error on
// screen (instead of an unmounted blank), AND mirrors it to the global error
// overlay so it's copyable/screenshottable on a device. Diagnostic aid for the
// APK where the console isn't reachable.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, stack: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const stack = info?.componentStack || "";
    this.setState({ stack });
    reportError(`Render crash: ${error?.name || "Error"}: ${error?.message || String(error)}\n${error?.stack || ""}\n${stack}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    const text = `${e?.name || "Error"}: ${e?.message || String(e)}\n\n${e?.stack || ""}\n\n${this.state.stack}`;
    return (
      <div style={{
        padding: 16, font: "12px/1.6 ui-monospace, Menlo, Consolas, monospace",
        color: "#7a1414", background: "#fff5f5", minHeight: "100vh",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        <h2 style={{ margin: "0 0 10px" }}>⚠ App crashed — screenshot this</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => { try { navigator.clipboard.writeText(text); } catch { /* blocked */ } }}
            style={{ background: "#7a1414", color: "#fff", border: "none", borderRadius: 3, padding: "6px 14px", cursor: "pointer" }}>
            Copy
          </button>
          <button onClick={() => location.reload()}
            style={{ background: "#333", color: "#fff", border: "none", borderRadius: 3, padding: "6px 14px", cursor: "pointer" }}>
            Reload
          </button>
        </div>
        <div>{text}</div>
      </div>
    );
  }
}

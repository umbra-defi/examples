"use client";

// Collapsible debug console backed by lib/umbra-debug's ring buffer.
// Shows every dbg() event (keys, account snapshots, scan counts, send steps)
// with a one-click "Copy" so a devnet tester can paste the full trace into a
// bug report. Renders nothing when NEXT_PUBLIC_UMBRA_DEBUG=0.

import { useState, useSyncExternalStore } from "react";
import {
  DEBUG_ON,
  clearDebugEvents,
  getDebugEvents,
  safeStringify,
  subscribeDebug,
  type DebugEvent,
} from "@/lib/umbra-debug";

function useDebugEvents(): readonly DebugEvent[] {
  return useSyncExternalStore(
    subscribeDebug,
    getDebugEvents,
    () => getDebugEvents(),
  );
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function DebugPanel() {
  const events = useDebugEvents();
  const [open, setOpen] = useState(false);

  if (!DEBUG_ON) return null;

  const copy = () => {
    const text = events
      .map((e) => {
        const line = `${fmtTime(e.t)} [${e.scope}] ${e.msg}`;
        return e.data === undefined ? line : `${line}\n${safeStringify(e.data)}`;
      })
      .join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <button className="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "▾" : "▸"} Debug console ({events.length})
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary" onClick={copy} disabled={events.length === 0}>
            Copy
          </button>
          <button className="secondary" onClick={clearDebugEvents} disabled={events.length === 0}>
            Clear
          </button>
        </div>
      </div>
      {open && (
        <div
          style={{
            marginTop: 12,
            maxHeight: 360,
            overflowY: "auto",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {events.length === 0 ? (
            <p className="muted">No events yet. Connect a wallet and scan / send.</p>
          ) : (
            events
              .slice()
              .reverse()
              .map((e, i) => (
                <details key={`${e.t}-${i}`} open={e.data === undefined}>
                  <summary>
                    <span className="muted">{fmtTime(e.t)}</span>{" "}
                    <strong>[{e.scope}]</strong> {e.msg}
                  </summary>
                  {e.data !== undefined && (
                    <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 8px 16px" }}>
                      {safeStringify(e.data)}
                    </pre>
                  )}
                </details>
              ))
          )}
        </div>
      )}
    </div>
  );
}

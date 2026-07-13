import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInstantPress, useInstantTap } from "./useInstantPress";

const originalDocument = globalThis.document;

function renderBindings(useBindings) {
  let bindings;
  function Harness() {
    bindings = useBindings();
    return null;
  }
  renderToStaticMarkup(<Harness />);
  return bindings;
}

function pointerEvent(overrides = {}) {
  return {
    pointerType: "touch",
    pointerId: 1,
    clientX: 20,
    clientY: 30,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function guardedDocument() {
  const listeners = new Map();
  return {
    listeners,
    document: {
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    },
  };
}

function clickEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

afterEach(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

describe("instant touch bindings", () => {
  it("blocks only the opener's compatibility click, not the next real press", () => {
    const guard = guardedDocument();
    globalThis.document = guard.document;
    const firstPress = vi.fn();
    const secondPress = vi.fn();
    const bindings = renderBindings(() => {
      const instantPress = useInstantPress();
      return {
        first: instantPress("first", firstPress),
        second: instantPress("second", secondPress),
      };
    });

    bindings.first.onPointerDown(pointerEvent());
    const compatibilityClick = clickEvent();
    guard.listeners.get("click")(compatibilityClick);
    guard.listeners.get("pointerdown")();
    bindings.second.onClick(pointerEvent({ pointerType: "mouse" }));

    expect(firstPress).toHaveBeenCalledTimes(1);
    expect(secondPress).toHaveBeenCalledTimes(1);
    expect(compatibilityClick.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("keeps a completed tap from clicking through a new overlay", () => {
    const guard = guardedDocument();
    globalThis.document = guard.document;
    const firstTap = vi.fn();
    const secondTap = vi.fn();
    const bindings = renderBindings(() => {
      const instantTap = useInstantTap();
      return {
        first: instantTap("first", firstTap),
        second: instantTap("second", secondTap),
      };
    });
    const event = pointerEvent();

    bindings.first.onPointerDown(event);
    bindings.first.onPointerUp(event);
    const compatibilityClick = clickEvent();
    guard.listeners.get("click")(compatibilityClick);
    guard.listeners.get("pointerdown")();
    bindings.second.onClick(pointerEvent({ pointerType: "mouse" }));

    expect(firstTap).toHaveBeenCalledTimes(1);
    expect(secondTap).toHaveBeenCalledTimes(1);
    expect(compatibilityClick.preventDefault).toHaveBeenCalledTimes(1);
  });
});

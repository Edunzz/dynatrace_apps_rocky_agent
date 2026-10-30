// jsdom lacks a few browser APIs that Strato components use.
import { TextDecoder, TextEncoder } from "node:util";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const g = globalThis as unknown as Record<string, unknown>;
g.ResizeObserver ??= ResizeObserverStub;
g.IntersectionObserver ??= IntersectionObserverStub;
g.TextEncoder ??= TextEncoder;
g.TextDecoder ??= TextDecoder;

if (typeof window !== "undefined") {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
}

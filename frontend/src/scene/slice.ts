// Time-slicing for the scene's start-up work, so building the world never blocks
// the page for long: work calls `await slice()` often, and it yields to the main
// thread whenever the current slice has run for more than a few milliseconds.

export type Slicer = () => Promise<void> | void;

const yieldToMain = () =>
  new Promise<void>((resolve) => {
    // a message task runs before timers clamp, and lets input and paint in between
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

export function makeSlicer(budgetMs = 8): Slicer {
  let start = performance.now();
  return () => {
    if (performance.now() - start < budgetMs) return;
    return yieldToMain().then(() => {
      start = performance.now();
    });
  };
}

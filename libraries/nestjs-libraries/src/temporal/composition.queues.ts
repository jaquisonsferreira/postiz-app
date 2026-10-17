// Every render runs a Chromium, so the renders have a queue of their own whose
// worker runs only a few at a time (temporal.module.ts). A render waiting for
// one waits in Temporal, before its execution timeout has started
export const compositionQueues = {
  render: { taskQueue: 'composition-render' },
};

globalThis.fetch = (() => { throw new Error("Network disabled in isolated review"); }) as typeof fetch;

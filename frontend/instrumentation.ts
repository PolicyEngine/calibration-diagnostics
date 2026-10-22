export async function register() {
  // Runs once when each Node.js server instance starts, before any route
  // handler makes an outbound request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { removeCompromisedEmudhraRoots } = await import(
      "@/lib/server/remove-compromised-emudhra-roots"
    );
    removeCompromisedEmudhraRoots();
  }
}

/**
 * Ensures window.AI_USER_ID exists on the client to prevent ReferenceError at runtime
 * Uses NEXT_PUBLIC_AI_USER_ID if defined, otherwise sets empty string.
 */
if (typeof window !== "undefined") {
  try {
    // eslint-disable-next-line no-undef
    if (typeof (window as any).AI_USER_ID === "undefined") {
      // @ts-ignore
      (window as any).AI_USER_ID = process.env.NEXT_PUBLIC_AI_USER_ID || "gemini-ai-chat-bot-7a4b9c1d-f2e3-4d56-a1b2-c3d4e5f6a7b8";
    }
  } catch (e) {
    // ignore
  }
}

import { describe, expect, it } from "vitest";
import {
  sanitizeInput,
  validateChatMessage,
  validateLeadForm,
} from "../schema";

describe("input validators", () => {
  it("escapes HTML-sensitive characters and trims input", () => {
    expect(sanitizeInput(` <script>"x"</script>' `)).toBe(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;&#x27;",
    );
  });

  it("validates and sanitizes chat messages", () => {
    const result = validateChatMessage({
      session_id: "session_123",
      message: " Bonjour <b>client</b> ",
      context: { view: "chat" },
    });

    expect(result).toEqual({
      success: true,
      data: {
        session_id: "session_123",
        message: "Bonjour &lt;b&gt;client&lt;/b&gt;",
        context: { view: "chat" },
      },
    });
  });

  it("rejects invalid chat sessions and oversized messages", () => {
    expect(
      validateChatMessage({ session_id: "bad id!", message: "hello" }),
    ).toEqual({ success: false, error: "session_id invalide" });

    expect(
      validateChatMessage({ session_id: "ok", message: "x".repeat(5001) }),
    ).toEqual({ success: false, error: "Message trop long (max 5000 caractères)" });
  });

  it("validates and normalizes lead forms", () => {
    const result = validateLeadForm({
      prenom: " Jean ",
      nom: " Dupont ",
      telephone: "06 12 34 56 78",
      email: "",
      projet: "Achat",
      details: " T3 <centre> ",
    });

    expect(result).toEqual({
      success: true,
      data: {
        prenom: "Jean",
        nom: "Dupont",
        telephone: "0612345678",
        email: "",
        projet: "Achat",
        details: "T3 &lt;centre&gt;",
      },
    });
  });

  it("rejects malformed lead forms", () => {
    expect(
      validateLeadForm({
        prenom: "Jean",
        nom: "Dupont",
        telephone: "123",
        projet: "Achat",
      }),
    ).toEqual({ success: false, error: "Numéro de téléphone invalide" });
  });
});

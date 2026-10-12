import type { Language } from "@/lib/storyboard/types";

export function speak(text: string, lang: Language, rate = 1) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

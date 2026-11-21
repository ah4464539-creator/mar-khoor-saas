// How the AI should WRITE replies that a voice will read aloud, so Urdu text-to-speech does not
// misread words (Urdu script has no short vowels: کل = kal or kul, چکن read as "chakan").
export const SPEECH_RULES_MARKER = '[Mar-Khoor speech rules v1]';
export const URDU_SPEECH_RULES = SPEECH_RULES_MARKER + ` Your replies are spoken by a voice. When you speak Urdu:
- Write English loanwords and dish names that come from English in English letters, not Urdu script: Chicken, Burger, Pizza, Sandwich, Fries, Order, Delivery, Pickup, Total, Bill, Menu, Cappuccino.
- For a sum say "Total" (in English letters). Never write کل for a total; use کل only for "tomorrow" and then write it as کَل.
- Put zer, zabar or pesh (ِ َ ُ) on any short Urdu word that can be read two ways.
- Write prices as digits followed by روپے, for example 1,450 روپے.
- Keep sentences short and natural, like a polite restaurant host.
- Sound professional: calm, warm, clear and respectful; no slang or jokes.`;

/** Append the rules to a Vapi model's system message (idempotent). */
export function withSpeechRules(model) {
  if (!model || typeof model !== 'object') return model;
  const messages = Array.isArray(model.messages) ? model.messages.map(m => ({ ...m })) : [];
  const system = messages.find(m => m.role === 'system');
  if (system) {
    if (String(system.content || '').includes(SPEECH_RULES_MARKER)) return model;
    system.content = String(system.content || '').trimEnd() + '\n\n' + URDU_SPEECH_RULES;
  } else messages.unshift({ role: 'system', content: URDU_SPEECH_RULES });
  return { ...model, messages };
}

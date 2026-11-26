// Language and intent helpers for WhatsApp AI replies. Pure functions, no I/O.
//
// detectLanguage tells the four languages we support apart, so the reply matches the customer:
//   ar        Arabic script without Urdu-only letters
//   ur        Arabic script with Urdu-only letters (ٹ ڈ ڑ ں ے ہ ک ی گ پ چ ژ ...)
//   roman_ur  Urdu written in Latin letters ("mujhe 2 biryani chahiye")
//   en        other Latin text
// Anything else returns null and the AI simply mirrors the customer's language.

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
// Letters used by Urdu but not by standard Arabic.
const URDU_ONLY = /[ٹڈڑںھہۃیےۓکگپچژ]/g;
// Letters used by Arabic but not normally by Urdu.
const ARABIC_ONLY = /[ةكيى]/g;
const LATIN = /[A-Za-z]/g;
// Frequent Roman Urdu words; English rarely uses them as whole words.
// Words that are also common English ("main", "do", "ham", "band") are deliberately left out.
const ROMAN_URDU = new Set(('hai hain hy kya kia kyun mujhe mujhy muje mera meri mere hum aap apka apki tum chahiye chahye chaiye chahiay '
  + 'karo karna kardo krdo kro karein krein kitna kitne kitni kab kahan kaise kese kaisa nahi nahin nhi haan ji jee bhai bhi '
  + 'acha accha achha theek thik shukriya shukria meherbani mein ke ki ka ko se wala wali waly abhi jaldi dena dedo bhej bhejo '
  + 'batao bataein btao khana bhook assalam walaikum aoa khuda hafiz yaar wapis').split(' '));

export function detectLanguage(text) {
  const s = String(text ?? '').slice(0, 2000);
  const arabicScript = (s.match(ARABIC_SCRIPT) || []).length;
  const latin = (s.match(LATIN) || []).length;
  if (arabicScript >= 2 && arabicScript >= latin) {
    const urdu = (s.match(URDU_ONLY) || []).length, arabic = (s.match(ARABIC_ONLY) || []).length;
    return urdu > arabic ? 'ur' : 'ar';
  }
  if (latin < 2) return null;
  const words = s.toLowerCase().match(/[a-z]+/g) || [];
  const roman = words.filter(w => ROMAN_URDU.has(w)).length;
  if (roman >= 2 || (roman === 1 && words.length <= 3)) return 'roman_ur';
  return 'en';
}

const NAMES = { ar: 'Arabic', ur: 'Urdu (Urdu script)', roman_ur: 'Roman Urdu (Urdu written in English letters, like "aap ka order")', en: 'English' };
/** One sentence for the AI system prompt. Empty when the language is unknown. */
export function languageRule(language) {
  return NAMES[language] ? ' The customer is writing in ' + NAMES[language] + '; reply in the same language and script.' : '';
}

// ---- Consent (opt-out / opt-in) ----
const norm = text => String(text ?? '').trim().toLowerCase().replace(/[.!؟?،,]+$/g, '').replace(/\s+/g, ' ');
const STOP_WORDS = new Set(['stop', 'stop all', 'unsubscribe', 'opt out', 'optout', 'cancel messages', 'band karo', 'bnd karo', 'band kro', 'bnd kro', 'band kar do', 'band kardo', 'band krdo', 'messages band karo', 'message band karo',
  'بند کرو', 'بند کریں', 'بند کر دو', 'میسج بند کرو', 'توقف', 'إيقاف', 'ايقاف', 'الغاء الاشتراك', 'إلغاء الاشتراك']);
const START_WORDS = new Set(['start', 'unstop', 'subscribe', 'opt in', 'optin', 'shuru karo', 'shuru kro', 'start karo', 'chalu karo', 'شروع کرو', 'شروع کریں', 'ابدأ', 'اشتراك']);
/** 'stop' | 'start' | null. Only an exact keyword counts, so "stop the onions" is a normal message. */
export function consentCommand(text) {
  const t = norm(text);
  if (STOP_WORDS.has(t)) return 'stop';
  if (START_WORDS.has(t)) return 'start';
  return null;
}

// ---- Asking for a person ----
const HUMAN = [/\b(talk|speak|chat) (to|with) (a |an )?(human|person|agent|staff|manager|someone|real person)\b/i, /\b(human|real person|live agent|customer (care|service|support))\b/i,
  /\b(insaan|insan|banda|bande|admin|manager|staff|owner|malik)\s+(se|sy|say)\s+(baat|bat|bt)\b/i, /\b(kisi|kissi)\s+(insaan|insan|bande|banday)\b/i,
  /انسان|کسی\s*بندے|مینیجر\s*سے\s*بات|موظف|شخص\s*حقيقي|خدمة\s*العملاء|مدير/];
export function asksForHuman(text) {
  const s = String(text ?? '').slice(0, 500);
  return HUMAN.some(re => re.test(s));
}

const REPLIES = {
  stop: { en: 'Done. You will not get automatic messages from us any more. Reply START to turn them back on.', roman_ur: 'Theek hai. Ab aap ko hamari taraf se automatic messages nahi aayenge. Dobara shuru karne ke liye START likhein.', ur: 'ٹھیک ہے۔ اب آپ کو ہماری طرف سے خودکار پیغامات نہیں آئیں گے۔ دوبارہ شروع کرنے کے لیے START لکھیں۔', ar: 'تم. لن تصلك رسائل تلقائية منا بعد الآن. أرسل START لإعادة تفعيلها.' },
  start: { en: 'Welcome back! Automatic replies are on again. How can we help?', roman_ur: 'Khush aamdeed! Automatic replies dobara on hain. Hum aap ki kya madad kar sakte hain?', ur: 'خوش آمدید! خودکار جوابات دوبارہ شروع ہیں۔ ہم آپ کی کیا مدد کر سکتے ہیں؟', ar: 'مرحبًا بعودتك! تم تفعيل الردود التلقائية. كيف يمكننا مساعدتك؟' },
  human: { en: 'Sure, a person from our team will reply to you here shortly.', roman_ur: 'Ji zaroor, hamari team ka koi member jaldi yahan aap ko jawab dega.', ur: 'جی ضرور، ہماری ٹیم کا کوئی فرد جلد یہاں آپ کو جواب دے گا۔', ar: 'بالتأكيد، سيرد عليك أحد أفراد فريقنا هنا قريبًا.' },
};
/** Fixed reply text in the customer's language (English when unknown). */
export function fixedReply(kind, language) {
  const set = REPLIES[kind];
  return set ? set[language] || set.en : '';
}

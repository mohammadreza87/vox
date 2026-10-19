/** Synthetic, public test task only. No recorded user transcript or private media. */
export const PREDICTION_FIXTURES = [
  { id: 'en-recall', locale: 'en', text: 'What did we decide about Friday?', route: 'recall', delayMs: 15, failure: null },
  { id: 'fa-recall', locale: 'fa', text: 'درباره جمعه چه تصمیمی گرفتیم؟', route: 'recall', delayMs: 15, failure: null },
  { id: 'en-task', locale: 'en', text: 'Help me prepare an outline.', route: 'task', delayMs: 30, failure: null },
  { id: 'fa-task', locale: 'fa', text: 'کمکم کن طرح اولیه آماده کنم.', route: 'task', delayMs: 30, failure: null },
  { id: 'en-image', locale: 'en', text: 'What type of image did I share?', route: 'scene', delayMs: 25, failure: null, image: true },
  { id: 'fa-image', locale: 'fa', text: 'چه نوع تصویری فرستادم؟', route: 'scene', delayMs: 25, failure: null, image: true },
  { id: 'en-refusal', locale: 'en', text: 'Synthetic refusal case.', route: 'unknown', delayMs: 15, failure: 'refusal' },
  { id: 'fa-refusal', locale: 'fa', text: 'نمونه مصنوعی امتناع.', route: 'unknown', delayMs: 15, failure: 'refusal' },
  { id: 'en-deadline', locale: 'en', text: 'Synthetic delayed route.', route: 'unknown', delayMs: 650, failure: 'timeout' },
  { id: 'fa-deadline', locale: 'fa', text: 'مسیر با تاخیر مصنوعی.', route: 'unknown', delayMs: 650, failure: 'timeout' },
] as const;

export const SYNTHETIC_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

// Supported languages by ElevenLabs multilingual model
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', flag: '🇵🇭' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', flag: '🇧🇬' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', flag: '🇭🇷' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', flag: '🇸🇰' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', flag: '🇭🇺' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
] as const;

// Sample texts for voice cloning in different languages (~30 seconds when read aloud)
export const SAMPLE_TEXTS: Record<string, string> = {
  en: "The quick brown fox jumps over the lazy dog, while a clever zebra gazes quietly across the field. Small waves ripple under the bright evening sky, and mixed voices echo through the open air. Every unique sound shapes the way we speak, from sharp consonants to warm vowels. As you read this passage, try to keep a steady pace and clear tone so the system can capture your natural voice.",
  es: "El rápido zorro marrón salta sobre el perro perezoso, mientras una cebra astuta mira tranquilamente a través del campo. Pequeñas olas ondean bajo el brillante cielo del atardecer, y voces mezcladas resuenan en el aire libre. Cada sonido único da forma a nuestra manera de hablar, desde consonantes agudas hasta vocales cálidas. Mientras lees este pasaje, intenta mantener un ritmo constante y un tono claro para que el sistema pueda capturar tu voz natural.",
  fr: "Le renard brun rapide saute par-dessus le chien paresseux, tandis qu'un zèbre intelligent regarde tranquillement à travers le champ. De petites vagues ondulent sous le ciel lumineux du soir, et des voix mélangées résonnent dans l'air libre. Chaque son unique façonne notre façon de parler, des consonnes aiguës aux voyelles chaudes. En lisant ce passage, essayez de maintenir un rythme régulier et un ton clair pour que le système puisse capturer votre voix naturelle.",
  de: "Der schnelle braune Fuchs springt über den faulen Hund, während ein cleveres Zebra ruhig über das Feld schaut. Kleine Wellen kräuseln sich unter dem hellen Abendhimmel, und gemischte Stimmen hallen durch die freie Luft. Jeder einzigartige Klang formt die Art, wie wir sprechen, von scharfen Konsonanten bis zu warmen Vokalen. Während Sie diesen Text lesen, versuchen Sie ein gleichmäßiges Tempo und einen klaren Ton zu halten, damit das System Ihre natürliche Stimme erfassen kann.",
  it: "La veloce volpe marrone salta sopra il cane pigro, mentre una zebra intelligente guarda tranquillamente attraverso il campo. Piccole onde si increspano sotto il luminoso cielo serale, e voci miste echeggiano nell'aria aperta. Ogni suono unico plasma il modo in cui parliamo, dalle consonanti acute alle vocali calde. Mentre leggi questo passaggio, cerca di mantenere un ritmo costante e un tono chiaro affinché il sistema possa catturare la tua voce naturale.",
  pt: "A rápida raposa marrom pula sobre o cachorro preguiçoso, enquanto uma zebra esperta olha tranquilamente através do campo. Pequenas ondas ondulam sob o céu brilhante da noite, e vozes misturadas ecoam pelo ar aberto. Cada som único molda a maneira como falamos, de consoantes agudas a vogais quentes. Ao ler esta passagem, tente manter um ritmo constante e um tom claro para que o sistema possa capturar sua voz natural.",
  pl: "Szybki brązowy lis przeskakuje nad leniwym psem, podczas gdy sprytna zebra spokojnie patrzy przez pole. Małe fale falują pod jasnym wieczornym niebem, a zmieszane głosy rozbrzmiewają w otwartym powietrzu. Każdy unikalny dźwięk kształtuje sposób, w jaki mówimy, od ostrych spółgłosek po ciepłe samogłoski. Czytając ten fragment, staraj się utrzymać stałe tempo i czysty ton, aby system mógł uchwycić Twój naturalny głos.",
  tr: "Hızlı kahverengi tilki tembel köpeğin üzerinden atlarken, zeki bir zebra sessizce tarlanın karşısına bakıyor. Küçük dalgalar parlak akşam gökyüzünün altında dalgalanıyor ve karışık sesler açık havada yankılanıyor. Her benzersiz ses, keskin ünsüzlerden sıcak ünlülere kadar konuşma şeklimizi şekillendiriyor. Bu pasajı okurken, sistemin doğal sesinizi yakalayabilmesi için sabit bir tempo ve net bir ton tutmaya çalışın.",
  ru: "Быстрая коричневая лиса прыгает через ленивую собаку, в то время как умная зебра спокойно смотрит через поле. Маленькие волны рябят под ярким вечерним небом, и смешанные голоса разносятся по открытому воздуху. Каждый уникальный звук формирует то, как мы говорим, от резких согласных до теплых гласных. Читая этот отрывок, старайтесь сохранять ровный темп и чистый тон, чтобы система могла записать ваш естественный голос.",
  nl: "De snelle bruine vos springt over de luie hond, terwijl een slimme zebra rustig over het veld kijkt. Kleine golven rimpelen onder de heldere avondlucht, en gemengde stemmen weerklinken door de open lucht. Elk uniek geluid vormt de manier waarop we spreken, van scherpe medeklinkers tot warme klinkers. Terwijl u deze passage leest, probeer een constant tempo en een heldere toon aan te houden zodat het systeem uw natuurlijke stem kan vastleggen.",
  cs: "Rychlá hnědá liška skáče přes líného psa, zatímco chytrá zebra klidně hledí přes pole. Malé vlny se vlní pod jasným večerním nebem a smíšené hlasy se ozývají v otevřeném vzduchu. Každý jedinečný zvuk utváří způsob, jakým mluvíme, od ostrých souhlásek po teplé samohlásky. Při čtení této pasáže se snažte udržovat stálé tempo a jasný tón, aby systém mohl zachytit váš přirozený hlas.",
  ar: "يقفز الثعلب البني السريع فوق الكلب الكسول، بينما تنظر حمار وحشي ذكي بهدوء عبر الحقل. تتموج أمواج صغيرة تحت سماء المساء الساطعة، وتتردد أصوات مختلطة في الهواء الطلق. كل صوت فريد يشكل طريقة كلامنا، من الحروف الساكنة الحادة إلى الحروف المتحركة الدافئة. أثناء قراءتك لهذا النص، حاول الحفاظ على وتيرة ثابتة ونبرة واضحة حتى يتمكن النظام من التقاط صوتك الطبيعي.",
  zh: "敏捷的棕色狐狸跳过懒惰的狗，而一只聪明的斑马静静地凝视着田野。小小的波浪在明亮的夜空下荡漾，混杂的声音在开阔的空气中回响。每一个独特的声音都塑造了我们说话的方式，从尖锐的辅音到温暖的元音。当你朗读这段文字时，请尽量保持稳定的节奏和清晰的语调，这样系统才能捕捉到你自然的声音。",
  ja: "素早い茶色のキツネが怠け者の犬を飛び越え、賢いシマウマが静かに野原を見渡しています。小さな波が明るい夕空の下でさざめき、混ざり合った声が開けた空気の中に響きます。鋭い子音から暖かい母音まで、それぞれのユニークな音が私たちの話し方を形作ります。この文章を読むときは、システムがあなたの自然な声を捉えられるように、一定のペースとクリアなトーンを保つようにしてください。",
  ko: "재빠른 갈색 여우가 게으른 개를 뛰어넘고, 영리한 얼룩말이 들판 너머를 조용히 바라봅니다. 작은 파도가 밝은 저녁 하늘 아래 잔물결을 일으키고, 섞인 목소리들이 열린 공기 속에 울려 퍼집니다. 날카로운 자음부터 따뜻한 모음까지, 각각의 독특한 소리가 우리가 말하는 방식을 형성합니다. 이 구절을 읽을 때 시스템이 당신의 자연스러운 목소리를 포착할 수 있도록 일정한 속도와 명확한 톤을 유지하세요.",
  hi: "तेज भूरी लोमड़ी आलसी कुत्ते के ऊपर कूदती है, जबकि एक चतुर ज़ेबरा खेत के पार चुपचाप देखता है। छोटी लहरें चमकीले शाम के आकाश के नीचे लहराती हैं, और मिश्रित आवाज़ें खुली हवा में गूंजती हैं। हर अनोखी ध्वनि हमारे बोलने के तरीके को आकार देती है, तेज व्यंजनों से लेकर गर्म स्वरों तक। जब आप इस अनुच्छेद को पढ़ें, तो एक स्थिर गति और स्पष्ट स्वर बनाए रखने का प्रयास करें ताकि सिस्टम आपकी प्राकृतिक आवाज़ को पकड़ सके।",
  id: "Rubah coklat yang cepat melompati anjing malas, sementara zebra cerdas memandang dengan tenang melintasi ladang. Gelombang kecil beriak di bawah langit malam yang cerah, dan suara-suara bercampur menggema di udara terbuka. Setiap suara unik membentuk cara kita berbicara, dari konsonan tajam hingga vokal hangat. Saat Anda membaca bagian ini, cobalah untuk menjaga tempo yang stabil dan nada yang jelas sehingga sistem dapat menangkap suara alami Anda.",
  fil: "Ang mabilis na kayumangging soro ay tumalon sa ibabaw ng tamad na aso, habang ang matalinong zebra ay tahimik na tumitingin sa kabila ng bukid. Maliit na alon ang umaagos sa ilalim ng maliwanag na langit ng gabi, at magkahalong mga boses ang umaalingawngaw sa bukas na hangin. Bawat natatanging tunog ay humuhubog sa paraan ng ating pagsasalita, mula sa matalas na katinig hanggang sa mainit na patinig. Habang binabasa mo ang siping ito, sikaping panatilihin ang matatag na tempo at malinaw na tono upang makuha ng sistema ang iyong natural na boses.",
  sv: "Den snabba bruna räven hoppar över den lata hunden, medan en klok zebra lugnt blickar över fältet. Små vågor krusas under den ljusa kvällshimlen, och blandade röster ekar genom den öppna luften. Varje unikt ljud formar hur vi talar, från skarpa konsonanter till varma vokaler. När du läser denna passage, försök hålla ett jämnt tempo och en klar ton så att systemet kan fånga din naturliga röst.",
  bg: "Бързата кафява лисица скача над мързеливото куче, докато умна зебра спокойно гледа през полето. Малки вълни се плискат под яркото вечерно небе, а смесени гласове ехтят в открития въздух. Всеки уникален звук оформя начина, по който говорим, от остри съгласни до топли гласни. Докато четете този пасаж, опитайте се да поддържате постоянно темпо и ясен тон, за да може системата да улови естествения ви глас.",
  ro: "Vulpea brună rapidă sare peste câinele leneș, în timp ce o zebră inteligentă privește liniștită peste câmp. Valuri mici se ondulează sub cerul luminos de seară, iar voci amestecate răsună în aerul liber. Fiecare sunet unic modelează modul în care vorbim, de la consoane ascuțite la vocale calde. Pe măsură ce citiți acest pasaj, încercați să mențineți un ritm constant și un ton clar pentru ca sistemul să vă poată capta vocea naturală.",
  el: "Η γρήγορη καφέ αλεπού πηδάει πάνω από το τεμπέλικο σκυλί, ενώ μια έξυπνη ζέβρα κοιτάζει ήρεμα πέρα από το χωράφι. Μικρά κύματα κυματίζουν κάτω από τον φωτεινό βραδινό ουρανό, και ανάμεικτες φωνές αντηχούν στον ανοιχτό αέρα. Κάθε μοναδικός ήχος διαμορφώνει τον τρόπο που μιλάμε, από οξέα σύμφωνα έως θερμά φωνήεντα. Καθώς διαβάζετε αυτό το απόσπασμα, προσπαθήστε να διατηρήσετε σταθερό ρυθμό και καθαρό τόνο ώστε το σύστημα να μπορεί να καταγράψει τη φυσική σας φωνή.",
  fi: "Nopea ruskea kettu hyppää laiskan koiran yli, kun älykäs seepra katselee rauhallisesti pellon yli. Pienet aallot värelevät kirkkaan iltataivaan alla, ja sekoittuneet äänet kaikuvat avoimessa ilmassa. Jokainen ainutlaatuinen ääni muokkaa tapaamme puhua, terävistä konsonanteista lämpimiin vokaaleihin. Kun luet tätä tekstiä, yritä pitää tasainen tahti ja selkeä ääni, jotta järjestelmä voi tallentaa luonnollisen äänesi.",
  hr: "Brza smeđa lisica skače preko lijenog psa, dok pametna zebra mirno gleda preko polja. Mali valovi se talasaju pod vedrim večernjim nebom, a mješoviti glasovi odjekuju na otvorenom zraku. Svaki jedinstveni zvuk oblikuje način na koji govorimo, od oštrih suglasnika do toplih samoglasnika. Dok čitate ovaj odlomak, pokušajte održati ujednačen tempo i jasan ton kako bi sustav mogao uhvatiti vaš prirodni glas.",
  ms: "Musang coklat yang pantas melompat melepasi anjing yang malas, manakala zebra yang bijak memandang dengan tenang melintasi padang. Ombak kecil beriak di bawah langit malam yang cerah, dan suara bercampur bergema di udara terbuka. Setiap bunyi unik membentuk cara kita bercakap, daripada konsonan tajam kepada vokal hangat. Semasa anda membaca petikan ini, cuba kekalkan tempo yang stabil dan nada yang jelas supaya sistem dapat menangkap suara semula jadi anda.",
  sk: "Rýchla hnedá líška skáče cez lenivého psa, zatiaľ čo múdra zebra pokojne hľadí cez pole. Malé vlny sa vlnia pod jasnou večernou oblohou a zmiešané hlasy sa ozývajú v otvorenom vzduchu. Každý jedinečný zvuk formuje spôsob, akým hovoríme, od ostrých spoluhlások po teplé samohlásky. Pri čítaní tejto pasáže sa snažte udržiavať stabilné tempo a jasný tón, aby systém mohol zachytiť váš prirodzený hlas.",
  da: "Den hurtige brune ræv springer over den dovne hund, mens en klog zebra stille kigger hen over marken. Små bølger krusninger under den lyse aftenhimmel, og blandede stemmer genlyder gennem den åbne luft. Hver enestående lyd former den måde, vi taler på, fra skarpe konsonanter til varme vokaler. Når du læser denne passage, så prøv at holde et stabilt tempo og en klar tone, så systemet kan fange din naturlige stemme.",
  ta: "விரைவான பழுப்பு நரி சோம்பேறி நாயின் மேல் குதிக்கிறது, அதே நேரத்தில் புத்திசாலி வரிக்குதிரை வயல் முழுவதும் அமைதியாகப் பார்க்கிறது. சிறிய அலைகள் பிரகாசமான மாலை வானத்தின் கீழ் அலைகிறது, கலந்த குரல்கள் திறந்த காற்றில் எதிரொலிக்கின்றன. கூர்மையான மெய்யெழுத்துகள் முதல் சூடான உயிரெழுத்துகள் வரை, ஒவ்வொரு தனித்துவமான ஒலியும் நாம் பேசும் விதத்தை வடிவமைக்கிறது. இந்த பத்தியைப் படிக்கும்போது, கணினி உங்கள் இயற்கையான குரலைப் பிடிக்கும் வகையில் நிலையான வேகத்தையும் தெளிவான தொனியையும் பராமரிக்க முயற்சிக்கவும்.",
  uk: "Швидка коричнева лисиця стрибає через ледачого пса, тоді як розумна зебра спокійно дивиться через поле. Маленькі хвилі хвилюються під яскравим вечірнім небом, і змішані голоси лунають у відкритому повітрі. Кожен унікальний звук формує те, як ми говоримо, від різких приголосних до теплих голосних. Читаючи цей уривок, намагайтеся підтримувати рівний темп і чіткий тон, щоб система могла записати ваш природний голос.",
  hu: "A gyors barna róka átugrik a lusta kutya felett, miközben egy okos zebra nyugodtan néz át a mezőn. Apró hullámok fodrozódnak a fényes esti ég alatt, és kevert hangok visszhangzanak a szabad levegőn. Minden egyedi hang formálja beszédünket, az éles mássalhangzóktól a meleg magánhangzókig. Miközben ezt a szöveget olvassa, próbáljon egyenletes tempót és tiszta hangot tartani, hogy a rendszer rögzíthesse természetes hangját.",
  no: "Den raske brune reven hopper over den late hunden, mens en klok sebra rolig ser utover jordet. Små bølger krusninger under den lyse kveldshimmelen, og blandede stemmer gir gjenklang gjennom den åpne luften. Hver unike lyd former måten vi snakker på, fra skarpe konsonanter til varme vokaler. Når du leser denne passasjen, prøv å holde et jevnt tempo og en klar tone slik at systemet kan fange din naturlige stemme.",
  vi: "Con cáo nâu nhanh nhẹn nhảy qua con chó lười, trong khi một con ngựa vằn thông minh lặng lẽ nhìn qua cánh đồng. Những con sóng nhỏ gợn lên dưới bầu trời tối sáng, và những giọng nói hỗn hợp vang vọng trong không khí mở. Mỗi âm thanh độc đáo định hình cách chúng ta nói, từ phụ âm sắc nét đến nguyên âm ấm áp. Khi bạn đọc đoạn văn này, hãy cố gắng duy trì nhịp độ ổn định và giọng nói rõ ràng để hệ thống có thể nắm bắt giọng nói tự nhiên của bạn.",
};

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

export interface TranslatorVoice {
  voiceId: string;
  name: string;
  sourceLanguage: LanguageCode;
  createdAt: string;
}

interface TranslatorContextType {
  // Setup state
  isSetupComplete: boolean;
  translatorVoice: TranslatorVoice | null;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;

  // Actions
  setSourceLanguage: (lang: LanguageCode) => void;
  setTargetLanguage: (lang: LanguageCode) => void;
  saveTranslatorVoice: (voice: TranslatorVoice) => void;
  clearTranslatorVoice: () => void;
  getSampleText: (lang: LanguageCode) => string;
}

const TranslatorContext = createContext<TranslatorContextType | undefined>(undefined);

const TRANSLATOR_VOICE_KEY = 'vox_translator_voice';
const TRANSLATOR_SETTINGS_KEY = 'vox_translator_settings';

export function TranslatorProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [translatorVoice, setTranslatorVoice] = useState<TranslatorVoice | null>(null);
  const [sourceLanguage, setSourceLanguageState] = useState<LanguageCode>('en');
  const [targetLanguage, setTargetLanguageState] = useState<LanguageCode>('es');
  const [isLoaded, setIsLoaded] = useState(false);

  // Get user-specific storage key
  const getStorageKey = useCallback((baseKey: string) => {
    return user?.uid ? `${baseKey}_${user.uid}` : baseKey;
  }, [user?.uid]);

  // Load saved translator voice and settings from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const voiceKey = getStorageKey(TRANSLATOR_VOICE_KEY);
        const settingsKey = getStorageKey(TRANSLATOR_SETTINGS_KEY);

        const savedVoice = localStorage.getItem(voiceKey);
        if (savedVoice) {
          setTranslatorVoice(JSON.parse(savedVoice));
        }

        const savedSettings = localStorage.getItem(settingsKey);
        if (savedSettings) {
          const { sourceLanguage: savedSource, targetLanguage: savedTarget } = JSON.parse(savedSettings);
          if (savedSource) setSourceLanguageState(savedSource);
          if (savedTarget) setTargetLanguageState(savedTarget);
        }
      } catch (e) {
        console.error('Error loading translator settings:', e);
      }
      setIsLoaded(true);
    }
  }, [getStorageKey]);

  // Save settings when they change
  useEffect(() => {
    if (typeof window !== 'undefined' && isLoaded) {
      const settingsKey = getStorageKey(TRANSLATOR_SETTINGS_KEY);
      localStorage.setItem(settingsKey, JSON.stringify({
        sourceLanguage,
        targetLanguage,
      }));
    }
  }, [sourceLanguage, targetLanguage, isLoaded, getStorageKey]);

  const saveTranslatorVoice = useCallback((voice: TranslatorVoice) => {
    setTranslatorVoice(voice);
    if (typeof window !== 'undefined') {
      const voiceKey = getStorageKey(TRANSLATOR_VOICE_KEY);
      localStorage.setItem(voiceKey, JSON.stringify(voice));
    }
  }, [getStorageKey]);

  const clearTranslatorVoice = useCallback(() => {
    setTranslatorVoice(null);
    if (typeof window !== 'undefined') {
      const voiceKey = getStorageKey(TRANSLATOR_VOICE_KEY);
      localStorage.removeItem(voiceKey);
    }
  }, [getStorageKey]);

  const setSourceLanguage = useCallback((lang: LanguageCode) => {
    setSourceLanguageState(lang);
  }, []);

  const setTargetLanguage = useCallback((lang: LanguageCode) => {
    setTargetLanguageState(lang);
  }, []);

  const getSampleText = useCallback((lang: LanguageCode): string => {
    return SAMPLE_TEXTS[lang] || SAMPLE_TEXTS.en;
  }, []);

  const isSetupComplete = translatorVoice !== null;

  return (
    <TranslatorContext.Provider value={{
      isSetupComplete,
      translatorVoice,
      sourceLanguage,
      targetLanguage,
      setSourceLanguage,
      setTargetLanguage,
      saveTranslatorVoice,
      clearTranslatorVoice,
      getSampleText,
    }}>
      {children}
    </TranslatorContext.Provider>
  );
}

export function useTranslator() {
  const context = useContext(TranslatorContext);
  if (context === undefined) {
    throw new Error('useTranslator must be used within a TranslatorProvider');
  }
  return context;
}

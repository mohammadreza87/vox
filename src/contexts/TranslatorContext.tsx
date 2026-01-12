'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getClonedVoicesKey, getAllClonedVoices } from '@/shared/utils/storage';
import { ClonedVoice } from '@/shared/types';
import { auth } from '@/lib/firebase';
import { SUPPORTED_LANGUAGES as STORE_SUPPORTED_LANGUAGES } from '@/stores/translatorStore';

// Re-export SUPPORTED_LANGUAGES from the store (65 languages including Estonian, etc.)
export const SUPPORTED_LANGUAGES = STORE_SUPPORTED_LANGUAGES;

// Sample texts for voice cloning in different languages (~30 seconds when read aloud)
export const SAMPLE_TEXTS: Record<string, string> = {
  en: "Every unique sound shapes the way we speak, from sharp consonants to warm vowels. As you read this passage, try to keep a steady pace and clear tone so the system can capture your natural voice. The morning sun casts golden light across the quiet streets, while birds sing their gentle melodies in the distance. Take a deep breath and let your words flow naturally, allowing each syllable to resonate with clarity and warmth.",
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
  fa: "روباه قهوه‌ای چابک از روی سگ تنبل می‌پرد، در حالی که گورخر باهوش با آرامش به آن سوی مزرعه نگاه می‌کند. موج‌های کوچک زیر آسمان روشن غروب موج می‌زنند و صداهای مختلف در هوای آزاد طنین‌انداز می‌شوند. هر صدای منحصربه‌فرد شکل صحبت کردن ما را می‌سازد، از حروف صامت تیز گرفته تا حروف صدادار گرم. وقتی این متن را می‌خوانید، سعی کنید سرعت یکنواخت و لحن واضحی داشته باشید تا سیستم بتواند صدای طبیعی شما را ضبط کند. نور طلایی صبحگاهی بر خیابان‌های آرام می‌تابد و پرندگان آوازهای ملایم خود را در دوردست می‌خوانند.",
  et: "Kiire pruun rebane hüppab üle laisa koera, samal ajal kui tark sebra vaatab rahulikult üle põllu. Väikesed lained lainetavad ereda õhtutaeva all ning segased hääled kajavad avatud õhus. Iga unikaalne heli kujundab meie kõneviisi, teravate kaashäälikute ja soojadest täishäälikutest. Seda lõiku lugedes püüdke hoida ühtlast tempot ja selget tooni, et süsteem saaks jäädvustada teie loomulikku häält. Hommikune päike heidab kuldset valgust vaiksetele tänavatele, samal ajal kui linnud laulavad oma õrnu meloodiaid kauguses.",
  is: "Fljóti brúni refurinn hoppar yfir lata hundinn á meðan klár sebrahestur horfir rólega yfir völlinn. Litlar öldur hrökklast undir bjarta kvöldhimninum og blönduð röddin bergmálar í opnum loftinu. Hver einstakur hljóð mótar hvernig við tölum, frá hvössum samhljóðum til hlýrra sérhljóða. Þegar þú lest þessa efnisgrein, reyndu að halda jöfnum hraða og skýrum tón svo kerfið geti fangað náttúrulega rödd þína.",
  lv: "Ātrā brūnā lapsa lec pāri slinkajam sunim, kamēr gudrā zebra mierīgi skatās pāri laukam. Mazas viļņi viļņojas zem gaišās vakara debess, un jauktas balsis atbalsojas brīvā gaisā. Katra unikāla skaņa veido to, kā mēs runājam, no asiem līdzskaņiem līdz siltiem patskaņiem. Lasot šo fragmentu, mēģiniet saglabāt vienmērīgu tempu un skaidru toni, lai sistēma varētu uztvert jūsu dabisko balsi.",
  lt: "Greita ruda lapė šoka per tingų šunį, o protinga zebra ramiai žvelgia per lauką. Mažos bangos raibuliuoja po šviesiu vakaro dangumi, o maišyti balsai aidi atviroje ore. Kiekvienas unikalus garsas formuoja tai, kaip mes kalbame, nuo aštrių priebalsių iki šiltų balsių. Skaitydami šią ištrauką, stenkitės išlaikyti tolygų tempą ir aiškų toną, kad sistema galėtų užfiksuoti jūsų natūralų balsą.",
  sl: "Hitra rjava lisica skoči čez lenega psa, medtem ko pametna zebra mirno gleda čez polje. Majhni valovi se valijo pod svetlim večernim nebom, mešani glasovi pa odmevajo na prostem. Vsak edinstven zvok oblikuje način, kako govorimo, od ostrih soglasnikov do toplih samoglasnikov. Ko berete ta odlomek, poskusite ohranjati enakomeren tempo in jasen ton, da bo sistem lahko zajel vaš naravni glas.",
  sr: "Брза смеђа лисица скаче преко лењог пса, док паметна зебра мирно гледа преко поља. Мали таласи се таласају испод ведрог вечерњег неба, а помешани гласови одјекују на отвореном. Сваки јединствени звук обликује начин на који говоримо, од оштрих сугласника до топлих самогласника. Док читате овај одломак, покушајте да одржите уједначен темпо и јасан тон како би систем могао да ухвати ваш природни глас.",
  bs: "Brza smeđa lisica skače preko lijenog psa, dok pametna zebra mirno gleda preko polja. Mali valovi se talasaju ispod vedrog večernjeg neba, a pomiješani glasovi odjekuju na otvorenom. Svaki jedinstveni zvuk oblikuje način na koji govorimo, od oštrih suglasnika do toplih samoglasnika. Dok čitate ovaj odlomak, pokušajte održati ujednačen tempo i jasan ton kako bi sistem mogao uhvatiti vaš prirodni glas.",
  mk: "Брзата кафена лисица скока преку мрзливото куче, додека паметната зебра мирно гледа преку полето. Мали бранови се нишаат под светлото вечерно небо, а мешани гласови одекнуваат на отворено. Секој уникатен звук го обликува начинот на кој зборуваме, од остри согласки до топли самогласки. Додека го читате овој пасус, обидете се да одржувате постојано темпо и јасен тон за системот да може да го фати вашиот природен глас.",
  sq: "Dhelpra e shpejtë e kafenjtë hidhet mbi qenin dembel, ndërsa zebra e zgjuar shikon qetësisht nëpër fushë. Valë të vogla lëkunden nën qiellin e ndritshëm të mbrëmjes dhe zëra të përzier jehojnë në ajrin e hapur. Çdo tingull unik formon mënyrën se si flasim, nga bashkëtingëlloret e mprehta te zanoret e ngrohta. Ndërsa lexoni këtë pasazh, përpiquni të mbani një ritëm të qëndrueshëm dhe një ton të qartë që sistemi të mund të kapë zërin tuaj natyral.",
  be: "Хуткая бурая лісіца скача праз лянівага сабаку, у той час як разумная зебра спакойна глядзіць праз поле. Маленькія хвалі калышуцца пад яркім вечаровым небам, а змешаныя галасы разносяцца ў адкрытым паветры. Кожны ўнікальны гук фармуе тое, як мы гаворым, ад рэзкіх зычных да цёплых галосных. Чытаючы гэты ўрывак, старайцеся падтрымліваць роўны тэмп і выразны тон, каб сістэма магла захаваць ваш натуральны голас.",
  ca: "La rabosa marró ràpida salta per sobre del gos mandrós, mentre una zebra intel·ligent mira tranquil·lament a través del camp. Petites ones ondulen sota el cel brillant del vespre, i veus barrejades ressonen a l'aire lliure. Cada so únic forma la manera com parlem, des de consonants agudes fins a vocals càlides. Mentre llegiu aquest passatge, intenteu mantenir un ritme constant i un to clar perquè el sistema pugui capturar la vostra veu natural.",
  gl: "A raposa marrón rápida salta por riba do can preguiceiro, mentres unha cebra intelixente mira tranquilamente a través do campo. Pequenas ondas ondean baixo o ceo brillante da noite, e voces mesturadas resoan no aire aberto. Cada son único forma a maneira en que falamos, desde consoantes agudas ata vogais cálidas. Mentres les esta pasaxe, tenta manter un ritmo constante e un ton claro para que o sistema poida capturar a túa voz natural.",
  eu: "Azeri marroi azkarra txakur alferra gainetik salto egiten du, zebra adimentsu batek zelaia lasai begiratzen duen bitartean. Olatu txikiak arratsaldeko zeru distiratsuaren azpian kulunkatzen dira, eta ahots nahasteak aire zabalean oihartzunak sortzen dituzte. Soinu bakoitzak hitz egiteko modua moldatzen du, kontsonante zorrotzetatik bokal beroetara. Pasarte hau irakurtzen duzunean, saiatu erritmo egonkor bat eta tonu argi bat mantentzen, sistemak zure ahots naturala harrapatu ahal izan dezan.",
  ga: "Léimeann an sionnach donn tapa thar an madra leisciúil, agus séabra cliste ag breathnú go ciúin thar an bpáirc. Bíonn tonnta beaga ag luascadh faoin spéir gheal tráthnóna, agus guthanna measctha ag macallaigh san aer oscailte. Déanann gach fuaim uathúil cruth ar an mbealach a labhraímid, ó chonsain ghéara go gutaí teo. Agus tú ag léamh an sliocht seo, déan iarracht luas seasmhach agus ton soiléir a choinneáil ionas go mbeidh an córas in ann do ghuth nádúrtha a ghabháil.",
  cy: "Mae'r llwynog brown cyflym yn neidio dros y ci diog, tra bod sebra clyfar yn edrych yn dawel dros y cae. Mae tonnau bach yn rhyfeddu o dan yr awyr lachar gyda'r nos, ac mae lleisiau cymysg yn atseinio yn yr awyr agored. Mae pob sain unigryw yn siapio'r ffordd rydyn ni'n siarad, o gytseiniaid miniog i lafariaid cynnes. Wrth ddarllen y darn hwn, ceisiwch gynnal tempo cyson a thôn glir fel bod y system yn gallu dal eich llais naturiol.",
  he: "השועל החום המהיר קופץ מעל הכלב העצלן, בעוד זברה חכמה מביטה בשלווה על פני השדה. גלים קטנים מתנופפים מתחת לשמיים הבהירים של הערב, וקולות מעורבים מהדהדים באוויר הפתוח. כל צליל ייחודי מעצב את הדרך שבה אנחנו מדברים, מעיצורים חדים לתנועות חמות. בעת קריאת קטע זה, נסו לשמור על קצב קבוע וטון ברור כדי שהמערכת תוכל ללכוד את קולכם הטבעי.",
  ka: "სწრაფი ყავისფერი მელა ხტება ზარმაც ძაღლს, ხოლო ჭკვიანი ზებრა მშვიდად უყურებს მინდორს. პატარა ტალღები ნაპირდებიან კაშკაშა საღამოს ცის ქვეშ და შერეული ხმები ისმის ღია ჰაერში. ყოველი უნიკალური ბგერა აყალიბებს ჩვენი მეტყველების წესს, მკვეთრი თანხმოვნებიდან თბილ ხმოვნებამდე. ამ ნაწყვეტის კითხვისას შეეცადეთ შეინარჩუნოთ თანაბარი ტემპი და მკაფიო ტონი, რომ სისტემამ შეძლოს თქვენი ბუნებრივი ხმის დაფიქსირება.",
  hy: "The quick brown fox jumps over the lazy dog while a clever zebra gazes calmly across the field. Small waves ripple beneath the bright evening sky and mixed voices echo through the open air. Every unique sound shapes how we speak from sharp consonants to warm vowels. As you read this passage try to keep a steady pace and clear tone so the system can capture your natural voice.",
  az: "Sürətli qəhvəyi tülkü tənbəl itin üstündən atılır, ağıllı zebra isə sakitcə çölə baxır. Kiçik dalğalar parlaq axşam səmasının altında yellənir və qarışıq səslər açıq havada əks-səda verir. Hər unikal səs danışıq tərzimizi formalaşdırır, kəskin samitlərdən isti saitlərə qədər. Bu parçanı oxuyarkən sistemin təbii səsinizi tutması üçün sabit tempi və aydın tonu saxlamağa çalışın.",
  kk: "Жылдам қоңыр түлкі жалқау иттің үстінен секіреді, ал ақылды зебра алаңға тыныш қарайды. Кішкентай толқындар жарық кешкі аспан астында толқиды, ал араласқан дауыстар ашық ауада жаңғырады. Әрбір бірегей дыбыс біздің сөйлеу тәсілімізді қалыптастырады, өткір дауыссыздардан жылы дауыстыларға дейін. Осы үзіндіні оқығанда, жүйе сіздің табиғи дауысыңызды түсіре алуы үшін тұрақты темпті және анық үнді сақтауға тырысыңыз.",
  uz: "Tez jigarrang tulki dangasa itning ustidan sakraydi, aqlli zebra esa dalaga tinchgina qaraydi. Kichik to'lqinlar yorug' kechki osmon ostida to'lqinlanadi va aralash ovozlar ochiq havoda aks-sado beradi. Har bir noyob tovush bizning gapirish uslubimizni shakllantiradi, o'tkir undoshlardan iliq unlilargacha. Ushbu parchani o'qiyotganda, tizim sizning tabiiy ovozingizni qo'lga kiritishi uchun barqaror tempni va aniq ohangni saqlashga harakat qiling.",
  bn: "দ্রুত বাদামী শেয়াল অলস কুকুরের উপর দিয়ে লাফ দেয়, যখন একটি চতুর জেব্রা শান্তভাবে মাঠের দিকে তাকায়। ছোট ঢেউগুলি উজ্জ্বল সন্ধ্যার আকাশের নীচে দোলায়, এবং মিশ্র কণ্ঠস্বর খোলা বাতাসে প্রতিধ্বনিত হয়। প্রতিটি অনন্য শব্দ আমাদের কথা বলার ধরণকে আকার দেয়, তীক্ষ্ণ ব্যঞ্জনবর্ণ থেকে উষ্ণ স্বরবর্ণ পর্যন্ত। এই অনুচ্ছেদটি পড়ার সময়, একটি স্থির গতি এবং স্পষ্ট স্বর বজায় রাখার চেষ্টা করুন যাতে সিস্টেম আপনার স্বাভাবিক কণ্ঠস্বর ধরতে পারে।",
  ur: "تیز بھوری لومڑی سست کتے کے اوپر سے چھلانگ لگاتی ہے، جبکہ ایک ہوشیار زیبرا خاموشی سے میدان کی طرف دیکھتا ہے۔ چھوٹی لہریں روشن شام کے آسمان کے نیچے لہراتی ہیں، اور ملی جلی آوازیں کھلی ہوا میں گونجتی ہیں۔ ہر منفرد آواز ہمارے بولنے کے انداز کو شکل دیتی ہے، تیز حروف سے لے کر گرم حروف تک۔ اس حصے کو پڑھتے وقت، ایک مستحکم رفتار اور واضح لہجہ برقرار رکھنے کی کوشش کریں تاکہ نظام آپ کی قدرتی آواز کو پکڑ سکے۔",
  th: "สุนัขจิ้งจอกสีน้ำตาลที่ว่องไวกระโดดข้ามสุนัขขี้เกียจ ขณะที่ม้าลายที่ฉลาดมองข้ามทุ่งอย่างสงบ คลื่นเล็กๆ กระเพื่อมใต้ท้องฟ้ายามเย็นที่สว่างสดใส และเสียงที่ผสมผสานก้องกังวานในอากาศที่เปิดโล่ง เสียงที่ไม่เหมือนใครแต่ละเสียงหล่อหลอมวิธีที่เราพูด ตั้งแต่พยัญชนะที่แหลมคมไปจนถึงสระที่อบอุ่น ขณะอ่านข้อความนี้ พยายามรักษาจังหวะที่สม่ำเสมอและน้ำเสียงที่ชัดเจน เพื่อให้ระบบสามารถจับเสียงธรรมชาติของคุณได้",
  my: "မြန်ဆန်သော အညိုရောင်မြေခွေးသည် ပျင်းရိသော ခွေးကို ခုန်ကျော်သွားပြီး၊ လိမ္မာသော မြင်းကျားသည် လယ်ကွင်းကို ငြိမ်သက်စွာ ကြည့်နေသည်။ လှိုင်းငယ်များသည် တောက်ပသော ညနေခင်းမိုးကောင်းကင်အောက်တွင် လှိုင်းထနေပြီး၊ ရောနှောထားသော အသံများသည် ပွင့်လင်းသော လေထဲတွင် ပဲ့တင်ထပ်နေသည်။ ထူးခြားသော အသံတစ်ခုစီသည် ကျွန်ုပ်တို့ပြောဆိုပုံကို ပုံဖော်ပေးသည်၊ ချွန်ထက်သော ဗျည်းများမှ နွေးထွေးသော သရများအထိ။",
  af: "Die vinnige bruin jakkals spring oor die lui hond, terwyl 'n slim sebra rustig oor die veld kyk. Klein golwe rimpel onder die helder aandhemel, en gemengde stemme eggo in die oop lug. Elke unieke klank vorm die manier waarop ons praat, van skerp medeklinkers tot warm klinkers. Terwyl jy hierdie gedeelte lees, probeer om 'n bestendige tempo en 'n helder toon te handhaaf sodat die stelsel jou natuurlike stem kan vasvang.",
  sw: "Mbweha wa kahawia mwepesi anaruka juu ya mbwa mvivu, wakati punda milia mwerevu anatazama kwa utulivu uwanjani. Mawimbi madogo yanayumba chini ya anga angavu la jioni, na sauti zilizochanganyika zinasikika hewani wazi. Kila sauti ya kipekee huunda jinsi tunavyozungumza, kutoka konsonanti kali hadi vokali za joto. Unaposoma kifungu hiki, jaribu kudumisha kasi thabiti na sauti wazi ili mfumo uweze kunasa sauti yako ya asili.",
  am: "ፈጣኑ ቡናማ ቀበሮ በሰነፉ ውሻ ላይ ይዘላል፣ ብልህ ዝብራ በእርጋታ ሜዳውን ይመለከታል። ትንንሽ ሞገዶች በደማቅ የምሽት ሰማይ ስር ይንቀሳቀሳሉ፣ የተቀላቀሉ ድምፆች በክፍት አየር ውስጥ ያስተጋባሉ። እያንዳንዱ ልዩ ድምፅ የምንናገርበትን መንገድ ይቀርጻል፣ ከሹል ተነባቢዎች እስከ ሞቅ ያሉ አናባቢዎች። ይህን አንቀጽ ስታነቡ፣ ስርዓቱ ተፈጥሯዊ ድምፅዎን እንዲይዝ የተረጋጋ ፍጥነት እና ግልጽ ድምፅ ለመጠበቅ ሞክሩ።",
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

  // Available cloned voices from contact creation
  availableClonedVoices: ClonedVoice[];

  // Actions
  setSourceLanguage: (lang: LanguageCode) => void;
  setTargetLanguage: (lang: LanguageCode) => void;
  saveTranslatorVoice: (voice: TranslatorVoice) => void;
  clearTranslatorVoice: () => void;
  getSampleText: (lang: LanguageCode) => string;
  useExistingVoice: (voice: ClonedVoice, sourceLanguage: LanguageCode) => void;
}

const TranslatorContext = createContext<TranslatorContextType | undefined>(undefined);

const TRANSLATOR_VOICE_KEY = 'vox_translator_voice';
const TRANSLATOR_SETTINGS_KEY = 'vox_translator_settings';

export function TranslatorProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const [translatorVoice, setTranslatorVoice] = useState<TranslatorVoice | null>(null);
  const [sourceLanguage, setSourceLanguageState] = useState<LanguageCode>('en');
  const [targetLanguage, setTargetLanguageState] = useState<LanguageCode>('es');
  const [isLoaded, setIsLoaded] = useState(false);
  const [availableClonedVoices, setAvailableClonedVoices] = useState<ClonedVoice[]>([]);

  // Get user-specific storage key
  const getStorageKey = useCallback((baseKey: string) => {
    return user?.uid ? `${baseKey}_${user.uid}` : baseKey;
  }, [user?.uid]);

  // Load available cloned voices from Firestore (or localStorage as fallback)
  const loadClonedVoices = useCallback(async () => {
    if (!user?.uid) {
      // Not logged in - use localStorage only
      if (typeof window !== 'undefined') {
        const allVoices = getAllClonedVoices(null);
        setAvailableClonedVoices(allVoices);
      }
      return;
    }

    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) {
        // Fallback to localStorage
        const allVoices = getAllClonedVoices(user.uid);
        setAvailableClonedVoices(allVoices);
        return;
      }

      const response = await fetch('/api/user/voices', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const responseData = await response.json();
        const data = responseData.data || responseData;
        const voices: ClonedVoice[] = (data.voices || []).map((v: { id: string; voiceId: string; name: string; source: string; sourceLanguage?: string; createdAt: string }) => ({
          id: v.id,
          voiceId: v.voiceId,
          name: v.name,
          source: v.source,
          sourceLanguage: v.sourceLanguage,
          createdAt: v.createdAt,
        }));
        setAvailableClonedVoices(voices);

        // Set default translator voice if exists
        if (data.defaultTranslatorVoiceId) {
          const defaultVoice = voices.find(v => v.voiceId === data.defaultTranslatorVoiceId);
          if (defaultVoice && !translatorVoice) {
            setTranslatorVoice({
              voiceId: defaultVoice.voiceId,
              name: defaultVoice.name,
              sourceLanguage: (defaultVoice.sourceLanguage || 'en') as LanguageCode,
              createdAt: defaultVoice.createdAt,
            });
          }
        }

        // Also sync to localStorage for offline access
        if (typeof window !== 'undefined') {
          const clonedVoicesKey = getClonedVoicesKey(user.uid);
          localStorage.setItem(clonedVoicesKey, JSON.stringify(voices));
        }
      } else {
        // Fallback to localStorage
        const allVoices = getAllClonedVoices(user.uid);
        setAvailableClonedVoices(allVoices);
      }
    } catch (e) {
      console.error('Error loading cloned voices from Firestore:', e);
      // Fallback to localStorage
      const allVoices = getAllClonedVoices(user?.uid || null);
      setAvailableClonedVoices(allVoices);
    }
  }, [user?.uid, translatorVoice]);

  // Load available cloned voices on mount
  useEffect(() => {
    loadClonedVoices();
  }, [loadClonedVoices]);

  // Load saved translator voice and settings from localStorage (as initial state before Firestore loads)
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

  const saveTranslatorVoice = useCallback(async (voice: TranslatorVoice) => {
    setTranslatorVoice(voice);
    if (typeof window !== 'undefined') {
      const voiceKey = getStorageKey(TRANSLATOR_VOICE_KEY);
      localStorage.setItem(voiceKey, JSON.stringify(voice));

      // Also save to shared cloned voices storage so it appears in contact creation
      const clonedVoicesKey = getClonedVoicesKey(user?.uid || null);
      try {
        const existingVoices: ClonedVoice[] = JSON.parse(localStorage.getItem(clonedVoicesKey) || '[]');
        // Check if this voice already exists
        if (!existingVoices.some(v => v.voiceId === voice.voiceId)) {
          existingVoices.push({
            id: `translator-${voice.voiceId}`,
            voiceId: voice.voiceId,
            name: voice.name,
            createdAt: voice.createdAt,
            source: 'translator',
            sourceLanguage: voice.sourceLanguage,
          });
          localStorage.setItem(clonedVoicesKey, JSON.stringify(existingVoices));
        }
      } catch (e) {
        console.error('Error saving to shared cloned voices:', e);
      }

      // Save to Firestore if logged in
      if (user?.uid) {
        try {
          const token = await auth?.currentUser?.getIdToken();
          if (token) {
            // Save voice to Firestore
            await fetch('/api/user/voices', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                voiceId: voice.voiceId,
                name: voice.name,
                source: 'translator',
                sourceLanguage: voice.sourceLanguage,
                isDefaultTranslator: true,
              }),
            });

            // Set as default translator voice
            await fetch('/api/user/voices', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                defaultTranslatorVoiceId: voice.voiceId,
              }),
            });
          }
        } catch (e) {
          console.error('Error saving translator voice to Firestore:', e);
        }
      }
    }
  }, [getStorageKey, user?.uid]);

  // Use an existing cloned voice from contact creation
  const useExistingVoice = useCallback(async (voice: ClonedVoice, sourceLang: LanguageCode) => {
    const translatorVoiceData: TranslatorVoice = {
      voiceId: voice.voiceId,
      name: voice.name,
      sourceLanguage: sourceLang,
      createdAt: voice.createdAt,
    };
    setTranslatorVoice(translatorVoiceData);
    if (typeof window !== 'undefined') {
      const voiceKey = getStorageKey(TRANSLATOR_VOICE_KEY);
      localStorage.setItem(voiceKey, JSON.stringify(translatorVoiceData));

      // Set as default translator voice in Firestore
      if (user?.uid) {
        try {
          const token = await auth?.currentUser?.getIdToken();
          if (token) {
            await fetch('/api/user/voices', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                defaultTranslatorVoiceId: voice.voiceId,
              }),
            });
          }
        } catch (e) {
          console.error('Error setting default translator voice in Firestore:', e);
        }
      }
    }
  }, [getStorageKey, user?.uid]);

  const clearTranslatorVoice = useCallback(async () => {
    setTranslatorVoice(null);
    if (typeof window !== 'undefined') {
      const voiceKey = getStorageKey(TRANSLATOR_VOICE_KEY);
      localStorage.removeItem(voiceKey);

      // Clear default translator voice in Firestore
      if (user?.uid) {
        try {
          const token = await auth?.currentUser?.getIdToken();
          if (token) {
            await fetch('/api/user/voices', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                defaultTranslatorVoiceId: null,
              }),
            });
          }
        } catch (e) {
          console.error('Error clearing default translator voice in Firestore:', e);
        }
      }
    }
  }, [getStorageKey, user?.uid]);

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
      availableClonedVoices,
      setSourceLanguage,
      setTargetLanguage,
      saveTranslatorVoice,
      clearTranslatorVoice,
      getSampleText,
      useExistingVoice,
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

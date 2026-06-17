// ══════════════════════════════════════════════════════════════════════════════
// SATAKA SANKHARAVAM — పద్యాల సంఖారవం — shared poem data
// Pulled out of app/page.tsx so it can be imported from both the client practice
// page and the server-rendered admin dashboard without dragging the 4MB
// embedded reference-audio string (which stays in app/page.tsx, the only place
// that needs it) into every bundle that touches poem metadata.
// ══════════════════════════════════════════════════════════════════════════════

export type Difficulty = "beginner" | "medium" | "advanced";

export interface PoemLine {
  tel: string;
  en: string;
}

export interface Poem {
  id: string;
  num: number;
  src: string;
  srcEn: string;
  difficulty: Difficulty;
  title: string;
  titleEn: string;
  meaning: string;
  lines: PoemLine[];
}

// ─── PER-POEM TIMESTAMPS in the single embedded MP3 ───────────────────────────
export const TS = [
  { start: 7.00, end: 26.58 },
  { start: 27.78, end: 46.00 },
  { start: 47.00, end: 63.00 },
  { start: 65.55, end: 84.00 },
  { start: 85.80, end: 101.50 },
  { start: 102.00, end: 120.48 },
  { start: 123.68, end: 140.28 },
  { start: 143.00, end: 169.06 },
  { start: 162.00, end: 180.00 },
  { start: 183.00, end: 203.00 },
  { start: 205.00, end: 224.00 },
  { start: 226.50, end: 245.16 },
  { start: 247.00, end: 265.00 },
  { start: 268.00, end: 288.00 },
  { start: 290.00, end: 310.00 },
  { start: 312.00, end: 330.00 },
  { start: 333.00, end: 350.00 },
  { start: 352.00, end: 370.00 },
];

// ─── 18 PADYALU — exact text from official transcript ────────────────────────
export const ALL_POEMS: Poem[] = [
  {
    id: "p01", num: 1, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "beginner",
    title: "తన కోపమే తన శత్రువు", titleEn: "Anger is One's Own Enemy",
    meaning: "One's anger is one's own enemy; one's calmness is one's own protection; compassion is one's relative; one's happiness is heaven; one's sorrow is hell — O Sumati!",
    lines: [
      { tel: "తన కోపమే తన శత్రువు", en: "Tana kopame tana shatrruvu" },
      { tel: "తన శాంతమే తనకు రక్ష దయ చుట్టంబౌ", en: "Tana shaantame tanaku raksha daya chuttambau" },
      { tel: "తన సంతోషమే స్వర్గము", en: "Tana santoshame svargamu" },
      { tel: "తన దుఃఖమే నరకమండ్రు తద్యము సుమతి", en: "Tana duhkhame narakamaandru tadyamu sumati" },
    ]
  },
  {
    id: "p02", num: 2, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "beginner",
    title: "వినదగునెవ్వరుచ చెప్పిన", titleEn: "Listen to All, Reflect Before Acting",
    meaning: "One should listen to whoever says whatever; one should not act hastily upon hearing; one who discerns truth from falsehood is truly a righteous person, O Sumati!",
    lines: [
      { tel: "వినదగునెవ్వరుచ చెప్పిన", en: "Vinadagunjevvaruca cheppina" },
      { tel: "వినినంతనే వేగపడక వివరింపదగున్", en: "Vininamtane vegapadaka vivarimpada gun" },
      { tel: "కనికల్ల నిజము తెలిసిన", en: "Kanikalla nijamu telisina" },
      { tel: "మనుజుడెపో నీతిపరుడు మహిలోసుమతి", en: "Manujudepo neetiparudu mahilosumati" },
    ]
  },
  {
    id: "p03", num: 3, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "beginner",
    title: "ఎప్పుడు సంపద గలిగిన", titleEn: "Wealth Attracts Relatives",
    meaning: "Whenever one has wealth, relatives come rushing — just as when a pond fills with water, ten thousand frogs gather around it, O Sumati!",
    lines: [
      { tel: "ఎప్పుడు సంపద గలిగిన అప్పుడు బంధువులు", en: "Eppudu sampada galigina appudu bandhuvulu" },
      { tel: "ఒత్తురది ఎట్లన్నన్", en: "Otturadi etlannan" },
      { tel: "తెప్పలుగ చెరువు నిండిన కప్పలు లుపదివేలు", en: "Teppaluga cheruvu nindina kappalu lupadivelu" },
      { tel: "చేరుగదరాసుమతి", en: "Cheruadarasumati" },
    ]
  },
  {
    id: "p04", num: 4, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "beginner",
    title: "ఏరకు మీ కసుగాయలు", titleEn: "Four Noble Don'ts",
    meaning: "Do not pluck raw fruits; do not blame your relatives; do not flee the battlefield; do not disobey your guru's command, O Sumati!",
    lines: [
      { tel: "ఏరకు మీ కసుగాయలు", en: "Eraku mee kasugaayalu" },
      { tel: "దూరకు మీ బంధుజనుల దోషము సుమ్మి", en: "Dooraku mee bandhujunala doshaumu summi" },
      { tel: "పారకు మీ రణమందున", en: "Paaraku mee ranamanduna" },
      { tel: "మీరకు మీ గురువులజ్ఞ మేదిని సుమతి", en: "Meeraku mee guruvulajnya medini sumati" },
    ]
  },
  {
    id: "p05", num: 5, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "medium",
    title: "కనకపు సింహాసనమున", titleEn: "Nature Cannot Be Changed",
    meaning: "Even if a dog is seated on a golden throne at an auspicious moment with all ceremony, will it ever abandon its old nature? Listen, O Sumati!",
    lines: [
      { tel: "కనకపు సింహాసనమున", en: "Kanakapu simhaasanamuna" },
      { tel: "శునకము కూర్చుండబెట్టి శుభలగ్నమునందు", en: "Shunakamu koorchundabetti subhalagnamuanda" },
      { tel: "వనరగ పట్టము గట్టిన", en: "Vanaaga pattamu gattina" },
      { tel: "వెనుకటి గుణమేలమాను వినురాసుమతి", en: "Venukati gunameelamaanu vinurasumati" },
    ]
  },
  {
    id: "p06", num: 6, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "medium",
    title: "కూరిమి గల దినములలో", titleEn: "Love Blinds, Hatred Magnifies",
    meaning: "In days of love, no faults are ever seen; but once that love turns to dislike, faults alone appear everywhere — this is the truth, O Sumati!",
    lines: [
      { tel: "కూరిమి గల దినములలో", en: "Koorimi gala dinamulalo" },
      { tel: "నేరములెన్నడును గలుగనేరవు", en: "Neramulennadeunu galuganerravu" },
      { tel: "మరియా కూరిమి విరసంబైనను", en: "Mariyaa koorimi virasambainanu" },
      { tel: "నేరములే తోచుచు చుండు నిక్కము సుమతి", en: "Neramule tochuchu chundu nikkamu sumati" },
    ]
  },
  {
    id: "p07", num: 7, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "medium",
    title: "తలనుండు విషము పనికిని", titleEn: "The Wicked are Poison Throughout",
    meaning: "The poison of a snake is in its head; the poison of a scorpion is in its tail — but a wicked person has poison throughout their entire body, O Sumati!",
    lines: [
      { tel: "తలనుండు విషము పనికిని వెలయంగా తోకనుండు", en: "Talanundu vishamu panikini velayangaa toknanundu" },
      { tel: "వృశ్చికమునకున్", en: "Vrushchikamunakun" },
      { tel: "తలతోకయనక యుండును", en: "Talatookayanka yundunu" },
      { tel: "కలునకు నిలువెల్ల విషము గదరా సుమతి", en: "Kalunaku niluvella vishamu gadaraa sumati" },
    ]
  },
  {
    id: "p08", num: 8, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "medium",
    title: "ఎప్పటికెయ్యది ప్రస్తుతమప్పటికా", titleEn: "Speak What is Appropriate",
    meaning: "One who always speaks what is appropriate to the moment, does not hurt others, does not get hurt himself, and avoids trouble — is truly blessed, O Sumati!",
    lines: [
      { tel: "ఎప్పటికెయ్యది ప్రస్తుతమప్పటికా", en: "Eppatikeyyadi prastatuamappatikaaa" },
      { tel: "కామాటలాడి అన్యుల మనముల్ నొప్పింపక", en: "Kaamaataladi anyula manamul noppimpaka" },
      { tel: "తానొవ్వక తప్పించుక తిరుగువాడు", en: "Taaanovvaka tappinchuka tiruguvadu" },
      { tel: "ధన్యుడు సుమతి", en: "Dhanyudu sumati" },
    ]
  },
  {
    id: "p09", num: 9, src: "సుమతీ శతకము", srcEn: "Sumati Satakam", difficulty: "medium",
    title: "కొరగాని కొడుకు పుట్టిన", titleEn: "A Worthless Son Harms More",
    meaning: "Having a worthless son is not just useless — he even destroys the father's reputation. Just as a bad shoot at the top of sugarcane destroys its entire sweetness, O Sumati!",
    lines: [
      { tel: "కొరగాని కొడుకు పుట్టిన కొరగామియే", en: "Koragaani koduku puttina koragaamiye" },
      { tel: "కాదు తండ్రి గుణముల చెరచున్", en: "Kaadu tandri gunamula cherachun" },
      { tel: "చెరకుతుద వెన్ను పుట్టిన", en: "Cherakutuda vennu puttina" },
      { tel: "చెరకున తీపెల్ల చెర రచు సిద్ధము సుమతి", en: "Cherakuna teepella chera rachu siddhamu sumati" },
    ]
  },
  {
    id: "p10", num: 10, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "beginner",
    title: "అనగ అనగ రాగమతిశయిల్లుచునుండు", titleEn: "Practice Makes Perfect",
    meaning: "The more you practice music the more beautiful it becomes; the more you eat neem the sweeter it becomes; with practice all works are accomplished — O Vema!",
    lines: [
      { tel: "అనగ అనగ రాగమతిశయిల్లుచునుండు", en: "Anaga anaga raagamathishayiluchunundu" },
      { tel: "తినగ తినగ వేముతీయనుండు", en: "Tinaga tinaga veemutheeyanundu" },
      { tel: "సాధనమున పనులు సమకూరు ధరలోన", en: "Saadanamuna panulu samakuuru dharalona" },
      { tel: "విశ్వదాభిరామ వినురవేమ", en: "Visvadaabhiraama vinuravema" },
    ]
  },
  {
    id: "p11", num: 11, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "beginner",
    title: "గంగి గోవు పాలు గరిటెడైనను", titleEn: "Quality Over Quantity",
    meaning: "A little milk from a gentle cow is enough — what use is a bucketful from a rough one? A little food eaten with devotion is enough — O Vema!",
    lines: [
      { tel: "గంగి గోవు పాలు గరిటెడైనను చాలు", en: "Gangi govu paalu garitedainanu chaalu" },
      { tel: "కడివడైననేమి కరము పాలు", en: "Kadivadainaneemi karamu paalu" },
      { tel: "భక్తి కలుగుకూడు పట్టెడైనను చాలు", en: "Bhakti kalugukuudu pattedainanu chaalu" },
      { tel: "విశ్వదాభిరామ వినురవేమ", en: "Visvadaabhiraama vinuravema" },
    ]
  },
  {
    id: "p12", num: 12, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "medium",
    title: "అల్పుడెప్పుడు పల్కునాడంబరముగాను", titleEn: "The Fool Boasts, the Wise Speaks Softly",
    meaning: "A base person always speaks with great pomp; a noble person speaks softly. Bronze rings loud, gold rings softly — O Vema!",
    lines: [
      { tel: "అల్పుడెప్పుడు పల్కునాడంబరముగాను", en: "Alpudeeppudu palkanaadambaramugaanu" },
      { tel: "సజ్జనుండు పల్కు చల్లగాను", en: "Sajjanundu palku challagaanu" },
      { tel: "కంచు మ్రోగునట్లు కనకంబు మ్రోగున", en: "Kanchu mroguna tlu kanakambu mroguna" },
      { tel: "విశ్వదాభిరామ వినురవేమా", en: "Visvadaabhiraama vinuravemaa" },
    ]
  },
  {
    id: "p13", num: 13, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "medium",
    title: "అనువు గాని చోట అధికులమనరాదు", titleEn: "Humility is Not Weakness",
    meaning: "Do not claim greatness where it is not appropriate; being small is not a deficiency. Does not a mountain appear small in a mirror? — O Vema!",
    lines: [
      { tel: "అనువు గాని చోట అధికులమనరాదు", en: "Anuvu gaani chota adhikulamanaaraadu" },
      { tel: "కొంచెముండుటెల్ల కొదువ కాదు", en: "Konchemumdutella kodava kaadu" },
      { tel: "కొండ అద్దమందు కొంచమై యుండదా", en: "Konda addamandu konchamei yundadaa" },
      { tel: "విశ్వదాభిరామ వినురవేమ", en: "Visvadaabhiraama vinuravema" },
    ]
  },
  {
    id: "p14", num: 14, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "medium",
    title: "వేరు పురుగు చేరి వృక్షంబు చెరచును", titleEn: "Bad Company Destroys Goodness",
    meaning: "A root insect destroys a tree; a blight insect destroys a plant; a wicked person destroys even a virtuous person — O Vema!",
    lines: [
      { tel: "వేరు పురుగు చేరి వృక్షంబు చెరచును", en: "Veeru purugu cheeri vrukshambu cherachunu" },
      { tel: "చీడ పురుగు చేరి చెట్టు చెరచు", en: "Cheeda purugu cheeri chettu cherachu" },
      { tel: "కుత్సితుండు చేరి గుణవంతు చెరచురా", en: "Kutsitundu cheeri gunavamtu cherachuraa" },
      { tel: "విశ్వదాభిరామ వినురవేమా", en: "Visvadaabhiraama vinuravemaa" },
    ]
  },
  {
    id: "p15", num: 15, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "beginner",
    title: "చెప్పులోని రాయి చెవిలోని జోరీగా", titleEn: "Small Things Cause Big Trouble",
    meaning: "A stone in the shoe, a fly in the ear, a speck in the eye, a thorn in the foot, quarrel at home — small things cause immeasurable suffering — O Vema!",
    lines: [
      { tel: "చెప్పులోని రాయి చెవిలోని జోరీగా", en: "Cheppuloni raayee cheviloni joreegaa" },
      { tel: "కంటిలోని నలుసు కాలి ముల్లు", en: "Kantiloni nalusu kaali mullu" },
      { tel: "ఇంటిలోని పోరు ఇంతింతగాదయ", en: "Intiloni poru inthintaga daaya" },
      { tel: "విశ్వదాభిరామ వినురవేమ", en: "Visvadaabhiraama vinuravema" },
    ]
  },
  {
    id: "p16", num: 16, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "beginner",
    title: "అన్ని దానములను అన్నదానమే గొప్ప", titleEn: "Food Donation is Greatest",
    meaning: "Among all charities, feeding the hungry is the greatest; there is nothing greater than a mother; there is no superior equal to one's own — O Vema!",
    lines: [
      { tel: "అన్ని దానములను అన్నదానమే గొప్ప", en: "Anni daanamulanuu annadaaname goppa" },
      { tel: "కన్న తల్లి కంటే ఘనము లేదు", en: "Kanna talli kaante ghanamu ledu" },
      { tel: "ఎన్నగురిని కన్న న్నెక్కుడు లేదయ్యా", en: "Ennagurini kanna nnekudu ledayyaa" },
      { tel: "విశ్వదాభిరామ వినురవేమా", en: "Visvadaabhiraama vinuravemaa" },
    ]
  },
  {
    id: "p17", num: 17, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "medium",
    title: "తప్పులెన్నువారు తండోపతండంబులు", titleEn: "Fault-Finders Miss Their Own Faults",
    meaning: "Those who count faults exist in countless numbers among all people. But those who count others' faults never know their own — O Vema!",
    lines: [
      { tel: "తప్పులెన్నువారు తండోపతండంబులు", en: "Tappulennuvaaru tandopatandambuluv" },
      { tel: "ఉర్విజనులకెల్లనుండు తప్పు", en: "Urvijanulakellanuandu tappu" },
      { tel: "తప్పులెన్నువారు తమ తప్పులెరుగరు", en: "Tappulennuvaaru tama tappulerugaru" },
      { tel: "విశ్వదాభిరామ వినురవేమ", en: "Visvadaabhiraama vinuravema" },
    ]
  },
  {
    id: "p18", num: 18, src: "వేమన శతకము", srcEn: "Vemana Satakam", difficulty: "medium",
    title: "ఉప్పు కప్పురంబు నొక్క పోలిక నుండు", titleEn: "Appearances Can Deceive",
    meaning: "Salt and camphor look alike; but their tastes are entirely different. Similarly, among all men, virtuous men are truly different — O Vema!",
    lines: [
      { tel: "ఉప్పు కప్పురంబు నొక్క పోలిక నుండు", en: "Uppu kapparambu nokka polika nundu" },
      { tel: "చూడ చూడ రుచుల జాడవేరు", en: "Chooda chooda ruchula jaadaveru" },
      { tel: "పురుషులందు పుణ్య పురుషులు వేరయ్యా", en: "Purushulandau punya purushuluveraayyaa" },
      { tel: "విశ్వదాభిరామ వినురవేమా", en: "Visvadaabhiraama vinuravemaa" },
    ]
  },
];

#!/usr/bin/env node
/**
 * One-off topic tagger for the shipped question data.
 *
 * Prints a per-topic distribution and lists every question that fell back to
 * "general" so the tags can be reviewed. Existing question content is never
 * changed: only a `"topic"` line is inserted after each `"id"` line.
 *
 * Usage: npx tsx scripts/tag-topics.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../src/lib/topics';
import type { Subject } from '../src/lib/types';

interface RawQuestion {
  id: string;
  question: string;
  options: string[];
  explanation: string;
}

interface Rule {
  topic: string;
  patterns: RegExp[];
  /** Matches these make a question definitely belong to the topic. */
  strong?: RegExp[];
}

const RULES: Partial<Record<Subject, Rule[]>> = {
  history: [
    {
      topic: 'civics',
      patterns: [
        /\b(judge|court|parliament|rajya sabha|lok sabha|president|governor|cabinet|minister|ordinance|constitution|fundamental rights?|election|citizen|prime minister|attorney|advocate general|speaker|municipal|panchayat|emergency|impeachment|writ|bill|legislature|executive|judiciary|union|state government|federal|central and the state|administrative powers|motion which)\b/i
      ],
      strong: [/\b(supreme court|high court|rajya sabha|lok sabha|fundamental right|ordinance|federal)\b/i]
    },
    {
      topic: 'nationalism',
      patterns: [
        /\b(congress|nationalists?|nationalism|partition of bengal|swadeshi|boycott|moderates?|extremists?|tilak|gokhale|naoroji|bipin|lala lajpat|simon commission|round table|communal award|poona pact|revolutionar)/i
      ],
      strong: [/\b(early nationalists?|swadeshi|partition of bengal)\b/i]
    },
    {
      topic: 'freedom',
      patterns: [
        /\b(gandhi|non-cooperation|civil disobedience|quit india|salt march|dandi|subhas|bose|\bina\b|jinnah|muslim league|mountbatten|independence act|partition|cripps|wavell|cabinet mission|1942|1947|khilafat)/i
      ]
    },
    {
      topic: 'british-rule',
      patterns: [
        /\b(east india company|subsidiary alliance|doctrine of lapse|revolt of 1857|sepoy|viceroy|governor general|sati|widow remarriage|slavery|education act|regulating act|pitt|charter act|dalhousie|wellesley|clive|warren hastings|cornwallis|bentinck|ryotwari|permanent settlement|zamindar|british rule|bengal|morley|minto)/i
      ]
    },
    {
      topic: 'world',
      patterns: [
        /\b(world war|first world|second world|hitler|mussolini|nazi|fascis|league of nations|united nations|general assembly|cold war|atom bomb|hiroshima|nagasaki|berlin|korea|vietnam|cuba|soviet|stalin|churchill|roosevelt|truman|lenin|treaty of versailles|disarmament|human rights|dictatorship|entente|triple alliance|un agency|courier)/i
      ],
      strong: [/\b(world war|cold war|united nations|league of nations|general assembly|triple entente)\b/i]
    },
    {
      topic: 'post-independence',
      patterns: [
        /\b(non-aligned|nehru|five year plan|green revolution|white revolution|states reorganisation|linguistic|shastri|indira|rajiv|gujral|look east|saarc|asean|nuclear|1975|emergency of 1975|planning commission)\b/i
      ]
    }
  ],
  economics: [
    {
      topic: 'demand-supply',
      patterns: [/\b(demand|suppl(y|ied|ies)|elasticity|utility|substitute|complement|equilibrium price|law of demand|quantity suppl)/i],
      strong: [/\b(demand|supply|elasticity)\b/i]
    },
    {
      topic: 'production',
      patterns: [/\b(land|labour|labor|capital|entrepreneur|factors? of production|division of labour|mobility|production|efficiency|organi[sz]ation)/i]
    },
    {
      topic: 'money-banking',
      patterns: [/\b(money|bank|credit|interest|deposit|loan|rbi|reserve bank|cheque|currency|inflation|deflation|atm|e-banking|barter|bis\b|bank for international settlements)/i],
      strong: [/\b(bank|rbi|reserve bank|money|credit|barter)\b/i]
    },
    {
      topic: 'public-finance',
      patterns: [/\b(government|tax(es|ation)?|budget|revenue|expenditure|fiscal|public debt|subsid|gst|direct tax|indirect tax|public finance|regressive)/i],
      strong: [/\b(tax|budget|fiscal|public expenditure|public revenue)\b/i]
    },
    {
      topic: 'market',
      patterns: [/\b(market|monopoly|oligopoly|perfect competition|monopolistic|seller|firm|price discrimination|cartel|duopoly)\b/i]
    },
    {
      topic: 'consumer',
      patterns: [/\b(consumer|exploitation|advertisement|adulteration|consumer right|awareness|copra|standardisation|isi|hallmark|food safety)\b/i],
      strong: [/\b(consumer)\b/i]
    },
    {
      topic: 'national-income',
      patterns: [/\b(national income|gdp|gnp|per capita|development|poverty|unemployment|population|census|planning|agriculture|industry|infrastructure|human capital)\b/i]
    }
  ],
  geography: [
    {
      topic: 'climate',
      patterns: [/\b(monsoon|rainfall|rain|climate|temperature|wind|cyclone|snowfall|humidity|pressure|western disturbance|el nino|season)\b/i],
      strong: [/\b(monsoon|rainfall|climate|cyclone)\b/i]
    },
    {
      topic: 'soil',
      patterns: [/\b(soil|erosion|conservation|alluvial|black soil|red soil|laterite|desert soil|humus|contour|terrace farming)\b/i],
      strong: [/\b(soil)\b/i]
    },
    {
      topic: 'agriculture',
      patterns: [/\b(agriculture|crop|farming|food grain|rice|wheat|tea|coffee|jute|sugarcane|irrigation|horticulture|livestock|fisher|plantation|staple)\b/i],
      strong: [/\b(crop|agriculture|farming)\b/i]
    },
    {
      topic: 'industry',
      patterns: [/\b(industry|industrial|mineral|iron ore|coal|copper|bauxite|manganese|steel|cement|textile|alloy|zinc|aluminium|power plant|basic industry|key industry)\b/i],
      strong: [/\b(industry|mineral|iron ore|bauxite|alloy)\b/i]
    },
    {
      topic: 'water',
      patterns: [/\b(water|river|dam|ground water|lake|canal|well|tank|hydro|rainwater|watershed|irrigation)\b/i],
      strong: [/\b(dam|river|ground water|water source)\b/i]
    },
    {
      topic: 'forests',
      patterns: [/\b(forest|vegetation|wildlife|biodiversity|national park|sanctuary|mangrove|timber|deforestation|afforestation|tiger)\b/i],
      strong: [/\b(forest|wildlife|vegetation)\b/i]
    },
    {
      topic: 'waste',
      patterns: [/\b(waste|pollution|disposal|recycl|environment|garbage|sewage|compost|incinerat|landfill|discarded|useful products)\b/i],
      strong: [/\b(waste|pollution|disposal|discarded)\b/i]
    },
    {
      topic: 'transport',
      patterns: [/\b(transport|roadways?|railways?|airways?|waterways?|communication|mode of transport|bridge|floods?)\b/i],
      strong: [/\b(transport|railway|airway|waterway)\b/i]
    }
  ],
  maths: [
    {
      topic: 'algebra',
      patterns: [/\b(quadratic|equation|matrix|matrices|factor|polynomial|arithmetic progression|geometric progression|a\.p\.|g\.p\.|inequation|simultaneous|remainder theorem|root|value of [a-z]|solve|divisible|solution set|term of)\b/i],
      strong: [/\b(quadratic|matrix|matrices|progression|inequation|divisible)\b/i, /(a\.p\.|g\.p\.)/i]
    },
    {
      topic: 'geometry',
      patterns: [/\b(triangle|circle|angle|similar|tangent|chord|parallelogram|polygon|bisector|perpendicular|symmetry|construction|theorem|circum\w*|incircle|quadrilateral|rhombus|trapezium)\b/i],
      strong: [/\b(similar triangles?|circum\w*|tangent|chord|parallelogram|incircle)\b/i]
    },
    {
      topic: 'trigonometry',
      patterns: [/\b(sin|cos|tan|cot|sec|cosec|trigonometr|identity|angle of elevation|angle of depression)\b/i],
      strong: [/\b(sin|cos|tan|trigonometr)\b/i]
    },
    {
      topic: 'mensuration',
      patterns: [/\b(area|volume|surface|cylinder|cone|sphere|hemisphere|cuboid|cube|perimeter|radius|height|capacity|prism|pyramid)\b/i],
      strong: [/\b(volume|surface area|cylinder|cone|sphere|hemisphere)\b/i]
    },
    {
      topic: 'statistics',
      patterns: [/\b(mean|median|mode|frequency|histogram|ogive|quartile|class mark|distribution|range|data)\b/i],
      strong: [/\b(median|mode|frequency|ogive|quartile)\b/i]
    },
    {
      topic: 'probability',
      patterns: [/\b(probability|random|dice|coin|card|drawn|chosen at random)\b/i],
      strong: [/\b(probability)\b/i]
    },
    {
      topic: 'commercial',
      patterns: [/\b(gst|tax|bank|recurring deposit|interest|shares?|dividend|profit|loss|discount|marked price|commission|insurance|maturity|investment)\b/i],
      strong: [/\b(gst|recurring deposit|shares?|dividend|marked price)\b/i]
    },
    {
      topic: 'coordinate',
      patterns: [/\b(coordinate|centroid|slope|x-axis|y-axis|ordinates?|abscissa|midpoint|line passing|equation of (a|the) line|y-intercept|x-intercept|parallel to)\b/i],
      strong: [/\b(coordinate|centroid|slope|x-axis|y-axis|line passing|y-intercept)\b/i]
    }
  ],
  'english-lit': [
    {
      topic: 'julius-caesar',
      patterns: [/\b(caesar|brutus|antony|cassius|octavius|calpurnia|portia|soothsayer|senate|rome|roman|triumvir|ides of march|forum|conspirators?)\b/i],
      strong: [/\b(caesar|brutus|antony|cassius)\b/i]
    },
    {
      topic: 'poetry',
      patterns: [/\b(poem|poet|speaker|stanza|figure of speech|metaphor|simile|personification|rhyme|haunted houses|glove and the lions|considerable speck|nine gold medals|the veteran|small pain|abou ben adhem|after blenheim|daffodils|solitary reaper|stopping by woods)\b/i],
      strong: [/\b(poem|poet|stanza|figure of speech)\b/i]
    },
    {
      topic: 'prose',
      patterns: [/\b(short story|prose|narrator|photographer|author|passage|character|story|essay|pedestrian|last lesson|hamel|adjoa|nana|elevator|mead|martin)/i],
      strong: [/\b(short story|narrator|photographer|pedestrian|last lesson|hamel|mead)\b/i]
    }
  ],
  physics: [
    {
      topic: 'force-motion',
      patterns: [/\b(force|motion|velocity|acceleration|momentum|newton|friction|gravity|inertia|mass|weight|displacement|speed|projectile|circular|centripetal|impulse|equilibrium|physical balance|principle of working)\b/i],
      strong: [/\b(force|momentum|acceleration|newton|friction)\b/i]
    },
    {
      topic: 'work-energy',
      patterns: [/\b(work|energy|power|joule|watt|kinetic|potential|conservation of energy|efficiency)\b/i],
      strong: [/\b(kinetic energy|potential energy|work done)\b/i]
    },
    {
      topic: 'machines',
      patterns: [/\b(machine|pulley|lever|inclined plane|wedge|screw|wheel and axle|mechanical advantage|velocity ratio)\b/i],
      strong: [/\b(pulley|lever|mechanical advantage|inclined plane)\b/i]
    },
    {
      topic: 'light',
      patterns: [/\b(light|lens|mirror|refracti(on|ve)|reflection|focal|image|prism|dispersion|spectrum|magnification|optic|eye|critical angle|total internal|myopia|hypermetropia)\b/i],
      strong: [/\b(lens|mirror|refraction|reflection|focal|prism)\b/i]
    },
    {
      topic: 'sound',
      patterns: [/\b(sound|frequency|amplitude|echo|resonance|decibel|pitch|sonar|ultrasonic|infrasonic|organ pipe|vibration|wave)\b/i],
      strong: [/\b(sound|echo|resonance|ultrasonic|organ pipe)\b/i]
    },
    {
      topic: 'electricity',
      patterns: [/\b(current|voltage|resistance|ohm|circuit|battery|magnet|electromagnet|generator|motor|fuse|transformer|induction|lenz|electric|charge|coulomb|ammeter|voltmeter|power rating|heating effect|electroplat|live wire|neutral|earthing)\b/i],
      strong: [/\b(current|resistance|magnet|circuit|voltage|generator|motor|fuse|transformer)\b/i]
    },
    {
      topic: 'heat',
      patterns: [/\b(heat|temperature|specific heat|latent|calorimetry|thermometer|conduction|convection|radiation|thermal|boiling|melting|expansion)\b/i],
      strong: [/\b(specific heat|latent heat|thermometer|calorimetry)\b/i]
    },
    {
      topic: 'modern',
      patterns: [/\b(radioactiv|nuclear|atom|electron|proton|neutron|isotope|half-life|fission|fusion|photoelectric|x-ray|semiconductor|diode|alpha|beta|gamma|ev\b|electron volt)\b/i],
      strong: [/\b(radioactiv|nuclear|isotope|fission|fusion|photoelectric|semiconductor|ev\b)\b/i]
    }
  ],
  chemistry: [
    {
      topic: 'periodic',
      patterns: [/\b(periodic|ionization|electron affinity|atomic radius|valency|electronegativity|mendeleev|metallic character|period 3|group \d|electronic configuration|outermost shell|same group|across a period|valence shell|noble gas|non-metals?)\b/i],
      strong: [/\b(ionization|electron affinity|atomic radius|periodic table|electronegativity|electronic configuration|noble gas)\b/i]
    },
    {
      topic: 'bonding',
      patterns: [/\b(bond|ionic|covalent|electrovalent|molecule|compound|dative|hydrogen bond|intermolecular|structure|electron pair)\b/i],
      strong: [/\b(covalent|ionic|electrovalent|hydrogen bond)\b/i]
    },
    {
      topic: 'acids-bases',
      patterns: [/\b(acid|base|salt|ph\b|hydroxide|oxide|neutralis|indicator|litmus|alkali|sulphuric|nitric|hydrochloric|carbonate|bicarbonate|ammonium|rotten egg|hydrogen sulphide|h2s)\b/i],
      strong: [/\b(acid|base|salt|ph\b|hydroxide|litmus|hydrogen sulphide)\b/i]
    },
    {
      topic: 'electrochemistry',
      patterns: [/\b(electrolys|electrode|anode|cathode|electroplat|electrorefin|conduct|electrolyte|galvan|voltaic|cell)\b/i],
      strong: [/\b(electrolys|anode|cathode|electroplat|electrode)\b/i]
    },
    {
      topic: 'metals',
      patterns: [/\b(metal|ore|metallurg|alloy|extraction|roasting|calcination|smelting|aluminium|zinc|copper|iron|sodium|calcium|non-metal|gangue|flux|slag|mineral)\b/i],
      strong: [/\b(ore|metallurg|alloy|roasting|calcination|smelting|gangue|slag)\b/i]
    },
    {
      topic: 'organic',
      patterns: [/\b(organic|hydrocarbons?|alkanes?|alkenes?|alkynes?|alcohol|ester|benzene|ethanol|methane|ethane|propane|ethene|ethyne|isomer|catenation|functional group|carbohydrate|protein|fat|polymer|cyclic|homologous series)\b/i],
      strong: [/\b(organic|alkane|alkene|alkyne|alcohol|benzene|isomer|catenation|hydrocarbon|homologous)\b/i]
    },
    {
      topic: 'stoichiometry',
      patterns: [/\b(mole|vapour density|molar|stoichiometr|avogadro|percentage|empirical|molecular formula|equivalent|relative molecular|concentration|solution|normality|molarity|mass|stp)\b/i],
      strong: [/\b(mole|vapour density|molarity|stoichiometr|avogadro|empirical)\b/i]
    }
  ],
  'physical-education': [
    {
      topic: 'growth',
      patterns: [/\b(growth|development|adulthood|adolescen|childhood|infancy|puberty|maturation|body type|somatotype|ectomorph|endomorph|mesomorph|genetic|heredity|disorder)\b/i],
      strong: [/\b(adulthood|adolescen|puberty|growth|development|ectomorph|genetic)\b/i]
    },
    {
      topic: 'fitness',
      patterns: [/\b(fitness|training|endurance|strength|flexibility|speed|coordination|agility|exercise|warm|circuit|interval|weight training|aerobic|anaerobic|progression|overload|health education|principle of)\b/i],
      strong: [/\b(endurance|flexibility|agility|warm|circuit training|aerobic|anaerobic|progression|overload)\b/i]
    },
    {
      topic: 'injuries',
      patterns: [/\b(injur\w*|first aid|fracture|sprain|strain|dislocation|cramp|acl|rice|bandage|rehabilitation|prevention|tendonitis)\b/i],
      strong: [/\b(injur\w*|fracture|sprain|dislocation|first aid|acl|tendonitis)\b/i]
    },
    {
      topic: 'nutrition',
      patterns: [/\b(diet|nutrition|nutrient|vitamin|mineral|protein|carbohydrate|fat|balanced diet|calorie|malnutrition|obesity|water)\b/i],
      strong: [/\b(diet|nutrition|vitamin|protein|carbohydrate|malnutrition)\b/i]
    },
    {
      topic: 'biomechanics',
      patterns: [/\b(biomechanic|motor|skill|movement|body|muscle|joint|bone|posture|lever|axis|plane|balance|kinesthetic)\b/i],
      strong: [/\b(biomechanic|motor skill|posture|lever|joint|muscle)\b/i]
    },
    {
      topic: 'psychology',
      patterns: [/\b(psycholog|motivation|personality|anxiety|stress|emotion|attitude|team|leadership|concentration|confidence|aggression|goal setting)\b/i],
      strong: [/\b(motivation|personality|anxiety|leadership|aggression|confidence)\b/i]
    },
    {
      topic: 'games',
      patterns: [/\b(game|match|rule|player|team|cricket|football|hockey|basketball|volleyball|badminton|tennis|athletics|olympic|tournament|referee|field|sport|physical education teacher)\b/i]
    }
  ]
};

function classify(subject: Subject, question: RawQuestion): string {
  const rules = RULES[subject] ?? [];
  const haystack = `${question.question} ${question.options.join(' ')} ${question.explanation}`;
  let best: { topic: string; score: number } = { topic: 'general', score: 0 };

  for (const rule of rules) {
    let score = 0;
    for (const pattern of rule.strong ?? []) {
      if (pattern.test(haystack)) score += 4;
    }
    for (const pattern of rule.patterns) {
      const matches = haystack.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
      if (matches) score += matches.length;
    }
    if (score > best.score) best = { topic: rule.topic, score };
  }

  return best.topic;
}

function main(): void {
  const dataDir = fileURLToPath(new URL('../src/data/', import.meta.url));
  let total = 0;
  let untagged = 0;

  for (const [subject, topics] of Object.entries(TOPICS) as [Subject, { slug: string }[]][]) {
    const file = join(dataDir, `${subject}.json`);
    const raw = readFileSync(file, 'utf8');
    const questions = JSON.parse(raw) as RawQuestion[];
    if (questions.length === 0) continue;

    // Re-runs should replace tags, not duplicate keys.
    const withoutTopics = raw.replace(/^[ \t]*"topic": "[^"]+",\n/gm, '');

    const topicsBySlug = new Map(topics.map((topic) => [topic.slug, topic.slug]));
    const assigned = new Map<string, string>();
    const distribution = new Map<string, number>();
    const general: RawQuestion[] = [];

    for (const question of questions) {
      const topic = classify(subject, question);
      const safe = topicsBySlug.has(topic) ? topic : 'general';
      assigned.set(question.id, safe);
      distribution.set(safe, (distribution.get(safe) ?? 0) + 1);
      if (safe === 'general') general.push(question);
      total += 1;
    }

    // Insert the topic after each id line so the rest of the file is untouched.
    let next = withoutTopics.replace(
      /^(?<indent>[ \t]*)"id": "(?<id>[^"]+)",$/gm,
      (line: string, indent: string, id: string) => {
        const topic = assigned.get(id);
        if (!topic) return line;
        return `${indent}"id": "${id}",\n${indent}"topic": "${topic}",`;
      },
    );

    // Ensure every question got a topic; abort rather than write partial data.
    const missing = questions.filter((question) => !next.includes(`"id": "${question.id}",\n    "topic"`));
    if (missing.length > 0) {
      console.error(`${subject}: could not tag ${missing.length} question(s); file not written.`);
      process.exitCode = 1;
      continue;
    }

    if (!next.endsWith('\n')) next += '\n';
    writeFileSync(file, next);

    console.log(`\n${subject} (${questions.length})`);
    for (const [topic, count] of [...distribution.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${topic.padEnd(18)} ${count}`);
    }
    if (general.length > 0) {
      untagged += general.length;
      console.log('  general fallbacks:');
      for (const question of general.slice(0, 8)) {
        console.log(`    ${question.id}: ${question.question.slice(0, 80)}`);
      }
      if (general.length > 8) console.log(`    ...and ${general.length - 8} more`);
    }
  }

  console.log(`\nTagged ${total} questions; ${untagged} kept the "general" topic.`);
}

main();

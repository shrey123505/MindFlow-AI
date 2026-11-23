import type { LanguageCode, VisualGuideData } from '../types/mindflow';
import { buildProxyImageUrl, buildYouTubeFrameUrl } from '../utils/visualGuide';

const SAMPLE_VIDEO_ID = '8hly31xKli0';

const SVG_BIG_O = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="100%">
  <rect width="600" height="220" rx="16" fill="#0b1120"/>
  <rect x="14" y="14" width="572" height="192" rx="12" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <text x="36" y="42" fill="#e2e8f0" font-size="13.5" font-weight="700" font-family="Inter, sans-serif">Big-O Growth Curve Comparison</text>
  <text x="36" y="59" fill="#94a3b8" font-size="10.5" font-family="Inter, sans-serif">Operations (Y) vs. Input Size n (X)</text>
  <line x1="62" y1="180" x2="504" y2="180" stroke="#475569" stroke-width="1.6"/>
  <line x1="62" y1="74" x2="62" y2="180" stroke="#475569" stroke-width="1.6"/>
  <path d="M 62 172 L 496 172" fill="none" stroke="#10b981" stroke-width="2.6"/>
  <text x="506" y="175" fill="#34d399" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">O(1)</text>
  <path d="M 62 172 Q 160 144, 496 140" fill="none" stroke="#22d3ee" stroke-width="2.6"/>
  <text x="506" y="143" fill="#22d3ee" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">O(log n)</text>
  <path d="M 62 174 L 456 96" fill="none" stroke="#818cf8" stroke-width="2.6"/>
  <text x="466" y="99" fill="#a5b4fc" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">O(n)</text>
  <path d="M 62 176 Q 210 162, 340 76" fill="none" stroke="#c084fc" stroke-width="2.6"/>
  <text x="348" y="82" fill="#d8b4fe" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">O(n log n)</text>
  <path d="M 62 177 Q 150 166, 210 76" fill="none" stroke="#fb7185" stroke-width="2.6"/>
  <text x="218" y="82" fill="#fda4af" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">O(n²)</text>
</svg>`;

const SVG_DATA_STRUCTURES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="100%">
  <rect width="600" height="220" rx="16" fill="#0b1120"/>
  <rect x="14" y="14" width="572" height="192" rx="12" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <rect x="212" y="28" width="176" height="36" rx="10" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/>
  <text x="300" y="51" text-anchor="middle" fill="#f8fafc" font-size="12.5" font-weight="700" font-family="Inter, sans-serif">Data Structures</text>
  <path d="M 260 64 C 260 88, 154 78, 154 100" fill="none" stroke="#22d3ee" stroke-width="2"/>
  <path d="M 340 64 C 340 88, 446 78, 446 100" fill="none" stroke="#34d399" stroke-width="2"/>
  <rect x="44" y="100" width="220" height="86" rx="12" fill="#0f172a" stroke="#22d3ee" stroke-width="1.8"/>
  <text x="154" y="123" text-anchor="middle" fill="#67e8f9" font-size="12" font-weight="700" font-family="Inter, sans-serif">Linear (Sequential)</text>
  <rect x="60" y="136" width="56" height="34" rx="7" fill="#164e63"/>
  <text x="88" y="157" text-anchor="middle" fill="#e0f2fe" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Array</text>
  <rect x="126" y="136" width="56" height="34" rx="7" fill="#164e63"/>
  <text x="154" y="157" text-anchor="middle" fill="#e0f2fe" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Stack</text>
  <rect x="192" y="136" width="56" height="34" rx="7" fill="#164e63"/>
  <text x="220" y="157" text-anchor="middle" fill="#e0f2fe" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Queue</text>
  <rect x="336" y="100" width="220" height="86" rx="12" fill="#0f172a" stroke="#34d399" stroke-width="1.8"/>
  <text x="446" y="123" text-anchor="middle" fill="#6ee7b7" font-size="12" font-weight="700" font-family="Inter, sans-serif">Non-Linear (Hierarchical)</text>
  <rect x="352" y="136" width="56" height="34" rx="7" fill="#064e3b"/>
  <text x="380" y="157" text-anchor="middle" fill="#d1fae5" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Tree</text>
  <rect x="418" y="136" width="56" height="34" rx="7" fill="#064e3b"/>
  <text x="446" y="157" text-anchor="middle" fill="#d1fae5" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Heap</text>
  <rect x="484" y="136" width="56" height="34" rx="7" fill="#064e3b"/>
  <text x="512" y="157" text-anchor="middle" fill="#d1fae5" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Graph</text>
</svg>`;

const SVG_BINARY_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="100%">
  <rect width="600" height="220" rx="16" fill="#0b1120"/>
  <rect x="14" y="14" width="572" height="192" rx="12" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <text x="300" y="42" text-anchor="middle" fill="#e2e8f0" font-size="13.5" font-weight="700" font-family="Inter, sans-serif">Binary Search — Halving Search Space in O(log n)</text>
  <rect x="50" y="64" width="500" height="34" rx="8" fill="#1e293b" stroke="#475569"/>
  <rect x="278" y="64" width="44" height="34" rx="6" fill="#7c3aed"/>
  <text x="300" y="85" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700" font-family="JetBrains Mono, monospace">MID</text>
  <text x="155" y="85" text-anchor="middle" fill="#94a3b8" font-size="10.5" font-family="Inter, sans-serif">Discarded Left Half</text>
  <text x="440" y="85" text-anchor="middle" fill="#67e8f9" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">Active Right Half →</text>
  <path d="M 436 98 L 436 122" stroke="#22d3ee" stroke-width="2"/>
  <rect x="316" y="122" width="234" height="32" rx="8" fill="#0f172a" stroke="#22d3ee" stroke-width="1.8"/>
  <rect x="411" y="122" width="44" height="32" rx="6" fill="#0891b2"/>
  <text x="433" y="142" text-anchor="middle" fill="#ffffff" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">MID</text>
  <path d="M 433 154 L 433 172" stroke="#10b981" stroke-width="2"/>
  <rect x="358" y="172" width="150" height="24" rx="6" fill="#064e3b" stroke="#34d399" stroke-width="1.5"/>
  <text x="433" y="188" text-anchor="middle" fill="#a7f3d0" font-size="10.5" font-weight="700" font-family="Inter, sans-serif">Target Found in ≤ 20 hops!</text>
  <text x="158" y="156" text-anchor="middle" fill="#cbd5e1" font-size="11" font-family="Inter, sans-serif">1,000,000 items → max 20 checks</text>
</svg>`;

const SVG_REAL_WORLD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="100%">
  <rect width="600" height="220" rx="16" fill="#0b1120"/>
  <rect x="14" y="14" width="572" height="192" rx="12" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <text x="300" y="42" text-anchor="middle" fill="#e2e8f0" font-size="13.5" font-weight="700" font-family="Inter, sans-serif">Production Systems Powered by DSA</text>
  <rect x="36" y="68" width="164" height="114" rx="12" fill="#0f172a" stroke="#8b5cf6" stroke-width="1.8"/>
  <text x="118" y="96" text-anchor="middle" fill="#c4b5fd" font-size="12" font-weight="700" font-family="Inter, sans-serif">Maps &amp; GPS</text>
  <text x="118" y="122" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">Graphs + A*</text>
  <text x="118" y="148" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">Shortest live traffic</text>
  <text x="118" y="162" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">route recalculation</text>
  <rect x="218" y="68" width="164" height="114" rx="12" fill="#0f172a" stroke="#22d3ee" stroke-width="1.8"/>
  <text x="300" y="96" text-anchor="middle" fill="#67e8f9" font-size="12" font-weight="700" font-family="Inter, sans-serif">Databases</text>
  <text x="300" y="122" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">B+ Trees</text>
  <text x="300" y="148" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">Sub-millisecond index</text>
  <text x="300" y="162" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">range scans on disk</text>
  <rect x="400" y="68" width="164" height="114" rx="12" fill="#0f172a" stroke="#10b981" stroke-width="1.8"/>
  <text x="482" y="96" text-anchor="middle" fill="#6ee7b7" font-size="12" font-weight="700" font-family="Inter, sans-serif">Search &amp; Cache</text>
  <text x="482" y="122" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">Trie + LRU Map</text>
  <text x="482" y="148" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">Instant autocomplete</text>
  <text x="482" y="162" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">&amp; O(1) cache eviction</text>
</svg>`;

const SAMPLE_GUIDE_EN: VisualGuideData = {
  id: 'vguide-dsa-en',
  videoId: SAMPLE_VIDEO_ID,
  language: 'en',
  title: 'Data Structures & Algorithms — Visual Mastery Guide',
  subtitle: 'Skip the 5-hour lecture with magazine-grade blueprints, diagrams & interview shortcuts',
  channel: 'freeCodeCamp · Computer Science',
  category: 'Tutorial',
  estimatedReadTime: '4 min',
  coverFrameUrl: buildYouTubeFrameUrl(SAMPLE_VIDEO_ID, 'maxresdefault'),
  heroTakeaways: [
    'Data Structures organize bytes in RAM for fast reads/writes; Algorithms are step-by-step recipes operating on them.',
    'Always evaluate growth rate with Big-O: O(1) Hash Map & O(log n) Binary Search beat O(n²) loops by orders of magnitude at scale.',
    'Real production software pairs structures together—Maps use Graphs + Dijkstra/A*, Databases use B+ Trees, and Caches use Hash Map + Doubly Linked List.',
  ],
  chapters: [
    {
      id: 'vg-ch-1',
      timestamp: '08:45',
      timestampSeconds: 525,
      heading: 'What is DS & Algo? Foundations & Big-O',
      accent: 'violet',
      videoExplanation: [
        'A Data Structure defines the memory layout of your data—like arranging items sequentially in a shelf versus linking cards with pointers. An Algorithm is the exact sequence of steps used to transform, search, or sort that container.',
        'Rather than timing code in milliseconds (which depends on CPU speed), engineers measure Big-O Asymptotic Complexity: how fast runtime or RAM grows as input size n scales from 100 to 10 million.',
      ],
      keyTerms: ['Big-O Notation', 'Time vs. Space Trade-off', 'Worst-Case Scaling', 'Asymptotic Growth'],
      insightLabel: 'Memory Trick · The Phonebook Rule',
      extraAiInsight:
        'If doubling the input size adds only ONE extra step, you have O(log n). If doubling input doubles the work, you have O(n). If doubling input quadruples work, beware—you are in O(n²) territory!',
      webImageQuery: 'Time complexity',
      webImageUrl: buildProxyImageUrl(
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7e/Comparison_computational_complexity.svg/330px-Comparison_computational_complexity.svg.png'
      ),
      webImageCaption: 'Computational complexity growth reference (Wikimedia)',
      videoFrameUrl: buildYouTubeFrameUrl(SAMPLE_VIDEO_ID, '1'),
      svgDiagram: SVG_BIG_O,
    },
    {
      id: 'vg-ch-2',
      timestamp: '12:15',
      timestampSeconds: 735,
      heading: 'Types of Data Structures: Linear vs. Non-Linear',
      accent: 'cyan',
      videoExplanation: [
        'Linear structures store items sequentially: Arrays give instant O(1) indexed access via contiguous RAM, Linked Lists allow O(1) pointer splicing, Stacks enforce LIFO (Undo history), and Queues enforce FIFO (task buffers).',
        'Non-Linear structures model hierarchy and relationships: Hash Maps provide average O(1) key-value lookup, Trees organize sorted hierarchies in O(log n), and Graphs connect arbitrary entities with weighted edges.',
      ],
      keyTerms: ['Contiguous Arrays', 'LIFO Stack / FIFO Queue', 'Hash Map O(1)', 'Balanced Trees & Graphs'],
      insightLabel: 'Pro Engineering Shortcut',
      extraAiInsight:
        'In 80% of coding interviews, when a brute-force nested loop hits O(n²), reaching for a Hash Map trades O(n) extra memory to slash lookup time straight down to O(n) total!',
      webImageQuery: 'Binary search tree',
      webImageUrl: buildProxyImageUrl(
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/da/Binary_search_tree.svg/330px-Binary_search_tree.svg.png'
      ),
      webImageCaption: 'Binary Search Tree hierarchical layout (Wikimedia)',
      videoFrameUrl: buildYouTubeFrameUrl(SAMPLE_VIDEO_ID, '2'),
      svgDiagram: SVG_DATA_STRUCTURES,
    },
    {
      id: 'vg-ch-3',
      timestamp: '18:30',
      timestampSeconds: 1110,
      heading: 'Common Algorithms: Search, Sort & Dynamic Programming',
      accent: 'emerald',
      videoExplanation: [
        'Binary Search requires sorted data and halves the remaining search interval on every comparison—locating any item among 1,000,000 records in at most 20 checks instead of 1,000,000.',
        'Divide-and-Conquer sorting (Merge Sort, Quick Sort) breaks arrays into subproblems for O(n log n) speed, while Dynamic Programming caches overlapping subproblems to avoid exponential recomputation.',
      ],
      keyTerms: ['Binary Search O(log n)', 'Merge Sort O(n log n)', 'Recursion Stack', 'Memoization / DP'],
      insightLabel: 'Unforgettable Analogy',
      extraAiInsight:
        'Dynamic Programming is simply writing the answer to "1+1+1+1+1 = 5" on a sticky note so when someone adds "+1", you glance at the note and say "6" instantly instead of recounting from scratch.',
      webImageQuery: 'Merge sort',
      webImageUrl: buildProxyImageUrl(
        'https://upload.wikimedia.org/wikipedia/commons/c/cc/Merge-sort-example-300px.gif'
      ),
      webImageCaption: 'Merge Sort divide-and-conquer diagram (Wikimedia)',
      videoFrameUrl: buildYouTubeFrameUrl(SAMPLE_VIDEO_ID, '3'),
      svgDiagram: SVG_BINARY_SEARCH,
    },
    {
      id: 'vg-ch-4',
      timestamp: '24:50',
      timestampSeconds: 1490,
      heading: 'Real-World Systems Powered by DSA',
      accent: 'indigo',
      videoExplanation: [
        'Navigation apps model city roads as weighted Graphs and run Dijkstra or A* search to compute the fastest detour in milliseconds when live traffic spikes.',
        'PostgreSQL and MySQL rely on shallow B+ Trees to minimize slow disk reads, while Redis and browsers combine a Hash Map + Doubly Linked List to build O(1) LRU Caches.',
      ],
      keyTerms: ['Dijkstra & A* Routing', 'B+ Tree DB Indexing', 'Trie Autocomplete', 'LRU Cache Eviction'],
      insightLabel: 'System Design Bonus',
      extraAiInsight:
        'Whenever you hear "millions of records on disk", think B+ Tree. Whenever you hear "prefix autocomplete", think Trie. Whenever you hear "rate limiter or recent cache", think Hash Map + Doubly Linked List.',
      webImageQuery: "Dijkstra's algorithm",
      webImageUrl: buildProxyImageUrl(
        'https://upload.wikimedia.org/wikipedia/commons/5/57/Dijkstra_Animation.gif'
      ),
      webImageCaption: 'Shortest-path graph exploration (Wikimedia)',
      videoFrameUrl: buildYouTubeFrameUrl(SAMPLE_VIDEO_ID, 'maxresdefault'),
      svgDiagram: SVG_REAL_WORLD,
    },
  ],
  quickRecall: {
    terms: [
      { term: 'Array Access', definition: 'O(1) direct index jump', note: 'Slow middle insert O(n)' },
      { term: 'Hash Map', definition: 'O(1) average key lookup', note: 'O(n) extra RAM trade-off' },
      { term: 'Binary Search', definition: 'O(log n) sorted halving', note: 'Input MUST be sorted' },
      { term: 'Merge Sort', definition: 'O(n log n) guaranteed', note: 'Stable, uses O(n) space' },
      { term: 'B+ Tree', definition: 'O(log n) disk-friendly tree', note: 'Powers SQL database indexes' },
      { term: 'LRU Cache', definition: 'Hash Map + Doubly Linked List', note: 'O(1) get & O(1) eviction' },
    ],
    checklist: [
      'Can you explain the difference between O(log n), O(n), and O(n²) with one concrete example each?',
      'Do you know when to choose a Hash Map vs. a Balanced Binary Search Tree?',
      'Can you trace how Binary Search shrinks [low, high] bounds in 20 steps for 1M items?',
      'Can you identify overlapping subproblems that qualify for Dynamic Programming memoization?',
      'Can you name the core data structure behind GPS routing, SQL indexing, and LRU caches?',
    ],
  },
  generatedAt: '2026-11-23T00:00:00.000Z',
};

const SAMPLE_GUIDE_HI: VisualGuideData = {
  ...SAMPLE_GUIDE_EN,
  id: 'vguide-dsa-hi',
  language: 'hi',
  title: 'डेटा स्ट्रक्चर्स और एल्गोरिदम — विज़ुअल मास्टरी गाइड',
  subtitle: 'पूरा वीडियो देखे बिना डायग्राम, माइक्रो-नोट्स और मेमोरी ट्रिक्स के साथ तुरंत समझें',
  estimatedReadTime: '4 मिनट',
  heroTakeaways: [
    'डेटा स्ट्रक्चर तय करता है कि RAM में डेटा कैसे व्यवस्थित होगा; एल्गोरिदम उस डेटा को खोजने या सॉर्ट करने के सटीक चरण हैं।',
    'हमेशा Big-O ग्रोथ रेट देखें: बड़े डेटा पर O(1) हैश मैप और O(log n) बाइनरी सर्च, O(n²) लूप से हज़ारों गुना तेज़ होते हैं।',
    'असली सॉफ्टवेयर इन्हें मिलाकर बनाता है: मैप्स में ग्राफ + A*, डेटाबेस में B+ ट्री और कैश में हैश मैप + डबली लिंक्ड लिस्ट।',
  ],
  chapters: [
    {
      ...SAMPLE_GUIDE_EN.chapters[0],
      heading: 'DS & Algo क्या है? नींव और Big-O नोटेशन',
      videoExplanation: [
        'डेटा स्ट्रक्चर मेमोरी में डेटा रखने का ढाँचा है—जैसे किताबों को अलमारी में क्रम से रखना या पॉइंटर से जोड़ना। एल्गोरिदम उस डेटा पर काम करने की स्पष्ट रेसिपी है।',
        'कोड को मिलीसेकंड में मापने के बजाय इंजीनियर Big-O कॉम्प्लेक्सिटी का उपयोग करते हैं ताकि पता चले कि इनपुट n बढ़ने पर स्पीड और मेमोरी कैसे बढ़ेगी।',
      ],
      insightLabel: 'मेमोरी ट्रिक · फोनबुक नियम',
      extraAiInsight:
        'अगर डेटा दोगुना करने पर सिर्फ 1 अतिरिक्त स्टेप लगे तो वह O(log n) है। काम दोगुना हो तो O(n), और चौगुना हो जाए तो सावधान—वह O(n²) है!',
    },
    {
      ...SAMPLE_GUIDE_EN.chapters[1],
      heading: 'डेटा स्ट्रक्चर के प्रकार: लीनियर बनाम नॉन-लीनियर',
      videoExplanation: [
        'लीनियर स्ट्रक्चर डेटा को एक कतार में रखते हैं: Array तुरंत O(1) इंडेक्स एक्सेस देता है, Stack LIFO (Undo) और Queue FIFO (टास्क लाइन) नियम मानता है।',
        'नॉन-लीनियर स्ट्रक्चर नेटवर्क और पदानुक्रम दिखाते हैं: Hash Map औसत O(1) में वैल्यू खोजता है, Tree O(log n) में और Graph जुड़े हुए नेटवर्क को दर्शाता है।',
      ],
      insightLabel: 'इंटरव्यू प्रो टिप',
      extraAiInsight:
        '80% कोडिंग सवालों में जब नेस्टेड लूप O(n²) बन जाए, तो एक Hash Map लगाकर थोड़ी अतिरिक्त मेमोरी से स्पीड सीधी O(n) पर लाई जा सकती है।',
    },
    {
      ...SAMPLE_GUIDE_EN.chapters[2],
      heading: 'प्रमुख एल्गोरिदम: सर्च, सॉर्ट और डायनेमिक प्रोग्रामिंग',
      videoExplanation: [
        'बाइनरी सर्च सॉर्टेड डेटा पर हर कदम में आधे विकल्प हटा देता है—10 लाख आइटम में से सही उत्तर अधिकतम 20 जाँच में मिल जाता है।',
        'Merge Sort और Quick Sort समस्या को छोटे हिस्सों में बाँटकर O(n log n) गति देते हैं, जबकि Dynamic Programming पुराने उत्तर सेव करके दोबारा मेहनत बचाती है।',
      ],
      insightLabel: 'आसान उदाहरण',
      extraAiInsight:
        'डायनेमिक प्रोग्रामिंग वैसी ही है जैसे "1+1+1+1+1 = 5" को पर्ची पर लिख लेना—ताकि "+1" जुड़ने पर आप दोबारा गिने बिना तुरंत "6" बता दें।',
    },
    {
      ...SAMPLE_GUIDE_EN.chapters[3],
      heading: 'असली दुनिया के सिस्टम में DSA का उपयोग',
      videoExplanation: [
        'Google Maps सड़कों को वेटेड ग्राफ मानता है और ट्रैफिक बढ़ने पर Dijkstra या A* एल्गोरिदम से पलक झपकते सबसे तेज़ रास्ता निकालता है।',
        'PostgreSQL और MySQL डिस्क रीड कम करने के लिए B+ ट्री इस्तेमाल करते हैं, और ब्राउज़र कैश O(1) LRU कैश के लिए हैश मैप + लिंक्ड लिस्ट जोड़ता है।',
      ],
      insightLabel: 'सिस्टम डिज़ाइन शॉर्टकट',
      extraAiInsight:
        'डिस्क पर करोड़ों रिकॉर्ड = B+ Tree; सर्च ऑटोकम्प्लीट = Trie; तेज़ कैश सिस्टम = Hash Map + Doubly Linked List।',
    },
  ],
  quickRecall: {
    terms: [
      { term: 'Array Access', definition: 'O(1) सीधा इंडेक्स एक्सेस', note: 'बीच में इंसर्ट O(n)' },
      { term: 'Hash Map', definition: 'O(1) औसत की-वैल्यू खोज', note: 'O(n) अतिरिक्त RAM' },
      { term: 'Binary Search', definition: 'O(log n) आधी-आधी खोज', note: 'डेटा सॉर्टेड होना ज़रूरी' },
      { term: 'Merge Sort', definition: 'O(n log n) स्थिर सॉर्टिंग', note: 'O(n) मेमोरी उपयोग' },
      { term: 'B+ Tree', definition: 'O(log n) डिस्क-फ्रेंडली ट्री', note: 'SQL डेटाबेस इंडेक्स' },
      { term: 'LRU Cache', definition: 'Hash Map + Doubly Linked List', note: 'O(1) रीड व अपडेट' },
    ],
    checklist: [
      'क्या आप O(log n), O(n) और O(n²) का अंतर एक आसान उदाहरण से समझा सकते हैं?',
      'क्या आप जानते हैं कि Hash Map और Balanced Tree में से कब किसे चुनना है?',
      'क्या आप बता सकते हैं कि 10 लाख आइटम में बाइनरी सर्च केवल 20 स्टेप क्यों लेता है?',
      'क्या आप डायनेमिक प्रोग्रामिंग के लिए बार-बार आने वाली उप-समस्याएँ पहचान सकते हैं?',
      'क्या आप GPS, SQL डेटाबेस और LRU कैश के पीछे के डेटा स्ट्रक्चर बता सकते हैं?',
    ],
  },
};

const SAMPLE_GUIDE_HINGLISH: VisualGuideData = {
  ...SAMPLE_GUIDE_EN,
  id: 'vguide-dsa-hinglish',
  language: 'hinglish',
  title: 'Data Structures & Algorithms — Visual Mastery Guide (Hinglish)',
  subtitle: 'Bina 5 ghante ka video dekhe crisp diagrams, micro-notes aur memory tricks se master karo',
  estimatedReadTime: '4 min',
  heroTakeaways: [
    'Data Structure batata hai ki RAM me data kaise store hoga; Algorithm wo step-by-step recipe hai jo us data pe kaam karti hai.',
    'Hamesha Big-O growth check karo: large scale pe O(1) Hash Map aur O(log n) Binary Search, O(n²) loops ko easily beat karte hain.',
    'Real production apps combos use karte hain: Google Maps me Graph + A*, Databases me B+ Tree, aur Caches me Hash Map + Doubly Linked List.',
  ],
  chapters: [
    {
      ...SAMPLE_GUIDE_EN.chapters[0],
      heading: 'DS & Algo Kya Hai? Foundations & Big-O',
      videoExplanation: [
        'Data Structure memory layout set karta hai—jaise books ko neat shelf me lagana ya pointers se link karna. Algorithm wo exact steps hain jinse hum data search, sort ya update karte hain.',
        'Milliseconds me speed check karne ke bajay engineers Big-O Complexity dekhte hain, taaki pata chale ki input n 100 se 1 crore hone par speed kaise behave karegi.',
      ],
      insightLabel: 'Memory Trick · Phonebook Rule',
      extraAiInsight:
        'Agar input double karne par sirf 1 extra step lage toh O(log n)! Kaam double ho toh O(n), aur agar 4x ho jaye toh samajh jao O(n²) danger zone hai.',
    },
    {
      ...SAMPLE_GUIDE_EN.chapters[1],
      heading: 'Data Structures ke Types: Linear vs. Non-Linear',
      videoExplanation: [
        'Linear structures items ko sequence me store karte hain: Arrays me O(1) direct index jump milta hai, Stack LIFO (Undo) follow karta hai aur Queue FIFO (task line).',
        'Non-Linear structures hierarchy aur connections handle karte hain: Hash Map average O(1) lookup deta hai, Trees sorted O(log n) search aur Graphs road/social networks.',
      ],
      insightLabel: 'Interview Pro Tip',
      extraAiInsight:
        '80% coding interviews me jab nested loop O(n²) bane, tab ek Hash Map use karke thodi extra RAM ke badle speed sidha O(n) pe laayi ja sakti hai!',
    },
    {
      ...SAMPLE_GUIDE_EN.chapters[2],
      heading: 'Common Algorithms: Search, Sort & Dynamic Programming',
      videoExplanation: [
        'Binary Search sorted array me har step par aadha data eliminate kar deta hai—10 lakh items me bhi max 20 checks me target mil jata hai.',
        'Merge Sort aur Quick Sort divide-and-conquer se O(n log n) speed dete hain, jabki Dynamic Programming purane sub-answers cache karke repeated work bachata hai.',
      ],
      insightLabel: 'Desi Analogy · Sticky Note',
      extraAiInsight:
        'Dynamic Programming bilkul waisa hai jaise "1+1+1+1+1 = 5" sticky note pe likh lena—taaki "+1" aane pe dobara count kiye bina instant "6" bol sako.',
    },
    {
      ...SAMPLE_GUIDE_EN.chapters[3],
      heading: 'Real-World Production Systems me DSA',
      videoExplanation: [
        'Google Maps roads ko weighted Graph banata hai aur traffic aane par Dijkstra ya A* se milliseconds me fastest detour nikalta hai.',
        'PostgreSQL aur MySQL slow disk reads kam karne ke liye B+ Trees use karte hain, aur Redis/Browser O(1) LRU Cache ke liye Hash Map + Doubly Linked List.',
      ],
      insightLabel: 'System Design Cheat Code',
      extraAiInsight:
        'Disk pe millions of rows = B+ Tree. Instant search autocomplete = Trie. High-speed cache eviction = Hash Map + Doubly Linked List.',
    },
  ],
  quickRecall: {
    terms: [
      { term: 'Array Access', definition: 'O(1) direct index jump', note: 'Middle insert O(n) slow' },
      { term: 'Hash Map', definition: 'O(1) average key lookup', note: 'O(n) extra RAM lagti hai' },
      { term: 'Binary Search', definition: 'O(log n) half-half search', note: 'Data sorted hona zaruri hai' },
      { term: 'Merge Sort', definition: 'O(n log n) guaranteed speed', note: 'Stable sort, O(n) space' },
      { term: 'B+ Tree', definition: 'O(log n) disk-friendly tree', note: 'SQL DB indexing ka base' },
      { term: 'LRU Cache', definition: 'Hash Map + Doubly Linked List', note: 'O(1) get aur eviction' },
    ],
    checklist: [
      'Kya tum O(log n), O(n), aur O(n²) ka difference ek real example se samjha sakte ho?',
      'Kya clear hai ki Hash Map aur Balanced Tree me kab kaunsa best hota hai?',
      'Kya Binary Search 10 lakh sorted items ko 20 steps me kaise dhoondhta hai ye trace kar sakte ho?',
      'Kya overlapping subproblems dekh ke Dynamic Programming spot kar sakte ho?',
      'Kya GPS routing, SQL indexing, aur LRU cache ke core data structures yaad hain?',
    ],
  },
};

export const SAMPLE_VISUAL_GUIDES_BY_LANGUAGE: Record<LanguageCode, VisualGuideData> = {
  en: SAMPLE_GUIDE_EN,
  hi: SAMPLE_GUIDE_HI,
  hinglish: SAMPLE_GUIDE_HINGLISH,
};

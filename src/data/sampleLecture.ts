import type { LanguageCode, LectureWorkspace } from '../types/mindflow';

export const SAMPLE_DSA_LECTURE: LectureWorkspace = {
  id: 'dsa-masterclass-01',
  title: 'Data Structures & Algorithms',
  channel: 'freeCodeCamp · Computer Science',
  youtubeUrl: 'https://www.youtube.com/watch?v=8hly31xKli0',
  videoId: '8hly31xKli0',
  durationLabel: '5:22:09',
  videoCategory: 'Tutorial',
  language: 'en',
  isDemo: true,
  tldw: [
    'Choosing the right data structure (Array, Hash Map, Tree, Graph) matters more for performance than micro-optimizing syntax or hardware.',
    'Big-O notation measures how operations scale as input n grows—dropping an O(n²) brute-force loop to O(n log n) or O(log n) turns minutes into milliseconds.',
    'Every real-world app relies on DSA primitives: GPS routing uses weighted graphs, databases index rows with B+ Trees, and autocomplete uses Prefix Tries.',
  ],
  nodes: [
    {
      id: 'root',
      title: 'Data Structures & Algorithms',
      shortSubtitle: 'Core blueprint for scalable, low-latency software',
      timestampLabel: '04:20',
      timestampSeconds: 260,
      isRoot: true,
      accent: 'root',
      icon: 'cpu',
      position: { x: 460, y: 280 },
      keyPoints: [
        {
          keyword: 'Memory Organization',
          detail:
            'Data structures define how bytes are arranged in RAM so reads, inserts, and deletes match your workload.',
        },
        {
          keyword: 'Algorithmic Efficiency',
          detail:
            'Algorithms pair step-by-step logic with the right container to keep latency predictable at millions of items.',
        },
        {
          keyword: 'Big-O Trade-offs',
          detail:
            'Every engineering choice balances Time Complexity against Space Complexity as input size n scales.',
        },
        {
          keyword: 'Interview & Systems Core',
          detail:
            'Forms the foundation behind databases, compilers, routing engines, and high-throughput APIs.',
        },
      ],
      realLifeExample:
        'A city library organizes millions of books with catalog indices (data structure) so librarians locate any title in seconds (algorithm).',
      simplifiedAnalogy:
        'Think of a giant library: Data Structures are how the shelves and catalog cards are arranged.\nAlgorithms are the exact walking path you follow to pull the right book fast.\nEven the smartest librarian slows down if every book is thrown into one unmarked pile.',
    },
    {
      id: 'what-is-dsa',
      title: 'What is DS & Algo?',
      shortSubtitle: 'Containers, step-by-step procedures & Big-O growth',
      timestampLabel: '08:45',
      timestampSeconds: 525,
      accent: 'violet',
      icon: 'book',
      position: { x: 162, y: 128 },
      keyPoints: [
        {
          keyword: 'Data Structure (DS)',
          detail:
            'A specialized format for organizing, indexing, and storing values to enable specific operations efficiently.',
        },
        {
          keyword: 'Algorithm (Algo)',
          detail:
            'A finite, deterministic sequence of instructions that transforms input data into a verified output.',
        },
        {
          keyword: 'Asymptotic Analysis',
          detail:
            'Big-O notation measures worst-case growth rate independently of CPU clock speed or programming language.',
        },
        {
          keyword: 'Time vs. Space',
          detail:
            'Caching or hash tables spend extra memory (O(n) space) to collapse repeated lookups from O(n) down to O(1).',
        },
      ],
      realLifeExample:
        'Instagram caches recent feed posts in memory (extra space) so scrolling loads instantly in O(1) instead of re-querying databases.',
      simplifiedAnalogy:
        'A recipe book is the algorithm (exact step-by-step cooking instructions) and your labeled spice rack is the data structure.\nEven a Michelin-star recipe takes forever if all your spices are dumped inside one giant jar.\nPairing clear steps with organized storage is what makes software fast.',
      subNodes: [
        {
          id: 'sub-big-o',
          parentId: 'what-is-dsa',
          title: 'Big-O Time Growth',
          shortSubtitle: 'O(1), O(log n), O(n), O(n²)',
          timestampLabel: '09:15',
          timestampSeconds: 555,
          accent: 'violet',
          icon: 'book',
          keyPoints: [
            {
              keyword: 'Hardware Independent',
              detail: 'Counts primitive operations as n approaches infinity rather than stopwatch milliseconds.',
            },
            {
              keyword: 'Drop Constants',
              detail: 'O(2n + 10) simplifies to O(n) because the dominant growth curve rules at large scale.',
            },
          ],
          realLifeExample:
            'Searching a 1-million-contact directory linearly takes up to 1M checks, while O(log n) binary search takes at most 20.',
          simplifiedAnalogy:
            'Checking the first card on a desk always takes 1 second (O(1)).\nChecking every card in a box takes longer as the box grows (O(n)).\nComparing every card with every other card explodes rapidly (O(n²)).',
        },
        {
          id: 'sub-space-tradeoff',
          parentId: 'what-is-dsa',
          title: 'Time vs. Space Trade-off',
          shortSubtitle: 'Memory caching for speed',
          timestampLabel: '10:30',
          timestampSeconds: 630,
          accent: 'violet',
          icon: 'cpu',
          keyPoints: [
            {
              keyword: 'Auxiliary Memory',
              detail: 'Extra RAM allocated for hash maps, DP tables, or recursion call stacks.',
            },
            {
              keyword: 'Speed Multiplier',
              detail: 'Trading O(n) memory often cuts runtime from quadratic O(n²) down to linear O(n).',
            },
          ],
          realLifeExample:
            'Two-Sum checks complements in a Hash Set using extra RAM to avoid slow nested loops.',
          simplifiedAnalogy:
            'Keeping a sticky note of your Wi-Fi password on your desk uses a tiny bit of space.\nIn return, you save five minutes of walking to the router every time a guest visits.\nThat exact swap of small space for instant speed is the Time-Space trade-off.',
        },
        {
          id: 'sub-worst-avg',
          parentId: 'what-is-dsa',
          title: 'Best, Avg & Worst Case',
          shortSubtitle: 'Ω, Θ, and Big-O bounds',
          timestampLabel: '11:20',
          timestampSeconds: 680,
          accent: 'violet',
          icon: 'layers',
          keyPoints: [
            {
              keyword: 'Worst-Case Guarantee',
              detail: 'Production SLAs rely on Big-O worst cases so malicious or skewed inputs never stall servers.',
            },
            {
              keyword: 'Amortized Cost',
              detail: 'Dynamic array resizing is occasional O(n) work spread across many O(1) appends.',
            },
          ],
          realLifeExample:
            'Payment APIs optimize for P99 worst-case latency rather than lucky best-case traffic.',
          simplifiedAnalogy:
            'Planning your airport commute by best-case 3 AM traffic will make you miss your flight.\nEngineers plan using worst-case rush-hour traffic (Big-O) so systems stay reliable under pressure.\nAmortized cost is like buying a monthly pass—one big upfront cost averages out cheap per ride.',
        },
      ],
    },
    {
      id: 'types-of-ds',
      title: 'Types of Data Structures',
      shortSubtitle: 'Linear arrays/lists vs. non-linear trees & graphs',
      timestampLabel: '12:15',
      timestampSeconds: 735,
      accent: 'cyan',
      icon: 'layers',
      position: { x: 758, y: 128 },
      keyPoints: [
        {
          keyword: 'Arrays & Linked Lists',
          detail:
            'Arrays provide O(1) contiguous index lookup; Linked Lists allow O(1) pointer-based splice without reallocating.',
        },
        {
          keyword: 'Stacks & Queues',
          detail:
            'Restricted linear flows: LIFO Stacks power call frames & undo history; FIFO Queues drive task schedulers.',
        },
        {
          keyword: 'Hash Tables',
          detail:
            'Map arbitrary keys to array buckets via a hash function, achieving amortized O(1) average lookup and insertion.',
        },
        {
          keyword: 'Trees & Graphs',
          detail:
            'Hierarchical BSTs/Heaps keep data ordered in O(log n); Graphs model arbitrary networks of vertices and edges.',
        },
      ],
      realLifeExample:
        'Your browser uses a Stack for the Back button, a Queue for network requests, and a DOM Tree to render HTML elements.',
      simplifiedAnalogy:
        'Linear structures are like a row of numbered lockers (Array) or a stack of cafeteria trays (Stack).\nNon-linear structures like Trees and Graphs look like a company org chart or a city metro map.\nPicking the right shape lets you jump straight to what you need without scanning everything.',
      subNodes: [
        {
          id: 'sub-arrays-lists',
          parentId: 'types-of-ds',
          title: 'Arrays & Linked Lists',
          shortSubtitle: 'Contiguous RAM vs. pointer nodes',
          timestampLabel: '12:40',
          timestampSeconds: 760,
          accent: 'cyan',
          icon: 'layers',
          keyPoints: [
            {
              keyword: 'CPU Cache Locality',
              detail: 'Contiguous array elements load together into L1/L2 cache lines for blazing sequential iteration.',
            },
            {
              keyword: 'O(1) Node Splice',
              detail: 'Doubly linked lists unlink or insert middle elements in constant time once you hold a node pointer.',
            },
          ],
          realLifeExample:
            'Music playlists use doubly linked lists so Next/Previous track jumps and reordering happen instantaneously.',
          simplifiedAnalogy:
            'An Array is a row of theater seats reserved side-by-side—finding Seat 42 is instant, but squeezing someone in shifts everyone.\nA Linked List is a treasure hunt where each clue holds the address of the next spot.\nAdding a new stop just means updating one clue card.',
        },
        {
          id: 'sub-stacks-queues',
          parentId: 'types-of-ds',
          title: 'Stacks & Queues',
          shortSubtitle: 'LIFO undo frames & FIFO buffers',
          timestampLabel: '14:15',
          timestampSeconds: 855,
          accent: 'cyan',
          icon: 'book',
          keyPoints: [
            {
              keyword: 'LIFO Stack',
              detail: 'Last-In First-Out discipline governs function call stacks, Ctrl+Z undo, and syntax bracket matching.',
            },
            {
              keyword: 'FIFO Queue',
              detail: 'First-In First-Out ordering powers print spoolers, BFS traversal, and Kafka message pipelines.',
            },
          ],
          realLifeExample:
            'Ticket booking servers put burst checkout requests into a FIFO queue so orders process fairly without crashing.',
          simplifiedAnalogy:
            'A Stack is a pile of washed plates—you always grab the top plate you just placed down (Last-In, First-Out).\nA Queue is a coffee shop line—the first person in line gets served first (First-In, First-Out).\nSimple rules keep busy workflows totally predictable.',
        },
        {
          id: 'sub-trees-graphs',
          parentId: 'types-of-ds',
          title: 'Trees, Heaps & Graphs',
          shortSubtitle: 'Hierarchical & networked data',
          timestampLabel: '16:05',
          timestampSeconds: 965,
          accent: 'cyan',
          icon: 'git-branch',
          keyPoints: [
            {
              keyword: 'Balanced BST / Heap',
              detail: 'Self-balancing trees keep search height at O(log n); Heaps expose the min/max priority item in O(1).',
            },
            {
              keyword: 'Adjacency Lists',
              detail: 'Sparse real-world graphs store neighbor lists to save massive memory compared to O(V²) matrices.',
            },
          ],
          realLifeExample:
            'LinkedIn connections and airline flight routes are modeled as graphs to compute degrees of separation and cheapest hops.',
          simplifiedAnalogy:
            'A Tree is your computer folder hierarchy where every subfolder branches cleanly downward from one root.\nA Graph is a city road network where intersections connect in loops and shortcuts in any direction.\nThey capture relationships that a flat list could never express.',
        },
      ],
    },
    {
      id: 'common-algorithms',
      title: 'Common Algorithms',
      shortSubtitle: 'Searching, sorting, recursion & dynamic programming',
      timestampLabel: '18:30',
      timestampSeconds: 1110,
      accent: 'emerald',
      icon: 'git-branch',
      position: { x: 162, y: 432 },
      keyPoints: [
        {
          keyword: 'Binary Search',
          detail:
            'Halves a sorted search space on every comparison, finding an item among 1,000,000 records in at most 20 steps.',
        },
        {
          keyword: 'Merge & Quick Sort',
          detail:
            'Divide-and-conquer sorting algorithms delivering O(n log n) performance far ahead of O(n²) bubble or insertion sort.',
        },
        {
          keyword: 'BFS & DFS Traversal',
          detail:
            'Breadth-First Search finds shortest unweighted paths layer by layer; Depth-First Search explores full branches first.',
        },
        {
          keyword: 'Dynamic Programming',
          detail:
            'Breaks overlapping subproblems into memoized states, turning exponential recursion into clean polynomial time.',
        },
      ],
      realLifeExample:
        'Git bisect uses Binary Search across thousands of commits to pinpoint the exact commit that introduced a bug in seconds.',
      simplifiedAnalogy:
        'Binary Search is opening a paper dictionary right to the middle instead of flipping page 1, 2, 3.\nEvery single check throws away half of the remaining pages at once.\nDynamic Programming is jotting down math answers on scratch paper so you never solve the exact same sum twice.',
      subNodes: [
        {
          id: 'sub-binary-search',
          parentId: 'common-algorithms',
          title: 'Binary Search',
          shortSubtitle: 'Logarithmic halving on sorted data',
          timestampLabel: '18:50',
          timestampSeconds: 1130,
          accent: 'emerald',
          icon: 'git-branch',
          keyPoints: [
            {
              keyword: 'Monotonic Precondition',
              detail: 'Requires sorted order or a monotonic true/false predicate to safely discard half the range.',
            },
            {
              keyword: 'O(log n) Scaling',
              detail: 'Doubling the dataset from 1M to 2M adds just ONE extra comparison step.',
            },
          ],
          realLifeExample:
            'Finding a specific timestamp inside an append-only log file of 10 million entries takes under 24 disk reads.',
          simplifiedAnalogy:
            'Imagine guessing a number from 1 to 100 when told "higher" or "lower".\nGuessing 50 first instantly wipes out 50 wrong numbers in one shot.\nYou are guaranteed to nail the answer in 7 guesses or fewer.',
        },
        {
          id: 'sub-sorting',
          parentId: 'common-algorithms',
          title: 'Merge & Quick Sort',
          shortSubtitle: 'Divide-and-conquer O(n log n)',
          timestampLabel: '20:15',
          timestampSeconds: 1215,
          accent: 'emerald',
          icon: 'layers',
          keyPoints: [
            {
              keyword: 'Merge Sort Stability',
              detail: 'Always runs in O(n log n) and preserves the relative order of equal keys using O(n) merge space.',
            },
            {
              keyword: 'Quick Sort In-Place',
              detail: 'Partitions around a pivot in O(log n) stack space with exceptional real-world CPU cache speed.',
            },
          ],
          realLifeExample:
            'Python and Java use Timsort (a Merge + Insertion Sort hybrid) to sort product catalogs and analytics tables.',
          simplifiedAnalogy:
            'Sorting 1,000 exam papers alone is exhausting, so you split the stack in half and hand halves to friends.\nEach friend keeps splitting until they hold two papers, sorts them, and zips sorted stacks neatly back together.\nDividing the work turns hours into minutes.',
        },
        {
          id: 'sub-dp-graph',
          parentId: 'common-algorithms',
          title: 'BFS, DFS & Dynamic Prog.',
          shortSubtitle: 'Shortest hops & memoized states',
          timestampLabel: '22:30',
          timestampSeconds: 1350,
          accent: 'emerald',
          icon: 'cpu',
          keyPoints: [
            {
              keyword: 'BFS Shortest Path',
              detail: 'Explores nodes level by level via a Queue to guarantee minimum-hop routes in unweighted graphs.',
            },
            {
              keyword: 'Memoization Cache',
              detail: 'Stores solved DP subproblems in a table to eliminate repeated exponential recursion branches.',
            },
          ],
          realLifeExample:
            'Spell-checkers use Dynamic Programming (Edit Distance) to suggest the closest dictionary word for typos.',
          simplifiedAnalogy:
            'BFS is like ripples spreading evenly in a pond—you always reach the closest lily pads first.\nDFS is walking down one maze corridor all the way to the dead end before backtracking.\nDynamic Programming is marking every corridor you already solved so you never walk it twice.',
        },
      ],
    },
    {
      id: 'real-life-apps',
      title: 'Applications in Real Life',
      shortSubtitle: 'Maps routing, database B-Trees & autocomplete tries',
      timestampLabel: '24:50',
      timestampSeconds: 1490,
      accent: 'indigo',
      icon: 'globe',
      position: { x: 758, y: 432 },
      keyPoints: [
        {
          keyword: 'GPS & Shortest Path',
          detail:
            'Navigation apps model roads as weighted graphs and run Dijkstra or A* with priority queues to calculate live ETAs.',
        },
        {
          keyword: 'Database Indexing',
          detail:
            'PostgreSQL and MySQL rely on balanced B+ Trees to locate rows on disk in milliseconds across terabytes of data.',
        },
        {
          keyword: 'Search Autocomplete',
          detail:
            'Prefix Trees (Tries) power instant type-ahead suggestions by traversing character nodes in O(k) key length.',
        },
        {
          keyword: 'LRU Caches & Feeds',
          detail:
            'Combining a Hash Map with a Doubly Linked List gives CDNs and browsers O(1) cache hits and evictions.',
        },
      ],
      realLifeExample:
        'Google Maps recalculates alternate routes in milliseconds by running A* over weighted road graphs with real-time traffic edges.',
      simplifiedAnalogy:
        'Every time GPS reroutes you around a traffic jam or your phone finishes typing your search query, hidden algorithms are running.\nMaps treat intersections as graph dots connected by road weights.\nSearch bars climb a letter-by-letter tree so suggestions appear before your finger lifts off the key.',
      subNodes: [
        {
          id: 'sub-gps-routing',
          parentId: 'real-life-apps',
          title: 'GPS & A* Pathfinding',
          shortSubtitle: 'Weighted road graphs & min-heaps',
          timestampLabel: '25:05',
          timestampSeconds: 1505,
          accent: 'indigo',
          icon: 'globe',
          keyPoints: [
            {
              keyword: 'Priority Queue Frontier',
              detail: 'Min-Heap always expands the lowest cumulative travel-time intersection next.',
            },
            {
              keyword: 'A* Heuristic',
              detail: 'Adds straight-line distance estimates to focus search toward the destination instead of all directions.',
            },
          ],
          realLifeExample:
            'Uber and DoorDash match nearby drivers and estimate ETAs using contraction hierarchies built on Dijkstra.',
          simplifiedAnalogy:
            'Imagine planning a road trip where each highway shows live traffic minutes instead of miles.\nA* always explores the fastest road heading toward your destination city first.\nIt skips checking roads going the opposite direction, finding the best route in milliseconds.',
        },
        {
          id: 'sub-db-btree',
          parentId: 'real-life-apps',
          title: 'Database B+ Tree Indexes',
          shortSubtitle: 'Disk-friendly multi-way trees',
          timestampLabel: '26:10',
          timestampSeconds: 1570,
          accent: 'indigo',
          icon: 'layers',
          keyPoints: [
            {
              keyword: 'High Branching Factor',
              detail: 'Each node packs hundreds of keys per SSD page, keeping tree depth to 3–4 levels for billions of rows.',
            },
            {
              keyword: 'Linked Leaf Scans',
              detail: 'Leaf pages point to neighbors so SQL range queries (BETWEEN) stream sequentially at disk speed.',
            },
          ],
          realLifeExample:
            'PostgreSQL B-Tree indexes locate a single user profile among 500M rows in under 1 millisecond.',
          simplifiedAnalogy:
            'A B+ Tree is like a textbook table of contents that jumps straight to Chapter 7, then Section 7.4, then Page 214.\nInstead of flipping 1,000 pages, you make just three quick hops.\nAnd because related pages sit linked side-by-side, reading a date range is effortless.',
        },
        {
          id: 'sub-lru-trie',
          parentId: 'real-life-apps',
          title: 'LRU Cache & Search Tries',
          shortSubtitle: 'O(1) edge caching & type-ahead',
          timestampLabel: '27:25',
          timestampSeconds: 1645,
          accent: 'indigo',
          icon: 'cpu',
          keyPoints: [
            {
              keyword: 'Hash Map + Doubly List',
              detail: 'LRU caches look up cached entries in O(1) and evict the stalest tail entry in O(1).',
            },
            {
              keyword: 'Prefix Trie',
              detail: 'Shares common word prefixes along character paths so autocomplete scales with typed length k.',
            },
          ],
          realLifeExample:
            'Redis and Cloudflare edge nodes use LRU eviction to serve hot API responses globally in under 10ms.',
          simplifiedAnalogy:
            'An LRU Cache is your work desk—the notebooks you opened today stay right in front of you.\nWhen the desk runs out of space, the dusty notebook you haven’t touched all month gets shelved.\nThat keeps your most-used items always within arm’s reach.',
        },
      ],
    },
  ],
  cheatSheet: {
    definitionsTitle: '01. Core Definitions',
    comparisonTableTitle: '02. Time & Space Complexity Reference',
    comparisonColumns: [
      'Structure / Algorithm',
      'Access',
      'Search',
      'Insert / Sort',
      'Space',
      'Profile',
    ],
    examplesTitle: '03. Real-World Engineering Examples',
    definitions: [
      {
        term: 'Time Complexity (Big-O)',
        summary:
          'Describes how runtime grows as input size n approaches infinity, ignoring machine-specific constants.',
        formulaOrNote: 'O(1) < O(log n) < O(n) < O(n log n) < O(n²)',
        accent: 'violet',
      },
      {
        term: 'Hash Collision Resolution',
        summary:
          'When two keys hash to the same bucket, maps handle overlap using Separate Chaining or Open Addressing.',
        formulaOrNote: 'Load Factor α = n / buckets (resize near 0.75)',
        accent: 'cyan',
      },
      {
        term: 'Divide & Conquer',
        summary:
          'Recursively splits a problem into independent subproblems, solves base cases, and merges results cleanly.',
        formulaOrNote: 'T(n) = 2T(n/2) + O(n) → O(n log n)',
        accent: 'emerald',
      },
      {
        term: 'Memoization vs. Tabulation',
        summary:
          'Top-down memoization caches recursive calls on demand; bottom-up tabulation fills an iterative DP table.',
        formulaOrNote: 'Eliminates redundant overlapping subtrees',
        accent: 'indigo',
      },
    ],
    complexityRows: [
      {
        structureOrAlgo: 'Array (Indexed)',
        access: 'O(1)',
        search: 'O(n)',
        insert: 'O(n)',
        space: 'O(n)',
        rating: 'optimal',
        ratingLabel: 'Fast Reads',
      },
      {
        structureOrAlgo: 'Hash Table (Avg)',
        access: 'N/A',
        search: 'O(1)',
        insert: 'O(1)',
        space: 'O(n)',
        rating: 'optimal',
        ratingLabel: 'Constant Avg',
      },
      {
        structureOrAlgo: 'Binary Search (Sorted)',
        access: 'O(1)',
        search: 'O(log n)',
        insert: 'N/A',
        space: 'O(1)',
        rating: 'optimal',
        ratingLabel: 'Logarithmic',
      },
      {
        structureOrAlgo: 'Balanced BST (AVL / RB)',
        access: 'O(log n)',
        search: 'O(log n)',
        insert: 'O(log n)',
        space: 'O(n)',
        rating: 'balanced',
        ratingLabel: 'Ordered Log',
      },
      {
        structureOrAlgo: 'Merge Sort',
        access: 'N/A',
        search: 'N/A',
        insert: 'O(n log n)',
        space: 'O(n)',
        rating: 'balanced',
        ratingLabel: 'Stable Sort',
      },
      {
        structureOrAlgo: 'Bubble / Selection Sort',
        access: 'N/A',
        search: 'N/A',
        insert: 'O(n²)',
        space: 'O(1)',
        rating: 'caution',
        ratingLabel: 'Quadratic',
      },
    ],
    realWorldExamples: [
      {
        domain: 'Maps & Turn-by-Turn Routing',
        structure: 'Weighted Graph + Min-Heap (A* / Dijkstra)',
        explanation:
          'Intersections act as vertices and road segments carry live traffic weights so the heap always expands the lowest-cost frontier first.',
        timestampSeconds: 1490,
        timestampLabel: '24:50',
      },
      {
        domain: 'Relational Database Indexes',
        structure: 'B+ Tree',
        explanation:
          'High branching factors minimize disk page reads while linked leaf nodes accelerate range scans like WHERE date BETWEEN ...',
        timestampSeconds: 1570,
        timestampLabel: '26:10',
      },
      {
        domain: 'Browser Back/Forward & Undo',
        structure: 'Dual LIFO Stacks',
        explanation:
          'Pushing each visited route onto a history stack makes navigation instantaneous in O(1) time with predictable memory bounds.',
        timestampSeconds: 855,
        timestampLabel: '14:15',
      },
      {
        domain: 'CDN & API Rate Limiting',
        structure: 'Hash Map + Doubly Linked List (LRU)',
        explanation:
          'Promotes hot keys to the head in O(1) and evicts the least-recently-used tail node cleanly when cache capacity is reached.',
        timestampSeconds: 1645,
        timestampLabel: '27:25',
      },
    ],
  },
  transcript: [
    {
      id: 'sec-intro',
      nodeId: 'root',
      title: '1. Course Roadmap: Data Structures & Algorithms',
      topicTag: 'Foundations',
      startLabel: '04:20',
      startSeconds: 260,
      accent: 'root',
      lines: [
        {
          id: 'l-1',
          timestampLabel: '04:20',
          timestampSeconds: 260,
          text: 'Welcome to Data Structures and Algorithms. Before writing a single line of code, we need a clear mental model for why structure determines speed.',
        },
        {
          id: 'l-2',
          timestampLabel: '05:12',
          timestampSeconds: 312,
          text: 'Two programs can return the exact same answer, yet one finishes in two milliseconds while the other stalls for ten minutes at scale.',
        },
        {
          id: 'l-3',
          timestampLabel: '06:40',
          timestampSeconds: 400,
          text: 'Throughout this lecture we connect memory layout directly to runtime growth so you can select the right tool on sight.',
        },
      ],
    },
    {
      id: 'sec-what',
      nodeId: 'what-is-dsa',
      title: '2. What is DS & Algo? Understanding Big-O',
      topicTag: 'Complexity',
      startLabel: '08:45',
      startSeconds: 525,
      accent: 'violet',
      lines: [
        {
          id: 'l-4',
          timestampLabel: '08:45',
          timestampSeconds: 525,
          text: 'An algorithm is a well-defined sequence of steps with clear inputs, termination conditions, and verifiable correctness.',
        },
        {
          id: 'l-5',
          timestampLabel: '09:50',
          timestampSeconds: 590,
          text: 'We measure efficiency with Big-O notation because wall-clock seconds change across laptops, whereas operation growth curves stay invariant.',
        },
        {
          id: 'l-6',
          timestampLabel: '11:05',
          timestampSeconds: 665,
          text: 'Always ask two questions: how many operations occur as n doubles, and how much auxiliary space does our container allocate?',
        },
      ],
    },
    {
      id: 'sec-types',
      nodeId: 'types-of-ds',
      title: '3. Types of Data Structures: Linear to Non-Linear',
      topicTag: 'Structures',
      startLabel: '12:15',
      startSeconds: 735,
      accent: 'cyan',
      lines: [
        {
          id: 'l-7',
          timestampLabel: '12:15',
          timestampSeconds: 735,
          text: 'Contiguous arrays give instant O(1) random access via simple pointer arithmetic, making them extraordinarily friendly to CPU caches.',
        },
        {
          id: 'l-8',
          timestampLabel: '14:15',
          timestampSeconds: 855,
          text: 'Linked lists trade random access for flexible node insertion, while stacks and queues enforce disciplined LIFO and FIFO contracts.',
        },
        {
          id: 'l-9',
          timestampLabel: '16:05',
          timestampSeconds: 965,
          text: 'When relationships branch out, balanced binary search trees maintain sorted order in O(log n) and hash tables deliver near-instant key lookups.',
        },
      ],
    },
    {
      id: 'sec-algos',
      nodeId: 'common-algorithms',
      title: '4. Common Algorithms: Search, Sort & Graph Traversal',
      topicTag: 'Algorithms',
      startLabel: '18:30',
      startSeconds: 1110,
      accent: 'emerald',
      lines: [
        {
          id: 'l-10',
          timestampLabel: '18:50',
          timestampSeconds: 1130,
          text: 'Binary search illustrates logarithmic power: on a sorted array, checking the midpoint eliminates half the remaining elements every single step.',
        },
        {
          id: 'l-11',
          timestampLabel: '20:15',
          timestampSeconds: 1215,
          text: 'Merge sort splits the array down to single elements and merges sorted halves in linear time, guaranteeing O(n log n) even in worst-case inputs.',
        },
        {
          id: 'l-12',
          timestampLabel: '22:30',
          timestampSeconds: 1350,
          text: 'For graphs, BFS uses a queue to uncover shortest hop paths while DFS uses recursion or a stack to explore deep dependency chains.',
        },
      ],
    },
    {
      id: 'sec-apps',
      nodeId: 'real-life-apps',
      title: '5. Applications in Real Life Engineering',
      topicTag: 'Production',
      startLabel: '24:50',
      startSeconds: 1490,
      accent: 'indigo',
      lines: [
        {
          id: 'l-13',
          timestampLabel: '25:05',
          timestampSeconds: 1505,
          text: 'Let us map these primitives to real production systems: navigation engines combine weighted road graphs with A* heuristics for live routing.',
        },
        {
          id: 'l-14',
          timestampLabel: '26:10',
          timestampSeconds: 1570,
          text: 'Database storage engines rely on B+ Trees so range queries and primary key lookups touch only three or four disk pages out of millions.',
        },
        {
          id: 'l-15',
          timestampLabel: '27:25',
          timestampSeconds: 1645,
          text: 'Prefix tries drive autocomplete search bars, and LRU caches pair hash maps with doubly linked lists to keep edge responses sub-millisecond.',
        },
      ],
    },
  ],
};

/** Pre-seeded Hinglish preview so switching language on the default lecture is instant (0 API calls) */
export const SAMPLE_DSA_HINGLISH: LectureWorkspace = {
  ...SAMPLE_DSA_LECTURE,
  language: 'hinglish',
  title: 'Data Structures & Algorithms',
  videoCategory: 'Tutorial',
  tldw: [
    'Sahi Data Structure (Array, Hash Map, Tree, Graph) choose karna code ko fast banane ke liye hardware upgrade se bhi zyada zaroori hai.',
    'Big-O notation batata hai ki input badhne par code kitna slow hoga—O(n²) ko O(n log n) ya O(log n) mein lane se minutes ka kaam milliseconds mein hota hai.',
    'Real-world apps mein yahi use hota hai: Google Maps mein Weighted Graphs, Databases mein B+ Trees, aur Search Autocomplete mein Tries.',
  ],
  nodes: SAMPLE_DSA_LECTURE.nodes.map((node) => {
    if (node.id === 'root') {
      return {
        ...node,
        shortSubtitle: 'Fast aur scalable software banane ka core blueprint',
        keyPoints: [
          {
            keyword: 'Memory Organization',
            detail: 'Ye concept RAM mein data ko efficiently arrange karta hai taaki read, insert aur delete fast hon.',
          },
          {
            keyword: 'Algorithmic Speed',
            detail: 'Step-by-step logic aur sahi container milkar lakhon records par bhi app ko smooth rakhte hain.',
          },
          {
            keyword: 'Big-O Trade-off',
            detail: 'Har engineering decision mein Time Complexity aur Space Complexity ke beech smart balance banana padta hai.',
          },
          {
            keyword: 'Real Systems Base',
            detail: 'Databases, compilers, GPS routing aur high-traffic APIs sab isi foundation par chalte hain.',
          },
        ],
        realLifeExample:
          'Ek badi library mein shelves aur index cards Data Structure hain, aur book dhoondhne ka sabse chhota rasta Algorithm.',
        simplifiedAnalogy:
          'Ek badi library socho: Data Structures wo tareeka hai jisse shelves aur index cards arrange kiye gaye hain.\nAlgorithms wo exact rasta hai jo aap sahi book seconds mein nikalne ke liye follow karte ho.\nAgar saari books ek hi dher mein phenk di jayein, toh sabse smart librarian bhi slow ho jayega.',
      };
    }
    if (node.id === 'what-is-dsa') {
      return {
        ...node,
        title: 'DS & Algo Kya Hai?',
        shortSubtitle: 'Data containers, step-by-step logic aur Big-O growth',
        keyPoints: [
          {
            keyword: 'Data Structure',
            detail: 'Data ko store aur organize karne ka smart format taaki lookup aur update tezi se ho sake.',
          },
          {
            keyword: 'Algorithm',
            detail: 'Ek clear step-by-step procedure jo input ko sahi output mein badalta hai.',
          },
          {
            keyword: 'Big-O Analysis',
            detail: 'Laptop ki speed par depend kiye bina ye measure karta hai ki data badhne par steps kitne badhenge.',
          },
          {
            keyword: 'Time vs Space',
            detail: 'Thodi extra RAM (Hash Map/Cache) use karke slow O(n) search ko instant O(1) banaya ja sakta hai.',
          },
        ],
        realLifeExample:
          'Instagram recent feed memory mein cache rakhta hai taaki scroll karte hi posts bina wait ke load ho jayein.',
        simplifiedAnalogy:
          'Recipe book ek Algorithm hai (exact cooking steps) aur aapka labeled masala dabba Data Structure hai.\nChahe recipe kitni bhi acchi ho, agar saare masale ek bade jar mein mix hon toh khana banana slow ho jayega.\nOrganized storage + clear steps hi software ko rocket speed dete hain.',
        subNodes: node.subNodes?.map((sub) =>
          sub.id === 'sub-big-o'
            ? {
                ...sub,
                title: 'Big-O Time Growth',
                shortSubtitle: 'O(1), O(log n), O(n), O(n²)',
                simplifiedAnalogy:
                  'Desk par rakha pehla card dekhna hamesha 1 second leta hai (O(1)).\nPoore box ke har card ko check karna box ke size ke saath badhta hai (O(n)).\nHar card ko baaki sabse compare karna bahut tezi se slow ho jata hai (O(n²)).',
              }
            : sub.id === 'sub-space-tradeoff'
              ? {
                  ...sub,
                  title: 'Time vs Space Balance',
                  shortSubtitle: 'Speed ke liye smart caching',
                  simplifiedAnalogy:
                    'Wi-Fi password desk par sticky note mein likhna thodi si jagah leta hai.\nPar badle mein har guest ke aane par router tak chalkar jaane ka time bach jata hai.\nThodi memory dekar instant speed paana hi Time-Space trade-off hai.',
                }
              : {
                  ...sub,
                  title: 'Best, Avg & Worst Case',
                  shortSubtitle: 'Peak traffic ke liye Big-O safety',
                  simplifiedAnalogy:
                    'Raat 3 baje ke khali traffic ke hisaab se airport nikloge toh flight miss ho jayegi.\nEngineers hamesha rush-hour worst case (Big-O) plan karte hain taaki app peak load par crash na ho.\nAmortized cost monthly metro pass jaisa hai—ek baar cost do, har ride sasti padti hai.',
                }
        ),
      };
    }
    if (node.id === 'types-of-ds') {
      return {
        ...node,
        title: 'Data Structures ke Types',
        shortSubtitle: 'Linear arrays/lists vs non-linear trees & graphs',
        keyPoints: [
          {
            keyword: 'Arrays & Linked Lists',
            detail: 'Arrays index se O(1) instant access dete hain; Linked Lists pointers se bina shift kiye insert kar lete hain.',
          },
          {
            keyword: 'Stacks & Queues',
            detail: 'LIFO Stack undo history aur function calls chalata hai; FIFO Queue fair task scheduling handle karta hai.',
          },
          {
            keyword: 'Hash Tables',
            detail: 'Key ko hash karke sidha bucket mein map karta hai—average O(1) lookup milta hai.',
          },
          {
            keyword: 'Trees & Graphs',
            detail: 'BST/Heaps sorted data O(log n) mein rakhte hain; Graphs complex networks aur routes model karte hain.',
          },
        ],
        simplifiedAnalogy:
          'Linear structures ek train ke dibbon ya plates ke stack jaise seedhe hote hain.\nNon-linear Trees aur Graphs ek family tree ya shehar ke metro map jaise branched hote hain.\nSahi shape choose karne se data bina poore scan ke turant mil jata hai.',
      };
    }
    if (node.id === 'common-algorithms') {
      return {
        ...node,
        title: 'Common Algorithms',
        shortSubtitle: 'Searching, sorting, BFS/DFS aur Dynamic Programming',
        keyPoints: [
          {
            keyword: 'Binary Search',
            detail: 'Sorted list ko har step par aadha kaat deta hai—10 lakh items mein sirf 20 steps lagte hain.',
          },
          {
            keyword: 'Merge & Quick Sort',
            detail: 'Divide-and-conquer se O(n log n) speed milti hai jo O(n²) bubble sort se kahin tezz hai.',
          },
          {
            keyword: 'BFS & DFS',
            detail: 'BFS layer-by-layer sabse chhota rasta nikalta hai; DFS ek branch ki gehrai tak jaata hai.',
          },
          {
            keyword: 'Dynamic Programming',
            detail: 'Repeat hone wale subproblems ka result save karke slow recursion ko super-fast bana deta hai.',
          },
        ],
        simplifiedAnalogy:
          'Binary Search dictionary ko seedha beech se kholne jaisa hai, page 1 se palatne ke bajay.\nHar guess par aadhi book turant eliminate ho jati hai.\nDynamic Programming rough sheet par answer note rakhne jaisa hai taaki wahi calculation dobara na karni pade.',
      };
    }
    return {
      ...node,
      title: 'Real Life Applications',
      shortSubtitle: 'GPS Maps, Database B-Trees aur Autocomplete Tries',
      keyPoints: [
        {
          keyword: 'GPS & Live Routing',
          detail: 'Google Maps roads ko weighted graph banakar Dijkstra/A* se sabse fast ETA nikalta hai.',
        },
        {
          keyword: 'Database Indexing',
          detail: 'PostgreSQL aur MySQL B+ Trees use karte hain taaki terabytes data mein row milliseconds mein mile.',
        },
        {
          keyword: 'Search Autocomplete',
          detail: 'Prefix Tries har typed letter par instant suggestions dikhate hain.',
        },
        {
          keyword: 'LRU Cache',
          detail: 'Hash Map + Doubly Linked List milkar CDNs ko O(1) cache hit aur cleanup dete hain.',
        },
      ],
      simplifiedAnalogy:
        'Jab bhi Google Maps aapko traffic jam se bachakar naya rasta dikhata hai, peeche weighted graphs chal rahe hote hain.\nJab phone typing complete karta hai, Prefix Tree har akshar ko milliseconds mein trace karta hai.\nYahi DSA primitives har modern app ko smooth banate hain.',
    };
  }),
  cheatSheet: {
    ...SAMPLE_DSA_LECTURE.cheatSheet,
    definitionsTitle: '01. Core Concepts (Hinglish)',
    comparisonTableTitle: '02. Time & Space Complexity Quick Table',
    examplesTitle: '03. Real-World Engineering Examples',
  },
};

/** Pre-seeded conversational Hindi (Devanagari) preview so switching is instant (0 API calls) */
export const SAMPLE_DSA_HINDI: LectureWorkspace = {
  ...SAMPLE_DSA_LECTURE,
  language: 'hi',
  title: 'डेटा स्ट्रक्चर और एल्गोरिदम (DSA)',
  videoCategory: 'ट्यूटोरियल',
  tldw: [
    'सही डेटा स्ट्रक्चर (Array, Hash Map, Tree, Graph) चुनना किसी भी सॉफ्टवेयर को तेज़ बनाने के लिए सबसे ज़रूरी कदम है।',
    'Big-O नोटेशन बताता है कि डेटा बढ़ने पर प्रोग्राम की रफ़्तार कैसे बदलती है—O(n²) से O(log n) पर आने से मिनटों का काम मिलीसेकंड में हो जाता है।',
    'असली ऐप्स में यही तकनीक चलती है: मैप्स में ग्राफ़, डेटाबेस में B+ Tree, और सर्च सुझावों में Prefix Trie।',
  ],
  nodes: SAMPLE_DSA_LECTURE.nodes.map((node) => {
    if (node.id === 'root') {
      return {
        ...node,
        title: 'डेटा स्ट्रक्चर और एल्गोरिदम',
        shortSubtitle: 'तेज़ और स्केलेबल सॉफ्टवेयर बनाने की असली नींव',
        keyPoints: [
          {
            keyword: 'मेमोरी की सही व्यवस्था',
            detail: 'डेटा स्ट्रक्चर तय करता है कि RAM में डेटा कैसे रखा जाए ताकि पढ़ना और बदलना आसान हो।',
          },
          {
            keyword: 'एल्गोरिदम की रफ़्तार',
            detail: 'सही स्टेप-बाय-स्टेप तरीका लाखों रिकॉर्ड होने पर भी ऐप को धीमा नहीं होने देता।',
          },
          {
            keyword: 'समय और जगह का संतुलन',
            detail: 'हर अच्छे सिस्टम में टाइम कॉम्प्लेक्सिटी और मेमोरी के बीच समझदारी से चुनाव किया जाता है।',
          },
          {
            keyword: 'प्रोडक्शन सिस्टम्स की नींव',
            detail: 'डेटाबेस, कंपाइलर, मैप्स राउटिंग और बड़े APIs सभी इसी सिद्धांत पर चलते हैं।',
          },
        ],
        realLifeExample:
          'बड़ी लाइब्रेरी में किताबों की अलमारियां डेटा स्ट्रक्चर हैं और किताब खोजने का सबसे तेज़ तरीका एल्गोरिदम है।',
        simplifiedAnalogy:
          'एक बड़ी लाइब्रेरी की कल्पना कीजिए: डेटा स्ट्रक्चर वह तरीका है जिससे अलमारियां और इंडेक्स कार्ड सजाए गए हैं।\nएल्गोरिदम वह सीधा रास्ता है जिसे अपनाकर आप सेकंडों में सही किताब निकाल लेते हैं।\nअगर सारी किताबें एक ढेर में पड़ी हों, तो सबसे समझदार व्यक्ति को भी घंटों लग जाएंगे।',
      };
    }
    if (node.id === 'what-is-dsa') {
      return {
        ...node,
        title: 'DS और Algo क्या है?',
        shortSubtitle: 'डेटा रखने के तरीके, स्टेप-बाय-स्टेप लॉजिक और Big-O',
        keyPoints: [
          {
            keyword: 'डेटा स्ट्रक्चर',
            detail: 'डेटा को व्यवस्थित रखने का खास तरीका जिससे खोज और बदलाव तुरंत हो सकें।',
          },
          {
            keyword: 'एल्गोरिदम',
            detail: 'किसी समस्या को सुलझाने के लिए स्पष्ट और सीमित चरणों का समूह।',
          },
          {
            keyword: 'Big-O विश्लेषण',
            detail: 'कंप्यूटर की स्पीड से अलग होकर यह मापता है कि डेटा बढ़ने पर कुल काम कितना बढ़ेगा।',
          },
          {
            keyword: 'टाइम बनाम स्पेस',
            detail: 'थोड़ी अतिरिक्त मेमोरी (कैश या हैश मैप) देकर धीमी खोज को तुरंत O(1) बनाया जा सकता है।',
          },
        ],
        simplifiedAnalogy:
          'खाना बनाने की रेसिपी एक एल्गोरिदम है और नाम लिखे हुए मसालों के डिब्बे डेटा स्ट्रक्चर हैं।\nअगर सारे मसाले एक ही बड़े डिब्बे में मिले हों तो बढ़िया रेसिपी भी बहुत समय लेगी।\nसही व्यवस्था और साफ निर्देश मिलकर हर काम को आसान बना देते हैं।',
      };
    }
    if (node.id === 'types-of-ds') {
      return {
        ...node,
        title: 'डेटा स्ट्रक्चर के प्रकार',
        shortSubtitle: 'लीनियर एरे/लिस्ट बनाम नॉन-लीनियर ट्री और ग्राफ़',
        keyPoints: [
          {
            keyword: 'एरे और लिंक्ड लिस्ट',
            detail: 'एरे नंबर से तुरंत O(1) एक्सेस देता है; लिंक्ड लिस्ट बीच में जोड़ना-हटाना आसान बनाती है।',
          },
          {
            keyword: 'स्टैक और क्यू',
            detail: 'स्टैक (LIFO) Undo हिस्ट्री चलाता है और क्यू (FIFO) काम की कतार को क्रम से पूरा करता है।',
          },
          {
            keyword: 'हैश टेबल',
            detail: 'किसी भी की (Key) को सीधे सही जगह मैप करके औसतन O(1) में परिणाम देता है।',
          },
          {
            keyword: 'ट्री और ग्राफ़',
            detail: 'ट्री डेटा को क्रम में रखता है और ग्राफ़ सड़कों या सोशल नेटवर्क के जुड़ाव को दर्शाता है।',
          },
        ],
        simplifiedAnalogy:
          'लीनियर स्ट्रक्चर ट्रेन के डिब्बों या प्लेटों के ढेर की तरह एक सीध में होते हैं।\nट्री और ग्राफ़ किसी परिवार के वंश वृक्ष या शहर के मेट्रो नक्शे की तरह आपस में जुड़े होते हैं।\nसही ढांचा चुनने से बिना पूरा डेटा पढ़े तुरंत सही जानकारी मिल जाती है।',
      };
    }
    if (node.id === 'common-algorithms') {
      return {
        ...node,
        title: 'प्रमुख एल्गोरिदम',
        shortSubtitle: 'बाइनरी सर्च, सॉर्टिंग, BFS/DFS और डायनामिक प्रोग्रामिंग',
        keyPoints: [
          {
            keyword: 'बाइनरी सर्च',
            detail: 'क्रमबद्ध डेटा को हर बार आधा करके 10 लाख में से कोई भी चीज़ सिर्फ़ 20 कदमों में ढूंढ लेता है।',
          },
          {
            keyword: 'मर्ज और क्विक सॉर्ट',
            detail: 'बड़े डेटा को हिस्सों में बांटकर O(n log n) की तेज़ गति से क्रम में लगाते हैं।',
          },
          {
            keyword: 'BFS और DFS',
            detail: 'BFS स्तर-दर-स्तर सबसे छोटा रास्ता खोजता है और DFS एक शाखा की गहराई तक जाता है।',
          },
          {
            keyword: 'डायनामिक प्रोग्रामिंग',
            detail: 'दोहराए जाने वाले उप-प्रश्नों के उत्तर सहेजकर कठिन गणना को बहुत तेज़ बना देती है।',
          },
        ],
        simplifiedAnalogy:
          'बाइनरी सर्च शब्दकोश को पहले पन्ने के बजाय सीधे बीच से खोलने जैसा है।\nहर एक कदम पर आधे गलत पन्ने एक साथ बाहर हो जाते हैं।\nडायनामिक प्रोग्रामिंग उत्तर नोट करके रखने जैसा है ताकि एक ही हिसाब बार-बार न करना पड़े।',
      };
    }
    return {
      ...node,
      title: 'असली जीवन में उपयोग',
      shortSubtitle: 'GPS मैप्स, डेटाबेस B+ Tree और सर्च ऑटोकम्प्लीट',
      keyPoints: [
        {
          keyword: 'GPS और सबसे छोटा रास्ता',
          detail: 'मैप्स ऐप्स सड़कों को ग्राफ़ मानकर Dijkstra और A* से ट्रैफिक के अनुसार सबसे तेज़ रास्ता निकालते हैं।',
        },
        {
          keyword: 'डेटाबेस इंडेक्सिंग',
          detail: 'PostgreSQL और MySQL करोड़ों रिकॉर्ड में से मिलीसेकंड में डेटा खोजने के लिए B+ Tree इस्तेमाल करते हैं।',
        },
        {
          keyword: 'सर्च ऑटोकम्प्लीट',
          detail: 'Prefix Trie हर अक्षर टाइप करते ही तुरंत सही शब्द सुझाता है।',
        },
        {
          keyword: 'LRU कैश',
          detail: 'हैश मैप और डबली लिंक्ड लिस्ट मिलकर वेबसाइट्स और CDN को सुपर-फास्ट रखते हैं।',
        },
      ],
      simplifiedAnalogy:
        'जब भी मैप ऐप आपको ट्रैफिक जाम से बचाकर नया रास्ता बताता है, तो पीछे ग्राफ़ एल्गोरिदम काम कर रहा होता है।\nजब फोन टाइप करते समय अगला शब्द सुझाता है, तो Prefix Tree हर अक्षर को मिलीसेकंड में मिलाता है।\nयही तकनीक रोज़मर्रा के हर बड़े ऐप को तेज़ बनाती है।',
    };
  }),
  cheatSheet: {
    ...SAMPLE_DSA_LECTURE.cheatSheet,
    definitionsTitle: '01. मुख्य परिभाषाएं',
    comparisonTableTitle: '02. टाइम और स्पेस कॉम्प्लेक्सिटी तालिका',
    examplesTitle: '03. असली इंजीनियरिंग उदाहरण',
  },
};

export const SAMPLE_DSA_BY_LANGUAGE: Record<LanguageCode, LectureWorkspace> = {
  en: SAMPLE_DSA_LECTURE,
  hi: SAMPLE_DSA_HINDI,
  hinglish: SAMPLE_DSA_HINGLISH,
};

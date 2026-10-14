// analytics.js — Personalization, Cognitive Weakness Tracking, and Gamification Engine

const ALL_BADGES = [
  {
    id: 'first_step',
    name: 'First Step',
    icon: '🌱',
    desc: 'Practiced your first problem with DSA Mentor'
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    icon: '🎯',
    desc: 'Practiced a problem with only Level 1 nudges'
  },
  {
    id: 'zero_hint',
    name: 'Zero-Hint Warrior',
    icon: '🛡️',
    desc: 'Debugged or checked complexity with zero hints requested'
  },
  {
    id: 'self_healer',
    name: 'Self-Healer',
    icon: '🐞',
    desc: 'Used AI Grounded Debugging to diagnose active code'
  },
  {
    id: 'complexity_master',
    name: 'Complexity Analyst',
    icon: '⏱️',
    desc: 'Analyzed asymptotic Time & Space complexity'
  },
  {
    id: 'pattern_scout',
    name: 'Pattern Scout',
    icon: '🧠',
    desc: 'Practiced problems across 3+ different algorithmic topics'
  },
  {
    id: 'streak_3',
    name: 'On Fire (3-Day Streak)',
    icon: '🔥',
    desc: 'Maintained a 3-day continuous practice streak'
  },
  {
    id: 'streak_7',
    name: 'Unstoppable (7-Day Streak)',
    icon: '⚡',
    desc: 'Maintained a 7-day continuous practice streak'
  }
]

const DEFAULT_STATS = {
  streakDays: 1,
  lastActiveDate: null,
  totalProblemsPracticed: 0,
  totalHintsRequested: 0,
  totalDebugRuns: 0,
  totalComplexityRuns: 0,
  totalExplains: 0,
  hintsByLevel: { '1': 0, '2': 0, '3': 0 },
  topics: {},
  problems: {},
  unlockedBadgeIds: []
}

function getTodayDateString() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function updateStreakDays(stats) {
  const today = getTodayDateString()
  if (!stats.lastActiveDate) {
    stats.streakDays = 1
    stats.lastActiveDate = today
    return
  }

  if (stats.lastActiveDate === today) {
    return
  }

  const lastDate = new Date(stats.lastActiveDate)
  const currDate = new Date(today)
  const diffTime = Math.abs(currDate - lastDate)
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 1) {
    stats.streakDays = (stats.streakDays || 0) + 1
  } else if (diffDays > 1) {
    stats.streakDays = 1
  }
  stats.lastActiveDate = today
}

function detectTopicFromProblem(title = '', desc = '') {
  const text = `${title} ${desc}`.toLowerCase()
  if (/two sum|three sum|two pointer|palindrome|container with most water|trapping rain/i.test(text)) return 'Two Pointers'
  if (/sliding window|substring|subarray with|longest substring|minimum window/i.test(text)) return 'Sliding Window'
  if (/binary tree|tree|inorder|preorder|postorder|lca|ancestor|bst/i.test(text)) return 'Trees & BST'
  if (/graph|bfs|dfs|island|connected component|dijkstra|cycle/i.test(text)) return 'Graphs'
  if (/dynamic programming|dp|knapsack|coin change|climbing stairs|longest common/i.test(text)) return 'Dynamic Programming'
  if (/binary search|search in rotated|first bad version|koko/i.test(text)) return 'Binary Search'
  if (/stack|parentheses|monotonic|daily temperatures|next greater/i.test(text)) return 'Stack'
  if (/heap|priority queue|kth largest|top k|merge k/i.test(text)) return 'Heap'
  if (/linked list|reverse list|cycle detection|merge two sorted lists/i.test(text)) return 'Linked List'
  if (/hash|map|set|frequency|anagram|duplicate/i.test(text)) return 'Hash Table'
  return 'Arrays & Strings'
}

function getStoredStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dsaMentorStats'], (res) => {
      const stats = Object.assign({}, DEFAULT_STATS, res.dsaMentorStats || {})
      stats.hintsByLevel = Object.assign({ '1': 0, '2': 0, '3': 0 }, stats.hintsByLevel || {})
      stats.topics = Object.assign({}, stats.topics || {})
      stats.problems = Object.assign({}, stats.problems || {})
      stats.unlockedBadgeIds = Array.isArray(stats.unlockedBadgeIds) ? stats.unlockedBadgeIds : []
      resolve(stats)
    })
  })
}

function saveStoredStats(stats) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ dsaMentorStats: stats }, () => resolve())
  })
}

async function recordInteraction({ problemTitle, difficulty, description, mode, hintLevel }) {
  const stats = await getStoredStats()
  const today = getTodayDateString()
  updateStreakDays(stats)

  const title = (problemTitle || 'Unknown Problem').trim()
  const topic = detectTopicFromProblem(title, description)

  // Track problem record
  if (!stats.problems[title]) {
    stats.problems[title] = {
      title,
      difficulty: difficulty || 'Unknown',
      topic,
      firstSeen: today,
      lastSeen: today,
      maxHintLevel: 0,
      hintsCount: 0,
      debugCount: 0,
      explainUsed: false
    }
    stats.totalProblemsPracticed++
  }

  const prob = stats.problems[title]
  prob.lastSeen = today

  // Track topic record
  if (!stats.topics[topic]) {
    stats.topics[topic] = { attempts: 0, hints: 0, debugs: 0 }
  }
  stats.topics[topic].attempts++

  // Update mode-specific stats
  if (mode === 'hint') {
    stats.totalHintsRequested++
    const lvl = String(hintLevel || 1)
    stats.hintsByLevel[lvl] = (stats.hintsByLevel[lvl] || 0) + 1
    prob.hintsCount = (prob.hintsCount || 0) + 1
    prob.maxHintLevel = Math.max(prob.maxHintLevel || 0, Number(lvl))
    stats.topics[topic].hints = (stats.topics[topic].hints || 0) + 1
  } else if (mode === 'debug') {
    stats.totalDebugRuns++
    prob.debugCount = (prob.debugCount || 0) + 1
    stats.topics[topic].debugs = (stats.topics[topic].debugs || 0) + 1
  } else if (mode === 'complexity') {
    stats.totalComplexityRuns++
  } else if (mode === 'explain') {
    stats.totalExplains++
    prob.explainUsed = true
  }

  // Check Badge Unlocks
  const newlyUnlocked = []
  function unlock(badgeId) {
    if (!stats.unlockedBadgeIds.includes(badgeId)) {
      stats.unlockedBadgeIds.push(badgeId)
      const bObj = ALL_BADGES.find(b => b.id === badgeId)
      if (bObj) newlyUnlocked.push(bObj)
    }
  }

  // 1. First Step
  if (stats.totalProblemsPracticed >= 1) unlock('first_step')

  // 2. Minimalist (used only level 1 hint on a problem)
  if (mode === 'hint' && prob.maxHintLevel === 1 && prob.hintsCount === 1) unlock('minimalist')

  // 3. Zero-Hint Warrior (ran debug or complexity without any hints on problem)
  if ((mode === 'debug' || mode === 'complexity') && (prob.hintsCount || 0) === 0) unlock('zero_hint')

  // 4. Self-Healer
  if (mode === 'debug') unlock('self_healer')

  // 5. Complexity Master
  if (mode === 'complexity') unlock('complexity_master')

  // 6. Pattern Scout (3+ topics)
  if (Object.keys(stats.topics).length >= 3) unlock('pattern_scout')

  // 7. Streaks
  if (stats.streakDays >= 3) unlock('streak_3')
  if (stats.streakDays >= 7) unlock('streak_7')

  await saveStoredStats(stats)
  return { stats, newlyUnlocked }
}

// Global exposure for content scripts and popup scripts
if (typeof window !== 'undefined') {
  window.DSAMentorAnalytics = {
    ALL_BADGES,
    DEFAULT_STATS,
    getStoredStats,
    saveStoredStats,
    recordInteraction,
    detectTopicFromProblem
  }
}

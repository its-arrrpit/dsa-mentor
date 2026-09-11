// content.js — runs on every leetcode.com/problems/* page

// ─── 1. Extract problem data from the DOM ────────────────────────────────────

function getProblemTitle() {
  return (
    document.querySelector('[data-cy="question-title"]')?.innerText ||
    document.querySelector('.text-title-large a')?.innerText ||
    document.querySelector('h4')?.innerText ||
    'Unknown Problem'
  ).trim()
}

function getProblemDescription() {
  return (
    document.querySelector('[data-key="description-content"]')?.innerText ||
    document.querySelector('.elfjS')?.innerText ||
    ''
  ).trim()
}

function getDifficulty() {
  return (
    document.querySelector('[diff]')?.innerText ||
    document.querySelector('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard')?.innerText ||
    'Unknown'
  ).trim()
}

async function getUserCodeAsync() {
  // 1. First try communicating with page-bridge.js (running in page context)
  const codeFromBridge = await new Promise((resolve) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        document.removeEventListener('dsa-response-code', onCode)
        resolve(null)
      }
    }, 300)

    const onCode = (e) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        document.removeEventListener('dsa-response-code', onCode)
        resolve(e.detail?.code || null)
      }
    }

    document.addEventListener('dsa-response-code', onCode)
    document.dispatchEvent(new CustomEvent('dsa-request-code'))
  })

  if (typeof codeFromBridge === 'string' && codeFromBridge.trim().length > 0) {
    return codeFromBridge
  }

  // 2. CodeMirror 6 fallback
  const cmView = document.querySelector('.cm-content')
  if (cmView && cmView.innerText.trim()) return cmView.innerText

  // 3. Monaco DOM viewport fallback
  const viewLines = document.querySelector('.view-lines')
  if (viewLines && viewLines.innerText.trim()) return viewLines.innerText

  return ''
}

function getLanguage() {
  return (
    document.querySelector('[data-mode-id]')?.getAttribute('data-mode-id') ||
    document.querySelector('.ant-select-selection-item')?.innerText ||
    'python'
  ).toLowerCase()
}

// ─── 2. Response Cache + Request State ───────────────────────────────────────
const responseCache = Object.create(null)
const inFlightByKey = Object.create(null)
const latestRequestByView = Object.create(null)
let requestCounter = 0
let currentMode = 'hint'
let currentHintLevel = 1

function normalizeCodeForKey(code) {
  return (code || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isProblemSolved() {
  const strongSelectors = [
    '[data-e2e-locator="submission-result"]',
    '[data-e2e-locator="submission-success"]',
    '[class*="submission"] [class*="success"]'
  ]

  for (const selector of strongSelectors) {
    const el = document.querySelector(selector)
    if (el && /accepted|success/i.test(el.innerText || '')) return true
  }

  // Check the problem header "Solved" badge near the title
  const titleEl = document.querySelector('[data-cy="question-title"]') ||
                  document.querySelector('.text-title-large') ||
                  document.querySelector('h4')
  if (titleEl) {
    const headerRow = titleEl.closest('.flex, .w-full, div')
    if (headerRow && /\bSolved\b/i.test(headerRow.innerText || '')) {
      return true
    }
  }

  const solvedBadge = document.querySelector('.text-olive, [class*="text-olive"], [class*="text-green-s"]')
  if (solvedBadge && /solved/i.test(solvedBadge.innerText || '')) {
    return true
  }

  return false
}

const hintsHistoryByProblem = Object.create(null)

async function getCurrentProblem() {
  const code = await getUserCodeAsync()
  return {
    title: getProblemTitle(),
    description: getProblemDescription(),
    difficulty: getDifficulty(),
    code,
    language: getLanguage(),
    solved: isProblemSolved(),
    normalizedCode: normalizeCodeForKey(code)
  }
}

function getViewKey(mode, hintLevel = 1) {
  return mode === 'hint' ? `hint:${hintLevel}` : mode
}

function getCacheKey(mode, hintLevel, problem) {
  const code = problem.normalizedCode || normalizeCodeForKey(problem.code)
  return mode === 'hint'
    ? `${problem.title}::hint::${hintLevel}::${code}`
    : `${problem.title}::${mode}::${code}`
}

function isCurrentView(mode, hintLevel = 1) {
  if (currentMode !== mode) return false
  if (mode !== 'hint') return true
  return currentHintLevel === hintLevel
}

// ─── 3. Inject Panel ─────────────────────────────────────────────────────────
function injectPanel() {
  if (document.getElementById('dsa-mentor-panel')) return

  // Google Fonts
  const fontLink = document.createElement('link')
  fontLink.rel = 'stylesheet'
  fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@600;700&display=swap'
  document.head.appendChild(fontLink)

  const panel = document.createElement('div')
  panel.id = 'dsa-mentor-panel'
  panel.innerHTML = `
    <button id="dsa-minimized-toggle" title="Open DSA Mentor">⚡</button>

    <div id="dsa-panel-main">
    <div id="dsa-header">
      <div id="dsa-logo">
        <span id="dsa-logo-icon">⚡</span>
        <span id="dsa-logo-text">DSA Mentor</span>
      </div>
      <button id="dsa-close">✕</button>
    </div>

    <div id="dsa-buttons">
      <button class="dsa-btn" data-mode="hint">
        <span class="btn-icon">💡</span>
        <span class="btn-label">Hint</span>
      </button>
      <button class="dsa-btn" data-mode="debug">
        <span class="btn-icon">🐞</span>
        <span class="btn-label">Debug</span>
      </button>
      <button class="dsa-btn" data-mode="complexity">
        <span class="btn-icon">📊</span>
        <span class="btn-label">Complexity</span>
      </button>
      <button class="dsa-btn" data-mode="explain">
        <span class="btn-icon">🧠</span>
        <span class="btn-label">Explain</span>
      </button>
    </div>

    <div id="dsa-output-box">
      <div id="dsa-output-inner">
        <span id="dsa-placeholder">Click a button to get started.</span>
      </div>
    </div>

    <div id="dsa-hint-footer" style="display:none">
      <div id="dsa-hint-dots">
        <span class="dot active" data-level="1"></span>
        <span class="dot" data-level="2"></span>
        <span class="dot" data-level="3"></span>
      </div>
      <button id="dsa-next-hint">Next hint →</button>
    </div>
    </div>
  `

  const style = document.createElement('style')
  style.textContent = `
    #dsa-mentor-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 320px;
      background: #0d0d0d;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 16px;
      z-index: 99999;
      font-family: 'Syne', sans-serif;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
      color: #e8e8e8;
    }
    #dsa-panel-main { display: block; }
    #dsa-minimized-toggle {
      display: none;
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: 1px solid #2a2a2a;
      background: #111;
      color: #7eb8f7;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 10px 26px rgba(0,0,0,0.5);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #dsa-minimized-toggle:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(0,0,0,0.6);
    }
    #dsa-mentor-panel.minimized {
      width: 56px;
      height: 56px;
      padding: 0;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #dsa-mentor-panel.minimized #dsa-panel-main {
      display: none;
    }
    #dsa-mentor-panel.minimized #dsa-minimized-toggle {
      display: block;
    }
    #dsa-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    #dsa-logo { display: flex; align-items: center; gap: 8px; }
    #dsa-logo-icon { font-size: 18px; }
    #dsa-logo-text {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.5px;
      background: linear-gradient(90deg, #f0f0f0, #888);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    #dsa-close {
      background: none;
      border: none;
      color: #555;
      font-size: 14px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
      transition: color 0.2s, background 0.2s;
    }
    #dsa-close:hover { color: #fff; background: #2a2a2a; }
    #dsa-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .dsa-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #161616;
      border: 1px solid #2a2a2a;
      color: #ccc;
      padding: 10px 12px;
      border-radius: 10px;
      cursor: pointer;
      font-family: 'Syne', sans-serif;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
      letter-spacing: 0.3px;
    }
    .dsa-btn:hover {
      background: #1e1e1e;
      border-color: #444;
      color: #fff;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .dsa-btn.active {
      background: #1a1a2e;
      border-color: #4a6fa5;
      color: #7eb8f7;
    }
    .btn-icon { font-size: 15px; }
    #dsa-output-box {
      background: #111;
      border: 1px solid #222;
      border-radius: 10px;
      min-height: 90px;
      max-height: 220px;
      overflow-y: auto;
      padding: 12px 14px;
    }
    #dsa-output-box::-webkit-scrollbar { width: 4px; }
    #dsa-output-box::-webkit-scrollbar-track { background: transparent; }
    #dsa-output-box::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
    #dsa-output-inner {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      line-height: 1.65;
      color: #d6d6d6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .dsa-big-o {
      font-family: 'JetBrains Mono', monospace;
      color: #93c5fd;
      background: rgba(147, 197, 253, 0.12);
      padding: 1px 6px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid rgba(147, 197, 253, 0.25);
    }
    .dsa-inline-code {
      font-family: 'JetBrains Mono', monospace;
      color: #fcd34d;
      background: rgba(251, 191, 36, 0.1);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 12px;
    }
    .dsa-code-block {
      background: #181818;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 6px 10px;
      margin: 8px 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #93c5fd;
      overflow-x: auto;
      white-space: pre;
    }
    .dsa-success-box {
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.35);
      border-radius: 8px;
      padding: 10px 12px;
      margin: 4px 0 8px 0;
      color: #86efac;
      font-family: 'Syne', sans-serif;
      font-size: 12.5px;
      line-height: 1.5;
    }
    .dsa-fail-box {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: 8px;
      padding: 10px 12px;
      margin: 4px 0 8px 0;
      color: #fca5a5;
      font-family: 'Syne', sans-serif;
      font-size: 12.5px;
      line-height: 1.5;
    }
    .dsa-stat-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .dsa-stat-label {
      font-weight: 700;
      color: #9ca3af;
      font-family: 'Syne', sans-serif;
      min-width: 65px;
    }
    .dsa-stat-val {
      color: #f3f4f6;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
    }
    #dsa-placeholder { color: #444; font-family: 'Syne', sans-serif; font-size: 13px; }
    #dsa-loading { display: flex; align-items: center; gap: 8px; color: #555; font-family: 'Syne', sans-serif; font-size: 13px; }
    .dsa-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #333;
      border-top-color: #7eb8f7;
      border-radius: 50%;
      animation: dsa-spin 0.8s linear infinite;
    }
    @keyframes dsa-spin { to { transform: rotate(360deg); } }
    #dsa-hint-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #1e1e1e;
    }
    #dsa-hint-dots { display: flex; gap: 6px; }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2a2a2a;
      border: 1px solid #333;
      transition: all 0.3s;
      cursor: pointer;
    }
    .dot.active {
      background: #7eb8f7;
      border-color: #7eb8f7;
      box-shadow: 0 0 6px rgba(126,184,247,0.5);
    }
    .dot.done { background: #3a5a3a; border-color: #4a8a4a; }
    #dsa-next-hint {
      background: none;
      border: 1px solid #2a2a2a;
      color: #7eb8f7;
      font-family: 'Syne', sans-serif;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      letter-spacing: 0.3px;
    }
    #dsa-next-hint:hover { background: #1a1a2e; border-color: #4a6fa5; }
    #dsa-next-hint:disabled { color: #333; border-color: #1e1e1e; cursor: not-allowed; }
  `
  document.head.appendChild(style)
  document.body.appendChild(panel)

  document.querySelectorAll('.dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const level = parseInt(dot.dataset.level)
      currentMode = 'hint'
      currentHintLevel = level
      updateDots(level)
      requestAI('hint', level)
    })
  })

  document.querySelectorAll('.dsa-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dsa-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')

      const mode = btn.dataset.mode
      currentMode = mode
      currentHintLevel = 1
      updateDots(1)

      document.querySelectorAll('.dot').forEach(d => d.classList.remove('done'))

      document.getElementById('dsa-hint-footer').style.display = mode === 'hint' ? 'flex' : 'none'

      const nextBtn = document.getElementById('dsa-next-hint')
      nextBtn.disabled = false
      nextBtn.textContent = 'Next hint →'

      requestAI(mode, currentHintLevel)
    })
  })

  document.getElementById('dsa-next-hint').addEventListener('click', () => {
    const nextHintMap = { 1: 2, 2: 3 }
    const nextLevel = nextHintMap[currentHintLevel]
    if (!nextLevel) return

    currentMode = 'hint'
    const currentDot = document.querySelector(`.dot[data-level="${currentHintLevel}"]`)
    if (currentDot) currentDot.classList.add('done')

    currentHintLevel = nextLevel
    updateDots(currentHintLevel)
    requestAI('hint', currentHintLevel)

    if (currentHintLevel === 3) {
      document.getElementById('dsa-next-hint').disabled = true
      document.getElementById('dsa-next-hint').textContent = 'Max hints reached'
    }
  })

  document.getElementById('dsa-close').addEventListener('click', () => {
    panel.classList.add('minimized')
  })

  document.getElementById('dsa-minimized-toggle').addEventListener('click', () => {
    panel.classList.remove('minimized')
  })

  panel.classList.add('minimized')
}


function updateDots(level) {
  document.querySelectorAll('.dot').forEach(dot => {
    dot.classList.remove('active')
    if (parseInt(dot.dataset.level) === level) dot.classList.add('active')
  })
}

function formatAIText(raw) {
  if (!raw) return ''
  let text = String(raw).trim()

  // 1. Convert code blocks ```java ... ``` or ``` ... ```
  text = text.replace(/```(?:[a-zA-Z]*)\r?\n?([\s\S]*?)```/g, '<pre class="dsa-code-block">$1</pre>')

  // 2. Convert LaTeX math syntax \( ... \) or \[ ... \]
  text = text.replace(/\\\[(.*?)\\\]/g, '$1')
  text = text.replace(/\\\((.*?)\\\)/g, '$1')

  // 3. Convert common powers: ^2 -> ², ^3 -> ³, ^k -> ᵏ
  text = text.replace(/\^2\b/g, '²')
  text = text.replace(/\^3\b/g, '³')
  text = text.replace(/\^k\b/g, 'ᵏ')

  // 4. Highlight Big-O notation cleanly: O(1), O(n), O(n²), O(log n), etc.
  text = text.replace(/\b(O\([a-zA-Z0-9²³ᵏ\s\*\+\-\/\^,]+\))/g, '<span class="dsa-big-o">$1</span>')

  // 5. Convert markdown bold **text** to <strong>
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // 6. Convert markdown inline code `code` to <code class="dsa-inline-code">
  text = text.replace(/`([^`]+)`/g, '<code class="dsa-inline-code">$1</code>')

  // 7. Format Complexity lines cleanly if present
  if (text.startsWith('Time:') || text.includes('\nTime:')) {
    text = text
      .replace(/(?:^|\n)Time:\s*(.*)/i, '<div class="dsa-stat-row"><span class="dsa-stat-label">⏱ Time:</span> <span class="dsa-stat-val">$1</span></div>')
      .replace(/(?:^|\n)Space:\s*(.*)/i, '<div class="dsa-stat-row"><span class="dsa-stat-label">💾 Space:</span> <span class="dsa-stat-val">$1</span></div>')
      .replace(/(?:^|\n)Optimal:\s*(.*)/i, '<div class="dsa-stat-row"><span class="dsa-stat-label">⚡ Optimal:</span> <span class="dsa-stat-val">$1</span></div>')
  }

  return text
}

function setOutput(text) {
  const inner = document.getElementById('dsa-output-inner')
  if (inner) {
    if (text && text.includes('id="dsa-loading"')) {
      inner.innerHTML = text
    } else {
      inner.innerHTML = formatAIText(text)
    }
  }
}

function setLoading() {
  setOutput(`<div id="dsa-loading"><div class="dsa-spinner"></div> Thinking...</div>`)
}

function getVisibleConsoleFeedback() {
  const bodyText = document.body ? (document.body.innerText || '') : ''

  if (bodyText.includes('Runtime Error')) {
    const match = bodyText.match(/Runtime Error[\s\S]*?(?=(?:Testcase|Test Result|\n\n\n\n)|$)/i)
    if (match) {
      return {
        type: 'ERROR',
        details: match[0].trim().slice(0, 700)
      }
    }
  }

  if (bodyText.includes('Compile Error')) {
    const match = bodyText.match(/Compile Error[\s\S]*?(?=(?:Testcase|Test Result|\n\n\n\n)|$)/i)
    if (match) {
      return {
        type: 'ERROR',
        details: match[0].trim().slice(0, 700)
      }
    }
  }

  if (bodyText.includes('Wrong Answer')) {
    const inputMatch = bodyText.match(/Input\s*[:=]?\s*\n+([\s\S]*?)(?=(?:\n\s*(?:Output|Expected|Stdout))|$)/i)
    const outputMatch = bodyText.match(/Output\s*[:=]?\s*\n+([\s\S]*?)(?=(?:\n\s*(?:Expected|Stdout))|$)/i)
    const expectedMatch = bodyText.match(/Expected\s*[:=]?\s*\n+([\s\S]*?)(?=(?:\n\s*(?:Stdout|Case))|$)/i)

    if (outputMatch && expectedMatch) {
      return {
        type: 'WRONG_ANSWER',
        input: inputMatch ? inputMatch[1].trim() : '',
        output: outputMatch ? outputMatch[1].trim() : '',
        expected: expectedMatch ? expectedMatch[1].trim() : ''
      }
    }
  }

  return null
}

async function requestAI(mode, hintLevel = 1) {
  if (isCurrentView(mode, hintLevel)) {
    if (mode === 'debug') {
      setOutput(`<div id="dsa-loading"><div class="dsa-spinner"></div> Reviewing code logic & tracing...</div>`)
    } else {
      setLoading()
    }
  }

  const problem = await getCurrentProblem()
  console.log('[DSA Mentor] Extracted Code (' + (problem.code ? problem.code.length : 0) + ' chars):\n' + problem.code)

  const consoleFeedback = mode === 'debug' ? getVisibleConsoleFeedback() : null
  console.log('[DSA Mentor] Detected Console Feedback:', consoleFeedback)

  const cacheKey = getCacheKey(mode, hintLevel, problem)
  const shouldUseCache = mode !== 'debug'

  if (shouldUseCache && responseCache[cacheKey]) {
    if (isCurrentView(mode, hintLevel)) {
      setOutput(responseCache[cacheKey])
    }
    return
  }

  const requestId = ++requestCounter
  const viewKey = getViewKey(mode, hintLevel)
  latestRequestByView[viewKey] = requestId

  const previousHintsForProblem = (mode === 'hint' && hintsHistoryByProblem[problem.title])
    ? { ...hintsHistoryByProblem[problem.title] }
    : {}

  const payload = {
    type: 'AI_REQUEST',
    mode,
    hintLevel,
    previousHints: previousHintsForProblem,
    consoleFeedback,
    problem: {
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      code: problem.code,
      language: problem.language,
      solved: problem.solved
    }
  }

  if (shouldUseCache && inFlightByKey[cacheKey]) {
    inFlightByKey[cacheKey].then((result) => {
      responseCache[cacheKey] = result
      if (latestRequestByView[viewKey] === requestId && isCurrentView(mode, hintLevel)) {
        setOutput(result)
      }
    }).catch((err) => {
      if (latestRequestByView[viewKey] === requestId && isCurrentView(mode, hintLevel)) {
        setOutput('Error: ' + err.message)
      }
    })
    return
  }

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    const msg = 'Extension was reloaded or disconnected. Please refresh this LeetCode tab (Press F5) to reconnect.'
    if (isCurrentView(mode, hintLevel)) {
      setOutput(msg)
    }
    return
  }

  const requestPromise = new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const isLatestForView = latestRequestByView[viewKey] === requestId

        if (chrome.runtime.lastError) {
          const err = new Error(chrome.runtime.lastError.message)
          if (shouldUseCache) delete inFlightByKey[cacheKey]
          if (isLatestForView && isCurrentView(mode, hintLevel)) {
            setOutput('Error: ' + err.message)
          }
          reject(err)
          return
        }

        const result = response?.result || 'No response received.'
        if (mode === 'hint' && result && !result.startsWith('Error:')) {
          if (!hintsHistoryByProblem[problem.title]) {
            hintsHistoryByProblem[problem.title] = {}
          }
          hintsHistoryByProblem[problem.title][hintLevel] = result
        }

        if (shouldUseCache) {
          responseCache[cacheKey] = result
          delete inFlightByKey[cacheKey]
        }

        if (isLatestForView && isCurrentView(mode, hintLevel)) {
          setOutput(result)
        }
        resolve(result)
      })
    } catch (err) {
      if (shouldUseCache) delete inFlightByKey[cacheKey]
      if (isCurrentView(mode, hintLevel)) {
        setOutput('Error: ' + err.message + '. Please refresh this LeetCode tab (F5).')
      }
      reject(err)
    }
  })

  if (shouldUseCache) {
    inFlightByKey[cacheKey] = requestPromise
  }
}


function waitForEditor() {
  const observer = new MutationObserver(() => {
    const editorLoaded = document.querySelector('.cm-content') || document.querySelector('.monaco-editor')
    const titleLoaded  = document.querySelector('[data-cy="question-title"]') || document.querySelector('.text-title-large')

    if (editorLoaded && titleLoaded) {
      observer.disconnect()
      injectPanel()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

waitForEditor()
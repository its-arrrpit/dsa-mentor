const express = require('express')
const cors = require('cors')
const axios = require('axios')

const app = express()
app.use(cors())
app.use(express.json())



async function getRAGContext(problem) {
  try {
    const response = await axios.post('http://localhost:5000/retrieve', {
      title: problem.title,
      description: problem.description,
      code: problem.code
    })
    return response.data.context
  } catch (err) {
    console.log('RAG server not reachable, skipping context.')
    return ''
  }
}


function stripCommentsForPrompt(code, language) {
  const src = code || ''
  const lang = (language || '').toLowerCase()

  // Python-style comments.
  if (lang.includes('python')) {
    return src
      .replace(/'''[\s\S]*?'''/g, '')
      .replace(/"""[\s\S]*?"""/g, '')
      .replace(/#.*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  // C/Java/JS-style comments.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeForMatch(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactForMatch(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function looksLikeBugClaim(text) {
  const s = (text || '').toLowerCase()
  if (!s) return false
  if (s.includes('no obvious bug')) return false
  return /(bug|issue|error|incorrect|fails|failure|out of bounds|null pointer|off by one)/.test(s)
}

function parseDebugResponse(raw) {
  const text = (raw || '').trim()

  const analysisMatch = text.match(/(?:^|\n)\*?\*?Analysis:\*?\*?\s*([\s\S]*?)(?=(?:\n\*?\*?Verdict:|$))/i)
  const verdictMatch = text.match(/(?:^|\n)\*?\*?Verdict:\*?\*?\s*(BUG_FOUND|NO_OBVIOUS_BUG)/i)
  const snippetMatch = text.match(/(?:^|\n)\*?\*?Snippet:\*?\*?\s*(.*?)(?=(?:\n\*?\*?Reason:|$))/i)
  const reasonMatch = text.match(/(?:^|\n)\*?\*?Reason:\*?\*?\s*([\s\S]*?)(?=(?:\n\*?\*?Test:|$))/i)
  const testMatch = text.match(/(?:^|\n)\*?\*?Test:\*?\*?\s*([\s\S]*)/i)

  const verdict = verdictMatch?.[1]
    ? verdictMatch[1].toUpperCase()
    : (/BUG_FOUND/i.test(text) ? 'BUG_FOUND' : (/NO_OBVIOUS_BUG/i.test(text) ? 'NO_OBVIOUS_BUG' : 'UNKNOWN'))

  return {
    analysis: (analysisMatch?.[1] || '').trim(),
    verdict,
    snippet: (snippetMatch?.[1] || '').trim().replace(/^`+|`+$/g, ''),
    reason: (reasonMatch?.[1] || '').trim(),
    test: (testMatch?.[1] || '').trim(),
    raw: text
  }
}

function finalizeDebugResponse(raw, originalCode) {
  let text = (raw || '').trim()

  const isBug = /Verdict:\s*BUG_FOUND|\bBUG_FOUND\b/i.test(text)
  const isSound = /Verdict:\s*NO_BUG|\bNO_BUG\b/i.test(text)

  text = text.replace(/^RESPONSE:\s*/i, '').trim()

  if (isBug) {
    if (!text.includes('⚠️')) {
      text = text.replace(/Verdict:\s*BUG_FOUND\s*/i, '⚠️ **Issue Detected**\n\n')
    }
  } else if (isSound) {
    if (!text.includes('✅')) {
      text = text.replace(/Verdict:\s*NO_BUG\s*/i, '✅ **Logic Looks Solid!**\n\n')
    }
  }

  return text
}

function buildPrompt(mode, problem, hintLevel, context, previousHints = {}, consoleFeedback = null) {
  const codeForPrompt = mode === 'debug'
    ? stripCommentsForPrompt(problem.code, problem.language)
    : (problem.code || '')
  const base = `
Problem: ${problem.title} (${problem.difficulty})
Language: ${problem.language}
Problem Statement: ${problem.description}
User's current code:
${codeForPrompt}
  `.trim()

  const ragSection = context ? `
--- Relevant DSA patterns ---
${context}
----------------------------
` : ''

  let previousHintsSection = ''
  if (mode === 'hint' && previousHints && Object.keys(previousHints).length > 0) {
    const lines = Object.entries(previousHints)
      .filter(([lvl, txt]) => Number(lvl) < hintLevel && txt)
      .map(([lvl, txt]) => `Level ${lvl} Hint: ${txt}`)
    if (lines.length > 0) {
      previousHintsSection = `
--- Previously revealed hints ---
${lines.join('\n\n')}
---------------------------------
`
    }
  }

  switch (mode) {
    case 'hint':
      const levelInstructions = {
        1: `State the general topic and why the naive/brute-force approach is too slow. 1-2 sentences max (under 25 words). Do NOT mention the optimal algorithm, data structure, or solution.`,
        2: `Ask a short, thought-provoking guiding question about the subproblem or bottleneck. 1-2 sentences max. Socratic prompt only. Do NOT give steps, pseudocode, or algorithm names.`,
        3: `Point the user toward the optimal concept or data structure in 1-2 sentences as a guiding clue (e.g. "Can we eliminate composites by pre-marking multiples?" or "Could a hash map provide O(1) complement lookups?").\nCRITICAL: Do NOT explain how the algorithm works step-by-step. Do NOT provide numbered steps (NO 1, 2, 3). Do NOT provide pseudocode or implementation recipes. Full algorithm walkthroughs are strictly reserved for the Explain feature.`
      }
      return `You are a Socratic DSA mentor giving hints. You NEVER reveal the solution or step-by-step algorithm in hints.

Strict Rules:
- NEVER give step-by-step numbered instructions (NO 1., 2., 3.).
- NEVER give pseudocode, code, or implementation algorithms.
- Maximum 2 sentences total.
- Keep it concise, Socratic, and focused on sparking an "aha" moment.

${ragSection}
${base}
${previousHintsSection}
Level ${hintLevel} instruction: ${levelInstructions[hintLevel] || levelInstructions[1]}

Concise 1-2 sentence hint:`

    case 'debug':
      if (consoleFeedback && consoleFeedback.type === 'ERROR') {
        return `You are an expert DSA mentor diagnosing an active execution error from LeetCode.
${base}

LeetCode Console Error:
${consoleFeedback.details}

Instructions:
1. Explain clearly in 1-2 sentences why this error happened and pinpoint the exact line in the user's code causing it.
2. State the fix directly without rewriting the full code solution.

RESPONSE:
⚠️ **Runtime Error Detected**
`
      }

      if (consoleFeedback && consoleFeedback.type === 'WRONG_ANSWER') {
        return `You are an expert DSA mentor diagnosing an active test failure from LeetCode.
${base}

LeetCode Failing Test Case:
- Input: ${consoleFeedback.input || 'sample test'}
- Actual Output: ${consoleFeedback.output || 'wrong output'}
- Expected Output: ${consoleFeedback.expected || 'expected output'}

Instructions:
1. Explain in 1-2 sentences why the code returned "${consoleFeedback.output}" instead of "${consoleFeedback.expected}" on input "${consoleFeedback.input}".
2. Pinpoint the exact line or variable causing this failure and explain how to fix it.

RESPONSE:
⚠️ **Failing Test Case**
`
      }

      return `You are a strict DSA code linter and debugger.
Problem: ${problem.title} (${problem.difficulty})
Language: ${problem.language}
Problem Statement: ${problem.description}
User's current code:
${codeForPrompt}

${ragSection}

TASK:
Examine the user's code line-by-line for syntax errors, boundary bugs, array bounds violations, or logic errors.

AUDIT CHECKLIST (Inspect before making any verdict):
1. Missing Return Statement (CRITICAL):
   - In Java, C++, and C#, if the method return type is non-void (e.g. int[], int, boolean, List, TreeNode, etc.) and all return statements are inside an 'if' condition or loop, the compiler will fail with "error: missing return statement".
   - If there is NO guaranteed fallback return statement outside the loops (or if the fallback return is commented out), Verdict MUST be: BUG_FOUND.
2. Array bounds & sizing:
   - Check every array allocation (e.g. new Type[N]). Valid indices are 0 to N - 1.
   - Check loop boundaries: does any loop index accessing an array iterate up to <= N instead of < N?
     If i <= n is used when indexing an array of size n, it WILL throw ArrayIndexOutOfBoundsException when i == n!
3. Problem constraints:
   - Does the loop check boundaries matching "strictly less than n" or off-by-one?
4. Uninitialized or incorrectly initialized variables.
5. If ANY bug, bounds crash, or logic flaw is found:
   - Verdict MUST be: BUG_FOUND
   - Quote the offending line and explain why it fails.
   - State the concise fix.
6. If and only if all array bounds, loops, returns, and logic are completely free of bugs:
   - Verdict: NO_BUG
   - State in 1-2 sentences why the implementation is sound.

Format:
Verdict: BUG_FOUND (or NO_BUG)
Explanation: <1-2 sentences pinpointing the exact line and issue, or stating why logic is sound>
Fix: <exact line change needed, or none if NO_BUG>

RESPONSE:`

    case 'complexity':
      return `Analyze complexity.

${base}

Respond in EXACTLY this format, nothing else:
Time: O(?) — reason
Space: O(?) — reason
Optimal: O(?) — if better exists

RESPONSE:`

    case 'explain':
      return `DSA mentor explaining optimal approach.

${ragSection}
${base}

Explain optimal approach for "${problem.title}" in 4-5 plain English steps.
No code. End with Time and Space complexity.

RESPONSE:`

    default:
      return base
  }
}

function hasMeaningfulAttempt(problem) {
  const language = (problem.language || '').toLowerCase()
  const userCode = problem.code || ''

  if (!userCode.trim()) return false

  let normalized = userCode
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  if (language.includes('java')) {
    normalized = normalized
      .replace(/class\s+ListNode\s*\{[\s\S]*?\n\}/g, '')
      .replace(/class\s+Solution\s*\{/g, '')
      .replace(/public\s+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{/g, '')
  }

  const placeholderReturns = [
    /^return\s+null\s*;?$/,
    /^return\s+0\s*;?$/,
    /^return\s+false\s*;?$/,
    /^return\s+head\s*;?$/,
    /^return\s+ans\s*;?$/,
    /^return\s+new\s+\w+\s*\[\s*0\s*\]\s*;?$/
  ]

  const noiseLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return true
    if (/^[{};]+$/.test(trimmed)) return true
    if (/^(public|private|protected)?\s*class\b/.test(trimmed)) return true
    if (/^(public|private|protected)?\s*[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{?$/.test(trimmed)) return true
    if (/^(int|long|float|double|char|boolean|String|ListNode)\s+\w+\s*;?$/.test(trimmed)) return true
    if (placeholderReturns.some((rx) => rx.test(trimmed))) return true
    return false
  }

  const meaningfulLines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !noiseLine(line))

  const denseText = meaningfulLines.join(' ').replace(/[^a-zA-Z0-9_]/g, '')
  return meaningfulLines.length >= 2 || denseText.length >= 18
}

function checkSyntaxPitfalls(code, language) {
  const lang = (language || '').toLowerCase()
  const src = code || ''

  if (lang.includes('java') || lang.includes('cpp') || lang.includes('c') || lang.includes('javascript') || lang.includes('typescript')) {
    // 1. Stray dot before semicolon: e.g. "count.;"
    const dotSemiMatch = src.match(/([a-zA-Z0-9_]+)\s*\.\s*;/m)
    if (dotSemiMatch) {
      return `⚠️ **Syntax Error Detected**\n\nStray period \`.\` before semicolon in \`${dotSemiMatch[0]}\`.\n\n**Fix:** Change \`${dotSemiMatch[0]}\` to \`${dotSemiMatch[1]};\`.`
    }

    // 2. Mismatched curly braces
    const openBraces = (src.match(/\{/g) || []).length
    const closeBraces = (src.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      return `⚠️ **Syntax Error Detected**\n\nMismatched curly braces in your code (${openBraces} opening \`{\` vs ${closeBraces} closing \`}\`).`
    }

    // 3. Missing array brackets in Java: e.g. "new int{}" instead of "new int[]{}"
    if (lang.includes('java')) {
      const missingBracketsMatch = src.match(/new\s+(int|long|boolean|char|double|float|byte|short|String)\s*\{([^}]*)\}/)
      if (missingBracketsMatch) {
        return `⚠️ **Syntax Error Detected**\n\nInvalid array instantiation \`${missingBracketsMatch[0]}\` (missing array brackets \`[]\`).\n\n**Fix:** Change to \`new ${missingBracketsMatch[1]}[]{${missingBracketsMatch[2]}}\`.`
      }
    }

    // 4. Missing semicolon on statements (Java, C, C++, JS, TS)
    const lines = src.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line) continue

      // Ignore comments, preprocessor directives, and annotations
      if (line.startsWith('/*') || line.startsWith('*') || line.startsWith('#') || line.startsWith('@')) continue

      // Ignore block openers, colons (labels/cases), or commas (multi-line declarations)
      if (/[{:,]$/.test(line)) continue

      // Ignore lines that are just closing braces
      if (/^}+$/.test(line)) continue

      // Ignore control flow headers
      if (/^(if|else if|else|for|while|do|switch|case|default|try|catch|finally)\b/.test(line)) continue

      // Ignore class/interface/enum headers
      if (/^(public|private|protected)?\s*(static\s+)?(final\s+)?(class|interface|enum)\b/.test(line)) continue

      // Ignore method definition headers (e.g. public int[] twoSum(...) without { on same line)
      if (/^(public|private|protected)?\s*[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*$/.test(line)) continue

      // If line does not end with semicolon, verify if it is an active statement line
      if (!line.endsWith(';')) {
        if (/^return\b/.test(line) || /[a-zA-Z0-9_")'\]\+\-]$/.test(line)) {
          return `⚠️ **Syntax Error Detected**\n\nMissing semicolon \`;\` on line ${i + 1}:\n\`${line}\`\n\n**Fix:** Add \`;\` at the end of the line: \`${line};\`.`
        }
      }
    }

    // 4. Missing return statement in non-void Java / C++ methods
    if (lang.includes('java') || lang.includes('cpp')) {
      const nonVoidMethod = src.match(/(?:public|private|protected)?\s*(?:static\s+)?(int\[\]|int|boolean|String|List<[\w<>]+>|ListNode|TreeNode|vector<[\w<>]+>)\s+(\w+)\s*\([^)]*\)\s*\{/m)
      if (nonVoidMethod) {
        const returnType = nonVoidMethod[1]
        const methodName = nonVoidMethod[2]
        const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        const hasReturnBeforeMethodEnd = /return\s+[^;]+;\s*\}\s*(\}\s*)?$/.test(clean.trim())
        if (!hasReturnBeforeMethodEnd && !clean.includes('throw ')) {
          if (/for\s*\(|while\s*\(|if\s*\(/.test(clean)) {
            const hasCommentedReturn = /\/\/\s*return\b/.test(src)
            return `⚠️ **Compile Error Detected**\n\nMissing return statement in method \`${methodName}\`${hasCommentedReturn ? ' (the fallback return statement is commented out)' : ''}. In Java, a non-void method (\`${returnType}\`) must guarantee a return on all execution paths.\n\n**Fix:** Add an active fallback return statement at the end of \`${methodName}\` (e.g. \`return new ${returnType}{};\`).`
          }
        }
      }
    }
  }

  return null
}

const GEMINI_CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
]

async function callSingleGeminiModel({ prompt, apiKey, model, maxTokens = 2048 }) {
  const cleanModel = model.trim()
  const cleanKey = apiKey.trim()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${cleanKey}`

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: Math.max(maxTokens, 2048)
    }
  }

  if (cleanModel.includes('2.5')) {
    requestBody.generationConfig.thinkingConfig = {
      thinkingBudget: 0
    }
  }

  let response
  try {
    response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    })
  } catch (err) {
    if (requestBody.generationConfig.thinkingConfig && err.response?.status === 400) {
      delete requestBody.generationConfig.thinkingConfig
      requestBody.generationConfig.maxOutputTokens = 4096
      response = await axios.post(url, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      })
    } else {
      throw err
    }
  }

  const candidate = response.data?.candidates?.[0]
  if (!candidate || !candidate.content?.parts) {
    if (candidate?.finishReason === 'SAFETY') {
      return 'Response was flagged by Gemini safety filters. Please try rephrasing.'
    }
    return 'No response generated by Gemini.'
  }

  const answerParts = candidate.content.parts.filter(p => !p.thought && p.text)
  const resultText = answerParts.map(p => p.text).join('\n').trim()

  return resultText || (candidate.content.parts[0]?.text || 'No response generated.')
}

async function callGemini({ prompt, apiKey, requestedModel, maxTokens = 2048 }) {
  const cleanKey = (apiKey || '').trim()
  if (!cleanKey) {
    throw new Error('Gemini API key is required.')
  }

  let modelsToTry = requestedModel ? [requestedModel] : []
  try {
    const listRes = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, { timeout: 10000 })
    const valid = (listRes.data?.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))

    if (valid.length > 0) {
      const flashModels = valid.filter(m => m.includes('flash'))
      const otherModels = valid.filter(m => !m.includes('flash'))
      modelsToTry = [...new Set([...modelsToTry, ...flashModels, ...otherModels])]
    }
  } catch (listErr) {
    console.log('[GEMINI] Could not list models, using fallback list:', listErr.message)
    modelsToTry = [...new Set([...modelsToTry, ...GEMINI_CANDIDATE_MODELS])]
  }

  let lastError = null
  for (const model of modelsToTry) {
    try {
      console.log(`[GEMINI] Trying model: ${model}...`)
      const res = await callSingleGeminiModel({ prompt, apiKey: cleanKey, model, maxTokens })
      console.log(`[GEMINI] Model ${model} succeeded ✓`)
      return res
    } catch (err) {
      lastError = err
      const status = err.response?.status
      const msg = err.response?.data?.error?.message || err.message
      console.log(`[GEMINI] Model ${model} failed (${status || 'error'}): ${msg}`)

      if (status === 400 && msg.toLowerCase().includes('api key')) {
        throw err
      }
      continue
    }
  }

  throw lastError || new Error('All candidate Gemini models failed.')
}

async function callOllama({ prompt, url = 'http://localhost:11434', model = 'qwen2.5-coder:7b', maxTokens = 500 }) {
  const cleanUrl = (url || 'http://localhost:11434').replace(/\/+$/, '')
  const response = await axios.post(
    `${cleanUrl}/api/generate`,
    {
      model: model || 'qwen2.5-coder:7b',
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: maxTokens,
        stop: ["\n\n\n\n", "User:", "Human:"]
      }
    },
    { timeout: 60000 }
  )

  return response.data?.response || ''
}

app.post('/api/test-connection', async (req, res) => {
  const { provider = 'gemini', geminiApiKey, geminiModel, ollamaUrl } = req.body
  if (provider === 'gemini') {
    const key = (geminiApiKey || process.env.GEMINI_API_KEY || '').trim()
    if (!key) return res.status(400).json({ ok: false, error: 'Gemini API key is required' })
    try {
      await callGemini({
        prompt: 'Respond with OK',
        apiKey: key,
        model: geminiModel || 'gemini-1.5-flash',
        maxTokens: 5
      })
      return res.json({ ok: true, message: 'Gemini connected successfully!' })
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message
      return res.status(400).json({ ok: false, error: msg })
    }
  } else {
    try {
      const url = (ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '')
      await axios.get(`${url}/api/tags`, { timeout: 5000 })
      return res.json({ ok: true, message: 'Ollama is reachable!' })
    } catch (err) {
      return res.status(400).json({ ok: false, error: `Could not reach Ollama: ${err.message}` })
    }
  }
})

app.post('/api/ask', async (req, res) => {
  const {
    provider = 'gemini',
    geminiApiKey,
    geminiModel = 'gemini-2.5-flash',
    ollamaUrl = 'http://localhost:11434',
    ollamaModel = 'qwen2.5-coder:7b',
    autoFallback = true,
    mode,
    hintLevel = 1,
    problem,
    previousHints = {},
    consoleFeedback
  } = req.body

  const safeHintLevel = Math.min(Math.max(parseInt(hintLevel, 10) || 1, 1), 3)

  console.log(`[${mode.toUpperCase()} via ${provider.toUpperCase()}] ${problem?.title || 'Unknown'} — level ${safeHintLevel} (code: ${problem?.code?.length || 0} chars)${consoleFeedback ? ` (ConsoleFeedback: ${consoleFeedback.type})` : ''}`)
  if (consoleFeedback) {
    console.log('[DEBUG CONSOLE FEEDBACK]:', consoleFeedback.details ? consoleFeedback.details.slice(0, 150) : consoleFeedback)
  }
  if (mode === 'debug') {
    console.log('--- USER CODE RECEIVED ---')
    console.log(problem?.code)
    console.log('---------------------------')
  }

  if (!problem) {
    return res.status(400).json({ result: 'Missing problem data.' })
  }

  if (mode === 'debug') {
    if (!hasMeaningfulAttempt(problem)) {
      return res.json({
        result: 'I cannot debug yet. Write a first attempt, then click Debug again.'
      })
    }
    const syntaxErr = checkSyntaxPitfalls(problem.code, problem.language)
    if (syntaxErr) {
      console.log('[DEBUG] Syntax pitfall caught:\n', syntaxErr)
      return res.json({ result: syntaxErr })
    }
  }

  const context = await getRAGContext(problem)
  if (context) console.log('RAG context retrieved ✓')

  const prompt = buildPrompt(mode, problem, safeHintLevel, context, previousHints, consoleFeedback)

  const tokenLimits = {
    hint: 120,
    debug: 600,
    explain: 800,
    complexity: 250
  }
  const maxTokens = tokenLimits[mode] || 300

  let rawResult = ''
  const effectiveGeminiKey = (geminiApiKey || process.env.GEMINI_API_KEY || '').trim()

  if (provider === 'gemini') {
    if (!effectiveGeminiKey) {
      return res.json({
        result: '⚠️ **Gemini API Key Missing**\n\nPlease click the DSA Mentor icon in your browser toolbar to enter your free Gemini API key.'
      })
    }

    try {
      rawResult = await callGemini({
        prompt,
        apiKey: effectiveGeminiKey,
        model: geminiModel,
        maxTokens
      })
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message
      console.error('[GEMINI ERROR]:', errorMsg)

      if (autoFallback) {
        console.log('[FALLBACK] Trying Ollama as fallback...')
        try {
          rawResult = await callOllama({
            prompt,
            url: ollamaUrl,
            model: ollamaModel,
            maxTokens
          })
          console.log('[FALLBACK] Ollama fallback succeeded ✓')
        } catch (ollamaErr) {
          if (err.response?.status === 400 && errorMsg.toLowerCase().includes('api key')) {
            return res.json({
              result: '❌ **Invalid Gemini API Key.** Please verify your key in the extension popup.'
            })
          }
          if (err.response?.status === 429) {
            return res.json({
              result: '⏳ **Gemini Rate Limit Exceeded.** Please wait a few seconds and try again.'
            })
          }
          return res.json({
            result: `⚠️ **Gemini Error:** ${errorMsg}\n(Ollama fallback also unreachable)`
          })
        }
      } else {
        if (err.response?.status === 400 && errorMsg.toLowerCase().includes('api key')) {
          return res.json({
            result: '❌ **Invalid Gemini API Key.** Please verify your key in the extension popup.'
          })
        }
        if (err.response?.status === 429) {
          return res.json({
            result: '⏳ **Gemini Rate Limit Exceeded.** Please wait a few seconds and try again.'
          })
        }
        return res.json({
          result: `⚠️ **Gemini API Error:** ${errorMsg}`
        })
      }
    }
  } else {
    // Ollama primary
    try {
      rawResult = await callOllama({
        prompt,
        url: ollamaUrl,
        model: ollamaModel,
        maxTokens
      })
    } catch (err) {
      console.error('Ollama error:', err.message)

      if (autoFallback && effectiveGeminiKey) {
        console.log('[FALLBACK] Ollama unreachable, falling back to Gemini...')
        try {
          rawResult = await callGemini({
            prompt,
            apiKey: effectiveGeminiKey,
            model: geminiModel,
            maxTokens
          })
          console.log('[FALLBACK] Gemini fallback succeeded ✓')
        } catch (geminiErr) {
          return res.json({
            result: `Could not reach Ollama at ${ollamaUrl}, and Gemini fallback failed: ${geminiErr.message}`
          })
        }
      } else {
        return res.json({
          result: `⚠️ **Could not reach Ollama.**\nMake sure Ollama is running at \`${ollamaUrl}\`, or open the extension popup and switch to **Gemini** for instant cloud inference.`
        })
      }
    }
  }

  if (mode === 'debug') {
    const finalResult = finalizeDebugResponse(rawResult, problem.code || '')
    console.log('[DEBUG FINAL RESULT]:\n', finalResult)
    return res.json({ result: finalResult })
  }

  res.json({ result: rawResult })
})

app.listen(3000, () => console.log('DSA Mentor backend running on http://localhost:3000'))
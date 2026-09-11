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
1. Array bounds & sizing:
   - Check every array allocation (e.g. new Type[N]). Valid indices are 0 to N - 1.
   - Check loop boundaries: does any loop index accessing an array iterate up to <= N instead of < N?
     If i <= n is used when indexing an array of size n, it WILL throw ArrayIndexOutOfBoundsException when i == n!
2. Problem constraints:
   - Does the loop check boundaries matching "strictly less than n" or off-by-one?
3. Uninitialized or incorrectly initialized variables.
4. If ANY bug, bounds crash, or logic flaw is found:
   - Verdict MUST be: BUG_FOUND
   - Quote the offending line and explain why it fails.
   - State the concise fix.
5. If and only if all array bounds, loops, and logic are completely free of bugs:
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

    // 2. Missing semicolon on return: e.g. "return count\n"
    const missingSemiMatch = src.match(/return\s+([a-zA-Z0-9_]+)\s*(?=\r?\n\s*\}|$)/m)
    if (missingSemiMatch) {
      const fullLine = src.match(new RegExp(`return\\s+${missingSemiMatch[1]}\\s*([^;\\r\\n]*)`, 'm'))
      if (fullLine && !fullLine[0].includes(';')) {
        return `⚠️ **Syntax Error Detected**\n\nMissing semicolon \`;\` on return statement: \`${fullLine[0].trim()}\`.\n\n**Fix:** Change to \`return ${missingSemiMatch[1]};\`.`
      }
    }

    // 3. Mismatched curly braces
    const openBraces = (src.match(/\{/g) || []).length
    const closeBraces = (src.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      return `⚠️ **Syntax Error Detected**\n\nMismatched curly braces in your code (${openBraces} opening \`{\` vs ${closeBraces} closing \`}\`).`
    }
  }

  return null
}

app.post('/api/ask', async (req, res) => {
  const { mode, hintLevel = 1, problem, previousHints = {}, consoleFeedback } = req.body
  const safeHintLevel = Math.min(Math.max(parseInt(hintLevel, 10) || 1, 1), 3)

  console.log(`[${mode.toUpperCase()}] ${problem?.title || 'Unknown'} — level ${safeHintLevel} (code: ${problem?.code?.length || 0} chars)${consoleFeedback ? ` (ConsoleFeedback: ${consoleFeedback.type})` : ''}`)
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
    hint: 95,
    debug: 500,
    explain: 700,
    complexity: 200
  }
  const maxTokens = tokenLimits[mode] || 250

  try {
    const response = await axios.post('http://localhost:11434/api/generate', {
      // model: 'llama3.1',
      // model: 'deepseek-coder',
      model: 'qwen2.5-coder:7b',
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: maxTokens,
        stop: ["\n\n\n\n", "User:", "Human:"]
      }
    }, { timeout: 60000 })

    const rawResult = response.data.response || ''
    if (mode === 'debug') {
      const finalResult = finalizeDebugResponse(rawResult, problem.code || '')
      console.log('[DEBUG FINAL RESULT]:\n', finalResult)
      return res.json({ result: finalResult })
    }

    res.json({ result: rawResult })

  } catch (err) {
    console.error('Ollama error:', err.message)
    res.status(500).json({
      result: 'Could not reach Ollama. Make sure it is running.'
    })
  }
})

app.listen(3000, () => console.log('DSA Mentor backend running on http://localhost:3000'))
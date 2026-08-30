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
  const verdict = /Verdict:\s*BUG_FOUND/i.test(text)
    ? 'BUG_FOUND'
    : (/Verdict:\s*NO_OBVIOUS_BUG/i.test(text) ? 'NO_OBVIOUS_BUG' : 'UNKNOWN')

  const snippetMatch = text.match(/Snippet:\s*(.*)/i)
  const reasonMatch = text.match(/Reason:\s*(.*)/i)
  const testMatch = text.match(/Test:\s*(.*)/i)

  return {
    verdict,
    snippet: (snippetMatch?.[1] || '').trim(),
    reason: (reasonMatch?.[1] || '').trim(),
    test: (testMatch?.[1] || '').trim(),
    raw: text
  }
}

function finalizeDebugResponse(raw, originalCode) {
  const parsed = parseDebugResponse(raw)
  const code = normalizeForMatch(originalCode)
  const snippet = normalizeForMatch(parsed.snippet)
  const snippetIsGrounded = snippet && snippet !== 'NA' && (
    code.includes(snippet) || compactForMatch(code).includes(compactForMatch(snippet))
  )

  if (parsed.verdict === 'BUG_FOUND' && snippetIsGrounded) {
    const reason = parsed.reason || 'Likely logic bug around the snippet.'
    const test = parsed.test || 'Try a boundary input to verify this path.'
    return `Possible bug near: ${parsed.snippet}\nWhy: ${reason}\nCheck with: ${test}`
  }

  
  if (parsed.verdict === 'BUG_FOUND' && (looksLikeBugClaim(parsed.reason) || looksLikeBugClaim(parsed.raw))) {
    const fallbackSnippet = (parsed.snippet && parsed.snippet !== 'NA') ? parsed.snippet : 'the loop/condition logic'
    const reason = parsed.reason || 'Likely logic issue in the current approach.'
    const test = parsed.test || 'Try a small edge case and trace pointer/index updates.'
    return `Possible bug near: ${fallbackSnippet}\nWhy: ${reason}\nCheck with: ${test}`
  }

  
  if (parsed.verdict === 'UNKNOWN' && looksLikeBugClaim(parsed.raw)) {
    const firstLine = parsed.raw.split(/\r?\n/).find((line) => line.trim()) || 'Potential logic issue found.'
    return `Possible bug near: the current implementation\nWhy: ${firstLine.trim()}\nCheck with: Try one minimal edge case and one boundary case.`
  }

  const safeTest = parsed.test || 'Try edge cases like smallest input, max input, and repeated values.'
  return `No obvious bug found in current attempt. ${safeTest}`
}

function buildPrompt(mode, problem, hintLevel, context) {
  const solvedTag = problem.solved ? 'yes' : 'no'
  const codeForPrompt = mode === 'debug'
    ? stripCommentsForPrompt(problem.code, problem.language)
    : (problem.code || '')
  const base = `
Problem: ${problem.title} (${problem.difficulty})
Language: ${problem.language}
Problem solved/accepted in UI: ${solvedTag}
Problem statement: ${problem.description}
User's current code:
${codeForPrompt}
  `.trim()

  const ragSection = context ? `
--- Relevant DSA patterns ---
${context}
----------------------------
` : ''

  switch (mode) {
    case 'hint':
      const levelInstructions = {
        1: `ONE sentence only. Max 8 words. Just name the pattern or data structure.`,
        2: `Elaborate on hint 1. Explain WHY this pattern works for this problem. 2-3 sentences. No pseudocode, no code.`,
        3: `Build on hint 2. Give 3-4 numbered pseudocode steps showing HOW to implement the approach. No actual code syntax.`,
        4: `Give the most specific and targeted hint possible. Point out the exact key step or condition that makes this problem click — the "aha moment". Be very precise. Do NOT give pseudocode or code. 2-3 sentences max.`
      }
      return `DSA mentor. No full solutions. No filler. Just the hint.

${ragSection}
${base}

Level ${hintLevel} hint: ${levelInstructions[hintLevel]}

HINT:`

    case 'debug':
      return `DSA mentor helping debug.

${base}

Rules:
- Ground your answer in the provided code only.
- Use the FULL problem statement and FULL user code context.
- Quote the exact code snippet that is suspicious.
- Mention where the issue is (loop/condition/return block) in plain words.
- If there is a likely bug, explain why it fails on a concrete input.
- If no obvious bug, mark verdict as NO_OBVIOUS_BUG.
- Do NOT provide full corrected code.
- Keep it concise.

Respond in EXACT format:
Verdict: BUG_FOUND or NO_OBVIOUS_BUG
Snippet: <exact code snippet from user code, or NA>
Reason: <one short sentence>
Test: <one short test input or edge-case question>

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

app.post('/api/ask', async (req, res) => {
  const { mode, hintLevel, problem } = req.body
  const effectiveHintLevel = (mode === 'hint' && hintLevel === 3) ? 4 : hintLevel

  console.log(`[${mode.toUpperCase()}] ${problem.title} — level ${effectiveHintLevel}`)

  if (mode === 'debug' && !hasMeaningfulAttempt(problem)) {
    return res.json({
      result: 'I cannot debug yet. Write a first attempt, then click Debug again.'
    })
  }

  const context = await getRAGContext(problem)
  if (context) console.log('RAG context retrieved ✓')

  const prompt = buildPrompt(mode, problem, effectiveHintLevel, context)

  const maxTokens = mode === 'debug'
    ? 260
    : ((mode === 'explain' || mode === 'complexity') ? 250 : 80)

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
        stop: ["\n\n\n", "Note:", "Example:", "Here is"]
      }
    }, { timeout: 60000 })

    const rawResult = response.data.response || ''
    if (mode === 'debug') {
      return res.json({ result: finalizeDebugResponse(rawResult, problem.code || '') })
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
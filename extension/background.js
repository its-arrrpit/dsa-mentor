chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AI_REQUEST') {
    chrome.storage.local.get([
      'aiProvider',
      'geminiApiKey',
      'geminiModel',
      'ollamaUrl',
      'ollamaModel',
      'autoFallback'
    ], (settings) => {
      const provider = settings.aiProvider || 'gemini'
      const geminiApiKey = (settings.geminiApiKey || '').trim()

      if (provider === 'gemini' && !geminiApiKey) {
        sendResponse({
          result: '⚠️ **Gemini API key not configured**\n\nPlease click the **DSA Mentor icon** in your browser toolbar, paste your free Gemini API key, and click **Save Settings**.'
        })
        return
      }

      fetch('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          geminiApiKey,
          geminiModel: settings.geminiModel || 'gemini-1.5-flash',
          ollamaUrl: settings.ollamaUrl || 'http://localhost:11434',
          ollamaModel: settings.ollamaModel || 'qwen2.5-coder:7b',
          autoFallback: typeof settings.autoFallback === 'boolean' ? settings.autoFallback : true,
          mode: msg.mode,
          hintLevel: msg.hintLevel,
          previousHints: msg.previousHints,
          consoleFeedback: msg.consoleFeedback,
          testResult: msg.testResult,
          problem: msg.problem
        })
      })
      .then(r => r.json())
      .then(data => sendResponse({ result: data.result }))
      .catch(err => {
        sendResponse({
          result: `⚠️ **Backend Server Offline**\n\nCould not connect to the DSA Mentor backend (\`http://localhost:3000\`).\nMake sure \`node server.js\` is running in your terminal.`
        })
      })
    })

    return true
  }
})
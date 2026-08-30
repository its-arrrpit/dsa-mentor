chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AI_REQUEST') {
    
    fetch('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: msg.mode,
        hintLevel: msg.hintLevel,
        problem: msg.problem
      })
    })
    .then(r => r.json())
    .then(data => sendResponse({ result: data.result }))
    .catch(err => sendResponse({ result: 'Backend error: ' + err.message }))

    return true
  }
})
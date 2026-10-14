document.addEventListener('DOMContentLoaded', () => {
  const radioGemini = document.getElementById('radio-gemini')
  const radioOllama = document.getElementById('radio-ollama')
  const cardGemini = document.getElementById('card-gemini')
  const cardOllama = document.getElementById('card-ollama')

  const geminiConfig = document.getElementById('gemini-config')
  const ollamaConfig = document.getElementById('ollama-config')

  const geminiApiKey = document.getElementById('geminiApiKey')
  const geminiModel = document.getElementById('geminiModel')
  const toggleApiKey = document.getElementById('toggleApiKey')

  const ollamaUrl = document.getElementById('ollamaUrl')
  const ollamaModel = document.getElementById('ollamaModel')

  const autoFallback = document.getElementById('autoFallback')
  const testBtn = document.getElementById('testBtn')
  const saveBtn = document.getElementById('saveBtn')
  const statusBanner = document.getElementById('statusBanner')

  function showStatus(text, type = 'loading') {
    statusBanner.className = `status-banner ${type}`
    statusBanner.textContent = text
  }

  function hideStatus() {
    statusBanner.className = 'status-banner'
    statusBanner.textContent = ''
  }

  function updateProviderUI(provider) {
    if (provider === 'gemini') {
      radioGemini.checked = true
      cardGemini.classList.add('active')
      cardOllama.classList.remove('active')
      geminiConfig.style.display = 'block'
      ollamaConfig.style.display = 'none'
    } else {
      radioOllama.checked = true
      cardOllama.classList.add('active')
      cardGemini.classList.remove('active')
      geminiConfig.style.display = 'none'
      ollamaConfig.style.display = 'block'
    }
  }

  cardGemini.addEventListener('click', () => updateProviderUI('gemini'))
  cardOllama.addEventListener('click', () => updateProviderUI('ollama'))
  radioGemini.addEventListener('change', () => updateProviderUI('gemini'))
  radioOllama.addEventListener('change', () => updateProviderUI('ollama'))

  toggleApiKey.addEventListener('click', () => {
    if (geminiApiKey.type === 'password') {
      geminiApiKey.type = 'text'
      toggleApiKey.textContent = '🔒'
    } else {
      geminiApiKey.type = 'password'
      toggleApiKey.textContent = '👁️'
    }
  })

  // Load saved settings
  chrome.storage.local.get([
    'aiProvider',
    'geminiApiKey',
    'geminiModel',
    'ollamaUrl',
    'ollamaModel',
    'autoFallback'
  ], (items) => {
    const provider = items.aiProvider || 'gemini'
    updateProviderUI(provider)

    if (items.geminiApiKey) geminiApiKey.value = items.geminiApiKey
    if (items.geminiModel) geminiModel.value = items.geminiModel
    if (items.ollamaUrl) ollamaUrl.value = items.ollamaUrl
    if (items.ollamaModel) ollamaModel.value = items.ollamaModel
    if (typeof items.autoFallback === 'boolean') {
      autoFallback.checked = items.autoFallback
    } else {
      autoFallback.checked = true
    }
  })

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const provider = radioGemini.checked ? 'gemini' : 'ollama'
    const key = geminiApiKey.value.trim()
    const gModel = geminiModel.value
    const oUrl = ollamaUrl.value.trim() || 'http://localhost:11434'
    const oModel = ollamaModel.value.trim() || 'qwen2.5-coder:7b'
    const fallback = autoFallback.checked

    if (provider === 'gemini' && !key) {
      showStatus('Please enter a Gemini API Key or get one free from Google AI Studio.', 'error')
      return
    }

    chrome.storage.local.set({
      aiProvider: provider,
      geminiApiKey: key,
      geminiModel: gModel,
      ollamaUrl: oUrl,
      ollamaModel: oModel,
      autoFallback: fallback
    }, () => {
      showStatus('✓ Settings saved successfully!', 'success')
      setTimeout(() => {
        hideStatus()
      }, 3000)
    })
  })

  // Test Connection
  testBtn.addEventListener('click', async () => {
    const provider = radioGemini.checked ? 'gemini' : 'ollama'
    hideStatus()

    if (provider === 'gemini') {
      const key = geminiApiKey.value.trim()
      const model = geminiModel.value
      if (!key) {
        showStatus('Please enter your Gemini API Key first.', 'error')
        return
      }

      showStatus('Testing connection to Gemini...', 'loading')
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Ping' }] }],
            generationConfig: { maxOutputTokens: 5 }
          })
        })

        const data = await res.json()
        if (res.ok) {
          showStatus('✓ Gemini connected successfully! (Latency OK)', 'success')
        } else {
          const err = data.error?.message || 'Invalid API key or model.'
          showStatus(`❌ Gemini error: ${err}`, 'error')
        }
      } catch (err) {
        showStatus(`❌ Network error: ${err.message}`, 'error')
      }
    } else {
      const url = ollamaUrl.value.trim() || 'http://localhost:11434'
      showStatus('Testing connection to Ollama...', 'loading')
      try {
        const res = await fetch(`${url}/api/tags`)
        if (res.ok) {
          showStatus('✓ Ollama is running and reachable!', 'success')
        } else {
          showStatus(`❌ Ollama returned status: ${res.status}`, 'error')
        }
      } catch (err) {
        showStatus(`❌ Could not connect to Ollama at ${url}. Make sure it is running.`, 'error')
      }
    }
  })
})

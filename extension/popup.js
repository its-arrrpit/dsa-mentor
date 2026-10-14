document.addEventListener('DOMContentLoaded', async () => {
  // Navigation Tabs
  const tabBtns = document.querySelectorAll('.tab-btn')
  const tabPanes = document.querySelectorAll('.tab-pane')

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab
      tabBtns.forEach(b => b.classList.remove('active'))
      tabPanes.forEach(p => p.classList.remove('active'))

      btn.classList.add('active')
      const targetPane = document.getElementById(`pane-${target}`)
      if (targetPane) targetPane.classList.add('active')

      if (target === 'analytics' || target === 'achievements') {
        refreshStatsUI()
      }
    })
  })

  // Provider Radio & Cards
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

  async function fetchAndPopulateModels(key, selectedModel) {
    if (!key) return
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
      if (!res.ok) return
      const data = await res.json()
      const contentModels = (data.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))

      if (contentModels.length > 0) {
        const preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-pro']
        const ordered = [
          ...preferred.filter(p => contentModels.includes(p)),
          ...contentModels.filter(m => !preferred.includes(m))
        ]

        geminiModel.innerHTML = ''
        ordered.forEach(m => {
          const opt = document.createElement('option')
          opt.value = m
          let tag = ''
          if (m === 'gemini-2.5-flash') tag = ' (Fast & Free Tier)'
          else if (m === 'gemini-2.0-flash') tag = ' (Ultra Fast)'
          else if (m === 'gemini-1.5-flash') tag = ' (Standard)'
          else if (m.includes('pro')) tag = ' (Deep Reasoning)'
          opt.textContent = m + tag
          if (m === selectedModel || (!selectedModel && m === 'gemini-2.5-flash')) {
            opt.selected = true
          }
          geminiModel.appendChild(opt)
        })
      }
    } catch (e) {
      // Ignore background fetch error
    }
  }

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

    if (items.geminiApiKey) {
      geminiApiKey.value = items.geminiApiKey
      fetchAndPopulateModels(items.geminiApiKey, items.geminiModel)
    }
    if (items.geminiModel) {
      for (let i = 0; i < geminiModel.options.length; i++) {
        if (geminiModel.options[i].value === items.geminiModel) {
          geminiModel.selectedIndex = i
          break
        }
      }
    }
    if (items.ollamaUrl) ollamaUrl.value = items.ollamaUrl
    if (items.ollamaModel) ollamaModel.value = items.ollamaModel
    if (typeof items.autoFallback === 'boolean') {
      autoFallback.checked = items.autoFallback
    } else {
      autoFallback.checked = true
    }
  })

  geminiApiKey.addEventListener('blur', () => {
    const key = geminiApiKey.value.trim()
    if (key.length > 20) {
      fetchAndPopulateModels(key, geminiModel.value)
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

      showStatus(`Testing connection to Gemini (${model})...`, 'loading')
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
          showStatus(`✓ Connected to ${model} successfully! (Latency OK)`, 'success')
          fetchAndPopulateModels(key, model)
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

  // ─── Analytics & Achievements UI Loading ───────────────────────────
  async function refreshStatsUI() {
    if (!window.DSAMentorAnalytics) return
    const stats = await window.DSAMentorAnalytics.getStoredStats()

    // 1. Streak Headers
    const streakStr = `🔥 ${stats.streakDays || 1} Day${(stats.streakDays || 1) === 1 ? '' : 's'}`
    const headerStreak = document.getElementById('headerStreak')
    const achieveStreak = document.getElementById('achieveStreak')
    if (headerStreak) headerStreak.textContent = streakStr
    if (achieveStreak) achieveStreak.textContent = streakStr

    // 2. Metrics Grid
    const statProblems = document.getElementById('statProblems')
    const statHints = document.getElementById('statHints')
    const statDebugs = document.getElementById('statDebugs')
    const statIndependence = document.getElementById('statIndependence')

    const probCount = stats.totalProblemsPracticed || 0
    const hintsCount = stats.totalHintsRequested || 0
    const debugCount = stats.totalDebugRuns || 0

    if (statProblems) statProblems.textContent = probCount
    if (statHints) statHints.textContent = hintsCount
    if (statDebugs) statDebugs.textContent = debugCount

    if (statIndependence) {
      if (probCount === 0) {
        statIndependence.textContent = '100%'
      } else {
        const ratio = Math.max(15, Math.min(100, Math.round(100 - (hintsCount / probCount) * 20)))
        statIndependence.textContent = `${ratio}%`
      }
    }

    // 3. Cognitive Bottleneck Breakdown
    const lvl1 = stats.hintsByLevel?.['1'] || 0
    const lvl2 = stats.hintsByLevel?.['2'] || 0
    const lvl3 = stats.hintsByLevel?.['3'] || 0
    const totalLvl = Math.max(1, lvl1 + lvl2 + lvl3)

    document.getElementById('countLvl1').textContent = lvl1
    document.getElementById('countLvl2').textContent = lvl2
    document.getElementById('countLvl3').textContent = lvl3

    document.getElementById('barLvl1').style.width = `${Math.round((lvl1 / totalLvl) * 100)}%`
    document.getElementById('barLvl2').style.width = `${Math.round((lvl2 / totalLvl) * 100)}%`
    document.getElementById('barLvl3').style.width = `${Math.round((lvl3 / totalLvl) * 100)}%`

    // 4. Topic Weakness Diagnostics
    const weaknessList = document.getElementById('weaknessList')
    if (weaknessList) {
      const topicEntries = Object.entries(stats.topics || {})
      if (topicEntries.length === 0) {
        weaknessList.innerHTML = `<div style="font-size:11px; color:#64748b; text-align:center; padding:10px;">Practice problems on LeetCode to populate weakness diagnostics.</div>`
      } else {
        weaknessList.innerHTML = ''
        topicEntries.sort((a, b) => (b[1].hints / Math.max(1, b[1].attempts)) - (a[1].hints / Math.max(1, a[1].attempts)))

        topicEntries.forEach(([topicName, data]) => {
          const struggleRatio = data.hints / Math.max(1, data.attempts)
          let tagClass = 'tag-strong'
          let tagText = '✅ Solid'
          if (struggleRatio >= 2.0) {
            tagClass = 'tag-struggle'
            tagText = '⚠️ High Struggle'
          } else if (struggleRatio >= 1.0) {
            tagClass = 'tag-moderate'
            tagText = '⚡ Moderate'
          }

          const item = document.createElement('div')
          item.className = 'weakness-item'
          item.innerHTML = `
            <div>
              <strong style="color:#fff;">${topicName}</strong>
              <div style="font-size:10px; color:#94a3b8;">${data.attempts} attempt${data.attempts === 1 ? '' : 's'} • ${data.hints} hint${data.hints === 1 ? '' : 's'}</div>
            </div>
            <span class="weakness-tag ${tagClass}">${tagText}</span>
          `
          weaknessList.appendChild(item)
        })
      }
    }

    // 5. Achievements & Badges Grid
    const badgeGrid = document.getElementById('badgeGrid')
    const badgeCounter = document.getElementById('badgeCounter')
    if (badgeGrid && window.DSAMentorAnalytics.ALL_BADGES) {
      badgeGrid.innerHTML = ''
      const all = window.DSAMentorAnalytics.ALL_BADGES
      const unlockedIds = stats.unlockedBadgeIds || []

      if (badgeCounter) {
        badgeCounter.textContent = `${unlockedIds.length} / ${all.length} Unlocked`
      }

      all.forEach(badge => {
        const isUnlocked = unlockedIds.includes(badge.id)
        const card = document.createElement('div')
        card.className = `badge-card ${isUnlocked ? 'unlocked' : 'locked'}`
        card.innerHTML = `
          <div class="badge-card-header">
            <span class="badge-card-icon">${badge.icon}</span>
            <span class="badge-card-name">${badge.name}</span>
          </div>
          <div class="badge-card-desc">${badge.desc}</div>
          <span class="badge-status-pill">${isUnlocked ? '✓ Unlocked' : '🔒 Locked'}</span>
        `
        badgeGrid.appendChild(card)
      })
    }
  }

  // Initial load
  refreshStatsUI()
})

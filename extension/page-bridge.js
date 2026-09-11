// page-bridge.js — runs in the page context (world: "MAIN")
// Directly accesses window.monaco to get the complete, non-virtualized code.

function getMonacoCodeFromPage() {
  try {
    if (window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors();
      if (editors && editors.length > 0) {
        // LeetCode often creates helper/testcase editors; pick the editor with the longest code
        let bestCode = '';
        for (const ed of editors) {
          try {
            const val = ed.getValue();
            if (val && val.length > bestCode.length) {
              bestCode = val;
            }
          } catch (e) {}
        }
        if (bestCode) return bestCode;
        return editors[0].getValue() || '';
      }
    }
  } catch (err) {
    console.warn('[DSA Mentor Bridge] Could not extract Monaco editor code:', err);
  }
  return '';
}

// Listen for code requests from content.js
document.addEventListener('dsa-request-code', () => {
  const code = getMonacoCodeFromPage();
  document.dispatchEvent(new CustomEvent('dsa-response-code', {
    detail: { code }
  }));
});

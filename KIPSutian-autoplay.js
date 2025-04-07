// ==UserScript==
// @name         KIPSutian-autoplay
// @namespace    aiuanyu
// @version      4.26.1
// @description  自動開啟查詢結果表格/列表中每個詞目連結於 Modal iframe (表格) 或直接播放音檔 (列表)，依序播放音檔(自動偵測時長)，主表格/列表自動滾動高亮，處理完畢後自動跳轉下一頁繼續播放，可即時暫停/停止/點擊背景暫停(表格)/點擊表格/列表列播放，並根據亮暗模式高亮按鈕。 v4.26.1: 修正移除舊按鈕時選擇器未分割的問題。
// @author       Aiuanyu 愛灣語 + Gemini
// @match        http*://sutian.moe.edu.tw/und-hani/tshiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/hunlui/*
// @match        http*://sutian.moe.edu.tw/und-hani/siannuntiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/poosiu/poosiu/*/*
// @match        http*://sutian.moe.edu.tw/und-hani/tsongpitueh/*
// @match        http*://sutian.moe.edu.tw/und-hani/huliok/*
// @match        http*://sutian.moe.edu.tw/zh-hant/tshiau/* // ** 更新：涵蓋新的列表頁面 **
// @match        http*://sutian.moe.edu.tw/zh-hant/hunlui/*
// @match        http*://sutian.moe.edu.tw/zh-hant/siannuntiau/*
// @match        http*://sutian.moe.edu.tw/zh-hant/poosiu/poosiu/*/*
// @match        http*://sutian.moe.edu.tw/zh-hant/tsongpitueh/*
// @match        http*://sutian.moe.edu.tw/zh-hant/huliok/*
// @exclude      http*://sutian.moe.edu.tw/und-hani/tsongpitueh/
// @exclude      http*://sutian.moe.edu.tw/und-hani/tsongpitueh/?ueh=*
// @exclude      http*://sutian.moe.edu.tw/zh-hant/tsongpitueh/
// @exclude      http*://sutian.moe.edu.tw/zh-hant/tsongpitueh/?ueh=*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      sutian.moe.edu.tw
// @run-at       document-idle
// @license      GNU GPLv3
// ==/UserScript==

(function () {
  'use strict';

  // --- 配置 ---
  const MODAL_WIDTH = '80vw';
  const MODAL_HEIGHT = '70vh';
  const FALLBACK_DELAY_MS = 3000;
  const DELAY_BUFFER_MS = 500;
  const DELAY_BETWEEN_CLICKS_MS = 200; // iframe 內音檔間隔 (表格頁)
  const DELAY_BETWEEN_ITEMS_MS = 500; // 主頁面項目間隔 (表格/列表頁)
  const HIGHLIGHT_CLASS = 'userscript-audio-playing'; // iframe 內按鈕高亮 (表格頁)
  const ROW_HIGHLIGHT_CLASS_MAIN = 'userscript-row-highlight'; // 主頁面項目高亮 (表格/列表頁)
  const ROW_PAUSED_HIGHLIGHT_CLASS = 'userscript-row-paused-highlight'; // 主頁面項目暫停高亮 (表格/列表頁)
  const OVERLAY_ID = 'userscript-modal-overlay'; // iframe 背景遮罩 (表格頁)
  const MOBILE_INTERACTION_BOX_ID = 'userscript-mobile-interaction-box';
  const MOBILE_BG_OVERLAY_ID = 'userscript-mobile-bg-overlay';
  const CONTROLS_CONTAINER_ID = 'auto-play-controls-container';
  const ROW_HIGHLIGHT_COLOR = 'rgba(0, 255, 0, 0.1)';
  const ROW_HIGHLIGHT_DURATION = 1500;
  const FONT_AWESOME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  const FONT_AWESOME_INTEGRITY = 'sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==';
  const AUTOPLAY_PARAM = 'autoplay';
  const PAGINATION_PARAMS = ['iahbe', 'pitsoo'];
  const AUTO_START_MAX_WAIT_MS = 10000;
  const AUTO_START_CHECK_INTERVAL_MS = 500;
  // ** 更新：加入列表容器選擇器 **
  const CONTAINER_SELECTOR = 'main.container-fluid div.mt-1.mb-5, main.container-fluid div.mt-1.mb-4, main.container-fluid div.mb-5, main.container-fluid div.mt-1';
  const ALL_TABLES_SELECTOR = CONTAINER_SELECTOR.split(',').map(s => `${s.trim()} > table`).join(', ');
  const LIST_CONTAINER_SELECTOR = CONTAINER_SELECTOR.split(',').map(s => `${s.trim()} > ol`).join(', '); // ** 新增：列表容器選擇器 **
  const LIST_ITEM_SELECTOR = 'li.list-pos-in'; // ** 新增：列表項目選擇器 **
  const RELEVANT_ROW_MARKER_SELECTOR = 'td:first-of-type span.fw-normal'; // 表格頁用
  const WIDE_TABLE_SELECTOR = 'table.d-none.d-md-table';
  const NARROW_TABLE_SELECTOR = 'table.d-md-none';
  const RESIZE_DEBOUNCE_MS = 300;
  const AUDIO_INDICATOR_SELECTOR = 'button.imtong-liua'; // 通用音檔按鈕選擇器
  const MOBILE_BOX_BG_COLOR = '#aa96b7';
  const MOBILE_BOX_TEXT_COLOR = '#d9e2a9';
  const MOBILE_BOX_BG_COLOR_DARK = '#4a4a8a';
  const MOBILE_BOX_TEXT_COLOR_DARK = '#EEEEEE';
  const MOBILE_BG_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.6)';

  // --- 適應亮暗模式的高亮樣式 ---
  const CSS_IFRAME_HIGHLIGHT = `
        /* iframe 內按鈕高亮 - 亮色模式 */
        .${HIGHLIGHT_CLASS} { background-color: #FFF352 !important; color: black !important; outline: 2px solid #FFB800 !important; box-shadow: 0 0 10px #FFF352; transition: all 0.2s ease-in-out; }
        /* iframe 內按鈕高亮 - 深色模式 */
        @media (prefers-color-scheme: dark) { .${HIGHLIGHT_CLASS} { background-color: #66b3ff !important; color: black !important; outline: 2px solid #87CEFA !important; box-shadow: 0 0 10px #66b3ff; } }
  `;
  const CSS_PAUSE_HIGHLIGHT = `
        /* 暫停時閃爍效果 - Keyframes */
        @keyframes userscriptPulseHighlight { 0% { background-color: rgba(255, 193, 7, 0.2); } 50% { background-color: rgba(255, 193, 7, 0.4); } 100% { background-color: rgba(255, 193, 7, 0.2); } }
        /* 暫停時閃爍效果 - Keyframes (深色模式) */
        @media (prefers-color-scheme: dark) { @keyframes userscriptPulseHighlight { 0% { background-color: rgba(102, 179, 255, 0.3); } 50% { background-color: rgba(102, 179, 255, 0.6); } 100% { background-color: rgba(102, 179, 255, 0.3); } } }
        /* 暫停時閃爍效果 - Class */
        .${ROW_PAUSED_HIGHLIGHT_CLASS} { animation: userscriptPulseHighlight 1.5s ease-in-out infinite; }
  `;
  const CSS_MOBILE_OVERLAY = `
        /* 行動裝置互動 "背景遮罩" 樣式 */
        #${MOBILE_BG_OVERLAY_ID} { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: ${MOBILE_BG_OVERLAY_COLOR}; z-index: 10004; cursor: pointer; }
        /* 行動裝置互動 "提示框" 樣式 (亮色模式) */
        #${MOBILE_INTERACTION_BOX_ID} { position: fixed; background-color: ${MOBILE_BOX_BG_COLOR}; color: ${MOBILE_BOX_TEXT_COLOR}; display: flex; justify-content: center; align-items: center; font-size: 10vw; font-weight: bold; text-align: center; z-index: 10005; cursor: pointer; padding: 20px; box-sizing: border-box; border-radius: 8px; box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3); }
        /* 行動裝置互動 "提示框" 樣式 (深色模式) */
        @media (prefers-color-scheme: dark) { #${MOBILE_INTERACTION_BOX_ID} { background-color: ${MOBILE_BOX_BG_COLOR_DARK}; color: ${MOBILE_BOX_TEXT_COLOR_DARK}; } }
  `;
  const CSS_CONTROLS_BUTTONS = `
        /* 控制按鈕懸停及禁用樣式 */
        #${CONTROLS_CONTAINER_ID} button:disabled { opacity: 0.65; cursor: not-allowed; }
        #auto-play-pause-button:hover:not(:disabled) { background-color: #e0a800 !important; }
        #auto-play-stop-button:hover:not(:disabled) { background-color: #c82333 !important; }
  `;
  // --- 配置結束 ---

  // --- 全局狀態變數 ---
  let isProcessing = false;
  let isPaused = false;
  let currentItemIndex = 0; // 通用索引
  let totalItems = 0; // 通用總數
  let currentSleepController = null;
  let currentIframe = null; // 僅表格頁使用
  let itemsToProcess = []; // 通用待處理項目列表
  let rowHighlightTimeout = null;
  let resizeDebounceTimeout = null;
  let currentPausedHighlightElement = null;
  let isMobile = false;
  let isListPage = false; // 標記是否為列表頁面

  // --- UI 元素引用 ---
  let pauseButton = null;
  let stopButton = null;
  let statusDisplay = null;
  let overlayElement = null; // 僅表格頁使用

  // --- Helper 函數 ---

  function interruptibleSleep(ms) {
    if (currentSleepController) { currentSleepController.cancel('overridden'); }
    let timeoutId, rejectFn, resolved = false, rejected = false;
    const promise = new Promise((resolve, reject) => {
      rejectFn = reject;
      timeoutId = setTimeout(() => { if (!rejected) { resolved = true; currentSleepController = null; resolve(); } }, ms);
    });
    const controller = {
      promise: promise,
      cancel: (reason = 'cancelled') => {
        if (!resolved && !rejected) { rejected = true; clearTimeout(timeoutId); currentSleepController = null; const error = new Error(reason); error.isCancellation = true; error.reason = reason; rejectFn(error); }
      }
    };
    currentSleepController = controller; return controller;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // 從按鈕元素獲取 src 並解析音檔時長
  function getAudioDuration(audioButton) {
    let audioUrl = null;
    if (audioButton && audioButton.dataset.src) {
      const srcString = audioButton.dataset.src;
      let audioPath = null;
      // 嘗試解析 JSON (雖然目前觀察到的是純路徑)
      try {
        const d = JSON.parse(srcString.replace(/&quot;/g, '"'));
        if (Array.isArray(d) && d.length > 0 && typeof d[0] === 'string') {
          audioPath = d[0];
        }
      } catch (e) {
        // 如果不是 JSON，直接當作路徑
        if (typeof srcString === 'string' && srcString.trim().startsWith('/')) {
          audioPath = srcString.trim();
        }
      }
      if (audioPath) {
        try {
          // 使用當前頁面 URL 作為基礎來解析相對路徑
          audioUrl = new URL(audioPath, window.location.href).href;
        } catch (urlError) {
          console.error(`[自動播放] 解析音檔路徑時出錯 (${audioPath}):`, urlError);
          audioUrl = null;
        }
      }
    }

    console.log(`[自動播放] 嘗試獲取音檔時長: ${audioUrl || '未知 URL'}`);
    return new Promise((resolve) => {
      if (!audioUrl) { console.warn("[自動播放] 無法確定有效的音檔 URL，使用後備延遲。"); resolve(FALLBACK_DELAY_MS); return; }
      const audio = new Audio(); audio.preload = 'metadata';
      const timer = setTimeout(() => { console.warn(`[自動播放] 獲取音檔 ${audioUrl} 元數據超時 (5秒)，使用後備延遲。`); cleanupAudio(); resolve(FALLBACK_DELAY_MS); }, 5000);
      const cleanupAudio = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', onLoadedMetadata); audio.removeEventListener('error', onError); audio.src = ''; };
      const onLoadedMetadata = () => { if (audio.duration && isFinite(audio.duration)) { const durationMs = Math.ceil(audio.duration * 1000) + DELAY_BUFFER_MS; console.log(`[自動播放] 獲取到音檔時長: ${audio.duration.toFixed(2)}s, 使用延遲: ${durationMs}ms`); cleanupAudio(); resolve(durationMs); } else { console.warn(`[自動播放] 無法從元數據獲取有效時長 (${audio.duration})，使用後備延遲。`); cleanupAudio(); resolve(FALLBACK_DELAY_MS); } };
      const onError = (e) => { console.error(`[自動播放] 加載音檔 ${audioUrl} 元數據時出錯:`, e); cleanupAudio(); resolve(FALLBACK_DELAY_MS); };
      audio.addEventListener('loadedmetadata', onLoadedMetadata); audio.addEventListener('error', onError);
      try { audio.src = audioUrl; } catch (e) { console.error(`[自動播放] 設置音檔 src 時發生錯誤 (${audioUrl}):`, e); cleanupAudio(); resolve(FALLBACK_DELAY_MS); }
    });
  }

  // --- iframe 相關函數 (僅表格頁使用) ---
  function addStyleToIframe(iframeDoc, css) {
    try { const styleElement = iframeDoc.createElement('style'); styleElement.textContent = css; iframeDoc.head.appendChild(styleElement); console.log("[自動播放][表格頁] 已在 iframe 中添加高亮樣式。"); }
    catch (e) { console.error("[自動播放][表格頁] 無法在 iframe 中添加樣式:", e); }
  }

  function handleOverlayClick(event) {
    if (event.target !== overlayElement) return;
    if (isProcessing && !isPaused) {
      console.log("[自動播放][表格頁] 點擊背景遮罩，觸發暫停並關閉 Modal。");
      isPaused = true; pauseButton.textContent = '繼續'; updateStatusDisplay();
      if (currentSleepController) currentSleepController.cancel('paused_overlay');
      if (currentPausedHighlightElement) currentPausedHighlightElement.classList.add(ROW_PAUSED_HIGHLIGHT_CLASS);
      else console.warn("[自動播放][表格頁] 點擊遮罩暫停，但找不到當前高亮目標元素。");
      closeModal();
    }
  }

  function showModal(iframe) {
    overlayElement = document.getElementById(OVERLAY_ID);
    if (!overlayElement) { overlayElement = document.createElement('div'); overlayElement.id = OVERLAY_ID; Object.assign(overlayElement.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: MOBILE_BG_OVERLAY_COLOR, zIndex: '9998', cursor: 'pointer' }); document.body.appendChild(overlayElement); }
    overlayElement.removeEventListener('click', handleOverlayClick); overlayElement.addEventListener('click', handleOverlayClick);
    Object.assign(iframe.style, { position: 'fixed', width: MODAL_WIDTH, height: MODAL_HEIGHT, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', border: '1px solid #ccc', borderRadius: '8px', boxShadow: '0 5px 20px rgba(0, 0, 0, 0.3)', backgroundColor: 'white', zIndex: '9999', opacity: '1', pointerEvents: 'auto' });
    document.body.appendChild(iframe); currentIframe = iframe;
    console.log(`[自動播放][表格頁] 已顯示 Modal iframe, id: ${currentIframe.id}`);
  }

  function closeModal() {
    if (currentIframe && currentIframe.parentNode) currentIframe.remove(); currentIframe = null;
    if (overlayElement) { overlayElement.removeEventListener('click', handleOverlayClick); if (overlayElement.parentNode) overlayElement.remove(); overlayElement = null; }
    if (currentSleepController && !isListPage) { // 只有表格頁關閉 Modal 時才取消 sleep
      currentSleepController.cancel('modal_closed');
      currentSleepController = null;
    }
  }

  async function handleIframeContent(iframe, url) {
    let iframeDoc;
    try {
      await sleep(150); iframeDoc = iframe.contentWindow.document; addStyleToIframe(iframeDoc, CSS_IFRAME_HIGHLIGHT);
      const audioButtons = iframeDoc.querySelectorAll(AUDIO_INDICATOR_SELECTOR); console.log(`[自動播放][表格頁] 在 iframe (${iframe.id}) 中找到 ${audioButtons.length} 個播放按鈕`);
      if (audioButtons.length > 0) {
        for (let i = 0; i < audioButtons.length; i++) {
          if (!isProcessing) { console.log("[自動播放][表格頁] 播放音檔前檢測到停止"); break; }
          while (isPaused && isProcessing) { await sleep(500); if (!isProcessing) break; } if (!isProcessing || isPaused) { i--; continue; }
          const button = audioButtons[i]; if (!button || !iframeDoc.body.contains(button)) { console.warn(`[自動播放][表格頁] 按鈕 ${i + 1} 失效，跳過。`); continue; } console.log(`[自動播放][表格頁] 準備播放 iframe 中的第 ${i + 1} 個音檔`);
          let actualDelayMs = await getAudioDuration(button); // 從按鈕獲取時長
          let scrollTargetElement = button; const flexContainer = button.closest('div.d-flex.flex-row.align-items-baseline'), fs6Container = button.closest('div.mb-0.fs-6'); if (flexContainer) { const h = iframeDoc.querySelector('h1#main'); if (h) scrollTargetElement = h; } else if (fs6Container) { const p = fs6Container.previousElementSibling; if (p && p.matches('span.mb-0')) scrollTargetElement = p; } if (scrollTargetElement && iframeDoc.body.contains(scrollTargetElement)) scrollTargetElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(300);
          button.classList.add(HIGHLIGHT_CLASS); button.click(); console.log(`[自動播放][表格頁] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);
          try { await interruptibleSleep(actualDelayMs).promise; } catch (error) { if (error.isCancellation) { if (iframeDoc.body.contains(button)) button.classList.remove(HIGHLIGHT_CLASS); break; } else { throw error; } } finally { currentSleepController = null; }
          if (iframeDoc.body.contains(button)) button.classList.remove(HIGHLIGHT_CLASS); if (!isProcessing) break;
          if (i < audioButtons.length - 1) { try { await interruptibleSleep(DELAY_BETWEEN_CLICKS_MS).promise; } catch (error) { if (error.isCancellation) break; else throw error; } finally { currentSleepController = null; } } if (!isProcessing) break;
        }
      } else { console.log(`[自動播放][表格頁] Iframe ${url} 中未找到播放按鈕`); await sleep(1000); }
    } catch (error) { console.error(`[自動播放][表格頁] 處理 iframe 內容時出錯 (${url}):`, error); } finally { if (currentSleepController) { currentSleepController.cancel('content_handled_exit'); currentSleepController = null; } }
  }

  // --- 表格頁專用函數 ---
  async function processSingleLink(url) {
    console.log(`[自動播放][表格頁] processSingleLink 開始 - ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    const iframeId = `auto-play-iframe-${Date.now()}`; let iframe = document.createElement('iframe'); iframe.id = iframeId;
    return new Promise(async (resolve) => {
      if (!isProcessing) { resolve(); return; }
      let isUsingExistingIframe = false;
      if (currentIframe && currentIframe.contentWindow && currentIframe.contentWindow.location.href === url) { iframe = currentIframe; isUsingExistingIframe = true; } else { if (currentIframe) { closeModal(); await sleep(50); if (!isProcessing) { resolve(); return; } } showModal(iframe); }
      if (isUsingExistingIframe) { await handleIframeContent(iframe, url); resolve(); } else { iframe.onload = async () => { if (!isProcessing) { closeModal(); resolve(); return; } if (currentIframe !== iframe) { resolve(); return; } await handleIframeContent(iframe, url); resolve(); }; iframe.onerror = (error) => { console.error(`[自動播放][表格頁] Iframe 載入失敗 (${url}):`, error); closeModal(); resolve(); }; iframe.src = url; }
    });
  }

  // --- 查找元素相關 (主要是表格頁用，列表頁直接用 item.element) ---
  function findElementForLink(targetUrl) { // 主要用於表格頁面根據 URL 查找元素
    if (!targetUrl || isListPage) return null; // 列表頁不使用此方法查找
    const visibleTables = getVisibleTables(); const linkSelector = getLinkSelector(); let targetElement = null;
    for (const table of visibleTables) {
      const isWideTable = table.matches(WIDE_TABLE_SELECTOR), isNarrowTable = table.matches(NARROW_TABLE_SELECTOR); const rows = table.querySelectorAll('tbody tr');
      if (isWideTable) { for (const row of rows) { const firstTd = row.querySelector('td:first-of-type'); if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) { const linkElement = row.querySelector(linkSelector); if (linkElement) { try { const linkHref = new URL(linkElement.getAttribute('href'), window.location.origin).href; if (linkHref === targetUrl) { targetElement = firstTd; break; } } catch (e) { console.error(`[自動播放][查找元素][寬] 處理連結 URL 時出錯:`, e, linkElement); } } } } }
      else if (isNarrowTable && rows.length >= 2) { const firstRowTd = rows[0].querySelector('td:first-of-type'), secondRowTd = rows[1].querySelector('td:first-of-type'); if (firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR) && secondRowTd) { const linkElement = secondRowTd.querySelector(linkSelector); if (linkElement) { try { const linkHref = new URL(linkElement.getAttribute('href'), window.location.origin).href; if (linkHref === targetUrl) { targetElement = table; break; } } catch (e) { console.error(`[自動播放][查找元素][窄] 處理連結 URL 時出錯:`, e, linkElement); } } } }
      if (targetElement) break;
    }
    if (!targetElement) console.warn(`[自動播放][查找元素] 未能找到 URL 對應的元素: ${targetUrl}`);
    return targetElement;
  }

  // 循序處理項目列表 (通用)
  async function processItemsSequentially() {
    console.log("[自動播放] processItemsSequentially 開始");
    while (currentItemIndex < totalItems && isProcessing) {
      // 處理暫停
      while (isPaused && isProcessing) {
        console.log(`[自動播放] 主流程已暫停 (索引 ${currentItemIndex})，等待繼續...`);
        updateStatusDisplay();
        await sleep(500);
        if (!isProcessing) break;
      }
      if (!isProcessing) break;

      updateStatusDisplay();
      const currentItem = itemsToProcess[currentItemIndex];
      console.log(`[自動播放] 準備處理項目 ${currentItemIndex + 1}/${totalItems} (全局索引 ${currentItem.originalIndex})`);

      // --- 查找、捲動和高亮主頁面元素 ---
      let targetElementForScroll = null; // 用於捲動的目標
      let highlightTarget = null; // 用於高亮的目標 (tr 或 li)

      if (isListPage) {
        targetElementForScroll = currentItem.element; // 列表頁直接使用 li
        highlightTarget = currentItem.element;
        console.log(`[自動播放][列表頁][捲動/高亮] 正在處理項目 ${currentItem.originalIndex + 1} 對應的元素`, highlightTarget);
      } else { // 表格頁
        targetElementForScroll = findElementForLink(currentItem.url); // 根據 URL 查找
        if (targetElementForScroll) {
          if (targetElementForScroll.tagName === 'TD') { highlightTarget = targetElementForScroll.closest('tr'); }
          else if (targetElementForScroll.tagName === 'TABLE') { highlightTarget = targetElementForScroll.querySelector('tbody tr:first-of-type'); }
          console.log(`[自動播放][表格頁][捲動/高亮] 正在處理項目 ${currentItem.originalIndex + 1} 對應的元素`, targetElementForScroll, `高亮目標:`, highlightTarget);
        }
      }

      // 清除之前的任何高亮效果
      if (rowHighlightTimeout) { clearTimeout(rowHighlightTimeout); rowHighlightTimeout = null; }
      document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}, .${ROW_PAUSED_HIGHLIGHT_CLASS}`).forEach(el => {
        el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN, ROW_PAUSED_HIGHLIGHT_CLASS);
        el.style.backgroundColor = ''; el.style.transition = ''; el.style.animation = '';
      });
      currentPausedHighlightElement = null;

      if (targetElementForScroll && highlightTarget) {
        // 捲動到目標元素
        targetElementForScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);

        // 應用常規高亮
        highlightTarget.classList.add(ROW_HIGHLIGHT_CLASS_MAIN);
        highlightTarget.style.backgroundColor = ROW_HIGHLIGHT_COLOR;
        highlightTarget.style.transition = 'background-color 0.5s ease-out';
        currentPausedHighlightElement = highlightTarget; // 設置新的暫停目標

        // 設置延遲移除常規高亮
        const currentHighlightTarget = highlightTarget;
        rowHighlightTimeout = setTimeout(() => {
          if (currentHighlightTarget && currentHighlightTarget.classList.contains(ROW_HIGHLIGHT_CLASS_MAIN)) {
            currentHighlightTarget.style.backgroundColor = '';
            setTimeout(() => { if (currentHighlightTarget) currentHighlightTarget.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN); }, 500);
          }
          rowHighlightTimeout = null;
        }, ROW_HIGHLIGHT_DURATION);
      } else {
        console.warn(`[自動播放][主頁捲動/高亮] 未能找到或確定項目 ${currentItem.originalIndex + 1} 的元素。跳過此項目。`);
        currentItemIndex++; // 重要：跳過這個無效項目
        continue; // 進入下一次 while 循環
      }

      await sleep(200); // 等待滾動和高亮穩定
      if (!isProcessing || isPaused) continue;

      // --- 核心處理：表格頁開 iframe，列表頁直接播音檔 ---
      if (isListPage) {
        // 列表頁：直接播放音檔
        const audioButton = currentItem.audioButton;
        if (audioButton && document.body.contains(audioButton)) {
          const actualDelayMs = await getAudioDuration(audioButton);
          console.log(`[自動播放][列表頁] 準備點擊音檔按鈕，等待 ${actualDelayMs}ms`);
          audioButton.click(); // 模擬點擊
          try {
            await interruptibleSleep(actualDelayMs).promise;
          } catch (error) {
            if (error.isCancellation) {
              console.log(`[自動播放][列表頁] 音檔播放等待被 '${error.reason}' 中斷。`);
              // 不需要移除 iframe 內的高亮，因為沒有 iframe
            } else { throw error; }
          } finally {
            currentSleepController = null;
          }
        } else {
          console.warn(`[自動播放][列表頁] 項目 ${currentItem.originalIndex + 1} 的音檔按鈕無效或不存在，跳過播放。`);
          await sleep(500); // 短暫等待以避免過快跳過
        }
      } else {
        // 表格頁：處理單個連結 (開 iframe)
        await processSingleLink(currentItem.url);
      }

      if (!isProcessing) break; // 檢查處理後是否被停止

      // 關閉 Modal (僅表格頁且未暫停時)
      if (!isListPage && !isPaused) closeModal();

      // 移動到下一個項目 (如果沒有暫停)
      if (!isPaused) currentItemIndex++;
      else console.log(`[自動播放][偵錯] 處於暫停狀態，索引保持不變`);

      // 項目間的等待
      if (currentItemIndex < totalItems && isProcessing && !isPaused) {
        try { await interruptibleSleep(DELAY_BETWEEN_ITEMS_MS).promise; } // 使用通用項目間隔
        catch (error) { if (error.isCancellation) console.log(`[自動播放] 項目間等待被 '${error.reason}' 中斷。`); else throw error; }
        finally { currentSleepController = null; }
      }
      if (!isProcessing) break;
    } // --- while loop end ---

    console.log(`[自動播放][偵錯] processItemsSequentially 循環結束。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (isProcessing && !isPaused) { // 只有正常完成才檢查分頁
      // --- 自動分頁邏輯 ---
      let foundNextPage = false;
      const paginationNav = document.querySelector('nav[aria-label="頁碼"] ul.pagination');
      if (paginationNav) {
        const nextPageLink = paginationNav.querySelector('li:last-child > a');
        if (nextPageLink && (nextPageLink.textContent.includes('後一頁') || nextPageLink.textContent.includes('下一頁')) && !nextPageLink.closest('li.disabled')) {
          const nextPageHref = nextPageLink.getAttribute('href');
          if (nextPageHref && nextPageHref !== '#') {
            try {
              const currentParams = new URLSearchParams(window.location.search);
              const nextPageUrlTemp = new URL(nextPageHref, window.location.origin);
              const nextPageParams = nextPageUrlTemp.searchParams;
              const finalParams = new URLSearchParams(currentParams.toString());
              PAGINATION_PARAMS.forEach(param => { if (nextPageParams.has(param)) finalParams.set(param, nextPageParams.get(param)); });
              finalParams.set(AUTOPLAY_PARAM, 'true');
              const finalNextPageUrl = `${window.location.pathname}?${finalParams.toString()}`;
              console.log(`[自動播放] 組合完成，準備跳轉至: ${finalNextPageUrl}`);
              foundNextPage = true;
              await sleep(1000); window.location.href = finalNextPageUrl;
            } catch (e) { console.error("[自動播放] 處理下一頁 URL 時出錯:", e); }
          }
        }
      }
      if (!foundNextPage) { alert("所有項目攏處理完畢！"); resetTriggerButton(); } // 更新提示文本
    } else { resetTriggerButton(); } // 停止或暫停結束時重置
  }

  // --- 控制按鈕事件處理 ---

  // 輔助函數，獲取當前可見的表格元素列表 (僅表格頁用)
  function getVisibleTables() {
    if (isListPage) return []; // 列表頁沒有表格
    const allTables = document.querySelectorAll(ALL_TABLES_SELECTOR);
    return Array.from(allTables).filter(table => {
      try { const style = window.getComputedStyle(table); return style.display !== 'none' && style.visibility !== 'hidden'; }
      catch (e) { console.error("[自動播放] 檢查表格可見性時出錯:", e, table); return false; }
    });
  }

  // startPlayback - 通用化處理表格和列表
  function startPlayback(startIndex = 0) {
    console.log(`[自動播放] startPlayback 調用。 startIndex: ${startIndex}, isProcessing: ${isProcessing}, isPaused: ${isPaused}, isListPage: ${isListPage}`);
    if (isProcessing && !isPaused) { console.warn("[自動播放][偵錯] 開始/繼續 按鈕被點擊，但 isProcessing 為 true 且 isPaused 為 false，不執行任何操作。"); return; }

    if (isProcessing && isPaused) { // 從暫停恢復
      isPaused = false; pauseButton.textContent = '暫停';
      if (currentPausedHighlightElement) { currentPausedHighlightElement.classList.remove(ROW_PAUSED_HIGHLIGHT_CLASS); currentPausedHighlightElement.style.animation = ''; }
      updateStatusDisplay(); console.log("[自動播放] 從暫停狀態繼續。"); return;
    }

    // --- 首次啟動或從停止後重新啟動 ---
    console.log(`[自動播放] 使用音檔指示符選擇器: ${AUDIO_INDICATOR_SELECTOR}`);
    const allItems = [];
    let globalRowIndex = 0; // 用於原始索引
    let skippedCount = 0; // 計算跳過的數量

    if (isListPage) {
      // --- 處理列表頁 ---
      const listContainer = document.querySelector(LIST_CONTAINER_SELECTOR);
      if (!listContainer) { alert("頁面上揣無結果列表！"); return; }
      const listItems = listContainer.querySelectorAll(LIST_ITEM_SELECTOR);
      console.log(`[自動播放][列表頁] 找到 ${listItems.length} 個列表項目。`);

      listItems.forEach(li => {
        const audioButton = li.querySelector(AUDIO_INDICATOR_SELECTOR);
        if (audioButton) {
          allItems.push({ element: li, audioButton: audioButton, originalIndex: globalRowIndex });
        } else {
          console.log(`[自動播放][過濾][列表] 項目 ${globalRowIndex + 1} 無音檔按鈕，跳過。`);
          skippedCount++;
        }
        globalRowIndex++;
      });

    } else {
      // --- 處理表格頁 ---
      const linkSelector = getLinkSelector();
      console.log(`[自動播放][表格頁] 使用連結選擇器: ${linkSelector}`);
      const visibleTables = getVisibleTables();
      if (visibleTables.length === 0) { alert("頁面上揣無目前顯示的結果表格！"); return; }

      visibleTables.forEach(table => {
        const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
        const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);
        const rows = table.querySelectorAll('tbody tr');

        if (isWideTable) {
          rows.forEach(row => {
            const firstTd = row.querySelector('td:first-of-type');
            if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) {
              const linkElement = row.querySelector(linkSelector);
              const thirdTd = row.querySelector('td:nth-of-type(3)');
              const hasAudioIndicator = thirdTd && thirdTd.querySelector(AUDIO_INDICATOR_SELECTOR);
              if (linkElement && hasAudioIndicator) {
                try { allItems.push({ url: new URL(linkElement.getAttribute('href'), window.location.origin).href, anchorElement: linkElement, originalIndex: globalRowIndex }); }
                catch (e) { console.error(`[自動播放][連結][寬] 處理連結 URL 時出錯:`, e, linkElement); }
              } else { if (linkElement && !hasAudioIndicator) { console.log(`[自動播放][過濾][寬] 行 ${globalRowIndex + 1} 有連結但無音檔按鈕(在第3td)，跳過。`); skippedCount++; } }
              globalRowIndex++;
            }
          });
        } else if (isNarrowTable && rows.length >= 1) {
          const firstRow = rows[0];
          const firstRowTd = firstRow.querySelector('td:first-of-type');
          if (firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) {
            let linkElement = null;
            if (rows.length >= 2) { const secondRowTd = rows[1].querySelector('td:first-of-type'); if (secondRowTd) linkElement = secondRowTd.querySelector(linkSelector); }
            if (linkElement) {
              const thirdTr = table.querySelector('tbody tr:nth-of-type(3)');
              const hasAudioIndicator = thirdTr && thirdTr.querySelector(AUDIO_INDICATOR_SELECTOR);
              if (hasAudioIndicator) {
                try { allItems.push({ url: new URL(linkElement.getAttribute('href'), window.location.origin).href, anchorElement: linkElement, originalIndex: globalRowIndex }); }
                catch (e) { console.error(`[自動播放][連結][窄] 處理連結 URL 時出錯:`, e, linkElement); }
              } else { console.log(`[自動播放][過濾][窄] 項目 ${globalRowIndex + 1} 有連結但無音檔按鈕(在第3tr)，跳過。`); skippedCount++; }
            }
            globalRowIndex++;
          }
        } else { console.warn("[自動播放][連結] 發現未知類型的可見表格:", table); }
      });
    }

    console.log(`[自動播放] 找到 ${allItems.length} 個包含音檔按鈕的項目 (已跳過 ${skippedCount} 個無音檔按鈕的項目)。`);
    if (allItems.length === 0) { alert(`目前顯示的${isListPage ? '列表' : '表格'}內揣無有音檔播放按鈕的詞目！`); resetTriggerButton(); return; }
    if (startIndex >= allItems.length) { console.error(`[自動播放] 指定的開始索引 ${startIndex} 超出範圍 (${allItems.length} 個有效項目)。`); return; }

    // 初始化狀態
    itemsToProcess = allItems.slice(startIndex); // 使用通用變數
    totalItems = itemsToProcess.length; // 使用通用變數
    currentItemIndex = 0; // 使用通用變數
    isProcessing = true; isPaused = false;
    console.log(`[自動播放] 開始新的播放流程，從有效項目的第 ${startIndex + 1} 項開始，共 ${totalItems} 項。`);

    // 確保控制按鈕容器存在並顯示
    ensureControlsContainer();
    pauseButton.style.display = 'inline-block';
    pauseButton.textContent = '暫停';
    stopButton.style.display = 'inline-block';
    statusDisplay.style.display = 'inline-block';
    updateStatusDisplay();

    // 開始處理流程
    processItemsSequentially(); // 調用通用處理函數
  }

  // pausePlayback
  function pausePlayback() {
    console.log(`[自動播放] 暫停/繼續 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing) return;
    if (!isPaused) { // 執行暫停
      isPaused = true; pauseButton.textContent = '繼續'; updateStatusDisplay(); console.log("[自動播放] 執行暫停。");
      if (currentSleepController) currentSleepController.cancel('paused');
      if (currentPausedHighlightElement) currentPausedHighlightElement.classList.add(ROW_PAUSED_HIGHLIGHT_CLASS);
      else console.warn("[自動播放] 按鈕暫停，但找不到當前高亮目標元素。");
      // 列表頁暫停時不需要關閉 Modal
      if (!isListPage) closeModal(); // 表格頁暫停時關閉 Modal
    } else { startPlayback(); } // 從暫停恢復
  }

  // stopPlayback
  function stopPlayback() {
    console.log(`[自動播放] 停止 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing && !isPaused) return;
    isProcessing = false; isPaused = false;
    if (currentSleepController) currentSleepController.cancel('stopped');
    if (!isListPage) closeModal(); // 只有表格頁需要關閉 Modal
    resetTriggerButton(); updateStatusDisplay();
  }

  // updateStatusDisplay
  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing && itemsToProcess.length > 0 && itemsToProcess[currentItemIndex]) { // 使用通用變數
        const currentBatchProgress = `(${currentItemIndex + 1}/${totalItems})`; // 使用通用變數
        statusDisplay.textContent = !isPaused ? `處理中 ${currentBatchProgress}` : `已暫停 ${currentBatchProgress}`;
      } else { statusDisplay.textContent = ''; }
    }
  }

  // resetTriggerButton
  function resetTriggerButton() {
    console.log("[自動播放] 重置按鈕狀態。");
    isProcessing = false; isPaused = false; currentItemIndex = 0; totalItems = 0; itemsToProcess = []; // 使用通用變數

    const buttonContainer = document.getElementById(CONTROLS_CONTAINER_ID);
    if (buttonContainer) buttonContainer.remove();

    if (rowHighlightTimeout) clearTimeout(rowHighlightTimeout);
    document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}, .${ROW_PAUSED_HIGHLIGHT_CLASS}`).forEach(el => {
      el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN, ROW_PAUSED_HIGHLIGHT_CLASS);
      el.style.backgroundColor = ''; el.style.transition = ''; el.style.animation = '';
    });
    currentPausedHighlightElement = null;
    if (!isListPage) closeModal(); // 只有表格頁需要關閉 Modal
  }

  // 表格/列表列播放按鈕點擊處理 (通用)
  async function handleRowPlayButtonClick(event) {
    const button = event.currentTarget;
    const rowIndex = parseInt(button.dataset.rowIndex, 10); // 這是過濾前的原始索引
    if (isNaN(rowIndex)) { console.error("[自動播放] 無法獲取有效的列索引。"); return; }
    if (isProcessing && !isPaused) { alert("目前正在播放中，請先停止或等待完成才能從指定列開始。"); return; }
    if (isProcessing && isPaused) { console.log("[自動播放] 偵測到處於暫停狀態，先停止當前流程..."); stopPlayback(); await sleep(100); }

    // 將原始索引轉換為過濾後列表的索引
    let targetStartIndex = -1;
    const filteredItems = []; // 臨時存儲過濾後的項目信息（只需要知道索引即可）
    let tempGlobalRowIndex = 0;

    if (isListPage) {
      // --- 處理列表頁 ---
      const listContainer = document.querySelector(LIST_CONTAINER_SELECTOR);
      if (listContainer) {
        const listItems = listContainer.querySelectorAll(LIST_ITEM_SELECTOR);
        listItems.forEach(li => {
          const audioButton = li.querySelector(AUDIO_INDICATOR_SELECTOR);
          if (audioButton) {
            if (tempGlobalRowIndex === rowIndex) { targetStartIndex = filteredItems.length; }
            filteredItems.push({}); // 只需佔位符來計算索引
          }
          tempGlobalRowIndex++;
        });
      }
    } else {
      // --- 處理表格頁 ---
      const linkSelector = getLinkSelector();
      const visibleTables = getVisibleTables();
      visibleTables.forEach(table => {
        const isWideTable = table.matches(WIDE_TABLE_SELECTOR); const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR); const rows = table.querySelectorAll('tbody tr');
        if (isWideTable) { rows.forEach(row => { const firstTd = row.querySelector('td:first-of-type'); if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) { const linkElement = row.querySelector(linkSelector); const thirdTd = row.querySelector('td:nth-of-type(3)'); const hasAudioIndicator = thirdTd && thirdTd.querySelector(AUDIO_INDICATOR_SELECTOR); if (linkElement && hasAudioIndicator) { if (tempGlobalRowIndex === rowIndex) { targetStartIndex = filteredItems.length; } filteredItems.push({}); } tempGlobalRowIndex++; } }); }
        else if (isNarrowTable && rows.length >= 1) { const firstRow = rows[0]; const firstRowTd = firstRow.querySelector('td:first-of-type'); if (firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) { let linkElement = null; if (rows.length >= 2) { const secondRowTd = rows[1].querySelector('td:first-of-type'); if (secondRowTd) linkElement = secondRowTd.querySelector(linkSelector); } if (linkElement) { const thirdTr = table.querySelector('tbody tr:nth-of-type(3)'); const hasAudioIndicator = thirdTr && thirdTr.querySelector(AUDIO_INDICATOR_SELECTOR); if (hasAudioIndicator) { if (tempGlobalRowIndex === rowIndex) { targetStartIndex = filteredItems.length; } filteredItems.push({}); } } tempGlobalRowIndex++; } }
      });
    }

    if (targetStartIndex !== -1) { console.log(`[自動播放] 點擊原始索引 ${rowIndex}，對應過濾後列表索引 ${targetStartIndex}。`); startPlayback(targetStartIndex); }
    else { console.error(`[自動播放] 無法從原始索引 ${rowIndex} 找到對應的有效項目。可能該項已被過濾。`); alert(`無法從第 ${rowIndex + 1} 項開始播放，可能該項無音檔已被過濾。`); }
  }

  // 確保 Font Awesome 加載
  function ensureFontAwesome() {
    if (!document.getElementById('userscript-fontawesome-css')) {
      const link = document.createElement('link'); link.id = 'userscript-fontawesome-css'; link.rel = 'stylesheet'; link.href = FONT_AWESOME_URL; link.integrity = FONT_AWESOME_INTEGRITY; link.crossOrigin = 'anonymous'; link.referrerPolicy = 'no-referrer';
      document.head.appendChild(link); console.log('[自動播放] Font Awesome CSS 已注入。');
    }
  }

  // 注入或更新單個按鈕 (通用)
  function injectOrUpdateButton(targetElement, insertLocation, rowIndex, hasAudio) {
    const buttonClass = 'userscript-row-play-button';
    let button = targetElement.querySelector(`:scope > .${buttonClass}`); // 查找直接子元素按鈕

    if (!insertLocation) { console.error(`[自動播放][按鈕注入] 錯誤：目標插入位置 (項目 ${rowIndex + 1}) 無效！`, targetElement); return; }

    if (!hasAudio) { // 無音檔則移除或不注入
      if (button) { console.log(`[自動播放][按鈕注入] 項目 ${rowIndex + 1} 無音檔指示符，移除按鈕。`); button.remove(); }
      return;
    }

    // --- 如果有音檔，則注入或更新按鈕 ---
    const playButtonBaseStyle = ` background-color: #28a745; color: white; border: none; border-radius: 4px; padding: 2px 6px; margin: 0 4px; cursor: pointer; font-size: 12px; line-height: 1; vertical-align: middle; transition: background-color 0.2s ease; display: inline-block; `; // 添加 display
    const buttonTitle = `從此列開始播放 (第 ${rowIndex + 1} 項)`;

    if (button) { // 更新現有
      if (button.dataset.rowIndex !== String(rowIndex)) { button.dataset.rowIndex = rowIndex; button.title = buttonTitle; }
      // 確保按鈕在正確的位置
      if (isListPage) { // 列表頁：插入到 h2 開頭
        if (button.parentElement !== insertLocation || insertLocation.firstChild !== button) {
          insertLocation.insertBefore(button, insertLocation.firstChild);
        }
      } else { // 表格頁：插入到 td 中 span 後面
        const numberSpan = insertLocation.querySelector('span.fw-normal');
        if (numberSpan && button.previousSibling !== numberSpan) {
          insertLocation.insertBefore(button, numberSpan.nextSibling);
        } else if (!numberSpan && insertLocation.firstChild !== button) {
          insertLocation.insertBefore(button, insertLocation.firstChild);
        }
      }
    } else { // 添加新的
      button = document.createElement('button');
      button.className = buttonClass;
      button.style.cssText = playButtonBaseStyle;
      button.innerHTML = '<i class="fas fa-play"></i>';
      button.dataset.rowIndex = rowIndex;
      button.title = buttonTitle;
      button.addEventListener('click', handleRowPlayButtonClick);

      if (isListPage) { // 列表頁：插入到 h2 開頭
        insertLocation.insertBefore(button, insertLocation.firstChild);
      } else { // 表格頁：插入到 td 中 span 後面
        const numberSpan = insertLocation.querySelector('span.fw-normal');
        if (numberSpan && numberSpan.nextSibling) { insertLocation.insertBefore(button, numberSpan.nextSibling); }
        else if (numberSpan) { insertLocation.appendChild(button); }
        else { insertLocation.insertBefore(button, insertLocation.firstChild); }
      }
      // console.log(`[自動播放][按鈕注入] 已為項目 ${rowIndex + 1} 添加新按鈕 (因為有音檔)。`);
    }
  }

  // 注入表格/列表列播放按鈕 (通用)
  function injectRowPlayButtons() {
    if (!checkPageType()) { console.log("[自動播放][injectRowPlayButtons] 無法確定頁面類型或找不到容器，無法注入按鈕。"); return; }

    const playButtonHoverStyle = `.userscript-row-play-button:hover { background-color: #218838 !important; }`; GM_addStyle(playButtonHoverStyle);
    const buttonClass = 'userscript-row-play-button';

    // ** 修正：移除舊按鈕 (通用選擇器) **
    const oldButtonsSelector = CONTAINER_SELECTOR.split(',')
      .map(s => `${s.trim()} .${buttonClass}`)
      .join(', ');
    const buttonsToRemove = document.querySelectorAll(oldButtonsSelector);
    buttonsToRemove.forEach(btn => btn.remove());
    console.log(`[自動播放][injectRowPlayButtons] 已移除 ${buttonsToRemove.length} 個舊的行播放按鈕 (使用選擇器: ${oldButtonsSelector})。`);

    let globalRowIndex = 0; // 這個索引現在代表原始頁面中的項目號
    let injectedCount = 0; // 計算實際注入的按鈕數

    if (isListPage) {
      // --- 處理列表頁 ---
      const listContainer = document.querySelector(LIST_CONTAINER_SELECTOR);
      if (listContainer) {
        const listItems = listContainer.querySelectorAll(LIST_ITEM_SELECTOR);
        listItems.forEach((li) => {
          const audioButton = li.querySelector(AUDIO_INDICATOR_SELECTOR);
          const h2 = li.querySelector('h2.h5'); // 找到 h2 作為插入目標
          if (h2) { // 必須有 h2 才能注入
            injectOrUpdateButton(li, h2, globalRowIndex, !!audioButton); // 傳遞 li, h2, index, hasAudio
            if (audioButton) injectedCount++;
          } else {
            console.warn(`[自動播放][按鈕注入][列表] 項目 ${globalRowIndex + 1} 缺少 h2 元素，無法注入按鈕。`);
          }
          globalRowIndex++;
        });
      } else { console.warn("[自動播放][按鈕注入][列表] 未找到列表容器。"); }
    } else {
      // --- 處理表格頁 ---
      const visibleTables = getVisibleTables();
      visibleTables.forEach((table, tableIndex) => {
        const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
        const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);
        const rows = table.querySelectorAll('tbody tr');

        if (isWideTable) {
          rows.forEach((row) => {
            const firstTd = row.querySelector('td:first-of-type');
            if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) {
              const thirdTd = row.querySelector('td:nth-of-type(3)');
              const hasAudio = thirdTd && thirdTd.querySelector(AUDIO_INDICATOR_SELECTOR);
              injectOrUpdateButton(row, firstTd, globalRowIndex, hasAudio); // 傳遞 row, td, index, hasAudio
              if (hasAudio) injectedCount++;
              globalRowIndex++;
            }
          });
        } else if (isNarrowTable && rows.length >= 1) {
          const firstRow = rows[0];
          const firstRowTd = firstRow.querySelector('td:first-of-type');
          const hasMarker = firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR);
          if (hasMarker) {
            let hasLink = false; // 表格頁還是基於連結判斷是否為有效項目
            if (rows.length >= 2) { const secondRowTd = rows[1].querySelector('td:first-of-type'); if (secondRowTd && secondRowTd.querySelector(getLinkSelector())) hasLink = true; }
            const thirdTr = table.querySelector('tbody tr:nth-of-type(3)');
            const hasAudio = thirdTr && thirdTr.querySelector(AUDIO_INDICATOR_SELECTOR);
            if (hasLink) { // 只有在是有效項目時才處理按鈕
              injectOrUpdateButton(firstRow, firstRowTd, globalRowIndex, hasAudio); // 傳遞 row, td, index, hasAudio
              if (hasAudio) injectedCount++;
            }
            globalRowIndex++;
          }
        } else {
          console.warn(`[自動播放][按鈕注入][表格] 表格 ${tableIndex + 1} 類型未知，跳過按鈕注入。`);
        }
      });
    }
    console.log(`[自動播放][injectRowPlayButtons] 已處理 ${globalRowIndex} 個項目，為其中 ${injectedCount} 個有音檔指示符的項目注入或更新了播放按鈕。`);
  }

  // createControlButtons (保持不變)
  function createControlButtons() {
    const buttonStyle = `padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 5px; transition: background-color 0.2s ease;`;
    pauseButton = document.createElement('button');
    pauseButton.id = 'auto-play-pause-button'; pauseButton.textContent = '暫停';
    Object.assign(pauseButton.style, { cssText: buttonStyle, backgroundColor: '#ffc107', color: 'black', display: 'none' });
    pauseButton.addEventListener('click', pausePlayback);
    stopButton = document.createElement('button');
    stopButton.id = 'auto-play-stop-button'; stopButton.textContent = '停止';
    Object.assign(stopButton.style, { cssText: buttonStyle, backgroundColor: '#dc3545', color: 'white', display: 'none' });
    stopButton.addEventListener('click', stopPlayback);
    statusDisplay = document.createElement('span');
    statusDisplay.id = 'auto-play-status';
    Object.assign(statusDisplay.style, { display: 'none', marginLeft: '10px', fontSize: '14px', verticalAlign: 'middle' });
  }

  // ensureControlsContainer (保持不變)
  function ensureControlsContainer() {
    let buttonContainer = document.getElementById(CONTROLS_CONTAINER_ID);
    if (!buttonContainer) {
      console.log("[自動播放] 創建控制按鈕容器...");
      buttonContainer = document.createElement('div'); buttonContainer.id = CONTROLS_CONTAINER_ID;
      Object.assign(buttonContainer.style, { position: 'fixed', top: '10px', left: '10px', zIndex: '10001', backgroundColor: 'rgba(255, 255, 255, 0.8)', padding: '5px 10px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' });
      if (pauseButton) buttonContainer.appendChild(pauseButton); if (stopButton) buttonContainer.appendChild(stopButton); if (statusDisplay) buttonContainer.appendChild(statusDisplay);
      document.body.appendChild(buttonContainer); GM_addStyle(CSS_CONTROLS_BUTTONS);
    }
    return buttonContainer;
  }

  // getLinkSelector (僅表格頁用)
  function getLinkSelector() {
    return window.location.href.includes('/zh-hant/') ? 'a[href^="/zh-hant/su/"]' : 'a[href^="/und-hani/su/"]';
  }

  // showMobileInteractionOverlay (保持不變)
  function showMobileInteractionOverlay() {
    if (document.getElementById(MOBILE_INTERACTION_BOX_ID) || document.getElementById(MOBILE_BG_OVERLAY_ID)) return;
    const bgOverlay = document.createElement('div'); bgOverlay.id = MOBILE_BG_OVERLAY_ID; document.body.appendChild(bgOverlay);
    const interactionBox = document.createElement('div'); interactionBox.id = MOBILE_INTERACTION_BOX_ID; interactionBox.textContent = '手機上請點擊後繼續播放'; Object.assign(interactionBox.style, { position: 'fixed', width: MODAL_WIDTH, height: MODAL_HEIGHT, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }); document.body.appendChild(interactionBox);
    const clickHandler = () => { const box = document.getElementById(MOBILE_INTERACTION_BOX_ID); const bg = document.getElementById(MOBILE_BG_OVERLAY_ID); if (box) box.remove(); if (bg) bg.remove(); initiateAutoPlayback(); };
    interactionBox.addEventListener('click', clickHandler, { once: true }); bgOverlay.addEventListener('click', clickHandler, { once: true });
    console.log("[自動播放] 已顯示行動裝置互動提示遮罩和提示框。");
  }

  // initiateAutoPlayback (保持不變)
  function initiateAutoPlayback() {
    console.log("[自動播放] 重新注入/更新行內播放按鈕以確保索引正確...");
    injectRowPlayButtons();
    setTimeout(() => { console.log("[自動播放] 自動啟動播放流程..."); startPlayback(0); }, 300);
  }

  // 檢查頁面類型
  function checkPageType() {
    const listContainer = document.querySelector(LIST_CONTAINER_SELECTOR);
    if (listContainer && listContainer.querySelector(LIST_ITEM_SELECTOR)) {
      isListPage = true;
      console.log("[自動播放] 偵測到列表頁面類型。");
      return true;
    }
    // 檢查表格是否存在作為後備
    const tableContainer = document.querySelector(CONTAINER_SELECTOR);
    if (tableContainer && tableContainer.querySelector('table')) {
      isListPage = false;
      console.log("[自動播放] 偵測到表格頁面類型。");
      return true;
    }
    console.warn("[自動播放] 無法確定頁面類型（未找到列表或表格容器）。");
    return false; // 無法確定
  }


  // 初始化
  function initialize() {
    if (window.autoPlayerInitialized) return;
    window.autoPlayerInitialized = true;

    isMobile = navigator.userAgent.toLowerCase().includes('mobile');
    console.log(`[自動播放] 初始化腳本 v4.26.1 ... isMobile: ${isMobile}`); // 更新版本號

    // 注入所有 CSS
    GM_addStyle(CSS_IFRAME_HIGHLIGHT + CSS_PAUSE_HIGHLIGHT + CSS_MOBILE_OVERLAY);
    ensureFontAwesome();
    checkPageType(); // 檢查頁面類型
    createControlButtons();
    setTimeout(injectRowPlayButtons, 1000); // 初始注入按鈕 (現在是通用的)

    // ResizeObserver 邏輯 (通用化)
    try {
      const resizeObserver = new ResizeObserver(entries => {
        clearTimeout(resizeDebounceTimeout);
        resizeDebounceTimeout = setTimeout(() => {
          console.log("[自動播放][ResizeObserver] Debounced: 偵測到尺寸變化...");
          const pageTypeChanged = checkPageType(); // 重新檢查頁面類型，以防動態變化
          injectRowPlayButtons(); // 重新注入按鈕
          // 捲動邏輯調整
          if (isProcessing && !isPaused && currentItemIndex < itemsToProcess.length) {
            const currentItem = itemsToProcess[currentItemIndex];
            let elementToScroll = null;
            if (isListPage) {
              elementToScroll = currentItem.element;
            } else {
              elementToScroll = findElementForLink(currentItem.url); // 表格頁還是用 URL 找
              if (elementToScroll && elementToScroll.tagName === 'TABLE') {
                // 窄表格捲動整個 table
              } else if (elementToScroll && elementToScroll.tagName === 'TD') {
                // 寬表格捲動 td (scrollIntoView 預設會捲動到元素可見)
              }
            }
            if (elementToScroll && document.body.contains(elementToScroll)) {
              console.log("[自動播放][ResizeObserver] 重新捲動到當前項目...");
              elementToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              console.warn("[自動播放][ResizeObserver] 未找到當前項目元素進行捲動:", currentItem);
            }
          }
        }, RESIZE_DEBOUNCE_MS);
      });
      resizeObserver.observe(document.body);
    } catch (e) { console.error("[自動播放] 無法啟動 ResizeObserver:", e); }

    // 自動啟動邏輯 (通用化檢查)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has(AUTOPLAY_PARAM)) {
      console.log(`[自動播放] 檢測到 URL 參數 "${AUTOPLAY_PARAM}"，準備自動啟動...`);
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete(AUTOPLAY_PARAM);
      history.replaceState(null, '', newUrl.toString());

      let elapsedTime = 0;
      const waitForContentAndStart = () => {
        console.log("[自動播放][等待] 檢查內容是否存在...");
        let contentExists = false;
        if (isListPage) {
          const listContainer = document.querySelector(LIST_CONTAINER_SELECTOR);
          contentExists = listContainer && listContainer.querySelector(LIST_ITEM_SELECTOR + ' ' + AUDIO_INDICATOR_SELECTOR);
        } else {
          const visibleTables = getVisibleTables();
          contentExists = visibleTables.some(table => table.querySelector('tbody tr ' + AUDIO_INDICATOR_SELECTOR)); // 簡化檢查，只要有音檔按鈕即可
        }

        if (contentExists) {
          console.log("[自動播放][等待] 內容已找到。");
          if (isMobile) {
            console.log("[自動播放] 偵測為行動裝置，顯示互動提示。");
            showMobileInteractionOverlay(); // 內部會調用 initiateAutoPlayback
          } else {
            console.log("[自動播放] 偵測為非行動裝置，直接啟動播放。");
            initiateAutoPlayback();
          }
        } else {
          elapsedTime += AUTO_START_CHECK_INTERVAL_MS;
          if (elapsedTime >= AUTO_START_MAX_WAIT_MS) { console.error("[自動播放][等待] 等待內容超時。"); alert("自動播放失敗：等待內容載入超時。"); }
          else { setTimeout(waitForContentAndStart, AUTO_START_CHECK_INTERVAL_MS); }
        }
      };
      // 初始檢查頁面類型後再開始等待
      if (checkPageType()) {
        setTimeout(waitForContentAndStart, 500);
      } else {
        // 如果初始無法確定類型，也嘗試等待一下
        setTimeout(() => {
          if (checkPageType()) {
            setTimeout(waitForContentAndStart, 500);
          } else {
            console.error("[自動播放][等待] 無法確定頁面類型，無法啟動自動播放。");
            alert("自動播放失敗：無法識別頁面內容結構。");
          }
        }, 1000);
      }
    }
  }

  // --- 確保 DOM 加載完成後執行 ---
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initialize);
  }

})();

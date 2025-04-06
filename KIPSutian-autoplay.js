// ==UserScript==
// @name         KIPSutian-autoplay
// @namespace    aiuanyu
// @version      4.21
// @description  自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放音檔(自動偵測時長)，主表格自動滾動高亮，**處理完畢後自動跳轉下一頁繼續播放(修正URL與啟動時機)**，可即時暫停/停止/點擊背景暫停/點擊表格列播放，並根據亮暗模式高亮按鈕。 **v4.21: 新增行動裝置自動播放前互動提示。**
// @author       Aiuanyu 愛灣語 + Gemini
// @match        http*://sutian.moe.edu.tw/und-hani/tshiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/hunlui/*
// @match        http*://sutian.moe.edu.tw/und-hani/siannuntiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/poosiu/poosiu/*/*
// @match        http*://sutian.moe.edu.tw/und-hani/tsongpitueh/*
// @match        http*://sutian.moe.edu.tw/und-hani/huliok/*
// @match        http*://sutian.moe.edu.tw/zh-hant/tshiau/*
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
  const DELAY_BETWEEN_CLICKS_MS = 200;
  const DELAY_BETWEEN_IFRAMES_MS = 200;
  const HIGHLIGHT_CLASS = 'userscript-audio-playing';
  const ROW_HIGHLIGHT_CLASS_MAIN = 'userscript-row-highlight'; // 主頁面高亮 class
  const ROW_PAUSED_HIGHLIGHT_CLASS = 'userscript-row-paused-highlight'; // 暫停時閃爍高亮 class
  const OVERLAY_ID = 'userscript-modal-overlay'; // iframe 的背景遮罩 ID
  const MOBILE_INTERACTION_BOX_ID = 'userscript-mobile-interaction-box'; // ** 修改：行動裝置互動提示 "框" 的 ID **
  const MOBILE_BG_OVERLAY_ID = 'userscript-mobile-bg-overlay'; // ** 新增：行動裝置互動提示的 "背景遮罩" ID **
  const ROW_HIGHLIGHT_COLOR = 'rgba(0, 255, 0, 0.1)'; // 播放中高亮顏色 (淡綠)
  const ROW_HIGHLIGHT_DURATION = 1500;
  const FONT_AWESOME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  const FONT_AWESOME_INTEGRITY = 'sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==';
  const AUTOPLAY_PARAM = 'autoplay';
  const PAGINATION_PARAMS = ['iahbe', 'pitsoo'];
  const AUTO_START_MAX_WAIT_MS = 10000;
  const AUTO_START_CHECK_INTERVAL_MS = 500;
  const TABLE_CONTAINER_SELECTOR = 'main.container-fluid div.mt-1.mb-5, main.container-fluid div.mt-1.mb-4, main.container-fluid div.mb-5';
  const ALL_TABLES_SELECTOR = TABLE_CONTAINER_SELECTOR.split(',')
    .map(s => `${s.trim()} > table`)
    .join(', ');
  const RELEVANT_ROW_MARKER_SELECTOR = 'td:first-of-type span.fw-normal';
  const WIDE_TABLE_SELECTOR = 'table.d-none.d-md-table';
  const NARROW_TABLE_SELECTOR = 'table.d-md-none';
  const RESIZE_DEBOUNCE_MS = 300;
  // ** 新增：行動裝置提示框顏色常數 **
  const MOBILE_BOX_BG_COLOR = '#aa96b7'; // iMazinGrace 紫 (亮色)
  const MOBILE_BOX_TEXT_COLOR = '#d9e2a9'; // iMazinGrace 綠 (亮色)
  const MOBILE_BOX_BG_COLOR_DARK = '#4a4a8a'; // 提示框背景色 (暗色) - 深薰衣草紫
  const MOBILE_BOX_TEXT_COLOR_DARK = '#EEEEEE'; // 提示框文字顏色 (暗色) - 淺灰
  const MOBILE_BG_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.6)'; // 背景遮罩顏色 (同 modal)

  // --- 適應亮暗模式的高亮樣式 ---
  const HIGHLIGHT_STYLE = `
        /* iframe 內按鈕高亮 - 亮色模式 */
        .${HIGHLIGHT_CLASS} {
            background-color: #FFF352 !important;
            color: black !important;
            outline: 2px solid #FFB800 !important;
            box-shadow: 0 0 10px #FFF352;
            transition: background-color 0.2s ease-in-out, outline 0.2s ease-in-out, color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        }
        /* iframe 內按鈕高亮 - 深色模式 */
        @media (prefers-color-scheme: dark) {
            .${HIGHLIGHT_CLASS} {
                background-color: #66b3ff !important;
                color: black !important;
                outline: 2px solid #87CEFA !important;
                box-shadow: 0 0 10px #66b3ff;
            }
        }

        /* 暫停時閃爍效果 - Keyframes */
        @keyframes userscriptPulseHighlight {
            0% { background-color: rgba(255, 193, 7, 0.2); } /* 黃色，較淡 */
            50% { background-color: rgba(255, 193, 7, 0.4); } /* 黃色，較深 */
            100% { background-color: rgba(255, 193, 7, 0.2); } /* 回到較淡 */
        }
        /* 暫停時閃爍效果 - Keyframes (深色模式) */
        @media (prefers-color-scheme: dark) {
             @keyframes userscriptPulseHighlight {
                0% { background-color: rgba(102, 179, 255, 0.3); } /* 藍色，較淡 */
                50% { background-color: rgba(102, 179, 255, 0.6); } /* 藍色，較深 */
                100% { background-color: rgba(102, 179, 255, 0.3); } /* 回到較淡 */
            }
        }
        /* 暫停時閃爍效果 - Class */
        .${ROW_PAUSED_HIGHLIGHT_CLASS} {
            animation: userscriptPulseHighlight 1.5s ease-in-out infinite;
        }

        /* 行動裝置互動 "背景遮罩" 樣式 */
        #${MOBILE_BG_OVERLAY_ID} {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background-color: ${MOBILE_BG_OVERLAY_COLOR}; /* 使用常數 */
            z-index: 10004; /* 比提示框低一層 */
            cursor: pointer; /* 讓背景也可點擊 */
        }

        /* 行動裝置互動 "提示框" 樣式 (亮色模式) */
        #${MOBILE_INTERACTION_BOX_ID} {
            position: fixed; /* 由 JS 設定 top/left/transform/width/height */
            background-color: ${MOBILE_BOX_BG_COLOR}; /* 使用常數 */
            color: ${MOBILE_BOX_TEXT_COLOR}; /* 使用常數 */
            display: flex; justify-content: center; align-items: center;
            font-size: 10vw; /* 調整字體大小以適應框體 */
            font-weight: bold; text-align: center;
            z-index: 10005; /* 比背景遮罩高 */
            cursor: pointer;
            padding: 20px;
            box-sizing: border-box;
            border-radius: 8px; /* 同 modal */
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3); /* 同 modal */
        }
        /* 行動裝置互動 "提示框" 樣式 (深色模式) */
        @media (prefers-color-scheme: dark) {
            #${MOBILE_INTERACTION_BOX_ID} {
                background-color: ${MOBILE_BOX_BG_COLOR_DARK}; /* 使用常數 */
                 color: ${MOBILE_BOX_TEXT_COLOR_DARK}; /* 使用常數 */
             }
        }
    `;
  // --- 配置結束 ---

  // --- 全局狀態變數 ---
  let isProcessing = false;
  let isPaused = false;
  let currentLinkIndex = 0;
  let totalLinks = 0;
  let currentSleepController = null;
  let currentIframe = null;
  let linksToProcess = [];
  let rowHighlightTimeout = null;
  let resizeDebounceTimeout = null;
  let currentPausedHighlightElement = null; // 用於追蹤暫停時要閃爍的元素
  let isMobile = false; // 是否為行動裝置標記

  // --- UI 元素引用 ---
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;
  let overlayElement = null; // iframe 的遮罩

  // --- Helper 函數 ---

  // 可中斷的延遲函數
  function interruptibleSleep(ms) {
    if (currentSleepController) {
      currentSleepController.cancel('overridden');
    }
    let timeoutId;
    let rejectFn;
    let resolved = false;
    let rejected = false;
    const promise = new Promise((resolve, reject) => {
      rejectFn = reject;
      timeoutId = setTimeout(() => {
        if (!rejected) {
          resolved = true;
          currentSleepController = null;
          resolve();
        }
      }, ms);
    });
    const controller = {
      promise: promise,
      cancel: (reason = 'cancelled') => {
        if (!resolved && !rejected) {
          rejected = true;
          clearTimeout(timeoutId);
          currentSleepController = null;
          const error = new Error(reason);
          error.isCancellation = true;
          error.reason = reason;
          rejectFn(error);
        }
      }
    };
    currentSleepController = controller;
    return controller;
  }

  // 普通延遲函數
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 獲取音檔時長 (毫秒)
  function getAudioDuration(audioUrl) {
    console.log(`[自動播放] 嘗試獲取音檔時長: ${audioUrl}`);
    return new Promise((resolve) => {
      if (!audioUrl) {
        console.warn("[自動播放] 無效的音檔 URL，使用後備延遲。");
        resolve(FALLBACK_DELAY_MS);
        return;
      }
      const audio = new Audio();
      audio.preload = 'metadata';
      const timer = setTimeout(() => {
        console.warn(`[自動播放] 獲取音檔 ${audioUrl} 元數據超時 (5秒)，使用後備延遲。`);
        cleanupAudio();
        resolve(FALLBACK_DELAY_MS);
      }, 5000);
      const cleanupAudio = () => {
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('error', onError);
        audio.src = ''; // 釋放資源
      };
      const onLoadedMetadata = () => {
        if (audio.duration && isFinite(audio.duration)) {
          const durationMs = Math.ceil(audio.duration * 1000) + DELAY_BUFFER_MS;
          console.log(`[自動播放] 獲取到音檔時長: ${audio.duration.toFixed(2)}s, 使用延遲: ${durationMs}ms`);
          cleanupAudio();
          resolve(durationMs);
        } else {
          console.warn(`[自動播放] 無法從元數據獲取有效時長 (${audio.duration})，使用後備延遲。`);
          cleanupAudio();
          resolve(FALLBACK_DELAY_MS);
        }
      };
      const onError = (e) => {
        console.error(`[自動播放] 加載音檔 ${audioUrl} 元數據時出錯:`, e);
        cleanupAudio();
        resolve(FALLBACK_DELAY_MS); // 出錯時也使用後備延遲
      };
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('error', onError);
      try {
        audio.src = audioUrl;
      } catch (e) {
        console.error(`[自動播放] 設置音檔 src 時發生錯誤 (${audioUrl}):`, e);
        cleanupAudio();
        resolve(FALLBACK_DELAY_MS);
      }
    });
  }

  // 在 Iframe 內部添加樣式
  function addStyleToIframe(iframeDoc, css) {
    try {
      const styleElement = iframeDoc.createElement('style');
      styleElement.textContent = css;
      iframeDoc.head.appendChild(styleElement);
      console.log("[自動播放] 已在 iframe 中添加高亮樣式。");
    } catch (e) {
      console.error("[自動播放] 無法在 iframe 中添加樣式:", e);
    }
  }

  // 背景遮罩點擊事件處理函數 (用於 iframe modal)
  function handleOverlayClick(event) {
    if (event.target !== overlayElement) return; // 確保點擊的是遮罩本身
    if (isProcessing && !isPaused) {
      console.log("[自動播放] 點擊背景遮罩，觸發暫停並關閉 Modal。");
      isPaused = true;
      pauseButton.textContent = '繼續';
      updateStatusDisplay();
      if (currentSleepController) currentSleepController.cancel('paused_overlay');
      // 添加暫停閃爍效果
      if (currentPausedHighlightElement) {
        currentPausedHighlightElement.classList.add(ROW_PAUSED_HIGHLIGHT_CLASS);
      } else { console.warn("[自動播放] 點擊遮罩暫停，但找不到當前高亮目標元素。"); }
      closeModal();
    }
  }

  // 顯示 Modal (Iframe + Overlay)
  function showModal(iframe) {
    // 確保 iframe 遮罩存在
    overlayElement = document.getElementById(OVERLAY_ID);
    if (!overlayElement) {
      overlayElement = document.createElement('div');
      overlayElement.id = OVERLAY_ID;
      overlayElement.style.position = 'fixed';
      overlayElement.style.top = '0';
      overlayElement.style.left = '0';
      overlayElement.style.width = '100vw';
      overlayElement.style.height = '100vh';
      overlayElement.style.backgroundColor = MOBILE_BG_OVERLAY_COLOR; // 使用統一的背景遮罩顏色
      overlayElement.style.zIndex = '9998';
      overlayElement.style.cursor = 'pointer';
      document.body.appendChild(overlayElement);
    }
    // 重新綁定事件
    overlayElement.removeEventListener('click', handleOverlayClick);
    overlayElement.addEventListener('click', handleOverlayClick);

    // 設定 iframe 樣式並添加到 body
    iframe.style.position = 'fixed';
    iframe.style.width = MODAL_WIDTH;
    iframe.style.height = MODAL_HEIGHT;
    iframe.style.top = '50%';
    iframe.style.left = '50%';
    iframe.style.transform = 'translate(-50%, -50%)';
    iframe.style.border = '1px solid #ccc';
    iframe.style.borderRadius = '8px';
    iframe.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.3)';
    iframe.style.backgroundColor = 'white';
    iframe.style.zIndex = '9999';
    iframe.style.opacity = '1';
    iframe.style.pointerEvents = 'auto';
    document.body.appendChild(iframe);
    currentIframe = iframe;
    console.log(`[自動播放] 已顯示 Modal iframe, id: ${currentIframe.id}`);
  }

  // 增強關閉 Modal (Iframe + Overlay) 的健壯性
  function closeModal() {
    // 移除 iframe
    if (currentIframe && currentIframe.parentNode) currentIframe.remove();
    currentIframe = null;
    // 移除遮罩
    if (overlayElement) {
      overlayElement.removeEventListener('click', handleOverlayClick);
      if (overlayElement.parentNode) overlayElement.remove();
      overlayElement = null;
    }
    // 取消 sleep
    if (currentSleepController) { currentSleepController.cancel('modal_closed'); currentSleepController = null; }
  }

  // 提取處理 iframe 內容的邏輯
  async function handleIframeContent(iframe, url, linkIndexInCurrentList) {
    let iframeDoc;
    try {
      await sleep(150);
      iframeDoc = iframe.contentWindow.document;
      addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);

      const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua');
      console.log(`[自動播放] 在 iframe (${iframe.id}) 中找到 ${audioButtons.length} 個播放按鈕`);

      if (audioButtons.length > 0) {
        for (let i = 0; i < audioButtons.length; i++) {
          if (!isProcessing) { console.log("[自動播放] 播放音檔前檢測到停止"); break; }
          while (isPaused && isProcessing) { await sleep(500); if (!isProcessing) break; } // 處理暫停
          if (!isProcessing || isPaused) { i--; continue; } // 再次檢查

          const button = audioButtons[i];
          if (!button || !iframeDoc.body.contains(button)) { console.warn(`[自動播放] 按鈕 ${i + 1} 失效，跳過。`); continue; }
          console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);

          // 解析音檔 URL 並獲取時長
          let actualDelayMs = FALLBACK_DELAY_MS;
          let audioSrc = null;
          let audioPath = null;
          const srcString = button.dataset.src;
          if (srcString) {
            try { const d = JSON.parse(srcString.replace(/&quot;/g, '"')); if (Array.isArray(d) && d.length > 0 && typeof d[0] === 'string') audioPath = d[0]; } catch (e) { if (typeof srcString === 'string' && srcString.trim().startsWith('/')) audioPath = srcString.trim(); }
          }
          if (audioPath) { try { audioSrc = new URL(audioPath, iframe.contentWindow.location.href).href; } catch (urlError) { audioSrc = null; } } else { audioSrc = null; }
          actualDelayMs = await getAudioDuration(audioSrc);

          // 決定 iframe 內部捲動目標
          let scrollTargetElement = button;
          const flexContainer = button.closest('div.d-flex.flex-row.align-items-baseline'), fs6Container = button.closest('div.mb-0.fs-6');
          if (flexContainer) { const h = iframeDoc.querySelector('h1#main'); if (h) scrollTargetElement = h; } else if (fs6Container) { const p = fs6Container.previousElementSibling; if (p && p.matches('span.mb-0')) scrollTargetElement = p; }
          if (scrollTargetElement && iframeDoc.body.contains(scrollTargetElement)) scrollTargetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(300);

          // 高亮、點擊、等待
          button.classList.add(HIGHLIGHT_CLASS); button.click(); console.log(`[自動播放] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);
          try { await interruptibleSleep(actualDelayMs).promise; } catch (error) { if (error.isCancellation) { if (iframeDoc.body.contains(button)) button.classList.remove(HIGHLIGHT_CLASS); break; } else { throw error; } } finally { currentSleepController = null; }
          if (iframeDoc.body.contains(button)) button.classList.remove(HIGHLIGHT_CLASS);
          if (!isProcessing) break;

          // 按鈕間等待
          if (i < audioButtons.length - 1) {
            try { await interruptibleSleep(DELAY_BETWEEN_CLICKS_MS).promise; } catch (error) { if (error.isCancellation) break; else throw error; } finally { currentSleepController = null; }
          }
          if (!isProcessing) break;
        }
      } else { console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕`); await sleep(1000); }
    } catch (error) { console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error); } finally { if (currentSleepController) { currentSleepController.cancel('content_handled_exit'); currentSleepController = null; } }
  }

  // 處理單一連結的入口函數
  async function processSingleLink(url, linkIndexInCurrentList) {
    console.log(`[自動播放] processSingleLink 開始: 列表索引 ${linkIndexInCurrentList} (第 ${linkIndexInCurrentList + 1} / ${totalLinks} 項) - ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    const iframeId = `auto-play-iframe-${Date.now()}`;
    let iframe = document.createElement('iframe');
    iframe.id = iframeId;

    return new Promise(async (resolve) => {
      if (!isProcessing) { resolve(); return; }
      let isUsingExistingIframe = false;
      if (currentIframe && currentIframe.contentWindow && currentIframe.contentWindow.location.href === url) {
        iframe = currentIframe; isUsingExistingIframe = true;
      } else {
        if (currentIframe) { closeModal(); await sleep(50); if (!isProcessing) { resolve(); return; } }
        showModal(iframe);
      }

      if (isUsingExistingIframe) { await handleIframeContent(iframe, url, linkIndexInCurrentList); resolve(); }
      else {
        iframe.onload = async () => { if (!isProcessing) { closeModal(); resolve(); return; } if (currentIframe !== iframe) { resolve(); return; } await handleIframeContent(iframe, url, linkIndexInCurrentList); resolve(); };
        iframe.onerror = (error) => { console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error); closeModal(); resolve(); };
        iframe.src = url;
      }
    });
  }

  // 輔助函數，根據 URL 查找對應的主頁面元素 (td 或 table)
  function findElementForLink(targetUrl) {
    if (!targetUrl) return null;
    const visibleTables = getVisibleTables(); const linkSelector = getLinkSelector(); let targetElement = null;
    for (const table of visibleTables) {
      const isWideTable = table.matches(WIDE_TABLE_SELECTOR), isNarrowTable = table.matches(NARROW_TABLE_SELECTOR); const rows = table.querySelectorAll('tbody tr');
      if (isWideTable) {
        for (const row of rows) {
          const firstTd = row.querySelector('td:first-of-type');
          if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) {
            const linkElement = row.querySelector(linkSelector);
            if (linkElement) { try { const linkHref = new URL(linkElement.getAttribute('href'), window.location.origin).href; if (linkHref === targetUrl) { targetElement = firstTd; break; } } catch (e) { console.error(`[自動播放][查找元素][寬] 處理連結 URL 時出錯:`, e, linkElement); } }
          }
        }
      } else if (isNarrowTable && rows.length >= 2) {
        const firstRowTd = rows[0].querySelector('td:first-of-type'), secondRowTd = rows[1].querySelector('td:first-of-type');
        if (firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR) && secondRowTd) {
          const linkElement = secondRowTd.querySelector(linkSelector);
          if (linkElement) { try { const linkHref = new URL(linkElement.getAttribute('href'), window.location.origin).href; if (linkHref === targetUrl) { targetElement = table; break; } } catch (e) { console.error(`[自動播放][查找元素][窄] 處理連結 URL 時出錯:`, e, linkElement); } }
        }
      }
      if (targetElement) break;
    }
    if (!targetElement) console.warn(`[自動播放][查找元素] 未能找到 URL 對應的元素: ${targetUrl}`);
    return targetElement;
  }


  // 循序處理連結列表 - 加入自動分頁邏輯
  async function processLinksSequentially() {
    console.log("[自動播放] processLinksSequentially 開始");
    while (currentLinkIndex < totalLinks && isProcessing) {
      // 處理暫停
      while (isPaused && isProcessing) { await sleep(500); if (!isProcessing) break; }
      if (!isProcessing) break;

      updateStatusDisplay();
      const linkInfo = linksToProcess[currentLinkIndex];
      console.log(`[自動播放] 準備處理連結 ${currentLinkIndex + 1}/${totalLinks} (全局索引 ${linkInfo.originalIndex}) - URL: ${linkInfo.url}`);

      // --- 查找、捲動和高亮主頁面元素 ---
      const targetElement = findElementForLink(linkInfo.url);
      let highlightTarget = null;

      // 清除之前的任何高亮效果
      if (rowHighlightTimeout) { clearTimeout(rowHighlightTimeout); rowHighlightTimeout = null; }
      document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}, .${ROW_PAUSED_HIGHLIGHT_CLASS}`).forEach(el => {
        el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN, ROW_PAUSED_HIGHLIGHT_CLASS);
        el.style.backgroundColor = ''; el.style.transition = ''; el.style.animation = '';
      });
      currentPausedHighlightElement = null; // 清除舊的暫停目標

      if (targetElement) {
        // 確定高亮目標 (tr)
        if (targetElement.tagName === 'TD') { highlightTarget = targetElement.closest('tr'); }
        else if (targetElement.tagName === 'TABLE') { highlightTarget = targetElement.querySelector('tbody tr:first-of-type'); }
        console.log(`[自動播放][主頁捲動/高亮] 正在處理項目 ${linkInfo.originalIndex + 1} 對應的元素`, targetElement, `高亮目標:`, highlightTarget);

        // 捲動到目標元素
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);

        // 應用常規高亮
        if (highlightTarget) {
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
        } else { console.warn(`[自動播放][主頁高亮] 未能確定項目 ${linkInfo.originalIndex + 1} 的高亮目標 (tr)。`); }
      } else { console.warn(`[自動播放][主頁捲動] 未能找到項目 ${linkInfo.originalIndex + 1} (URL: ${linkInfo.url}) 對應的元素進行捲動和高亮。`); }

      await sleep(200);
      if (!isProcessing || isPaused) continue;

      // 處理單個連結
      await processSingleLink(linkInfo.url, currentLinkIndex);
      if (!isProcessing) break;

      // 關閉 Modal (如果沒有暫停)
      if (!isPaused) closeModal();

      // 移動到下一個連結 (如果沒有暫停)
      if (!isPaused) currentLinkIndex++;
      else console.log(`[自動播放][偵錯] 處於暫停狀態，索引保持不變`);

      // 連結間的等待
      if (currentLinkIndex < totalLinks && isProcessing && !isPaused) {
        try { await interruptibleSleep(DELAY_BETWEEN_IFRAMES_MS).promise; } catch (error) { if (error.isCancellation) console.log(`[自動播放] 連結間等待被 '${error.reason}' 中斷。`); else throw error; } finally { currentSleepController = null; }
      }
      if (!isProcessing) break;
    } // --- while loop end ---

    console.log(`[自動播放][偵錯] processLinksSequentially 循環結束。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
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
      if (!foundNextPage) { alert("所有連結攏處理完畢！"); resetTriggerButton(); }
    } else { resetTriggerButton(); } // 停止或暫停結束時重置
  }

  // --- 控制按鈕事件處理 ---

  // 輔助函數，獲取當前可見的表格元素列表
  function getVisibleTables() {
    const allTables = document.querySelectorAll(ALL_TABLES_SELECTOR);
    return Array.from(allTables).filter(table => {
      try { const style = window.getComputedStyle(table); return style.display !== 'none' && style.visibility !== 'hidden'; }
      catch (e) { console.error("[自動播放] 檢查表格可見性時出錯:", e, table); return false; }
    });
  }

  // startPlayback
  function startPlayback(startIndex = 0) {
    console.log(`[自動播放] startPlayback 調用。 startIndex: ${startIndex}, isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (isProcessing && !isPaused) { console.warn("[自動播放][偵錯] 開始/繼續 按鈕被點擊，但 isProcessing 為 true 且 isPaused 為 false，不執行任何操作。"); return; }

    if (isProcessing && isPaused) { // 從暫停恢復
      isPaused = false; pauseButton.textContent = '暫停';
      // 移除暫停閃爍
      if (currentPausedHighlightElement) { currentPausedHighlightElement.classList.remove(ROW_PAUSED_HIGHLIGHT_CLASS); currentPausedHighlightElement.style.animation = ''; }
      updateStatusDisplay(); console.log("[自動播放] 從暫停狀態繼續。"); return;
    }

    // --- 首次啟動或從停止後重新啟動 ---
    const linkSelector = getLinkSelector(); const visibleTables = getVisibleTables(); if (visibleTables.length === 0) { alert("頁面上揣無目前顯示的結果表格！"); return; }
    const allLinks = []; let globalRowIndex = 0;
    visibleTables.forEach(table => {
      const isWideTable = table.matches(WIDE_TABLE_SELECTOR), isNarrowTable = table.matches(NARROW_TABLE_SELECTOR); const rows = table.querySelectorAll('tbody tr');
      if (isWideTable) { rows.forEach(row => { const firstTd = row.querySelector('td:first-of-type'); if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) { const linkElement = row.querySelector(linkSelector); if (linkElement) { try { allLinks.push({ url: new URL(linkElement.getAttribute('href'), window.location.origin).href, anchorElement: linkElement, originalIndex: globalRowIndex }); globalRowIndex++; } catch (e) { console.error(`[自動播放][連結][寬] 處理連結 URL 時出錯:`, e, linkElement); } } } }); }
      else if (isNarrowTable && rows.length >= 2) { const firstRowTd = rows[0].querySelector('td:first-of-type'), secondRowTd = rows[1].querySelector('td:first-of-type'); if (firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR) && secondRowTd) { const linkElement = secondRowTd.querySelector(linkSelector); if (linkElement) { try { allLinks.push({ url: new URL(linkElement.getAttribute('href'), window.location.origin).href, anchorElement: linkElement, originalIndex: globalRowIndex }); globalRowIndex++; } catch (e) { console.error(`[自動播放][連結][窄] 處理連結 URL 時出錯:`, e, linkElement); } } } }
      else { console.warn("[自動播放][連結] 發現未知類型的可見表格:", table); }
    });
    if (allLinks.length === 0) { alert("目前顯示的表格內底揣無詞目連結！"); return; }
    console.log(`[自動播放] 從 ${visibleTables.length} 個可見表格中找到 ${allLinks.length} 個連結。`);
    if (startIndex >= allLinks.length) { console.error(`[自動播放] 指定的開始索引 ${startIndex} 超出範圍 (${allLinks.length} 個連結)。`); return; }

    // 初始化狀態
    linksToProcess = allLinks.slice(startIndex); totalLinks = linksToProcess.length; currentLinkIndex = 0; isProcessing = true; isPaused = false;
    console.log(`[自動播放] 開始新的播放流程，從全局索引 ${startIndex} 開始，共 ${totalLinks} 項。`);

    // 更新 UI
    startButton.style.display = 'none'; pauseButton.style.display = 'inline-block'; pauseButton.textContent = '暫停'; stopButton.style.display = 'inline-block'; statusDisplay.style.display = 'inline-block';
    updateStatusDisplay();

    // 開始處理流程
    processLinksSequentially();
  }

  // pausePlayback
  function pausePlayback() {
    console.log(`[自動播放] 暫停/繼續 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing) return;

    if (!isPaused) { // 執行暫停
      isPaused = true; pauseButton.textContent = '繼續'; updateStatusDisplay(); console.log("[自動播放] 執行暫停。");
      if (currentSleepController) currentSleepController.cancel('paused');
      // 添加暫停閃爍
      if (currentPausedHighlightElement) currentPausedHighlightElement.classList.add(ROW_PAUSED_HIGHLIGHT_CLASS);
      else console.warn("[自動播放] 按鈕暫停，但找不到當前高亮目標元素。");
    } else { startPlayback(); } // 從暫停恢復
  }

  // stopPlayback
  function stopPlayback() {
    console.log(`[自動播放] 停止 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing && !isPaused) return;
    isProcessing = false; isPaused = false;
    if (currentSleepController) currentSleepController.cancel('stopped');
    closeModal(); resetTriggerButton(); updateStatusDisplay();
  }

  // updateStatusDisplay
  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing && linksToProcess.length > 0 && linksToProcess[currentLinkIndex]) {
        const currentBatchProgress = `(${currentLinkIndex + 1}/${totalLinks})`;
        statusDisplay.textContent = !isPaused ? `處理中 ${currentBatchProgress}` : `已暫停 ${currentBatchProgress}`;
      } else { statusDisplay.textContent = ''; }
    }
  }

  // resetTriggerButton
  function resetTriggerButton() {
    console.log("[自動播放] 重置按鈕狀態。");
    isProcessing = false; isPaused = false; currentLinkIndex = 0; totalLinks = 0; linksToProcess = [];
    if (startButton && pauseButton && stopButton && statusDisplay) {
      startButton.disabled = false; startButton.style.display = 'inline-block';
      pauseButton.style.display = 'none'; pauseButton.textContent = '暫停';
      stopButton.style.display = 'none'; statusDisplay.style.display = 'none'; statusDisplay.textContent = '';
    }
    if (rowHighlightTimeout) clearTimeout(rowHighlightTimeout);
    // 清除所有高亮
    document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}, .${ROW_PAUSED_HIGHLIGHT_CLASS}`).forEach(el => {
      el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN, ROW_PAUSED_HIGHLIGHT_CLASS);
      el.style.backgroundColor = ''; el.style.transition = ''; el.style.animation = '';
    });
    currentPausedHighlightElement = null;
    closeModal();
  }

  // 表格列播放按鈕點擊處理
  async function handleRowPlayButtonClick(event) {
    const button = event.currentTarget;
    const rowIndex = parseInt(button.dataset.rowIndex, 10);
    if (isNaN(rowIndex)) { console.error("[自動播放] 無法獲取有效的列索引。"); return; }
    if (isProcessing && !isPaused) { alert("目前正在播放中，請先停止或等待完成才能從指定列開始。"); return; }
    if (isProcessing && isPaused) { console.log("[自動播放] 偵測到處於暫停狀態，先停止當前流程..."); stopPlayback(); await sleep(100); }
    startPlayback(rowIndex);
  }

  // 確保 Font Awesome 加載
  function ensureFontAwesome() {
    if (!document.getElementById('userscript-fontawesome-css')) {
      const link = document.createElement('link');
      link.id = 'userscript-fontawesome-css'; link.rel = 'stylesheet'; link.href = FONT_AWESOME_URL; link.integrity = FONT_AWESOME_INTEGRITY; link.crossOrigin = 'anonymous'; link.referrerPolicy = 'no-referrer';
      document.head.appendChild(link);
      console.log('[自動播放] Font Awesome CSS 已注入。');
    }
  }

  // 輔助函數：注入或更新單個按鈕
  function injectOrUpdateButton(targetRow, targetTd, rowIndex) {
    const buttonClass = 'userscript-row-play-button';
    let button = targetRow.querySelector(`.${buttonClass}`);
    if (!targetTd) { console.error(`[自動播放][按鈕注入] 錯誤：目標 td (行 ${rowIndex + 1}) 無效！`, targetRow); return; }
    if (button) { // 更新現有
      if (button.dataset.rowIndex !== String(rowIndex)) { button.dataset.rowIndex = rowIndex; button.title = `從此列開始播放 (第 ${rowIndex + 1} 項)`; }
      if (button.parentElement !== targetTd) { targetTd.insertBefore(button, targetTd.querySelector('span.fw-normal')?.nextSibling || targetTd.firstChild); }
    } else { // 添加新的
      const playButtonBaseStyle = ` background-color: #28a745; color: white; border: none; border-radius: 4px; padding: 2px 6px; margin: 0 8px; cursor: pointer; font-size: 12px; line-height: 1; vertical-align: middle; transition: background-color 0.2s ease; `;
      button = document.createElement('button'); button.className = buttonClass; button.style.cssText = playButtonBaseStyle; button.innerHTML = '<i class="fas fa-play"></i>'; button.dataset.rowIndex = rowIndex; button.title = `從此列開始播放 (第 ${rowIndex + 1} 項)`; button.addEventListener('click', handleRowPlayButtonClick);
      const numberSpan = targetTd.querySelector('span.fw-normal');
      if (numberSpan && numberSpan.nextSibling) { targetTd.insertBefore(button, numberSpan.nextSibling); }
      else if (numberSpan) { targetTd.appendChild(button); }
      else { targetTd.insertBefore(button, targetTd.firstChild); }
    }
  }

  // 輔助函數：從行中移除按鈕 (目前未使用，但保留)
  function removeButtonFromRow(row) {
    const button = row.querySelector('.userscript-row-play-button');
    if (button) button.remove();
  }

  // 注入表格列播放按鈕
  function injectRowPlayButtons() {
    const visibleTables = getVisibleTables(); if (visibleTables.length === 0) { console.log("[自動播放][injectRowPlayButtons] 未找到任何當前可見的結果表格，無法注入列播放按鈕。"); return; }
    const playButtonHoverStyle = `.userscript-row-play-button:hover { background-color: #218838 !important; }`; GM_addStyle(playButtonHoverStyle);
    const buttonClass = 'userscript-row-play-button'; const containerSelectors = TABLE_CONTAINER_SELECTOR.split(',').map(s => s.trim()); const removeSelectorParts = containerSelectors.map(sel => `${sel} > table .${buttonClass}`); const removeSelector = removeSelectorParts.join(', '); console.log(`[自動播放][injectRowPlayButtons] 準備移除舊按鈕，使用修正後的選擇器: "${removeSelector}"`); const buttonsToRemove = document.querySelectorAll(removeSelector); buttonsToRemove.forEach(btn => btn.remove()); console.log(`[自動播放][injectRowPlayButtons] 已移除 ${buttonsToRemove.length} 個舊的行播放按鈕。`);
    let globalRowIndex = 0;
    visibleTables.forEach((table, tableIndex) => {
      const isWideTable = table.matches(WIDE_TABLE_SELECTOR), isNarrowTable = table.matches(NARROW_TABLE_SELECTOR); const rows = table.querySelectorAll('tbody tr');
      if (isWideTable) { rows.forEach((row) => { const firstTd = row.querySelector('td:first-of-type'); if (firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR)) { injectOrUpdateButton(row, firstTd, globalRowIndex); globalRowIndex++; } }); }
      else if (isNarrowTable && rows.length >= 1) { const firstRow = rows[0], firstRowTd = firstRow.querySelector('td:first-of-type'); const hasMarker = firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR); if (hasMarker) { let isValid = false; if (rows.length >= 2) { const secondRowTd = rows[1].querySelector('td:first-of-type'); if (secondRowTd && secondRowTd.querySelector(getLinkSelector())) isValid = true; } if (isValid) { injectOrUpdateButton(firstRow, firstRowTd, globalRowIndex); globalRowIndex++; } } }
      else { console.warn(`[自動播放][按鈕注入] 表格 ${tableIndex + 1} 類型未知，跳過按鈕注入。`); }
    });
    console.log(`[自動播放][injectRowPlayButtons] 已處理 ${globalRowIndex} 個有效項目，注入或更新播放按鈕。`);
  }

  // 添加觸發按鈕
  function addTriggerButton() {
    if (document.getElementById('auto-play-controls-container')) return;
    const buttonContainer = document.createElement('div'); buttonContainer.id = 'auto-play-controls-container'; Object.assign(buttonContainer.style, { position: 'fixed', top: '10px', left: '10px', zIndex: '10001', backgroundColor: 'rgba(255, 255, 255, 0.8)', padding: '5px 10px', borderRadius: '5px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }); const buttonStyle = `padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 5px; transition: background-color 0.2s ease;`;
    startButton = document.createElement('button'); startButton.id = 'auto-play-start-button'; startButton.textContent = '開始播放全部'; Object.assign(startButton.style, { cssText: buttonStyle, backgroundColor: '#28a745', color: 'white' }); startButton.addEventListener('click', () => startPlayback(0)); buttonContainer.appendChild(startButton);
    pauseButton = document.createElement('button'); pauseButton.id = 'auto-play-pause-button'; pauseButton.textContent = '暫停'; Object.assign(pauseButton.style, { cssText: buttonStyle, backgroundColor: '#ffc107', color: 'black', display: 'none' }); pauseButton.addEventListener('click', pausePlayback); buttonContainer.appendChild(pauseButton);
    stopButton = document.createElement('button'); stopButton.id = 'auto-play-stop-button'; stopButton.textContent = '停止'; Object.assign(stopButton.style, { cssText: buttonStyle, backgroundColor: '#dc3545', color: 'white', display: 'none' }); stopButton.addEventListener('click', stopPlayback); buttonContainer.appendChild(stopButton);
    statusDisplay = document.createElement('span'); statusDisplay.id = 'auto-play-status'; Object.assign(statusDisplay.style, { display: 'none', marginLeft: '10px', fontSize: '14px', verticalAlign: 'middle' }); buttonContainer.appendChild(statusDisplay);
    document.body.appendChild(buttonContainer);
    GM_addStyle(`#auto-play-controls-container button:disabled { opacity: 0.65; cursor: not-allowed; } #auto-play-start-button:hover:not(:disabled) { background-color: #218838 !important; } #auto-play-pause-button:hover:not(:disabled) { background-color: #e0a800 !important; } #auto-play-stop-button:hover:not(:disabled) { background-color: #c82333 !important; }`);
  }

  // 輔助函數，獲取當前應使用的連結選擇器
  function getLinkSelector() {
    return window.location.href.includes('/zh-hant/') ? 'a[href^="/zh-hant/su/"]' : 'a[href^="/und-hani/su/"]';
  }

  // ** v4.21 修改：顯示行動裝置互動遮罩 (包含背景和提示框) **
  function showMobileInteractionOverlay() {
    // 防止重複添加
    if (document.getElementById(MOBILE_INTERACTION_BOX_ID) || document.getElementById(MOBILE_BG_OVERLAY_ID)) {
      console.warn("[自動播放] 行動裝置互動遮罩已存在，取消添加。");
      return;
    }

    // 1. 創建背景遮罩
    const bgOverlay = document.createElement('div');
    bgOverlay.id = MOBILE_BG_OVERLAY_ID;
    // 樣式由 CSS 控制 (z-index: 10004)
    document.body.appendChild(bgOverlay);

    // 2. 創建提示框
    const interactionBox = document.createElement('div');
    interactionBox.id = MOBILE_INTERACTION_BOX_ID;
    interactionBox.textContent = '手機上請點擊後繼續播放'; // 提示文字
    // --- 由 JS 設定樣式以使用常數 ---
    interactionBox.style.position = 'fixed';
    interactionBox.style.width = MODAL_WIDTH;
    interactionBox.style.height = MODAL_HEIGHT;
    interactionBox.style.top = '50%';
    interactionBox.style.left = '50%';
    interactionBox.style.transform = 'translate(-50%, -50%)';
    // 其他樣式由 CSS 控制 (z-index: 10005)
    document.body.appendChild(interactionBox);

    // 3. 添加點擊事件 (點擊背景或提示框皆可)
    const clickHandler = () => {
      console.log("[自動播放] 行動裝置互動提示被點擊。");
      // 移除兩個遮罩
      const box = document.getElementById(MOBILE_INTERACTION_BOX_ID);
      const bg = document.getElementById(MOBILE_BG_OVERLAY_ID);
      if (box) box.remove();
      if (bg) bg.remove();
      // 啟動播放
      initiateAutoPlayback();
    };

    interactionBox.addEventListener('click', clickHandler, { once: true });
    bgOverlay.addEventListener('click', clickHandler, { once: true }); // 背景也加上一次性監聽

    console.log("[自動播放] 已顯示行動裝置互動提示遮罩和提示框。");
  }

  // ** v4.21 新增：封裝自動播放啟動邏輯 **
  function initiateAutoPlayback() {
    console.log("[自動播放] 重新注入/更新行內播放按鈕以確保索引正確...");
    injectRowPlayButtons();
    // 短暫延遲後啟動，確保按鈕渲染完成
    setTimeout(() => {
      console.log("[自動播放] 自動啟動播放流程...");
      startPlayback(0); // 從第一個連結開始
    }, 300);
  }


  // 初始化
  function initialize() {
    if (window.autoPlayerInitialized) return; // 防止重複初始化
    window.autoPlayerInitialized = true;

    // ** v4.21 偵測行動裝置 **
    isMobile = navigator.userAgent.toLowerCase().includes('mobile');
    console.log(`[自動播放] 初始化腳本 v4.21 ... isMobile: ${isMobile}`); // ** 維持 v4.21 **

    // 注入樣式
    GM_addStyle(HIGHLIGHT_STYLE); // ** v4.21 注入包含新樣式的 HIGHLIGHT_STYLE **
    ensureFontAwesome(); // 確保圖標字體加載

    // 添加控制按鈕
    addTriggerButton();

    // 初始注入行內播放按鈕 (延遲執行確保表格已渲染)
    setTimeout(injectRowPlayButtons, 1000);

    // 使用 ResizeObserver 監聽 RWD 變化
    try {
      const resizeObserver = new ResizeObserver(entries => {
        // 使用 debounce 避免短時間內重複觸發
        clearTimeout(resizeDebounceTimeout);
        resizeDebounceTimeout = setTimeout(() => {
          console.log("[自動播放][ResizeObserver] Debounced: 偵測到尺寸變化，重新注入按鈕並嘗試捲動...");
          injectRowPlayButtons(); // 重新注入按鈕以適應新佈局
          // 如果正在播放，嘗試捲動到當前項目
          const currentUrl = linksToProcess[currentLinkIndex]?.url;
          if (currentUrl && isProcessing && !isPaused) { // 只在處理中且非暫停時捲動
            const elementToScroll = findElementForLink(currentUrl);
            if (elementToScroll) {
              console.log("[自動播放][ResizeObserver] 找到元素，執行捲動:", elementToScroll);
              elementToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              console.warn("[自動播放][ResizeObserver] 未找到元素進行捲動:", currentUrl);
            }
          } else {
            console.log("[自動播放][ResizeObserver] 沒有當前連結 URL 或不在處理中，不執行捲動。");
          }
        }, RESIZE_DEBOUNCE_MS);
      });
      // 監聽 body 尺寸變化
      resizeObserver.observe(document.body);
      console.log("[自動播放] 已啟動 ResizeObserver 監聽 document.body 變化。");
    } catch (e) {
      console.error("[自動播放] 無法啟動 ResizeObserver:", e);
    }

    // ** v4.21 修改：自動啟動邏輯 **
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has(AUTOPLAY_PARAM)) {
      console.log(`[自動播放] 檢測到 URL 參數 "${AUTOPLAY_PARAM}"，準備自動啟動...`);
      // 從 URL 中移除 autoplay 參數，避免刷新頁面時再次觸發
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete(AUTOPLAY_PARAM);
      history.replaceState(null, '', newUrl.toString()); // 使用 replaceState 避免產生瀏覽歷史

      // 等待表格內容加載完成後再啟動
      let elapsedTime = 0;
      const waitForTableAndStart = () => {
        console.log("[自動播放][等待] 檢查可見表格和有效連結是否存在...");
        const linkSelector = getLinkSelector();
        const visibleTables = getVisibleTables();
        let linksExist = false;
        // 檢查是否有符合條件的連結存在
        visibleTables.forEach(table => {
          if (linksExist) return;
          const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
          const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);
          const rows = table.querySelectorAll('tbody tr');
          if (isWideTable) {
            linksExist = Array.from(rows).some(row => {
              const firstTd = row.querySelector('td:first-of-type');
              return firstTd && firstTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR) && row.querySelector(linkSelector);
            });
          } else if (isNarrowTable && rows.length >= 2) {
            const firstRowTd = rows[0].querySelector('td:first-of-type');
            const secondRowTd = rows[1].querySelector('td:first-of-type');
            linksExist = firstRowTd && firstRowTd.querySelector(RELEVANT_ROW_MARKER_SELECTOR) &&
              secondRowTd && secondRowTd.querySelector(linkSelector);
          }
        });

        if (linksExist) {
          console.log("[自動播放][等待] 可見表格和有效連結已找到。");
          // 根據是否為行動裝置決定行為
          if (isMobile) { // ** v4.21 判斷 **
            console.log("[自動播放] 偵測為行動裝置，顯示互動提示。");
            showMobileInteractionOverlay(); // 顯示遮罩，點擊後才會啟動播放
          } else {
            console.log("[自動播放] 偵測為非行動裝置，直接啟動播放。");
            initiateAutoPlayback(); // 直接啟動播放
          }
        } else { // 如果還沒找到連結
          elapsedTime += AUTO_START_CHECK_INTERVAL_MS;
          if (elapsedTime >= AUTO_START_MAX_WAIT_MS) {
            console.error("[自動播放][等待] 等待可見表格和有效連結超時。自動播放失敗。");
            alert("自動播放失敗：等待表格內容載入超時。");
          } else {
            console.log(`[自動播放][等待] 可見表格或有效連結未就緒，${AUTO_START_CHECK_INTERVAL_MS}ms 後重試...`);
            setTimeout(waitForTableAndStart, AUTO_START_CHECK_INTERVAL_MS);
          }
        }
      };
      // 稍作延遲後開始檢查，給頁面一點渲染時間
      setTimeout(waitForTableAndStart, 500);
    }
  }

  // --- 確保 DOM 加載完成後執行 ---
  // 使用 document.readyState 檢查，比 DOMContentLoaded 更可靠
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0); // 如果已完成，非同步執行初始化
  } else {
    document.addEventListener('DOMContentLoaded', initialize); // 否則等待 DOMContentLoaded
  }

})();

// ==UserScript==
// @name         KIPSutian-autoplay
// @namespace    aiuanyu
// @version      4.0
// @description  自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放音檔(自動偵測時長)，主表格自動滾動高亮，可即時暫停/停止/點擊背景暫停/點擊表格列播放，並根據亮暗模式高亮按鈕。
// @author       Aiuanyu 愛灣語 + Gemini
// @match        http*://sutian.moe.edu.tw/und-hani/tshiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/hunlui/*
// @match        http*://sutian.moe.edu.tw/und-hani/siannuntiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/tsongpitueh/*
// @match        http*://sutian.moe.edu.tw/und-hani/huliok/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest // 備用
// @connect      sutian.moe.edu.tw // 允許獲取音檔
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
  const OVERLAY_ID = 'userscript-modal-overlay';
  const ROW_HIGHLIGHT_COLOR = 'rgba(0, 255, 0, 0.1)'; // 表格列高亮顏色
  const ROW_HIGHLIGHT_DURATION = 1500; // 表格列高亮持續時間 (ms)
  const FONT_AWESOME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  const FONT_AWESOME_INTEGRITY = 'sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==';

  // --- 適應亮暗模式的高亮樣式 ---
  const HIGHLIGHT_STYLE = `
        /* 預設 (亮色模式) */
        .${HIGHLIGHT_CLASS} { background-color: #FFF352 !important; color: black !important; outline: 2px solid #FFB800 !important; box-shadow: 0 0 10px #FFF352; transition: background-color 0.2s ease-in-out, outline 0.2s ease-in-out, color 0.2s ease-in-out, box-shadow 0.2s ease-in-out; }
        /* 深色模式 */
        @media (prefers-color-scheme: dark) { .${HIGHLIGHT_CLASS} { background-color: #66b3ff !important; color: black !important; outline: 2px solid #87CEFA !important; box-shadow: 0 0 10px #66b3ff; } }
    `;
  // --- 配置結束 ---

  // --- 全局狀態變數 ---
  let isProcessing = false;
  let isPaused = false;
  let currentLinkIndex = 0; // ** 注意：這個索引是相對於 linksToProcess 列表的 **
  let totalLinks = 0;       // 當前處理列表的總數
  let currentSleepController = null;
  let currentIframe = null;
  let linksToProcess = [];  // ** 儲存當前要處理的連結對象 {url, anchorElement, tableRow} **
  let rowHighlightTimeout = null; // 用於清除表格行高亮

  // --- UI 元素引用 ---
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;
  let overlayElement = null;

  // --- Helper 函數 ---

  // 可中斷的延遲函數
  function interruptibleSleep(ms) {
    // (程式碼與 v3.7 相同)
    if (currentSleepController) { currentSleepController.cancel('overridden'); }
    let timeoutId; let rejectFn; let resolved = false; let rejected = false;
    const promise = new Promise((resolve, reject) => {
      rejectFn = reject;
      timeoutId = setTimeout(() => { if (!rejected) { resolved = true; currentSleepController = null; resolve(); } }, ms);
    });
    const controller = {
      promise: promise,
      cancel: (reason = 'cancelled') => {
        if (!resolved && !rejected) {
          rejected = true; clearTimeout(timeoutId); currentSleepController = null;
          const error = new Error(reason); error.isCancellation = true; error.reason = reason; rejectFn(error);
        }
      }
    };
    currentSleepController = controller; return controller;
  }

  // 普通延遲函數
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // 獲取音檔時長 (毫秒)
  function getAudioDuration(audioUrl) {
    // (程式碼與 v3.7 相同)
    console.log(`[自動播放] 嘗試獲取音檔時長: ${audioUrl}`);
    return new Promise((resolve) => {
      if (!audioUrl) { console.warn("[自動播放] 無效的音檔 URL，使用後備延遲。"); resolve(FALLBACK_DELAY_MS); return; }
      const audio = new Audio(); audio.preload = 'metadata';
      const timer = setTimeout(() => { console.warn(`[自動播放] 獲取音檔 ${audioUrl} 元數據超時 (5秒)，使用後備延遲。`); cleanupAudio(); resolve(FALLBACK_DELAY_MS); }, 5000);
      const cleanupAudio = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', onLoadedMetadata); audio.removeEventListener('error', onError); audio.src = ''; };
      const onLoadedMetadata = () => {
        if (audio.duration && isFinite(audio.duration)) { const durationMs = Math.ceil(audio.duration * 1000) + DELAY_BUFFER_MS; console.log(`[自動播放] 獲取到音檔時長: ${audio.duration.toFixed(2)}s, 使用延遲: ${durationMs}ms`); cleanupAudio(); resolve(durationMs); }
        else { console.warn(`[自動播放] 無法從元數據獲取有效時長 (${audio.duration})，使用後備延遲。`); cleanupAudio(); resolve(FALLBACK_DELAY_MS); }
      };
      const onError = (e) => { console.error(`[自動播放] 加載音檔 ${audioUrl} 元數據時出錯:`, e); cleanupAudio(); resolve(FALLBACK_DELAY_MS); };
      audio.addEventListener('loadedmetadata', onLoadedMetadata); audio.addEventListener('error', onError);
      try { audio.src = audioUrl; } catch (e) { console.error(`[自動播放] 設置音檔 src 時發生錯誤 (${audioUrl}):`, e); cleanupAudio(); resolve(FALLBACK_DELAY_MS); }
    });
  }

  // 在 Iframe 內部添加樣式
  function addStyleToIframe(iframeDoc, css) {
    // (程式碼與 v3.7 相同)
    try { const styleElement = iframeDoc.createElement('style'); styleElement.textContent = css; iframeDoc.head.appendChild(styleElement); console.log("[自動播放] 已在 iframe 中添加高亮樣式。"); }
    catch (e) { console.error("[自動播放] 無法在 iframe 中添加樣式:", e); }
  }

  // 背景遮罩點擊事件處理函數
  function handleOverlayClick(event) {
    // (程式碼與 v3.7 相同)
    if (event.target !== overlayElement) { console.log("[自動播放][偵錯] 點擊事件目標不是遮罩本身，忽略。", event.target); return; }
    console.log(`[自動播放][偵錯] handleOverlayClick 觸發。isProcessing: ${isProcessing}, isPaused: ${isPaused}, currentIframe: ${currentIframe ? currentIframe.id : 'null'}`);
    if (isProcessing && !isPaused) {
      console.log("[自動播放] 點擊背景遮罩，觸發暫停並關閉 Modal。");
      isPaused = true; pauseButton.textContent = '繼續'; updateStatusDisplay();
      if (currentSleepController) { console.log("[自動播放][偵錯] 正在取消當前的 sleep..."); currentSleepController.cancel('paused_overlay'); }
      else { console.log("[自動播放][偵錯] 點擊遮罩時沒有正在進行的 sleep 可取消。"); }
      closeModal();
    } else { console.log("[自動播放][偵錯] 點擊遮罩，但條件不滿足 (isProcessing 或 isPaused 狀態不對)。"); }
  }

  // 顯示 Modal (Iframe + Overlay)
  function showModal(iframe) {
    // (程式碼與 v3.7 相同)
    overlayElement = document.getElementById(OVERLAY_ID);
    if (!overlayElement) {
      overlayElement = document.createElement('div'); overlayElement.id = OVERLAY_ID; overlayElement.style.position = 'fixed'; overlayElement.style.top = '0'; overlayElement.style.left = '0'; overlayElement.style.width = '100vw'; overlayElement.style.height = '100vh'; overlayElement.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'; overlayElement.style.zIndex = '9998'; overlayElement.style.cursor = 'pointer'; document.body.appendChild(overlayElement); console.log("[自動播放][偵錯] 已創建背景遮罩元素。");
    } else { console.log("[自動播放][偵錯] 背景遮罩元素已存在。"); }
    overlayElement.removeEventListener('click', handleOverlayClick); console.log("[自動播放][偵錯] 已嘗試移除舊的遮罩點擊監聽器。");
    overlayElement.addEventListener('click', handleOverlayClick); console.log("[自動播放][偵錯] 已添加新的遮罩點擊監聽器。");
    iframe.style.position = 'fixed'; iframe.style.width = MODAL_WIDTH; iframe.style.height = MODAL_HEIGHT; iframe.style.top = '50%'; iframe.style.left = '50%'; iframe.style.transform = 'translate(-50%, -50%)'; iframe.style.border = '1px solid #ccc'; iframe.style.borderRadius = '8px'; iframe.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.3)'; iframe.style.backgroundColor = 'white'; iframe.style.zIndex = '9999'; iframe.style.opacity = '1'; iframe.style.pointerEvents = 'auto'; document.body.appendChild(iframe);
    currentIframe = iframe;
    console.log(`[自動播放] 已顯示 Modal iframe, id: ${currentIframe.id}`);
  }

  // 增強關閉 Modal (Iframe + Overlay) 的健壯性
  function closeModal() {
    // (程式碼與 v3.7 相同)
    console.log(`[自動播放][偵錯] closeModal 被調用。 currentIframe: ${currentIframe ? currentIframe.id : 'null'}, overlayElement: ${overlayElement ? 'exists' : 'null'}`);
    if (currentIframe && currentIframe.parentNode) { currentIframe.remove(); console.log("[自動播放] 已移除 iframe"); } else if (currentIframe) { console.log("[自動播放][偵錯] 嘗試移除 iframe 時，它已不在 DOM 中。"); }
    currentIframe = null;
    if (overlayElement) { overlayElement.removeEventListener('click', handleOverlayClick); if (overlayElement.parentNode) { overlayElement.remove(); console.log("[自動播放][偵錯] 已移除背景遮罩及其點擊監聽器。"); } else { console.log("[自動播放][偵錯] 嘗試移除遮罩時，它已不在 DOM 中。"); } overlayElement = null; } else { console.log("[自動播放][偵錯] 嘗試關閉 Modal 時，overlayElement 引用已為 null 或未找到元素。"); }
    if (currentSleepController) { console.log("[自動播放] 關閉 Modal 時取消正在進行的 sleep"); currentSleepController.cancel('modal_closed'); currentSleepController = null; }
  }

  // 處理單一連結的核心邏輯
  async function processSingleLink(url, linkIndexInCurrentList) {
    // linkIndexInCurrentList 是相對於當前 linksToProcess 列表的索引
    console.log(`[自動播放] processSingleLink 開始: 列表索引 ${linkIndexInCurrentList} (第 ${linkIndexInCurrentList + 1} / ${totalLinks} 項) - ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);

    // ** 在處理新連結前，先關閉可能存在的舊 modal **
    // ** 注意：如果是由按鈕暫停恢復，Modal 是故意留下的，不應該關閉 **
    // ** 只有在開始處理一個 *新的* 連結時才需要關閉舊的 **
    // ** 這個邏輯移到 processLinksSequentially 更合適 **
    // closeModal(); // 從這裡移除

    const iframeId = `auto-play-iframe-${Date.now()}`;
    const iframe = document.createElement('iframe'); iframe.id = iframeId;

    return new Promise(async (resolve) => {
      if (!isProcessing) { console.log("[自動播放][偵錯] processSingleLink 開始時 isProcessing 為 false，直接返回。"); resolve(); return; }

      // ** 只有在 currentIframe 不存在時才創建新的 Modal **
      // ** 如果是從按鈕暫停恢復，currentIframe 應該還存在 **
      if (!currentIframe) {
        console.log("[自動播放][偵錯] currentIframe 為 null，顯示新 Modal。");
        showModal(iframe); // 創建並顯示 Modal，賦值 currentIframe
      } else {
        console.log("[自動播放][偵錯] currentIframe 已存在 (可能從按鈕暫停恢復)，不重新顯示 Modal。");
        // 需要確保 currentIframe 指向的是正確的 iframe
        if (currentIframe.contentWindow.location.href !== url) {
          console.warn("[自動播放][偵錯] currentIframe 存在，但 URL 不匹配！可能狀態混亂，強制關閉並重新打開。");
          closeModal();
          await sleep(50); // 短暫等待確保關閉完成
          if (!isProcessing) { resolve(); return; } // 再次檢查狀態
          showModal(iframe); // 重新打開
        } else {
          // URL 匹配，繼續使用現有 iframe
          iframe = currentIframe; // 確保後續操作使用正確的 iframe 引用
        }
      }


      iframe.onload = async () => {
        // (onload 邏輯與 v3.7 相同)
        console.log(`[自動播放] Iframe 載入完成: ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
        if (!isProcessing) { console.log("[自動播放] Iframe 載入時發現已停止，關閉 Modal"); closeModal(); resolve(); return; }
        if (currentIframe !== iframe) { console.warn(`[自動播放][偵錯] Iframe onload 觸發，但 currentIframe (${currentIframe ? currentIframe.id : 'null'}) 與當前 iframe (${iframe.id}) 不符！中止此 iframe 處理。`); resolve(); return; }
        let iframeDoc;
        try {
          await sleep(150); iframeDoc = iframe.contentWindow.document; addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);
          const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua'); console.log(`[自動播放] 在 iframe 中找到 ${audioButtons.length} 個播放按鈕`);
          if (audioButtons.length > 0) {
            for (let i = 0; i < audioButtons.length; i++) {
              console.log(`[自動播放][偵錯] 進入音檔循環 ${i + 1}。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
              if (!isProcessing) { console.log("[自動播放] 播放音檔前檢測到停止"); break; }
              while (isPaused && isProcessing) { console.log(`[自動播放] 音檔循環 ${i + 1} 偵測到暫停，等待繼續...`); updateStatusDisplay(); await sleep(500); if (!isProcessing) break; }
              if (!isProcessing) break;
              if (isPaused) { console.log(`[自動播放][偵錯] sleep(500) 後仍然是暫停狀態，繼續等待。`); i--; continue; }
              const button = audioButtons[i]; if (!button || !iframeDoc.body.contains(button)) { console.warn(`[自動播放] 按鈕 ${i + 1} 失效，跳過。`); continue; }
              console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);
              let actualDelayMs = FALLBACK_DELAY_MS; let audioSrc = null; let audioPath = null; const srcString = button.dataset.src;
              if (srcString) { try { const parsedData = JSON.parse(srcString.replace(/&quot;/g, '"')); if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === 'string') { audioPath = parsedData[0]; } } catch (e) { if (typeof srcString === 'string' && srcString.trim().startsWith('/')) { audioPath = srcString.trim(); } } }
              if (audioPath) { try { const base = iframe.contentWindow.location.href; audioSrc = new URL(audioPath, base).href; } catch (urlError) { audioSrc = null; } } else { audioSrc = null; }
              actualDelayMs = await getAudioDuration(audioSrc);
              button.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(300);
              button.classList.add(HIGHLIGHT_CLASS); button.click(); console.log(`[自動播放] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);
              try { const sleepController = interruptibleSleep(actualDelayMs); await sleepController.promise; } catch (error) { if (error.isCancellation) { console.log(`[自動播放] 等待音檔 ${i + 1} 被 '${error.reason}' 中斷。`); if (iframeDoc.body.contains(button)) { button.classList.remove(HIGHLIGHT_CLASS); } break; } else { console.error("[自動播放] interruptibleSleep 發生意外錯誤:", error); } } finally { currentSleepController = null; }
              if (iframeDoc.body.contains(button) && button.classList.contains(HIGHLIGHT_CLASS)) { button.classList.remove(HIGHLIGHT_CLASS); }
              if (!isProcessing) break;
              if (i < audioButtons.length - 1) { console.log(`[自動播放] 播放下一個前等待 ${DELAY_BETWEEN_CLICKS_MS}ms`); try { const sleepController = interruptibleSleep(DELAY_BETWEEN_CLICKS_MS); await sleepController.promise; } catch (error) { if (error.isCancellation) { console.log(`[自動播放] 按鈕間等待被 '${error.reason}' 中斷。`); break; } else { throw error; } } finally { currentSleepController = null; } }
              if (!isProcessing) break;
            }
          } else { console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕`); await sleep(1000); }
        } catch (error) { console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error); }
        finally {
          console.log(`[自動播放][偵錯] processSingleLink finally 區塊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}, currentIframe: ${currentIframe ? currentIframe.id : 'null'}`);
          // ** 只有在 isProcessing 為 false (停止) 或 isPaused 為 false (正常完成) 時才關閉 Modal **
          if (!isProcessing || !isPaused) {
            console.log(`[自動播放] processSingleLink 結束，isProcessing: ${isProcessing}, isPaused: ${isPaused}。關閉 Modal`);
            closeModal();
          } else {
            console.log("[自動播放] processSingleLink 結束，處於暫停狀態，保持 Modal 開啟");
            if (currentSleepController) { console.warn("[自動播放][偵錯] processSingleLink 在暫停狀態結束，但 currentSleepController 仍存在，強制清除。"); currentSleepController.cancel('paused_exit'); currentSleepController = null; }
          }
          resolve();
        }
      }; // --- iframe.onload end ---

      // ** 只有在需要新 iframe 時才設置 src **
      if (currentIframe === iframe) { // 表示是新創建的 iframe
        iframe.onerror = (error) => { console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error); closeModal(); resolve(); };
        iframe.src = url;
      } else {
        // 如果是使用現有 iframe (從按鈕暫停恢復)，不需要重新設置 src 或 onerror
        // onload 也不會再次觸發，所以需要手動觸發後續邏輯？
        // 不對，onload 應該只在第一次加載時觸發。
        // 當從按鈕暫停恢復時，processSingleLink 應該直接進入 for 循環。
        // 這意味著上面 showModal 後的 onload 綁定邏輯需要調整。

        // ** 重新思考恢復邏輯 **
        // 當按鈕暫停恢復時，processSingleLink 被再次調用，但 currentIframe 存在。
        // 我們不需要執行 showModal 或綁定 onload。
        // 我們需要直接進入 try...catch...finally 塊來處理 audioButtons。
        // 這表示 processSingleLink 的結構需要改變。

        // ** 方案 B：保持 processSingleLink 結構，但在恢復時強制重新加載 iframe **
        // 這更簡單，雖然會從第一個音檔開始。
        console.log("[自動播放][偵錯] 從按鈕暫停恢復，強制重新加載 iframe 以簡化流程。");
        closeModal(); // 關閉舊的
        await sleep(50);
        if (!isProcessing) { resolve(); return; } // 再次檢查
        showModal(iframe); // 顯示新的
        iframe.onerror = (error) => { console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error); closeModal(); resolve(); };
        iframe.src = url; // 設置 src
      }
    }); // --- Promise end ---
  }


  // 循序處理連結列表 - 加入滾動和高亮
  async function processLinksSequentially() {
    console.log("[自動播放] processLinksSequentially 開始");
    while (currentLinkIndex < totalLinks && isProcessing) {
      while (isPaused && isProcessing) { console.log(`[自動播放] 主流程已暫停 (索引 ${currentLinkIndex})，等待繼續...`); updateStatusDisplay(); await sleep(500); if (!isProcessing) break; }
      if (!isProcessing) break;

      updateStatusDisplay();
      const linkInfo = linksToProcess[currentLinkIndex]; // 獲取當前連結信息 {url, anchorElement, tableRow}
      console.log(`[自動播放] 準備處理連結 ${currentLinkIndex + 1}/${totalLinks}`);

      // --- **表格滾動與高亮** ---
      if (linkInfo.tableRow) {
        console.log(`[自動播放][偵錯] 正在滾動到表格列 ${currentLinkIndex + 1}`);
        // 清除上一次的高亮 (如果有)
        if (rowHighlightTimeout) clearTimeout(rowHighlightTimeout);
        // 移除所有行的高亮樣式，以防萬一
        document.querySelectorAll('.userscript-row-highlight').forEach(row => {
          row.classList.remove('userscript-row-highlight');
          row.style.backgroundColor = ''; // 清除內聯樣式
          row.style.transition = '';
        });

        linkInfo.tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 短暫延遲等待滾動基本完成
        await sleep(300);
        // 添加高亮
        linkInfo.tableRow.classList.add('userscript-row-highlight'); // 使用 class 控制樣式
        linkInfo.tableRow.style.backgroundColor = ROW_HIGHLIGHT_COLOR;
        linkInfo.tableRow.style.transition = 'background-color 0.5s ease-out';
        console.log(`[自動播放][偵錯] 已高亮表格列 ${currentLinkIndex + 1}`);
        // 設置延時移除高亮
        const currentRow = linkInfo.tableRow; // 捕獲當前行引用
        rowHighlightTimeout = setTimeout(() => {
          if (currentRow) { // 確保行仍然存在
            currentRow.style.backgroundColor = '';
            // 等待背景色過渡完成後移除 class
            setTimeout(() => {
              if (currentRow) currentRow.classList.remove('userscript-row-highlight');
            }, 500); // 匹配過渡時間
          }
          rowHighlightTimeout = null;
        }, ROW_HIGHLIGHT_DURATION);
      }
      // --- **滾動高亮結束** ---

      // 等待一小段時間再打開 Modal
      await sleep(200);
      if (!isProcessing || isPaused) continue; // 如果在等待時狀態改變

      await processSingleLink(linkInfo.url, currentLinkIndex); // ** 注意：這裡的 currentLinkIndex 是列表索引 **
      if (!isProcessing) break;

      if (!isPaused) { console.log(`[自動播放][偵錯] 連結 ${currentLinkIndex + 1} 處理完畢，非暫停狀態，索引增加`); currentLinkIndex++; }
      else { console.log(`[自動播放][偵錯] 連結 ${currentLinkIndex + 1} 處理完畢，但處於暫停狀態，索引保持不變`); }

      if (currentLinkIndex < totalLinks && isProcessing && !isPaused) {
        console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 後處理下一個連結`);
        try { const sleepController = interruptibleSleep(DELAY_BETWEEN_IFRAMES_MS); await sleepController.promise; } catch (error) { if (error.isCancellation) { console.log(`[自動播放] 連結間等待被 '${error.reason}' 中斷。`); } else { throw error; } } finally { currentSleepController = null; }
      }
      if (!isProcessing) break;
    } // --- while loop end ---

    console.log(`[自動播放][偵錯] processLinksSequentially 循環結束。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    // 清除最後一次的高亮延時
    if (rowHighlightTimeout) clearTimeout(rowHighlightTimeout);
    document.querySelectorAll('.userscript-row-highlight').forEach(row => {
      row.classList.remove('userscript-row-highlight');
      row.style.backgroundColor = '';
      row.style.transition = '';
    });

    if (!isProcessing) { console.log("[自動播放] 處理流程被停止。"); resetTriggerButton(); }
    else if (!isPaused) { console.log("[自動播放] 所有連結處理完畢。"); alert("所有連結攏處理完畢！"); resetTriggerButton(); }
    else { console.log("[自動播放] 流程結束於暫停狀態。"); /* 維持 UI */ }
  }

  // --- 控制按鈕事件處理 ---

  // **修改 startPlayback 以保存表格行引用**
  function startPlayback(startIndex = 0) { // 允許指定開始索引
    console.log(`[自動播放] startPlayback 調用。 startIndex: ${startIndex}, isProcessing: ${isProcessing}, isPaused: ${isPaused}`);

    if (!isProcessing) { // ---- 首次開始或從停止後開始 ----
      const resultTable = document.querySelector('table.table.d-none.d-md-table'); if (!resultTable) { alert("揣無結果表格！"); return; }
      const linkElements = resultTable.querySelectorAll('tbody tr td a[href^="/und-hani/su/"]'); if (linkElements.length === 0) { alert("表格內底揣無詞目連結！"); return; }

      // **創建包含元素引用的完整列表**
      const allLinks = Array.from(linkElements).map((a, index) => ({
        url: new URL(a.getAttribute('href'), window.location.origin).href,
        anchorElement: a,
        tableRow: a.closest('tr'),
        originalIndex: index // 保存原始索引用於狀態顯示
      }));

      if (startIndex >= allLinks.length) {
        console.error(`[自動播放] 指定的開始索引 ${startIndex} 超出範圍。`);
        return;
      }

      // **設置當前要處理的列表和索引**
      linksToProcess = allLinks.slice(startIndex);
      totalLinks = linksToProcess.length; // 當前列表的總數
      currentLinkIndex = 0; // 相對於 linksToProcess 的索引
      isProcessing = true;
      isPaused = false;

      console.log(`[自動播放] 開始新的播放流程，從全局索引 ${startIndex} 開始，共 ${totalLinks} 項。`);

      // 更新 UI
      startButton.style.display = 'none'; pauseButton.style.display = 'inline-block'; pauseButton.textContent = '暫停'; stopButton.style.display = 'inline-block'; statusDisplay.style.display = 'inline-block';
      updateStatusDisplay(); // 更新狀態顯示
      processLinksSequentially(); // 啟動主流程

    } else if (isPaused) { // ---- 從暫停繼續 ----
      isPaused = false;
      pauseButton.textContent = '暫停'; updateStatusDisplay();
      console.log("[自動播放] 從暫停狀態繼續。");
      // 簡化後的邏輯：不需要做任何事，讓等待循環解除阻塞
    } else {
      console.warn("[自動播放][偵錯] 開始/繼續 按鈕被點擊，但 isProcessing 為 true 且 isPaused 為 false，不執行任何操作。");
    }
  }

  // pausePlayback
  function pausePlayback() {
    // (程式碼與 v3.7 相同)
    console.log(`[自動播放] 暫停/繼續 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (isProcessing) {
      if (!isPaused) { isPaused = true; pauseButton.textContent = '繼續'; updateStatusDisplay(); console.log("[自動播放] 執行暫停 (保持 Modal 開啟)。"); if (currentSleepController) { currentSleepController.cancel('paused'); } }
      else { startPlayback(); } // 調用 startPlayback 處理繼續
    } else { console.warn("[自動播放][偵錯] 暫停 按鈕被點擊，但 isProcessing 為 false，不執行任何操作。"); }
  }

  // stopPlayback
  function stopPlayback() {
    // (程式碼與 v3.7 相同)
    console.log(`[自動播放] 停止 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing && !isPaused) { console.log("[自動播放][偵錯] 停止按鈕點擊，但腳本已停止，不執行操作。"); return; }
    isProcessing = false; isPaused = false;
    if (currentSleepController) { currentSleepController.cancel('stopped'); }
    console.log(`[自動播放][偵錯][停止前] currentIframe: ${currentIframe ? currentIframe.id : 'null'}, overlayElement: ${overlayElement ? 'exists' : 'null'}`);
    closeModal();
    resetTriggerButton(); updateStatusDisplay();
  }

  // **修改 updateStatusDisplay 以顯示全局索引（可選）**
  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing && linksToProcess.length > 0 && linksToProcess[currentLinkIndex]) {
        // 嘗試獲取全局索引
        const globalIndex = linksToProcess[currentLinkIndex].originalIndex;
        const globalTotal = totalLinks + currentLinkIndex; // 估算全局總數 (可能有誤，如果不是從頭開始)
        // 顯示相對於當前列表的進度即可
        const currentBatchProgress = `(${currentLinkIndex + 1}/${totalLinks})`;

        if (!isPaused) {
          statusDisplay.textContent = `處理中 ${currentBatchProgress}`;
        } else {
          statusDisplay.textContent = `已暫停 ${currentBatchProgress}`;
        }
      } else {
        statusDisplay.textContent = ''; // 不在處理中則清空
      }
    }
  }


  // resetTriggerButton - 清除高亮
  function resetTriggerButton() {
    console.log("[自動播放] 重置按鈕狀態。");
    isProcessing = false; isPaused = false; currentLinkIndex = 0; totalLinks = 0; linksToProcess = [];
    if (startButton && pauseButton && stopButton && statusDisplay) { startButton.disabled = false; startButton.style.display = 'inline-block'; pauseButton.style.display = 'none'; pauseButton.textContent = '暫停'; stopButton.style.display = 'none'; statusDisplay.style.display = 'none'; statusDisplay.textContent = ''; }
    // 清除可能殘留的高亮
    if (rowHighlightTimeout) clearTimeout(rowHighlightTimeout);
    document.querySelectorAll('.userscript-row-highlight').forEach(row => {
      row.classList.remove('userscript-row-highlight');
      row.style.backgroundColor = '';
      row.style.transition = '';
    });
    closeModal();
  }

  // --- **新增**：表格列播放按鈕點擊處理 ---
  async function handleRowPlayButtonClick(event) {
    const button = event.currentTarget;
    const rowIndex = parseInt(button.dataset.rowIndex, 10); // 這是全局索引
    console.log(`[自動播放] 表格列播放按鈕點擊，全局列索引: ${rowIndex}`);

    if (isNaN(rowIndex)) { console.error("[自動播放] 無法獲取有效的列索引。"); return; }

    if (isProcessing && !isPaused) {
      console.log("[自動播放] 目前正在播放中，請先停止或等待完成才能從指定列開始。");
      alert("目前正在播放中，請先停止或等待完成才能從指定列開始。");
      return;
    }

    // 如果是暫停狀態，先停止當前流程
    if (isProcessing && isPaused) {
      console.log("[自動播放] 偵測到處於暫停狀態，先停止當前流程...");
      stopPlayback(); // stopPlayback 會重置 isProcessing, isPaused 等狀態
      await sleep(100); // 短暫等待確保狀態完全重置
    }

    // 直接調用 startPlayback 並傳入起始索引
    startPlayback(rowIndex);
  }

  // --- **新增**：確保 Font Awesome 加載 ---
  function ensureFontAwesome() {
    const faLinkId = 'userscript-fontawesome-css';
    if (!document.getElementById(faLinkId)) {
      const link = document.createElement('link');
      link.id = faLinkId;
      link.rel = 'stylesheet';
      link.href = FONT_AWESOME_URL;
      link.integrity = FONT_AWESOME_INTEGRITY;
      link.crossOrigin = 'anonymous';
      link.referrerPolicy = 'no-referrer';
      document.head.appendChild(link);
      console.log('[自動播放] Font Awesome CSS 已注入。');
    }
  }

  // --- **新增**：注入表格列播放按鈕 ---
  function injectRowPlayButtons() {
    const resultTable = document.querySelector('table.table.d-none.d-md-table');
    if (!resultTable) return;
    const rows = resultTable.querySelectorAll('tbody tr');
    const playButtonBaseStyle = `
            background-color: #28a745; /* Green */
            color: white;
            border: none;
            border-radius: 4px;
            padding: 2px 6px; /* Smaller padding */
            margin-right: 8px;
            cursor: pointer;
            font-size: 12px; /* Smaller icon */
            line-height: 1;
            vertical-align: middle; /* Align with text */
            transition: background-color 0.2s ease;
        `;
    // 使用 class 來應用 hover 效果，避免 ID 衝突
    const playButtonHoverStyle = `.userscript-row-play-button:hover { background-color: #218838 !important; }`;
    GM_addStyle(playButtonHoverStyle); // 添加 hover 樣式

    rows.forEach((row, index) => {
      const firstTd = row.querySelector('td:first-child');
      const numberSpan = firstTd ? firstTd.querySelector('span.fw-normal') : null;
      if (firstTd && numberSpan) {
        // 避免重複添加
        if (firstTd.querySelector('.userscript-row-play-button')) return;

        const playButton = document.createElement('button');
        playButton.className = 'userscript-row-play-button'; // 使用 class
        playButton.style.cssText = playButtonBaseStyle;
        playButton.innerHTML = '<i class="fas fa-play"></i>'; // Font Awesome icon
        playButton.dataset.rowIndex = index; // ** 儲存的是全局索引 **
        playButton.title = `從此列開始播放 (第 ${index + 1} 項)`;

        playButton.addEventListener('click', handleRowPlayButtonClick);

        firstTd.appendChild(playButton);
      }
    });
    console.log(`[自動播放] 已注入 ${rows.length} 個表格列播放按鈕。`);
  }


  // --- 添加觸發按鈕 ---
  function addTriggerButton() {
    // (程式碼與 v3.7 相同)
    if (document.getElementById('auto-play-controls-container')) return;
    const buttonContainer = document.createElement('div'); buttonContainer.id = 'auto-play-controls-container'; buttonContainer.style.position = 'fixed'; buttonContainer.style.top = '10px'; buttonContainer.style.left = '10px'; buttonContainer.style.zIndex = '10001'; buttonContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.8)'; buttonContainer.style.padding = '5px 10px'; buttonContainer.style.borderRadius = '5px'; buttonContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)'; const buttonStyle = `padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 5px; transition: background-color 0.2s ease;`;
    startButton = document.createElement('button'); startButton.id = 'auto-play-start-button'; startButton.textContent = '開始播放全部'; startButton.style.cssText = buttonStyle; startButton.style.backgroundColor = '#28a745'; startButton.style.color = 'white'; startButton.addEventListener('click', () => startPlayback(0)); buttonContainer.appendChild(startButton); // 默認從 0 開始
    pauseButton = document.createElement('button'); pauseButton.id = 'auto-play-pause-button'; pauseButton.textContent = '暫停'; pauseButton.style.cssText = buttonStyle; pauseButton.style.backgroundColor = '#ffc107'; pauseButton.style.color = 'black'; pauseButton.style.display = 'none'; pauseButton.addEventListener('click', pausePlayback); buttonContainer.appendChild(pauseButton);
    stopButton = document.createElement('button'); stopButton.id = 'auto-play-stop-button'; stopButton.textContent = '停止'; stopButton.style.cssText = buttonStyle; stopButton.style.backgroundColor = '#dc3545'; stopButton.style.color = 'white'; stopButton.style.display = 'none'; stopButton.addEventListener('click', stopPlayback); buttonContainer.appendChild(stopButton);
    statusDisplay = document.createElement('span'); statusDisplay.id = 'auto-play-status'; statusDisplay.style.display = 'none'; statusDisplay.style.marginLeft = '10px'; statusDisplay.style.fontSize = '14px'; statusDisplay.style.verticalAlign = 'middle'; buttonContainer.appendChild(statusDisplay); document.body.appendChild(buttonContainer);
    GM_addStyle(`#auto-play-controls-container button:disabled { opacity: 0.65; cursor: not-allowed; } #auto-play-start-button:hover:not(:disabled) { background-color: #218838 !important; } #auto-play-pause-button:hover:not(:disabled) { background-color: #e0a800 !important; } #auto-play-stop-button:hover:not(:disabled) { background-color: #c82333 !important; }`);
  }

  // --- 初始化 ---
  function initialize() {
    if (window.autoPlayerInitialized) return;
    window.autoPlayerInitialized = true;
    console.log("[自動播放] 初始化腳本 v4.0 ...");
    ensureFontAwesome(); // **確保 FA 已加載**
    addTriggerButton();
    // **延遲一點執行按鈕注入，確保表格已完全渲染**
    setTimeout(injectRowPlayButtons, 500);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(initialize, 0); } else { document.addEventListener('DOMContentLoaded', initialize); }

})();

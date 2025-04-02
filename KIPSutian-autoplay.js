// ==UserScript==
// @name    教育部臺語辭典 - 自動循序播放音檔 (偵錯恢復後關閉問題)
// @namespace   aiuanyu
// @version     3.9
// @description 自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放其中的音檔(自動偵測時長)，可即時暫停(不關閉Modal)/停止/點擊背景暫停(關閉Modal)，並根據亮暗模式高亮按鈕。增加恢復後關閉問題的偵錯 Log。
// @author      Aiuanyu 愛灣語 + Gemini
// @match       https://sutian.moe.edu.tw/und-hani/tshiau/*
// @grant       GM_addStyle
// @grant       GM_xmlhttpRequest // 備用
// @connect     sutian.moe.edu.tw // 允許獲取音檔
// @run-at      document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- 配置 ---
  const MODAL_WIDTH = '80vw';
  const MODAL_HEIGHT = '50vh';
  const FALLBACK_DELAY_MS = 3000;
  const DELAY_BUFFER_MS = 500;
  const DELAY_BETWEEN_CLICKS_MS = 750;
  const DELAY_BETWEEN_IFRAMES_MS = 1250;
  const HIGHLIGHT_CLASS = 'userscript-audio-playing';
  const OVERLAY_ID = 'userscript-modal-overlay';

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
  let currentLinkIndex = 0;
  let totalLinks = 0;
  let currentSleepController = null;
  let currentIframe = null; // ** 保持對當前 iframe 的引用非常重要 **
  let linksToProcess = [];

  // --- UI 元素引用 ---
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;
  let overlayElement = null;

  // --- Helper 函數 ---

  // 可中斷的延遲函數
  function interruptibleSleep(ms) {
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
    try { const styleElement = iframeDoc.createElement('style'); styleElement.textContent = css; iframeDoc.head.appendChild(styleElement); console.log("[自動播放] 已在 iframe 中添加高亮樣式。"); }
    catch (e) { console.error("[自動播放] 無法在 iframe 中添加樣式:", e); }
  }

  // 背景遮罩點擊事件處理函數
  function handleOverlayClick(event) {
    if (event.target !== overlayElement) { console.log("[自動播放][偵錯] 點擊事件目標不是遮罩本身，忽略。", event.target); return; }
    console.log(`[自動播放][偵錯] handleOverlayClick 觸發。isProcessing: ${isProcessing}, isPaused: ${isPaused}, currentIframe: ${currentIframe ? currentIframe.id : 'null'}`); // 增加 currentIframe 狀態 Log
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
    overlayElement = document.getElementById(OVERLAY_ID);
    if (!overlayElement) {
      overlayElement = document.createElement('div'); overlayElement.id = OVERLAY_ID; overlayElement.style.position = 'fixed'; overlayElement.style.top = '0'; overlayElement.style.left = '0'; overlayElement.style.width = '100vw'; overlayElement.style.height = '100vh'; overlayElement.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'; overlayElement.style.zIndex = '9998'; overlayElement.style.cursor = 'pointer'; document.body.appendChild(overlayElement); console.log("[自動播放][偵錯] 已創建背景遮罩元素。");
    } else { console.log("[自動播放][偵錯] 背景遮罩元素已存在。"); }
    overlayElement.removeEventListener('click', handleOverlayClick); console.log("[自動播放][偵錯] 已嘗試移除舊的遮罩點擊監聽器。");
    overlayElement.addEventListener('click', handleOverlayClick); console.log("[自動播放][偵錯] 已添加新的遮罩點擊監聽器。");
    iframe.style.position = 'fixed'; iframe.style.width = MODAL_WIDTH; iframe.style.height = MODAL_HEIGHT; iframe.style.top = '50%'; iframe.style.left = '50%'; iframe.style.transform = 'translate(-50%, -50%)'; iframe.style.border = '1px solid #ccc'; iframe.style.borderRadius = '8px'; iframe.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.3)'; iframe.style.backgroundColor = 'white'; iframe.style.zIndex = '9999'; iframe.style.opacity = '1'; iframe.style.pointerEvents = 'auto'; document.body.appendChild(iframe);
    currentIframe = iframe; // ** 確保在這裡賦值 **
    console.log(`[自動播放] 已顯示 Modal iframe, id: ${currentIframe.id}`);
  }

  // 增強關閉 Modal (Iframe + Overlay) 的健壯性
  function closeModal() {
    console.log(`[自動播放][偵錯] closeModal 被調用。 currentIframe: ${currentIframe ? currentIframe.id : 'null'}, overlayElement: ${overlayElement ? 'exists' : 'null'}`); // 增加 Log
    if (currentIframe && currentIframe.parentNode) {
      currentIframe.remove();
      console.log("[自動播放] 已移除 iframe");
    } else if (currentIframe) {
      console.log("[自動播放][偵錯] 嘗試移除 iframe 時，它已不在 DOM 中。");
    }
    currentIframe = null; // ** 確保清除引用 **

    if (overlayElement) {
      overlayElement.removeEventListener('click', handleOverlayClick);
      if (overlayElement.parentNode) {
        overlayElement.remove();
        console.log("[自動播放][偵錯] 已移除背景遮罩及其點擊監聽器。");
      } else {
        console.log("[自動播放][偵錯] 嘗試移除遮罩時，它已不在 DOM 中。");
      }
      overlayElement = null; // ** 確保清除引用 **
    } else {
      console.log("[自動播放][偵錯] 嘗試關閉 Modal 時，overlayElement 引用已為 null 或未找到元素。");
    }

    if (currentSleepController) {
      console.log("[自動播放] 關閉 Modal 時取消正在進行的 sleep");
      currentSleepController.cancel('modal_closed');
      currentSleepController = null;
    }
  }

  // 處理單一連結的核心邏輯
  async function processSingleLink(url, index) {
    console.log(`[自動播放] processSingleLink 開始: ${index + 1}/${totalLinks} - ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`); // 增加狀態 Log

    // ** 在處理新連結前，先關閉可能存在的舊 modal **
    closeModal();

    const iframeId = `auto-play-iframe-${Date.now()}`;
    const iframe = document.createElement('iframe'); iframe.id = iframeId;

    return new Promise(async (resolve) => {
      // ** 確保在 showModal 前狀態正確 **
      if (!isProcessing) {
        console.log("[自動播放][偵錯] processSingleLink 開始時 isProcessing 為 false，直接返回。");
        resolve();
        return;
      }
      showModal(iframe); // 創建並顯示 Modal，賦值 currentIframe

      iframe.onload = async () => {
        console.log(`[自動播放] Iframe 載入完成: ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
        if (!isProcessing) { console.log("[自動播放] Iframe 載入時發現已停止，關閉 Modal"); closeModal(); resolve(); return; }
        // ** 增加對 currentIframe 的檢查, 確保它和當前 onload 的 iframe 一致 **
        if (currentIframe !== iframe) {
          console.warn(`[自動播放][偵錯] Iframe onload 觸發，但 currentIframe (${currentIframe ? currentIframe.id : 'null'}) 與當前 iframe (${iframe.id}) 不符！可能已被關閉或覆蓋。中止此 iframe 處理。`);
          // 不要關閉 Modal，因為可能是新的 Modal 已經打開了
          resolve();
          return;
        }

        let iframeDoc;
        try {
          await sleep(150); iframeDoc = iframe.contentWindow.document; addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);
          const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua'); console.log(`[自動播放] 在 iframe 中找到 ${audioButtons.length} 個播放按鈕`);
          if (audioButtons.length > 0) {
            for (let i = 0; i < audioButtons.length; i++) {
              console.log(`[自動播放][偵錯] 進入音檔循環 ${i + 1}。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`); // 增加循環 Log
              if (!isProcessing) { console.log("[自動播放] 播放音檔前檢測到停止"); break; }
              // ** 關鍵的暫停等待循環 **
              while (isPaused && isProcessing) {
                console.log(`[自動播放] 音檔循環 ${i + 1} 偵測到暫停，等待繼續...`);
                updateStatusDisplay();
                await sleep(500); // 使用普通 sleep，因為 interruptibleSleep 會被外部取消
                // 在等待後再次檢查 isProcessing，以防在暫停時被停止
                if (!isProcessing) {
                  console.log("[自動播放] 在暫停等待期間檢測到停止");
                  break; // 跳出 while 和 for 循環
                }
              }
              if (!isProcessing) break; // 如果在暫停時停止，跳出 for 循環
              // ** 再次檢查 isPaused，因為可能在 sleep(500) 期間狀態改變了 **
              if (isPaused) {
                console.log(`[自動播放][偵錯] sleep(500) 後仍然是暫停狀態，繼續等待。`);
                i--; // 回到同一個按鈕，以便下次循環重新檢查
                continue;
              }
              // --- 狀態檢查結束 ---

              const button = audioButtons[i]; if (!button || !iframeDoc.body.contains(button)) { console.warn(`[自動播放] 按鈕 ${i + 1} 失效，跳過。`); continue; }
              console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);
              // --- data-src 解析 ---
              let actualDelayMs = FALLBACK_DELAY_MS; let audioSrc = null; let audioPath = null; const srcString = button.dataset.src;
              if (srcString) { try { const parsedData = JSON.parse(srcString.replace(/&quot;/g, '"')); if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === 'string') { audioPath = parsedData[0]; } } catch (e) { if (typeof srcString === 'string' && srcString.trim().startsWith('/')) { audioPath = srcString.trim(); } } }
              if (audioPath) { try { const base = iframe.contentWindow.location.href; audioSrc = new URL(audioPath, base).href; } catch (urlError) { audioSrc = null; } } else { audioSrc = null; }
              actualDelayMs = await getAudioDuration(audioSrc);
              // --- 解析結束 ---
              button.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(300);
              button.classList.add(HIGHLIGHT_CLASS); button.click(); console.log(`[自動播放] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);
              // --- 可中斷 sleep ---
              try { const sleepController = interruptibleSleep(actualDelayMs); await sleepController.promise; } catch (error) { if (error.isCancellation) { console.log(`[自動播放] 等待音檔 ${i + 1} 被 '${error.reason}' 中斷。`); if (iframeDoc.body.contains(button)) { button.classList.remove(HIGHLIGHT_CLASS); } break; } else { console.error("[自動播放] interruptibleSleep 發生意外錯誤:", error); } } finally { currentSleepController = null; }
              // --- 中斷 sleep 結束 ---
              if (iframeDoc.body.contains(button) && button.classList.contains(HIGHLIGHT_CLASS)) { button.classList.remove(HIGHLIGHT_CLASS); }
              if (!isProcessing) break;
              // --- 按鈕間等待 ---
              if (i < audioButtons.length - 1) { console.log(`[自動播放] 播放下一個前等待 ${DELAY_BETWEEN_CLICKS_MS}ms`); try { const sleepController = interruptibleSleep(DELAY_BETWEEN_CLICKS_MS); await sleepController.promise; } catch (error) { if (error.isCancellation) { console.log(`[自動播放] 按鈕間等待被 '${error.reason}' 中斷。`); break; } else { throw error; } } finally { currentSleepController = null; } }
              // --- 按鈕間等待結束 ---
              if (!isProcessing) break;
            } // --- for audioButtons loop end ---
          } else { console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕`); await sleep(1000); }
        } catch (error) { console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error); }
        finally {
          console.log(`[自動播放][偵錯] processSingleLink finally 區塊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
          if (!isPaused && isProcessing) { // 修改後的條件
            console.log("[自動播放] processSingleLink 結束，非暫停狀態，但仍在處理中，保持 Modal 開啟");
          } else if (!isPaused && !isProcessing) {
            console.log("[自動播放] processSingleLink 結束，非暫停狀態且已停止，關閉 Modal");
            closeModal();
          } else {
            console.log("[自動播放] processSingleLink 結束，處於暫停狀態，保持 Modal 開啟");
            if (currentSleepController) {
              console.warn("[自動播放][偵錯] processSingleLink 在暫停狀態結束，但 currentSleepController 仍存在，強制清除。");
              currentSleepController.cancel('paused_exit');
              currentSleepController = null;
            }
          }
          resolve();
        }
      };
      iframe.onerror = (error) => { console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error); closeModal(); resolve(); };
      iframe.src = url;
    });
  }

  // 循序處理連結列表
  async function processLinksSequentially() {
    console.log("[自動播放] processLinksSequentially 開始");
    while (currentLinkIndex < totalLinks && isProcessing) {
      // ** 關鍵的暫停等待循環 **
      while (isPaused && isProcessing) {
        console.log(`[自動播放] 主流程已暫停 (索引 ${currentLinkIndex})，等待繼續...`);
        updateStatusDisplay();
        await sleep(500); // 使用普通 sleep
        if (!isProcessing) break; // 檢查在暫停等待期間是否被停止
      }
      if (!isProcessing) break; // 如果在暫停時停止，跳出主循環

      updateStatusDisplay(); const linkInfo = linksToProcess[currentLinkIndex]; console.log(`[自動播放] 準備處理連結 ${currentLinkIndex + 1}/${totalLinks}`);
      await processSingleLink(linkInfo.url, currentLinkIndex);
      if (!isProcessing) break; // 檢查 processSingleLink 後是否被停止

      // 只有在沒有暫停的情況下才移動到下一個連結
      if (!isPaused) {
        console.log(`[自動播放][偵錯] 連結 ${currentLinkIndex + 1} 處理完畢，非暫停狀態，索引增加`);
        currentLinkIndex++;
      } else {
        console.log(`[自動播放][偵錯] 連結 ${currentLinkIndex + 1} 處理完畢，但處於暫停狀態，索引保持不變`);
        // isPaused 仍然為 true，外層 while 循環會在下一次迭代時繼續等待
      }

      // 連結間的等待 (只有在非暫停且還有連結時執行)
      if (currentLinkIndex < totalLinks && isProcessing && !isPaused) {
        console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 後處理下一個連結`);
        try { const sleepController = interruptibleSleep(DELAY_BETWEEN_IFRAMES_MS); await sleepController.promise; } catch (error) { if (error.isCancellation) { console.log(`[自動播放] 連結間等待被 '${error.reason}' 中斷。`); } else { throw error; } } finally { currentSleepController = null; }
      }
      if (!isProcessing) break; // 再次檢查狀態
    } // --- while loop end ---

    console.log(`[自動播放][偵錯] processLinksSequentially 循環結束。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`); // 增加結束 Log
    if (!isProcessing) { console.log("[自動播放] 處理流程被停止。"); resetTriggerButton(); }
    else if (!isPaused) { console.log("[自動播放] 所有連結處理完畢。"); alert("所有連結攏處理完畢！"); resetTriggerButton(); }
    else { console.log("[自動播放] 流程結束於暫停狀態。"); /* 維持 UI */ }
  }

  // --- 控制按鈕事件處理 ---

  // **簡化 startPlayback 的恢復邏輯**
  function startPlayback() {
    console.log(`[自動播放] 開始/繼續 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`); // 增加 Log
    if (!isProcessing) { // ---- 首次開始 ----
      const resultTable = document.querySelector('table.table.d-none.d-md-table'); if (!resultTable) { alert("揣無結果表格！"); return; }
      const linkElements = resultTable.querySelectorAll('tbody tr td a[href^="/und-hani/su/"]'); if (linkElements.length === 0) { alert("表格內底揣無詞目連結！"); return; }
      linksToProcess = Array.from(linkElements).map(a => ({ url: new URL(a.getAttribute('href'), window.location.origin).href }));
      totalLinks = linksToProcess.length; currentLinkIndex = 0; isProcessing = true; isPaused = false;
      startButton.style.display = 'none'; pauseButton.style.display = 'inline-block'; pauseButton.textContent = '暫停'; stopButton.style.display = 'inline-block'; statusDisplay.style.display = 'inline-block';
      updateStatusDisplay(); processLinksSequentially();
    } else if (isPaused) { // ---- 從暫停繼續 ----
      isPaused = false; // **僅設置 isPaused 為 false**
      pauseButton.textContent = '暫停'; updateStatusDisplay();
      console.log("[自動播放] 從暫停狀態繼續。 isProcessing 應為 true");
      // 不需要做其他事，讓 processLinksSequentially 或 processSingleLink 中的等待循環解除阻塞
    } else {
      console.warn("[自動播放][偵錯] 開始/繼續 按鈕被點擊，但 isProcessing 為 true 且 isPaused 為 false，不執行任何操作。");
    }
  }

  // pausePlayback
  function pausePlayback() {
    console.log(`[自動播放] 暫停/繼續 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`); // 增加 Log
    if (isProcessing) {
      if (!isPaused) { // ---- 執行暫停 ----
        isPaused = true; pauseButton.textContent = '繼續'; updateStatusDisplay(); console.log("[自動播放] 執行暫停 (保持 Modal 開啟)。");
        if (currentSleepController) { currentSleepController.cancel('paused'); }
      } else { // ---- 執行繼續 ----
        startPlayback(); // 調用 startPlayback 來處理繼續邏輯
      }
    } else {
      console.warn("[自動播放][偵錯] 暫停 按鈕被點擊，但 isProcessing 為 false，不執行任何操作。");
    }
  }

  // stopPlayback
  function stopPlayback() {
    console.log(`[自動播放] 停止 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`); // 增加 Log
    if (!isProcessing && !isPaused) {
      console.log("[自動播放][偵錯] 停止按鈕點擊，但腳本已停止，不執行操作。");
      return; // 如果已經停止，不做任何事
    }
    isProcessing = false; isPaused = false; // **確保設置狀態**
    if (currentSleepController) { currentSleepController.cancel('stopped'); }
    console.log(`[自動播放][偵錯][停止前] currentIframe: ${currentIframe ? currentIframe.id : 'null'}, overlayElement: ${overlayElement ? 'exists' : 'null'}`);
    closeModal(); // 調用增強後的 closeModal
    resetTriggerButton(); updateStatusDisplay();
  }

  // updateStatusDisplay
  function updateStatusDisplay() {
    if (statusDisplay) { if (isProcessing && !isPaused) { statusDisplay.textContent = `處理中 (${currentLinkIndex + 1}/${totalLinks})`; } else if (isProcessing && isPaused) { statusDisplay.textContent = `已暫停 (${currentLinkIndex + 1}/${totalLinks})`; } else { statusDisplay.textContent = ''; } }
  }

  // resetTriggerButton
  function resetTriggerButton() {
    console.log("[自動播放] 重置按鈕狀態。");
    isProcessing = false; isPaused = false; currentLinkIndex = 0; totalLinks = 0; linksToProcess = [];
    if (startButton && pauseButton && stopButton && statusDisplay) { startButton.disabled = false; startButton.style.display = 'inline-block'; pauseButton.style.display = 'none'; pauseButton.textContent = '暫停'; stopButton.style.display = 'none'; statusDisplay.style.display = 'none'; statusDisplay.textContent = ''; }
    closeModal();
  }

  // --- 添加觸發按鈕 ---
  function addTriggerButton() {
    if (document.getElementById('auto-play-controls-container')) return;
    const buttonContainer = document.createElement('div'); buttonContainer.id = 'auto-play-controls-container'; buttonContainer.style.position = 'fixed'; buttonContainer.style.top = '10px'; buttonContainer.style.left = '10px'; buttonContainer.style.zIndex = '10001'; buttonContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.8)'; buttonContainer.style.padding = '5px 10px'; buttonContainer.style.borderRadius = '5px'; buttonContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)'; const buttonStyle = `padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 5px; transition: background-color 0.2s ease;`;
    startButton = document.createElement('button'); startButton.id = 'auto-play-start-button'; startButton.textContent = '開始播放全部'; startButton.style.cssText = buttonStyle; startButton.style.backgroundColor = '#28a745'; startButton.style.color = 'white'; startButton.addEventListener('click', startPlayback); buttonContainer.appendChild(startButton);
    pauseButton = document.createElement('button'); pauseButton.id = 'auto-play-pause-button'; pauseButton.textContent = '暫停'; pauseButton.style.cssText = buttonStyle; pauseButton.style.backgroundColor = '#ffc107'; pauseButton.style.color = 'black'; pauseButton.style.display = 'none'; pauseButton.addEventListener('click', pausePlayback); buttonContainer.appendChild(pauseButton);
    stopButton = document.createElement('button'); stopButton.id = 'auto-play-stop-button'; stopButton.textContent = '停止'; stopButton.style.cssText = buttonStyle; stopButton.style.backgroundColor = '#dc3545'; stopButton.style.color = 'white'; stopButton.style.display = 'none'; stopButton.addEventListener('click', stopPlayback); buttonContainer.appendChild(stopButton);
    statusDisplay = document.createElement('span'); statusDisplay.id = 'auto-play-status'; statusDisplay.style.display = 'none'; statusDisplay.style.marginLeft = '10px'; statusDisplay.style.fontSize = '14px'; statusDisplay.style.verticalAlign = 'middle'; buttonContainer.appendChild(statusDisplay); document.body.appendChild(buttonContainer);
    GM_addStyle(`#auto-play-controls-container button:disabled { opacity: 0.65; cursor: not-allowed; } #auto-play-start-button:hover:not(:disabled) { background-color: #218838 !important; } #auto-play-pause-button:hover:not(:disabled) { background-color: #e0a800 !important; } #auto-play-stop-button:hover:not(:disabled) { background-color: #c82333 !important; }`);
  }

  // --- 初始化 ---
  function initialize() {
    if (window.autoPlayerInitialized) return; window.autoPlayerInitialized = true; console.log("[自動播放] 初始化腳本 v3.9 ..."); addTriggerButton();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') { setTimeout(initialize, 0); } else { document.addEventListener('DOMContentLoaded', initialize); }

})();
// ==UserScript==
// @name         KIPSutian-autoplay
// @namespace    aiuanyu
// @version      4.17
// @description  自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放音檔(自動偵測時長)，主表格自動滾動高亮，**處理完畢後自動跳轉下一頁繼續播放(修正URL與啟動時機)**，可即時暫停/停止/點擊背景暫停/點擊表格列播放，並根據亮暗模式高亮按鈕。 **v4.17: [除錯] 暫時簡化 TABLE_CONTAINER_SELECTOR 以排查容器移除問題，並增加日誌。**
// @author       Aiuanyu 愛灣語 + Gemini
// @match        http*://sutian.moe.edu.tw/und-hani/tshiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/hunlui/*
// @match        http*://sutian.moe.edu.tw/und-hani/siannuntiau/*
// @match        http*://sutian.moe.edu.tw/und-hani/tsongpitueh/*
// @match        http*://sutian.moe.edu.tw/und-hani/huliok/*
// @match        http*://sutian.moe.edu.tw/zh-hant/tshiau/*
// @match        http*://sutian.moe.edu.tw/zh-hant/hunlui/*
// @match        http*://sutian.moe.edu.tw/zh-hant/siannuntiau/*
// @match        http*://sutian.moe.edu.tw/zh-hant/tsongpitueh/*
// @match        http*://sutian.moe.edu.tw/zh-hant/huliok/*
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
  const OVERLAY_ID = 'userscript-modal-overlay';
  const ROW_HIGHLIGHT_COLOR = 'rgba(0, 255, 0, 0.1)';
  const ROW_HIGHLIGHT_DURATION = 1500;
  const FONT_AWESOME_URL = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  const FONT_AWESOME_INTEGRITY = 'sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==';
  const AUTOPLAY_PARAM = 'autoplay';
  const PAGINATION_PARAMS = ['iahbe', 'pitsoo']; // ** 可能需要根據實際情況調整分頁參數列表 **
  const AUTO_START_MAX_WAIT_MS = 10000; // 自動啟動時等待表格的最長時間
  const AUTO_START_CHECK_INTERVAL_MS = 500; // 自動啟動時檢查表格的間隔
  // ** [除錯] 修改：暫時只使用使用者回報不會被移除的選擇器 **
  const TABLE_CONTAINER_SELECTOR = 'main.container-fluid div.mb-5';
  const ALL_TABLES_SELECTOR = `${TABLE_CONTAINER_SELECTOR} > table`;
  const RELEVANT_ROW_MARKER_SELECTOR = 'td:first-of-type span.fw-normal';
  const WIDE_TABLE_SELECTOR = 'table.d-none.d-md-table';
  const NARROW_TABLE_SELECTOR = 'table.d-md-none';
  const RESIZE_DEBOUNCE_MS = 300; // ResizeObserver 的 debounce 延遲時間

  // --- 適應亮暗模式的高亮樣式 ---
  const HIGHLIGHT_STYLE = `
        /* 預設 (亮色模式) */
        .${HIGHLIGHT_CLASS} { /* iframe 內按鈕高亮 */
            background-color: #FFF352 !important;
            color: black !important;
            outline: 2px solid #FFB800 !important;
            box-shadow: 0 0 10px #FFF352;
            transition: background-color 0.2s ease-in-out, outline 0.2s ease-in-out, color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        }
        /* 深色模式 */
        @media (prefers-color-scheme: dark) {
            .${HIGHLIGHT_CLASS} {
                background-color: #66b3ff !important;
                color: black !important;
                outline: 2px solid #87CEFA !important;
                box-shadow: 0 0 10px #66b3ff;
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
  let linksToProcess = []; // ** 注意：現在不儲存 tableRow **
  let rowHighlightTimeout = null;
  let resizeDebounceTimeout = null; // 用於 ResizeObserver 的 debounce

  // --- UI 元素引用 ---
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;
  let overlayElement = null;

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
        audio.src = '';
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

  // 背景遮罩點擊事件處理函數
  function handleOverlayClick(event) {
    if (event.target !== overlayElement) {
      console.log("[自動播放][偵錯] 點擊事件目標不是遮罩本身，忽略。", event.target);
      return;
    }
    console.log(`[自動播放][偵錯] handleOverlayClick 觸發。isProcessing: ${isProcessing}, isPaused: ${isPaused}, currentIframe: ${currentIframe ? currentIframe.id : 'null'}`);
    if (isProcessing && !isPaused) {
      console.log("[自動播放] 點擊背景遮罩，觸發暫停並關閉 Modal。");
      isPaused = true;
      pauseButton.textContent = '繼續';
      updateStatusDisplay();
      if (currentSleepController) {
        console.log("[自動播放][偵錯] 正在取消當前的 sleep...");
        currentSleepController.cancel('paused_overlay');
      } else {
        console.log("[自動播放][偵錯] 點擊遮罩時沒有正在進行的 sleep 可取消。");
      }
      closeModal();
    } else {
      console.log("[自動播放][偵錯] 點擊遮罩，但條件不滿足 (isProcessing 或 isPaused 狀態不對)。");
    }
  }

  // 顯示 Modal (Iframe + Overlay)
  function showModal(iframe) {
    overlayElement = document.getElementById(OVERLAY_ID);
    if (!overlayElement) {
      overlayElement = document.createElement('div');
      overlayElement.id = OVERLAY_ID;
      overlayElement.style.position = 'fixed';
      overlayElement.style.top = '0';
      overlayElement.style.left = '0';
      overlayElement.style.width = '100vw';
      overlayElement.style.height = '100vh';
      overlayElement.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
      overlayElement.style.zIndex = '9998';
      overlayElement.style.cursor = 'pointer';
      document.body.appendChild(overlayElement);
      console.log("[自動播放][偵錯] 已創建背景遮罩元素。");
    } else {
      console.log("[自動播放][偵錯] 背景遮罩元素已存在。");
    }
    overlayElement.removeEventListener('click', handleOverlayClick);
    console.log("[自動播放][偵錯] 已嘗試移除舊的遮罩點擊監聽器。");
    overlayElement.addEventListener('click', handleOverlayClick);
    console.log("[自動播放][偵錯] 已添加新的遮罩點擊監聽器。");

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
    console.log(`[自動播放][偵錯] closeModal 被調用。 currentIframe: ${currentIframe ? currentIframe.id : 'null'}, overlayElement: ${overlayElement ? 'exists' : 'null'}`);
    if (currentIframe && currentIframe.parentNode) {
      currentIframe.remove();
      console.log("[自動播放] 已移除 iframe");
    } else if (currentIframe) {
      console.log("[自動播放][偵錯] 嘗試移除 iframe 時，它已不在 DOM 中。");
    }
    currentIframe = null; // 清除 iframe 引用

    if (overlayElement) {
      overlayElement.removeEventListener('click', handleOverlayClick); // 嘗試移除監聽器
      if (overlayElement.parentNode) { // 檢查 overlayElement 是否仍在 DOM 中
        overlayElement.remove();
        console.log("[自動播放][偵錯] 已移除背景遮罩及其點擊監聽器。");
      } else {
        console.log("[自動播放][偵錯] 嘗試移除遮罩時，它已不在 DOM 中。");
      }
      overlayElement = null; // 清除遮罩引用
    } else {
      console.log("[自動播放][偵錯] 嘗試關閉 Modal 時，overlayElement 引用已為 null 或未找到元素。");
    }

    if (currentSleepController) {
      console.log("[自動播放] 關閉 Modal 時取消正在進行的 sleep");
      currentSleepController.cancel('modal_closed');
      currentSleepController = null;
    }
  }

  // 提取處理 iframe 內容的邏輯
  async function handleIframeContent(iframe, url, linkIndexInCurrentList) {
    let iframeDoc;
    try {
      await sleep(150); // 等待可能的初始化
      iframeDoc = iframe.contentWindow.document;
      addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);

      const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua');
      console.log(`[自動播放] 在 iframe (${iframe.id}) 中找到 ${audioButtons.length} 個播放按鈕`);

      if (audioButtons.length > 0) {
        for (let i = 0; i < audioButtons.length; i++) {
          console.log(`[自動播放][偵錯] 進入音檔循環 ${i + 1}。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
          if (!isProcessing) {
            console.log("[自動播放] 播放音檔前檢測到停止");
            break; // 跳出音檔循環
          }
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
          if (!isProcessing) { // 如果在暫停時停止，跳出 for 循環
            break;
          }
          // ** 再次檢查 isPaused，因為可能在 sleep(500) 期間狀態改變了 **
          if (isPaused) {
            console.log(`[自動播放][偵錯] sleep(500) 後仍然是暫停狀態，繼續等待。`);
            i--; // 回到同一個按鈕，以便下次循環重新檢查
            continue;
          }
          // --- 狀態檢查結束 ---

          const button = audioButtons[i];
          if (!button || !iframeDoc.body.contains(button)) {
            console.warn(`[自動播放] 按鈕 ${i + 1} 失效，跳過。`);
            continue;
          }
          console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);

          // --- data-src 解析 ---
          let actualDelayMs = FALLBACK_DELAY_MS;
          let audioSrc = null;
          let audioPath = null;
          const srcString = button.dataset.src;
          if (srcString) {
            try {
              const parsedData = JSON.parse(srcString.replace(/&quot;/g, '"'));
              if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === 'string') {
                audioPath = parsedData[0];
              }
            } catch (e) {
              if (typeof srcString === 'string' && srcString.trim().startsWith('/')) {
                audioPath = srcString.trim();
              }
            }
          }
          if (audioPath) {
            try {
              const base = iframe.contentWindow.location.href;
              audioSrc = new URL(audioPath, base).href;
            } catch (urlError) {
              audioSrc = null;
            }
          } else {
            audioSrc = null;
          }
          actualDelayMs = await getAudioDuration(audioSrc);
          // --- 解析結束 ---

          // --- **修改：決定 iframe 內部捲動目標** ---
          let scrollTargetElement = button; // 預設捲動到按鈕本身
          const flexContainer = button.closest('div.d-flex.flex-row.align-items-baseline');
          const fs6Container = button.closest('div.mb-0.fs-6');

          if (flexContainer) {
            // 情況 1: 嘗試尋找前面的 h1#main (使用者已更新)
            const mainHeading = iframeDoc.querySelector('h1#main'); // 使用 ID 選擇器
            if (mainHeading) {
              console.log("[自動播放][Iframe捲動] 找到 flex container，嘗試捲動到 h1#main");
              scrollTargetElement = mainHeading;
            } else {
              console.log("[自動播放][Iframe捲動] 找到 flex container，但未找到 h1#main，捲動到按鈕");
            }
          } else if (fs6Container) {
            // 情況 2: 嘗試尋找前面的 span.mb-0
            const precedingSpan = fs6Container.previousElementSibling;
            if (precedingSpan && precedingSpan.matches('span.mb-0')) {
              console.log("[自動播放][Iframe捲動] 找到 fs6 container，嘗試捲動到前面的 span.mb-0");
              scrollTargetElement = precedingSpan;
            } else {
              console.log("[自動播放][Iframe捲動] 找到 fs6 container，但未找到前面的 span.mb-0，捲動到按鈕");
            }
          } else {
            console.log("[自動播放][Iframe捲動] 未匹配特殊容器，捲動到按鈕");
          }

          if (scrollTargetElement && iframeDoc.body.contains(scrollTargetElement)) {
            scrollTargetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            console.log("[自動播放][Iframe捲動] 已執行捲動到目標:", scrollTargetElement);
          } else {
            console.warn("[自動播放][Iframe捲動] 捲動目標無效或不存在:", scrollTargetElement);
          }
          // --- 捲動邏輯結束 ---

          await sleep(300); // 等待捲動完成

          button.classList.add(HIGHLIGHT_CLASS);
          button.click();
          console.log(`[自動播放] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);

          // --- 可中斷 sleep ---
          try {
            const sleepController = interruptibleSleep(actualDelayMs);
            await sleepController.promise;
          } catch (error) {
            if (error.isCancellation) {
              console.log(`[自動播放] 等待音檔 ${i + 1} 被 '${error.reason}' 中斷。`);
              if (iframeDoc.body.contains(button)) {
                button.classList.remove(HIGHLIGHT_CLASS);
              }
              break; // 跳出音檔循環
            } else {
              console.error("[自動播放] interruptibleSleep 發生意外錯誤:", error);
              // 可以選擇繼續或終止
            }
          } finally {
            currentSleepController = null; // 清理控制器引用
          }
          // --- 中斷 sleep 結束 ---

          if (iframeDoc.body.contains(button) && button.classList.contains(HIGHLIGHT_CLASS)) {
            button.classList.remove(HIGHLIGHT_CLASS);
          }

          if (!isProcessing) { // 檢查 sleep 後是否被停止
            break;
          }

          // --- 按鈕間等待 (可中斷) ---
          if (i < audioButtons.length - 1) {
            console.log(`[自動播放] 播放下一個前等待 ${DELAY_BETWEEN_CLICKS_MS}ms`);
            try {
              const sleepController = interruptibleSleep(DELAY_BETWEEN_CLICKS_MS);
              await sleepController.promise;
            } catch (error) {
              if (error.isCancellation) {
                console.log(`[自動播放] 按鈕間等待被 '${error.reason}' 中斷。`);
                break; // 跳出音檔循環
              } else {
                throw error; // 重新拋出其他錯誤
              }
            } finally {
              currentSleepController = null;
            }
          }
          // --- 按鈕間等待結束 ---

          if (!isProcessing) { // 再次檢查狀態
            break;
          }
        } // --- for audioButtons loop end ---
      } else {
        console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕`);
        await sleep(1000); // 讓使用者看一下空白內容
      }
    } catch (error) {
      console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error);
    } finally {
      console.log(`[自動播放][偵錯] handleIframeContent finally 區塊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}, currentIframe: ${currentIframe ? currentIframe.id : 'null'}`);
      // 清理 sleep controller
      if (currentSleepController) {
        console.warn("[自動播放][偵錯] handleIframeContent 結束時 currentSleepController 仍存在，強制清除。");
        currentSleepController.cancel('content_handled_exit');
        currentSleepController = null;
      }
      // **不再在這裡判斷 isPaused 或 isProcessing 來關閉 Modal**
    }
  }

  // 處理單一連結的入口函數
  async function processSingleLink(url, linkIndexInCurrentList) {
    console.log(`[自動播放] processSingleLink 開始: 列表索引 ${linkIndexInCurrentList} (第 ${linkIndexInCurrentList + 1} / ${totalLinks} 項) - ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    const iframeId = `auto-play-iframe-${Date.now()}`;
    let iframe = document.createElement('iframe'); // 使用 let 允許重新賦值
    iframe.id = iframeId;

    return new Promise(async (resolve) => {
      if (!isProcessing) {
        console.log("[自動播放][偵錯] processSingleLink 開始時 isProcessing 為 false，直接返回。");
        resolve();
        return;
      }

      let isUsingExistingIframe = false;
      if (!currentIframe) {
        console.log("[自動播放][偵錯] currentIframe 為 null，顯示新 Modal。");
        showModal(iframe);
      } else {
        console.log("[自動播放][偵錯] currentIframe 已存在。");
        // 檢查 URL 是否匹配，決定是否重用或重新加載
        if (currentIframe.contentWindow && currentIframe.contentWindow.location.href === url) {
          console.log("[自動播放][偵錯] URL 匹配，繼續使用現有 iframe (按鈕暫停恢復)。");
          iframe = currentIframe; // ** 關鍵：使用現有的 iframe 引用 **
          isUsingExistingIframe = true;
        } else {
          console.warn("[自動播放][偵錯] currentIframe 存在但 URL 不匹配或無法訪問！強制關閉並重新打開。");
          closeModal();
          await sleep(50); // 短暫等待確保關閉完成
          if (!isProcessing) { resolve(); return; } // 再次檢查狀態
          showModal(iframe); // 顯示新的 iframe
        }
      }

      // 如果是使用現有 iframe (按鈕暫停恢復)，onload 不會觸發，直接執行處理邏輯
      if (isUsingExistingIframe) {
        console.log("[自動播放][偵錯] 直接處理現有 iframe 的內容。");
        await handleIframeContent(iframe, url, linkIndexInCurrentList); // 處理內容
        resolve(); // ** 在這裡 resolve **
      } else {
        // 如果是新 iframe，設置 onload 和 onerror
        iframe.onload = async () => {
          console.log(`[自動播放] Iframe 載入完成: ${url}. isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
          if (!isProcessing) {
            console.log("[自動播放] Iframe 載入時發現已停止，關閉 Modal");
            closeModal();
            resolve(); // ** 在這裡 resolve **
            return;
          }
          // 再次檢查 iframe 引用是否仍然是當前的
          if (currentIframe !== iframe) {
            console.warn(`[自動播放][偵錯] Iframe onload 觸發，但 currentIframe (${currentIframe ? currentIframe.id : 'null'}) 與當前 iframe (${iframe.id}) 不符！中止此 iframe 處理。`);
            resolve(); // ** 在這裡 resolve **
            return;
          }
          await handleIframeContent(iframe, url, linkIndexInCurrentList); // 處理內容
          resolve(); // ** 在這裡 resolve **
        };
        iframe.onerror = (error) => {
          console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error);
          closeModal();
          resolve(); // ** 在這裡 resolve **
        };
        iframe.src = url; // 設置 src 開始加載
      }
      // ** 將 resolve 移到 onload/onerror 或 isUsingExistingIframe 處理完畢後 **
    });
  }

  // ** 修改：輔助函數，根據 URL 查找對應的主頁面元素 (td 或 table) **
  function findElementForLink(targetUrl) {
    if (!targetUrl) return null;

    console.log(`[自動播放][查找元素] 尋找 URL: ${targetUrl}`);
    const visibleTables = getVisibleTables(); // ** 使用了更新後的選擇器 **
    const linkSelector = getLinkSelector();
    let targetElement = null;

    for (const table of visibleTables) {
      const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
      const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);
      const rows = table.querySelectorAll('tbody tr');
      // console.log(`[自動播放][查找元素] 檢查 ${isWideTable ? '寬' : isNarrowTable ? '窄' : '未知'} 表格...`);

      if (isWideTable) {
        for (const row of rows) {
          const firstTd = row.querySelector('td:first-of-type');
          if (firstTd && firstTd.querySelector('span.fw-normal')) {
            const linkElement = row.querySelector(linkSelector);
            if (linkElement) {
              try {
                const linkHref = new URL(linkElement.getAttribute('href'), window.location.origin).href;
                if (linkHref === targetUrl) {
                  // ** 修改：寬螢幕目標改為第一個 td **
                  targetElement = firstTd;
                  console.log("[自動播放][查找元素][寬] 找到對應 td:", targetElement);
                  break;
                }
              } catch (e) {
                console.error(`[自動播放][查找元素][寬] 處理連結 URL 時出錯:`, e, linkElement);
              }
            }
          }
        }
      } else if (isNarrowTable && rows.length >= 2) {
        const firstRowTd = rows[0].querySelector('td:first-of-type');
        const secondRowTd = rows[1].querySelector('td:first-of-type');
        if (firstRowTd && firstRowTd.querySelector('span.fw-normal') && secondRowTd) {
          const linkElement = secondRowTd.querySelector(linkSelector);
          if (linkElement) {
            try {
              const linkHref = new URL(linkElement.getAttribute('href'), window.location.origin).href;
              if (linkHref === targetUrl) {
                targetElement = table; // 窄螢幕目標是 table
                console.log("[自動播放][查找元素][窄] 找到對應 table:", targetElement);
                break;
              }
            } catch (e) {
              console.error(`[自動播放][查找元素][窄] 處理連結 URL 時出錯:`, e, linkElement);
            }
          }
        }
      }
      if (targetElement) break; // 找到就跳出外層循環
    }

    if (!targetElement) {
      console.warn(`[自動播放][查找元素] 未能找到 URL 對應的元素: ${targetUrl}`);
    }
    return targetElement;
  }


  // 循序處理連結列表 - 加入自動分頁邏輯
  async function processLinksSequentially() {
    console.log("[自動播放] processLinksSequentially 開始");
    while (currentLinkIndex < totalLinks && isProcessing) {
      // ** 關鍵的暫停等待循環 **
      while (isPaused && isProcessing) {
        console.log(`[自動播放] 主流程已暫停 (索引 ${currentLinkIndex})，等待繼續...`);
        updateStatusDisplay();
        await sleep(500); // 使用普通 sleep
        if (!isProcessing) { // 檢查在暫停等待期間是否被停止
          break;
        }
      }
      if (!isProcessing) { // 如果在暫停時停止，跳出主循環
        break;
      }

      updateStatusDisplay();
      const linkInfo = linksToProcess[currentLinkIndex]; // ** 注意：linkInfo 不再包含 tableRow **
      console.log(`[自動播放] 準備處理連結 ${currentLinkIndex + 1}/${totalLinks} (全局索引 ${linkInfo.originalIndex}) - URL: ${linkInfo.url}`);

      // --- **修改：動態查找、捲動和高亮主頁面元素** ---
      const targetElement = findElementForLink(linkInfo.url); // 返回 td 或 table

      if (targetElement) {
        // ** 修改：高亮目標改為 targetElement 的父元素 (tr 或 table 本身) **
        const highlightTarget = targetElement.closest('tr') || targetElement; // 如果是 td，找 tr；如果是 table，就是 table 本身
        console.log(`[自動播放][主頁捲動/高亮] 正在處理項目 ${linkInfo.originalIndex + 1} 對應的元素`, targetElement, `高亮目標:`, highlightTarget);

        if (rowHighlightTimeout) {
          clearTimeout(rowHighlightTimeout);
        }
        // 移除所有可能殘留的高亮
        document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}`).forEach(el => {
          el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN);
          el.style.backgroundColor = '';
          el.style.transition = '';
        });

        // ** 修改：捲動目標為找到的 targetElement (td 或 table) **
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); // 改回 center 試試
        await sleep(300); // 等待捲動基本完成

        // ** 修改：高亮目標為 highlightTarget **
        if (highlightTarget) {
          highlightTarget.classList.add(ROW_HIGHLIGHT_CLASS_MAIN);
          highlightTarget.style.backgroundColor = ROW_HIGHLIGHT_COLOR;
          highlightTarget.style.transition = 'background-color 0.5s ease-out';
          console.log(`[自動播放][主頁高亮] 已高亮項目 ${linkInfo.originalIndex + 1} 對應的元素`);

          const currentHighlightTarget = highlightTarget; // 捕獲當前高亮目標引用
          rowHighlightTimeout = setTimeout(() => {
            if (currentHighlightTarget && currentHighlightTarget.classList.contains(ROW_HIGHLIGHT_CLASS_MAIN)) { // 確保元素仍然存在且有高亮
              currentHighlightTarget.style.backgroundColor = '';
              // 等待背景色過渡完成後移除 class
              setTimeout(() => {
                if (currentHighlightTarget) {
                  currentHighlightTarget.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN);
                }
              }, 500); // 匹配過渡時間
            }
            rowHighlightTimeout = null;
          }, ROW_HIGHLIGHT_DURATION);
        } else {
          console.warn(`[自動播放][主頁高亮] 未能確定項目 ${linkInfo.originalIndex + 1} 的高亮目標。`);
        }
      } else {
        console.warn(`[自動播放][主頁捲動] 未能找到項目 ${linkInfo.originalIndex + 1} (URL: ${linkInfo.url}) 對應的元素進行捲動和高亮。`);
      }
      // --- 捲動高亮邏輯結束 ---

      await sleep(200); // 等待滾動和高亮穩定
      if (!isProcessing || isPaused) { // 如果在等待時狀態改變
        continue; // 重新進入外層 while 檢查 isPaused
      }

      // ** 調用 processSingleLink **
      await processSingleLink(linkInfo.url, currentLinkIndex);
      if (!isProcessing) { // 檢查處理後是否被停止
        break;
      }

      // ** 處理完一個連結後的 Modal 關閉邏輯 **
      // 只有在非暫停狀態下才關閉 Modal
      if (!isPaused) {
        console.log(`[自動播放][偵錯] 連結 ${currentLinkIndex + 1} 處理完畢，非暫停狀態，關閉 Modal`);
        closeModal(); // 確保關閉當前 Modal
      } else {
        console.log(`[自動播放][偵錯] 連結 ${currentLinkIndex + 1} 處理完畢，但處於暫停狀態，保持 Modal 開啟`);
      }

      // 只有在沒有暫停的情況下才移動到下一個連結
      if (!isPaused) {
        console.log(`[自動播放][偵錯] 索引增加`);
        currentLinkIndex++;
      } else {
        console.log(`[自動播放][偵錯] 處於暫停狀態，索引保持不變`);
        // isPaused 仍然為 true，外層 while 循環會在下一次迭代時繼續等待
      }

      // 連結間的等待 (只有在非暫停且還有連結時執行)
      if (currentLinkIndex < totalLinks && isProcessing && !isPaused) {
        console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 後處理下一個連結`);
        try {
          const sleepController = interruptibleSleep(DELAY_BETWEEN_IFRAMES_MS);
          await sleepController.promise;
        } catch (error) {
          if (error.isCancellation) {
            console.log(`[自動播放] 連結間等待被 '${error.reason}' 中斷。`);
          } else {
            throw error; // 重新拋出其他錯誤
          }
        } finally {
          currentSleepController = null;
        }
      }
      if (!isProcessing) { // 再次檢查狀態
        break;
      }
    } // --- while loop end ---

    console.log(`[自動播放][偵錯] processLinksSequentially 循環結束。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (rowHighlightTimeout) { clearTimeout(rowHighlightTimeout); } // 清除高亮
    document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}`).forEach(el => { el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN); el.style.backgroundColor = ''; el.style.transition = ''; });

    // --- **自動分頁邏輯** ---
    if (isProcessing && !isPaused) { // 只有在正常處理完畢時才嘗試翻頁
      console.log("[自動播放] 當前頁面處理完畢，檢查是否有下一頁...");
      const paginationNav = document.querySelector('nav[aria-label="頁碼"] ul.pagination');
      if (paginationNav) {
        const nextPageLink = paginationNav.querySelector('li:last-child > a');
        // ** 修改：包含 "下一頁" (來自使用者更新) **
        if (nextPageLink && (nextPageLink.textContent.includes('後一頁') || nextPageLink.textContent.includes('下一頁')) && !nextPageLink.closest('li.disabled')) {
          const nextPageHref = nextPageLink.getAttribute('href');
          if (nextPageHref && nextPageHref !== '#') {
            console.log(`[自動播放] 找到下一頁原始 href: ${nextPageHref}`);
            try {
              const currentParams = new URLSearchParams(window.location.search);
              const nextPageUrlTemp = new URL(nextPageHref, window.location.origin);
              const nextPageParams = nextPageUrlTemp.searchParams;
              const finalParams = new URLSearchParams(currentParams.toString());
              PAGINATION_PARAMS.forEach(param => {
                if (nextPageParams.has(param)) {
                  finalParams.set(param, nextPageParams.get(param));
                  console.log(`[自動播放][分頁] 更新參數 ${param}=${nextPageParams.get(param)}`);
                }
              });
              finalParams.set(AUTOPLAY_PARAM, 'true');
              const finalNextPageUrl = `${window.location.pathname}?${finalParams.toString()}`;

              console.log(`[自動播放] 組合完成，準備跳轉至: ${finalNextPageUrl}`);
              await sleep(1000);
              window.location.href = finalNextPageUrl;
              return; // 跳轉後結束
            } catch (e) {
              console.error("[自動播放] 處理下一頁 URL 時出錯:", e);
            }
          } else {
            console.log("[自動播放] 「後一頁」/「下一頁」連結無效或被禁用。");
          }
        } else {
          console.log("[自動播放] 未找到有效的「後一頁」或「下一頁」連結。");
        }
      } else {
        console.log("[自動播放] 未找到分頁導航元素。");
      }
      // 無下一頁或處理出錯，執行正常完成邏輯
      console.log("[自動播放] 所有連結處理完畢 (無下一頁)。");
      alert("所有連結攏處理完畢！");
      resetTriggerButton();
    } else if (!isProcessing) { // 如果是被停止的
      console.log("[自動播放] 處理流程被停止。");
      resetTriggerButton();
    } else { // 如果是暫停狀態結束
      console.log("[自動播放] 流程結束於暫停狀態。");
      // 維持 UI，等待使用者操作
    }
  }

  // --- 控制按鈕事件處理 ---

  // ** 輔助函數，獲取當前可見的表格元素列表 **
  function getVisibleTables() {
    // ** [除錯] 增加日誌，顯示正在使用的容器選擇器 **
    console.log(`[自動播放][getVisibleTables] 使用容器選擇器: "${TABLE_CONTAINER_SELECTOR}"`);
    const containers = document.querySelectorAll(TABLE_CONTAINER_SELECTOR);
    console.log(`[自動播放][getVisibleTables] 找到 ${containers.length} 個符合條件的容器。`, containers);

    // ** 使用更新後的 ALL_TABLES_SELECTOR **
    const allTables = document.querySelectorAll(ALL_TABLES_SELECTOR);
    console.log(`[自動播放][getVisibleTables] 使用表格選擇器: "${ALL_TABLES_SELECTOR}"`);
    console.log(`[自動播放][getVisibleTables] 找到 ${allTables.length} 個潛在表格。`, allTables);

    const visibleTables = Array.from(allTables).filter(table => {
      try {
        // 檢查 display 和 visibility，確保表格是真的可見
        const style = window.getComputedStyle(table);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
        // console.log(`[自動播放][getVisibleTables] 檢查表格可見性:`, table, `isVisible: ${isVisible}`); // 可能過於頻繁
        return isVisible;
      } catch (e) {
        console.error("[自動播放][getVisibleTables] 檢查表格可見性時出錯:", e, table);
        return false; // 出錯時視為不可見
      }
    });
    console.log(`[自動播放][getVisibleTables] 過濾後得到 ${visibleTables.length} 個可見表格。`, visibleTables);
    return visibleTables;
  }

  // startPlayback
  function startPlayback(startIndex = 0) {
    console.log(`[自動播放] startPlayback 調用。 startIndex: ${startIndex}, isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing) {
      // 獲取連結選擇器
      const linkSelector = getLinkSelector();
      console.log(`[自動播放] 使用連結選擇器: ${linkSelector}`);

      // ** 修改：區分表格類型來查找連結 **
      const visibleTables = getVisibleTables(); // ** 使用了更新後的選擇器 **
      if (visibleTables.length === 0) {
        alert("頁面上揣無目前顯示的結果表格！(已簡化選擇器)"); // ** 更新提示訊息 **
        return;
      }

      const allLinks = [];
      let globalRowIndex = 0; // 用於計算 originalIndex

      visibleTables.forEach(table => {
        const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
        const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);

        if (isWideTable) {
          // console.log("[自動播放][偵錯][連結] 處理寬螢幕表格...");
          const rows = table.querySelectorAll('tbody tr');
          rows.forEach(row => {
            const firstTd = row.querySelector('td:first-of-type');
            // 寬螢幕：標記和連結在同一行
            if (firstTd && firstTd.querySelector('span.fw-normal')) {
              const linkElement = row.querySelector(linkSelector); // 在同一行找連結
              if (linkElement) {
                try {
                  allLinks.push({
                    url: new URL(linkElement.getAttribute('href'), window.location.origin).href,
                    anchorElement: linkElement,
                    // ** 移除 tableRow **
                    originalIndex: globalRowIndex
                  });
                  globalRowIndex++;
                } catch (e) {
                  console.error(`[自動播放][連結][寬] 處理連結 URL 時出錯:`, e, linkElement);
                }
              } else {
                // console.log(`[自動播放][偵錯][連結][寬] 在標記行 ${globalRowIndex + 1} 中未找到連結 ${linkSelector}`);
              }
            }
          });
        } else if (isNarrowTable) {
          // console.log("[自動播放][偵錯][連結] 處理窄螢幕表格...");
          const rows = table.querySelectorAll('tbody tr');
          // 窄螢幕：標記在第一行，連結在第二行
          if (rows.length >= 2) { // 至少需要兩行
            const firstRowTd = rows[0].querySelector('td:first-of-type');
            if (firstRowTd && firstRowTd.querySelector('span.fw-normal')) {
              // 在第二行的第一個 td 中找連結
              const secondRowTd = rows[1].querySelector('td:first-of-type');
              if (secondRowTd) {
                const linkElement = secondRowTd.querySelector(linkSelector);
                if (linkElement) {
                  try {
                    allLinks.push({
                      url: new URL(linkElement.getAttribute('href'), window.location.origin).href,
                      anchorElement: linkElement,
                      // ** 移除 tableRow, 高亮和捲動目標將動態查找 **
                      originalIndex: globalRowIndex
                    });
                    globalRowIndex++;
                  } catch (e) {
                    console.error(`[自動播放][連結][窄] 處理連結 URL 時出錯:`, e, linkElement);
                  }
                } else {
                  // console.log(`[自動播放][偵錯][連結][窄] 在第二行 td:first-of-type 中未找到連結 ${linkSelector}`);
                }
              } else {
                // console.log(`[自動播放][偵錯][連結][窄] 找不到第二行的第一個 td`);
              }
            } else {
              // console.log(`[自動播放][偵錯][連結][窄] 第一行未找到標記`);
            }
          } else {
            // console.log(`[自動播放][偵錯][連結][窄] 表格行數不足 (< 2)`);
          }
        } else {
          console.warn("[自動播放][連結] 發現未知類型的可見表格:", table);
        }
      });


      if (allLinks.length === 0) {
        alert("目前顯示的表格內底揣無詞目連結 (已區分表格結構，已簡化選擇器)！"); // ** 更新提示訊息 **
        return;
      }
      console.log(`[自動播放] 從 ${visibleTables.length} 個可見表格中根據結構找到 ${allLinks.length} 個連結。`);


      if (startIndex >= allLinks.length) {
        console.error(`[自動播放] 指定的開始索引 ${startIndex} 超出範圍 (${allLinks.length} 個連結)。`);
        return;
      }
      linksToProcess = allLinks.slice(startIndex);
      totalLinks = linksToProcess.length; // 總數是切片後的長度
      currentLinkIndex = 0; // 從切片後的列表的 0 開始
      isProcessing = true;
      isPaused = false;
      console.log(`[自動播放] 開始新的播放流程，從全局索引 ${startIndex} 開始，共 ${totalLinks} 項。`);
      startButton.style.display = 'none';
      pauseButton.style.display = 'inline-block';
      pauseButton.textContent = '暫停';
      stopButton.style.display = 'inline-block';
      statusDisplay.style.display = 'inline-block';
      updateStatusDisplay();
      processLinksSequentially(); // 開始處理
    } else if (isPaused) {
      isPaused = false;
      pauseButton.textContent = '暫停';
      updateStatusDisplay();
      console.log("[自動播放] 從暫停狀態繼續。");
      // 不需要重新調用 processLinksSequentially，它會在循環中自動繼續
    } else {
      console.warn("[自動播放][偵錯] 開始/繼續 按鈕被點擊，但 isProcessing 為 true 且 isPaused 為 false，不執行任何操作。");
    }
  }
  // pausePlayback
  function pausePlayback() {
    console.log(`[自動播放] 暫停/繼續 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (isProcessing) {
      if (!isPaused) {
        isPaused = true;
        pauseButton.textContent = '繼續';
        updateStatusDisplay();
        console.log("[自動播放] 執行暫停 (保持 Modal 開啟)。");
        if (currentSleepController) {
          currentSleepController.cancel('paused');
        }
      } else {
        // 從暫停狀態恢復，直接調用 startPlayback 處理恢復邏輯
        startPlayback();
      }
    } else {
      console.warn("[自動播放][偵錯] 暫停 按鈕被點擊，但 isProcessing 為 false，不執行任何操作。");
    }
  }
  // stopPlayback
  function stopPlayback() {
    console.log(`[自動播放] 停止 按鈕點擊。 isProcessing: ${isProcessing}, isPaused: ${isPaused}`);
    if (!isProcessing && !isPaused) {
      console.log("[自動播放][偵錯] 停止按鈕點擊，但腳本已停止，不執行操作。");
      return;
    }
    isProcessing = false;
    isPaused = false;
    if (currentSleepController) {
      currentSleepController.cancel('stopped');
    }
    console.log(`[自動播放][偵錯][停止前] currentIframe: ${currentIframe ? currentIframe.id : 'null'}, overlayElement: ${overlayElement ? 'exists' : 'null'}`);
    closeModal(); // 確保關閉 Modal
    resetTriggerButton();
    updateStatusDisplay();
  }
  // updateStatusDisplay
  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing && linksToProcess.length > 0 && linksToProcess[currentLinkIndex]) {
        // 計算正確的全局進度 (基於 linksToProcess)
        const globalCurrentIndex = linksToProcess[currentLinkIndex].originalIndex; // 獲取當前項的原始全局索引 (相對於可見且相關的連結列表)
        // totalLinks 已經是當前批次的總數
        const currentBatchProgress = `(${currentLinkIndex + 1}/${totalLinks})`; // 這是當前批次的進度

        if (!isPaused) {
          statusDisplay.textContent = `處理中 ${currentBatchProgress}`; // 顯示批次進度
        } else {
          statusDisplay.textContent = `已暫停 ${currentBatchProgress}`; // 顯示批次進度
        }
      } else {
        statusDisplay.textContent = '';
      }
    }
  }
  // resetTriggerButton
  function resetTriggerButton() {
    console.log("[自動播放] 重置按鈕狀態。");
    isProcessing = false;
    isPaused = false;
    currentLinkIndex = 0;
    totalLinks = 0;
    linksToProcess = [];
    if (startButton && pauseButton && stopButton && statusDisplay) {
      startButton.disabled = false;
      startButton.style.display = 'inline-block';
      pauseButton.style.display = 'none';
      pauseButton.textContent = '暫停';
      stopButton.style.display = 'none';
      statusDisplay.style.display = 'none';
      statusDisplay.textContent = '';
    }
    if (rowHighlightTimeout) clearTimeout(rowHighlightTimeout);
    document.querySelectorAll(`.${ROW_HIGHLIGHT_CLASS_MAIN}`).forEach(el => { el.classList.remove(ROW_HIGHLIGHT_CLASS_MAIN); el.style.backgroundColor = ''; el.style.transition = ''; });
    closeModal(); // 確保關閉 Modal
  }
  // 表格列播放按鈕點擊處理
  async function handleRowPlayButtonClick(event) {
    const button = event.currentTarget;
    const rowIndex = parseInt(button.dataset.rowIndex, 10); // 這個 rowIndex 是全局索引 (相對於可見且相關的行)
    console.log(`[自動播放] 表格列播放按鈕點擊，全局列索引 (可見且相關): ${rowIndex}`);
    if (isNaN(rowIndex)) {
      console.error("[自動播放] 無法獲取有效的列索引。");
      return;
    }
    if (isProcessing && !isPaused) {
      console.log("[自動播放] 目前正在播放中，請先停止或等待完成才能從指定列開始。");
      alert("目前正在播放中，請先停止或等待完成才能從指定列開始。");
      return;
    }
    if (isProcessing && isPaused) {
      console.log("[自動播放] 偵測到處於暫停狀態，先停止當前流程...");
      stopPlayback();
      await sleep(100); // 等待停止完成
    }
    // 使用全局索引啟動 (相對於可見且相關的行)
    startPlayback(rowIndex);
  }
  // 確保 Font Awesome 加載
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

  // ** 輔助函數：注入或更新單個按鈕 **
  function injectOrUpdateButton(targetRow, targetTd, rowIndex) {
    const buttonClass = 'userscript-row-play-button';
    let button = targetRow.querySelector(`.${buttonClass}`); // 在目標行查找按鈕

    // ** 除錯：檢查 targetTd 是否有效 **
    if (!targetTd) {
      console.error(`[自動播放][按鈕注入] 錯誤：目標 td (行 ${rowIndex + 1}) 無效！`, targetRow);
      return;
    }

    if (button) {
      // 更新現有按鈕
      if (button.dataset.rowIndex !== String(rowIndex)) {
        console.log(`[自動播放][偵錯] 更新行 ${rowIndex + 1} 的按鈕索引。`);
        button.dataset.rowIndex = rowIndex;
        button.title = `從此列開始播放 (第 ${rowIndex + 1} 項)`;
      }
      // ** 除錯：確保按鈕在正確的 td 內 **
      if (button.parentElement !== targetTd) {
        console.warn(`[自動播放][按鈕注入] 按鈕 (行 ${rowIndex + 1}) 不在目標 td 內，正在移動...`);
        targetTd.insertBefore(button, targetTd.querySelector('span.fw-normal')?.nextSibling || targetTd.firstChild);
      }
    } else {
      // 添加新按鈕
      const playButtonBaseStyle = ` background-color: #28a745; color: white; border: none; border-radius: 4px; padding: 2px 6px; margin: 0 8px; cursor: pointer; font-size: 12px; line-height: 1; vertical-align: middle; transition: background-color 0.2s ease; `;
      button = document.createElement('button');
      button.className = buttonClass;
      button.style.cssText = playButtonBaseStyle;
      button.innerHTML = '<i class="fas fa-play"></i>';
      button.dataset.rowIndex = rowIndex;
      button.title = `從此列開始播放 (第 ${rowIndex + 1} 項)`;
      button.addEventListener('click', handleRowPlayButtonClick);

      // 注入按鈕到目標 td
      const numberSpan = targetTd.querySelector('span.fw-normal');
      if (numberSpan && numberSpan.nextSibling) {
        targetTd.insertBefore(button, numberSpan.nextSibling);
      } else if (numberSpan) {
        targetTd.appendChild(button);
      } else {
        targetTd.insertBefore(button, targetTd.firstChild);
      }
      // console.log(`[自動播放][按鈕注入] 已為行 ${rowIndex + 1} 添加新按鈕。`);
    }
  }

  // ** 輔助函數：從行中移除按鈕 **
  function removeButtonFromRow(row) {
    const button = row.querySelector('.userscript-row-play-button');
    if (button) {
      button.remove();
    }
  }


  // 注入表格列播放按鈕
  function injectRowPlayButtons() {
    const visibleTables = getVisibleTables(); // ** 使用了更新後的選擇器 **
    if (visibleTables.length === 0) {
      console.log("[自動播放][injectRowPlayButtons] 未找到任何當前可見的結果表格，無法注入列播放按鈕。 (已簡化選擇器)"); // ** 更新提示訊息 **
      return;
    }
    // console.log(`[自動播放] 找到 ${visibleTables.length} 個當前可見的結果表格。`); // 可能過於頻繁

    // 添加懸停樣式
    const playButtonHoverStyle = `.userscript-row-play-button:hover { background-color: #218838 !important; }`;
    GM_addStyle(playButtonHoverStyle);

    // ** [除錯] 增加日誌，顯示移除按鈕時使用的選擇器 **
    const removeSelector = `${ALL_TABLES_SELECTOR} .userscript-row-play-button`;
    console.log(`[自動播放][injectRowPlayButtons] 準備移除舊按鈕，使用選擇器: "${removeSelector}"`);
    const buttonsToRemove = document.querySelectorAll(removeSelector);
    console.log(`[自動播放][injectRowPlayButtons] 找到 ${buttonsToRemove.length} 個待移除的舊按鈕。`);
    buttonsToRemove.forEach(btn => btn.remove());
    console.log(`[自動播放][injectRowPlayButtons] 已移除所有舊的行播放按鈕。`);

    let globalRowIndex = 0; // ** 維護一個基於可見且相關行的全局行索引 **

    visibleTables.forEach((table, tableIndex) => {
      const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
      const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);
      const rows = table.querySelectorAll('tbody tr');
      const tableId = `可見表格 ${tableIndex + 1} (${isWideTable ? '寬' : isNarrowTable ? '窄' : '未知'})`; // 用於日誌
      // console.log(`[自動播放][按鈕注入] ${tableId} 找到 ${rows.length} 行。`); // 可能過於頻繁

      if (isWideTable) {
        rows.forEach((row, rowIndexInTable) => {
          const firstTd = row.querySelector('td:first-of-type');
          if (firstTd && firstTd.querySelector('span.fw-normal')) {
            // 寬螢幕：按鈕注入此行
            // console.log(`[自動播放][按鈕注入][寬] ${tableId} - 行 ${rowIndexInTable + 1}: 找到標記，注入按鈕 (全局索引 ${globalRowIndex})。`);
            injectOrUpdateButton(row, firstTd, globalRowIndex);
            globalRowIndex++;
          } else {
            // console.log(`[自動播放][按鈕注入][寬] ${tableId} - 行 ${rowIndexInTable + 1}: 未找到標記，跳過。`);
          }
        });
      } else if (isNarrowTable) {
        // console.log(`[自動播放][按鈕注入][窄] ${tableId}: 開始檢查...`);
        if (rows.length >= 1) { // 至少需要一行來放標記和按鈕
          const firstRow = rows[0];
          const firstRowTd = firstRow.querySelector('td:first-of-type');
          const hasMarker = firstRowTd && firstRowTd.querySelector('span.fw-normal');
          // console.log(`[自動播放][按鈕注入][窄] ${tableId} - 檢查第一行: ${firstRow ? '存在' : '不存在'}, 檢查第一行 td: ${firstRowTd ? '存在' : '不存在'}, 找到標記: ${hasMarker ? '是' : '否'}`);

          if (hasMarker) {
            // 窄螢幕：按鈕注入第一行 (有標記的行)
            // 但需要檢查第二行是否有連結，才算是有效的項目
            let isValidNarrowEntry = false;
            let linkFoundInSecondRow = false;
            if (rows.length >= 2) {
              const secondRow = rows[1];
              const secondRowTd = secondRow.querySelector('td:first-of-type');
              // console.log(`[自動播放][按鈕注入][窄] ${tableId} - 檢查第二行: ${secondRow ? '存在' : '不存在'}, 檢查第二行 td: ${secondRowTd ? '存在' : '不存在'}`);
              if (secondRowTd) {
                // ** 修改：在第二行的 td 中尋找連結 **
                const linkElement = secondRowTd.querySelector(getLinkSelector());
                linkFoundInSecondRow = !!linkElement; // 轉換為布林值
                // console.log(`[自動播放][按鈕注入][窄] ${tableId} - 在第二行 td 中查找連結 (${getLinkSelector()}): ${linkFoundInSecondRow ? '找到' : '未找到'}`);
                if (linkFoundInSecondRow) {
                  isValidNarrowEntry = true;
                }
              }
            } else {
              // console.log(`[自動播放][按鈕注入][窄] ${tableId}: 行數不足 (< 2)，無法檢查第二行連結。`);
            }

            // console.log(`[自動播放][按鈕注入][窄] ${tableId} - isValidNarrowEntry: ${isValidNarrowEntry}`);
            if (isValidNarrowEntry) {
              // console.log(`[自動播放][按鈕注入][窄] ${tableId} - 條件滿足，注入按鈕到第一行 (全局索引 ${globalRowIndex})。`);
              injectOrUpdateButton(firstRow, firstRowTd, globalRowIndex);
              globalRowIndex++;
            } else {
              // console.log(`[自動播放][按鈕注入][窄] ${tableId} - 第一行有標記，但第二行無有效連結或不存在，不添加按鈕。`);
            }
          } else {
            // console.log(`[自動播放][按鈕注入][窄] ${tableId} - 第一行未找到標記，不處理此表格。`);
          }
        } else {
          // console.log(`[自動播放][按鈕注入][窄] ${tableId}: 行數為 0，跳過。`);
        }
      } else {
        // console.warn(`[自動播放][按鈕注入] ${tableId} 類型未知，跳過按鈕注入。`);
      }
    });
    console.log(`[自動播放][injectRowPlayButtons] 已處理 ${globalRowIndex} 個有效項目，注入或更新播放按鈕。`);
  }

  // 添加觸發按鈕
  function addTriggerButton() {
    if (document.getElementById('auto-play-controls-container')) return;
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'auto-play-controls-container';
    buttonContainer.style.position = 'fixed';
    buttonContainer.style.top = '10px';
    buttonContainer.style.left = '10px';
    buttonContainer.style.zIndex = '10001';
    buttonContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    buttonContainer.style.padding = '5px 10px';
    buttonContainer.style.borderRadius = '5px';
    buttonContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    const buttonStyle = `padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 5px; transition: background-color 0.2s ease;`;
    startButton = document.createElement('button');
    startButton.id = 'auto-play-start-button';
    startButton.textContent = '開始播放全部';
    startButton.style.cssText = buttonStyle;
    startButton.style.backgroundColor = '#28a745';
    startButton.style.color = 'white';
    startButton.addEventListener('click', () => startPlayback(0));
    buttonContainer.appendChild(startButton);
    pauseButton = document.createElement('button');
    pauseButton.id = 'auto-play-pause-button';
    pauseButton.textContent = '暫停';
    pauseButton.style.cssText = buttonStyle;
    pauseButton.style.backgroundColor = '#ffc107';
    pauseButton.style.color = 'black';
    pauseButton.style.display = 'none';
    pauseButton.addEventListener('click', pausePlayback);
    buttonContainer.appendChild(pauseButton);
    stopButton = document.createElement('button');
    stopButton.id = 'auto-play-stop-button';
    stopButton.textContent = '停止';
    stopButton.style.cssText = buttonStyle;
    stopButton.style.backgroundColor = '#dc3545';
    stopButton.style.color = 'white';
    stopButton.style.display = 'none';
    stopButton.addEventListener('click', stopPlayback);
    buttonContainer.appendChild(stopButton);
    statusDisplay = document.createElement('span');
    statusDisplay.id = 'auto-play-status';
    statusDisplay.style.display = 'none';
    statusDisplay.style.marginLeft = '10px';
    statusDisplay.style.fontSize = '14px';
    statusDisplay.style.verticalAlign = 'middle';
    buttonContainer.appendChild(statusDisplay);
    document.body.appendChild(buttonContainer);
    GM_addStyle(`#auto-play-controls-container button:disabled { opacity: 0.65; cursor: not-allowed; } #auto-play-start-button:hover:not(:disabled) { background-color: #218838 !important; } #auto-play-pause-button:hover:not(:disabled) { background-color: #e0a800 !important; } #auto-play-stop-button:hover:not(:disabled) { background-color: #c82333 !important; }`);
  }

  // 輔助函數，獲取當前應使用的連結選擇器
  function getLinkSelector() {
    const currentUrl = window.location.href;
    if (currentUrl.includes('/zh-hant/')) {
      return 'a[href^="/zh-hant/su/"]';
    } else {
      return 'a[href^="/und-hani/su/"]';
    }
  }

  // 初始化
  function initialize() {
    if (window.autoPlayerInitialized) return;
    window.autoPlayerInitialized = true;
    console.log("[自動播放] 初始化腳本 v4.17 ..."); // 更新版本號
    ensureFontAwesome();
    addTriggerButton();
    // 初始注入按鈕
    setTimeout(injectRowPlayButtons, 1000);

    // ** 修改：改用 ResizeObserver 監聽 RWD 變化 **
    try {
      const resizeObserver = new ResizeObserver(entries => {
        // 使用 debounce 避免短時間內重複觸發
        clearTimeout(resizeDebounceTimeout);
        resizeDebounceTimeout = setTimeout(() => {
          console.log("[自動播放][ResizeObserver] Debounced: 偵測到尺寸變化，重新注入按鈕並嘗試捲動...");
          injectRowPlayButtons(); // ** 使用了更新後的選擇器 **
          // ** 修改：調用新的查找函數來捲動 **
          const currentUrl = linksToProcess[currentLinkIndex]?.url;
          if (currentUrl) {
            const elementToScroll = findElementForLink(currentUrl); // ** 使用了更新後的選擇器 **
            if (elementToScroll) {
              console.log("[自動播放][ResizeObserver] 找到元素，執行捲動:", elementToScroll);
              elementToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' }); // 改回 center
            } else {
              console.warn("[自動播放][ResizeObserver] 未找到元素進行捲動:", currentUrl);
            }
          } else {
            console.log("[自動播放][ResizeObserver] 沒有當前連結 URL，不執行捲動。");
          }
        }, RESIZE_DEBOUNCE_MS);
      });

      // 監聽 body 尺寸變化，這通常能反映視窗大小變化觸發的 RWD
      resizeObserver.observe(document.body);
      console.log("[自動播放] 已啟動 ResizeObserver 監聽 document.body 變化。");

    } catch (e) {
      console.error("[自動播放] 無法啟動 ResizeObserver:", e);
      // 作為後備，可以考慮監聽 window 的 resize 事件，但 ResizeObserver 通常更好
      // window.addEventListener('resize', () => { ... debounce logic ... injectRowPlayButtons(); ... find and scroll ... });
    }


    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has(AUTOPLAY_PARAM)) {
      console.log(`[自動播放] 檢測到 URL 參數 "${AUTOPLAY_PARAM}"，準備自動啟動...`);
      // 從 URL 中移除 autoplay 參數，避免刷新頁面時再次觸發
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete(AUTOPLAY_PARAM);
      history.replaceState(null, '', newUrl.toString());

      let elapsedTime = 0;
      const waitForTableAndStart = () => {
        console.log("[自動播放][等待] 檢查可見表格和有效連結是否存在...");
        // ** 檢查邏輯以適應不同表格結構 **
        const linkSelector = getLinkSelector();
        const visibleTables = getVisibleTables(); // ** 使用了更新後的選擇器 **
        let linksExist = false;

        visibleTables.forEach(table => {
          if (linksExist) return; // 如果已找到，提前退出

          const isWideTable = table.matches(WIDE_TABLE_SELECTOR);
          const isNarrowTable = table.matches(NARROW_TABLE_SELECTOR);
          const rows = table.querySelectorAll('tbody tr');

          if (isWideTable) {
            linksExist = Array.from(rows).some(row => {
              const firstTd = row.querySelector('td:first-of-type');
              return firstTd && firstTd.querySelector('span.fw-normal') && row.querySelector(linkSelector);
            });
          } else if (isNarrowTable && rows.length >= 2) {
            const firstRowTd = rows[0].querySelector('td:first-of-type');
            const secondRowTd = rows[1].querySelector('td:first-of-type');
            // ** 修改：在第二行的 td 中尋找連結 **
            linksExist = firstRowTd && firstRowTd.querySelector('span.fw-normal') &&
              secondRowTd && secondRowTd.querySelector(linkSelector);
          }
        });


        if (linksExist) {
          console.log("[自動播放][等待] 可見表格和有效連結已找到，延遲後啟動播放...");
          // ** 修改：確保行內播放按鈕已注入完成後再啟動 **
          setTimeout(() => {
            console.log("[自動播放] 重新注入/更新行內播放按鈕以確保索引正確...");
            injectRowPlayButtons(); // ** 使用了更新後的選擇器 **
            setTimeout(() => {
              console.log("[自動播放] 自動啟動播放流程...");
              startPlayback(0);
            }, 300); // 短暫延遲後啟動
          }, 500); // 確保 inject 有足夠時間
        } else {
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
      setTimeout(waitForTableAndStart, 500); // 初始等待
    }
  }

  // --- 確保 DOM 加載完成後執行 ---
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initialize);
  }

})();

// ==UserScript==
// @name         教育部臺語辭典 - 自動循序播放音檔 (即時暫停/停止)
// @namespace    aiuanyu
// @version      3.3
// @description  自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放其中的音檔(自動偵測時長)，可即時暫停/停止，並根據亮暗模式高亮按鈕。
// @author       Aiuanyu 愛灣語 + Gemini
// @match        https://sutian.moe.edu.tw/und-hani/tshiau/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest // 備用
// @connect      sutian.moe.edu.tw // 允許獲取音檔
// @run-at       document-idle
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
        .${HIGHLIGHT_CLASS} {
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
  let isProcessing = false; // 是否正在執行播放流程
  let isPaused = false;     // 是否處於暫停狀態
  let currentLinkIndex = 0; // 目前處理到第幾個連結
  let totalLinks = 0;       // 總共有多少連結
  let currentSleepController = null; // 當前可中斷的 sleep 控制器
  let currentIframe = null; // 當前開啟的 iframe 元素
  let linksToProcess = [];  // 要處理的連結列表

  // --- UI 元素引用 ---
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;

  // --- Helper 函數 ---

  // 可中斷的延遲函數
  function interruptibleSleep(ms) {
    // 如果已有正在進行的 sleep，先取消它 (雖然理論上不應該重疊)
    if (currentSleepController) {
      currentSleepController.cancel('overridden');
    }

    let timeoutId;
    let rejectFn;
    let resolved = false;
    let rejected = false;

    const promise = new Promise((resolve, reject) => {
      rejectFn = reject; // 保存 reject 函數以便外部調用 cancel
      timeoutId = setTimeout(() => {
        if (!rejected) {
          resolved = true;
          currentSleepController = null; // 清除控制器
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
          currentSleepController = null; // 清除控制器
          // 使用一個特定的 Error 類型或屬性來標識取消
          const error = new Error(reason);
          error.isCancellation = true;
          error.reason = reason;
          rejectFn(error); // 用特定原因 reject promise
        }
      }
    };

    currentSleepController = controller; // 保存當前控制器
    return controller;
  }

  // 普通延遲函數 (用於不需要中斷的短暫停頓)
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 獲取音檔時長 (毫秒) - 與 v3.2 相同
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
        resolve(FALLBACK_DELAY_MS);
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

  // 在 Iframe 內部添加樣式 - 與 v3.2 相同
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

  // 顯示 Modal (Iframe + Overlay) - 與 v3.2 類似
  function showModal(iframe) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
      overlay.style.zIndex = '9998';
      document.body.appendChild(overlay);
    }
    iframe.style.position = 'fixed';
    iframe.style.width = MODAL_WIDTH;
    iframe.style.height = MODAL_HEIGHT;
    iframe.style.top = '50%';
    iframe.style.left = '50%';
    iframe.style.transform = 'translate(-50%, -50%)';
    iframe.style.border = '1px solid #ccc';
    iframe.style.borderRadius = '8px';
    iframe.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.3)';
    iframe.style.backgroundColor = 'white'; // 確保 iframe 有背景色
    iframe.style.zIndex = '9999';
    iframe.style.opacity = '1'; // 確保可見
    iframe.style.pointerEvents = 'auto';
    document.body.appendChild(iframe);
    currentIframe = iframe; // 保存當前 iframe 引用
    console.log("[自動播放] 已顯示 Modal iframe");
  }

  // 關閉 Modal (Iframe + Overlay) - 與 v3.2 類似
  function closeModal() {
    if (currentIframe && currentIframe.parentNode) {
      currentIframe.remove();
      console.log("[自動播放] 已移除 iframe");
    }
    currentIframe = null; // 清除引用
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.remove();
      console.log("[自動播放] 已移除背景遮罩");
    }
    // 如果有關閉 Modal 時正在進行的 sleep，也取消它
    if (currentSleepController) {
      console.log("[自動播放] 關閉 Modal 時取消正在進行的 sleep");
      currentSleepController.cancel('modal_closed');
      currentSleepController = null;
    }
  }

  // 處理單一連結的核心邏輯
  async function processSingleLink(url, index) {
    console.log(`[自動播放] processSingleLink 開始: ${index + 1}/${totalLinks} - ${url}`);
    const iframeId = `auto-play-iframe-${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;

    return new Promise(async (resolve) => {
      showModal(iframe); // 顯示空的 Modal 框架和遮罩

      iframe.onload = async () => {
        console.log(`[自動播放] Iframe 載入完成: ${url}`);
        if (!isProcessing) { // 如果在 iframe 載入完成前就停止了
          console.log("[自動播放] Iframe 載入時發現已停止，關閉 Modal");
          closeModal();
          resolve();
          return;
        }

        let iframeDoc;
        try {
          await sleep(150); // 等待 iframe 內部可能存在的初始化
          iframeDoc = iframe.contentWindow.document;
          addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);

          const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua');
          console.log(`[自動播放] 在 iframe 中找到 ${audioButtons.length} 個播放按鈕`);

          if (audioButtons.length > 0) {
            for (let i = 0; i < audioButtons.length; i++) {
              // 在處理每個按鈕前檢查狀態
              if (!isProcessing) {
                console.log("[自動播放] 播放音檔前檢測到停止");
                break; // 跳出音檔循環
              }
              while (isPaused && isProcessing) {
                console.log("[自動播放] 音檔播放已暫停，等待繼續...");
                updateStatusDisplay();
                await sleep(500); // 短暫等待避免 CPU 空轉
                if (!isProcessing) break; // 如果在暫停期間停止了
              }
              if (!isProcessing) break; // 再次檢查

              const button = audioButtons[i];
              if (!button || !iframeDoc.body.contains(button)) {
                console.warn(`[自動播放] 按鈕 ${i + 1} 失效，跳過。`);
                continue;
              }
              console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);

              // --- 獲取音檔時長 ---
              let actualDelayMs = FALLBACK_DELAY_MS;
              let audioSrc = null;
              try {
                const srcData = JSON.parse(button.dataset.src.replace(/&quot;/g, '"'));
                if (Array.isArray(srcData) && srcData.length > 0 && typeof srcData[0] === 'string') {
                  audioSrc = new URL(srcData[0], iframe.contentWindow.location.href).href;
                }
              } catch (parseError) {
                console.error("[自動播放] 解析 data-src 失敗:", parseError, button.dataset.src);
              }
              if (audioSrc) {
                actualDelayMs = await getAudioDuration(audioSrc);
              } else {
                console.warn("[自動播放] 未能獲取有效音檔 URL，使用後備延遲。");
              }
              // --- 時長獲取結束 ---

              button.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(300); // 等待滾動

              button.classList.add(HIGHLIGHT_CLASS);
              button.click();
              console.log(`[自動播放] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);

              // --- 使用可中斷的 sleep ---
              try {
                const sleepController = interruptibleSleep(actualDelayMs);
                await sleepController.promise;
              } catch (error) {
                if (error.isCancellation) {
                  console.log(`[自動播放] 等待音檔 ${i + 1} 被 '${error.reason}' 中斷。`);
                  // 無論是暫停還是停止，都移除高亮並跳出此 iframe 的音檔循環
                  if (iframeDoc.body.contains(button)) {
                    button.classList.remove(HIGHLIGHT_CLASS);
                  }
                  break; // 跳出 for 循環
                } else {
                  console.error("[自動播放] interruptibleSleep 發生意外錯誤:", error);
                  // 可以選擇繼續或終止
                }
              } finally {
                currentSleepController = null; // 清理控制器引用
              }
              // --- 中斷 sleep 結束 ---

              // 移除高亮 (如果 sleep 沒有被中斷)
              if (iframeDoc.body.contains(button) && button.classList.contains(HIGHLIGHT_CLASS)) {
                button.classList.remove(HIGHLIGHT_CLASS);
              }

              // 檢查是否在 sleep 後被停止
              if (!isProcessing) break;

              // 播放下一個之前的延遲 (也需要可中斷)
              if (i < audioButtons.length - 1) {
                console.log(`[自動播放] 播放下一個前等待 ${DELAY_BETWEEN_CLICKS_MS}ms`);
                try {
                  const sleepController = interruptibleSleep(DELAY_BETWEEN_CLICKS_MS);
                  await sleepController.promise;
                } catch (error) {
                  if (error.isCancellation) {
                    console.log(`[自動播放] 按鈕間等待被 '${error.reason}' 中斷。`);
                    break; // 跳出 for 循環
                  } else { throw error; }
                } finally {
                  currentSleepController = null;
                }
              }
              // 再次檢查狀態
              if (!isProcessing) break;

            } // --- for audioButtons loop end ---
          } else {
            console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕`);
            await sleep(1000); // 讓使用者看一下空白內容
          }
        } catch (error) {
          console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error);
        } finally {
          // 不論成功或失敗，只要還在處理流程中，就關閉當前 modal
          if (isProcessing || isPaused) { // 只有在未被外部停止時才關閉
            closeModal();
          }
          resolve(); // 完成此連結的處理
        }
      }; // --- iframe.onload end ---

      iframe.onerror = (error) => {
        console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error);
        closeModal(); // 加載失敗也要關閉 modal
        resolve(); // 繼續處理下一個連結
      };

      // 設置 src 開始載入
      iframe.src = url;
    }); // --- Promise end ---
  }

  // 循序處理連結列表
  async function processLinksSequentially() {
    console.log("[自動播放] processLinksSequentially 開始");
    while (currentLinkIndex < totalLinks && isProcessing) {
      // 檢查是否暫停
      while (isPaused && isProcessing) {
        console.log("[自動播放] 主流程已暫停，等待繼續...");
        updateStatusDisplay();
        await sleep(500); // 短暫等待
      }
      // 如果在暫停期間被停止，則跳出主循環
      if (!isProcessing) break;

      updateStatusDisplay(); // 更新進度顯示
      const linkInfo = linksToProcess[currentLinkIndex];
      console.log(`[自動播放] 準備處理連結 ${currentLinkIndex + 1}/${totalLinks}`);

      await processSingleLink(linkInfo.url, currentLinkIndex);

      // 處理完一個連結後，再次檢查狀態
      if (!isProcessing) break;

      // 移至下一個連結
      currentLinkIndex++;

      // 如果還有下一個連結，則在處理前等待一段時間 (可中斷)
      if (currentLinkIndex < totalLinks && isProcessing) {
        console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 後處理下一個連結`);
        try {
          const sleepController = interruptibleSleep(DELAY_BETWEEN_IFRAMES_MS);
          await sleepController.promise;
        } catch (error) {
          if (error.isCancellation) {
            console.log(`[自動播放] 連結間等待被 '${error.reason}' 中斷。`);
            // 如果是停止，isProcessing 會是 false，循環會自然結束
            // 如果是暫停，isPaused 會是 true，循環會在下次迭代開始時等待
          } else { throw error; }
        } finally {
          currentSleepController = null;
        }
      }
      // 再次檢查狀態
      if (!isProcessing) break;

    } // --- while loop end ---

    // 循環結束後的處理
    if (!isProcessing) {
      console.log("[自動播放] 處理流程被停止。");
      // closeModal(); // 確保 modal 已關閉 (stopPlayback 會調用)
      resetTriggerButton();
    } else if (!isPaused) { // 正常完成
      console.log("[自動播放] 所有連結處理完畢。");
      alert("所有連結攏處理完畢！");
      resetTriggerButton();
    }
    // 如果結束時是暫停狀態，則維持 UI 不變，等待繼續
  }

  // --- 控制按鈕事件處理 ---

  function startPlayback() {
    console.log("[自動播放] 開始/繼續 播放...");
    if (!isProcessing) { // ---- 如果是首次開始 ----
      const resultTable = document.querySelector('table.table.d-none.d-md-table');
      if (!resultTable) { alert("揣無結果表格！"); return; }
      const linkElements = resultTable.querySelectorAll('tbody tr td a[href^="/und-hani/su/"]');
      if (linkElements.length === 0) { alert("表格內底揣無詞目連結！"); return; }

      linksToProcess = Array.from(linkElements).map(a => ({ url: new URL(a.getAttribute('href'), window.location.origin).href }));
      totalLinks = linksToProcess.length;
      currentLinkIndex = 0; // 從頭開始
      isProcessing = true;
      isPaused = false;

      // 更新 UI
      startButton.style.display = 'none'; // 隱藏開始按鈕
      pauseButton.style.display = 'inline-block';
      pauseButton.textContent = '暫停';
      stopButton.style.display = 'inline-block';
      statusDisplay.style.display = 'inline-block';

      updateStatusDisplay();
      processLinksSequentially(); // 啟動主流程

    } else if (isPaused) { // ---- 如果是從暫停狀態繼續 ----
      isPaused = false;
      pauseButton.textContent = '暫停';
      updateStatusDisplay();
      console.log("[自動播放] 從暫停狀態繼續。");
      // 主流程 processLinksSequentially 會自動檢測到 isPaused 為 false 並繼續
    }
  }

  function pausePlayback() {
    if (isProcessing) {
      if (!isPaused) { // ---- 執行暫停 ----
        isPaused = true;
        pauseButton.textContent = '繼續';
        updateStatusDisplay();
        console.log("[自動播放] 執行暫停。");
        // 中斷當前的 sleep (如果有的話)
        if (currentSleepController) {
          currentSleepController.cancel('paused');
        }
      } else { // ---- 執行繼續 (等同於點擊 startButton) ----
        startPlayback();
      }
    }
  }

  function stopPlayback() {
    console.log("[自動播放] 執行停止。");
    isProcessing = false; // 設置處理標誌為 false
    isPaused = false;     // 同時清除暫停標誌

    // 中斷當前的 sleep (如果有的話)
    if (currentSleepController) {
      currentSleepController.cancel('stopped');
    }

    // 立即關閉當前的 Modal (如果存在)
    closeModal();

    // 重置 UI 到初始狀態
    resetTriggerButton();
    updateStatusDisplay(); // 清空狀態顯示
  }

  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing && !isPaused) {
        statusDisplay.textContent = `處理中 (${currentLinkIndex + 1}/${totalLinks})`;
      } else if (isProcessing && isPaused) {
        statusDisplay.textContent = `已暫停 (${currentLinkIndex + 1}/${totalLinks})`;
      } else {
        statusDisplay.textContent = ''; // 不在處理中則清空
      }
    }
  }

  function resetTriggerButton() {
    console.log("[自動播放] 重置按鈕狀態。");
    isProcessing = false; // 確保狀態重置
    isPaused = false;
    currentLinkIndex = 0;
    totalLinks = 0;
    linksToProcess = [];
    if (startButton && pauseButton && stopButton && statusDisplay) {
      startButton.disabled = false;
      startButton.style.display = 'inline-block';
      pauseButton.style.display = 'none';
      pauseButton.textContent = '暫停'; // 恢復預設文字
      stopButton.style.display = 'none';
      statusDisplay.style.display = 'none';
      statusDisplay.textContent = '';
    }
  }

  // --- 添加觸發按鈕 ---
  function addTriggerButton() {
    if (document.getElementById('auto-play-controls-container')) return; // 防止重複添加

    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'auto-play-controls-container'; // 給容器一個 ID
    buttonContainer.style.position = 'fixed';
    buttonContainer.style.top = '10px';
    buttonContainer.style.left = '10px';
    buttonContainer.style.zIndex = '10001';
    buttonContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.8)'; // 半透明背景
    buttonContainer.style.padding = '5px 10px';
    buttonContainer.style.borderRadius = '5px';
    buttonContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

    const buttonStyle = `
            padding: 6px 12px; /* 稍微縮小按鈕 */
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px; /* 稍微縮小字體 */
            margin-right: 5px;
            transition: background-color 0.2s ease;
        `;

    // 開始按鈕 (初始顯示)
    startButton = document.createElement('button');
    startButton.id = 'auto-play-start-button';
    startButton.textContent = '開始播放全部';
    startButton.style.cssText = buttonStyle;
    startButton.style.backgroundColor = '#28a745'; // 綠色
    startButton.style.color = 'white';
    startButton.addEventListener('click', startPlayback);
    buttonContainer.appendChild(startButton);

    // 暫停/繼續按鈕 (初始隱藏)
    pauseButton = document.createElement('button');
    pauseButton.id = 'auto-play-pause-button';
    pauseButton.textContent = '暫停';
    pauseButton.style.cssText = buttonStyle;
    pauseButton.style.backgroundColor = '#ffc107'; // 黃色
    pauseButton.style.color = 'black';
    pauseButton.style.display = 'none';
    pauseButton.addEventListener('click', pausePlayback);
    buttonContainer.appendChild(pauseButton);

    // 停止按鈕 (初始隱藏)
    stopButton = document.createElement('button');
    stopButton.id = 'auto-play-stop-button';
    stopButton.textContent = '停止';
    stopButton.style.cssText = buttonStyle;
    stopButton.style.backgroundColor = '#dc3545'; // 紅色
    stopButton.style.color = 'white';
    stopButton.style.display = 'none';
    stopButton.addEventListener('click', stopPlayback);
    buttonContainer.appendChild(stopButton);

    // 狀態顯示 (初始隱藏)
    statusDisplay = document.createElement('span');
    statusDisplay.id = 'auto-play-status';
    statusDisplay.style.display = 'none';
    statusDisplay.style.marginLeft = '10px';
    statusDisplay.style.fontSize = '14px';
    statusDisplay.style.verticalAlign = 'middle'; // 垂直居中
    buttonContainer.appendChild(statusDisplay);

    document.body.appendChild(buttonContainer);

    // 添加按鈕禁用/懸停樣式
    GM_addStyle(`
            #auto-play-controls-container button:disabled {
                opacity: 0.65;
                cursor: not-allowed;
            }
            #auto-play-start-button:hover:not(:disabled) { background-color: #218838 !important; }
            #auto-play-pause-button:hover:not(:disabled) { background-color: #e0a800 !important; }
            #auto-play-stop-button:hover:not(:disabled) { background-color: #c82333 !important; }
        `);
  }

  // --- 初始化 ---
  function initialize() {
    if (window.autoPlayerInitialized) return;
    window.autoPlayerInitialized = true;
    console.log("[自動播放] 初始化腳本 v3.3 ...");
    addTriggerButton();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initialize);
  }

})();

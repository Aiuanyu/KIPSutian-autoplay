// ==UserScript==
// @name         教育部臺語辭典 - 自動循序播放音檔 (修正暫停/解析/遮罩點擊)
// @namespace    aiuanyu
// @version      3.4
// @description  自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放其中的音檔(自動偵測時長)，可即時暫停(不關閉Modal)/停止/點擊背景暫停(關閉Modal)，並根據亮暗模式高亮按鈕。
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
  let isProcessing = false;
  let isPaused = false;
  let currentLinkIndex = 0;
  let totalLinks = 0;
  let currentSleepController = null;
  let currentIframe = null;
  let linksToProcess = [];

  // --- UI 元素引用 ---
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;
  let overlayElement = null; // 引用背景遮罩元素

  // --- Helper 函數 ---

  // 可中斷的延遲函數 (與 v3.3 相同)
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

  // 普通延遲函數 (與 v3.3 相同)
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 獲取音檔時長 (毫秒) - (與 v3.3 相同)
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

  // 在 Iframe 內部添加樣式 (與 v3.3 相同)
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
  function handleOverlayClick() {
    if (isProcessing && !isPaused) {
      console.log("[自動播放] 點擊背景遮罩，觸發暫停並關閉 Modal。");
      isPaused = true; // 設置為暫停狀態
      pauseButton.textContent = '繼續'; // 更新按鈕文字
      updateStatusDisplay(); // 更新狀態顯示

      // 中斷當前的 sleep
      if (currentSleepController) {
        currentSleepController.cancel('paused_overlay');
      }
      // 關閉 Modal
      closeModal();
    }
  }

  // 顯示 Modal (Iframe + Overlay) - 添加遮罩點擊事件
  function showModal(iframe) {
    overlayElement = document.getElementById(OVERLAY_ID); // 獲取或創建遮罩
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
      overlayElement.style.cursor = 'pointer'; // 添加手型指標提示可點擊
      document.body.appendChild(overlayElement);
      console.log("[自動播放] 已創建背景遮罩");
    }
    // 每次顯示 Modal 時都重新綁定事件，確保使用的是最新的狀態
    overlayElement.removeEventListener('click', handleOverlayClick); // 先移除舊的監聽器
    overlayElement.addEventListener('click', handleOverlayClick); // 添加新的監聽器
    console.log("[自動播放] 已綁定背景遮罩點擊事件");


    // iframe 樣式設置 (與 v3.3 相同)
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
    console.log("[自動播放] 已顯示 Modal iframe");
  }

  // 關閉 Modal (Iframe + Overlay) - 移除遮罩點擊事件
  function closeModal() {
    if (currentIframe && currentIframe.parentNode) {
      currentIframe.remove();
      console.log("[自動播放] 已移除 iframe");
    }
    currentIframe = null;
    if (overlayElement) { // 使用保存的引用
      overlayElement.removeEventListener('click', handleOverlayClick); // 移除監聽器
      overlayElement.remove();
      overlayElement = null; // 清除引用
      console.log("[自動播放] 已移除背景遮罩及其點擊事件");
    }
    if (currentSleepController) {
      console.log("[自動播放] 關閉 Modal 時取消正在進行的 sleep");
      currentSleepController.cancel('modal_closed');
      currentSleepController = null;
    }
  }

  // 處理單一連結的核心邏輯 - 修改 data-src 解析和 finally 塊
  async function processSingleLink(url, index) {
    console.log(`[自動播放] processSingleLink 開始: ${index + 1}/${totalLinks} - ${url}`);
    const iframeId = `auto-play-iframe-${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;

    return new Promise(async (resolve) => {
      showModal(iframe);

      iframe.onload = async () => {
        console.log(`[自動播放] Iframe 載入完成: ${url}`);
        if (!isProcessing) {
          console.log("[自動播放] Iframe 載入時發現已停止，關閉 Modal");
          closeModal();
          resolve();
          return;
        }

        let iframeDoc;
        try {
          await sleep(150);
          iframeDoc = iframe.contentWindow.document;
          addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);

          const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua');
          console.log(`[自動播放] 在 iframe 中找到 ${audioButtons.length} 個播放按鈕`);

          if (audioButtons.length > 0) {
            for (let i = 0; i < audioButtons.length; i++) {
              if (!isProcessing) { console.log("[自動播放] 播放音檔前檢測到停止"); break; }
              while (isPaused && isProcessing) {
                console.log("[自動播放] 音檔播放已暫停，等待繼續...");
                updateStatusDisplay();
                await sleep(500);
                if (!isProcessing) break;
              }
              if (!isProcessing) break;

              const button = audioButtons[i];
              if (!button || !iframeDoc.body.contains(button)) {
                console.warn(`[自動播放] 按鈕 ${i + 1} 失效，跳過。`);
                continue;
              }
              console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);

              // --- **修改 data-src 解析邏輯** ---
              let actualDelayMs = FALLBACK_DELAY_MS;
              let audioSrc = null;
              let audioPath = null;
              const srcString = button.dataset.src;

              if (srcString) {
                try {
                  // 嘗試解析為 JSON 陣列
                  const parsedData = JSON.parse(srcString.replace(/&quot;/g, '"'));
                  if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === 'string') {
                    audioPath = parsedData[0];
                    console.log("[自動播放] data-src 解析為 JSON 陣列:", audioPath);
                  } else {
                    console.warn("[自動播放] data-src 解析為 JSON 但格式不符:", srcString);
                  }
                } catch (e) {
                  // JSON 解析失敗，假定為直接路徑
                  if (typeof srcString === 'string' && srcString.trim().startsWith('/')) {
                    audioPath = srcString.trim();
                    console.log("[自動播放] data-src 解析為直接路徑:", audioPath);
                  } else {
                    console.warn("[自動播放] data-src 格式無法識別:", srcString);
                  }
                }
              }

              if (audioPath) {
                try {
                  // 確保 base URL 正確 (使用 iframe 的 location)
                  const base = iframe.contentWindow.location.href;
                  audioSrc = new URL(audioPath, base).href;
                } catch (urlError) {
                  console.error("[自動播放] 構建音檔 URL 失敗:", urlError, audioPath);
                  audioSrc = null;
                }
              } else {
                console.warn("[自動播放] 未能從 data-src 提取有效音檔路徑。");
                audioSrc = null;
              }

              actualDelayMs = await getAudioDuration(audioSrc); // 使用解析出的 audioSrc
              // --- **解析邏輯結束** ---


              button.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(300);

              button.classList.add(HIGHLIGHT_CLASS);
              button.click();
              console.log(`[自動播放] 已點擊按鈕 ${i + 1}，等待 ${actualDelayMs}ms`);

              try {
                const sleepController = interruptibleSleep(actualDelayMs);
                await sleepController.promise;
              } catch (error) {
                if (error.isCancellation) {
                  console.log(`[自動播放] 等待音檔 ${i + 1} 被 '${error.reason}' 中斷。`);
                  if (iframeDoc.body.contains(button)) {
                    button.classList.remove(HIGHLIGHT_CLASS);
                  }
                  break;
                } else { console.error("[自動播放] interruptibleSleep 發生意外錯誤:", error); }
              } finally { currentSleepController = null; }

              if (iframeDoc.body.contains(button) && button.classList.contains(HIGHLIGHT_CLASS)) {
                button.classList.remove(HIGHLIGHT_CLASS);
              }

              if (!isProcessing) break;

              if (i < audioButtons.length - 1) {
                console.log(`[自動播放] 播放下一個前等待 ${DELAY_BETWEEN_CLICKS_MS}ms`);
                try {
                  const sleepController = interruptibleSleep(DELAY_BETWEEN_CLICKS_MS);
                  await sleepController.promise;
                } catch (error) {
                  if (error.isCancellation) {
                    console.log(`[自動播放] 按鈕間等待被 '${error.reason}' 中斷。`);
                    break;
                  } else { throw error; }
                } finally { currentSleepController = null; }
              }
              if (!isProcessing) break;

            } // --- for audioButtons loop end ---
          } else {
            console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕`);
            await sleep(1000);
          }
        } catch (error) {
          console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error);
        } finally {
          // **修改 finally 邏輯**
          // 只有在不是暫停狀態時才關閉 Modal (即正常完成或被停止)
          if (!isPaused) {
            console.log("[自動播放] processSingleLink 結束，非暫停狀態，關閉 Modal");
            closeModal();
          } else {
            console.log("[自動播放] processSingleLink 結束，處於暫停狀態，保持 Modal 開啟");
            // 如果是暫停，我們需要確保 currentIframe 引用仍然有效，以便稍後可以繼續
            // closeModal() 不會被調用，所以 currentIframe 保持不變
          }
          resolve(); // 完成此連結的處理
        }
      }; // --- iframe.onload end ---

      iframe.onerror = (error) => {
        console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error);
        closeModal();
        resolve();
      };

      iframe.src = url;
    }); // --- Promise end ---
  }

  // 循序處理連結列表 (與 v3.3 相同)
  async function processLinksSequentially() {
    console.log("[自動播放] processLinksSequentially 開始");
    while (currentLinkIndex < totalLinks && isProcessing) {
      while (isPaused && isProcessing) {
        console.log("[自動播放] 主流程已暫停，等待繼續...");
        updateStatusDisplay();
        await sleep(500);
      }
      if (!isProcessing) break;

      updateStatusDisplay();
      const linkInfo = linksToProcess[currentLinkIndex];
      console.log(`[自動播放] 準備處理連結 ${currentLinkIndex + 1}/${totalLinks}`);

      await processSingleLink(linkInfo.url, currentLinkIndex);

      if (!isProcessing) break; // 檢查 processSingleLink 後是否被停止

      // **重要：只有在沒有暫停的情況下才移動到下一個連結**
      // 如果 processSingleLink 是因為 isPaused=true 而結束（保持 Modal 開啟），
      // 我們不應該增加 currentLinkIndex，以便下次繼續時處理同一個連結。
      if (!isPaused) {
        currentLinkIndex++;
      } else {
        console.log("[自動播放] 偵測到暫停狀態，currentLinkIndex 保持不變");
        // 這裡不需要 break，外層 while 會處理 isPaused
      }


      if (currentLinkIndex < totalLinks && isProcessing && !isPaused) { // 只有在非暫停且還有連結時才等待
        console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 後處理下一個連結`);
        try {
          const sleepController = interruptibleSleep(DELAY_BETWEEN_IFRAMES_MS);
          await sleepController.promise;
        } catch (error) {
          if (error.isCancellation) {
            console.log(`[自動播放] 連結間等待被 '${error.reason}' 中斷。`);
          } else { throw error; }
        } finally {
          currentSleepController = null;
        }
      }
      if (!isProcessing) break;

    } // --- while loop end ---

    if (!isProcessing) {
      console.log("[自動播放] 處理流程被停止。");
      resetTriggerButton();
    } else if (!isPaused) {
      console.log("[自動播放] 所有連結處理完畢。");
      alert("所有連結攏處理完畢！");
      resetTriggerButton();
    } else {
      console.log("[自動播放] 流程結束於暫停狀態。");
      // 維持 UI 狀態，等待使用者操作
    }
  }

  // --- 控制按鈕事件處理 ---

  // startPlayback (與 v3.3 相同)
  function startPlayback() {
    console.log("[自動播放] 開始/繼續 播放...");
    if (!isProcessing) {
      const resultTable = document.querySelector('table.table.d-none.d-md-table');
      if (!resultTable) { alert("揣無結果表格！"); return; }
      const linkElements = resultTable.querySelectorAll('tbody tr td a[href^="/und-hani/su/"]');
      if (linkElements.length === 0) { alert("表格內底揣無詞目連結！"); return; }

      linksToProcess = Array.from(linkElements).map(a => ({ url: new URL(a.getAttribute('href'), window.location.origin).href }));
      totalLinks = linksToProcess.length;
      currentLinkIndex = 0;
      isProcessing = true;
      isPaused = false;

      startButton.style.display = 'none';
      pauseButton.style.display = 'inline-block';
      pauseButton.textContent = '暫停';
      stopButton.style.display = 'inline-block';
      statusDisplay.style.display = 'inline-block';

      updateStatusDisplay();
      processLinksSequentially();

    } else if (isPaused) {
      isPaused = false;
      pauseButton.textContent = '暫停';
      updateStatusDisplay();
      console.log("[自動播放] 從暫停狀態繼續。");
      // 如果 currentIframe 仍然存在 (表示上次是按鈕暫停，Modal 沒關)
      // 則不需要重新啟動 processLinksSequentially，
      // 它內部的 while(isPaused) 會自動解除阻塞。
      // 如果 currentIframe 為 null (表示上次是點擊背景暫停，Modal 已關)
      // 則需要重新啟動 processLinksSequentially 來處理當前的 currentLinkIndex
      if (!currentIframe) {
        console.log("[自動播放] 從背景點擊暫停狀態繼續，重新啟動處理流程。");
        // 確保 isProcessing 仍然是 true
        isProcessing = true;
        processLinksSequentially();
      }
    }
  }

  // pausePlayback - 修改為不關閉 Modal
  function pausePlayback() {
    if (isProcessing) {
      if (!isPaused) {
        isPaused = true;
        pauseButton.textContent = '繼續';
        updateStatusDisplay();
        console.log("[自動播放] 執行暫停 (保持 Modal 開啟)。");
        if (currentSleepController) {
          currentSleepController.cancel('paused');
        }
        // **不再調用 closeModal()**
      } else {
        startPlayback(); // 從暫停狀態繼續
      }
    }
  }

  // stopPlayback (與 v3.3 相同)
  function stopPlayback() {
    console.log("[自動播放] 執行停止。");
    isProcessing = false;
    isPaused = false;
    if (currentSleepController) {
      currentSleepController.cancel('stopped');
    }
    closeModal(); // 停止時總是關閉 Modal
    resetTriggerButton();
    updateStatusDisplay();
  }

  // updateStatusDisplay (與 v3.3 相同)
  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing && !isPaused) {
        statusDisplay.textContent = `處理中 (${currentLinkIndex + 1}/${totalLinks})`;
      } else if (isProcessing && isPaused) {
        statusDisplay.textContent = `已暫停 (${currentLinkIndex + 1}/${totalLinks})`;
      } else {
        statusDisplay.textContent = '';
      }
    }
  }

  // resetTriggerButton (與 v3.3 相同)
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
    // 確保 Modal 也關閉了
    closeModal();
  }

  // --- 添加觸發按鈕 --- (與 v3.3 相同)
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

    const buttonStyle = `
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-right: 5px;
            transition: background-color 0.2s ease;
        `;

    startButton = document.createElement('button');
    startButton.id = 'auto-play-start-button';
    startButton.textContent = '開始播放全部';
    startButton.style.cssText = buttonStyle;
    startButton.style.backgroundColor = '#28a745';
    startButton.style.color = 'white';
    startButton.addEventListener('click', startPlayback);
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

  // --- 初始化 --- (與 v3.3 相同)
  function initialize() {
    if (window.autoPlayerInitialized) return;
    window.autoPlayerInitialized = true;
    console.log("[自動播放] 初始化腳本 v3.4 ...");
    addTriggerButton();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initialize);
  }

})();

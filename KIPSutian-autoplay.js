// ==UserScript==
// @name         教育部臺語辭典 - 自動循序播放音檔 (自動時長+亮暗模式)
// @namespace    aiuanyu
// @version      3.2
// @description  自動開啟查詢結果表格中每個詞目連結於 Modal iframe，依序播放其中的音檔(自動偵測時長)，並根據亮暗模式高亮當前播放按鈕。
// @author       Aiuanyu 愛灣語 + Gemini
// @match        https://sutian.moe.edu.tw/und-hani/tshiau/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest // 需要此權限來獲取音檔元數據可能遇到的 CORS 問題 (備用)
// @connect      sutian.moe.edu.tw // 允許跨域請求到同一網站以獲取音檔
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- 配置 ---
  const MODAL_WIDTH = '80vw'; // Modal 寬度
  const MODAL_HEIGHT = '50vh'; // Modal 高度
  const FALLBACK_DELAY_MS = 3000; // 當無法獲取音檔時長時的後備延遲 (毫秒)
  const DELAY_BUFFER_MS = 500; // 在獲取的音檔時長基礎上額外增加的緩衝時間 (毫秒)
  const DELAY_BETWEEN_CLICKS_MS = 750; // 點擊 iframe 內下一個按鈕前的短暫停頓 (毫秒)
  const DELAY_BETWEEN_IFRAMES_MS = 1250; // 處理完一個 iframe 到開啟下一個 iframe 之間的延遲 (毫秒)
  const HIGHLIGHT_CLASS = 'userscript-audio-playing'; // 高亮 CSS class
  const OVERLAY_ID = 'userscript-modal-overlay'; // 背景遮罩 ID

  // --- 適應亮暗模式的高亮樣式 ---
  const HIGHLIGHT_STYLE = `
        /* 預設 (亮色模式) */
        .${HIGHLIGHT_CLASS} {
            background-color: #FFF352 !important; /* 稍亮的黃色 */
            color: black !important; /* 確保文字對比 */
            outline: 2px solid #FFB800 !important; /* 橘黃色外框 */
            box-shadow: 0 0 10px #FFF352; /* 添加一點光暈效果 */
            transition: background-color 0.2s ease-in-out, outline 0.2s ease-in-out, color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        }

        /* 深色模式 */
        @media (prefers-color-scheme: dark) {
            .${HIGHLIGHT_CLASS} {
                background-color: #66b3ff !important; /* 柔和的淺藍色 */
                color: black !important; /* 確保文字對比 */
                outline: 2px solid #87CEFA !important; /* 天藍色外框 */
                box-shadow: 0 0 10px #66b3ff; /* 添加一點光暈效果 */
            }
        }
    `;
  // --- 配置結束 ---

  // --- Helper 函數 ---
  // 延遲函數
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
      audio.preload = 'metadata'; // 只需要元數據

      const timer = setTimeout(() => {
        console.warn(`[自動播放] 獲取音檔 ${audioUrl} 元數據超時 (5秒)，使用後備延遲。`);
        cleanupAudio();
        resolve(FALLBACK_DELAY_MS);
      }, 5000); // 設置 5 秒超時

      const cleanupAudio = () => {
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('error', onError);
        audio.src = ''; // 釋放資源
        // audio = null; // 雖然在現代 JS 中不太需要手動設 null
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

  // 顯示 Modal (Iframe + Overlay)
  function showModal(iframe) {
    // 創建背景遮罩
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'; // 加深一點遮罩
      overlay.style.zIndex = '9998';
      document.body.appendChild(overlay);
      console.log("[自動播放] 已顯示背景遮罩");
    }

    // 設定 iframe 樣式為 Modal
    iframe.style.position = 'fixed';
    iframe.style.width = MODAL_WIDTH;
    iframe.style.height = MODAL_HEIGHT;
    iframe.style.top = '50%';
    iframe.style.left = '50%';
    iframe.style.transform = 'translate(-50%, -50%)';
    iframe.style.border = '1px solid #ccc';
    iframe.style.borderRadius = '8px'; // 加點圓角
    iframe.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.3)'; // 加深陰影
    iframe.style.backgroundColor = 'white';
    iframe.style.zIndex = '9999';
    iframe.style.opacity = '1';
    iframe.style.pointerEvents = 'auto';

    document.body.appendChild(iframe);
    console.log("[自動播放] 已顯示 Modal iframe");

    // 稍微調整 Modal 的透明度 (可根據喜好調整)
    iframe.style.opacity = '0.95';
  }

  // 關閉 Modal (Iframe + Overlay)
  function closeModal(iframe) {
    if (iframe && iframe.parentNode) {
      iframe.remove();
      console.log("[自動播放] 已移除 iframe");
    } else if (iframe) {
      console.warn("[自動播放] 嘗試移除 iframe 時，它已不在 DOM 中。");
    }
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.remove();
      console.log("[自動播放] 已移除背景遮罩");
    }
  }

  let isProcessing = false; // 全局變數追蹤是否正在處理
  let isPaused = false;     // 全局變數追蹤是否已暫停
  let currentLinkIndex = 0; // 目前處理的連結索引
  let totalLinks = 0;       // 總共的連結數量
  let startButton;
  let pauseButton;
  let stopButton;
  let statusDisplay;

  // 處理單一連結的函數
  async function processLink(url, index) {
    if (isPaused) {
      console.log(`[自動播放] 處理第 ${index + 1} / ${totalLinks} 個連結: ${url} - 已暫停`);
      updateStatusDisplay();
      return Promise.resolve(); // 如果已暫停，直接 resolve
    }
    console.log(`[自動播放] 開始處理第 ${index + 1} / ${totalLinks} 個連結: ${url}`);
    const iframeId = `auto-play-iframe-${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;

    return new Promise(async (resolve) => { // 將 Promise 回調改為 async
      showModal(iframe);

      iframe.onload = async () => {
        console.log(`[自動播放] Iframe 載入完成: ${url}`);
        let iframeDoc;
        try {
          await sleep(150); // 稍微增加等待時間
          iframeDoc = iframe.contentWindow.document;

          addStyleToIframe(iframeDoc, HIGHLIGHT_STYLE);

          const audioButtons = iframeDoc.querySelectorAll('button.imtong-liua');
          console.log(`[自動播放] 在 iframe 中找到 ${audioButtons.length} 個播放按鈕`);

          if (audioButtons.length > 0) {
            for (let i = 0; i < audioButtons.length; i++) {
              if (isPaused) {
                console.log(`[自動播放] Iframe ${url} 中第 ${i + 1} 個音檔播放 - 已暫停`);
                updateStatusDisplay();
                break; // 如果已暫停，跳出內部迴圈
              }
              const button = audioButtons[i];
              if (!button || !iframeDoc.body.contains(button)) {
                console.warn(`[自動播放] 按鈕 ${i + 1} 在嘗試播放前已失效或移除，跳過。`);
                continue;
              }
              console.log(`[自動播放] 準備播放 iframe 中的第 ${i + 1} 個音檔`);

              // --- 獲取音檔時長 ---
              let actualDelayMs = FALLBACK_DELAY_MS;
              let audioSrc = null;
              try {
                // 直接將 data-src 作為 URL (去除 JSON 解析)
                audioSrc = new URL(button.dataset.src.replace(/&quot;/g, '"'), iframe.contentWindow.location.href).href;
              } catch (parseError) {
                console.error("[自動播放] 處理 data-src 失敗:", parseError, button.dataset.src);
              }

              if (audioSrc) {
                const duration = await getAudioDuration(audioSrc);
                actualDelayMs = duration;
              } else {
                console.warn("[自動播放] 未能從 data-src 獲取有效音檔 URL，使用後備延遲。");
              }
              // --- 音檔時長獲取結束 ---

              button.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(300);

              button.classList.add(HIGHLIGHT_CLASS);
              console.log(`[自動播放] 已高亮按鈕 ${i + 1}`);

              console.log(`[自動播放] 點擊按鈕 ${i + 1}`);
              button.click();

              console.log(`[自動播放] 等待 ${actualDelayMs}ms (音檔時長 + ${DELAY_BUFFER_MS}ms)`);
              await sleep(actualDelayMs);

              if (iframeDoc.body.contains(button)) {
                button.classList.remove(HIGHLIGHT_CLASS);
                console.log(`[自動播放] 已移除按鈕 ${i + 1} 的高亮`);
              } else {
                console.warn(`[自動播放] 按鈕 ${i + 1} 在嘗試移除高亮前已失效或移除。`);
              }

              if (i < audioButtons.length - 1) {
                console.log(`[自動播放] 播放下一個前等待 ${DELAY_BETWEEN_CLICKS_MS}ms`);
                await sleep(DELAY_BETWEEN_CLICKS_MS);
              }
            }
            console.log(`[自動播放] Iframe ${url} 中的所有音檔播放完畢。`);
          } else {
            console.log(`[自動播放] Iframe ${url} 中未找到播放按鈕 (button.imtong-liua)`);
            await sleep(1000);
          }

        } catch (error) {
          // ... (錯誤處理保持不變) ...
          if (iframe && iframe.contentWindow) {
            console.error(`[自動播放] 處理 iframe 內容時出錯 (${url}):`, error);
          } else {
            console.error(`[自動播放] 處理 iframe 內容時出錯，iframe 可能已卸載 (${url}):`, error);
          }
        } finally {
          closeModal(iframe);
          resolve(); // 移到 finally 確保無論如何都 resolve
        }
      };

      iframe.onerror = (error) => {
        console.error(`[自動播放] Iframe 載入失敗 (${url}):`, error);
        closeModal(iframe);
        console.warn(`[自動播放] Iframe ${url} 加載失敗，將跳過此連結。`);
        resolve(); // 移到 onerror 內部確保 resolve
      };

      // 在添加事件監聽器後設置 src
      iframe.src = url;
    });
  }

  function startPlayback() {
    console.log("[自動播放] 開始播放...");
    if (isProcessing) {
      isPaused = false;
      if (pauseButton) pauseButton.textContent = '暫停';
      if (startButton) startButton.textContent = '暫停'; // 開始播放後，「開始」按鈕文字也變「暫停」
      updateStatusDisplay();
      return;
    }

    if (startButton && pauseButton && stopButton && statusDisplay) {
      startButton.disabled = true;
      startButton.style.display = 'none';
      pauseButton.style.display = 'inline-block';
      stopButton.style.display = 'inline-block';
      statusDisplay.style.display = 'inline-block';
      isProcessing = true;
      isPaused = false;
      currentLinkIndex = 0;
      const resultTable = document.querySelector('table.table.d-none.d-md-table');
      if (!resultTable) {
        console.error("[自動播放] 找不到結果表格 (table.table.d-none.d-md-table)");
        alert("揣無結果表格！");
        resetTriggerButton();
        return;
      }
      const links = resultTable.querySelectorAll('tbody tr td a[href^="/und-hani/su/"]');
      if (links.length === 0) {
        console.warn("[自動播放] 表格中未找到符合條件的連結 (tbody tr td a[href^='/und-hani/su/'])");
        alert("表格內底揣無詞目連結！");
        resetTriggerButton();
        return;
      }
      totalLinks = links.length;
      updateStatusDisplay();
      processLinksSequentially(links);
    }
  }

  async function processLinksSequentially(links) {
    let i = currentLinkIndex; // 從目前處理的索引繼續
    while (i < links.length && isProcessing) {
      if (isPaused) {
        console.log("[自動播放] 處理循環已暫停，等待繼續...");
        await sleep(500); // 稍微等一下，避免一直檢查
        continue; // 跳過這次循環，等待 isPaused 變 false
      }

      currentLinkIndex = i;
      console.log("[自動播放] processLinksSequentially 循環中，isPaused:", isPaused, "isProcessing:", isProcessing);
      updateStatusDisplay();
      const linkElement = links[i];
      if (linkElement.href) {
        const absoluteUrl = new URL(linkElement.getAttribute('href'), window.location.origin).href;
        try {
          await processLink(absoluteUrl, i);
          if (i < links.length - 1 && !isPaused && isProcessing) {
            console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 了後處理下一個連結`);
            await sleep(DELAY_BETWEEN_IFRAMES_MS);
          }
        } catch (error) {
          console.error(`[自動播放] 處理連結 ${absoluteUrl} 的外層循環掠著無預期的錯誤:`, error);
        }
      } else {
        console.warn(`[自動播放] 第 ${i + 1} 個連結元素沒有有效的 href 屬性。`);
      }
      i++;
    }
    if (isProcessing && !isPaused) {
      console.log("[自動播放] processLinksSequentially 結束，isProcessing:", isProcessing);
      console.log("[自動播放] 所有連結攏處理完畢。");
      alert("所有連結攏處理完畢！");
      resetTriggerButton();
    } else if (!isProcessing) {
      resetTriggerButton(); // 如果是按停止，也要重置按鈕
    }
  }

  function pausePlayback() {
    console.log("[自動播放] pausePlayback 函數被呼叫"); // 新增日誌
    if (isProcessing) {
      isPaused = !isPaused;
      if (pauseButton) pauseButton.textContent = isPaused ? '繼續' : '暫停';
      updateStatusDisplay();
      console.log(`[自動播放] 自動播放已 ${isPaused ? '暫停' : '繼續'}。`);
    }
  }

  function stopPlayback() {
    isProcessing = false;
    isPaused = false;
    currentLinkIndex = 0;
    totalLinks = 0;
    resetTriggerButton();
    updateStatusDisplay();
    console.log("[自動播放] 自動播放已停止。");
  }

  function updateStatusDisplay() {
    if (statusDisplay) {
      if (isProcessing) {
        statusDisplay.textContent = `處理中 (${currentLinkIndex + 1}/${totalLinks})`;
      } else if (isPaused) {
        statusDisplay.textContent = `已暫停 (${currentLinkIndex + 1}/${totalLinks})`;
      } else {
        statusDisplay.textContent = '';
      }
    }
  }

  function resetTriggerButton() {
    if (startButton && pauseButton && stopButton && statusDisplay) {
      startButton.disabled = false;
      startButton.style.display = 'inline-block';
      startButton.textContent = '開始播放全部';
      pauseButton.style.display = 'none';
      pauseButton.textContent = '暫停';
      stopButton.style.display = 'none';
      statusDisplay.style.display = 'none';
    }
  }

  // --- 添加觸發按鈕 ---
  function addTriggerButton() {
    if (document.getElementById('auto-play-start-button')) return;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.position = 'fixed';
    buttonContainer.style.top = '10px';
    buttonContainer.style.left = '10px';
    buttonContainer.style.zIndex = '10001';

    const buttonStyle = `
            padding: 8px 15px;
            background-color: #0d6efd;
            color: white;
            border: 2px solid #007bff;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            margin-right: 5px;
        `;

    startButton = document.createElement('button');
    startButton.id = 'auto-play-start-button';
    startButton.textContent = '開始播放全部';
    startButton.style.cssText = buttonStyle;
    startButton.addEventListener('click', startPlayback);
    buttonContainer.appendChild(startButton);

    pauseButton = document.createElement('button');
    pauseButton.id = 'auto-play-pause-button';
    pauseButton.textContent = '暫停';
    pauseButton.style.cssText = buttonStyle;
    pauseButton.style.display = 'none';
    pauseButton.addEventListener('click', pausePlayback); // 修改這裡
    buttonContainer.appendChild(pauseButton);

    stopButton = document.createElement('button');
    stopButton.id = 'auto-play-stop-button';
    stopButton.textContent = '停止';
    stopButton.style.cssText = buttonStyle;
    stopButton.style.display = 'none';
    stopButton.addEventListener('click', stopPlayback);
    buttonContainer.appendChild(stopButton);

    statusDisplay = document.createElement('span');
    statusDisplay.id = 'auto-play-status';
    statusDisplay.style.display = 'none';
    statusDisplay.style.marginLeft = '10px';
    statusDisplay.style.fontSize = '16px';
    buttonContainer.appendChild(statusDisplay);

    document.body.appendChild(buttonContainer);

    // 添加按鈕禁用樣式
    GM_addStyle(`
            #auto-play-start-button:disabled, #auto-play-pause-button:disabled, #auto-play-stop-button:disabled {
                background-color: #6c757d;
                cursor: not-allowed;
                opacity: 0.65;
            }
        `);
  }

  // --- 初始化 ---
  function initialize() {
    if (window.autoPlayerInitialized) return;
    window.autoPlayerInitialized = true;
    console.log("[自動播放] 初始化腳本 v3.1 ...");
    addTriggerButton();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initialize);
  }

})();
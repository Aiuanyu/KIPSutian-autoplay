// ==UserScript==
// @name         教育部臺語辭典 - 自動循序播放音檔 (自動時長+亮暗模式)
// @namespace    aiuanyu
// @version      1.7
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
        // 嘗試直接設置 src
        // 如果遇到 CORS 問題，可能需要 GM_xmlhttpRequest (但通常獲取同源的 metadata 不會有問題)
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

  // 處理單一連結的函數
  async function processLink(url, index, total) {
    if (isPaused) {
      console.log(`[自動播放] 處理第 ${index + 1} / ${total} 個連結: ${url} - 已暫停`);
      return Promise.resolve(); // 如果已暫停，直接 resolve
    }
    console.log(`[自動播放] 開始處理第 ${index + 1} / ${total} 個連結: ${url}`);
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
                // data-src 的內容是 JSON 字串，如 [&quot;/path/to.mp3&quot;]
                const srcData = JSON.parse(button.dataset.src.replace(/&quot;/g, '"'));
                if (Array.isArray(srcData) && srcData.length > 0 && typeof srcData[0] === 'string') {
                  // 構建絕對 URL
                  audioSrc = new URL(srcData[0], iframe.contentWindow.location.href).href;
                }
              } catch (parseError) {
                console.error("[自動播放] 解析 data-src 失敗:", parseError, button.dataset.src);
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

  // 主要執行函數
  async function startProcessing() {
    console.log("[自動播放] 開始處理...");
    const triggerButton = document.getElementById('auto-play-trigger-button');

    if (triggerButton) {
      if (isProcessing) {
        // 如果正在處理，則切換為暫停狀態
        isPaused = !isPaused;
        triggerButton.textContent = isPaused ? '繼續自動播放' : '暫停自動播放'; // 更簡潔的文字
        console.log(`[自動播放] 自動播放已 ${isPaused ? '暫停' : '繼續'}。`);
        return;
      }

      if (triggerButton.hasAttribute('data-processing')) {
        console.log("[自動播放] 處理已在進行中，請稍候。");
        return;
      }
      triggerButton.disabled = true;
      triggerButton.textContent = '準備中...';
      triggerButton.setAttribute('data-processing', 'true');
      isProcessing = true;
      isPaused = false; // 開始時確保不是暫停狀態
    }

    // ... (查找表格和連結的邏輯不變) ...
    const resultTable = document.querySelector('table.table.d-none.d-md-table');
    if (!resultTable) {
      console.error("[自動播放] 找不到結果表格 (table.table.d-none.d-md-table)");
      alert("找不到結果表格！");
      resetTriggerButton();
      return;
    }
    const links = resultTable.querySelectorAll('tbody tr td a[href^="/und-hani/su/"]');
    if (links.length === 0) {
      console.warn("[自動播放] 表格中未找到符合條件的連結 (tbody tr td a[href^='/und-hani/su/'])");
      alert("表格中沒有找到詞目連結！");
      resetTriggerButton();
      return;
    }

    console.log(`[自動播放] 找到 ${links.length} 個連結準備處理。`);
    if (triggerButton) triggerButton.textContent = `播放中 (0/${links.length})...`; // 更簡潔的文字

    // 循序處理每個連結
    for (let i = 0; i < links.length; i++) {
      if (isPaused) {
        console.log("[自動播放] 處理循環已暫停。");
        break; // 如果已暫停，跳出迴圈
      }
      if (triggerButton) {
        triggerButton.textContent = `播放中 (${i + 1}/${links.length})...`; // 更簡潔的文字
      }

      const linkElement = links[i];
      if (linkElement.href) {
        const absoluteUrl = new URL(linkElement.getAttribute('href'), window.location.origin).href;
        try {
          // 在 processLink 內部處理了 resolve，所以這裡不需要額外的 try-catch 包裹 await
          await processLink(absoluteUrl, i, links.length);
          if (i < links.length - 1 && !isPaused) {
            console.log(`[自動播放] 等待 ${DELAY_BETWEEN_IFRAMES_MS}ms 後處理下一個連結`);
            await sleep(DELAY_BETWEEN_IFRAMES_MS);
          }
        } catch (error) {
          // 理論上 processLink 內部會處理錯誤並 resolve，但保留以防萬一
          console.error(`[自動播放] 處理連結 ${absoluteUrl} 的外層循環捕獲到未預期錯誤:`, error);
        }
      } else {
        console.warn(`[自動播放] 第 ${i + 1} 個連結元素沒有有效的 href 屬性。`);
      }
    }

    console.log("[自動播放] 所有連結處理完畢或已暫停。");
    if (!isPaused) {
      alert("所有連結處理完畢！");
    }
    resetTriggerButton();
  }

  function resetTriggerButton() {
    const triggerButton = document.getElementById('auto-play-trigger-button');
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = '開始自動播放表格音檔';
      triggerButton.removeAttribute('data-processing');
      isProcessing = false;
      isPaused = false;
    }
  }

  // --- 添加觸發按鈕 ---
  function addTriggerButton() {
    if (document.getElementById('auto-play-trigger-button')) return;
    const button = document.createElement('button');
    button.id = 'auto-play-trigger-button';
    button.textContent = '開始自動播放表格音檔';
    // ... (按鈕樣式保持不變) ...
    button.style.position = 'fixed';
    button.style.top = '10px';
    button.style.left = '10px';
    button.style.zIndex = '10001';
    button.style.padding = '8px 15px';
    button.style.backgroundColor = '#0d6efd';
    button.style.color = 'white';
    button.style.border = '2px solid #007bff'; // 增加一個藍色邊框使其更醒目
    button.style.borderRadius = '5px';
    button.style.cursor = 'pointer';
    button.style.fontSize = '16px'; // 稍微增加字體大小
    button.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)'; // 加強陰影

    button.addEventListener('click', startProcessing);
    document.body.appendChild(button);

    // 添加按鈕禁用樣式
    GM_addStyle(`
            #auto-play-trigger-button:disabled {
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
    console.log("[自動播放] 初始化腳本 v1.7 ...");
    addTriggerButton();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialize, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initialize);
  }

})();
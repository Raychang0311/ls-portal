/**
 * L>S Portal — 共用相簿檢視抽屜、批次勾選打包 ZIP 下載與全螢幕滑動燈箱
 * （Phase 1「相簿備份」分頁與 Phase 2「揪團大事記」100% 共用）
 */
window.PortalAlbumViewer = (function() {
    const { callGasApi, escapeHtml, escapeHtmlAttr, openExternalUrl } = window.PortalApi;

    const MAX_BATCH_SELECT = 20;
    const albumCache = new Map();

    let currentFolderId = '';
    let currentMeta = null;
    let currentAlbum = null;
    let loadingToken = 0;

    let selectMode = false;
    let selectedIds = new Set();
    let batchBusy = false;

    let lbIndex = -1;
    let lbTouchStartX = 0;
    let lbTouchStartY = 0;
    let lbEventsBound = false;

    function bindGlobalEvents() {
        if (lbEventsBound) return;
        lbEventsBound = true;

        document.addEventListener('keydown', e => {
            const lb = document.getElementById('albumLightbox');
            if (!lb || !lb.classList.contains('active')) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                stepLightbox(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                stepLightbox(1);
            }
        });

        const stage = document.getElementById('albumLbStage');
        if (stage) {
            stage.addEventListener('touchstart', e => {
                if (!e.touches || e.touches.length !== 1) return;
                lbTouchStartX = e.touches[0].clientX;
                lbTouchStartY = e.touches[0].clientY;
            }, { passive: true });

            stage.addEventListener('touchend', e => {
                if (!e.changedTouches || e.changedTouches.length !== 1) return;
                const dx = e.changedTouches[0].clientX - lbTouchStartX;
                const dy = e.changedTouches[0].clientY - lbTouchStartY;
                if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                    stepLightbox(dx < 0 ? 1 : -1);
                }
            }, { passive: true });
        }
    }

    function open(folderId, meta) {
        const cleanId = String(folderId || '').trim();
        if (!cleanId) return;
        bindGlobalEvents();

        currentFolderId = cleanId;
        currentMeta = Object.assign({ name: '活動相簿', category: '', displayDate: '', folderUrl: 'https://drive.google.com/drive/folders/' + cleanId + '?usp=drive_link' }, meta || {});
        selectMode = false;
        selectedIds.clear();
        batchBusy = false;

        const overlay = document.getElementById('albumViewerOverlay');
        const body = document.getElementById('albumViewerBody');
        if (!overlay) return;

        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        if (body) body.scrollTop = 0;

        renderHeader();
        updateBatchBar();

        const panel = document.getElementById('albumViewerPanel');
        if (panel && window.PortalApi.syncDetailDrawerOffset) {
            window.PortalApi.syncDetailDrawerOffset(panel);
        }

        if (albumCache.has(cleanId)) {
            currentAlbum = albumCache.get(cleanId);
            renderHeader();
            renderMediaGrid();
            return;
        }

        currentAlbum = null;
        fetchAlbum(cleanId, false);
    }

    function close() {
        if (batchBusy) return;
        const overlay = document.getElementById('albumViewerOverlay');
        if (overlay) overlay.classList.remove('is-open');
        const body = document.getElementById('albumViewerBody');
        if (body) body.scrollTop = 0;
        selectMode = false;
        selectedIds.clear();
        updateBatchBar();
        if (!document.querySelector('.drawer-overlay.is-open')) {
            document.body.style.overflow = '';
        }
    }

    function handleOverlayClick(event) {
        if (event && event.target === document.getElementById('albumViewerOverlay')) {
            close();
        }
    }

    function refresh() {
        if (!currentFolderId || batchBusy) return;
        selectMode = false;
        selectedIds.clear();
        updateBatchBar();
        fetchAlbum(currentFolderId, true);
    }

    function fetchAlbum(folderId, forceRefresh) {
        const token = ++loadingToken;
        const loadingEl = document.getElementById('albumViewerLoading');
        const gridEl = document.getElementById('albumMediaGrid');
        const refreshBtn = document.getElementById('albumRefreshBtn');

        if (loadingEl) loadingEl.style.display = 'flex';
        if (gridEl) gridEl.innerHTML = '';
        if (refreshBtn) refreshBtn.classList.add('is-spinning');

        callGasApi('groupHistory', 'getHistoryAlbum', {
            folderId: folderId,
            forceRefresh: forceRefresh ? '1' : ''
        }, res => {
            if (token !== loadingToken) return;
            if (loadingEl) loadingEl.style.display = 'none';
            if (refreshBtn) refreshBtn.classList.remove('is-spinning');

            if (!res || res.success === false || !Array.isArray(res.items)) {
                if (gridEl) {
                    gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">⚠️</div><div class="empty-title">無法載入相簿內容</div><div class="empty-desc">${escapeHtml((res && res.error) || '請確認資料夾共用權限設定')}</div></div>`;
                }
                return;
            }

            currentAlbum = res;
            albumCache.set(folderId, res);
            renderHeader();
            renderMediaGrid();
        }, err => {
            if (token !== loadingToken) return;
            if (loadingEl) loadingEl.style.display = 'none';
            if (refreshBtn) refreshBtn.classList.remove('is-spinning');
            if (gridEl) {
                gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">⚠️</div><div class="empty-title">連線失敗</div><div class="empty-desc">${escapeHtml(err)}</div></div>`;
            }
        }, { preferGet: true });
    }

    function renderHeader() {
        const titleEl = document.getElementById('albumViewerTitle');
        const catEl = document.getElementById('albumViewerCatPill');
        const countEl = document.getElementById('albumViewerCountPill');
        const subEl = document.getElementById('albumViewerSub');
        const driveBtn = document.getElementById('albumOpenDriveBtn');

        const name = (currentAlbum && currentAlbum.folderName) || (currentMeta && currentMeta.name) || '活動相簿';
        const cat = (currentMeta && currentMeta.category) || '相簿備份';
        const dateStr = (currentMeta && currentMeta.displayDate) || '';
        const total = currentAlbum ? currentAlbum.items.length : (currentMeta && currentMeta.mediaCount ? currentMeta.mediaCount : null);
        const folderUrl = (currentAlbum && currentAlbum.folderUrl) || (currentMeta && currentMeta.folderUrl) || '';

        if (titleEl) titleEl.textContent = name;
        if (catEl) catEl.textContent = `📁 ${cat}`;
        if (countEl) countEl.textContent = total !== null ? `${total} 個檔案` : '載入中';
        if (subEl) subEl.textContent = dateStr ? `更新日期：${dateStr}` : '點選相片可全螢幕滑動檢視或下載';
        if (driveBtn && folderUrl) {
            driveBtn.href = folderUrl;
            driveBtn.onclick = e => openExternalUrl(e, folderUrl);
        }

        const panel = document.getElementById('albumViewerPanel');
        if (panel && window.PortalApi.syncDetailDrawerOffset) {
            window.PortalApi.syncDetailDrawerOffset(panel);
        }
    }

    function renderMediaGrid() {
        const gridEl = document.getElementById('albumMediaGrid');
        if (!gridEl) return;

        const items = (currentAlbum && Array.isArray(currentAlbum.items)) ? currentAlbum.items : [];
        gridEl.classList.toggle('is-select-mode', selectMode);

        if (items.length === 0) {
            gridEl.innerHTML = '<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">🖼️</div><div class="empty-title">此資料夾目前沒有圖片或影片</div><div class="empty-desc">僅顯示此資料夾第一層的圖片與影片檔案。</div></div>';
            return;
        }

        gridEl.innerHTML = items.map((item, idx) => {
            const isSel = selectedIds.has(item.id);
            const videoBadge = item.isVideo ? '<span class="album-video-badge">▶ 影片</span>' : '';
            const checkHtml = selectMode
                ? (item.isVideo
                    ? '<span class="album-select-disabled" title="影片請單獨開啟下載">影片</span>'
                    : `<span class="album-select-check ${isSel ? 'is-checked' : ''}" aria-hidden="true">${isSel ? '✓' : ''}</span>`)
                : '';
            return `
                <button type="button"
                        class="album-media-tile ${isSel ? 'is-selected' : ''} ${item.isVideo ? 'is-video' : ''}"
                        data-media-idx="${idx}"
                        onclick="PortalAlbumViewer.handleTileClick(${idx})"
                        aria-label="${escapeHtmlAttr(item.name || ('第 ' + (idx + 1) + ' 張'))}">
                    <img src="${escapeHtmlAttr(item.thumbUrl)}"
                         alt="${escapeHtmlAttr(item.name || '')}"
                         loading="lazy"
                         referrerpolicy="no-referrer">
                    ${videoBadge}
                    ${checkHtml}
                </button>`;
        }).join('');
    }

    function handleTileClick(idx) {
        const items = (currentAlbum && currentAlbum.items) || [];
        const item = items[idx];
        if (!item) return;

        if (!selectMode) {
            openLightbox(idx);
            return;
        }

        if (item.isVideo) {
            if (window.Swal) {
                Swal.fire({ icon: 'info', title: '影片不支援批次打包', text: '請關閉批次模式後點擊該影片單獨開啟或前往 Drive 原資料夾下載。', confirmButtonColor: '#3a6e59' });
            }
            return;
        }

        if (selectedIds.has(item.id)) {
            selectedIds.delete(item.id);
        } else {
            if (selectedIds.size >= MAX_BATCH_SELECT) {
                if (window.Swal) {
                    Swal.fire({ icon: 'warning', title: `單次最多選擇 ${MAX_BATCH_SELECT} 張`, text: '為避免打包逾時，請分批下載或直接點擊「📂 Drive 原資料夾」下載整本。', confirmButtonColor: '#3a6e59' });
                }
                return;
            }
            selectedIds.add(item.id);
        }
        renderMediaGrid();
        updateBatchBar();
    }

    function toggleSelectMode() {
        if (batchBusy) return;
        const items = (currentAlbum && currentAlbum.items) || [];
        if (!selectMode && items.filter(i => !i.isVideo).length === 0) {
            if (window.Swal) {
                Swal.fire({ icon: 'info', title: '沒有可批次打包的圖片', text: '此相簿目前沒有圖片檔案可供勾選。', confirmButtonColor: '#3a6e59' });
            }
            return;
        }
        selectMode = !selectMode;
        if (!selectMode) selectedIds.clear();
        renderMediaGrid();
        updateBatchBar();
    }

    function selectTopImages() {
        if (batchBusy || !currentAlbum) return;
        selectedIds.clear();
        const imgs = (currentAlbum.items || []).filter(i => !i.isVideo).slice(0, MAX_BATCH_SELECT);
        imgs.forEach(i => selectedIds.add(i.id));
        renderMediaGrid();
        updateBatchBar();
    }

    function clearSelection() {
        if (batchBusy) return;
        selectedIds.clear();
        renderMediaGrid();
        updateBatchBar();
    }

    function updateBatchBar() {
        const toggleBtn = document.getElementById('albumBatchToggleBtn');
        const bar = document.getElementById('albumBatchBar');
        const countEl = document.getElementById('albumBatchCount');
        const dlBtn = document.getElementById('albumBatchDownloadBtn');
        const progressEl = document.getElementById('albumBatchProgress');

        if (toggleBtn) {
            toggleBtn.classList.toggle('is-active', selectMode);
            toggleBtn.textContent = selectMode ? '✕ 取消多選' : '☑️ 批次下載';
            toggleBtn.disabled = batchBusy;
        }
        if (bar) {
            bar.style.display = selectMode ? 'flex' : 'none';
        }
        if (countEl) {
            countEl.textContent = `已選 ${selectedIds.size} / ${MAX_BATCH_SELECT} 張`;
        }
        if (dlBtn) {
            dlBtn.disabled = batchBusy || selectedIds.size === 0;
            dlBtn.textContent = batchBusy ? '打包中...' : `📦 打包下載 (${selectedIds.size} 張)`;
        }
        if (progressEl && !batchBusy) {
            progressEl.style.display = 'none';
            progressEl.textContent = '';
        }
    }

    function fetchSingleBlobAsync(fileId) {
        return new Promise((resolve, reject) => {
            callGasApi('groupHistory', 'getAlbumFileBlob', { fileId: fileId }, res => {
                if (res && res.success && res.base64) {
                    resolve(res);
                } else {
                    reject(new Error((res && res.error) || '讀取圖片失敗'));
                }
            }, err => reject(new Error(String(err || '連線失敗'))), { preferGet: true });
        });
    }

    async function downloadSelectedBatch() {
        if (batchBusy || selectedIds.size === 0 || !currentAlbum) return;
        if (typeof window.JSZip === 'undefined') {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: '打包元件尚未載入', text: '請重新整理頁面後再試，或點擊「📂 Drive 原資料夾」直接下載。', confirmButtonColor: '#3a6e59' });
            }
            return;
        }

        const targets = (currentAlbum.items || []).filter(i => !i.isVideo && selectedIds.has(i.id));
        if (!targets.length) return;

        batchBusy = true;
        updateBatchBar();

        const progressEl = document.getElementById('albumBatchProgress');
        const setProgress = msg => {
            if (progressEl) {
                progressEl.style.display = 'block';
                progressEl.textContent = msg;
            }
        };

        try {
            const zip = new window.JSZip();
            const usedNames = new Set();
            let done = 0;
            let failed = 0;
            const queue = targets.slice();

            const worker = async () => {
                while (queue.length > 0) {
                    const item = queue.shift();
                    setProgress(`正在抓取原圖 ${done + 1} / ${targets.length}...`);
                    try {
                        const res = await fetchSingleBlobAsync(item.id);
                        let fname = String(res.name || item.name || (item.id + '.jpg')).replace(/[\\/:*?"<>|]/g, '_');
                        if (usedNames.has(fname)) {
                            const dot = fname.lastIndexOf('.');
                            const base = dot > 0 ? fname.slice(0, dot) : fname;
                            const ext = dot > 0 ? fname.slice(dot) : '.jpg';
                            fname = `${base}_${item.id.slice(0, 5)}${ext}`;
                        }
                        usedNames.add(fname);
                        zip.file(fname, res.base64, { base64: true });
                    } catch (e) {
                        failed++;
                    } finally {
                        done++;
                        setProgress(`正在抓取原圖 ${done} / ${targets.length}${failed > 0 ? `（${failed} 張略過）` : ''}...`);
                    }
                }
            };

            const concurrency = Math.min(2, targets.length);
            await Promise.all(Array.from({ length: concurrency }, () => worker()));

            const packedCount = usedNames.size;
            if (packedCount === 0) {
                throw new Error('所有勾選圖片皆無法讀取，請改用單張下載或前往 Drive 原資料夾。');
            }

            setProgress(`正在壓縮打包 ${packedCount} 張相片...`);
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const safeAlbumName = String((currentAlbum.folderName || 'album')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
            const zipFilename = `${safeAlbumName}_${packedCount}張.zip`;

            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFilename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            if (window.Swal) {
                const isLine = /Line\//i.test(navigator.userAgent || '');
                Swal.fire({
                    icon: 'success',
                    title: `已完成打包 (${packedCount} 張)`,
                    text: isLine
                        ? '已觸發 ZIP 下載；若 LINE 內建瀏覽器未自動存檔，建議點右上角以「預設瀏覽器開啟」或直接點擊「📂 Drive 原資料夾」。'
                        : (failed > 0 ? `成功打包 ${packedCount} 張，另有 ${failed} 張因超過 12MB 或讀取失敗已略過。` : `已下載 ${zipFilename}`),
                    confirmButtonColor: '#3a6e59'
                });
            }
        } catch (err) {
            if (window.Swal) {
                Swal.fire({ icon: 'error', title: '批次打包失敗', text: err.message || String(err), confirmButtonColor: '#3a6e59' });
            }
        } finally {
            batchBusy = false;
            updateBatchBar();
        }
    }

    // =========================================================================
    // 全螢幕相片滑動燈箱
    // =========================================================================
    function openLightbox(idx) {
        const items = (currentAlbum && currentAlbum.items) || [];
        if (!items.length || idx < 0 || idx >= items.length) return;
        lbIndex = idx;
        renderLightbox();
        const lb = document.getElementById('albumLightbox');
        if (lb) lb.classList.add('active');
    }

    function closeLightbox() {
        const lb = document.getElementById('albumLightbox');
        if (lb) lb.classList.remove('active');
        lbIndex = -1;
    }

    function stepLightbox(delta) {
        const items = (currentAlbum && currentAlbum.items) || [];
        if (!items.length) return;
        lbIndex = (lbIndex + delta + items.length) % items.length;
        renderLightbox();
    }

    function renderLightbox() {
        const items = (currentAlbum && currentAlbum.items) || [];
        const item = items[lbIndex];
        if (!item) return;

        const counterEl = document.getElementById('albumLbCounter');
        const nameEl = document.getElementById('albumLbName');
        const imgEl = document.getElementById('albumLbImg');
        const videoNoticeEl = document.getElementById('albumLbVideoNotice');
        const dlBtn = document.getElementById('albumLbDownloadBtn');
        const driveBtn = document.getElementById('albumLbDriveBtn');
        const prevBtn = document.getElementById('albumLbPrevBtn');
        const nextBtn = document.getElementById('albumLbNextBtn');

        if (counterEl) counterEl.textContent = `${lbIndex + 1} / ${items.length}`;
        if (nameEl) nameEl.textContent = item.name || '';
        if (imgEl) {
            imgEl.src = item.fullUrl;
            imgEl.alt = item.name || '';
        }
        if (videoNoticeEl) {
            videoNoticeEl.style.display = item.isVideo ? 'inline-flex' : 'none';
            videoNoticeEl.href = item.viewUrl;
            videoNoticeEl.onclick = e => openExternalUrl(e, item.viewUrl);
        }
        if (dlBtn) {
            dlBtn.href = item.downloadUrl;
            dlBtn.onclick = e => openExternalUrl(e, item.downloadUrl);
        }
        if (driveBtn) {
            driveBtn.href = item.viewUrl;
            driveBtn.onclick = e => openExternalUrl(e, item.viewUrl);
        }
        const multi = items.length > 1;
        if (prevBtn) prevBtn.style.display = multi ? 'inline-flex' : 'none';
        if (nextBtn) nextBtn.style.display = multi ? 'inline-flex' : 'none';
    }

    return {
        open,
        close,
        handleOverlayClick,
        refresh,
        handleTileClick,
        toggleSelectMode,
        selectTopImages,
        clearSelection,
        downloadSelectedBatch,
        openLightbox,
        closeLightbox,
        stepLightbox
    };
})();

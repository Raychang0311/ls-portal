/**
 * L>S Portal — 相簿備份分頁（三縮圖立體堆疊卡片格線、最新／最舊排序、本地快取秒開）
 */
window.PortalAlbums = (function() {
    const { Store, callGasApi, escapeHtml, escapeHtmlAttr } = window.PortalApi;
    const LOCAL_CACHE_KEY = 'ls_portal_albums_idx_v2';
    const LOCAL_CACHE_STALE_MS = 10 * 60 * 1000;

    let bound = false;
    let loading = false;
    let loaded = false;
    let albums = [];
    let rootFolderUrl = 'https://drive.google.com/drive/folders/1oFKQ9eJ4vwbSOUkQcVVw1890juvt5eDD?usp=drive_link';

    const state = {
        keyword: '',
        sortOrder: 'newest' // 'newest' | 'oldest'
    };

    function readLocalCache() {
        try {
            const raw = localStorage.getItem(LOCAL_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.albums)) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function writeLocalCache(list, rootUrl) {
        try {
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                rootFolderUrl: rootUrl || rootFolderUrl,
                albums: list
            }));
        } catch (e) {}
    }

    function ensureLoaded() {
        bindEvents();
        if (loaded) {
            renderGrid();
            return;
        }
        const cached = readLocalCache();
        if (cached && cached.albums.length > 0) {
            loaded = true;
            albums = cached.albums;
            if (cached.rootFolderUrl) rootFolderUrl = cached.rootFolderUrl;
            syncRootLink();
            renderGrid();
            if (Date.now() - (cached.savedAt || 0) > LOCAL_CACHE_STALE_MS) {
                loadGallery(false, true);
            }
            return;
        }
        loadGallery(false, false);
    }

    function syncRootLink() {
        const rootBtn = document.getElementById('albumsOpenRootBtn');
        if (rootBtn) {
            rootBtn.href = rootFolderUrl;
            rootBtn.onclick = e => window.PortalApi.openExternalUrl(e, rootFolderUrl);
        }
    }

    function bindEvents() {
        if (bound) return;
        bound = true;

        const searchIn = document.getElementById('albumsSearchInput');
        const clearBtn = document.getElementById('albumsClearSearchBtn');

        if (searchIn) {
            searchIn.addEventListener('input', () => {
                state.keyword = searchIn.value.trim();
                if (clearBtn) clearBtn.classList.toggle('visible', searchIn.value.length > 0);
                renderGrid();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchIn) {
                    searchIn.value = '';
                    searchIn.focus();
                }
                state.keyword = '';
                clearBtn.classList.remove('visible');
                renderGrid();
            });
        }
    }

    function setSortOrder(order) {
        const next = order === 'oldest' ? 'oldest' : 'newest';
        if (state.sortOrder === next) return;
        state.sortOrder = next;
        document.querySelectorAll('#albumsSortChips [data-album-sort]').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.albumSort === next);
        });
        renderGrid();
    }

    function loadGallery(forceRefresh, silent) {
        if (loading) return;
        loading = true;

        const loadingEl = document.getElementById('albumsLoading');
        const gridEl = document.getElementById('albumsGrid');
        const refreshBtn = document.getElementById('albumsRefreshBtn');

        if (!silent) {
            if (loadingEl) loadingEl.style.display = 'flex';
            if (gridEl && !albums.length) gridEl.innerHTML = '';
        }
        if (refreshBtn) refreshBtn.classList.add('is-spinning');

        callGasApi('groupHistory', 'getAlbumGalleryIndex', {
            forceRefresh: forceRefresh ? '1' : ''
        }, res => {
            loading = false;
            if (loadingEl) loadingEl.style.display = 'none';
            if (refreshBtn) refreshBtn.classList.remove('is-spinning');

            if (!res || res.success === false || !Array.isArray(res.albums)) {
                if (!silent && gridEl && !albums.length) {
                    gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">⚠️</div><div class="empty-title">無法讀取相簿總覽</div><div class="empty-desc">${escapeHtml((res && res.error) || '請確認 groupHistory.js 已更新部署且總資料夾權限已開啟')}</div></div>`;
                }
                return;
            }

            loaded = true;
            albums = res.albums;
            if (res.rootFolderUrl) rootFolderUrl = res.rootFolderUrl;
            if (Store) {
                Store.albums = albums;
                Store.albumsLoaded = true;
            }
            writeLocalCache(albums, rootFolderUrl);
            syncRootLink();
            renderGrid();
        }, err => {
            loading = false;
            if (loadingEl) loadingEl.style.display = 'none';
            if (refreshBtn) refreshBtn.classList.remove('is-spinning');
            if (!silent && gridEl && !albums.length) {
                gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">⚠️</div><div class="empty-title">連線後端失敗</div><div class="empty-desc">${escapeHtml(err)}</div></div>`;
            }
        }, { preferGet: true });
    }

    function refresh() {
        loadGallery(true, false);
    }

    function buildStackLayerHtml(fileId, layerCls, altText) {
        if (!fileId) {
            return `<div class="album-stack-layer ${layerCls} is-placeholder" aria-hidden="true"></div>`;
        }
        const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w360`;
        return `
            <div class="album-stack-layer ${layerCls}">
                <img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(altText)}" loading="lazy" referrerpolicy="no-referrer">
            </div>`;
    }

    function renderGrid() {
        const gridEl = document.getElementById('albumsGrid');
        const countPill = document.getElementById('albumsCountPill');
        if (!gridEl) return;

        const kwL = state.keyword.toLowerCase();
        const filtered = albums.filter(a => {
            if (!kwL) return true;
            return String(a.name || '').toLowerCase().includes(kwL);
        });

        filtered.sort((a, b) => {
            const diff = (b.updatedTime || 0) - (a.updatedTime || 0);
            if (diff !== 0) return state.sortOrder === 'oldest' ? -diff : diff;
            const nameCmp = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
            return state.sortOrder === 'oldest' ? -nameCmp : nameCmp;
        });

        if (countPill) {
            countPill.textContent = kwL ? `符合 ${filtered.length} / ${albums.length} 本` : `共 ${albums.length} 本相簿`;
        }

        if (!filtered.length) {
            gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">📷</div><div class="empty-title">${albums.length ? '找不到符合條件的相簿' : '尚無相簿資料'}</div></div>`;
            return;
        }

        gridEl.innerHTML = filtered.map(a => {
            const ids = Array.isArray(a.previewIds) ? a.previewIds : [];
            const frontId = ids[0] || '';
            const midId = ids[1] || '';
            const backId = ids[2] || '';

            return `
                <button type="button"
                        class="album-stack-card"
                        data-album-id="${escapeHtmlAttr(a.id)}"
                        onclick="PortalAlbums.openAlbum('${escapeHtmlAttr(a.id)}')"
                        aria-label="開啟相簿 ${escapeHtmlAttr(a.name)}">
                    <div class="album-stack-stage">
                        ${buildStackLayerHtml(backId, 'is-back', '')}
                        ${buildStackLayerHtml(midId, 'is-mid', '')}
                        ${buildStackLayerHtml(frontId, 'is-front', a.name)}
                    </div>
                    <div class="album-stack-meta">
                        <div class="album-stack-title">${escapeHtml(a.name)}</div>
                        ${a.displayDate ? `<div class="album-stack-sub mono">${escapeHtml(a.displayDate)}</div>` : ''}
                    </div>
                </button>`;
        }).join('');
    }

    function openAlbum(folderId) {
        const found = albums.find(a => a.id === folderId);
        if (!window.PortalAlbumViewer) return;
        window.PortalAlbumViewer.open(folderId, found || { name: '活動相簿' });
    }

    return {
        ensureLoaded,
        refresh,
        setSortOrder,
        openAlbum
    };
})();

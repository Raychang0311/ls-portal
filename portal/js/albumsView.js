/**
 * L>S Portal — 相簿備份分頁（三縮圖立體堆疊卡片格線、正反向排序、分類篩選）
 */
window.PortalAlbums = (function() {
    const { Store, callGasApi, escapeHtml, escapeHtmlAttr } = window.PortalApi;

    let bound = false;
    let loading = false;
    let loaded = false;
    let albums = [];
    let categories = [];
    let rootFolderUrl = 'https://drive.google.com/drive/folders/1oFKQ9eJ4vwbSOUkQcVVw1890juvt5eDD?usp=drive_link';

    const state = {
        keyword: '',
        category: 'all',
        sortOrder: 'newest' // 'newest' | 'oldest'
    };

    function ensureLoaded() {
        bindEvents();
        if (loaded) {
            renderGrid();
            return;
        }
        loadGallery(false);
    }

    function bindEvents() {
        if (bound) return;
        bound = true;

        const searchIn = document.getElementById('albumsSearchInput');
        const clearBtn = document.getElementById('albumsClearSearchBtn');
        const sortBtn = document.getElementById('albumsSortToggleBtn');

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
        if (sortBtn) {
            sortBtn.addEventListener('click', () => {
                state.sortOrder = state.sortOrder === 'newest' ? 'oldest' : 'newest';
                sortBtn.textContent = state.sortOrder === 'newest' ? '最新 ▾' : '最舊 ▴';
                renderGrid();
            });
        }
    }

    function loadGallery(forceRefresh) {
        if (loading) return;
        loading = true;

        const loadingEl = document.getElementById('albumsLoading');
        const gridEl = document.getElementById('albumsGrid');
        const refreshBtn = document.getElementById('albumsRefreshBtn');

        if (loadingEl) loadingEl.style.display = 'flex';
        if (gridEl) gridEl.innerHTML = '';
        if (refreshBtn) refreshBtn.classList.add('is-spinning');

        callGasApi('groupHistory', 'getAlbumGalleryIndex', {
            forceRefresh: forceRefresh ? '1' : ''
        }, res => {
            loading = false;
            if (loadingEl) loadingEl.style.display = 'none';
            if (refreshBtn) refreshBtn.classList.remove('is-spinning');

            if (!res || res.success === false || !Array.isArray(res.albums)) {
                if (gridEl) {
                    gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">⚠️</div><div class="empty-title">無法讀取相簿總覽</div><div class="empty-desc">${escapeHtml((res && res.error) || '請確認 groupHistory.js 已更新部署且總資料夾權限已開啟')}</div></div>`;
                }
                return;
            }

            loaded = true;
            albums = res.albums;
            categories = Array.isArray(res.categories) ? res.categories : [];
            if (res.rootFolderUrl) rootFolderUrl = res.rootFolderUrl;
            if (Store) {
                Store.albums = albums;
                Store.albumsLoaded = true;
            }

            const rootBtn = document.getElementById('albumsOpenRootBtn');
            if (rootBtn) {
                rootBtn.href = rootFolderUrl;
                rootBtn.onclick = e => window.PortalApi.openExternalUrl(e, rootFolderUrl);
            }

            renderCategoryChips();
            renderGrid();
        }, err => {
            loading = false;
            if (loadingEl) loadingEl.style.display = 'none';
            if (refreshBtn) refreshBtn.classList.remove('is-spinning');
            if (gridEl) {
                gridEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">⚠️</div><div class="empty-title">連線後端失敗</div><div class="empty-desc">${escapeHtml(err)}</div></div>`;
            }
        }, { preferGet: true });
    }

    function refresh() {
        loadGallery(true);
    }

    function setCategory(cat) {
        state.category = cat || 'all';
        renderCategoryChips();
        renderGrid();
    }

    function renderCategoryChips() {
        const bar = document.getElementById('albumsCategoryChips');
        if (!bar) return;

        const allCats = ['all'].concat(categories);
        bar.innerHTML = allCats.map(cat => {
            const label = cat === 'all' ? '全部分類' : cat;
            const active = state.category === cat ? 'is-active' : '';
            return `<button type="button" class="chip-btn ${active}" data-album-cat="${escapeHtmlAttr(cat)}" onclick="PortalAlbums.setCategory(this.dataset.albumCat)">${escapeHtml(label)}</button>`;
        }).join('');
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
            if (state.category !== 'all' && a.category !== state.category) return false;
            if (kwL) {
                const hitName = String(a.name || '').toLowerCase().includes(kwL);
                const hitCat = String(a.category || '').toLowerCase().includes(kwL);
                if (!hitName && !hitCat) return false;
            }
            return true;
        });

        filtered.sort((a, b) => {
            const diff = (b.updatedTime || 0) - (a.updatedTime || 0);
            if (diff !== 0) return state.sortOrder === 'oldest' ? -diff : diff;
            const nameCmp = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
            return state.sortOrder === 'oldest' ? -nameCmp : nameCmp;
        });

        const isFiltered = Boolean(kwL || state.category !== 'all');
        if (countPill) {
            countPill.textContent = isFiltered ? `符合 ${filtered.length} / ${albums.length} 本` : `共 ${albums.length} 本相簿`;
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
            const metaText = [a.displayDate, `${a.mediaCount || 0} 張`].filter(Boolean).join(' · ');

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
                        <span class="album-cat-pill">${escapeHtml(a.category || '未分類')}</span>
                        <div class="album-stack-title">${escapeHtml(a.name)}</div>
                        <div class="album-stack-sub mono">${escapeHtml(metaText)}</div>
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
        setCategory,
        openAlbum
    };
})();

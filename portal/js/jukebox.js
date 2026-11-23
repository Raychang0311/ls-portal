/**
 * L>S Portal — 橫向 3D 旋轉點唱機引擎 (Jukebox Carousel)
 * 支援手指滑動慣性、滑鼠拖曳、點擊側邊卡片、選曲軌道點選、鍵盤左右鍵與篩選器
 */
window.PortalJukebox = (function() {
    const { Store, callGasApi, escapeHtml, updateNavSummary } = window.PortalApi;

    let currentFilter = 'all';
    let searchQuery = '';
    let filteredGroups = [];
    let activeIndex = 0;
    let virtualIndex = 0;
    let targetIndex = 0;
    let rafId = null;
    let velocity = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartVirtual = 0;
    let lastMoveX = 0;
    let lastMoveTime = 0;
    let suppressClickUntil = 0;
    let eventsBound = false;

    function init() {
        bindEvents();
        loadGroups(false);
    }

    function bindEvents() {
        if (eventsBound) return;
        eventsBound = true;

        const stage = document.getElementById('jukeboxStage');
        if (!stage) return;

        stage.addEventListener('pointerdown', e => {
            if (e.target.closest('button, a')) return;
            if (filteredGroups.length <= 1) return;
            isDragging = true;
            dragStartX = e.clientX;
            lastMoveX = e.clientX;
            lastMoveTime = performance.now();
            dragStartVirtual = virtualIndex;
            velocity = 0;
            stage.setPointerCapture(e.pointerId);
        });

        stage.addEventListener('pointermove', e => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const stepPx = window.innerWidth < 640 ? 220 : 280;
            const nextV = dragStartVirtual - (dx / stepPx);
            virtualIndex = clampVirtual(nextV);
            targetIndex = virtualIndex;

            const now = performance.now();
            const dt = Math.max(8, now - lastMoveTime);
            velocity = (lastMoveX - e.clientX) / dt; // px/ms
            lastMoveX = e.clientX;
            lastMoveTime = now;

            if (Math.abs(dx) > 6) suppressClickUntil = now + 220;
            apply3DTransforms();
        });

        const endDrag = e => {
            if (!isDragging) return;
            isDragging = false;
            try { stage.releasePointerCapture(e.pointerId); } catch (err) {}

            // 依放手瞬間水平速度計算慣性跳轉張數
            const flickCards = Math.abs(velocity) > 0.35 ? Math.sign(velocity) * Math.min(2, Math.round(Math.abs(velocity) * 1.4)) : 0;
            const snapped = clampIndex(Math.round(virtualIndex + flickCards));
            goTo(snapped);
        };

        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);

        // 支援滑鼠橫向滾輪 / Shift+滾輪切換卡片
        stage.addEventListener('wheel', e => {
            if (filteredGroups.length <= 1) return;
            const absX = Math.abs(e.deltaX);
            const absY = Math.abs(e.deltaY);
            if (absX > 12 || (e.shiftKey && absY > 12)) {
                e.preventDefault();
                const delta = (absX >= absY ? e.deltaX : e.deltaY) > 0 ? 1 : -1;
                if (performance.now() > suppressClickUntil) {
                    suppressClickUntil = performance.now() + 200;
                    step(delta);
                }
            }
        }, { passive: false });

        // 鍵盤左右鍵切換、Enter 展開詳情
        stage.addEventListener('keydown', e => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                step(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                step(1);
            } else if (e.key === 'Enter') {
                const current = filteredGroups[activeIndex];
                if (current) window.PortalGroupDetail.open(current.seqId);
            }
        });

        window.addEventListener('resize', () => {
            if (filteredGroups.length > 0) apply3DTransforms();
        }, { passive: true });

        const searchInput = document.getElementById('jukeboxSearchInput');
        const clearBtn = document.getElementById('clearJukeboxSearchBtn');
        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                searchQuery = searchInput.value.trim();
                if (clearBtn) clearBtn.classList.toggle('visible', searchInput.value.length > 0);
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    applyFilterAndRender(null, { animateToFirst: true });
                }, 140);
            });
        }
    }

    function clearSearch() {
        const searchInput = document.getElementById('jukeboxSearchInput');
        const clearBtn = document.getElementById('clearJukeboxSearchBtn');
        searchQuery = '';
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        if (clearBtn) clearBtn.classList.remove('visible');
        applyFilterAndRender(null, { animateToFirst: true });
    }

    function clampIndex(idx) {
        if (filteredGroups.length === 0) return 0;
        return Math.max(0, Math.min(filteredGroups.length - 1, idx));
    }

    function clampVirtual(val) {
        if (filteredGroups.length === 0) return 0;
        return Math.max(-0.35, Math.min(filteredGroups.length - 1 + 0.35, val));
    }

    function loadGroups(force, focusSeqId) {
        const loadingEl = document.getElementById('jukeboxLoading');
        const shellEl = document.getElementById('jukeboxShell');
        const emptyEl = document.getElementById('jukeboxEmpty');

        if (!Store.groupsLoaded || force) {
            if (loadingEl) loadingEl.style.display = 'block';
            if (shellEl && !Store.groupsLoaded) shellEl.style.display = 'none';
            if (emptyEl) emptyEl.style.display = 'none';
        }

        callGasApi('group', 'getAllGroups', {}, res => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (!res || res.success === false) {
                renderError((res && res.error) || '無法讀取揪團資料，請確認 group.js 已更新部署');
                return;
            }

            Store.groups = Array.isArray(res.groups) ? res.groups : [];
            Store.groupsLoaded = true;

            // 若成員名冊尚未從 members.js 載入完成，先用這份名冊預填，達成秒開體驗
            if (!Store.membersLoaded && Array.isArray(res.members) && res.members.length > 0) {
                Store.members = res.members;
            }
            if (res.titleConfig && !Store.titleConfig) {
                Store.titleConfig = res.titleConfig;
            }

            updateNavSummary();
            applyFilterAndRender(focusSeqId);

            // 處理深層連結 ?seqId=12345
            if (!force && window.PortalApp) {
                window.PortalApp.handleDeepLinkSeqId();
            }
        }, err => {
            if (loadingEl) loadingEl.style.display = 'none';
            renderError('連線後端失敗：' + err);
        });
    }

    function renderError(msg) {
        const shellEl = document.getElementById('jukeboxShell');
        const emptyEl = document.getElementById('jukeboxEmpty');
        if (shellEl) shellEl.style.display = 'none';
        if (!emptyEl) return;

        emptyEl.style.display = 'block';
        emptyEl.innerHTML = `
            <div class="empty-emoji">⚠️</div>
            <div class="empty-title">載入揪團大廳失敗</div>
            <div class="empty-desc">${escapeHtml(msg)}</div>
            <button type="button" class="btn btn--primary" onclick="PortalJukebox.refresh(true)">🔄 重新載入</button>
        `;
    }

    function setFilter(filterKey) {
        currentFilter = filterKey || 'all';
        document.querySelectorAll('#jukeboxFilterTabs [data-filter]').forEach(btn => {
            const active = btn.dataset.filter === currentFilter;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (window.PortalApp) window.PortalApp.syncTabIndicator('#jukeboxFilterTabs', '.filter-tab.is-active');
        applyFilterAndRender();
    }

    function computeFilteredGroups() {
        const uidLower = Store.currentUserId ? Store.currentUserId.toLowerCase() : '';
        const q = searchQuery ? searchQuery.trim().toLowerCase() : '';

        return Store.groups.filter(g => {
            const maxL = parseInt(g.maxLimit, 10) || 99;
            const cur = (g.joinedList && g.joinedList.length) || 0;
            const isFull = maxL !== 99 && cur >= maxL;
            const isHosting = uidLower && g.hostId && String(g.hostId).toLowerCase() === uidLower;
            const isJoined = uidLower && Array.isArray(g.joinedList) && g.joinedList.some(m => String(m.id).toLowerCase() === uidLower);

            if (currentFilter === 'joined' && !isJoined) return false;
            if (currentFilter === 'hosting' && !isHosting) return false;
            if (currentFilter === 'available' && isFull) return false;

            if (!q) return true;
            const titleMatch = g.title && String(g.title).toLowerCase().includes(q);
            const contentMatch = stripHtmlToText(g.content).toLowerCase().includes(q);
            const locNameMatch = g.locationName && String(g.locationName).toLowerCase().includes(q);
            const locAddrMatch = g.locationAddress && String(g.locationAddress).toLowerCase().includes(q);
            return Boolean(titleMatch || contentMatch || locNameMatch || locAddrMatch);
        });
    }

    function applyFilterAndRender(focusSeqId, options) {
        const prevCenterSeqId = filteredGroups[activeIndex] ? String(filteredGroups[activeIndex].seqId) : '';
        filteredGroups = computeFilteredGroups();
        const hasSearch = Boolean(searchQuery);
        const pill = document.getElementById('groupsCountPill');
        if (pill) {
            if (hasSearch) {
                pill.textContent = `搜尋符合 ${filteredGroups.length} / ${Store.groups.length} 團`;
            } else {
                pill.textContent = currentFilter === 'all'
                    ? `進行中 ${Store.groups.length} 團`
                    : `符合 ${filteredGroups.length} / ${Store.groups.length} 團`;
            }
        }

        const shellEl = document.getElementById('jukeboxShell');
        const emptyEl = document.getElementById('jukeboxEmpty');
        const trackEl = document.getElementById('jukeboxTrack');
        const dialEl = document.getElementById('jukeboxDialRail');

        if (!filteredGroups.length) {
            if (shellEl) shellEl.style.display = 'none';
            if (emptyEl) {
                emptyEl.style.display = 'block';
                const emptyTitle = Store.groups.length === 0
                    ? '目前沒有進行中的揪團'
                    : (hasSearch ? `找不到符合「${escapeHtml(searchQuery)}」的揪團` : '此篩選條件下沒有揪團');
                const emptyDesc = Store.groups.length === 0
                    ? '點選「＋ 發起揪團」成為第一個開團的主揪吧！'
                    : (hasSearch
                        ? '試著更換標題、內文或地點關鍵字，或清除搜尋顯示全部。'
                        : (currentFilter !== 'all' && !Store.currentUserId ? '登入 LINE 後即可篩選您參加或主揪的揪團。' : '試著切換其他篩選標籤或發起一個新揪團。'));
                emptyEl.innerHTML = `
                    <div class="empty-emoji">${Store.groups.length === 0 ? '🎪' : '🔍'}</div>
                    <div class="empty-title">${emptyTitle}</div>
                    <div class="empty-desc">${emptyDesc}</div>
                    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        ${hasSearch ? '<button type="button" class="btn btn--secondary" onclick="PortalJukebox.clearSearch()">清除搜尋</button>' : ''}
                        ${currentFilter !== 'all' ? '<button type="button" class="btn btn--secondary" onclick="PortalJukebox.setFilter(\'all\')">顯示全部揪團</button>' : ''}
                        <button type="button" class="btn btn--primary" onclick="PortalGroupForm.openCreate()">＋ 發起新揪團</button>
                    </div>
                `;
            }
            updateTrackReadout();
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (shellEl) shellEl.style.display = 'block';

        if (options && options.animateToFirst) {
            const prevPos = prevCenterSeqId
                ? filteredGroups.findIndex(g => String(g.seqId) === prevCenterSeqId)
                : -1;
            const startVirtual = prevPos > 0
                ? prevPos
                : (filteredGroups.length > 1 ? Math.min(filteredGroups.length - 1, 1.8) : 0.85);
            activeIndex = 0;
            virtualIndex = startVirtual;
            targetIndex = 0;
            renderCards(trackEl);
            renderDialRail(dialEl);
            apply3DTransforms();
            goTo(0);
            return;
        }

        let targetIdx = activeIndex;
        if (focusSeqId) {
            const found = filteredGroups.findIndex(g => String(g.seqId) === String(focusSeqId));
            if (found !== -1) targetIdx = found;
        }
        activeIndex = clampIndex(targetIdx);
        virtualIndex = activeIndex;
        targetIndex = activeIndex;

        renderCards(trackEl);
        renderDialRail(dialEl);
        apply3DTransforms();
        updateTrackReadout();
    }

    function getStatusBadge(g) {
        const uidLower = Store.currentUserId ? Store.currentUserId.toLowerCase() : '';
        const isHost = uidLower && g.hostId && String(g.hostId).toLowerCase() === uidLower;
        const isJoined = uidLower && Array.isArray(g.joinedList) && g.joinedList.some(m => String(m.id).toLowerCase() === uidLower);
        const waitlist = Array.isArray(g.waitlist) ? g.waitlist : [];
        const waitIdx = uidLower ? waitlist.findIndex(m => String(m.id).toLowerCase() === uidLower) : -1;
        const maxL = parseInt(g.maxLimit, 10) || 99;
        const cur = (g.joinedList && g.joinedList.length) || 0;
        const isFull = maxL !== 99 && cur >= maxL;

        if (isHost) return { text: '👑 我是主揪', cls: '' };
        if (isJoined) return { text: '✅ 已報名', cls: '' };
        if (waitIdx !== -1) return { text: `⏳ 候補 #${waitIdx + 1}`, cls: 'is-soon' };
        if (isFull) {
            return {
                text: waitlist.length > 0 ? `⛔ 已額滿 · 候補 ${waitlist.length}` : '⛔ 已額滿',
                cls: 'is-full'
            };
        }

        if (g.startDate) {
            const diffHours = (new Date(g.startDate).getTime() - Date.now()) / 36e5;
            if (!isNaN(diffHours)) {
                if (diffHours <= 0) return { text: '⚡ 進行中', cls: 'is-soon' };
                if (diffHours <= 24) return { text: '⚡ 即將開始', cls: 'is-soon' };
                const days = Math.ceil(diffHours / 24);
                return { text: `🗓️ ${days} 天後`, cls: '' };
            }
        }
        return { text: '開放報名', cls: '' };
    }

    function stripHtmlToText(htmlStr) {
        if (!htmlStr) return '';
        return String(htmlStr)
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatCompactDateRange(g) {
        return window.PortalApi.formatSmartDateRange(g.startDate, g.endDate, g.date);
    }

    function renderCards(trackEl) {
        if (!trackEl) return;
        const uidLower = Store.currentUserId ? Store.currentUserId.toLowerCase() : '';
        let html = '';

        filteredGroups.forEach((g, idx) => {
            const badge = getStatusBadge(g);
            const joined = Array.isArray(g.joinedList) ? g.joinedList : [];
            const waitlist = Array.isArray(g.waitlist) ? g.waitlist : [];
            const curCount = joined.length;
            const maxL = parseInt(g.maxLimit, 10) || 99;
            const isFull = maxL !== 99 && curCount >= maxL;
            const pct = maxL === 99 ? Math.min(100, curCount * 10) : Math.min(100, Math.round((curCount / maxL) * 100));
            const isJoined = uidLower && joined.some(m => String(m.id).toLowerCase() === uidLower);
            const waitIdx = uidLower ? waitlist.findIndex(m => String(m.id).toLowerCase() === uidLower) : -1;
            const excerpt = stripHtmlToText(g.content) || '點擊查看活動完整說明與地圖資訊';

            const stackItems = joined.slice(0, 4).map(m =>
                `<img src="${escapeHtml(m.pic || 'https://imgur.com/786FxAA.jpg')}" alt="${escapeHtml(m.name)}" loading="lazy" onerror="this.src='https://imgur.com/786FxAA.jpg'">`
            ).join('') + (curCount > 4 ? `<span class="jb-avatar-more mono">+${curCount - 4}</span>` : '');

            const trackNum = String(idx + 1).padStart(2, '0');
            const totalStr = String(filteredGroups.length).padStart(2, '0');
            const locDisplay = g.locationName || g.locationAddress || '未指定地點（詳情見內文）';

            let quickBtnHtml = '';
            if (isJoined) {
                quickBtnHtml = `<button type="button" class="btn btn--primary btn--compact" onclick="event.stopPropagation(); PortalGroupDetail.open('${escapeHtml(g.seqId)}')">已報名 · 詳情</button>`;
            } else if (waitIdx !== -1) {
                quickBtnHtml = `<button type="button" class="btn btn--secondary btn--compact" onclick="event.stopPropagation(); PortalGroupDetail.open('${escapeHtml(g.seqId)}')">已候補 #${waitIdx + 1} · 詳情</button>`;
            } else if (isFull) {
                quickBtnHtml = `<button type="button" class="btn btn--secondary btn--compact" onclick="event.stopPropagation(); PortalJukebox.quickJoin('${escapeHtml(g.seqId)}')">⏳ 登記候補${waitlist.length > 0 ? ' (' + waitlist.length + ')' : ''}</button>`;
            } else {
                quickBtnHtml = `<button type="button" class="btn btn--primary btn--compact" onclick="event.stopPropagation(); PortalJukebox.quickJoin('${escapeHtml(g.seqId)}')">🙋‍♂️ 立即報名</button>`;
            }

            html += `
                <article class="jukebox-card ${idx === activeIndex ? 'is-center' : ''}" data-jb-idx="${idx}" onclick="PortalJukebox.handleCardClick(${idx}, '${escapeHtml(g.seqId)}')">
                    <div>
                        <div class="jb-top">
                            <span class="jb-track-id">${trackNum} / ${totalStr} · #${escapeHtml(g.seqId)}</span>
                            <span class="jb-status-badge ${badge.cls}">${escapeHtml(badge.text)}</span>
                        </div>
                        <h2 class="jb-title">${escapeHtml(g.title || '揪團活動')}</h2>
                        <div class="jb-meta-panel">
                            <div class="jb-meta-line">
                                <svg class="jb-meta-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                <span class="mono">${escapeHtml(formatCompactDateRange(g))}</span>
                            </div>
                            <div class="jb-meta-line">
                                <svg class="jb-meta-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                <span>${escapeHtml(locDisplay)}</span>
                            </div>
                        </div>
                        <p class="jb-excerpt">${escapeHtml(excerpt)}</p>
                    </div>

                    <div class="jb-footer">
                        <div class="jb-social-row">
                            <div class="jb-avatars-wrap">
                                <div class="jb-avatar-stack">${stackItems}</div>
                                <span class="jb-host-label">主揪 <strong>${escapeHtml(g.hostName || '群友')}</strong></span>
                            </div>
                            <div class="jb-count-wrap">
                                <div class="jb-count-text mono">${curCount} / ${maxL === 99 ? '∞' : maxL} 人</div>
                                <div class="jb-progress-bar">
                                    <div class="jb-progress-fill ${isFull ? 'is-full' : ''}" style="width: ${pct}%;"></div>
                                </div>
                            </div>
                        </div>
                        <div class="jb-actions">
                            <button type="button" class="btn btn--secondary btn--compact" onclick="event.stopPropagation(); PortalGroupDetail.open('${escapeHtml(g.seqId)}')">查看詳情</button>
                            ${quickBtnHtml}
                        </div>
                    </div>
                </article>
            `;
        });

        trackEl.innerHTML = html;
    }

    function renderDialRail(dialEl) {
        if (!dialEl) return;
        let html = '';
        filteredGroups.forEach((g, idx) => {
            const num = String(idx + 1).padStart(2, '0');
            html += `
                <button type="button"
                        class="dial-pill ${idx === activeIndex ? 'is-active' : ''}"
                        data-dial-idx="${idx}"
                        role="tab"
                        aria-selected="${idx === activeIndex ? 'true' : 'false'}"
                        onclick="PortalJukebox.goTo(${idx})">
                    <span class="dial-pill-num">${num}</span>
                    <span class="dial-pill-title">${escapeHtml(g.title || '揪團')}</span>
                </button>
            `;
        });
        dialEl.innerHTML = html;
        scrollActiveDialIntoView();
    }

    function scrollActiveDialIntoView() {
        const activePill = document.querySelector(`#jukeboxDialRail [data-dial-idx="${activeIndex}"]`);
        if (activePill && activePill.scrollIntoView) {
            activePill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    function updateTrackReadout() {
        const readout = document.getElementById('jukeboxTrackReadout');
        if (!readout) return;
        if (!filteredGroups.length) {
            readout.textContent = 'TRACK 00 / 00';
        } else {
            const cur = String(activeIndex + 1).padStart(2, '0');
            const tot = String(filteredGroups.length).padStart(2, '0');
            readout.textContent = `TRACK ${cur} / ${tot}`;
        }

        const prevBtn = document.getElementById('jukeboxPrevBtn');
        const nextBtn = document.getElementById('jukeboxNextBtn');
        if (prevBtn) prevBtn.disabled = activeIndex <= 0;
        if (nextBtn) nextBtn.disabled = activeIndex >= filteredGroups.length - 1;
    }

    function apply3DTransforms() {
        const cards = document.querySelectorAll('#jukeboxTrack .jukebox-card');
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const isMobile = window.innerWidth < 640;
        const radiusX = isMobile ? 235 : 320;
        const depthZ = isMobile ? 160 : 210;

        cards.forEach((card, idx) => {
            const delta = idx - virtualIndex;
            const absD = Math.abs(delta);

            if (absD > 3.2) {
                card.style.opacity = '0';
                card.style.pointerEvents = 'none';
                card.style.zIndex = '0';
                return;
            }

            if (prefersReduced) {
                const tx = delta * (isMobile ? 320 : 440);
                card.style.transform = `translate3d(${tx}px, 0, 0)`;
                card.style.opacity = absD < 0.6 ? '1' : '0.35';
                card.style.zIndex = String(100 - Math.round(absD * 10));
                card.style.pointerEvents = 'auto';
                card.classList.toggle('is-center', idx === Math.round(virtualIndex));
                return;
            }

            // 橫向 3D 弧形旋轉運動學（Jukebox Arc）：維持實體不透明避免卡片文字互相透視
            const clamped = Math.max(-2.6, Math.min(2.6, delta));
            const angle = clamped * 0.56;
            const tx = Math.sin(angle) * radiusX + clamped * (isMobile ? 48 : 85);
            const tz = -(1 - Math.cos(angle)) * depthZ - absD * 42;
            const ty = absD * (isMobile ? 10 : 12);
            const ry = -clamped * 24;
            const rz = clamped * 3.2;
            const sc = Math.max(0.74, 1 - absD * 0.11);
            const op = absD <= 2.0 ? 1 : Math.max(0, 1 - (absD - 2.0) * 1.1);
            const bright = Math.max(0.92, 1 - absD * 0.035);

            card.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, ${tz.toFixed(1)}px) rotateY(${ry.toFixed(1)}deg) rotateZ(${rz.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
            card.style.opacity = op.toFixed(3);
            card.style.filter = absD < 0.2 ? '' : `brightness(${bright.toFixed(3)})`;
            card.style.zIndex = String(100 - Math.round(absD * 10));
            card.style.pointerEvents = op > 0.08 ? 'auto' : 'none';
            card.classList.toggle('is-center', Math.abs(delta) < 0.35);
        });
    }

    function animateToTarget() {
        if (rafId) cancelAnimationFrame(rafId);

        const tick = () => {
            if (isDragging) return;
            const diff = targetIndex - virtualIndex;
            if (Math.abs(diff) < 0.002) {
                virtualIndex = targetIndex;
                apply3DTransforms();
                rafId = null;
                return;
            }
            virtualIndex += diff * 0.16;
            apply3DTransforms();
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
    }

    function goTo(idx) {
        if (filteredGroups.length === 0) return;
        activeIndex = clampIndex(idx);
        targetIndex = activeIndex;

        document.querySelectorAll('#jukeboxDialRail .dial-pill').forEach((p, i) => {
            const active = i === activeIndex;
            p.classList.toggle('is-active', active);
            p.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        scrollActiveDialIntoView();
        updateTrackReadout();
        animateToTarget();
    }

    function step(delta) {
        goTo(activeIndex + delta);
    }

    function handleCardClick(idx, seqId) {
        if (performance.now() < suppressClickUntil) return;
        if (idx !== activeIndex) {
            goTo(idx);
            return;
        }
        window.PortalGroupDetail.open(seqId);
    }

    function quickJoin(seqId) {
        if (!Store.currentUserId) {
            Swal.fire({
                icon: 'info',
                title: '請先登入 LINE',
                text: '登入驗證身分後即可一鍵報名揪團活動！',
                showCancelButton: true,
                confirmButtonColor: '#3a6e59',
                confirmButtonText: '🔑 登入 LINE',
                cancelButtonText: '取消'
            }).then(r => {
                if (r.isConfirmed) window.PortalAuth.triggerLogin();
            });
            return;
        }

        const g = Store.groups.find(item => String(item.seqId) === String(seqId));
        if (!g) return;

        const maxL = parseInt(g.maxLimit, 10) || 99;
        const curCount = (g.joinedList && g.joinedList.length) || 0;
        const isFull = maxL !== 99 && curCount >= maxL;

        Swal.fire({
            title: isFull ? `登記候補「${escapeHtml(g.title)}」` : `報名「${escapeHtml(g.title)}」`,
            text: isFull ? '目前正取名額已滿，確定要依序加入候補名單嗎？有空缺時將自動遞補並標註通知。' : '',
            input: 'text',
            inputLabel: '活動備註（選填，例如：開車+1、晚到半小時）',
            inputPlaceholder: '輸入備註文字，或留空直接送出...',
            inputAttributes: { maxlength: 50 },
            showCancelButton: true,
            confirmButtonColor: '#3a6e59',
            cancelButtonColor: '#6b7280',
            confirmButtonText: isFull ? '確認登記候補' : '確認報名',
            cancelButtonText: '取消'
        }).then(result => {
            if (!result.isConfirmed) return;
            const noteText = String(result.value || '').trim();

            Swal.fire({ title: isFull ? '登記候補中...' : '報名處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            callGasApi('group', 'joinGroup', {
                seqId: seqId,
                userId: Store.currentUserId,
                noteText: noteText
            }, res => {
                if (res && res.success) {
                    if (res.waitlisted) {
                        Swal.fire('已加入候補名單！', `您的候補順位為第 ${res.waitlistPos || 1} 位 ⏳`, 'success');
                    } else {
                        Swal.fire('報名成功！', '您已加入本活動名單 🎉', 'success');
                    }
                    refresh(true, seqId);
                } else {
                    Swal.fire('報名失敗', (res && res.error) || '發生未知錯誤', 'error');
                }
            }, err => {
                Swal.fire('系統錯誤', '報名失敗：' + err, 'error');
            });
        });
    }

    function refresh(force = true, focusSeqId = null) {
        loadGroups(force, focusSeqId);
    }

    return {
        init,
        refresh,
        setFilter,
        clearSearch,
        goTo,
        step,
        handleCardClick,
        quickJoin,
        focusBySeqId: seqId => {
            if (!seqId || !filteredGroups.length) return;
            const idx = filteredGroups.findIndex(g => String(g.seqId) === String(seqId));
            if (idx !== -1) goTo(idx);
        },
        rerenderCurrent: () => {
            if (Store.groupsLoaded) applyFilterAndRender();
        }
    };
})();

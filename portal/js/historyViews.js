/**
 * L>S Portal — 揪團大事記 & 退群紀錄視圖（按需延遲載入 + 雙欄/手機詳情）
 */
window.PortalHistory = (function() {
    const { Store, callGasApi, escapeHtml, escapeRegExp, openExternalUrl } = window.PortalApi;

    let ghBound = false;
    let lhBound = false;
    let ghLoading = false;
    let lhLoading = false;

    let ghRecords = [];
    let ghFiltered = [];
    let ghRendered = 0;
    let ghSelectedPos = -1;
    let ghDesktopSplit = true;
    const ghState = { keyword: '', memberQuery: '', memberScope: 'all', status: 'all', sortOrder: 'newest', viewMode: 'card' };

    let lhRecords = [];
    let lhFiltered = [];
    let lhRendered = 0;
    const lhState = { keyword: '', sortBy: 'newest', viewMode: 'card' };

    let ghTimer = null;
    let lhTimer = null;

    function highlight(text, kw) {
        const raw = String(text || '');
        const clean = String(kw || '').trim();
        if (!clean) return escapeHtml(raw);
        const rx = new RegExp(escapeRegExp(clean), 'gi');
        let out = '';
        let last = 0;
        let m;
        while ((m = rx.exec(raw)) !== null) {
            if (m.index > last) out += escapeHtml(raw.slice(last, m.index));
            out += `<mark class="hl">${escapeHtml(m[0])}</mark>`;
            last = rx.lastIndex;
            if (m[0].length === 0) break;
        }
        if (last < raw.length) out += escapeHtml(raw.slice(last));
        return out;
    }

    // =========================================================================
    // 揪團大事記
    // =========================================================================
    function ensureGroupHistoryLoaded() {
        bindGhEvents();
        if (Store.groupHistoryLoaded && ghRecords.length > 0) return;
        loadGroupHistory();
    }

    function bindGhEvents() {
        if (ghBound) return;
        ghBound = true;

        const kwIn = document.getElementById('ghKeywordInput');
        const mbIn = document.getElementById('ghMemberInput');
        const kwClr = document.getElementById('ghClearKeywordBtn');
        const mbClr = document.getElementById('ghClearMemberBtn');

        kwIn.addEventListener('input', () => {
            kwClr.classList.toggle('visible', kwIn.value.length > 0);
            clearTimeout(ghTimer);
            ghTimer = setTimeout(applyGhFilters, 120);
        });

        mbIn.addEventListener('input', () => {
            mbClr.classList.toggle('visible', mbIn.value.length > 0);
            document.getElementById('ghScopeRow').style.display = mbIn.value.trim() ? 'flex' : 'none';
            clearTimeout(ghTimer);
            ghTimer = setTimeout(applyGhFilters, 120);
        });

        kwClr.addEventListener('click', () => { kwIn.value = ''; kwClr.classList.remove('visible'); applyGhFilters(); });
        mbClr.addEventListener('click', () => {
            mbIn.value = '';
            mbClr.classList.remove('visible');
            document.getElementById('ghScopeRow').style.display = 'none';
            applyGhFilters();
        });

        document.querySelectorAll('[data-gh-scope]').forEach(btn => {
            btn.addEventListener('click', () => {
                ghState.memberScope = btn.dataset.ghScope;
                document.querySelectorAll('[data-gh-scope]').forEach(b => b.classList.toggle('is-active', b === btn));
                applyGhFilters();
            });
        });

        document.querySelectorAll('[data-gh-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                ghState.status = btn.dataset.ghStatus;
                document.querySelectorAll('[data-gh-status]').forEach(b => b.classList.toggle('is-active', b === btn));
                applyGhFilters();
            });
        });

        document.getElementById('ghSortToggleBtn').addEventListener('click', function() {
            ghState.sortOrder = ghState.sortOrder === 'newest' ? 'oldest' : 'newest';
            this.textContent = ghState.sortOrder === 'newest' ? '最新 ▾' : '最舊 ▴';
            applyGhFilters();
        });

        window.addEventListener('resize', syncGhSplitLayout, { passive: true });
        document.addEventListener('keydown', e => {
            const view = document.getElementById('view-groupHistory');
            if (!view || view.hidden) return;
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && isSplitActive()) {
                const tag = document.activeElement && document.activeElement.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                if (!ghFiltered.length) return;
                e.preventDefault();
                const next = Math.max(0, Math.min(ghFiltered.length - 1, (ghSelectedPos >= 0 ? ghSelectedPos : 0) + (e.key === 'ArrowDown' ? 1 : -1)));
                if (next !== ghSelectedPos) {
                    if (next >= ghRendered) renderNextGhBatch();
                    selectGhItem(next);
                }
            }
        });
        syncGhSplitLayout();
    }

    function isSplitActive() {
        return ghDesktopSplit && window.innerWidth >= 960;
    }

    function syncGhSplitLayout() {
        const ws = document.getElementById('ghWorkspace');
        const btn = document.getElementById('ghDesktopToggleBtn');
        const active = isSplitActive();
        if (ws) ws.classList.toggle('is-split', active);
        if (btn) btn.classList.toggle('is-active', ghDesktopSplit);
        if (active && ghFiltered.length > 0) {
            if (ghSelectedPos < 0 || ghSelectedPos >= ghFiltered.length) ghSelectedPos = 0;
            renderGhPane(ghSelectedPos);
        }
    }

    function toggleDesktopSplit() {
        ghDesktopSplit = !ghDesktopSplit;
        syncGhSplitLayout();
        updateGhSelection();
    }

    function setGhViewMode(mode) {
        ghState.viewMode = mode;
        document.querySelectorAll('[data-gh-view]').forEach(b => b.classList.toggle('is-active', b.dataset.ghView === mode));
        applyGhFilters();
    }

    function resetGhFilters() {
        document.getElementById('ghKeywordInput').value = '';
        document.getElementById('ghMemberInput').value = '';
        document.getElementById('ghClearKeywordBtn').classList.remove('visible');
        document.getElementById('ghClearMemberBtn').classList.remove('visible');
        document.getElementById('ghScopeRow').style.display = 'none';
        ghState.keyword = '';
        ghState.memberQuery = '';
        ghState.memberScope = 'all';
        ghState.status = 'all';
        ghState.sortOrder = 'newest';
        document.querySelectorAll('[data-gh-scope]').forEach(b => b.classList.toggle('is-active', b.dataset.ghScope === 'all'));
        document.querySelectorAll('[data-gh-status]').forEach(b => b.classList.toggle('is-active', b.dataset.ghStatus === 'all'));
        document.getElementById('ghSortToggleBtn').textContent = '最新 ▾';
        applyGhFilters();
    }

    function normalizeGhRecord(raw) {
        const content = String(raw && raw.content ? raw.content : '').replace(/\r\n?/g, '\n');
        const lines = content.split('\n');
        const firstIdx = lines.findIndex(l => l.trim() !== '');
        const hostDate = String(raw && raw.hostDate ? raw.hostDate : '').trim();
        const title = firstIdx !== -1 ? lines[firstIdx].trim() : (hostDate ? `${hostDate} 的揪團` : '未命名揪團');
        const bodyText = firstIdx !== -1 ? lines.slice(firstIdx + 1).join('\n').trim() : '';
        const startTime = String(raw && raw.startTime ? raw.startTime : '').trim();
        const endTime = String(raw && raw.endTime ? raw.endTime : '').trim();
        const host = String(raw && raw.host ? raw.host : '').trim() || '未知主揪';
        const joinerRaw = String(raw && raw.joiner ? raw.joiner : '').trim();
        const joiners = joinerRaw ? joinerRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        const endType = String(raw && raw.endType ? raw.endType : '').trim() || '已結束';
        const locRaw = String(raw && raw.location ? raw.location : '').replace(/\r\n?/g, '\n').trim();
        const locLines = locRaw ? locRaw.split('\n').map(l => l.trim()).filter(Boolean) : [];

        return {
            host, hostLower: host.toLowerCase(), hostDate, startTime, endTime,
            displayTime: (startTime && endTime) ? `${startTime} ~ ${endTime}` : (startTime || endTime || hostDate || '未記錄時間'),
            shortTime: startTime || (hostDate ? `發起 ${hostDate}` : '時間未記錄'),
            content, contentLower: content.toLowerCase(), title, titleLower: title.toLowerCase(), bodyText,
            joiners, joinersLower: joiners.map(j => j.toLowerCase()), endType,
            locationName: locLines[0] || '', locationAddress: locLines.slice(1).join(' ')
        };
    }

    function loadGroupHistory() {
        if (ghLoading) return;
        ghLoading = true;
        document.getElementById('ghLoading').style.display = 'flex';
        document.getElementById('ghList').innerHTML = '';

        callGasApi('groupHistory', 'getAllGroupHistory', {}, res => {
            ghLoading = false;
            document.getElementById('ghLoading').style.display = 'none';
            if (!res || res.success === false || !Array.isArray(res.historyList)) {
                document.getElementById('ghList').innerHTML = `<div class="empty-panel"><div class="empty-title">無法讀取揪團大事記</div><div class="empty-desc">${escapeHtml((res && res.error) || '資料格式錯誤')}</div></div>`;
                return;
            }
            ghRecords = res.historyList.map(normalizeGhRecord);
            Store.groupHistory = ghRecords;
            Store.groupHistoryLoaded = true;
            applyGhFilters();
        }, err => {
            ghLoading = false;
            document.getElementById('ghLoading').style.display = 'none';
            document.getElementById('ghList').innerHTML = `<div class="empty-panel"><div class="empty-title">載入失敗</div><div class="empty-desc">${escapeHtml(err)}</div></div>`;
        });
    }

    function applyGhFilters() {
        const kw = document.getElementById('ghKeywordInput').value.trim();
        const mb = document.getElementById('ghMemberInput').value.trim();
        ghState.keyword = kw;
        ghState.memberQuery = mb;
        const kwL = kw.toLowerCase();
        const mbL = mb.toLowerCase();

        const list = [];
        for (const rec of ghRecords) {
            if (ghState.status !== 'all' && rec.endType !== ghState.status) continue;
            if (kwL && !rec.titleLower.includes(kwL) && !rec.contentLower.includes(kwL)) continue;

            let mHost = false, mJoin = false;
            if (mbL) {
                mHost = rec.hostLower.includes(mbL);
                mJoin = rec.joinersLower.some(j => j.includes(mbL));
                if (ghState.memberScope === 'host' && !mHost) continue;
                if (ghState.memberScope === 'joiner' && !mJoin) continue;
                if (ghState.memberScope === 'all' && !mHost && !mJoin) continue;
            }
            list.push({ record: rec, matchedAsHost: mHost, matchedAsJoiner: mJoin });
        }
        if (ghState.sortOrder === 'oldest') list.reverse();

        ghFiltered = list;
        ghRendered = 0;
        ghSelectedPos = list.length > 0 ? 0 : -1;

        const hasFilter = Boolean(kw || mb || ghState.status !== 'all');
        document.getElementById('ghResetFiltersBtn').style.display = hasFilter ? 'inline-block' : 'none';
        document.getElementById('ghCountPill').textContent = hasFilter ? `符合 ${list.length} / ${ghRecords.length} 團` : `共 ${ghRecords.length} 團`;

        const listEl = document.getElementById('ghList');
        listEl.innerHTML = '';

        if (!list.length) {
            document.getElementById('ghFooter').innerHTML = '';
            document.getElementById('ghPaneBodyWrap').style.display = 'none';
            document.getElementById('ghPaneEmpty').style.display = 'block';
            listEl.innerHTML = `<div class="empty-panel"><div class="empty-emoji">🔍</div><div class="empty-title">查無符合條件的歷史揪團</div></div>`;
            return;
        }

        renderNextGhBatch();
        if (isSplitActive()) renderGhPane(ghSelectedPos);
    }

    function renderNextGhBatch() {
        const listEl = document.getElementById('ghList');
        const isCompact = ghState.viewMode === 'compact';
        const batchSize = isCompact ? 50 : 20;
        const slice = ghFiltered.slice(ghRendered, ghRendered + batchSize);

        let html = '';
        slice.forEach((entry, i) => {
            const pos = ghRendered + i;
            const rec = entry.record;
            const isEarly = rec.endType === '提前關團';
            const sel = isSplitActive() && pos === ghSelectedPos;

            if (isCompact) {
                html += `
                    <div class="history-row-item ${sel ? 'is-selected' : ''}" data-gh-pos="${pos}" onclick="PortalHistory.selectGhItem(${pos})">
                        <div style="min-width:0;">
                            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${highlight(rec.title, ghState.keyword)}</div>
                            <div class="mono" style="font-size:0.8rem;color:var(--p-muted);">${escapeHtml(rec.shortTime)} · 主揪 ${escapeHtml(rec.host)} · ${rec.joiners.length}人</div>
                        </div>
                        <span class="status-pill ${isEarly ? 'is-early' : 'is-done'}">${escapeHtml(rec.endType)}</span>
                    </div>`;
            } else {
                html += `
                    <article class="history-card ${sel ? 'is-selected' : ''}" data-gh-pos="${pos}" onclick="PortalHistory.selectGhItem(${pos})">
                        <div class="card-meta-top">
                            <span class="mono meta-pill">📅 ${escapeHtml(rec.shortTime)}</span>
                            <span class="status-pill ${isEarly ? 'is-early' : 'is-done'}">${escapeHtml(rec.endType)}</span>
                        </div>
                        <div class="history-card-title">${highlight(rec.title, ghState.keyword)}</div>
                        <div class="history-card-snippet">${highlight(rec.bodyText || '（無額外內文）', ghState.keyword)}</div>
                        <div class="history-tags-row">
                            <span>👑 ${escapeHtml(rec.host)}</span>
                            <span>· 👥 ${rec.joiners.length} 人參加</span>
                            ${rec.locationName ? `<span>· 📍 ${escapeHtml(rec.locationName)}</span>` : ''}
                        </div>
                    </article>`;
            }
        });

        listEl.insertAdjacentHTML('beforeend', html);
        ghRendered += slice.length;

        const footer = document.getElementById('ghFooter');
        const rem = ghFiltered.length - ghRendered;
        footer.innerHTML = rem > 0
            ? `<button type="button" class="btn btn--secondary" onclick="PortalHistory.renderNextGhBatch()">顯示更多（還有 ${rem} 團）</button>`
            : `已顯示全部 ${ghFiltered.length} 筆紀錄`;
    }

    function updateGhSelection() {
        const active = isSplitActive();
        document.querySelectorAll('#ghList [data-gh-pos]').forEach(el => {
            el.classList.toggle('is-selected', active && parseInt(el.dataset.ghPos, 10) === ghSelectedPos);
        });
    }

    function populateGhDetail(prefix, entry) {
        const rec = entry.record;
        const isEarly = rec.endType === '提前關團';
        document.getElementById(`${prefix}Time`).textContent = `📅 ${rec.shortTime}`;
        const stEl = document.getElementById(`${prefix}Status`);
        stEl.textContent = rec.endType;
        stEl.className = `status-pill ${isEarly ? 'is-early' : 'is-done'}`;
        document.getElementById(`${prefix}Title`).innerHTML = highlight(rec.title, ghState.keyword);
        document.getElementById(`${prefix}ActivityTime`).textContent = rec.displayTime;

        const hdRow = document.getElementById(`${prefix}HostDateRow`);
        if (rec.hostDate) {
            document.getElementById(`${prefix}HostDate`).textContent = rec.hostDate;
            hdRow.style.display = 'flex';
        } else {
            hdRow.style.display = 'none';
        }

        const locCard = document.getElementById(`${prefix}LocCard`);
        if (rec.locationName) {
            document.getElementById(`${prefix}LocName`).textContent = rec.locationName;
            const addrEl = document.getElementById(`${prefix}LocAddr`);
            addrEl.textContent = rec.locationAddress || '';
            addrEl.style.display = rec.locationAddress ? 'block' : 'none';
            const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(rec.locationAddress || rec.locationName);
            const btn = document.getElementById(`${prefix}MapBtn`);
            btn.href = mapUrl;
            btn.onclick = e => openExternalUrl(e, mapUrl);
            locCard.style.display = 'flex';
        } else {
            locCard.style.display = 'none';
        }

        document.getElementById(`${prefix}Content`).innerHTML = highlight(rec.content || '（無內文）', ghState.keyword);
        document.getElementById(`${prefix}JoinerCount`).textContent = `參與名單 (主揪 1 + ${rec.joiners.length} 人)`;

        const mbL = ghState.memberQuery.toLowerCase();
        let chips = `<button type="button" class="member-chip-btn is-host" data-member-name="${escapeHtml(rec.host)}" onclick="PortalHistory.filterByMember(this.dataset.memberName)">👑 主揪：${escapeHtml(rec.host)}</button>`;
        rec.joiners.forEach(name => {
            const matched = mbL && name.toLowerCase().includes(mbL);
            chips += `<button type="button" class="member-chip-btn ${matched ? 'is-matched' : ''}" data-member-name="${escapeHtml(name)}" onclick="PortalHistory.filterByMember(this.dataset.memberName)">${escapeHtml(name)}</button>`;
        });
        document.getElementById(`${prefix}MemberChips`).innerHTML = chips;
    }

    function renderGhPane(pos) {
        const entry = ghFiltered[pos];
        if (!entry) return;
        document.getElementById('ghPaneEmpty').style.display = 'none';
        document.getElementById('ghPaneBodyWrap').style.display = 'block';
        populateGhDetail('ghPane', entry);
    }

    function selectGhItem(pos) {
        ghSelectedPos = pos;
        if (isSplitActive()) {
            updateGhSelection();
            renderGhPane(pos);
            return;
        }
        const entry = ghFiltered[pos];
        if (!entry) return;
        populateGhDetail('ghSheet', entry);
        document.getElementById('ghSheetOverlay').classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    function closeGhSheet() {
        document.getElementById('ghSheetOverlay').classList.remove('is-open');
        document.body.style.overflow = '';
    }

    function filterByMember(name) {
        const input = document.getElementById('ghMemberInput');
        input.value = name || '';
        document.getElementById('ghClearMemberBtn').classList.toggle('visible', input.value.length > 0);
        document.getElementById('ghScopeRow').style.display = input.value.trim() ? 'flex' : 'none';
        closeGhSheet();
        applyGhFilters();
    }

    // =========================================================================
    // 退群紀錄
    // =========================================================================
    function ensureLeftHistoryLoaded() {
        bindLhEvents();
        if (Store.leftHistoryLoaded && lhRecords.length > 0) return;
        loadLeftHistory();
    }

    function bindLhEvents() {
        if (lhBound) return;
        lhBound = true;

        const input = document.getElementById('lhSearchInput');
        const clr = document.getElementById('lhClearSearchBtn');

        input.addEventListener('input', () => {
            clr.classList.toggle('visible', input.value.length > 0);
            clearTimeout(lhTimer);
            lhTimer = setTimeout(applyLhFilters, 120);
        });

        clr.addEventListener('click', () => {
            input.value = '';
            clr.classList.remove('visible');
            applyLhFilters();
        });

        document.querySelectorAll('[data-lh-sort]').forEach(btn => {
            btn.addEventListener('click', () => {
                lhState.sortBy = btn.dataset.lhSort;
                document.querySelectorAll('[data-lh-sort]').forEach(b => b.classList.toggle('is-active', b === btn));
                applyLhFilters();
            });
        });
    }

    function setLhViewMode(mode) {
        lhState.viewMode = mode;
        document.querySelectorAll('[data-lh-view]').forEach(b => b.classList.toggle('is-active', b.dataset.lhView === mode));
        applyLhFilters();
    }

    function loadLeftHistory() {
        if (lhLoading) return;
        lhLoading = true;
        document.getElementById('lhLoading').style.display = 'flex';
        document.getElementById('lhList').innerHTML = '';

        callGasApi('leftHistory', 'getAllLeftHistory', {}, res => {
            lhLoading = false;
            document.getElementById('lhLoading').style.display = 'none';
            if (!res || res.success === false || !Array.isArray(res.leftList)) {
                document.getElementById('lhList').innerHTML = `<div class="empty-panel"><div class="empty-title">無法讀取退群紀錄</div><div class="empty-desc">${escapeHtml((res && res.error) || '資料格式異常')}</div></div>`;
                return;
            }
            lhRecords = res.leftList.map((raw, idx) => ({
                _idx: idx,
                name: String(raw && raw.name ? raw.name : '').trim() || '未知成員',
                nameLower: String(raw && raw.name ? raw.name : '').trim().toLowerCase(),
                leftDate: String(raw && raw.leftDate ? raw.leftDate : '').trim() || '日期未知',
                textCount: Math.max(0, parseInt(raw && raw.textCount, 10) || 0)
            }));
            Store.leftHistory = lhRecords;
            Store.leftHistoryLoaded = true;
            applyLhFilters();
        }, err => {
            lhLoading = false;
            document.getElementById('lhLoading').style.display = 'none';
            document.getElementById('lhList').innerHTML = `<div class="empty-panel"><div class="empty-title">載入失敗</div><div class="empty-desc">${escapeHtml(err)}</div></div>`;
        });
    }

    function applyLhFilters() {
        const kw = document.getElementById('lhSearchInput').value.trim();
        lhState.keyword = kw;
        const kwL = kw.toLowerCase();

        let list = kwL ? lhRecords.filter(r => r.nameLower.includes(kwL)) : lhRecords.slice();
        if (lhState.sortBy === 'oldest') list.reverse();
        else if (lhState.sortBy === 'mostMsgs') list.sort((a, b) => b.textCount - a.textCount || a._idx - b._idx);

        lhFiltered = list;
        lhRendered = 0;
        document.getElementById('lhCountPill').textContent = kw ? `符合 ${list.length} / ${lhRecords.length} 人` : `共 ${lhRecords.length} 人`;

        const listEl = document.getElementById('lhList');
        listEl.className = lhState.viewMode === 'card' ? 'left-cards-grid' : '';
        listEl.innerHTML = '';

        if (!list.length) {
            document.getElementById('lhFooter').innerHTML = '';
            listEl.innerHTML = `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">🔍</div><div class="empty-title">查無符合條件的退群紀錄</div></div>`;
            return;
        }
        renderNextLhBatch();
    }

    function renderNextLhBatch() {
        const listEl = document.getElementById('lhList');
        const isCompact = lhState.viewMode === 'compact';
        const slice = lhFiltered.slice(lhRendered, lhRendered + (isCompact ? 60 : 30));

        let html = '';
        slice.forEach(rec => {
            const countStr = rec.textCount.toLocaleString('en-US');
            if (isCompact) {
                html += `
                    <div class="left-row-item">
                        <div style="font-weight:700;">${highlight(rec.name, lhState.keyword)}</div>
                        <div class="mono" style="font-size:0.86rem;color:var(--p-muted);">${escapeHtml(rec.leftDate)}</div>
                        <div class="mono meta-pill">${countStr} 則</div>
                    </div>`;
            } else {
                html += `
                    <article class="left-card">
                        <div class="left-name">${highlight(rec.name, lhState.keyword)}</div>
                        <div class="left-stats">
                            <span class="mono meta-pill">離群 ${escapeHtml(rec.leftDate)}</span>
                            <span class="mono meta-pill">發言 ${countStr} 則</span>
                        </div>
                    </article>`;
            }
        });

        listEl.insertAdjacentHTML('beforeend', html);
        lhRendered += slice.length;

        const rem = lhFiltered.length - lhRendered;
        document.getElementById('lhFooter').innerHTML = rem > 0
            ? `<button type="button" class="btn btn--secondary" onclick="PortalHistory.renderNextLhBatch()">顯示更多（還有 ${rem} 筆）</button>`
            : `已顯示全部 ${lhFiltered.length} 筆紀錄`;
    }

    return {
        ensureGroupHistoryLoaded,
        ensureLeftHistoryLoaded,
        toggleDesktopSplit,
        setGhViewMode,
        resetGhFilters,
        renderNextGhBatch,
        selectGhItem,
        closeGhSheet,
        filterByMember,
        setLhViewMode,
        renderNextLhBatch
    };
})();

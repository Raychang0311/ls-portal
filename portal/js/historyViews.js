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
    let ghIsAdmin = false;
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
                if (ghState.status === 'latestComment') {
                    ghState.sortOrder = 'newest';
                    const sortBtn = document.getElementById('ghSortToggleBtn');
                    if (sortBtn) sortBtn.textContent = '最新 ▾';
                }
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

    const LEFT_MEMBER_NAME = '已退群成員';
    const LEFT_MEMBER_AVATAR = 'https://obs.line-scdn.net/0hTp0LmYC8C18NNRtkYlJ0CF1oAD0-VxVULwEfOChdVgh7VjpTMi8tWiheVmYjfhN1OQMbSSlOCg8obj5iMTIhTnJlHgxgVjVudjgPRmlJIB98VSkIdw/f256x256';

    function normalizeGhComments(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList
            .filter(c => c && typeof c === 'object')
            .map((c, idx) => {
                const uid = String(c.userId || '').trim();
                const m = uid ? window.PortalApi.findMemberById(uid) : null;
                const isDel = String(c.deleted || '').trim().toUpperCase() === 'Y';
                const floorNum = parseInt(c.floor, 10) || (idx + 1);
                const rNum = (c.replyTo !== undefined && c.replyTo !== null && c.replyTo !== '' && !isNaN(parseInt(c.replyTo, 10)))
                    ? parseInt(c.replyTo, 10)
                    : null;
                const rawName = String(c.userName || '').trim();
                const isLeftFallback = !m && (!rawName || rawName === '曾在此團之群友' || rawName === LEFT_MEMBER_NAME);
                return {
                    floor: floorNum,
                    time: String(c.time || '').trim(),
                    userId: uid,
                    userName: m ? m.name : (isLeftFallback ? LEFT_MEMBER_NAME : rawName),
                    userPic: m ? (m.pic || LEFT_MEMBER_AVATAR) : (isLeftFallback ? LEFT_MEMBER_AVATAR : String(c.userPic || LEFT_MEMBER_AVATAR)),
                    content: isDel ? '' : String(c.content || ''),
                    replyTo: rNum,
                    deleted: isDel ? 'Y' : '',
                    editedTime: isDel ? '' : String(c.editedTime || '').trim()
                };
            })
            .sort((a, b) => a.floor - b.floor);
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
            rowIndex: raw && raw.rowIndex ? parseInt(raw.rowIndex, 10) : 0,
            rowKey: String((raw && raw.rowKey) || `${host}|${hostDate}|${startTime}`),
            host, hostLower: host.toLowerCase(), hostDate, startTime, endTime,
            displayTime: window.PortalApi.formatSmartDateRange(startTime, endTime, hostDate ? `發起日 ${hostDate}` : '未記錄時間'),
            shortTime: startTime || (hostDate ? `發起 ${hostDate}` : '時間未記錄'),
            content, contentLower: content.toLowerCase(), title, titleLower: title.toLowerCase(), bodyText,
            joiners, joinersLower: joiners.map(j => j.toLowerCase()), endType,
            locationName: locLines[0] || '', locationAddress: locLines.slice(1).join(' '),
            albumFolderId: String(raw && raw.albumFolderId ? raw.albumFolderId : '').trim(),
            comments: normalizeGhComments(raw && raw.comments)
        };
    }

    function isGhAdmin() {
        return Boolean(ghIsAdmin || (Store && Store.isAdmin));
    }

    function loadGroupHistory() {
        if (ghLoading) return;
        ghLoading = true;
        document.getElementById('ghLoading').style.display = 'flex';
        document.getElementById('ghList').innerHTML = '';

        callGasApi('groupHistory', 'getAllGroupHistory', { userId: (Store && Store.currentUserId) || '' }, res => {
            ghLoading = false;
            document.getElementById('ghLoading').style.display = 'none';
            if (!res || res.success === false || !Array.isArray(res.historyList)) {
                document.getElementById('ghList').innerHTML = `<div class="empty-panel"><div class="empty-title">無法讀取揪團大事記</div><div class="empty-desc">${escapeHtml((res && res.error) || '資料格式錯誤')}</div></div>`;
                return;
            }
            ghIsAdmin = Boolean(res.isAdmin || (Store && Store.isAdmin));
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

    function parseCommentTimeMs(str) {
        const raw = String(str || '').trim();
        if (!raw) return 0;
        const m = raw.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (m) {
            return new Date(
                parseInt(m[1], 10),
                parseInt(m[2], 10) - 1,
                parseInt(m[3], 10),
                parseInt(m[4] || '0', 10),
                parseInt(m[5] || '0', 10),
                parseInt(m[6] || '0', 10)
            ).getTime();
        }
        const parsed = Date.parse(raw.replace(/\//g, '-'));
        return isNaN(parsed) ? 0 : parsed;
    }

    function getLatestCommentMeta(rec) {
        const comments = Array.isArray(rec && rec.comments) ? rec.comments : [];
        let activeCount = 0;
        let latestMs = 0;
        let latestFloor = 0;
        for (const c of comments) {
            if (!c || c.deleted === 'Y') continue;
            activeCount++;
            const ts = parseCommentTimeMs(c.time);
            if (ts > latestMs) latestMs = ts;
            if (c.floor > latestFloor) latestFloor = c.floor;
        }
        return { activeCount, latestMs, latestFloor };
    }

    function applyGhFilters() {
        const kw = document.getElementById('ghKeywordInput').value.trim();
        const mb = document.getElementById('ghMemberInput').value.trim();
        ghState.keyword = kw;
        ghState.memberQuery = mb;
        const kwL = kw.toLowerCase();
        const mbL = mb.toLowerCase();
        const isLatestCommentMode = ghState.status === 'latestComment';
        const isHasAlbumMode = ghState.status === 'hasAlbum';

        const list = [];
        for (const rec of ghRecords) {
            let latestCommentMs = 0;
            let latestCommentFloor = 0;
            if (isLatestCommentMode) {
                const meta = getLatestCommentMeta(rec);
                if (meta.activeCount === 0) continue;
                latestCommentMs = meta.latestMs;
                latestCommentFloor = meta.latestFloor;
            } else if (isHasAlbumMode) {
                if (!rec.albumFolderId) continue;
            } else if (ghState.status !== 'all' && rec.endType !== ghState.status) {
                continue;
            }
            if (kwL && !rec.titleLower.includes(kwL) && !rec.contentLower.includes(kwL)) continue;

            let mHost = false, mJoin = false;
            if (mbL) {
                mHost = rec.hostLower.includes(mbL);
                mJoin = rec.joinersLower.some(j => j.includes(mbL));
                if (ghState.memberScope === 'host' && !mHost) continue;
                if (ghState.memberScope === 'joiner' && !mJoin) continue;
                if (ghState.memberScope === 'all' && !mHost && !mJoin) continue;
            }
            list.push({ record: rec, matchedAsHost: mHost, matchedAsJoiner: mJoin, latestCommentMs, latestCommentFloor });
        }
        if (isLatestCommentMode) {
            list.sort((a, b) => {
                const diff = b.latestCommentMs - a.latestCommentMs;
                if (diff !== 0) return diff;
                return b.latestCommentFloor - a.latestCommentFloor;
            });
            if (ghState.sortOrder === 'oldest') list.reverse();
        } else if (ghState.sortOrder === 'oldest') {
            list.reverse();
        }

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
            const totalFloors = Array.isArray(rec.comments) ? rec.comments.length : 0;
            const commentBadge = totalFloors > 0 ? `<span data-gh-cmt-count="${escapeHtml(rec.rowKey)}"> · 💬 ${totalFloors}</span>` : `<span data-gh-cmt-count="${escapeHtml(rec.rowKey)}"></span>`;
            const albumBadge = `<span data-gh-album-badge="${escapeHtml(rec.rowKey)}">${rec.albumFolderId ? ' · 📷 相簿' : ''}</span>`;

            if (isCompact) {
                html += `
                    <div class="history-row-item ${sel ? 'is-selected' : ''}" data-gh-pos="${pos}" onclick="PortalHistory.selectGhItem(${pos})">
                        <div class="history-row-main">
                            <div class="history-row-title">${highlight(rec.title, ghState.keyword)}</div>
                            <div class="history-row-sub mono">${escapeHtml(rec.shortTime)} · 主揪 ${escapeHtml(rec.host)} · ${rec.joiners.length}人${commentBadge}${albumBadge}</div>
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
                            ${commentBadge}${albumBadge}
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

    const ghCommentUi = {
        ghPane: { rec: null, replyTo: null, replyToName: '', editingFloor: null, busy: false, refreshing: false, fetchToken: 0 },
        ghSheet: { rec: null, replyTo: null, replyToName: '', editingFloor: null, busy: false, refreshing: false, fetchToken: 0 }
    };

    function renderGhCommentsSection(prefix, rec) {
        const container = document.getElementById(`${prefix}CommentsBlock`);
        if (!container || !rec) return;
        const st = ghCommentUi[prefix];
        if (!st.rec || st.rec.rowKey !== rec.rowKey) {
            st.replyTo = null;
            st.replyToName = '';
            st.editingFloor = null;
        }
        st.rec = rec;

        const comments = Array.isArray(rec.comments) ? rec.comments : [];
        const totalFloors = comments.length;
        const uidLower = String(Store.currentUserId || '').trim().toLowerCase();

        const replyingBarHtml = st.replyTo
            ? `<div class="gh-replying-bar">
                    <span>↳ 正在回覆 #${st.replyTo} ${escapeHtml(st.replyToName || '')}</span>
                    <button type="button" class="gh-replying-cancel" onclick="PortalHistory.clearReplyTarget('${prefix}')" aria-label="取消回覆">✕</button>
               </div>`
            : '';

        let listHtml = '';
        if (comments.length === 0) {
            listHtml = '<div class="gh-comments-empty">目前還沒有留言，搶下 #1 沙發吧！</div>';
        } else {
            listHtml = comments.map(c => {
                const isDeleted = c.deleted === 'Y';
                const isMine = Boolean(uidLower && c.userId && c.userId.toLowerCase() === uidLower);
                const isEditing = !isDeleted && isMine && st.editingFloor === c.floor;
                const safePic = escapeHtml(c.userPic || LEFT_MEMBER_AVATAR);
                const safeName = escapeHtml(c.userName || LEFT_MEMBER_NAME);

                const replyBadgeHtml = c.replyTo
                    ? `<button type="button" class="gh-reply-ref" onclick="PortalHistory.scrollToCommentFloor('${prefix}', ${c.replyTo})">↳ 回覆 #${c.replyTo}</button>`
                    : '';

                let bodyHtml = '';
                if (isDeleted) {
                    bodyHtml = '<div class="gh-comment-text">留言已刪除</div>';
                } else if (isEditing) {
                    bodyHtml = `
                        <div class="gh-comment-edit-box">
                            <textarea id="${prefix}EditInput_${c.floor}" class="gh-comment-input" maxlength="500" oninput="PortalHistory.handleEditInput('${prefix}', ${c.floor})">${escapeHtml(c.content)}</textarea>
                            <div class="gh-comment-edit-actions">
                                <button type="button" class="gh-comment-act-btn" onclick="PortalHistory.cancelEditComment('${prefix}')">取消</button>
                                <button type="button" id="${prefix}SaveEditBtn_${c.floor}" class="gh-comment-act-btn is-save" onclick="PortalHistory.saveEditComment('${prefix}', ${c.floor})" disabled>儲存</button>
                            </div>
                        </div>`;
                } else {
                    bodyHtml = `<div class="gh-comment-text">${escapeHtml(c.content)}</div>`;
                }

                const actionsHtml = (!isDeleted && !isEditing)
                    ? `<div class="gh-comment-actions">
                            <button type="button" class="gh-comment-act-btn" onclick="PortalHistory.setReplyTarget('${prefix}', ${c.floor})">💬 回覆</button>
                            ${isMine ? `<button type="button" class="gh-comment-act-btn" onclick="PortalHistory.startEditComment('${prefix}', ${c.floor})">✏️ 修改</button>` : ''}
                            ${isMine ? `<button type="button" class="gh-comment-act-btn is-danger" onclick="PortalHistory.deleteComment('${prefix}', ${c.floor})">🗑️ 刪除</button>` : ''}
                       </div>`
                    : '';

                return `
                    <article class="gh-comment-item ${isDeleted ? 'is-deleted' : ''}" data-comment-floor="${c.floor}">
                        <img class="gh-comment-avatar" src="${safePic}" alt="${safeName}" loading="lazy" onerror="this.src='https://imgur.com/786FxAA.jpg'">
                        <div class="gh-comment-main">
                            <div class="gh-comment-top">
                                <span class="gh-comment-author">${safeName}</span>
                                <span class="gh-comment-meta-right">
                                    <span class="gh-comment-time mono">${escapeHtml(c.time)}${!isDeleted && c.editedTime ? ' (已編輯)' : ''}</span>
                                    <span class="gh-comment-floor mono">#${c.floor}</span>
                                </span>
                            </div>
                            ${replyBadgeHtml}
                            ${bodyHtml}
                            ${actionsHtml}
                        </div>
                    </article>`;
            }).join('');
        }

        container.innerHTML = `
            <div class="gh-comments-head">
                <span class="detail-label" id="${prefix}CommentsTitle">💬 留言討論區 (${totalFloors} 則)</span>
                <div class="gh-comments-head-right">
                    <button type="button" id="${prefix}CmtRefreshBtn" class="gh-cmt-refresh-btn ${st.refreshing ? 'is-spinning' : ''}" onclick="PortalHistory.refreshComments('${prefix}')" aria-label="重新整理留言區" title="重新整理留言">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
                            <polyline points="21 3 21 9 15 9"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="gh-comment-composer" id="${prefix}Composer">
                ${replyingBarHtml}
                <div class="gh-composer-row">
                    <textarea id="${prefix}CommentInput" class="gh-comment-input" rows="2" maxlength="500" placeholder="寫下留言內容（最多 500 字）..."></textarea>
                    <button type="button" id="${prefix}CommentSubmit" class="btn btn--primary btn--compact gh-composer-submit" onclick="PortalHistory.submitComment('${prefix}')">送出留言</button>
                </div>
            </div>
            <div class="gh-comments-list" id="${prefix}CommentsList">${listHtml}</div>
        `;
    }

    function updateCommentsListOnly(prefix, rec, preserveDraft) {
        const titleEl = document.getElementById(`${prefix}CommentsTitle`);
        const listEl = document.getElementById(`${prefix}CommentsList`);
        if (!titleEl || !listEl || ghCommentUi[prefix].editingFloor !== null) {
            renderGhCommentsSection(prefix, rec);
            return;
        }
        const st = ghCommentUi[prefix];
        const prevInput = document.getElementById(`${prefix}CommentInput`);
        const draftText = preserveDraft && prevInput ? prevInput.value : '';
        const focused = preserveDraft && prevInput && document.activeElement === prevInput;
        renderGhCommentsSection(prefix, rec);
        if (draftText) {
            const nextInput = document.getElementById(`${prefix}CommentInput`);
            if (nextInput) {
                nextInput.value = draftText;
                if (focused) nextInput.focus();
            }
        }
        const btn = document.getElementById(`${prefix}CmtRefreshBtn`);
        if (btn) btn.classList.toggle('is-spinning', Boolean(st.refreshing));
    }

    function applyUpdatedComments(rec, rawServerComments, opts) {
        const preserveDraft = Boolean(opts && opts.preserveDraft);
        rec.comments = normalizeGhComments(rawServerComments);
        const totalFloors = rec.comments.length;
        document.querySelectorAll(`[data-gh-cmt-count]`).forEach(el => {
            if (el.getAttribute('data-gh-cmt-count') === rec.rowKey) {
                el.textContent = totalFloors > 0 ? ` · 💬 ${totalFloors}` : '';
            }
        });
        ['ghPane', 'ghSheet'].forEach(p => {
            if (ghCommentUi[p].rec === rec) updateCommentsListOnly(p, rec, preserveDraft);
        });
    }

    function refreshComments(prefix) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec) return;
        const rec = st.rec;
        const token = ++st.fetchToken;
        st.refreshing = true;
        const refreshBtn = document.getElementById(`${prefix}CmtRefreshBtn`);
        if (refreshBtn) refreshBtn.classList.add('is-spinning');

        callGasApi('groupHistory', 'getHistoryComments', {
            rowIndex: rec.rowIndex,
            rowKey: rec.rowKey
        }, res => {
            if (st.fetchToken !== token) return;
            st.refreshing = false;
            const btnNow = document.getElementById(`${prefix}CmtRefreshBtn`);
            if (btnNow) btnNow.classList.remove('is-spinning');
            if (!res || !res.success || !Array.isArray(res.comments)) return;
            if (res.rowIndex) rec.rowIndex = res.rowIndex;
            applyUpdatedComments(rec, res.comments, { preserveDraft: true });
        }, () => {
            if (st.fetchToken !== token) return;
            st.refreshing = false;
            const btnNow = document.getElementById(`${prefix}CmtRefreshBtn`);
            if (btnNow) btnNow.classList.remove('is-spinning');
        }, { preferGet: true });
    }

    function setReplyTarget(prefix, floor) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec) return;
        const target = (st.rec.comments || []).find(c => c.floor === floor && c.deleted !== 'Y');
        if (!target) return;
        st.replyTo = target.floor;
        st.replyToName = target.userName || '群友';
        st.editingFloor = null;
        renderGhCommentsSection(prefix, st.rec);
        const comp = document.getElementById(`${prefix}Composer`);
        const input = document.getElementById(`${prefix}CommentInput`);
        if (comp && comp.scrollIntoView) comp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (input) input.focus();
    }

    function clearReplyTarget(prefix) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec) return;
        st.replyTo = null;
        st.replyToName = '';
        renderGhCommentsSection(prefix, st.rec);
    }

    function scrollToCommentFloor(prefix, floor) {
        const container = document.getElementById(`${prefix}CommentsList`);
        if (!container) return;
        const targetEl = container.querySelector(`[data-comment-floor="${floor}"]`);
        if (!targetEl) return;
        if (targetEl.scrollIntoView) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        targetEl.classList.remove('is-comment-highlight');
        void targetEl.offsetWidth;
        targetEl.classList.add('is-comment-highlight');
        setTimeout(() => targetEl.classList.remove('is-comment-highlight'), 1300);
    }

    function submitComment(prefix) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec || st.busy) return;
        if (!Store.currentUserId) {
            if (window.PortalAuth && window.PortalAuth.showLoginGate) window.PortalAuth.showLoginGate();
            return;
        }
        const input = document.getElementById(`${prefix}CommentInput`);
        const btn = document.getElementById(`${prefix}CommentSubmit`);
        const text = input ? input.value.trim() : '';
        if (!text) {
            Swal.fire({ icon: 'warning', title: '請輸入留言內容', confirmButtonColor: '#3a6e59' });
            return;
        }

        const rec = st.rec;
        const replyTo = st.replyTo;
        st.busy = true;
        if (btn) { btn.disabled = true; btn.textContent = '送出中...'; }

        callGasApi('groupHistory', 'addHistoryComment', {
            rowIndex: rec.rowIndex,
            rowKey: rec.rowKey,
            userId: Store.currentUserId,
            content: text,
            replyTo: replyTo || ''
        }, res => {
            st.busy = false;
            if (!res || !res.success) {
                if (btn) { btn.disabled = false; btn.textContent = '送出留言'; }
                Swal.fire({ icon: 'error', title: '留言失敗', text: (res && res.error) || '發生未知錯誤', confirmButtonColor: '#3a6e59' });
                return;
            }
            if (res.rowIndex) rec.rowIndex = res.rowIndex;
            st.replyTo = null;
            st.replyToName = '';
            if (input) input.value = '';
            applyUpdatedComments(rec, res.comments, { preserveDraft: false });
            if (res.addedFloor) scrollToCommentFloor(prefix, res.addedFloor);
        }, err => {
            st.busy = false;
            if (btn) { btn.disabled = false; btn.textContent = '送出留言'; }
            Swal.fire({ icon: 'error', title: '系統錯誤', text: '送出留言失敗：' + err, confirmButtonColor: '#3a6e59' });
        });
    }

    function startEditComment(prefix, floor) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec) return;
        st.editingFloor = floor;
        renderGhCommentsSection(prefix, st.rec);
        const box = document.getElementById(`${prefix}EditInput_${floor}`);
        if (box) box.focus();
        handleEditInput(prefix, floor);
    }

    function handleEditInput(prefix, floor) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec) return;
        const box = document.getElementById(`${prefix}EditInput_${floor}`);
        const saveBtn = document.getElementById(`${prefix}SaveEditBtn_${floor}`);
        if (!box || !saveBtn) return;
        const orig = (st.rec.comments || []).find(c => c.floor === floor);
        const origTrim = String((orig && orig.content) || '').trim();
        const curTrim = box.value.trim();
        saveBtn.disabled = !curTrim || curTrim === origTrim;
    }

    function cancelEditComment(prefix) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec) return;
        st.editingFloor = null;
        renderGhCommentsSection(prefix, st.rec);
    }

    function saveEditComment(prefix, floor) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec || st.busy) return;
        const box = document.getElementById(`${prefix}EditInput_${floor}`);
        const text = box ? box.value.trim() : '';
        const orig = (st.rec.comments || []).find(c => c.floor === floor);
        const origTrim = String((orig && orig.content) || '').trim();
        if (!text || text === origTrim) return;

        const rec = st.rec;
        st.busy = true;
        Swal.fire({ title: '儲存中...', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
        callGasApi('groupHistory', 'editHistoryComment', {
            rowIndex: rec.rowIndex,
            rowKey: rec.rowKey,
            floor: floor,
            userId: Store.currentUserId,
            content: text
        }, res => {
            st.busy = false;
            if (!res || !res.success) {
                Swal.fire({ icon: 'error', title: '修改失敗', text: (res && res.error) || '發生未知錯誤', confirmButtonColor: '#3a6e59' });
                return;
            }
            Swal.close();
            if (res.rowIndex) rec.rowIndex = res.rowIndex;
            st.editingFloor = null;
            applyUpdatedComments(rec, res.comments, { preserveDraft: true });
        }, err => {
            st.busy = false;
            Swal.fire({ icon: 'error', title: '系統錯誤', text: '修改留言失敗：' + err, confirmButtonColor: '#3a6e59' });
        });
    }

    function deleteComment(prefix, floor) {
        const st = ghCommentUi[prefix];
        if (!st || !st.rec || st.busy) return;
        const rec = st.rec;
        Swal.fire({
            icon: 'warning',
            title: `確定要刪除留言嗎？`,
            showCancelButton: true,
            confirmButtonColor: '#c53030',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '確認刪除',
            cancelButtonText: '取消'
        }).then(result => {
            if (!result.isConfirmed) return;
            st.busy = true;
            callGasApi('groupHistory', 'deleteHistoryComment', {
                rowIndex: rec.rowIndex,
                rowKey: rec.rowKey,
                floor: floor,
                userId: Store.currentUserId
            }, res => {
                st.busy = false;
                if (!res || !res.success) {
                    Swal.fire({ icon: 'error', title: '刪除失敗', text: (res && res.error) || '發生未知錯誤', confirmButtonColor: '#3a6e59' });
                    return;
                }
                if (res.rowIndex) rec.rowIndex = res.rowIndex;
                if (st.replyTo === floor) { st.replyTo = null; st.replyToName = ''; }
                if (st.editingFloor === floor) st.editingFloor = null;
                applyUpdatedComments(rec, res.comments);
            }, err => {
                st.busy = false;
                Swal.fire({ icon: 'error', title: '系統錯誤', text: '刪除留言失敗：' + err, confirmButtonColor: '#3a6e59' });
            });
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
        const timeEl = document.getElementById(`${prefix}ActivityTime`);
        if (timeEl) {
            if (rec.displayTime.includes(' ~ ')) {
                const parts = rec.displayTime.split(' ~ ');
                timeEl.innerHTML = `<span class="time-seg">${escapeHtml(parts[0])}</span> <span class="time-seg">~ ${escapeHtml(parts.slice(1).join(' ~ '))}</span>`;
            } else {
                timeEl.textContent = rec.displayTime;
            }
        }

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

        renderGhAlbumSection(prefix, rec);
        renderGhCommentsSection(prefix, rec);
        refreshComments(prefix);
    }

    // =========================================================================
    // Phase 2：大事記活動相簿檢視（共用 PortalAlbumViewer）＋ 管理群階層綁定
    // =========================================================================
    const ghPickerState = {
        rec: null,
        stack: [], // [{ id, name }]
        currentFolderId: '',
        currentFolderName: '',
        currentHasMedia: false,
        folders: [],
        filterText: '',
        busy: false
    };

    function renderGhAlbumSection(prefix, rec) {
        const box = document.getElementById(`${prefix}AlbumBlock`);
        if (!box || !rec) return;
        const admin = isGhAdmin();
        const hasAlbum = Boolean(rec.albumFolderId);

        if (!hasAlbum && !admin) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.style.display = 'block';
        if (hasAlbum) {
            box.innerHTML = `
                <div class="gh-album-card">
                    <div class="gh-album-card__info">
                        <div class="gh-album-card__title">📷 活動聚會相簿</div>
                        <div class="gh-album-card__sub">支援全螢幕雙指縮放、單張下載與批次打包 ZIP</div>
                    </div>
                    <div class="gh-album-card__actions">
                        <button type="button" class="btn btn--primary btn--compact" onclick="PortalHistory.openRecAlbum('${prefix}')">🖼️ 檢視相簿</button>
                        ${admin ? `<button type="button" class="btn btn--secondary btn--compact" onclick="PortalHistory.openAlbumPicker('${prefix}')">✏️ 更換相簿</button>` : ''}
                    </div>
                </div>`;
        } else {
            box.innerHTML = `
                <div class="gh-album-card is-empty">
                    <div class="gh-album-card__info">
                        <div class="gh-album-card__title">📷 尚未綁定活動相簿</div>
                        <div class="gh-album-card__sub">僅管理群可見：可從總資料夾選擇或直貼 Google Drive 連結</div>
                    </div>
                    <div class="gh-album-card__actions">
                        <button type="button" class="btn btn--secondary btn--compact" onclick="PortalHistory.openAlbumPicker('${prefix}')">🔗 綁定相簿</button>
                    </div>
                </div>`;
        }
    }

    function openRecAlbum(prefix) {
        const st = ghCommentUi[prefix];
        const rec = st && st.rec;
        if (!rec || !rec.albumFolderId || !window.PortalAlbumViewer) return;
        window.PortalAlbumViewer.open(rec.albumFolderId, {
            name: rec.title,
            displayDate: rec.shortTime
        });
    }

    function openAlbumPicker(prefix) {
        if (!isGhAdmin()) return;
        const st = ghCommentUi[prefix];
        const rec = st && st.rec;
        if (!rec) return;

        ghPickerState.rec = rec;
        ghPickerState.stack = [];
        ghPickerState.currentFolderId = '';
        ghPickerState.currentFolderName = '';
        ghPickerState.folders = [];
        ghPickerState.filterText = '';
        ghPickerState.busy = false;

        const targetEl = document.getElementById('ghPickerTargetName');
        const urlIn = document.getElementById('ghPickerUrlInput');
        const filterIn = document.getElementById('ghPickerFilterInput');
        const unbindBtn = document.getElementById('ghPickerUnbindBtn');
        if (targetEl) targetEl.textContent = `目標活動：${rec.title}（${rec.shortTime}）`;
        if (urlIn) urlIn.value = rec.albumFolderId ? `https://drive.google.com/drive/folders/${rec.albumFolderId}?usp=drive_link` : '';
        if (filterIn) filterIn.value = '';
        if (unbindBtn) unbindBtn.style.display = rec.albumFolderId ? 'inline-flex' : 'none';

        const overlay = document.getElementById('ghAlbumPickerOverlay');
        if (overlay) overlay.classList.add('is-open');
        browseAlbumFolder('');
    }

    function closeAlbumPicker() {
        if (ghPickerState.busy) return;
        const overlay = document.getElementById('ghAlbumPickerOverlay');
        if (overlay) overlay.classList.remove('is-open');
    }

    function browseAlbumFolder() {
        const listEl = document.getElementById('ghPickerFolderList');
        if (listEl) listEl.innerHTML = '<div class="loading-inline" style="padding:18px;"><div class="spinner"></div><span>讀取相簿清單中...</span></div>';

        callGasApi('groupHistory', 'listAlbumFolders', {
            userId: (Store && Store.currentUserId) || ''
        }, res => {
            if (!res || res.success === false) {
                if (listEl) listEl.innerHTML = `<div style="padding:16px;color:var(--p-danger);font-size:0.86rem;">${escapeHtml((res && res.error) || '讀取相簿清單失敗')}</div>`;
                return;
            }
            ghPickerState.folders = Array.isArray(res.folders) ? res.folders : [];
            ghPickerState.filterText = '';
            const filterIn = document.getElementById('ghPickerFilterInput');
            if (filterIn) filterIn.value = '';
            renderPickerFolderList();
        }, err => {
            if (listEl) listEl.innerHTML = `<div style="padding:16px;color:var(--p-danger);font-size:0.86rem;">連線失敗：${escapeHtml(err)}</div>`;
        }, { preferGet: true });
    }

    function filterPickerFolders(text) {
        ghPickerState.filterText = String(text || '').trim().toLowerCase();
        renderPickerFolderList();
    }

    function renderPickerFolderList() {
        const listEl = document.getElementById('ghPickerFolderList');
        if (!listEl) return;
        const kw = ghPickerState.filterText;
        const list = kw ? ghPickerState.folders.filter(f => String(f.name || '').toLowerCase().includes(kw)) : ghPickerState.folders;

        if (!list.length) {
            listEl.innerHTML = `<div style="padding:18px;text-align:center;color:var(--p-muted);font-size:0.84rem;">${ghPickerState.folders.length ? '沒有符合關鍵字的相簿資料夾' : '總資料夾內目前沒有相簿資料夾'}</div>`;
            return;
        }

        listEl.innerHTML = list.map(f => `
            <div class="gh-folder-row">
                <div class="gh-folder-enter-btn" style="cursor:default;" title="${escapeHtml(f.name)}">
                    <span>📁</span>
                    <span>${escapeHtml(f.name)}</span>
                </div>
                <button type="button" class="btn btn--secondary btn--compact" onclick="PortalHistory.bindFolderId('${escapeHtml(f.id)}')">✅ 綁定</button>
            </div>
        `).join('');
    }

    function submitAlbumUrl() {
        const val = (document.getElementById('ghPickerUrlInput') || {}).value || '';
        if (!val.trim()) {
            Swal.fire({ icon: 'warning', title: '請貼上資料夾連結', text: '或從下方總資料夾清單點選欲綁定的資料夾。', confirmButtonColor: '#3a6e59' });
            return;
        }
        executeBindAlbum(val.trim());
    }

    function bindCurrentBrowsedFolder() {
        if (!ghPickerState.currentFolderId) return;
        executeBindAlbum(ghPickerState.currentFolderId);
    }

    function bindFolderId(folderId) {
        if (!folderId) return;
        executeBindAlbum(folderId);
    }

    function unbindCurrentAlbum() {
        Swal.fire({
            icon: 'warning',
            title: '確定解除綁定相簿？',
            text: '僅清除大事記與此資料夾的連結，不會刪除 Google Drive 內的任何照片。',
            showCancelButton: true,
            confirmButtonText: '確定解除',
            cancelButtonText: '取消',
            confirmButtonColor: '#dc2626'
        }).then(r => {
            if (r.isConfirmed) executeBindAlbum('');
        });
    }

    function executeBindAlbum(folderInput) {
        if (ghPickerState.busy || !ghPickerState.rec) return;
        const rec = ghPickerState.rec;
        ghPickerState.busy = true;
        const btn = document.getElementById('ghPickerUrlBindBtn');
        if (btn) btn.disabled = true;

        callGasApi('groupHistory', 'bindHistoryAlbum', {
            userId: (Store && Store.currentUserId) || '',
            rowIndex: rec.rowIndex,
            rowKey: rec.rowKey,
            folderInput: folderInput
        }, res => {
            ghPickerState.busy = false;
            if (btn) btn.disabled = false;
            if (!res || res.success === false) {
                Swal.fire({ icon: 'error', title: '綁定失敗', text: (res && res.error) || '請稍後再試', confirmButtonColor: '#3a6e59' });
                return;
            }
            if (res.rowIndex) rec.rowIndex = res.rowIndex;
            rec.albumFolderId = res.albumFolderId || '';

            document.querySelectorAll('[data-gh-album-badge]').forEach(el => {
                if (el.getAttribute('data-gh-album-badge') === rec.rowKey) {
                    el.textContent = rec.albumFolderId ? ' · 📷 相簿' : '';
                }
            });
            ['ghPane', 'ghSheet'].forEach(p => {
                if (ghCommentUi[p].rec === rec) renderGhAlbumSection(p, rec);
            });

            closeAlbumPicker();
            if (ghState.status === 'hasAlbum' && !rec.albumFolderId) {
                applyGhFilters();
            }
            Swal.fire({
                icon: 'success',
                title: rec.albumFolderId ? '相簿綁定成功' : '已解除相簿綁定',
                text: rec.albumFolderId ? `已連結：${res.folderName || rec.albumFolderId}` : '',
                timer: 1800,
                showConfirmButton: false
            });
        }, err => {
            ghPickerState.busy = false;
            if (btn) btn.disabled = false;
            Swal.fire({ icon: 'error', title: '系統錯誤', text: String(err), confirmButtonColor: '#3a6e59' });
        });
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
        const ghBody = document.getElementById('ghSheetBody');
        if (ghBody) ghBody.scrollTop = 0;
        if (window.PortalApi && window.PortalApi.syncDetailDrawerOffset) {
            window.PortalApi.syncDetailDrawerOffset('ghSheetPanel');
        }
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
        setReplyTarget,
        clearReplyTarget,
        scrollToCommentFloor,
        refreshComments,
        submitComment,
        startEditComment,
        handleEditInput,
        cancelEditComment,
        saveEditComment,
        deleteComment,
        openRecAlbum,
        openAlbumPicker,
        closeAlbumPicker,
        browseAlbumFolder,
        filterPickerFolders,
        submitAlbumUrl,
        bindCurrentBrowsedFolder,
        bindFolderId,
        unbindCurrentAlbum,
        setLhViewMode,
        renderNextLhBatch
    };
})();

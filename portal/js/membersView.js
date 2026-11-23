/**
 * L>S Portal — 群友名單視圖 (第二重要分頁)
 */
window.PortalMembers = (function() {
    const { Store, callGasApi, escapeHtml, updateNavSummary } = window.PortalApi;

    const RANK_MODES = {
        active: { field: 'monthMsg', unit: '則', prefix: '本月', header: '本月活躍 {c} 位（依本月發言數排序）', ties: ['dailyMsg', 'yearMsg'] },
        unsend: { field: 'unsendCount', unit: '則', prefix: '收回', header: '收回排行 {c} 位（依收回訊息數排序）', ties: ['yearMsg', 'textCount'] },
        host:   { field: 'hostCount', unit: '次', prefix: '主揪', header: '揪團排行 {c} 位（依主辦揪團次數排序）', ties: ['joinCount', 'yearMsg'] },
        join:   { field: 'joinCount', unit: '次', prefix: '參團', header: '參團排行 {c} 位（依參加揪團次數排序）', ties: ['hostCount', 'yearMsg'] },
        msg:    { field: 'textCount', unit: '則', prefix: '發言', header: '發言排行 {c} 位（依總發言數排序）', ties: ['monthMsg', 'yearMsg'] }
    };

    let quickFilter = 'all';
    let eventsBound = false;

    function init() {
        bindEvents();
        loadDirectory(false);
    }

    function bindEvents() {
        if (eventsBound) return;
        eventsBound = true;

        const searchInput = document.getElementById('memberSearchInput');
        const clearBtn = document.getElementById('clearMemberSearchBtn');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                if (clearBtn) clearBtn.classList.toggle('visible', searchInput.value.length > 0);
                renderGrid();
            });
        }
    }

    function loadDirectory(silent) {
        const loadingEl = document.getElementById('membersLoading');
        if (!silent && loadingEl && !Store.membersLoaded) {
            loadingEl.style.display = 'flex';
        }

        const requestUid = Store.currentUserId ? String(Store.currentUserId).trim() : '';
        if (window.PortalAuth) window.PortalAuth.setLoadedDirectoryUid(requestUid);

        callGasApi('members', 'getMembers', requestUid ? { userId: requestUid } : {}, res => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (!res || !res.success || !Array.isArray(res.members)) {
                if (!silent) {
                    document.getElementById('memberDirectoryGrid').innerHTML =
                        '<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-title">暫無群友資料</div></div>';
                }
                return;
            }

            Store.isAdmin = Boolean(res.isAdmin);
            Store.members = res.members;
            Store.membersLoaded = true;
            if (res.titleConfig) Store.titleConfig = res.titleConfig;

            if (window.PortalAuth) window.PortalAuth.syncDisplayNameFromMembers();
            updateNavSummary();
            renderSelfHeaderAction();
            renderGrid();
            window.PortalProfile.refreshSelectedMember();
        }, err => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (!silent) {
                document.getElementById('memberDirectoryGrid').innerHTML =
                    `<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-title">載入名冊失敗</div><div class="empty-desc">${escapeHtml(err)}</div><button type="button" class="btn btn--primary" onclick="PortalMembers.loadDirectory(false)">重新載入</button></div>`;
            }
        }, { preferGet: true });
    }

    function renderSelfHeaderAction() {
        const wrap = document.getElementById('membersHeaderSelfAction');
        if (!wrap) return;
        if (Store.currentUserId) {
            wrap.innerHTML = `<button type="button" class="btn btn--secondary btn--compact" onclick="PortalProfile.openByUserId('${escapeHtml(Store.currentUserId)}')">👤 我的數位名片</button>`;
        } else {
            wrap.innerHTML = `<button type="button" class="btn btn--primary btn--compact" onclick="PortalAuth.triggerLogin()">🔑 登入編輯我的名片</button>`;
        }
    }

    function setQuickFilter(key) {
        quickFilter = key || 'all';
        document.querySelectorAll('#memberQuickFilters [data-mfilter]').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.mfilter === quickFilter);
        });
        if (window.PortalApp) window.PortalApp.syncTabIndicator('#memberQuickFilters', '.filter-tab.is-active');
        renderGrid();
    }

    function clearSearch() {
        const input = document.getElementById('memberSearchInput');
        const clearBtn = document.getElementById('clearMemberSearchBtn');
        if (input) { input.value = ''; input.focus(); }
        if (clearBtn) clearBtn.classList.remove('visible');
        renderGrid();
    }

    function getFilteredList() {
        const input = document.getElementById('memberSearchInput');
        const q = input ? input.value.trim().toLowerCase() : '';
        const rankCfg = RANK_MODES[quickFilter];

        let list = Store.members.filter(m => {
            if (quickFilter === 'birthday') {
                const hasBdayBadge = Array.isArray(m.badges) && m.badges.some(b => b.includes('壽星'));
                if (!hasBdayBadge) return false;
            } else if (rankCfg) {
                if ((Number(m[rankCfg.field]) || 0) <= 0) return false;
            }

            if (!q) return true;
            return (m.name && m.name.toLowerCase().includes(q)) ||
                (m.residence && m.residence.toLowerCase().includes(q)) ||
                (m.occupation && m.occupation.toLowerCase().includes(q)) ||
                (m.zodiac && m.zodiac.toLowerCase().includes(q)) ||
                (Array.isArray(m.badges) && m.badges.some(b => b.toLowerCase().includes(q)));
        });

        if (rankCfg) {
            list = list.slice().sort((a, b) => {
                const primary = (Number(b[rankCfg.field]) || 0) - (Number(a[rankCfg.field]) || 0);
                if (primary !== 0) return primary;
                for (let i = 0; i < rankCfg.ties.length; i++) {
                    const k = rankCfg.ties[i];
                    const d = (Number(b[k]) || 0) - (Number(a[k]) || 0);
                    if (d !== 0) return d;
                }
                return 0;
            });
        }

        return list;
    }

    function renderGrid() {
        const grid = document.getElementById('memberDirectoryGrid');
        const pill = document.getElementById('membersCountPill');
        if (!grid) return;

        const list = getFilteredList();
        const rankCfg = RANK_MODES[quickFilter];
        if (pill) {
            if (rankCfg) {
                pill.textContent = rankCfg.header.replace('{c}', list.length);
            } else {
                pill.textContent = (list.length === Store.members.length)
                    ? `共 ${Store.members.length} 位群友`
                    : `符合 ${list.length} / ${Store.members.length} 位`;
            }
        }

        if (!list.length) {
            grid.innerHTML = '<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">🔍</div><div class="empty-title">查無符合條件的群友</div><div class="empty-desc">試著調整搜尋關鍵字或分類標籤</div></div>';
            return;
        }

        const uidLower = Store.currentUserId ? Store.currentUserId.toLowerCase() : '';
        let html = '';
        list.forEach((m, idx) => {
            const isMe = uidLower && m.id && String(m.id).trim().toLowerCase() === uidLower;
            const primaryBadge = (Array.isArray(m.badges) && m.badges.length > 0) ? m.badges[0] : '';
            const res = (m.residence && m.residence !== '未填寫') ? m.residence : '';
            const occ = (m.occupation && m.occupation !== '未填寫') ? m.occupation : '';
            let meta = '';
            if (res && occ) meta = `📍 ${escapeHtml(res)} · 💼 ${escapeHtml(occ)}`;
            else if (res) meta = `📍 ${escapeHtml(res)}`;
            else if (occ) meta = `💼 ${escapeHtml(occ)}`;
            else meta = escapeHtml(m.zodiac || '秘密 🤫');

            const rankPillHtml = rankCfg
                ? `<div class="dir-active-pill mono">#${idx + 1} · ${rankCfg.prefix} ${(Number(m[rankCfg.field]) || 0).toLocaleString('en-US')} ${rankCfg.unit}</div>`
                : '';

            const safeId = escapeHtml(m.id);
            html += `
                <article class="member-dir-card ${isMe ? 'is-me-card' : ''}" data-member-id="${safeId.toLowerCase()}" onclick="PortalProfile.openByUserId('${safeId}', this)">
                    <div class="dir-avatar-wrap">
                        <img src="${escapeHtml(m.pic || 'https://imgur.com/786FxAA.jpg')}" alt="${escapeHtml(m.name)}" loading="lazy" onerror="this.src='https://imgur.com/786FxAA.jpg'">
                        ${isMe ? '<span class="my-self-badge">我</span>' : ''}
                    </div>
                    <div class="dir-name">${escapeHtml(m.name)}</div>
                    ${rankPillHtml}
                    ${primaryBadge ? `<div class="dir-badge">${escapeHtml(primaryBadge)}</div>` : ''}
                    <div class="dir-meta">${meta}</div>
                </article>
            `;
        });
        grid.innerHTML = html;
    }

    return {
        init,
        loadDirectory,
        setQuickFilter,
        clearSearch,
        renderGrid,
        renderSelfHeaderAction
    };
})();

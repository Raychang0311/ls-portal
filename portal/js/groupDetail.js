/**
 * L>S Portal — 揪團完整詳情抽屜、Leaflet 地圖、報名/改備註/退出、主揪編輯與結束揪團
 */
window.PortalGroupDetail = (function() {
    const { Store, callGasApi, escapeHtml, replaceLinks, openExternalUrl } = window.PortalApi;

    let currentGroup = null;
    let targetMapUrl = '';
    let leafletMap = null;
    let isDetailLoading = false;
    let activeOpenToken = 0;

    function setDetailLoading(loading) {
        isDetailLoading = Boolean(loading);
        const overlay = document.getElementById('gdLoadingOverlay');
        const panel = document.querySelector('#groupDetailOverlay .drawer-panel');
        const closeBtn = document.getElementById('gdCloseBtn');
        if (overlay) overlay.hidden = !isDetailLoading;
        if (panel) panel.setAttribute('aria-busy', isDetailLoading ? 'true' : 'false');
        if (closeBtn) closeBtn.disabled = isDetailLoading;
    }

    function handleOverlayClick(event) {
        if (isDetailLoading) return;
        if (event && event.target === document.getElementById('groupDetailOverlay')) {
            close();
        }
    }

    function open(seqId) {
        if (!seqId) return;
        const overlay = document.getElementById('groupDetailOverlay');
        if (!overlay) return;

        const token = ++activeOpenToken;
        const cached = Store.groups.find(g => String(g.seqId) === String(seqId));
        if (cached) {
            renderGroup(cached);
        } else {
            currentGroup = { seqId: String(seqId) };
            document.getElementById('gdSeqBadge').textContent = '#' + seqId;
            document.getElementById('gdDate').textContent = '';
            document.getElementById('gdTitle').textContent = '載入揪團資訊中...';
            document.getElementById('gdContent').textContent = '';
            document.getElementById('gdJoinedList').innerHTML = '';
        }

        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        setDetailLoading(true);
        fetchSingleGroup(seqId, false, token);
    }

    function fetchSingleGroup(seqId, silent, token) {
        callGasApi('group', 'getGroup', { seqId: seqId }, res => {
            if (token && token !== activeOpenToken) return;
            setDetailLoading(false);
            if (!res || res.success === false) {
                if (!silent) {
                    close();
                    Swal.fire('提示', (res && res.error) || '找不到該揪團資訊或已結束', 'info');
                }
                return;
            }

            const normalized = Object.assign({ seqId: String(seqId) }, res);
            const idx = Store.groups.findIndex(g => String(g.seqId) === String(seqId));
            if (idx !== -1) {
                Store.groups[idx] = Object.assign({}, Store.groups[idx], normalized);
            }

            if (!Store.membersLoaded && Array.isArray(res.members) && res.members.length > 0) {
                Store.members = res.members;
            }
            if (res.titleConfig && !Store.titleConfig) {
                Store.titleConfig = res.titleConfig;
            }

            if (!silent || (currentGroup && String(currentGroup.seqId) === String(seqId))) {
                renderGroup(normalized);
                const overlay = document.getElementById('groupDetailOverlay');
                if (overlay && !overlay.classList.contains('is-open')) {
                    overlay.classList.add('is-open');
                    document.body.style.overflow = 'hidden';
                }
                setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 220);
            }
        }, err => {
            if (token && token !== activeOpenToken) return;
            setDetailLoading(false);
            if (!silent) {
                close();
                Swal.fire('錯誤', '載入揪團詳情失敗：' + err, 'error');
            }
        });
    }

    function close() {
        if (isDetailLoading) return;
        const overlay = document.getElementById('groupDetailOverlay');
        if (!overlay) return;
        overlay.classList.remove('is-open');
        document.body.style.overflow = '';
        if (leafletMap) {
            leafletMap.remove();
            leafletMap = null;
        }
        currentGroup = null;
    }

    function renderGroup(g) {
        currentGroup = g;

        document.getElementById('gdSeqBadge').textContent = '#' + (g.seqId || '');
        document.getElementById('gdDate').textContent = window.PortalApi.formatSmartDateRange(g.startDate, g.endDate, g.date);
        document.getElementById('gdTitle').textContent = g.title || '揪團活動';
        document.getElementById('gdContent').innerHTML = replaceLinks(g.content || '');

        const hostRow = document.getElementById('gdHostRow');
        const hostMember = window.PortalApi.findMemberById(g.hostId);
        const hostPic = (hostMember && hostMember.pic) || g.hostPic || 'https://imgur.com/786FxAA.jpg';
        const hostName = (hostMember && hostMember.name) || g.hostName || '主揪';
        if (hostRow) {
            hostRow.innerHTML = `<img src="${escapeHtml(hostPic)}" alt="${escapeHtml(hostName)}" onerror="this.src='https://imgur.com/786FxAA.jpg'"><span>主揪：<strong>${escapeHtml(hostName)}</strong></span>`;
            hostRow.onclick = () => { if (g.hostId) window.PortalProfile.openByUserId(g.hostId, hostRow); };
        }

        // 狀態徽章
        const maxL = parseInt(g.maxLimit, 10) || 99;
        const joined = Array.isArray(g.joinedList) ? g.joinedList : [];
        const isFull = maxL !== 99 && joined.length >= maxL;
        const statusEl = document.getElementById('gdStatusBadge');
        if (statusEl) {
            statusEl.textContent = isFull ? '已額滿' : '開放報名';
            statusEl.className = 'status-pill ' + (isFull ? 'is-early' : 'is-done');
        }

        // 地點與 Leaflet 地圖
        const locCard = document.getElementById('gdLocationCard');
        const locName = g.locationName || '';
        const locUrl = g.locationUrl || '';
        const locAddr = g.locationAddress || '';
        if (locName || locAddr || locUrl) {
            const displayTitle = locName || locAddr || '活動地點';
            document.getElementById('gdLocName').textContent = displayTitle;
            const addrEl = document.getElementById('gdLocAddr');
            if (locAddr && locAddr !== displayTitle) {
                addrEl.textContent = locAddr;
                addrEl.style.display = 'block';
            } else {
                addrEl.textContent = '';
                addrEl.style.display = 'none';
            }
            targetMapUrl = g.locationResolvedUrl || locUrl || ('https://maps.google.com/?q=' + encodeURIComponent(locAddr || displayTitle));
            document.getElementById('gdLocMapLink').href = targetMapUrl;
            locCard.style.display = 'block';

            if (g.locationLat && g.locationLng) {
                renderMapPreview(g.locationLat, g.locationLng);
            } else {
                initLocationMap(locName, locUrl, locAddr);
            }
        } else {
            locCard.style.display = 'none';
        }

        // 雙日曆按鈕
        const gcalBtn = document.getElementById('gdGoogleCalBtn');
        if (g.googleCalendarUrl) {
            gcalBtn.href = g.googleCalendarUrl;
            gcalBtn.dataset.url = g.googleCalendarUrl;
            gcalBtn.classList.remove('disabled');
        } else {
            gcalBtn.href = '#';
            gcalBtn.dataset.url = '';
            gcalBtn.classList.add('disabled');
        }

        const icalBtn = document.getElementById('gdIcalBtn');
        if (g.eventUrl) {
            icalBtn.href = g.eventUrl;
            icalBtn.dataset.url = g.eventUrl;
            icalBtn.classList.remove('disabled');
        } else {
            icalBtn.href = '#';
            icalBtn.dataset.url = '';
            icalBtn.classList.add('disabled');
        }

        renderJoinedMembers();
        refreshUserActions();

        const scrollBody = document.getElementById('gdBodyScroll');
        if (scrollBody) scrollBody.scrollTop = 0;
    }

    function buildMemberGridHtml(list, isWaitlist) {
        const uidLower = Store.currentUserId ? Store.currentUserId.toLowerCase() : '';
        let html = '';
        list.forEach((m, idx) => {
            const isMe = uidLower && m.id && String(m.id).toLowerCase() === uidLower;
            const noteText = (m.note || '').trim();
            const safePic = escapeHtml(m.pic || 'https://imgur.com/786FxAA.jpg');
            const safeId = escapeHtml(m.id || '');
            const orderTag = isWaitlist ? `<span class="gd-wait-order mono">#${idx + 1}</span>` : '';
            const noteBtnClick = isWaitlist
                ? `PortalGroupDetail.openWaitlistNoteHistoryByIndex(${idx})`
                : `PortalGroupDetail.openNoteHistoryByIndex(${idx})`;
            html += `
                <div class="gd-member-item ${isWaitlist ? 'is-waitlist' : ''}">
                    ${orderTag}
                    <div class="gd-member-avatar-wrap" data-member-id="${safeId.toLowerCase()}" onclick="PortalProfile.openByUserId('${safeId}', this)" title="點擊查看數位名片">
                        <img src="${safePic}" alt="${escapeHtml(m.name)}" loading="lazy" onerror="this.src='https://imgur.com/786FxAA.jpg'">
                        ${isMe ? '<span class="my-self-badge">我</span>' : ''}
                    </div>
                    <div class="gd-member-name">${escapeHtml(m.name)}</div>
                    ${noteText ? `<button type="button" class="gd-member-note" onclick="${noteBtnClick}">${escapeHtml(noteText)}</button>` : ''}
                </div>
            `;
        });
        return html;
    }

    function renderJoinedMembers() {
        if (!currentGroup) return;
        const container = document.getElementById('gdJoinedList');
        const list = Array.isArray(currentGroup.joinedList) ? currentGroup.joinedList : [];
        const waitlist = Array.isArray(currentGroup.waitlist) ? currentGroup.waitlist : [];
        const maxL = parseInt(currentGroup.maxLimit, 10) || 99;
        document.getElementById('gdCountDisplay').textContent = `${list.length} / ${maxL === 99 ? '不限' : maxL}`;

        if (list.length === 0) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--p-muted);padding:20px 0;">尚無人報名</div>';
        } else {
            container.innerHTML = buildMemberGridHtml(list, false);
        }

        const waitSection = document.getElementById('gdWaitlistSection');
        const waitContainer = document.getElementById('gdWaitlistList');
        const waitCountEl = document.getElementById('gdWaitlistCountDisplay');
        if (waitSection && waitContainer) {
            if (waitlist.length > 0) {
                waitSection.style.display = 'block';
                if (waitCountEl) waitCountEl.textContent = `${waitlist.length} 人`;
                waitContainer.innerHTML = buildMemberGridHtml(waitlist, true);
            } else {
                waitSection.style.display = 'none';
                waitContainer.innerHTML = '';
            }
        }
    }

    function refreshUserActions() {
        if (!currentGroup) return;
        const authTag = document.getElementById('gdAuthTag');
        const guestBox = document.getElementById('gdGuestNotice');
        const memberArea = document.getElementById('gdMemberActions');
        const hostBox = document.getElementById('gdHostControls');
        const btnRow = document.getElementById('gdActionBtnRow');
        const noteInput = document.getElementById('gdActionNote');

        if (!Store.currentUserId) {
            if (authTag) { authTag.textContent = '訪客模式'; authTag.classList.remove('is-ok'); }
            if (guestBox) guestBox.style.display = 'flex';
            if (memberArea) memberArea.style.display = 'none';
            return;
        }

        if (authTag) {
            authTag.textContent = '👤 ' + (Store.currentDisplayName || '已登入');
            authTag.classList.add('is-ok');
        }
        if (guestBox) guestBox.style.display = 'none';
        if (memberArea) memberArea.style.display = 'block';

        const uidLower = Store.currentUserId.toLowerCase();
        const isHost = Boolean(currentGroup.hostId && String(currentGroup.hostId).trim().toLowerCase() === uidLower);
        if (hostBox) hostBox.style.display = isHost ? 'flex' : 'none';

        const joined = Array.isArray(currentGroup.joinedList) ? currentGroup.joinedList : [];
        const waitlist = Array.isArray(currentGroup.waitlist) ? currentGroup.waitlist : [];
        const existing = joined.find(m => String(m.id).toLowerCase() === uidLower);
        const waitIdx = waitlist.findIndex(m => String(m.id).toLowerCase() === uidLower);
        const maxL = parseInt(currentGroup.maxLimit, 10) || 99;
        const isFull = maxL !== 99 && joined.length >= maxL;

        if (existing) {
            if (noteInput) noteInput.value = existing.note || '';
            btnRow.innerHTML = `
                <button type="button" class="btn btn--primary" onclick="PortalGroupDetail.handleUpdateNote()">✏️ 更新備註</button>
                <button type="button" class="btn btn--danger" onclick="PortalGroupDetail.handleLeaveGroup()">🚪 退出揪團</button>
            `;
        } else if (waitIdx !== -1) {
            const waitMember = waitlist[waitIdx];
            if (noteInput) noteInput.value = waitMember.note || '';
            btnRow.innerHTML = `
                <div class="gd-waitlist-status-banner" style="width:100%;">⏳ 您目前在候補名單中（順位第 ${waitIdx + 1} 位），釋出名額將自動遞補通知</div>
                <button type="button" class="btn btn--primary" onclick="PortalGroupDetail.handleUpdateNote()">✏️ 更新備註</button>
                <button type="button" class="btn btn--danger" onclick="PortalGroupDetail.handleLeaveGroup()">🚪 退出揪團</button>
            `;
        } else {
            if (noteInput) noteInput.value = '';
            if (isFull) {
                btnRow.innerHTML = `<button type="button" class="btn btn--secondary" onclick="PortalGroupDetail.handleJoinGroup()">⏳ 已額滿 (${joined.length}/${maxL}) · 登記候補</button>`;
            } else {
                btnRow.innerHTML = `<button type="button" class="btn btn--primary" onclick="PortalGroupDetail.handleJoinGroup()">🙋‍♂️ 立即報名</button>`;
            }
        }
    }

    function syncLocalGroupMembership(seqId, mode, waitlisted, noteText, waitlistPos) {
        const uid = String(Store.currentUserId || '').trim();
        if (!uid) return;
        const uidLower = uid.toLowerCase();
        const myEntry = {
            id: uid,
            name: Store.currentDisplayName || '我',
            pic: Store.currentUserPic || 'https://imgur.com/786FxAA.jpg',
            note: noteText || '',
            noteTime: '剛剛'
        };

        const applyToTarget = target => {
            if (!target) return;
            const joined = Array.isArray(target.joinedList) ? target.joinedList.slice() : [];
            const waitlist = Array.isArray(target.waitlist) ? target.waitlist.slice() : [];

            if (mode === 'join') {
                if (waitlisted) {
                    const filteredWait = waitlist.filter(m => String(m.id).toLowerCase() !== uidLower);
                    filteredWait.push(Object.assign({}, myEntry, { waitlistPos: waitlistPos || (filteredWait.length + 1) }));
                    target.waitlist = filteredWait.map((m, i) => Object.assign({}, m, { waitlistPos: i + 1 }));
                    target.waitlistCount = target.waitlist.length;
                } else {
                    const filteredJoined = joined.filter(m => String(m.id).toLowerCase() !== uidLower);
                    filteredJoined.push(myEntry);
                    target.joinedList = filteredJoined;
                    target.currentCount = filteredJoined.length;
                }
            } else if (mode === 'leave') {
                target.joinedList = joined.filter(m => String(m.id).toLowerCase() !== uidLower);
                target.waitlist = waitlist.filter(m => String(m.id).toLowerCase() !== uidLower)
                    .map((m, i) => Object.assign({}, m, { waitlistPos: i + 1 }));
                target.currentCount = target.joinedList.length;
                target.waitlistCount = target.waitlist.length;
            }
        };

        if (currentGroup && String(currentGroup.seqId) === String(seqId)) {
            applyToTarget(currentGroup);
            renderGroup(currentGroup);
        }
        const cached = Store.groups.find(g => String(g.seqId) === String(seqId));
        if (cached) applyToTarget(cached);
        if (window.PortalJukebox && window.PortalJukebox.rerenderCurrent) {
            window.PortalJukebox.rerenderCurrent(seqId);
        }
    }

    function reloadGroupAfterPrompt(seqId) {
        if (currentGroup && String(currentGroup.seqId) === String(seqId)) {
            setDetailLoading(true);
            fetchSingleGroup(seqId, false, ++activeOpenToken);
        }
        if (window.PortalJukebox && window.PortalJukebox.refresh) {
            window.PortalJukebox.refresh(true, seqId);
        }
    }

    function handleJoinGroup() {
        if (!currentGroup || !Store.currentUserId) return;
        const seqId = currentGroup.seqId;
        const noteText = (document.getElementById('gdActionNote').value || '').trim();
        const joined = Array.isArray(currentGroup.joinedList) ? currentGroup.joinedList : [];
        const maxL = parseInt(currentGroup.maxLimit, 10) || 99;
        const isFull = maxL !== 99 && joined.length >= maxL;

        Swal.fire({
            title: isFull ? '確認登記候補' : '確認報名',
            text: isFull
                ? (noteText ? `目前人數已滿，將加入候補名單（備註：${noteText}）` : '目前人數已滿，確定要加入候補名單嗎？有空缺將依序自動遞補並標註通知。')
                : (noteText ? `備註：${noteText}` : '確定要參加這個揪團活動嗎？'),
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#3a6e59',
            cancelButtonColor: '#6b7280',
            confirmButtonText: isFull ? '確定登記候補' : '確定參加',
            cancelButtonText: '取消'
        }).then(result => {
            if (!result.isConfirmed) return;
            Swal.fire({ title: isFull ? '登記候補中...' : '報名處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            callGasApi('group', 'joinGroup', { seqId: seqId, userId: Store.currentUserId, noteText: noteText }, res => {
                if (res && res.success) {
                    syncLocalGroupMembership(seqId, 'join', Boolean(res.waitlisted), noteText, res.waitlistPos);
                    const alertOpts = res.waitlisted
                        ? {
                            title: '已加入候補名單！',
                            text: `您的候補順位為第 ${res.waitlistPos || 1} 位 ⏳`,
                            icon: 'success',
                            confirmButtonColor: '#3a6e59'
                        }
                        : {
                            title: '報名成功！',
                            text: '您已成功加入本活動名單 🎉',
                            icon: 'success',
                            confirmButtonColor: '#3a6e59'
                        };
                    Swal.fire(alertOpts).then(() => reloadGroupAfterPrompt(seqId));
                } else {
                    Swal.fire({ title: '報名失敗', text: (res && res.error) || '發生未知錯誤', icon: 'error', confirmButtonColor: '#3a6e59' });
                }
            }, err => Swal.fire({ title: '系統錯誤', text: '報名失敗：' + err, icon: 'error', confirmButtonColor: '#3a6e59' }));
        });
    }

    function handleUpdateNote() {
        if (!currentGroup || !Store.currentUserId) return;
        const seqId = currentGroup.seqId;
        const noteText = (document.getElementById('gdActionNote').value || '').trim();

        Swal.fire({ title: '更新備註中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        callGasApi('group', 'updateNote', { seqId: seqId, userId: Store.currentUserId, noteText: noteText }, res => {
            if (res && res.success) {
                Swal.fire({ title: '更新成功！', text: '您的備註已儲存', icon: 'success', confirmButtonColor: '#3a6e59' })
                    .then(() => reloadGroupAfterPrompt(seqId));
            } else {
                Swal.fire({ title: '更新失敗', text: (res && res.error) || '發生未知錯誤', icon: 'error', confirmButtonColor: '#3a6e59' });
            }
        }, err => Swal.fire({ title: '系統錯誤', text: '更新備註失敗：' + err, icon: 'error', confirmButtonColor: '#3a6e59' }));
    }

    function handleLeaveGroup() {
        if (!currentGroup || !Store.currentUserId) return;
        const seqId = currentGroup.seqId;
        const uidLower = Store.currentUserId.toLowerCase();
        const waitlist = Array.isArray(currentGroup.waitlist) ? currentGroup.waitlist : [];
        const isWaitlisted = waitlist.some(m => String(m.id).toLowerCase() === uidLower);

        Swal.fire({
            title: isWaitlisted ? '確定要退出候補嗎？' : '確定要退出揪團嗎？',
            text: isWaitlisted ? '退出後將取消您的候補順位' : '退出後您的名額將釋出（若有候補名單將自動依序遞補）',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#c53030',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '確認退出',
            cancelButtonText: '取消'
        }).then(result => {
            if (!result.isConfirmed) return;
            Swal.fire({ title: '退出處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            callGasApi('group', 'leaveGroup', { seqId: seqId, userId: Store.currentUserId }, res => {
                if (res && res.success) {
                    syncLocalGroupMembership(seqId, 'leave', false, '', 0);
                    Swal.fire({
                        title: '已退出',
                        text: res.leftType === 'waitlist' ? '您已退出本活動候補名單' : '您已退出本揪團活動',
                        icon: 'info',
                        confirmButtonColor: '#3a6e59'
                    }).then(() => reloadGroupAfterPrompt(seqId));
                } else {
                    Swal.fire({ title: '退出失敗', text: (res && res.error) || '發生未知錯誤', icon: 'error', confirmButtonColor: '#3a6e59' });
                }
            }, err => Swal.fire({ title: '系統錯誤', text: '退出失敗：' + err, icon: 'error', confirmButtonColor: '#3a6e59' }));
        });
    }

    function handleEditGroup() {
        if (!currentGroup) return;
        const seqId = currentGroup.seqId;
        close();
        window.PortalGroupForm.openEdit(seqId);
    }

    function handleCloseGroup() {
        if (!currentGroup || !Store.currentUserId) return;
        const seqId = currentGroup.seqId;
        const title = currentGroup.title || '此揪團';

        Swal.fire({
            icon: 'warning',
            title: `確定要結束「${escapeHtml(title)}」嗎？`,
            html: '<div style="text-align:left;font-size:0.92rem;line-height:1.6;color:#52635c;">結束揪團後將會：<br>1. 刪除活動的 <code>.ics</code> 日曆檔<br>2. 將本活動歸檔至「揪團大事記」<br>3. 從進行中揪團清單移除（此動作無法復原）</div>',
            showCancelButton: true,
            reverseButtons: true,
            confirmButtonColor: '#c53030',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '確認結束揪團',
            cancelButtonText: '取消'
        }).then(result => {
            if (!result.isConfirmed) return;
            Swal.fire({ title: '正在歸檔並結束揪團...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            callGasApi('group', 'closeGroup', { seqId: seqId, userId: Store.currentUserId }, res => {
                if (res && res.success) {
                    // 清除大事記快取，使切換至「揪團大事記」時可即時看到剛歸檔的活動
                    Store.groupHistoryLoaded = false;
                    Store.groupHistory = [];
                    Store.groups = Store.groups.filter(g => String(g.seqId) !== String(seqId));
                    close();
                    window.PortalJukebox.refresh(true);
                    Swal.fire('已結束揪團', `活動已歸檔為「${escapeHtml(res.endType || '已結束')}」`, 'success');
                } else {
                    Swal.fire('結束失敗', (res && res.error) || '發生未知錯誤', 'error');
                }
            }, err => Swal.fire('系統錯誤', '結束揪團失敗：' + err, 'error'));
        });
    }

    function initLocationMap(name, url, address) {
        if (!window.L) return;
        const coordMatch = (url || '').match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
            (url || '').match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
            (url || '').match(/[?&](?:query|q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
            (url || '').match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);

        if (coordMatch) {
            renderMapPreview(parseFloat(coordMatch[1]), parseFloat(coordMatch[2]));
            return;
        }

        if (url || address || name) {
            callGasApi('group', 'resolveLocation', { url: url, name: name, address: address }, coords => {
                if (coords && coords.lat && coords.lng) {
                    if (coords.resolvedUrl) {
                        targetMapUrl = coords.resolvedUrl;
                        const linkEl = document.getElementById('gdLocMapLink');
                        if (linkEl) linkEl.href = targetMapUrl;
                    }
                    renderMapPreview(coords.lat, coords.lng);
                } else {
                    fallbackGeocode(name, address);
                }
            }, () => fallbackGeocode(name, address));
        } else {
            fallbackGeocode(name, address);
        }
    }

    function fallbackGeocode(name, address) {
        const cleanName = name ? name.replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, '').trim() : '';
        const queries = [address, cleanName, name].map(q => q ? String(q).trim() : '').filter((q, i, arr) => q && arr.indexOf(q) === i);
        if (!queries.length) { renderMapPreview(25.0330, 121.5654); return; }

        const tryQ = idx => {
            if (idx >= queries.length) { renderMapPreview(25.0330, 121.5654); return; }
            fetch('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(queries[idx]) + '&countrycodes=tw&format=json&limit=1')
                .then(r => r.json())
                .then(list => {
                    if (Array.isArray(list) && list.length > 0) {
                        renderMapPreview(parseFloat(list[0].lat), parseFloat(list[0].lon));
                    } else {
                        tryQ(idx + 1);
                    }
                })
                .catch(() => tryQ(idx + 1));
        };
        tryQ(0);
    }

    function renderMapPreview(lat, lng) {
        try {
            const mapEl = document.getElementById('gdMapView');
            if (!mapEl || !window.L) return;
            if (leafletMap) { leafletMap.remove(); leafletMap = null; }

            leafletMap = L.map('gdMapView', {
                center: [lat, lng],
                zoom: 16,
                zoomControl: false,
                attributionControl: false,
                dragging: false,
                touchZoom: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false
            });
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap);
            const pin = L.divIcon({
                className: 'custom-map-marker',
                html: '<div style="font-size:26px;line-height:1;transform:translate(-50%,-100%);">📍</div>',
                iconSize: [0, 0]
            });
            L.marker([lat, lng], { icon: pin }).addTo(leafletMap);
            setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 250);
        } catch (e) {}
    }

    function openLocationMap() {
        if (targetMapUrl) openExternalUrl(null, targetMapUrl);
    }

    function handleGoogleCalClick(event) {
        const btn = document.getElementById('gdGoogleCalBtn');
        if (!btn || btn.classList.contains('disabled')) { event.preventDefault(); return; }
        openExternalUrl(event, btn.dataset.url || btn.getAttribute('href'));
    }

    function handleIcalClick(event) {
        const btn = document.getElementById('gdIcalBtn');
        if (!btn || btn.classList.contains('disabled')) { event.preventDefault(); return; }
        openExternalUrl(event, btn.dataset.url || btn.getAttribute('href'));
    }

    function showMemberNoteHistory(m) {
        if (!m) return;
        document.getElementById('noteHistoryTitle').textContent = `${m.name} 的備註歷史`;
        const hist = Array.isArray(currentGroup.joinedNotesHistory)
            ? currentGroup.joinedNotesHistory.filter(it => it && String(it.userId).toLowerCase() === String(m.id).toLowerCase()).reverse()
            : [];

        const listEl = document.getElementById('noteHistoryList');
        if (hist.length > 0) {
            listEl.innerHTML = hist.map((item, i) => `
                <div class="history-item ${i === 0 ? 'latest' : ''}">
                    <div>${escapeHtml(item.note || '無內容')}</div>
                    <div class="history-time"><span>${escapeHtml(item.time || '')}</span>${i === 0 ? '<span>最新</span>' : ''}</div>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = m.note
                ? `<div class="history-item latest"><div>${escapeHtml(m.note)}</div><div class="history-time"><span>${escapeHtml(m.noteTime || '')}</span><span>最新</span></div></div>`
                : '<div style="text-align:center;color:var(--p-muted);padding:20px 0;">尚無備註修訂紀錄</div>';
        }
        document.getElementById('noteHistoryOverlay').classList.add('is-open');
    }

    function openNoteHistoryByIndex(idx) {
        if (!currentGroup || !Array.isArray(currentGroup.joinedList) || !currentGroup.joinedList[idx]) return;
        showMemberNoteHistory(currentGroup.joinedList[idx]);
    }

    function openWaitlistNoteHistoryByIndex(idx) {
        if (!currentGroup || !Array.isArray(currentGroup.waitlist) || !currentGroup.waitlist[idx]) return;
        showMemberNoteHistory(currentGroup.waitlist[idx]);
    }

    function closeNoteHistory() {
        document.getElementById('noteHistoryOverlay').classList.remove('is-open');
    }

    function openTagModal() {
        if (!currentGroup || !Array.isArray(currentGroup.joinedList) || currentGroup.joinedList.length === 0) {
            Swal.fire('提示', '目前沒有參加者可標記', 'info');
            return;
        }
        document.getElementById('tagTextarea').value = currentGroup.joinedList.map(m => `@${m.name}`).join(' ');
        document.getElementById('tagCopyBtn').textContent = '複製全員';
        document.getElementById('tagModalOverlay').classList.add('is-open');
    }

    function closeTagModal() {
        document.getElementById('tagModalOverlay').classList.remove('is-open');
    }

    function copyTagText() {
        const ta = document.getElementById('tagTextarea');
        ta.select();
        ta.setSelectionRange(0, 99999);
        const done = () => {
            const btn = document.getElementById('tagCopyBtn');
            btn.textContent = '已複製！';
            setTimeout(closeTagModal, 900);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value).then(done).catch(() => { document.execCommand('copy'); done(); });
        } else {
            document.execCommand('copy');
            done();
        }
    }

    return {
        open,
        close,
        handleOverlayClick,
        isLocked: () => isDetailLoading,
        handleJoinGroup,
        handleUpdateNote,
        handleLeaveGroup,
        handleEditGroup,
        handleCloseGroup,
        openLocationMap,
        handleGoogleCalClick,
        handleIcalClick,
        openNoteHistoryByIndex,
        openWaitlistNoteHistoryByIndex,
        closeNoteHistory,
        openTagModal,
        closeTagModal,
        copyTagText,
        refreshAuthIfOpen: () => {
            if (currentGroup) {
                renderJoinedMembers();
                refreshUserActions();
            }
        }
    };
})();

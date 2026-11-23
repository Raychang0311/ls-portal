/**
 * L>S Portal — 建立與編輯揪團整合表單抽屜
 */
window.PortalGroupForm = (function() {
    const { Store, callGasApi, escapeHtml, escapeHtmlAttr } = window.PortalApi;

    let pageMode = 'create';
    let currentSeqId = '';
    let isSubmitting = false;
    let onlySelectedFilter = false;
    let startPicker = null;
    let endPicker = null;
    let locTimeout = null;
    let currentSessionToken = null;
    let currentPredictions = [];
    let selectedLocationName = '';
    let latestLocReqId = 0;
    let hasAlertedReminder = false;
    let initialized = false;

    function ensureInit() {
        if (initialized) return;
        initialized = true;
        initDatePickers();
        bindInteractions();
    }

    function initDatePickers() {
        if (!window.flatpickr) return;
        const zhTwLocale = (flatpickr.l10ns && (flatpickr.l10ns['zh-tw'] || flatpickr.l10ns.zh_tw)) || {};
        const pad2 = n => String(n).padStart(2, '0');

        const syncTimeUI = instance => {
            if (!instance || !instance.calendarContainer) return;
            const hSel = instance.calendarContainer.querySelector('.fp-hour-select');
            const mSel = instance.calendarContainer.querySelector('.fp-minute-select');
            if (!hSel || !mSel) return;
            const dt = instance.selectedDates && instance.selectedDates[0];
            if (dt) {
                hSel.value = pad2(dt.getHours());
                mSel.value = pad2(Math.floor(dt.getMinutes() / 15) * 15);
            } else {
                hSel.value = pad2(instance.config.defaultHour || 19);
                mSel.value = pad2(Math.floor((instance.config.defaultMinute || 0) / 15) * 15);
            }
        };

        const setupCustom = (defH, defM) => (selectedDates, dateStr, instance) => {
            if (!instance || !instance.calendarContainer) return;
            [instance.hourElement, instance.minuteElement].forEach(el => {
                if (!el) return;
                el.readOnly = true;
                el.tabIndex = -1;
                el.setAttribute('inputmode', 'none');
                el.focus = () => {};
            });

            if (!instance._hasCloseGuard) {
                instance._hasCloseGuard = true;
                const rawClose = instance.close.bind(instance);
                let allowClose = false;
                instance._forceClose = () => { allowClose = true; rawClose(); allowClose = false; };
                instance.close = () => { if (allowClose) rawClose(); };
            }

            if (instance.calendarContainer.querySelector('.flatpickr-confirm-bar')) {
                syncTimeUI(instance);
                return;
            }

            const timeBar = document.createElement('div');
            timeBar.className = 'flatpickr-custom-time';
            const lbl = document.createElement('span');
            lbl.textContent = '🕒 時間';

            const hSel = document.createElement('select');
            hSel.className = 'flatpickr-time-select fp-hour-select';
            for (let h = 0; h < 24; h++) {
                const o = document.createElement('option');
                o.value = pad2(h);
                o.textContent = pad2(h) + ' 時';
                hSel.appendChild(o);
            }

            const mSel = document.createElement('select');
            mSel.className = 'flatpickr-time-select fp-minute-select';
            [0, 15, 30, 45].forEach(m => {
                const o = document.createElement('option');
                o.value = pad2(m);
                o.textContent = pad2(m) + ' 分';
                mSel.appendChild(o);
            });

            const applyT = () => {
                const base = (instance.selectedDates && instance.selectedDates[0])
                    ? new Date(instance.selectedDates[0].getTime())
                    : new Date();
                base.setHours(parseInt(hSel.value, 10), parseInt(mSel.value, 10), 0, 0);
                instance.setDate(base, true);
            };
            hSel.addEventListener('change', applyT);
            mSel.addEventListener('change', applyT);

            timeBar.appendChild(lbl);
            timeBar.appendChild(hSel);
            timeBar.appendChild(document.createTextNode(':'));
            timeBar.appendChild(mSel);

            const bar = document.createElement('div');
            bar.className = 'flatpickr-confirm-bar';
            const todayBtn = document.createElement('button');
            todayBtn.type = 'button';
            todayBtn.className = 'flatpickr-today-btn';
            todayBtn.textContent = '今天現在';
            todayBtn.addEventListener('click', () => {
                const now = new Date();
                now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
                instance.setDate(now, true);
                syncTimeUI(instance);
            });

            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className = 'flatpickr-done-btn';
            doneBtn.textContent = '✓ 確定';
            doneBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (instance.selectedDates.length === 0) {
                    const fb = new Date();
                    fb.setHours(parseInt(hSel.value, 10), parseInt(mSel.value, 10), 0, 0);
                    instance.setDate(fb, true);
                }
                if (instance._forceClose) instance._forceClose();
            });

            bar.appendChild(todayBtn);
            bar.appendChild(doneBtn);
            instance.calendarContainer.appendChild(timeBar);
            instance.calendarContainer.appendChild(bar);

            hSel.value = pad2(defH);
            mSel.value = pad2(defM);
            syncTimeUI(instance);
        };

        const baseCfg = {
            enableTime: true,
            time_24hr: true,
            minuteIncrement: 15,
            dateFormat: 'Y/m/d H:i',
            locale: zhTwLocale,
            disableMobile: true,
            allowInput: false,
            clickOpens: true,
            closeOnSelect: false
        };

        startPicker = flatpickr('#gfStartDate', Object.assign({}, baseCfg, {
            minDate: 'today',
            defaultHour: 19,
            defaultMinute: 0,
            onReady: setupCustom(19, 0),
            onOpen: (s, d, inst) => {
                if (endPicker && endPicker.isOpen && endPicker._forceClose) endPicker._forceClose();
                syncTimeUI(inst);
            },
            onChange: (dates, d, inst) => {
                syncTimeUI(inst);
                if (!dates || !dates.length) return;
                if (endPicker) {
                    endPicker.set('minDate', dates[0]);
                    const curEnd = endPicker.selectedDates[0];
                    if (!curEnd || curEnd < dates[0]) {
                        endPicker.setDate(new Date(dates[0].getTime() + 2 * 3600 * 1000), false);
                        syncTimeUI(endPicker);
                    }
                }
            }
        }));

        endPicker = flatpickr('#gfEndDate', Object.assign({}, baseCfg, {
            minDate: 'today',
            defaultHour: 21,
            defaultMinute: 0,
            onReady: setupCustom(21, 0),
            onOpen: (s, d, inst) => {
                if (startPicker && startPicker.isOpen && startPicker._forceClose) startPicker._forceClose();
                syncTimeUI(inst);
            },
            onChange: (dates, d, inst) => syncTimeUI(inst)
        }));

        document.addEventListener('click', e => {
            if (e.target.closest('.flatpickr-calendar') || e.target.id === 'gfStartDate' || e.target.id === 'gfEndDate') return;
            if (startPicker && startPicker.isOpen && startPicker._forceClose) startPicker._forceClose();
            if (endPicker && endPicker.isOpen && endPicker._forceClose) endPicker._forceClose();
        });
    }

    function bindInteractions() {
        const remindSlider = document.getElementById('gfRemindSlider');
        remindSlider.addEventListener('input', function() {
            const val = parseFloat(this.value);
            document.getElementById('gfRemindHours').value = val === 0 ? '' : val;
            document.getElementById('gfRemindBadge').textContent = val === 0
                ? '不提醒 (關閉)'
                : (val === 0.5 ? '活動前 30 分鐘' : `活動前 ${val} 小時`);
        });

        remindSlider.addEventListener('change', function() {
            if (parseFloat(this.value) > 0 && !hasAlertedReminder) {
                hasAlertedReminder = true;
                Swal.fire({
                    icon: 'info',
                    title: '活動提醒機制說明',
                    html: '<p style="text-align:left;color:#52635c;font-size:0.92rem;line-height:1.6;">到達設定時間後，<b>當群組有人發言時</b>，機器人會立即跳出通知並<b>標註 (@Tag)</b> 所有出席成員。</p>',
                    confirmButtonColor: '#3a6e59'
                });
            }
        });

        const limitSlider = document.getElementById('gfLimitSlider');
        limitSlider.addEventListener('input', function() {
            const val = parseInt(this.value, 10);
            document.getElementById('gfLimit').value = val === 0 ? '99' : val;
            document.getElementById('gfLimitBadge').textContent = val === 0 ? '無限制' : `${val} 人`;
        });

        const locInput = document.getElementById('gfLocationInput');
        locInput.addEventListener('input', function() { handleLocationInput(this.value); });
        document.addEventListener('click', e => {
            if (!e.target.closest('#gfLocContainer')) {
                const dd = document.getElementById('gfAutocompleteDropdown');
                if (dd) dd.style.display = 'none';
            }
        });

        document.getElementById('gfMemberSearchInput').addEventListener('input', filterMemberChips);
        document.getElementById('gfInitMemberBlock').addEventListener('change', e => {
            if (e.target && e.target.name === 'gfInitMember') {
                updateSelectedMemberBadge();
                if (onlySelectedFilter) filterMemberChips();
            }
        });
    }

    function openCreate() {
        openDrawer('');
    }

    function openEdit(seqId) {
        openDrawer(seqId || '');
    }

    function openDrawer(seqId) {
        ensureInit();
        currentSeqId = String(seqId || '').trim();
        resetFormInputs();

        const overlay = document.getElementById('groupFormOverlay');
        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';

        if (!Store.currentUserId) {
            showStateView('🔑', '請先登入 LINE 驗證身分', '為確保開團與編輯權限安全，請先透過 LINE 帳號登入以確認群組成員身分。',
                '<button type="button" class="btn btn--primary" onclick="PortalAuth.triggerLogin()">使用 LINE 登入</button><button type="button" class="btn btn--secondary" onclick="PortalGroupForm.close()">取消</button>');
            return;
        }

        showLoading(true, '驗證身分與載入表單資料中...');
        callGasApi('form', 'initPage', { seqId: currentSeqId, userId: Store.currentUserId }, res => {
            showLoading(false);
            if (!res || !res.success) {
                showStateView('⚠️', '無法載入表單', (res && res.error) || '發生未知錯誤',
                    '<button type="button" class="btn btn--secondary" onclick="PortalGroupForm.close()">關閉</button>');
                return;
            }

            if (res.mode === 'redirect') {
                showStateView('🚫', '僅主揪本人可修改', '您不是此揪團的主揪，將維持瀏覽權限。',
                    '<button type="button" class="btn btn--primary" onclick="PortalGroupForm.close()">返回</button>');
                return;
            }

            if (res.mode === 'unauthorized') {
                showStateView('🚫', '非群組成員', '您目前不在 L>S 群組成員名單中，無法建立揪團。若剛加入群組，請先於群組內發言一次後再試。',
                    '<button type="button" class="btn btn--secondary" onclick="PortalGroupForm.close()">關閉</button>');
                return;
            }

            if (res.mode === 'edit') {
                pageMode = 'edit';
                renderEditMode(res.groupInfo, res.memberList || []);
                showForm();
                return;
            }

            if (res.mode === 'create') {
                pageMode = 'create';
                renderCreateMode(res.currentUserId || Store.currentUserId, res.memberList || []);
                showForm();
                return;
            }
        }, err => {
            showLoading(false);
            showStateView('⚠️', '連線失敗', String(err), '<button type="button" class="btn btn--secondary" onclick="PortalGroupForm.close()">關閉</button>');
        });
    }

    function close() {
        const overlay = document.getElementById('groupFormOverlay');
        if (overlay) overlay.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    function showLoading(show, text) {
        const box = document.getElementById('gfLoadingBox');
        const state = document.getElementById('gfStateView');
        const form = document.getElementById('gfForm');
        if (text) document.getElementById('gfLoadingText').textContent = text;
        if (show) {
            box.style.display = 'flex';
            state.style.display = 'none';
            form.style.display = 'none';
        } else {
            box.style.display = 'none';
        }
    }

    function showStateView(icon, title, desc, actionsHtml) {
        document.getElementById('gfLoadingBox').style.display = 'none';
        document.getElementById('gfForm').style.display = 'none';
        document.getElementById('gfStateIcon').textContent = icon;
        document.getElementById('gfStateTitle').textContent = title;
        document.getElementById('gfStateDesc').textContent = desc;
        document.getElementById('gfStateActions').innerHTML = actionsHtml;
        document.getElementById('gfStateView').style.display = 'block';
    }

    function showForm() {
        document.getElementById('gfLoadingBox').style.display = 'none';
        document.getElementById('gfStateView').style.display = 'none';
        document.getElementById('gfForm').style.display = 'block';
    }

    function resetFormInputs() {
        document.getElementById('gfSeqId').value = '';
        document.getElementById('gfHost').value = '';
        document.getElementById('gfGroupTitle').value = '';
        document.getElementById('gfGroupContent').value = '';
        if (startPicker) startPicker.clear(); else document.getElementById('gfStartDate').value = '';
        if (endPicker) endPicker.clear(); else document.getElementById('gfEndDate').value = '';
        document.getElementById('gfRemindSlider').value = 0;
        document.getElementById('gfRemindHours').value = '';
        document.getElementById('gfRemindBadge').textContent = '不提醒 (關閉)';
        document.getElementById('gfLimitSlider').value = 0;
        document.getElementById('gfLimit').value = '99';
        document.getElementById('gfLimitBadge').textContent = '無限制';
        document.getElementById('gfMemberSearchInput').value = '';
        onlySelectedFilter = false;
        document.getElementById('gfOnlySelectedBtn').classList.remove('is-active');
        clearLocation();
    }

    function renderCreateMode(userId, memberList) {
        document.getElementById('gfModePill').textContent = '✨ 新增活動';
        document.getElementById('gfHeading').textContent = '建立揪團';
        document.getElementById('gfMemberLabel').textContent = '👥 內建成員';
        document.getElementById('gfSubmitBtn').textContent = '送出建立揪團';
        document.getElementById('gfSeqId').value = '';

        const targetUid = String(userId).trim().toLowerCase();
        let hostVal = '';
        let hostName = '群友';
        let html = '';

        memberList.forEach((m, idx) => {
            const isMe = String(m.id).trim().toLowerCase() === targetUid;
            const rawVal = m.id + '@' + m.name;
            if (isMe) {
                hostVal = rawVal;
                hostName = m.name || hostName;
            } else {
                html += `
                    <div class="gf-member-option" data-name="${escapeHtmlAttr((m.name || '').toLowerCase())}">
                        <input type="checkbox" name="gfInitMember" id="gf_cb_${idx}" value="${escapeHtmlAttr(rawVal)}">
                        <label class="gf-member-chip" for="gf_cb_${idx}">${escapeHtml(m.name)}</label>
                    </div>`;
            }
        });

        html += '<div id="gfMemberEmpty" style="grid-column:1/-1;text-align:center;color:var(--p-muted);padding:14px 0;display:none;">查無符合群友</div>';
        document.getElementById('gfHostChip').textContent = '主揪：' + hostName;
        document.getElementById('gfHost').value = hostVal;
        document.getElementById('gfInitMemberBlock').innerHTML = html;

        if (startPicker) startPicker.set('minDate', 'today');
        if (endPicker) endPicker.set('minDate', 'today');
        updateSelectedMemberBadge();
    }

    function renderEditMode(info, memberList) {
        document.getElementById('gfModePill').textContent = '✏️ 編輯活動 #' + (info.seqId || currentSeqId);
        document.getElementById('gfHeading').textContent = '修改揪團內容';
        document.getElementById('gfMemberLabel').textContent = '👥 新增成員 (灰底為已參加)';
        document.getElementById('gfSubmitBtn').textContent = '儲存並送出修改';
        document.getElementById('gfSeqId').value = info.seqId || currentSeqId;

        const hostLower = String(info.hostId || '').trim().toLowerCase();
        const joinedSet = new Set((info.joinedList || []).map(id => String(id).trim().toLowerCase()));
        let hostVal = '';
        let hostName = '主揪';
        let html = '';

        memberList.forEach((m, idx) => {
            const mLower = String(m.id).trim().toLowerCase();
            const isHost = mLower === hostLower;
            const rawVal = m.id + '@' + m.name;
            if (isHost) {
                hostVal = rawVal;
                hostName = m.name || hostName;
            } else {
                const isJoined = joinedSet.has(mLower);
                html += `
                    <div class="gf-member-option" data-name="${escapeHtmlAttr((m.name || '').toLowerCase())}">
                        <input type="checkbox" name="gfInitMember" id="gf_cb_${idx}" value="${escapeHtmlAttr(rawVal)}" ${isJoined ? 'checked disabled' : ''}>
                        <label class="gf-member-chip" for="gf_cb_${idx}">${escapeHtml(m.name)}${isJoined ? ' (已入)' : ''}</label>
                    </div>`;
            }
        });

        html += '<div id="gfMemberEmpty" style="grid-column:1/-1;text-align:center;color:var(--p-muted);padding:14px 0;display:none;">查無符合群友</div>';
        document.getElementById('gfHostChip').textContent = '主揪：' + hostName;
        document.getElementById('gfHost').value = hostVal;
        document.getElementById('gfInitMemberBlock').innerHTML = html;

        document.getElementById('gfGroupTitle').value = info.groupTitle || '';
        document.getElementById('gfGroupContent').value = info.groupContent || '';

        if (startPicker) {
            startPicker.set('minDate', null);
            if (info.startDate) startPicker.setDate(info.startDate, false, 'Y/m/d H:i');
        }
        if (endPicker) {
            endPicker.set('minDate', info.startDate || null);
            if (info.endDate) endPicker.setDate(info.endDate, false, 'Y/m/d H:i');
        }

        const limitVal = parseInt(info.limit, 10);
        if (isNaN(limitVal) || limitVal === 99) {
            document.getElementById('gfLimitSlider').value = 0;
            document.getElementById('gfLimit').value = '99';
            document.getElementById('gfLimitBadge').textContent = '無限制';
        } else {
            document.getElementById('gfLimitSlider').value = Math.min(limitVal, 75);
            document.getElementById('gfLimit').value = limitVal;
            document.getElementById('gfLimitBadge').textContent = limitVal + ' 人';
        }

        const remindVal = parseFloat(info.remindHours);
        if (!isNaN(remindVal) && remindVal > 0) {
            document.getElementById('gfRemindSlider').value = remindVal;
            document.getElementById('gfRemindHours').value = remindVal;
            document.getElementById('gfRemindBadge').textContent = (remindVal === 0.5) ? '活動前 30 分鐘' : `活動前 ${remindVal} 小時`;
        }

        if (info.locationData) {
            try {
                const locObj = typeof info.locationData === 'object' ? info.locationData : JSON.parse(info.locationData);
                if (locObj && ('name' in locObj || 'url' in locObj || 'address' in locObj)) {
                    applySelectedLocation(locObj.name || locObj.address || '', locObj.url || '', locObj.address || '');
                }
            } catch (e) {}
        }

        updateSelectedMemberBadge();
    }

    function addQuickDuration(minutes) {
        let startDt = (startPicker && startPicker.selectedDates[0]) ? new Date(startPicker.selectedDates[0].getTime()) : null;
        if (!startDt) {
            startDt = new Date();
            startDt.setMinutes(Math.ceil(startDt.getMinutes() / 15) * 15, 0, 0);
            if (startPicker) startPicker.setDate(startDt, false);
        }
        const curEnd = (endPicker && endPicker.selectedDates[0]) ? new Date(endPicker.selectedDates[0].getTime()) : null;
        const base = (curEnd && curEnd >= startDt) ? curEnd : startDt;
        const nextEnd = new Date(base.getTime() + minutes * 60000);
        if (endPicker) {
            endPicker.set('minDate', startDt);
            endPicker.setDate(nextEnd, true);
        }
    }

    function handleLocationInput(val) {
        val = val ? val.trim() : '';
        const dd = document.getElementById('gfAutocompleteDropdown');
        if (!val || (selectedLocationName && val !== selectedLocationName)) {
            selectedLocationName = '';
            document.getElementById('gfLocationData').value = '';
            document.getElementById('gfLocationPreview').style.display = 'none';
        }
        if (!val) {
            dd.style.display = 'none';
            document.getElementById('gfLocationLoading').style.display = 'none';
            return;
        }
        document.getElementById('gfLocationLoading').style.display = 'inline-block';
        if (locTimeout) clearTimeout(locTimeout);
        locTimeout = setTimeout(() => {
            const reqId = ++latestLocReqId;
            if (!currentSessionToken) {
                currentSessionToken = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0;
                    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                });
            }
            callGasApi('form', 'getPlacePredictions', { input: val, sessionToken: currentSessionToken }, res => {
                if (reqId !== latestLocReqId) return;
                document.getElementById('gfLocationLoading').style.display = 'none';
                const list = (res && Array.isArray(res.suggestions)) ? res.suggestions : (Array.isArray(res) ? res : []);
                currentPredictions = list;
                if (!list.length) { dd.style.display = 'none'; return; }
                dd.innerHTML = list.map((p, idx) => `
                    <div class="gf-autocomplete-item" onclick="PortalGroupForm.selectPrediction(${idx})">
                        <span>📍</span>
                        <div>
                            <div class="gf-autocomplete-main">${escapeHtml(p.mainText)}</div>
                            ${p.secondaryText ? `<div class="gf-autocomplete-sub">${escapeHtml(p.secondaryText)}</div>` : ''}
                        </div>
                    </div>
                `).join('');
                dd.style.display = 'block';
            }, () => {
                if (reqId === latestLocReqId) document.getElementById('gfLocationLoading').style.display = 'none';
            });
        }, 300);
    }

    function selectPrediction(idx) {
        const p = currentPredictions[idx];
        if (!p) return;
        document.getElementById('gfAutocompleteDropdown').style.display = 'none';
        document.getElementById('gfLocationLoading').style.display = 'inline-block';
        const token = currentSessionToken;
        currentSessionToken = null;

        callGasApi('form', 'getPlaceDetails', { placeId: p.placeId, sessionToken: token, fallbackData: p }, details => {
            document.getElementById('gfLocationLoading').style.display = 'none';
            if (details && details.url) {
                applySelectedLocation(details.name || p.mainText, details.url, details.address || p.address || p.secondaryText || '');
            } else {
                const u = (p.lat && p.lng) ? `https://maps.google.com/?q=${p.lat},${p.lng}` : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.placeId)}`;
                applySelectedLocation(p.mainText, u, p.address || p.secondaryText || '');
            }
        }, () => {
            document.getElementById('gfLocationLoading').style.display = 'none';
            const u = (p.lat && p.lng) ? `https://maps.google.com/?q=${p.lat},${p.lng}` : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.placeId)}`;
            applySelectedLocation(p.mainText, u, p.address || p.secondaryText || '');
        });
    }

    function applySelectedLocation(name, url, address) {
        const cleanName = String(name || '').trim();
        const cleanUrl = String(url || '').trim();
        const cleanAddr = String(address || '').trim();
        selectedLocationName = cleanName;
        document.getElementById('gfLocationInput').value = cleanName;
        document.getElementById('gfLocationData').value = JSON.stringify({ name: cleanName, url: cleanUrl, address: cleanAddr });
        document.getElementById('gfPreviewLocName').textContent = cleanName;
        const addrEl = document.getElementById('gfPreviewLocAddr');
        if (cleanAddr && cleanAddr !== cleanName) {
            addrEl.textContent = cleanAddr;
            addrEl.style.display = 'block';
        } else {
            addrEl.style.display = 'none';
        }
        document.getElementById('gfPreviewLocLink').href = cleanUrl || '#';
        document.getElementById('gfLocationPreview').style.display = 'flex';
    }

    function clearLocation() {
        selectedLocationName = '';
        document.getElementById('gfLocationInput').value = '';
        document.getElementById('gfLocationData').value = '';
        document.getElementById('gfLocationPreview').style.display = 'none';
        document.getElementById('gfAutocompleteDropdown').style.display = 'none';
        document.getElementById('gfLocationLoading').style.display = 'none';
        currentSessionToken = null;
    }

    function filterMemberChips() {
        const input = document.getElementById('gfMemberSearchInput');
        const clearBtn = document.getElementById('gfMemberSearchClear');
        const kw = input ? input.value.trim().toLowerCase() : '';
        if (clearBtn) clearBtn.classList.toggle('visible', kw.length > 0);

        let visibleCount = 0;
        document.querySelectorAll('#gfInitMemberBlock .gf-member-option').forEach(opt => {
            const name = (opt.dataset.name || '').toLowerCase();
            const cb = opt.querySelector('input[type="checkbox"]');
            const ok = (!kw || name.includes(kw)) && (!onlySelectedFilter || (cb && cb.checked));
            opt.classList.toggle('is-hidden', !ok);
            if (ok) visibleCount++;
        });

        const emptyEl = document.getElementById('gfMemberEmpty');
        if (emptyEl) emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
    }

    function clearMemberSearch() {
        const input = document.getElementById('gfMemberSearchInput');
        if (input) { input.value = ''; input.focus(); }
        filterMemberChips();
    }

    function toggleOnlySelected() {
        onlySelectedFilter = !onlySelectedFilter;
        document.getElementById('gfOnlySelectedBtn').classList.toggle('is-active', onlySelectedFilter);
        filterMemberChips();
    }

    function updateSelectedMemberBadge() {
        const badge = document.getElementById('gfMemberCountBadge');
        if (!badge) return;
        const existing = document.querySelectorAll('input[name="gfInitMember"]:checked:disabled').length;
        const newly = document.querySelectorAll('input[name="gfInitMember"]:checked:not([disabled])').length;
        badge.textContent = pageMode === 'edit'
            ? (newly > 0 ? `已入 ${existing} · 新選 ${newly} 人` : `已入 ${existing} 人`)
            : `已選 ${newly} 人`;
    }

    function submit(btn) {
        if (isSubmitting) return;
        const title = document.getElementById('gfGroupTitle').value.trim();
        const content = document.getElementById('gfGroupContent').value;
        const startDate = document.getElementById('gfStartDate').value.trim();
        const endDate = document.getElementById('gfEndDate').value.trim();
        const host = document.getElementById('gfHost').value;
        const limit = parseInt(document.getElementById('gfLimit').value, 10) || 99;
        const remindHours = document.getElementById('gfRemindHours').value;
        const locationData = document.getElementById('gfLocationData').value || '';
        const seqId = document.getElementById('gfSeqId').value.trim();

        const warn = msg => { Swal.fire({ icon: 'error', text: msg, confirmButtonColor: '#3a6e59' }); return false; };
        if (!title) return warn('請填寫揪團標題');
        if (!content || !content.trim()) return warn('請填寫揪團內容');
        if (!startDate || !endDate) return warn('請填寫完整日期');
        if (new Date(endDate) < new Date(startDate)) return warn('結束時間不能早於開始時間');

        let initMemberStr = '';
        if (pageMode === 'edit') {
            const existingCount = document.querySelectorAll('input[name="gfInitMember"]:checked:disabled').length;
            const newBoxes = document.querySelectorAll('input[name="gfInitMember"]:checked:not([disabled])');
            const newIds = Array.from(newBoxes).map(cb => cb.value.split('@')[0]);
            const total = existingCount + newIds.length + 1;
            if (limit !== 99 && limit < total) return warn(`總人數 (${total}) 已超過設定上限 (${limit})`);
            initMemberStr = newIds.join(',');
        } else {
            const boxes = document.querySelectorAll('input[name="gfInitMember"]:checked');
            const ids = Array.from(boxes).map(cb => cb.value.split('@')[0]);
            if (limit !== 99 && limit < (1 + ids.length)) return warn(`人數 (${1 + ids.length}) 已超過上限 (${limit})`);
            initMemberStr = ids.join(',');
        }

        isSubmitting = true;
        if (btn) btn.disabled = true;
        Swal.fire({ title: pageMode === 'edit' ? '儲存修改中...' : '建立揪團中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        callGasApi('form', pageMode === 'edit' ? 'editGroup' : 'createGroup', {
            seqId: seqId,
            userId: Store.currentUserId,
            host: host,
            groupTitle: title,
            groupContent: content,
            startDate: startDate,
            endDate: endDate,
            limit: limit,
            remindHours: remindHours,
            locationData: locationData,
            initMember: initMemberStr
        }, res => {
            isSubmitting = false;
            if (btn) btn.disabled = false;
            if (!res || !res.success) {
                Swal.fire({ icon: 'error', text: (res && res.error) || '送出失敗', confirmButtonColor: '#3a6e59' });
                return;
            }
            const focusId = res.seqId || seqId;
            close();
            window.PortalApp.switchTab('groups');
            window.PortalJukebox.refresh(true, focusId);
            Swal.fire({
                icon: 'success',
                title: pageMode === 'edit' ? '揪團修改成功！' : '揪團建立成功！',
                confirmButtonColor: '#3a6e59'
            });
        }, err => {
            isSubmitting = false;
            if (btn) btn.disabled = false;
            Swal.fire({ icon: 'error', text: '錯誤: ' + err, confirmButtonColor: '#3a6e59' });
        }, { noGetFallback: true });
    }

    return {
        openCreate,
        openEdit,
        close,
        addQuickDuration,
        selectPrediction,
        clearLocation,
        clearMemberSearch,
        toggleOnlySelected,
        submit
    };
})();

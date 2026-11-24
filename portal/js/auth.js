/**
 * L>S Portal — 共用 LINE LIFF 身分驗證模組
 */
window.PortalAuth = (function() {
    const { Store, extractQueryParam, PORTAL_LIFF_ID } = window.PortalApi;
    const listeners = [];
    let liffReady = false;
    let activeLiffId = '';
    let loadedDirectoryForUid = null;

    function onAuthChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
    }

    function notifyAuthChange() {
        updateAuthUI();
        listeners.forEach(fn => {
            try { fn(Store.currentUserId, Store.currentDisplayName); } catch (e) {}
        });
    }

    function handleLoginSuccess(userId, displayName, picUrl) {
        if (!userId) return;
        const cleanUid = String(userId).trim();
        const matched = window.PortalApi.findMemberById(cleanUid);
        const resolvedName = (matched && matched.name) ? matched.name : (displayName || Store.currentDisplayName || '已登入群友');

        const changed = (Store.currentUserId !== cleanUid) || (Store.currentDisplayName !== resolvedName);
        Store.currentUserId = cleanUid;
        Store.currentDisplayName = resolvedName;
        if (picUrl) Store.currentUserPic = picUrl;
        else if (matched && matched.pic && !Store.currentUserPic) Store.currentUserPic = matched.pic;

        try {
            localStorage.setItem('ls_member_uid', Store.currentUserId);
            localStorage.setItem('ls_member_name', Store.currentDisplayName);
            if (Store.currentUserPic) localStorage.setItem('ls_member_pic', Store.currentUserPic);
        } catch (e) {}

        if (changed) notifyAuthChange();
        else updateAuthUI();

        // 若成員名冊先前是以其他狀態載入，補拉一次帶 userId 以確認管理群與本人生日權限
        const normalizedUid = cleanUid.toLowerCase();
        if (loadedDirectoryForUid !== null && loadedDirectoryForUid !== normalizedUid && window.PortalMembers) {
            window.PortalMembers.loadDirectory(true);
        }
    }

    function setLoadedDirectoryUid(uid) {
        loadedDirectoryForUid = String(uid || '').trim().toLowerCase();
    }

    function updateAuthUI() {
        const btn = document.getElementById('portalAuthBtn');
        const lbl = document.getElementById('portalAuthLabel');
        if (!btn || !lbl) return;

        if (Store.currentUserId) {
            btn.className = 'auth-pill logged-in';
            lbl.textContent = Store.currentDisplayName || '我的名片';
            btn.title = '點擊開啟我的個人數位名片';
        } else {
            btn.className = 'auth-pill';
            lbl.textContent = '未登入';
            btn.title = '請登入 LINE';
        }
    }

    function hideAuthGate() {
        document.body.classList.add('is-authenticated');
        const gate = document.getElementById('authGate');
        if (gate) gate.hidden = true;
    }

    function showLoginGate(title, message) {
        document.body.classList.remove('is-authenticated');
        const gate = document.getElementById('authGate');
        const checking = document.getElementById('authGateChecking');
        const blocked = document.getElementById('authGateBlocked');
        const titleEl = document.getElementById('authGateTitle');
        const msgEl = document.getElementById('authGateMsg');
        if (gate) gate.hidden = false;
        if (checking) checking.hidden = true;
        if (blocked) blocked.hidden = false;
        if (titleEl) titleEl.textContent = title || '無法登入 LINE';
        if (msgEl) msgEl.textContent = message || '無法自動完成 LINE 登入，請點擊下方按鈕登入 LINE，或離開此頁面。';
    }

    function init(onReady) {
        activeLiffId = extractQueryParam('liffId') || PORTAL_LIFF_ID;
        let readyFired = false;
        const completeAuthCheck = () => {
            if (readyFired) return;
            readyFired = true;
            if (Store.currentUserId) {
                hideAuthGate();
            } else {
                showLoginGate('無法自動登入 LINE', '本社群入口僅限群組成員透過 LINE 帳號登入使用，請點擊下方按鈕登入 LINE 或離開。');
            }
            if (typeof onReady === 'function') onReady(Boolean(Store.currentUserId));
        };

        // 1. URL 參數快速識別（若存在）
        const paramUid = extractQueryParam('userId') || extractQueryParam('uid');
        if (paramUid) {
            handleLoginSuccess(paramUid, 'LINE 群友');
        }

        // 2. localStorage 持久化快取（秒載體驗）
        try {
            const cachedUid = localStorage.getItem('ls_member_uid');
            const cachedName = localStorage.getItem('ls_member_name');
            const cachedPic = localStorage.getItem('ls_member_pic');
            if (cachedPic) Store.currentUserPic = cachedPic;
            if (cachedUid && !Store.currentUserId) {
                handleLoginSuccess(cachedUid, cachedName || '社群群友', cachedPic || '');
            }
        } catch (e) {}

        updateAuthUI();

        // 若已透過 URL 參數或本機快取確認身分，立即解鎖入口網站並於背景同步 LIFF
        if (Store.currentUserId) {
            completeAuthCheck();
        }

        // 3. 初始化官方 LINE LIFF SDK（僅當設定有效的 PORTAL_LIFF_ID 時）
        if (window.liff && activeLiffId && !activeLiffId.includes('YOUR_PORTAL_LIFF_ID')) {
            liff.init({ liffId: activeLiffId }).then(() => {
                liffReady = true;

                try {
                    const context = liff.getContext();
                    if (context && context.userId && !Store.currentUserId) {
                        handleLoginSuccess(context.userId, 'LINE 成員');
                    }
                } catch (e) {}

                try {
                    const idToken = liff.getDecodedIDToken();
                    if (idToken && idToken.sub && !Store.currentUserId) {
                        handleLoginSuccess(idToken.sub, idToken.name || 'LINE 使用者');
                    }
                } catch (e) {}

                if (liff.isLoggedIn()) {
                    return liff.getProfile().then(profile => {
                        if (profile && profile.userId) {
                            handleLoginSuccess(profile.userId, profile.displayName, profile.pictureUrl || '');
                        }
                        completeAuthCheck();
                    }).catch(err => {
                        console.warn('liff.getProfile 失敗:', err);
                        completeAuthCheck();
                    });
                }
                completeAuthCheck();
            }).catch(err => {
                console.warn('Portal LIFF 初始化提示:', err);
                completeAuthCheck();
            });
        } else {
            completeAuthCheck();
        }
    }

    function leavePage() {
        if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
            try {
                liff.closeWindow();
                return;
            } catch (e) {}
        }
        try { window.close(); } catch (e) {}
        const msgEl = document.getElementById('authGateMsg');
        if (msgEl) msgEl.textContent = '已取消登入，請直接關閉此分頁或返回 LINE 聊天室。';
    }

    function triggerLogin() {
        if (window.liff && activeLiffId && !activeLiffId.includes('YOUR_PORTAL_LIFF_ID')) {
            if (liffReady) {
                try {
                    liff.login({ redirectUri: window.location.href });
                    return;
                } catch (e) {
                    console.warn('liff.login 失敗:', e);
                }
            }
            window.location.href = 'https://liff.line.me/' + encodeURIComponent(activeLiffId);
            return;
        }

        Swal.fire({
            icon: 'info',
            title: '尚未配置入口網站 LIFF ID',
            html: '<div style="text-align:left;font-size:0.92rem;line-height:1.6;color:#52635c;">請在 <code>portal/js/api.js</code> 填入您於 LINE Developers 建立的 <code>PORTAL_LIFF_ID</code>，或透過網址參數 <code>?liffId=...</code> 指定即可啟用一鍵 LINE 登入。</div>',
            confirmButtonColor: '#3a6e59'
        });
    }

    function handleAuthClick() {
        if (Store.currentUserId) {
            window.PortalProfile.openByUserId(Store.currentUserId);
        } else {
            triggerLogin();
        }
    }

    return {
        init,
        onAuthChange,
        triggerLogin,
        leavePage,
        showLoginGate,
        handleAuthClick,
        setLoadedDirectoryUid,
        syncDisplayNameFromMembers: () => {
            if (!Store.currentUserId) return;
            const m = window.PortalApi.findMemberById(Store.currentUserId);
            if (m && m.name && m.name !== Store.currentDisplayName) {
                Store.currentDisplayName = m.name;
                if (m.pic) Store.currentUserPic = m.pic;
                try {
                    localStorage.setItem('ls_member_name', m.name);
                    if (m.pic) localStorage.setItem('ls_member_pic', m.pic);
                } catch (e) {}
                updateAuthUI();
            }
        }
    };
})();

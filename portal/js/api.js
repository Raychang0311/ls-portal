/**
 * L>S Portal — 共用 API 調度器、GAS Endpoints 與資料快取中心
 */
window.PortalApi = (function() {
    // =========================================================================
    // 後端 GAS Web App URLs 與 入口網站專屬 LIFF ID
    // =========================================================================
    // 請將 PORTAL_LIFF_ID 替換為您在 LINE Developers Console 新建指向入口網站根目錄的 LIFF ID
    const PORTAL_LIFF_ID = '2005700153-iA5K75WX';

    const GAS_ENDPOINTS = {
        group: 'https://script.google.com/macros/s/AKfycbx_fYHcCd2WlOVLaoJiVCYrpuTKGCuIs1XWiwzdl2-7S6f4CjCvsc7j-iNL_EDxHJ15pQ/exec',
        form: 'https://script.google.com/macros/s/AKfycbxc4sTgwkLouzW0c23TnDx4-gbCNndZJGtNlhi5gLs1juqhrsfbHXMW4dyN4xXLJsIJ/exec',
        members: 'https://script.google.com/macros/s/AKfycbz5UDfg2VEedk7aBbjCfXHzKmFgl7I_yr1xMeAzXm8a55AIKoonbnUL4Ntiyp2EKQ735g/exec',
        groupHistory: 'https://script.google.com/macros/s/AKfycbxRSuUycyClSV6dw0HQ04PFue35by1DCiS4BW8eN1zNtrUjnNXu_WmOr8ltTzddreA4/exec',
        leftHistory: 'https://script.google.com/macros/s/AKfycbxatzMl-MdNsdWUH9iL8V5OWDt3YDQ5wjsC_gXH4kID0j0EULD-wSK5S-uwuqvbLsnvEw/exec'
    };

    const Store = {
        groups: [],
        groupsLoaded: false,
        members: [],
        membersLoaded: false,
        isAdmin: false,
        titleConfig: null,
        groupHistory: [],
        groupHistoryLoaded: false,
        leftHistory: [],
        leftHistoryLoaded: false,
        currentUserId: null,
        currentDisplayName: null,
        currentUserPic: ''
    };

    function extractQueryParam(param) {
        const urlParams = new URLSearchParams(window.location.search);
        const direct = urlParams.get(param);
        if (direct) return direct;

        const stateStr = urlParams.get('liff.state');
        if (stateStr) {
            try {
                const decoded = decodeURIComponent(stateStr);
                const m = decoded.match(new RegExp('[?&]' + param + '=([^&#]+)'));
                if (m) return m[1];
            } catch (e) {}
        }

        if (window.location.hash) {
            try {
                const hashStr = window.location.hash.substring(1);
                const idx = hashStr.indexOf('?');
                if (idx !== -1) {
                    const hParams = new URLSearchParams(hashStr.substring(idx));
                    const hVal = hParams.get(param);
                    if (hVal) return hVal;
                }
            } catch (e) {}
        }
        return '';
    }

    function callGasApi(serviceName, action, params, onSuccess, onFailure, options) {
        const baseUrl = GAS_ENDPOINTS[serviceName];
        if (!baseUrl || baseUrl.includes('YOUR_GAS_DEPLOYMENT_ID')) {
            if (onFailure) onFailure('尚未設定 ' + serviceName + ' 的 GAS_API_URL');
            return;
        }

        const opts = options || {};
        const payload = Object.assign({}, params || {}, {
            action: action,
            _t: Date.now()
        });

        const buildGetQuery = () => {
            const q = {};
            Object.keys(payload).forEach(k => {
                if (payload[k] !== undefined && payload[k] !== null) {
                    q[k] = (typeof payload[k] === 'object') ? JSON.stringify(payload[k]) : String(payload[k]);
                }
            });
            return new URLSearchParams(q).toString();
        };

        if (opts.preferGet) {
            fetch(baseUrl + '?' + buildGetQuery(), { method: 'GET', cache: 'no-store' })
                .then(res => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(onSuccess)
                .catch(err => {
                    if (onFailure) onFailure(err && err.message ? err.message : String(err));
                });
            return;
        }

        // 先使用 text/plain POST 避開瀏覽器 CORS preflight，失敗且為唯讀請求時降級 GET
        fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            cache: 'no-store'
        })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(onSuccess)
            .catch(postErr => {
                if (opts.noGetFallback) {
                    if (onFailure) onFailure(postErr && postErr.message ? postErr.message : String(postErr));
                    return;
                }
                fetch(baseUrl + '?' + buildGetQuery(), { method: 'GET', cache: 'no-store' })
                    .then(res => {
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        return res.json();
                    })
                    .then(onSuccess)
                    .catch(err => {
                        if (onFailure) onFailure(err && err.message ? err.message : String(err));
                    });
            });
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeHtmlAttr(text) {
        if (!text) return '';
        return String(text)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;');
    }

    function escapeRegExp(str) {
        return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function replaceLinks(text) {
        if (!text) return '';
        return String(text).replace(/(https?:\/\/[^\s"<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" onclick="PortalApi.openExternalUrl(event, this.href)">$1</a>');
    }

    function openExternalUrl(event, url) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!url || !/^https?:\/\//i.test(url)) return;

        if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
            try {
                liff.openWindow({ url: url, external: true });
                return;
            } catch (e) {}
        }

        let targetUrl = url;
        if (/Line\//i.test(navigator.userAgent) && !/[?&]openExternalBrowser=1/i.test(targetUrl)) {
            targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'openExternalBrowser=1';
        }
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }

    function findMemberById(userId) {
        if (!userId || !Array.isArray(Store.members)) return null;
        const target = String(userId).trim().toLowerCase();
        return Store.members.find(m => m && m.id && String(m.id).trim().toLowerCase() === target) || null;
    }

    function formatSmartDateRange(startStr, endStr, fallbackStr) {
        const s = String(startStr || '').trim();
        const e = String(endStr || '').trim();
        if (s && e) {
            const sp = s.split(/\s+/);
            const ep = e.split(/\s+/);
            const sDate = sp[0] || '';
            const sTime = sp[1] || '';
            const eDate = ep[0] || '';
            const eTime = ep[1] || '';
            if (sDate && eDate && sDate === eDate) {
                return sTime && eTime ? `${sDate} ${sTime} ~ ${eTime}` : `${s} ~ ${e}`;
            }
            const sYear = sDate.slice(0, 4);
            const eYear = eDate.slice(0, 4);
            if (/^\d{4}$/.test(sYear) && sYear === eYear && eDate.length > 5) {
                return `${s} ~ ${eDate.slice(5)}${eTime ? ' ' + eTime : ''}`;
            }
            return `${s} ~ ${e}`;
        }
        if (s) return s;
        if (e) return e;
        return String(fallbackStr || '').trim() || '時間未定';
    }

    function updateNavSummary() {
        const el = document.getElementById('navLiveSummary');
        if (!el) return;
        const gCount = Store.groupsLoaded ? Store.groups.length : null;
        const mCount = Store.membersLoaded ? Store.members.length : null;
        const parts = [];
        if (gCount !== null) parts.push(`${gCount} 檔揪團`);
        if (mCount !== null) parts.push(`${mCount} 位群友`);
        el.textContent = parts.length > 0 ? parts.join(' · ') : '社群入口網站';
    }

    /** 依懸浮液態玻璃頂欄實際高度同步詳情內容上內距，避免手機版換行時遮住標題 */
    function syncDetailDrawerOffset(panelOrId) {
        const panel = typeof panelOrId === 'string' ? document.getElementById(panelOrId) : panelOrId;
        if (!panel) return;
        const header = panel.querySelector('.drawer-header');
        const body = panel.querySelector('.drawer-body');
        if (!header || !body) return;
        const apply = () => {
            const h = header.offsetHeight;
            if (!h) return;
            const topOffset = Math.max(88, header.offsetTop + h + 18);
            const val = topOffset + 'px';
            body.style.paddingTop = val;
            body.style.scrollPaddingTop = val;
        };
        apply();
        requestAnimationFrame(apply);
    }

    return {
        PORTAL_LIFF_ID,
        GAS_ENDPOINTS,
        Store,
        extractQueryParam,
        callGasApi,
        escapeHtml,
        escapeHtmlAttr,
        escapeRegExp,
        replaceLinks,
        openExternalUrl,
        findMemberById,
        formatSmartDateRange,
        updateNavSummary,
        syncDetailDrawerOffset
    };
})();

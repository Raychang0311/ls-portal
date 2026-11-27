/**
 * L>S Portal — 入口網站主控制器 (分頁導覽、Tab 指示器、深層連結、全域快速鍵)
 */
window.PortalApp = (function() {
    const { extractQueryParam } = window.PortalApi;
    const VALID_TABS = ['groups', 'members', 'groupHistory', 'albums', 'leftHistory', 'other'];
    let currentTab = 'groups';
    let deepLinkHandled = false;
    let portalStarted = false;

    function startAuthenticatedPortal() {
        if (portalStarted) return;
        portalStarted = true;

        window.PortalProfile.init();

        // 平行預載第一優先（揪團大廳）與第二優先（群友名單）
        window.PortalJukebox.init();
        window.PortalMembers.init();

        // 處理初始分頁 URL 參數（如 ?tab=members）
        const reqTab = extractQueryParam('tab') || (window.location.hash ? window.location.hash.replace('#', '').split('?')[0] : '');
        if (VALID_TABS.includes(reqTab)) {
            switchTab(reqTab, false);
        } else {
            switchTab('groups', false);
        }

        // 若帶有 ?mode=create 或 ?action=create，登入後自動展開開團表單
        const reqAction = extractQueryParam('action') || extractQueryParam('mode');
        if (reqAction === 'create') {
            setTimeout(() => window.PortalGroupForm.openCreate(), 250);
        } else if (reqAction === 'edit') {
            const seq = extractQueryParam('seqId') || extractQueryParam('id');
            if (seq) setTimeout(() => window.PortalGroupForm.openEdit(seq), 250);
        }
    }

    function init() {
        // 監聽登入狀態變動，即時同步全部視圖；未驗證前不開放進入網站
        window.PortalAuth.onAuthChange(uid => {
            if (uid && !portalStarted) {
                startAuthenticatedPortal();
                return;
            }
            window.PortalJukebox.rerenderCurrent();
            window.PortalGroupDetail.refreshAuthIfOpen();
            window.PortalMembers.renderSelfHeaderAction();
            window.PortalMembers.renderGrid();
            window.PortalProfile.refreshSelectedMember();
        });

        window.PortalAuth.init(authenticated => {
            if (authenticated) startAuthenticatedPortal();
        });

        window.addEventListener('resize', () => {
            if (!portalStarted) return;
            syncTabIndicator('#desktopNavTabs', '.nav__tab[aria-current="page"]');
            syncTabIndicator('#jukeboxFilterTabs', '.filter-tab.is-active');
            syncTabIndicator('#memberQuickFilters', '.filter-tab.is-active');
        }, { passive: true });

        window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });

        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const albumLb = document.getElementById('albumLightbox');
            if (albumLb && albumLb.classList.contains('active')) {
                window.PortalAlbumViewer.closeLightbox();
                return;
            }
            const albumViewer = document.getElementById('albumViewerOverlay');
            if (albumViewer && albumViewer.classList.contains('is-open')) {
                window.PortalAlbumViewer.close();
                return;
            }
            const lightbox = document.getElementById('imgLightbox');
            if (lightbox && lightbox.classList.contains('active')) {
                window.PortalProfile.closeImgLightbox();
                return;
            }
            const editProfile = document.getElementById('editProfileOverlay');
            if (editProfile && editProfile.classList.contains('is-open')) {
                window.PortalProfile.closeEditModal();
                return;
            }
            const profile = document.getElementById('profileModalOverlay');
            if (profile && profile.classList.contains('active')) {
                window.PortalProfile.close();
                return;
            }
            const tagM = document.getElementById('tagModalOverlay');
            if (tagM && tagM.classList.contains('is-open')) {
                window.PortalGroupDetail.closeTagModal();
                return;
            }
            const noteH = document.getElementById('noteHistoryOverlay');
            if (noteH && noteH.classList.contains('is-open')) {
                window.PortalGroupDetail.closeNoteHistory();
                return;
            }
            const gf = document.getElementById('groupFormOverlay');
            if (gf && gf.classList.contains('is-open')) {
                window.PortalGroupForm.close();
                return;
            }
            const gd = document.getElementById('groupDetailOverlay');
            if (gd && gd.classList.contains('is-open')) {
                if (!window.PortalGroupDetail.isLocked || !window.PortalGroupDetail.isLocked()) {
                    window.PortalGroupDetail.close();
                }
                return;
            }
            const ghSheet = document.getElementById('ghSheetOverlay');
            if (ghSheet && ghSheet.classList.contains('is-open')) {
                window.PortalHistory.closeGhSheet();
            }
        });
    }

    function switchTab(tabKey, updateHash = true) {
        if (!VALID_TABS.includes(tabKey)) tabKey = 'groups';
        currentTab = tabKey;

        VALID_TABS.forEach(t => {
            const viewEl = document.getElementById('view-' + t);
            if (!viewEl) return;
            const active = t === tabKey;
            viewEl.hidden = !active;
            viewEl.classList.toggle('is-active', active);
        });

        document.querySelectorAll('#desktopNavTabs .nav__tab').forEach(btn => {
            if (btn.dataset.tab === tabKey) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });

        document.querySelectorAll('.mobile-dock .dock-item').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === tabKey);
        });

        syncTabIndicator('#desktopNavTabs', '.nav__tab[aria-current="page"]');
        if (tabKey === 'groups') syncTabIndicator('#jukeboxFilterTabs', '.filter-tab.is-active');
        if (tabKey === 'members') syncTabIndicator('#memberQuickFilters', '.filter-tab.is-active');

        if (tabKey === 'groupHistory') window.PortalHistory.ensureGroupHistoryLoaded();
        if (tabKey === 'albums' && window.PortalAlbums) window.PortalAlbums.ensureLoaded();
        if (tabKey === 'leftHistory') window.PortalHistory.ensureLeftHistoryLoaded();
        if (tabKey === 'other' && window.PortalOther) window.PortalOther.ensureLoaded();

        if (updateHash && window.history && window.history.replaceState) {
            try {
                window.history.replaceState(null, '', '#' + tabKey);
            } catch (e) {}
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
        updateBackToTopVisibility();
    }

    function updateBackToTopVisibility() {
        const btn = document.getElementById('portalBackToTopBtn');
        if (!btn) return;
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        btn.classList.toggle('is-visible', y > 360);
    }

    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * taste-skill motion.js 同款滑動墨水指標 (.m-tab-ind)
     */
    function syncTabIndicator(containerSelector, activeSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;
        const activeEl = container.querySelector(activeSelector);
        if (!activeEl || activeEl.offsetWidth === 0) return;

        container.classList.add('m-has-ind');
        let ind = container.querySelector(':scope > .m-tab-ind');
        const isNew = !ind;
        if (isNew) {
            ind = document.createElement('span');
            ind.className = 'm-tab-ind';
            ind.setAttribute('aria-hidden', 'true');
            container.prepend(ind);
        }

        const x = activeEl.offsetLeft;
        const y = activeEl.offsetTop;
        const w = activeEl.offsetWidth;
        const h = activeEl.offsetHeight;

        ind.style.setProperty('--w', w + 'px');
        ind.style.setProperty('--h', h + 'px');
        ind.style.setProperty('--x', x + 'px');
        ind.style.setProperty('--y', y + 'px');
    }

    function handleDeepLinkSeqId() {
        if (deepLinkHandled) return;
        deepLinkHandled = true;
        const seqId = extractQueryParam('seqId') || extractQueryParam('id');
        const action = extractQueryParam('action') || extractQueryParam('mode');
        if (seqId && action !== 'edit') {
            window.PortalJukebox.focusBySeqId(seqId);
            window.PortalGroupDetail.open(seqId);
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        switchTab,
        syncTabIndicator,
        handleDeepLinkSeqId,
        scrollToTop,
        getCurrentTab: () => currentTab
    };
})();

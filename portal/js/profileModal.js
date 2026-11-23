/**
 * L>S Portal — 全站共用個人數位名片 Modal、稱號 Tooltip、個人編輯與管理群生日設定
 */
window.PortalProfile = (function() {
    const { Store, callGasApi, escapeHtml, openExternalUrl } = window.PortalApi;
    let selectedMember = null;

    const profileAnimState = {
        token: 0,
        sourceEl: null,
        userId: null,
        animations: [],
        ghostEl: null,
        hiddenSourceAvatar: null,
        isClosing: false
    };

    const imgLightboxAnimState = {
        token: 0,
        animations: [],
        sourceEl: null,
        isClosing: false
    };

    const SOCIAL_PLATFORMS = [
        {
            key: 'instagram',
            label: 'Instagram',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="igGrad-portal" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#f09433"/><stop offset="25%" stop-color="#e6683c"/><stop offset="50%" stop-color="#dc2743"/><stop offset="75%" stop-color="#cc2366"/><stop offset="100%" stop-color="#bc1888"/></linearGradient></defs><path fill="url(#igGrad-portal)" d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 1.8A3.95 3.95 0 0 0 3.8 7.75v8.5A3.95 3.95 0 0 0 7.75 20.2h8.5a3.95 3.95 0 0 0 3.95-3.95v-8.5a3.95 3.95 0 0 0-3.95-3.95h-8.5zm8.95 1.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z"/></svg>'
        },
        {
            key: 'x',
            label: 'X',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#111827" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'
        },
        {
            key: 'facebook',
            label: 'Facebook',
            svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg>'
        }
    ];

    function init() {
        const body = document.getElementById('profileModalBody');
        if (body) body.addEventListener('scroll', hideBadgeTooltip);
    }

    function openByUserId(userId, sourceEl) {
        if (!userId) return;
        const cached = window.PortalApi.findMemberById(userId);
        if (cached) {
            renderAndOpen(cached, sourceEl);
            return;
        }

        Swal.fire({
            title: '載入數位名片中...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        callGasApi('group', 'getMemberProfile', { userId: userId }, res => {
            Swal.close();
            if (res && res.success && res.profile) {
                if (res.titleConfig && !Store.titleConfig) Store.titleConfig = res.titleConfig;
                renderAndOpen(res.profile, sourceEl);
            } else {
                Swal.fire('提示', (res && res.error) || '找不到該成員資料', 'info');
            }
        }, err => {
            Swal.close();
            Swal.fire('錯誤', '載入名片失敗：' + err, 'error');
        });
    }

    function computeAgeDisplay(ageRaw, birthdayStr, hasBirthday, birthdayPassed) {
        if (ageRaw === undefined || ageRaw === null) return '秘密 🤫';
        const clean = String(ageRaw).trim().replace(/[歲年]$/g, '').trim();
        if (!clean || clean === '秘密' || clean === '秘密 🤫') return '秘密 🤫';
        if (!/^\d+$/.test(clean)) return clean;

        const now = new Date();
        const currentYear = now.getFullYear();
        let num = parseInt(clean, 10);
        if (num <= 0) return '秘密 🤫';
        if (num > currentYear) num = currentYear;
        if (num <= 1899) return `永遠的${num}歲`;

        let age = currentYear - num;
        const bdayMatch = birthdayStr ? String(birthdayStr).trim().match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/) : null;
        if (bdayMatch) {
            const bMonth = parseInt(bdayMatch[1], 10);
            const bDay = parseInt(bdayMatch[2], 10);
            const curMonth = now.getMonth() + 1;
            const curDay = now.getDate();
            const passed = (curMonth > bMonth) || (curMonth === bMonth && curDay >= bDay);
            if (!passed) age -= 1;
        } else if (hasBirthday && birthdayPassed === false) {
            age -= 1;
        }
        return `${Math.max(0, age)}歲`;
    }

    function getMemberDisplayAge(member) {
        if (!member) return '秘密 🤫';
        if (member.ageRaw !== undefined) {
            return computeAgeDisplay(member.ageRaw, member.birthday, member.hasBirthday, member.birthdayPassed);
        }
        return member.age || '秘密 🤫';
    }

    function normalizeSocialUrl(platform, raw) {
        if (!raw) return '';
        const val = String(raw).trim();
        if (!val) return '';
        if (/^https?:\/\//i.test(val)) return val;
        if (/^[a-z][a-z0-9+.-]*:/i.test(val)) return '';

        if (/^(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\//i.test(val) ||
            /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\//i.test(val) ||
            /^(?:www\.|m\.)?(?:facebook\.com|fb\.com|fb\.me)\//i.test(val)) {
            return 'https://' + val;
        }

        const handle = val.replace(/^@+/, '').replace(/^\/+|\/+$/g, '').trim();
        if (!handle) return '';
        if (platform === 'instagram') return 'https://www.instagram.com/' + encodeURIComponent(handle);
        if (platform === 'x') return 'https://x.com/' + encodeURIComponent(handle);
        if (platform === 'facebook') return 'https://www.facebook.com/' + encodeURIComponent(handle);
        return '';
    }

    function renderSocialLinks(socialLinks) {
        const container = document.getElementById('cardSocialLinks');
        if (!container) return;
        const links = socialLinks && typeof socialLinks === 'object' ? socialLinks : {};
        let html = '';
        SOCIAL_PLATFORMS.forEach(p => {
            const url = normalizeSocialUrl(p.key, links[p.key]);
            if (url && /^https?:\/\//i.test(url)) {
                const safeUrl = escapeHtml(url);
                html += `<a class="social-link-btn" href="${safeUrl}" data-url="${safeUrl}" target="_blank" rel="noopener noreferrer" title="開啟 ${p.label}" aria-label="${p.label}" onclick="PortalApi.openExternalUrl(event, this.dataset.url)">${p.svg}</a>`;
            }
        });
        container.innerHTML = html;
        container.classList.toggle('has-links', html !== '');
    }

    function getBadgeInfo(badgeName) {
        const config = Store.titleConfig;
        if (!badgeName || !config) return { title: badgeName || '', desc: '' };
        const clean = String(badgeName).trim();

        const tiers = [config.hostTiers, config.joinTiers, config.unsendTiers, config.photoTiers];
        for (const list of tiers) {
            if (Array.isArray(list)) {
                for (const t of list) {
                    if (t && t.name && clean.includes(t.name)) return { title: clean, desc: t.desc || '' };
                }
            }
        }
        if (config.founderTitle && clean.includes(config.founderTitle)) return { title: clean, desc: config.founderDesc || '' };
        if (clean.includes('壽星')) return { title: clean, desc: config.birthdayDesc || '' };
        if (clean.includes('長舌冠軍')) return { title: clean, desc: config.rankChampionDesc || '' };
        if (clean.includes('長舌亞軍')) return { title: clean, desc: config.rankRunnerUpDesc || '' };
        if (clean.includes('長舌季軍')) return { title: clean, desc: config.rankThirdPlaceDesc || '' };
        if (clean.includes('長舌')) return { title: clean, desc: config.rankGeneralDesc || '' };
        if (config.customBadges && typeof config.customBadges === 'object') {
            for (const k of Object.keys(config.customBadges)) {
                if (clean.includes(k)) return { title: clean, desc: config.customBadges[k] || '' };
            }
        }
        return { title: clean, desc: '' };
    }

    function renderCardBadges(badges) {
        const el = document.getElementById('cardBadges');
        if (!el) return;
        let html = '';
        if (Array.isArray(badges) && badges.length > 0) {
            badges.forEach(b => {
                let cls = 'badge-pill';
                if (b.includes('冠軍') || b.includes('神')) cls += ' champion';
                else if (b.includes('達人') || b.includes('元老')) cls += ' gold';
                const info = getBadgeInfo(b);
                const safeB = escapeHtml(b);
                if (info && info.desc) {
                    html += `<button type="button" class="${cls}" data-badge="${safeB}" onclick="PortalProfile.showBadgeTooltip(event, this.dataset.badge)">${safeB}</button>`;
                } else {
                    html += `<span class="${cls}">${safeB}</span>`;
                }
            });
        } else {
            html = '<span style="font-size:0.86rem;color:var(--p-muted);">尚無成就稱號</span>';
        }
        el.innerHTML = html;
    }

    function canEditBirthday(targetUid) {
        if (!Store.currentUserId || !targetUid) return false;
        if (Store.isAdmin) return true;
        return Store.currentUserId.trim().toLowerCase() === String(targetUid).trim().toLowerCase();
    }

    function syncBirthdayCell(member) {
        const cell = document.getElementById('cardBirthdayCell');
        const valEl = document.getElementById('cardBirthday');
        const remindBadge = document.getElementById('cardBirthdayRemindBadge');
        const joinCell = document.getElementById('cardJoinDateCell');
        if (!cell || !valEl) return;

        if (member && canEditBirthday(member.id)) {
            cell.style.display = 'flex';
            if (joinCell) joinCell.style.gridColumn = '';
            const bdayVal = (typeof member.birthday === 'string') ? member.birthday.trim() : '';
            const isRemindOn = String(member.birthdayRemind || '').trim().toUpperCase() === 'Y';
            valEl.textContent = bdayVal || '未填寫';
            if (remindBadge) {
                remindBadge.textContent = isRemindOn ? '🔔' : '🔕';
                remindBadge.title = isRemindOn ? '生日提醒：已開啟' : '生日提醒：已關閉';
            }
        } else {
            cell.style.display = 'none';
            if (joinCell) joinCell.style.gridColumn = '';
        }
    }

    function updateEditVisibility() {
        const selfArea = document.getElementById('selfEditArea');
        const guestHint = document.getElementById('guestEditHint');
        if (!selectedMember) return;

        const isOwner = Boolean(
            Store.currentUserId && selectedMember.id &&
            Store.currentUserId.trim().toLowerCase() === String(selectedMember.id).trim().toLowerCase()
        );
        if (selfArea) selfArea.style.display = isOwner ? 'block' : 'none';
        if (guestHint) guestHint.style.display = (!Store.currentUserId) ? 'block' : 'none';
    }

    function renderAndOpen(member, sourceEl) {
        selectedMember = member;
        hideBadgeTooltip();

        document.getElementById('cardAvatar').src = member.pic || 'https://imgur.com/786FxAA.jpg';
        document.getElementById('cardName').textContent = member.name || '神秘群友';
        document.getElementById('cardJoinDays').textContent = `已加入 L>S 社群 ${member.joinDays || 1} 天`;
        renderSocialLinks(member.socialLinks);
        syncBirthdayCell(member);

        document.getElementById('cardAge').textContent = getMemberDisplayAge(member);
        document.getElementById('cardZodiac').textContent = member.zodiac || '秘密 🤫';
        document.getElementById('cardResidence').textContent = member.residence || '未填寫';
        document.getElementById('cardOccupation').textContent = member.occupation || '未填寫';
        document.getElementById('cardRelationship').textContent = member.relationship || '未填寫';
        document.getElementById('cardJoinDate').textContent = member.joinDate || '未填寫';
        document.getElementById('cardBio').textContent = member.bio || '這位朋友很神秘，還沒有留下自我介紹唷～';

        renderCardBadges(member.badges);

        document.getElementById('statHost').textContent = member.hostCount || 0;
        document.getElementById('statJoin').textContent = member.joinCount || 0;
        document.getElementById('statMsg').textContent = member.textCount || 0;
        document.getElementById('statSticker').textContent = member.stickerCount || 0;
        document.getElementById('statUnsend').textContent = member.unsendCount || 0;
        document.getElementById('statDailyMsg').textContent = member.dailyMsg || 0;
        document.getElementById('statMonthMsg').textContent = member.monthMsg || 0;
        document.getElementById('statYearMsg').textContent = member.yearMsg || 0;

        updateEditVisibility();
        animateOpen(member.id, sourceEl);
    }

    function findAvatarElement(userId, sourceEl) {
        if (sourceEl) {
            if (sourceEl.tagName === 'IMG') return sourceEl;
            const img = sourceEl.querySelector('img');
            if (img) return img;
        }
        if (!userId) return null;
        const lower = String(userId).trim().toLowerCase();
        const el = document.querySelector(`[data-member-id="${CSS.escape(lower)}"] img`);
        return el || null;
    }

    function cleanupProfileAnimations() {
        profileAnimState.animations.forEach(a => { try { a.cancel(); } catch (e) {} });
        profileAnimState.animations = [];
        if (profileAnimState.ghostEl && profileAnimState.ghostEl.parentNode) {
            profileAnimState.ghostEl.parentNode.removeChild(profileAnimState.ghostEl);
        }
        profileAnimState.ghostEl = null;
        if (profileAnimState.hiddenSourceAvatar) {
            profileAnimState.hiddenSourceAvatar.style.visibility = '';
            profileAnimState.hiddenSourceAvatar = null;
        }
        const cardAvatar = document.getElementById('cardAvatar');
        if (cardAvatar) cardAvatar.style.visibility = '';
    }

    function animateOpen(userId, sourceEl) {
        const overlay = document.getElementById('profileModalOverlay');
        const modal = overlay ? overlay.querySelector('.profile-card-modal') : null;
        const cardAvatar = document.getElementById('cardAvatar');
        if (!overlay || !modal || !cardAvatar) return;

        const token = ++profileAnimState.token;
        profileAnimState.isClosing = false;
        profileAnimState.userId = userId;
        profileAnimState.sourceEl = sourceEl || null;
        cleanupProfileAnimations();

        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!modal.animate || prefersReduced) {
            overlay.classList.add('active');
            return;
        }

        const sourceAvatar = findAvatarElement(userId, sourceEl);
        const sourceRect = sourceAvatar ? sourceAvatar.getBoundingClientRect() : null;
        const hasVisibleSource = Boolean(sourceRect && sourceRect.width > 0 && sourceRect.bottom > 0 && sourceRect.top < window.innerHeight);

        overlay.classList.add('active');
        overlay.style.backgroundColor = 'rgba(22, 34, 29, 0)';
        modal.style.visibility = 'hidden';
        modal.style.opacity = '0';
        cardAvatar.style.visibility = 'hidden';

        const targetRect = cardAvatar.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        const maxRadius = Math.ceil(Math.hypot(modalRect.width / 2, modalRect.height / 2)) + 8;

        const midCx = window.innerWidth / 2;
        const midCy = window.innerHeight / 2;
        const toCx = targetRect.left + targetRect.width / 2;
        const toCy = targetRect.top + targetRect.height / 2;
        const toScale = (targetRect.width || 84) / 80;

        const fromCx = hasVisibleSource ? (sourceRect.left + sourceRect.width / 2) : midCx;
        const fromCy = hasVisibleSource ? (sourceRect.top + sourceRect.height / 2) : midCy;
        const fromScale = hasVisibleSource ? ((sourceRect.width || 60) / 80) : 0.6;

        const ghost = document.createElement('img');
        ghost.className = 'floating-avatar-ghost';
        ghost.src = (sourceAvatar && (sourceAvatar.currentSrc || sourceAvatar.src)) || cardAvatar.currentSrc || cardAvatar.src;
        ghost.alt = '';
        ghost.style.transform = `translate3d(${fromCx - 40}px, ${fromCy - 40}px, 0) scale(${fromScale})`;
        ghost.style.opacity = hasVisibleSource ? '1' : '0';
        document.body.appendChild(ghost);
        profileAnimState.ghostEl = ghost;

        if (hasVisibleSource && sourceAvatar) {
            sourceAvatar.style.visibility = 'hidden';
            profileAnimState.hiddenSourceAvatar = sourceAvatar;
        }

        requestAnimationFrame(() => {
            if (profileAnimState.token !== token) return;
            const g1 = ghost.animate([
                { transform: `translate3d(${fromCx - 40}px, ${fromCy - 40}px, 0) scale(${fromScale})`, opacity: hasVisibleSource ? 1 : 0 },
                { transform: `translate3d(${midCx - 40}px, ${midCy - 40}px, 0) scale(1.1)`, opacity: 1 }
            ], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });

            const o1 = overlay.animate([
                { backgroundColor: 'rgba(22, 34, 29, 0)' },
                { backgroundColor: 'rgba(22, 34, 29, 0.36)' }
            ], { duration: 280, easing: 'ease-out', fill: 'forwards' });

            profileAnimState.animations = [g1, o1];
            Promise.all([g1.finished, o1.finished]).then(() => {
                if (profileAnimState.token !== token) return;
                modal.style.visibility = 'visible';

                const g2 = ghost.animate([
                    { transform: `translate3d(${midCx - 40}px, ${midCy - 40}px, 0) scale(1.1)` },
                    { transform: `translate3d(${toCx - 40}px, ${toCy - 40}px, 0) scale(${toScale})` }
                ], { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });

                const o2 = overlay.animate([
                    { backgroundColor: 'rgba(22, 34, 29, 0.36)' },
                    { backgroundColor: 'rgba(22, 34, 29, 0.56)' }
                ], { duration: 240, easing: 'ease-out', fill: 'forwards' });

                const m2 = modal.animate([
                    { opacity: 0.25, clipPath: 'circle(38px at 50% 50%)', transform: 'scale(0.92)' },
                    { opacity: 1, clipPath: `circle(${maxRadius}px at 50% 50%)`, transform: 'scale(1)' }
                ], { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });

                profileAnimState.animations = [g2, o2, m2];
                Promise.all(profileAnimState.animations.map(a => a.finished)).then(() => {
                    if (profileAnimState.token !== token) return;
                    cleanupProfileAnimations();
                    overlay.style.backgroundColor = '';
                    modal.style.visibility = '';
                    modal.style.opacity = '';
                    modal.style.transform = '';
                    modal.style.clipPath = '';
                }).catch(() => {});
            }).catch(() => {});
        });
    }

    function close() {
        hideBadgeTooltip();
        const overlay = document.getElementById('profileModalOverlay');
        const modal = overlay ? overlay.querySelector('.profile-card-modal') : null;
        if (!overlay || !overlay.classList.contains('active')) return;
        if (profileAnimState.isClosing) return;

        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!modal || !modal.animate || prefersReduced) {
            cleanupProfileAnimations();
            overlay.classList.remove('active');
            return;
        }

        const token = ++profileAnimState.token;
        profileAnimState.isClosing = true;
        cleanupProfileAnimations();

        const mAnim = modal.animate([
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(0.94)' }
        ], { duration: 160, easing: 'ease-in', fill: 'forwards' });

        const oAnim = overlay.animate([
            { backgroundColor: 'rgba(22, 34, 29, 0.56)' },
            { backgroundColor: 'rgba(22, 34, 29, 0)' }
        ], { duration: 160, easing: 'ease-in', fill: 'forwards' });

        profileAnimState.animations = [mAnim, oAnim];
        Promise.all([mAnim.finished, oAnim.finished]).then(() => {
            if (profileAnimState.token !== token) return;
            profileAnimState.isClosing = false;
            cleanupProfileAnimations();
            overlay.classList.remove('active');
            overlay.style.backgroundColor = '';
            modal.style.opacity = '';
            modal.style.transform = '';
        }).catch(() => {});
    }

    function handleCardClick(event) {
        event.stopPropagation();
        if (!event.target.closest('.badge-pill') && !event.target.closest('.badge-tooltip')) {
            hideBadgeTooltip();
        }
    }

    function showBadgeTooltip(event, badgeName) {
        event.stopPropagation();
        const tooltip = document.getElementById('badgeTooltip');
        const modal = document.querySelector('.profile-card-modal');
        const badgeEl = event.currentTarget;
        if (!tooltip || !modal || !badgeEl) return;

        if (tooltip.dataset.activeBadge === badgeName && tooltip.classList.contains('active')) {
            hideBadgeTooltip();
            return;
        }

        const info = getBadgeInfo(badgeName);
        if (!info || !info.desc) {
            hideBadgeTooltip();
            return;
        }

        document.getElementById('badgeTooltipTitle').textContent = info.title;
        document.getElementById('badgeTooltipDesc').textContent = '💡 來源：' + info.desc;
        tooltip.dataset.activeBadge = badgeName;
        tooltip.style.display = 'block';
        tooltip.style.visibility = 'hidden';

        const modalRect = modal.getBoundingClientRect();
        const badgeRect = badgeEl.getBoundingClientRect();
        const tipW = tooltip.offsetWidth || 240;
        const tipH = tooltip.offsetHeight || 60;

        let left = (badgeRect.left + badgeRect.width / 2) - modalRect.left - (tipW / 2);
        let top = (badgeRect.top - modalRect.top) - tipH - 8;
        if (top < 64) top = (badgeRect.bottom - modalRect.top) + 8;
        left = Math.max(14, Math.min(modalRect.width - tipW - 14, left));

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        tooltip.style.visibility = 'visible';
        requestAnimationFrame(() => tooltip.classList.add('active'));
    }

    function hideBadgeTooltip() {
        const tooltip = document.getElementById('badgeTooltip');
        if (!tooltip) return;
        tooltip.classList.remove('active');
        tooltip.dataset.activeBadge = '';
        setTimeout(() => {
            if (!tooltip.classList.contains('active')) tooltip.style.display = 'none';
        }, 150);
    }

    function clampBirthYearInput(inputEl) {
        if (!inputEl) return;
        const val = String(inputEl.value || '').trim();
        if (!val || !/^\d+$/.test(val)) return;
        const num = parseInt(val, 10);
        const curY = new Date().getFullYear();
        if (num > curY) inputEl.value = String(curY);
    }

    function openEditModal() {
        if (!selectedMember) return;
        const rawAge = (selectedMember.ageRaw !== undefined)
            ? String(selectedMember.ageRaw || '')
            : ((selectedMember.age && !String(selectedMember.age).includes('秘密'))
                ? String(selectedMember.age).replace(/[^\d]/g, '')
                : '');
        const social = selectedMember.socialLinks || {};

        document.getElementById('editAge').value = rawAge;
        document.getElementById('editResidence').value = (selectedMember.residence !== '未填寫') ? selectedMember.residence : '';
        document.getElementById('editOccupation').value = (selectedMember.occupation !== '未填寫') ? selectedMember.occupation : '';
        document.getElementById('editRelationship').value = (selectedMember.relationship !== '未填寫') ? selectedMember.relationship : '單身 🟢';
        document.getElementById('editInstagram').value = social.instagram || '';
        document.getElementById('editX').value = social.x || '';
        document.getElementById('editFacebook').value = social.facebook || '';
        document.getElementById('editBio').value = (selectedMember.bio !== '這位朋友很神秘，還沒有留下自我介紹唷～') ? selectedMember.bio : '';

        document.getElementById('editProfileOverlay').classList.add('is-open');
    }

    function closeEditModal() {
        document.getElementById('editProfileOverlay').classList.remove('is-open');
    }

    function submitEdit() {
        if (!Store.currentUserId || !selectedMember) return;

        const ageEl = document.getElementById('editAge');
        let ageRaw = ageEl.value.trim();
        if (ageRaw !== '') {
            if (!/^\d+$/.test(ageRaw) || Number(ageRaw) <= 0) {
                Swal.fire('格式錯誤', '年齡／出生年請輸入大於 0 的整數，或留空顯示秘密', 'warning');
                return;
            }
            const curY = new Date().getFullYear();
            if (Number(ageRaw) > curY) {
                ageRaw = String(curY);
                ageEl.value = ageRaw;
            }
        }

        const igRaw = document.getElementById('editInstagram').value.trim();
        const xRaw = document.getElementById('editX').value.trim();
        const fbRaw = document.getElementById('editFacebook').value.trim();
        const igUrl = normalizeSocialUrl('instagram', igRaw);
        const xUrl = normalizeSocialUrl('x', xRaw);
        const fbUrl = normalizeSocialUrl('facebook', fbRaw);

        if ((igRaw && !igUrl) || (xRaw && !xUrl) || (fbRaw && !fbUrl)) {
            Swal.fire('連結格式錯誤', '社群媒體連結僅支援 http/https 網址或帳號名稱', 'warning');
            return;
        }

        const socialLinks = { instagram: igUrl, x: xUrl, facebook: fbUrl };
        const res = document.getElementById('editResidence').value.trim();
        const occ = document.getElementById('editOccupation').value.trim();
        const rel = document.getElementById('editRelationship').value;
        const bio = document.getElementById('editBio').value.trim();

        const btn = document.getElementById('btnSaveProfile');
        btn.disabled = true;
        btn.textContent = '儲存中...';

        callGasApi('members', 'updateProfile', {
            userId: Store.currentUserId,
            residence: res,
            occupation: occ,
            relationship: rel,
            bio: bio,
            age: ageRaw,
            socialLinks: socialLinks
        }, response => {
            btn.disabled = false;
            btn.textContent = '儲存名片';
            if (response && response.success) {
                const updated = response.updated || {};
                selectedMember.ageRaw = (updated.ageRaw !== undefined) ? updated.ageRaw : ageRaw;
                if (typeof updated.hasBirthday === 'boolean') selectedMember.hasBirthday = updated.hasBirthday;
                if (typeof updated.birthdayPassed === 'boolean') selectedMember.birthdayPassed = updated.birthdayPassed;
                selectedMember.age = getMemberDisplayAge(selectedMember);
                selectedMember.residence = updated.residence || (res || '未填寫');
                selectedMember.occupation = updated.occupation || (occ || '未填寫');
                selectedMember.relationship = updated.relationship || rel;
                selectedMember.bio = updated.bio !== undefined ? updated.bio : bio;
                selectedMember.socialLinks = updated.socialLinks || socialLinks;

                document.getElementById('cardAge').textContent = selectedMember.age;
                document.getElementById('cardResidence').textContent = selectedMember.residence;
                document.getElementById('cardOccupation').textContent = selectedMember.occupation;
                document.getElementById('cardRelationship').textContent = selectedMember.relationship;
                document.getElementById('cardBio').textContent = selectedMember.bio || '這位朋友很神秘，還沒有留下自我介紹唷～';
                renderSocialLinks(selectedMember.socialLinks);

                closeEditModal();
                if (window.PortalMembers) window.PortalMembers.renderGrid();

                Swal.fire({
                    icon: 'success',
                    title: '名片更新成功！',
                    timer: 1500,
                    showConfirmButton: false,
                    toast: true,
                    position: 'top'
                });
            } else {
                Swal.fire('儲存失敗', (response && response.error) || '未知錯誤', 'error');
            }
        }, err => {
            btn.disabled = false;
            btn.textContent = '儲存名片';
            Swal.fire('系統錯誤', String(err), 'error');
        });
    }

    function openEditBirthdayDialog(event) {
        if (event) event.stopPropagation();
        if (!selectedMember || !canEditBirthday(selectedMember.id)) return;

        const currentBday = (typeof selectedMember.birthday === 'string') ? selectedMember.birthday.trim() : '';
        const currentRemindOn = String(selectedMember.birthdayRemind || '').trim().toUpperCase() === 'Y';
        let initMonth = '';
        let initDay = '';
        const match = currentBday.match(/^(\d{1,2})[-/](\d{1,2})$/);
        if (match) {
            initMonth = match[1].padStart(2, '0');
            initDay = match[2].padStart(2, '0');
        }

        let monthOptions = '<option value="">-- 空白 --</option>';
        for (let m = 1; m <= 12; m++) {
            const val = String(m).padStart(2, '0');
            monthOptions += `<option value="${val}" ${val === initMonth ? 'selected' : ''}>${val} 月</option>`;
        }

        const buildDayOptions = (mStr, sDay) => {
            const maxDays = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            const mNum = parseInt(mStr, 10);
            const maxD = (mNum >= 1 && mNum <= 12) ? maxDays[mNum] : 31;
            let opts = '<option value="">-- 空白 --</option>';
            for (let d = 1; d <= maxD; d++) {
                const val = String(d).padStart(2, '0');
                opts += `<option value="${val}" ${val === sDay ? 'selected' : ''}>${val} 日</option>`;
            }
            return opts;
        };

        Swal.fire({
            title: `🎂 修改「${escapeHtml(selectedMember.name)}」的生日`,
            html: `
                <div style="text-align:left;font-size:0.86rem;color:#52635c;margin-bottom:8px;">
                    設定為「-- 空白 --」即可清除生日欄位（僅管理群與本人可見）。
                </div>
                <div style="display:flex;gap:10px;margin-bottom:10px;">
                    <select id="swalBdayMonth" class="field-select" style="flex:1;">${monthOptions}</select>
                    <select id="swalBdayDay" class="field-select" style="flex:1;">${buildDayOptions(initMonth, initDay)}</select>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:8px;">
                    <span style="font-size:0.9rem;font-weight:600;">🔔 生日當天推播提醒</span>
                    <input type="checkbox" id="swalBdayRemindSwitch" style="width:20px;height:20px;accent-color:#3a6e59;" ${currentRemindOn ? 'checked' : ''}>
                </div>
                <div style="text-align:right;">
                    <button type="button" id="swalBtnClearBday" class="btn btn--secondary btn--compact">🗑️ 清空為空白</button>
                </div>
            `,
            showCancelButton: true,
            reverseButtons: true,
            confirmButtonColor: '#3a6e59',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '儲存設定',
            cancelButtonText: '取消',
            didOpen: () => {
                const mSel = document.getElementById('swalBdayMonth');
                const dSel = document.getElementById('swalBdayDay');
                const syncDay = () => {
                    if (!mSel.value) {
                        dSel.innerHTML = buildDayOptions('', '');
                        dSel.value = '';
                        dSel.disabled = true;
                    } else {
                        const prev = dSel.value;
                        dSel.disabled = false;
                        dSel.innerHTML = buildDayOptions(mSel.value, prev);
                        if (prev && !Array.from(dSel.options).some(o => o.value === prev)) dSel.value = '';
                    }
                };
                syncDay();
                mSel.addEventListener('change', syncDay);
                document.getElementById('swalBtnClearBday').addEventListener('click', () => {
                    mSel.value = '';
                    syncDay();
                });
            },
            preConfirm: () => {
                const mVal = document.getElementById('swalBdayMonth').value;
                const dVal = document.getElementById('swalBdayDay').value;
                const remind = document.getElementById('swalBdayRemindSwitch').checked;
                if ((mVal && !dVal) || (!mVal && dVal)) {
                    Swal.showValidationMessage('請同時選擇月份與日期，或皆設為空白');
                    return false;
                }
                return { birthday: (mVal && dVal) ? `${mVal}-${dVal}` : '', birthdayRemind: remind ? 'Y' : 'N' };
            }
        }).then(result => {
            if (result.isConfirmed && result.value) {
                submitBirthdayUpdate(selectedMember.id, result.value.birthday, result.value.birthdayRemind);
            }
        });
    }

    function submitBirthdayUpdate(targetUid, newBday, newRemind) {
        Swal.fire({ title: '儲存設定中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        callGasApi('members', 'updateMemberBirthday', {
            operatorUserId: Store.currentUserId,
            targetUserId: targetUid,
            birthday: newBday,
            birthdayRemind: newRemind
        }, res => {
            if (res && res.success) {
                const updated = res.updated || {};
                const target = window.PortalApi.findMemberById(targetUid);
                [target, selectedMember].forEach(obj => {
                    if (!obj) return;
                    obj.birthday = (typeof updated.birthday === 'string') ? updated.birthday : newBday;
                    obj.birthdayRemind = updated.birthdayRemind || newRemind;
                    obj.zodiac = updated.zodiac || '秘密 🤫';
                    if (Array.isArray(updated.badges)) obj.badges = updated.badges;
                });

                syncBirthdayCell(selectedMember);
                document.getElementById('cardZodiac').textContent = selectedMember.zodiac;
                renderCardBadges(selectedMember.badges);
                if (window.PortalMembers) window.PortalMembers.renderGrid();

                Swal.fire({
                    icon: 'success',
                    title: selectedMember.birthday ? `已更新生日為 ${selectedMember.birthday}` : '已清空生日欄位',
                    timer: 1600,
                    showConfirmButton: false,
                    toast: true,
                    position: 'top'
                });
            } else {
                Swal.fire('更新失敗', (res && res.error) || '未知錯誤', 'error');
            }
        }, err => {
            Swal.fire('系統錯誤', String(err), 'error');
        });
    }

    function showImgLightbox(url, sourceEl) {
        if (!url) return;
        const lightbox = document.getElementById('imgLightbox');
        const img = document.getElementById('lightboxImage');
        if (!lightbox || !img) return;
        img.src = url;
        imgLightboxAnimState.sourceEl = sourceEl || null;
        lightbox.classList.add('active');
    }

    function closeImgLightbox() {
        const lightbox = document.getElementById('imgLightbox');
        if (lightbox) lightbox.classList.remove('active');
    }

    return {
        init,
        openByUserId,
        close,
        handleCardClick,
        showBadgeTooltip,
        hideBadgeTooltip,
        clampBirthYearInput,
        openEditModal,
        closeEditModal,
        submitEdit,
        openEditBirthdayDialog,
        showImgLightbox,
        closeImgLightbox,
        refreshSelectedMember: () => {
            if (!selectedMember) return;
            const latest = window.PortalApi.findMemberById(selectedMember.id);
            if (latest) {
                selectedMember = latest;
                syncBirthdayCell(latest);
                updateEditVisibility();
            }
        }
    };
})();

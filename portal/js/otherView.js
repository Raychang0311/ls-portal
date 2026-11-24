/**
 * L>S Portal — 其他（每日群聊熱度圖表 + 機器人咒語小抄）
 */
window.PortalOther = (function() {
    const { Store, callGasApi, escapeHtml } = window.PortalApi;

    let toolboxLoading = false;
    let toolboxLoaded = false;
    let dailyChat = [];
    let chartRange = 30; // 30 | 90 | 365 | 0 (全部)
    let cmdCategory = 'all';
    let cmdSearch = '';
    let eventsBound = false;

    // 由 chatbot/ls-chatbot.js 完整抽出的現役文字咒語與用途說明
    const BOT_COMMANDS = [
        // --- 揪團活動 ---
        { cat: 'group', cmd: '所有揪團', aliases: ['全部揪團', '全部活動', '所有活動'], desc: '顯示目前所有進行中的揪團卡片輪播（超過 12 團自動切換雙層、超過 24 團自動改精簡列表）。', copy: '所有揪團' },
        { cat: 'group', cmd: '精簡揪團', aliases: ['揪團精簡'], desc: '以精簡清單形式列出目前所有進行中揪團，適合團數較多時快速瀏覽。', copy: '精簡揪團' },
        { cat: 'group', cmd: '我的揪團', aliases: ['我的活動'], desc: '查詢由你本人擔任主揪的進行中揪團清單。', copy: '我的揪團' },
        { cat: 'group', cmd: '我的參團', aliases: ['我加的團', '我加入的揪團', '我參加的揪團', '我加入的團', '我參加的團'], desc: '查詢你目前已報名參加的所有進行中揪團。', copy: '我的參團' },
        { cat: 'group', cmd: '本月揪團', aliases: ['當月揪團', '本月活動', '當月活動'], desc: '篩選並列出本月份開始的所有進行中揪團。', copy: '本月揪團' },
        { cat: 'group', cmd: '次月揪團', aliases: ['次月活動'], desc: '篩選並列出下個月開始的所有進行中揪團。', copy: '次月揪團' },
        { cat: 'group', cmd: '揪團搜尋#關鍵字', aliases: ['揪團查詢#關鍵字'], desc: '依關鍵字（至少 2 字）搜尋揪團標題與活動內文。', copy: '揪團搜尋#' },
        { cat: 'group', cmd: '揪團備註#團號#備註', aliases: ['修改備註#團號#備註'], desc: '為已報名或候補中的揪團填寫／更新個人備註（如開車+1、會晚到）。', copy: '揪團備註#' },
        { cat: 'group', cmd: '我要揪團', aliases: ['懶人揪團'], desc: '取得建立揪團表單的專屬連結卡片。', copy: '我要揪團' },
        { cat: 'group', cmd: '修改揪團', aliases: [], desc: '僅限「私訊機器人聊天室」使用，列出你主揪的揪團供點選編輯。', copy: '修改揪團' },
        { cat: 'group', cmd: '揪團歷史', aliases: ['歷史揪團', '揪團大事記'], desc: '取得揪團大事記歷史紀錄頁面入口卡片。', copy: '揪團歷史' },

        // --- 排行榜與個人戰績 ---
        { cat: 'rank', cmd: '所有排行榜', aliases: [], desc: '開啟排行榜總覽選單，一次瀏覽群組各項排行入口。', copy: '所有排行榜' },
        { cat: 'rank', cmd: '本日長舌', aliases: ['本日排行榜', '今日排行榜', '本日長舌排行榜', '今日長舌排行榜', '今日長舌'], desc: '查看今日群組發言活躍度前 15 名（以舌頭公分計算）。', copy: '本日長舌' },
        { cat: 'rank', cmd: '本月長舌', aliases: ['本月排行榜', '本月長舌排行榜'], desc: '查看本月群組發言活躍度前 15 名（月底結算前 3 名授予永久勳章）。', copy: '本月長舌' },
        { cat: 'rank', cmd: '年度長舌', aliases: ['年度排行榜', '年度長舌排行榜'], desc: '查看本年度累積發言活躍度前 15 名。', copy: '年度長舌' },
        { cat: 'rank', cmd: '發言排行榜', aliases: [], desc: '歷史總文字訊息數前 15 名排行。', copy: '發言排行榜' },
        { cat: 'rank', cmd: '說話不算話排行榜', aliases: [], desc: '收回訊息累計次數前 15 名排行。', copy: '說話不算話排行榜' },
        { cat: 'rank', cmd: '圖片排行榜', aliases: [], desc: '在群組傳送圖片次數前 15 名排行。', copy: '圖片排行榜' },
        { cat: 'rank', cmd: '影片排行榜', aliases: [], desc: '在群組傳送影片次數前 15 名排行。', copy: '影片排行榜' },
        { cat: 'rank', cmd: '連結排行榜', aliases: [], desc: '在群組分享網址連結次數前 15 名排行。', copy: '連結排行榜' },
        { cat: 'rank', cmd: '貼圖排行榜', aliases: [], desc: '在群組傳送貼圖次數前 15 名排行。', copy: '貼圖排行榜' },
        { cat: 'rank', cmd: '老屁股排行榜', aliases: ['老人排行榜'], desc: '依入群時間由早到晚排序的資深群友榜。', copy: '老屁股排行榜' },
        { cat: 'rank', cmd: '菜逼八排行榜', aliases: ['新人排行榜'], desc: '依入群時間由新到舊排序的新進群友榜。', copy: '菜逼八排行榜' },
        { cat: 'rank', cmd: '揪團排行榜', aliases: ['團主排行榜'], desc: '主辦揪團累積次數前 15 名排行。', copy: '揪團排行榜' },
        { cat: 'rank', cmd: '參團排行榜', aliases: ['參加排行榜'], desc: '參加揪團累積次數前 15 名排行。', copy: '參團排行榜' },
        { cat: 'rank', cmd: '省話排行榜', aliases: ['少話排行榜'], desc: '依「入群天數 ÷ 總發言數」排行，平均幾天講一句話的最省話王。', copy: '省話排行榜' },
        { cat: 'rank', cmd: '厚話排行榜', aliases: ['多話排行榜', '搞威排行榜'], desc: '依「總發言數 ÷ 入群天數」排行，日均發言數最高的話癆王。', copy: '厚話排行榜' },
        { cat: 'rank', cmd: '消失排行榜', aliases: ['消失紀錄表', '消失記錄表'], desc: '列出超過 10 天未在群組發言的潛水群友名單。', copy: '消失排行榜' },
        { cat: 'rank', cmd: '我的紀錄', aliases: ['我的記錄', '我的報告', '我的歷史'], desc: '產生個人完整數據 Flex 成績單（含入群日、各項統計、舌頭比例與全群排名）。', copy: '我的紀錄' },
        { cat: 'rank', cmd: '我的長舌', aliases: ['我的舌頭'], desc: '查詢自己今日與本月的舌頭長度（cm）與全群訊息佔比。', copy: '我的長舌' },
        { cat: 'rank', cmd: '我的發言', aliases: ['我的發言次數', '我的收回', '我的圖片', '我的影片', '我的連結', '我的貼圖', '我的入群日', '我的揪團次數', '我的參團次數'], desc: '單項快速查詢自己的發言、收回、媒體、入群日或開／參團次數。', copy: '我的發言' },

        // --- 訊息量統計 ---
        { cat: 'stats', cmd: '今日訊息數', aliases: ['今日訊息', '今日訊息量', '本日訊息數', '本日訊息', '本日訊息量'], desc: '統計全體成員今日累計發送的群組訊息總量。', copy: '今日訊息數' },
        { cat: 'stats', cmd: '昨日訊息數', aliases: ['昨日訊息', '昨日訊息量'], desc: '查詢昨日結算的群組總訊息量。', copy: '昨日訊息數' },
        { cat: 'stats', cmd: '每日訊息圖表', aliases: ['每日訊息', '每日訊息表'], desc: '由機器人產生並回覆每日群組訊息量折線圖圖片。', copy: '每日訊息圖表' },

        // --- 星座與氣象 ---
        { cat: 'weather', cmd: '今日運勢', aliases: ['星座今日運勢', '星座運勢'], desc: '一次取得 12 星座今日運勢輪播卡片（含整體、愛情、事業、財運）。', copy: '今日運勢' },
        { cat: 'weather', cmd: '雙魚座', aliases: ['牡羊座 / 金牛座 / 雙子座... 或 星座+今日運勢'], desc: '輸入任一星座名稱（支援 12 星座），單獨查詢該星座今日運勢。', copy: '雙魚座' },
        { cat: 'weather', cmd: '溫度分布圖', aliases: ['溫度圖', '溫度分佈圖', '溫度分布', '溫度分佈'], desc: '向中央氣象署抓取最新全台溫度分布圖。', copy: '溫度分布圖' },
        { cat: 'weather', cmd: '雷達回波圖', aliases: ['衛星雲圖', '雷達回波'], desc: '抓取中央氣象署最新雷達回波即時影像。', copy: '雷達回波圖' },
        { cat: 'weather', cmd: '雨量圖', aliases: [], desc: '向中央氣象署抓取最新全台累積雨量分布圖。', copy: '雨量圖' },
        { cat: 'weather', cmd: '地震報告', aliases: [], desc: '查詢中央氣象署最新顯著／小區域有感地震報告圖卡。', copy: '地震報告' },

        // --- 趣味搜尋與召喚 ---
        { cat: 'fun', cmd: 'GPT 問題或對話', aliases: [], desc: '呼叫 OpenAI GPT 模型以「機機」人設回答問題並進行網路搜尋。', copy: 'GPT ' },
        { cat: 'fun', cmd: '孤狗 問題或內容', aliases: ['谷歌 問題或內容', 'gemini 問題或內容'], desc: '呼叫 Gemini 模型進行 Google 網路搜尋並回答提問。', copy: '孤狗 ' },
        { cat: 'fun', cmd: '召喚貓貓', aliases: ['召喚貓咪', '召喚卯咪'], desc: '隨機召喚一張可愛貓咪照片。', copy: '召喚貓貓' },
        { cat: 'fun', cmd: '召喚狗狗', aliases: ['召喚狗勾'], desc: '隨機召喚一張可愛狗狗照片。', copy: '召喚狗狗' },
        { cat: 'fun', cmd: '召喚柴柴', aliases: ['召喚+犬種或貓種名稱（如 召喚柯基、召喚布偶）'], desc: '依品種對照表召喚指定品種的貓咪或狗狗圖片。', copy: '召喚柴柴' },
        { cat: 'fun', cmd: '機機CALL 關鍵字', aliases: ['GGCALL 關鍵字', '機機摳 關鍵字'], desc: '搜尋 YouTube 並回覆最相關的影片預覽卡片與連結。', copy: '機機CALL ' },
        { cat: 'fun', cmd: '機機 關鍵字.jpg', aliases: ['GG 關鍵字.jpg / .jpeg / .gif / .png'], desc: '以 Google 圖片搜尋指定關鍵字並隨機回覆一張圖片或 GIF 動圖。', copy: '機機 .jpg' },

        // --- 社群功能與公告 ---
        { cat: 'portal', cmd: '機機首頁', aliases: ['入口網站', '機機入口', '機機主頁', '主頁', '首頁'], desc: '呼叫 L>S 整合入口網站導覽卡片，快速跳轉各大分頁。', copy: '機機首頁' },
        { cat: 'portal', cmd: '機機功能', aliases: [], desc: '顯示機器人內建功能介紹 Flex 卡片。', copy: '機機功能' },
        { cat: 'portal', cmd: '所有群友', aliases: ['所有成員', '群組名冊', '群友名冊', '所有名片', '群組名片', '成員名冊', '成員名片'], desc: '取得群友名冊與數位名片入口卡片。', copy: '所有群友' },
        { cat: 'portal', cmd: '退群紀錄', aliases: ['退群歷史', '退群名單', '退群記錄'], desc: '取得群組歷年退群紀錄頁面入口卡片。', copy: '退群紀錄' },
        { cat: 'portal', cmd: '所有公告', aliases: [], desc: '顯示目前群組所有進行中的置頂公告輪播。', copy: '所有公告' },
        { cat: 'portal', cmd: '公告:公告內容', aliases: ['公告：公告內容（限管理群）'], desc: '管理群專用咒語：發布新群組公告（含網址時會自動加上開啟連結按鈕）。', copy: '公告:' },
        { cat: 'portal', cmd: '修改公告 #編號 新內容', aliases: ['（限管理群）'], desc: '管理群專用咒語：修改指定 5 碼編號的既有公告內容。', copy: '修改公告 #' }
    ];

    const CATEGORY_LABELS = {
        all: '全部咒語',
        group: '🎪 揪團',
        rank: '🏆 排行與戰績',
        stats: '📊 訊息量',
        weather: '✨ 星座氣象',
        fun: '🐾 召喚搜尋',
        portal: '📌 社群公告'
    };

    function ensureLoaded() {
        bindEvents();
        renderCommands();
        if (toolboxLoaded) {
            renderChatChart();
            return;
        }
        loadToolboxData();
    }

    function bindEvents() {
        if (eventsBound) return;
        eventsBound = true;

        document.querySelectorAll('#otherChartRanges [data-range]').forEach(btn => {
            btn.addEventListener('click', () => {
                chartRange = parseInt(btn.dataset.range, 10) || 0;
                document.querySelectorAll('#otherChartRanges [data-range]').forEach(b => b.classList.toggle('is-active', b === btn));
                renderChatChart();
            });
        });

        const searchIn = document.getElementById('otherCmdSearchInput');
        const clearBtn = document.getElementById('otherCmdClearBtn');
        if (searchIn) {
            searchIn.addEventListener('input', () => {
                cmdSearch = searchIn.value.trim();
                if (clearBtn) clearBtn.classList.toggle('visible', searchIn.value.length > 0);
                renderCommands();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchIn) { searchIn.value = ''; searchIn.focus(); }
                cmdSearch = '';
                clearBtn.classList.remove('visible');
                renderCommands();
            });
        }

        document.querySelectorAll('#otherCmdCats [data-cat]').forEach(btn => {
            btn.addEventListener('click', () => {
                cmdCategory = btn.dataset.cat || 'all';
                document.querySelectorAll('#otherCmdCats [data-cat]').forEach(b => b.classList.toggle('is-active', b === btn));
                renderCommands();
            });
        });
    }

    function loadToolboxData() {
        if (toolboxLoading) return;
        toolboxLoading = true;
        const chartLoading = document.getElementById('otherChartLoading');
        const chartContent = document.getElementById('otherChartWrap');
        if (chartLoading) chartLoading.style.display = 'flex';
        if (chartContent) chartContent.style.display = 'none';

        callGasApi('members', 'getCommunityToolbox', {}, res => {
            toolboxLoading = false;
            if (chartLoading) chartLoading.style.display = 'none';
            if (!res || !res.success) {
                if (chartContent) {
                    chartContent.style.display = 'block';
                    chartContent.innerHTML = `<div class="empty-panel"><div class="empty-title">暫時無法載入熱度數據</div><div class="empty-desc">${escapeHtml((res && res.error) || '請確認 members.js 已更新部署')}</div></div>`;
                }
                return;
            }
            toolboxLoaded = true;
            dailyChat = Array.isArray(res.dailyChat) ? res.dailyChat : [];
            if (Store) Store.toolboxLoaded = true;
            renderChatChart();
        }, err => {
            toolboxLoading = false;
            if (chartLoading) chartLoading.style.display = 'none';
            if (chartContent) {
                chartContent.style.display = 'block';
                chartContent.innerHTML = `<div class="empty-panel"><div class="empty-title">連線後端失敗</div><div class="empty-desc">${escapeHtml(err)}</div></div>`;
            }
        }, { preferGet: true });
    }

    function renderChatChart() {
        const wrap = document.getElementById('otherChartWrap');
        const kpiEl = document.getElementById('otherChartKpis');
        if (!wrap) return;
        wrap.style.display = 'block';

        if (!dailyChat.length) {
            if (kpiEl) kpiEl.innerHTML = '';
            wrap.innerHTML = '<div class="empty-panel"><div class="empty-title">尚無每日訊息紀錄</div></div>';
            return;
        }

        const slice = chartRange > 0 && dailyChat.length > chartRange
            ? dailyChat.slice(-chartRange)
            : dailyChat.slice();

        const counts = slice.map(d => Number(d.count) || 0);
        const sum = counts.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / slice.length);
        let maxItem = slice[0];
        slice.forEach(d => { if ((Number(d.count) || 0) > (Number(maxItem.count) || 0)) maxItem = d; });
        const latest = slice[slice.length - 1];

        if (kpiEl) {
            kpiEl.innerHTML = `
                <div class="other-kpi-item">
                    <span class="other-kpi-lbl">昨日 / 最新單日</span>
                    <span class="other-kpi-val mono">${(Number(latest.count) || 0).toLocaleString('en-US')} <small>則</small></span>
                    <span class="other-kpi-sub mono">${escapeHtml(latest.date)}</span>
                </div>
                <div class="other-kpi-item">
                    <span class="other-kpi-lbl">區間日均</span>
                    <span class="other-kpi-val mono">${avg.toLocaleString('en-US')} <small>則</small></span>
                    <span class="other-kpi-sub mono">共 ${slice.length} 天</span>
                </div>
                <div class="other-kpi-item">
                    <span class="other-kpi-lbl">區間最高峰</span>
                    <span class="other-kpi-val mono">${(Number(maxItem.count) || 0).toLocaleString('en-US')} <small>則</small></span>
                    <span class="other-kpi-sub mono">${escapeHtml(maxItem.date)}</span>
                </div>
                <div class="other-kpi-item">
                    <span class="other-kpi-lbl">歷史總紀錄</span>
                    <span class="other-kpi-val mono">${dailyChat.length.toLocaleString('en-US')} <small>天</small></span>
                    <span class="other-kpi-sub mono">${escapeHtml(dailyChat[0].date)} 起</span>
                </div>
            `;
        }

        const W = 760;
        const H = 250;
        const padL = 48;
        const padR = 16;
        const padT = 18;
        const padB = 34;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const maxVal = Math.max(10, ...counts);
        const yCeiling = Math.ceil(maxVal * 1.12);

        const coords = slice.map((d, idx) => {
            const x = slice.length === 1 ? (padL + plotW / 2) : (padL + (idx / (slice.length - 1)) * plotW);
            const y = padT + plotH - ((Number(d.count) || 0) / yCeiling) * plotH;
            return { x, y, date: d.date, count: Number(d.count) || 0 };
        });

        const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

        const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const val = Math.round(yCeiling * ratio);
            const y = padT + plotH - ratio * plotH;
            return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="chart-grid-line" />
                    <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-axis-text">${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val}</text>`;
        }).join('');

        const xTickIndices = slice.length <= 2
            ? slice.map((_, i) => i)
            : [0, Math.floor((slice.length - 1) / 3), Math.floor(((slice.length - 1) * 2) / 3), slice.length - 1];
        const xTicks = Array.from(new Set(xTickIndices)).map(idx => {
            const p = coords[idx];
            return `<text x="${p.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" class="chart-axis-text">${escapeHtml(p.date.slice(2))}</text>`;
        }).join('');

        const showDots = slice.length <= 95;
        const dotsHtml = showDots ? coords.map((p, idx) =>
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${slice.length <= 35 ? 3.5 : 2.3}" class="chart-dot" data-pt="${idx}" />`
        ).join('') : '';

        wrap.innerHTML = `
            <div class="other-chart-stage">
                <div class="other-chart-tooltip mono" id="otherChartTooltip">點選或滑過曲線檢視單日訊息數</div>
                <svg viewBox="0 0 ${W} ${H}" class="other-chat-svg" id="otherChatSvg" role="img" aria-label="群組每日訊息熱度圖表">
                    <defs>
                        <linearGradient id="otherChatGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#0d9488" stop-opacity="0.34"/>
                            <stop offset="100%" stop-color="#0d9488" stop-opacity="0.02"/>
                        </linearGradient>
                    </defs>
                    ${yTicks}
                    ${xTicks}
                    <path d="${areaPath}" fill="url(#otherChatGrad)" />
                    <path d="${linePath}" fill="none" stroke="#0d9488" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
                    ${dotsHtml}
                    <line id="otherChartCrosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" class="chart-crosshair" style="display:none;" />
                    <circle id="otherChartActiveDot" cx="0" cy="0" r="5.5" class="chart-active-dot" style="display:none;" />
                </svg>
            </div>
        `;

        const svg = document.getElementById('otherChatSvg');
        const tip = document.getElementById('otherChartTooltip');
        const cross = document.getElementById('otherChartCrosshair');
        const activeDot = document.getElementById('otherChartActiveDot');
        if (svg && tip) {
            const pickPoint = clientX => {
                const rect = svg.getBoundingClientRect();
                if (!rect.width) return;
                const svgX = ((clientX - rect.left) / rect.width) * W;
                let nearest = coords[0];
                let minDist = Infinity;
                for (let i = 0; i < coords.length; i++) {
                    const d = Math.abs(coords[i].x - svgX);
                    if (d < minDist) { minDist = d; nearest = coords[i]; }
                }
                if (nearest) {
                    tip.innerHTML = `📅 <strong>${escapeHtml(nearest.date)}</strong> · 💬 <strong>${nearest.count.toLocaleString('en-US')}</strong> 則訊息`;
                    if (cross) {
                        cross.setAttribute('x1', nearest.x.toFixed(1));
                        cross.setAttribute('x2', nearest.x.toFixed(1));
                        cross.style.display = 'block';
                    }
                    if (activeDot) {
                        activeDot.setAttribute('cx', nearest.x.toFixed(1));
                        activeDot.setAttribute('cy', nearest.y.toFixed(1));
                        activeDot.style.display = 'block';
                    }
                }
            };
            svg.addEventListener('pointermove', e => pickPoint(e.clientX));
            svg.addEventListener('pointerdown', e => pickPoint(e.clientX));
        }
    }

    function renderCommands() {
        const grid = document.getElementById('otherCommandsGrid');
        const countEl = document.getElementById('otherCmdCountPill');
        if (!grid) return;

        const q = cmdSearch.toLowerCase();
        const filtered = BOT_COMMANDS.filter(item => {
            if (cmdCategory !== 'all' && item.cat !== cmdCategory) return false;
            if (!q) return true;
            return item.cmd.toLowerCase().includes(q) ||
                item.desc.toLowerCase().includes(q) ||
                item.aliases.some(a => a.toLowerCase().includes(q));
        });

        if (countEl) {
            countEl.textContent = filtered.length === BOT_COMMANDS.length
                ? `共 ${BOT_COMMANDS.length} 組咒語`
                : `符合 ${filtered.length} / ${BOT_COMMANDS.length} 組`;
        }

        if (!filtered.length) {
            grid.innerHTML = '<div class="empty-panel" style="grid-column:1/-1;"><div class="empty-emoji">🔍</div><div class="empty-title">查無相符咒語</div><div class="empty-desc">請試著更換關鍵字或切換咒語分類</div></div>';
            return;
        }

        grid.innerHTML = filtered.map(item => {
            const catLabel = CATEGORY_LABELS[item.cat] || item.cat;
            const aliasHtml = item.aliases.length
                ? `<div class="cmd-aliases">別名：${item.aliases.map(a => `<code>${escapeHtml(a)}</code>`).join(' ')}</div>`
                : '';
            const safeCopy = escapeHtml(item.copy).replace(/'/g, '&#39;');
            return `
                <article class="other-cmd-card">
                    <div class="cmd-card-head">
                        <span class="cmd-cat-tag">${escapeHtml(catLabel)}</span>
                        <button type="button" class="cmd-copy-btn" onclick="PortalOther.copyCommand('${safeCopy}')">📋 複製</button>
                    </div>
                    <div class="cmd-main-code mono">${escapeHtml(item.cmd)}</div>
                    <p class="cmd-desc">${escapeHtml(item.desc)}</p>
                    ${aliasHtml}
                </article>
            `;
        }).join('');
    }

    function copyCommand(text) {
        const val = String(text || '');
        if (!val) return;
        const done = () => {
            if (window.Swal) {
                Swal.fire({
                    icon: 'success',
                    title: `已複製「${val}」`,
                    text: '回到 LINE 群組或機器人聊天室貼上即可使用',
                    timer: 1400,
                    showConfirmButton: false,
                    toast: true,
                    position: 'top'
                });
            }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val).then(done).catch(() => {
                fallbackCopy(val);
                done();
            });
        } else {
            fallbackCopy(val);
            done();
        }
    }

    function fallbackCopy(val) {
        const ta = document.createElement('textarea');
        ta.value = val;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    return {
        ensureLoaded,
        copyCommand
    };
})();

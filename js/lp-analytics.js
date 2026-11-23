/* 自動コピー：canvi-lp-analytics/shared/lp-analytics.js。このファイルは直接編集せず、正本を直して `npm run sync` を実行すること */
/**
 * Canvi LP 分析基盤：ブラウザ側の計測スクリプト
 *
 * 正本は canvi-lp-analytics/shared/lp-analytics.js。各LPにはコピーを置く（`npm run sync`）。
 *
 * 読み込み方（main.js より前に置く）:
 *   <script src="js/lp-analytics.js" data-lp-name="saiyou90"></script>
 *   data-ga-id="G-XXXX" を付けると、そのLP用の測定IDも設定する（GA4 タグが無いLPは gtag.js も読み込む）。
 *
 * HP・LP統合の GA4 プロパティ：下の SHARED_GA_ID に測定IDを入れて `npm run sync` すると、
 * 全LPが既存のLP別プロパティに加えて統合プロパティにも送る（既存プロパティの履歴はそのまま残る）。
 *
 * やること
 *   1. 初回アクセス時の UTM・参照元・着地パスを sessionStorage に保存（リロード・ページ遷移で消えない）
 *   2. ページ内のすべての <form> に hidden field（utm_source など・送信時のページURL page_url）を追加
 *      → 送信APIが Canvas の sourceDetail / rawData に入れる
 *   3. GA4 イベント：form_view（50%以上表示）/ form_start（最初の入力）を1セッション1回送る
 *   4. window.LPAnalytics.lead(leadId) で generate_lead を送る（送信APIの成功後に main.js から呼ぶ）
 *
 * 個人情報は GA4 に送らない。
 */
(function () {
  'use strict';

  var SHARED_GA_ID = 'G-94VP2CRKS8'; // 5LP統合プロパティ「Canvi LP（5LP統合）」（アカウント 358797938）の測定ID

  var script = document.currentScript;
  var ENABLED = !script || script.getAttribute('data-enabled') !== 'false';
  var ALLOWED_HOSTS = (script && script.getAttribute('data-ga-hosts')) || '';
  if (ALLOWED_HOSTS && ALLOWED_HOSTS.split(',').indexOf(location.hostname) === -1) ENABLED = false;
  var LP_NAME = (script && script.getAttribute('data-lp-name')) || '';
  var GA_IDS = [(script && script.getAttribute('data-ga-id')) || '', SHARED_GA_ID].filter(function (id, i, a) {
    return ENABLED && id && a.indexOf(id) === i;
  });

  var STORE_KEY = 'lpa_attr';
  var FLAG_PREFIX = 'lpa_sent_';
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var FIELD_KEYS = UTM_KEYS.concat(['referrer', 'referrer_host', 'landing_path', 'page_url']);

  var memory = {};
  function storeGet(k) {
    try { return window.sessionStorage.getItem(k); } catch (e) { return memory[k] || null; }
  }
  function storeSet(k, v) {
    try { window.sessionStorage.setItem(k, v); } catch (e) { memory[k] = v; }
  }

  /* ---------- gtag ---------- */
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
    if (GA_IDS.length) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_IDS[0]);
      document.head.appendChild(s);
      window.gtag('js', new Date());
    }
  }
  // 以降の gtag('event') は、設定済みのすべての測定ID（LP別・統合）へ送られる。
  // 注意：GA4 のデータストリームで「ページ上の構成の重複インスタンスを無視」がオンだと、この config（lp_name）は
  // 無視され、自動の page_view・拡張計測イベントに lp_name が付かない（2026-11-05 実送信で確認）。
  // そのため LP の判定は GA4 標準の「ホスト名」で行う（週次レポート・Looker Studio）。下の track() のイベントは
  // パラメータに lp_name を直接入れるので、設定にかかわらず付く。
  GA_IDS.forEach(function (id) { window.gtag('config', id, { lp_name: LP_NAME }); });
  function track(name, params) {
    if (!ENABLED) return;
    var p = { lp_name: LP_NAME };
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
    window.gtag('event', name, p);
  }

  /* ---------- 流入元（初回アクセス時のみ保存） ---------- */
  function captureAttribution() {
    var saved = storeGet(STORE_KEY);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* 壊れていたら取り直す */ }
    }
    var attr = {};
    var q = new URLSearchParams(location.search);
    UTM_KEYS.forEach(function (k) { attr[k] = (q.get(k) || '').slice(0, 200); });
    attr.referrer = '';
    attr.referrer_host = '';
    if (document.referrer) {
      try {
        var host = new URL(document.referrer).hostname;
        if (host && host !== location.hostname) {
          attr.referrer = document.referrer.slice(0, 1000);
          attr.referrer_host = host;
        }
      } catch (e) { /* 無効な referrer は無視 */ }
    }
    attr.landing_path = location.pathname || '/';
    storeSet(STORE_KEY, JSON.stringify(attr));
    return attr;
  }
  var attribution = captureAttribution();

  function fields() {
    var o = {};
    FIELD_KEYS.forEach(function (k) { o[k] = attribution[k] || ''; });
    o.page_url = location.href; // 送信した時点のページURL
    return o;
  }

  /* ---------- フォームへの hidden field 付与 ---------- */
  function attachHiddenFields(form) {
    var f = fields();
    FIELD_KEYS.forEach(function (k) {
      var input = form.querySelector('input[type="hidden"][name="' + k + '"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        form.appendChild(input);
      }
      input.value = f[k];
    });
  }

  /* ---------- form_view / form_start（1セッション1回） ---------- */
  function once(name) {
    if (storeGet(FLAG_PREFIX + name)) return false;
    storeSet(FLAG_PREFIX + name, '1');
    return true;
  }

  function observeForms(forms) {
    if (!('IntersectionObserver' in window) || !forms.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        // フォームの50%以上、または（画面より大きいフォームの場合）画面の50%以上を占めたら表示とみなす
        var vh = window.innerHeight || document.documentElement.clientHeight;
        if (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= vh * 0.5) {
          io.disconnect();
          if (once('form_view')) track('form_view', { form_id: formId(e.target) });
        }
      });
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    forms.forEach(function (f) { io.observe(f); });
  }

  function formId(form) {
    return form.getAttribute('data-form') || form.id || '';
  }

  function init() {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form'));
    forms.forEach(attachHiddenFields);
    observeForms(forms);
    // 送信の直前に page_url などを最新にする（各LPの submit 処理より先に動くよう capture で登録）
    document.addEventListener('submit', function (e) {
      if (e.target && e.target.tagName === 'FORM') attachHiddenFields(e.target);
    }, true);
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || !t.form || t.type === 'hidden') return;
      if (once('form_start')) track('form_start', { form_id: formId(t.form) });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ---------- 公開API ---------- */
  window.LPAnalytics = {
    lpName: LP_NAME,
    /** 送信データに付ける流入元（hidden field と同じ値） */
    fields: fields,
    /** 送信APIの成功後に呼ぶ。leadId はAPIのレスポンスの lead_id */
    lead: function (leadId) {
      track('generate_lead', leadId ? { lead_id: String(leadId) } : {});
    }
  };
})();

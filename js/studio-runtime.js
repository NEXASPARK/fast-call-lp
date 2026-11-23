/*
 * STUDIO書き出しページ用の簡易ランタイム
 * STUDIO本体のJSの代わりに、以下の動きだけを再現します。
 *   1. スクロールで要素がふわっと出るアニメーション（.appear → .appear-active）
 *   2. よくある質問などのアコーディオン（_isClose ⇔ _isOpen）
 *   3. お問い合わせフォームの送信（/api/contact。成功時に GA4 の generate_lead）
 */
(function () {
  'use strict';

  /* ---------- 1. 表示アニメーション ---------- */
  function activate(el) {
    if (!el.classList.contains('appear')) return;
    el.classList.remove('appear');
    el.classList.add('appear-active');
  }

  function initAppear() {
    var els = document.querySelectorAll('.appear');
    if (!('IntersectionObserver' in window)) {
      els.forEach(activate);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          activate(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -5% 0px', threshold: 0 });
    els.forEach(function (el) {
      // 閉じたアコーディオンの中身は開いた時に表示する
      if (el.closest('[aria-hidden="true"]')) return;
      io.observe(el);
    });
  }

  /* ---------- 2. アコーディオン ---------- */
  function initToggles() {
    var buttons = document.querySelectorAll('button[aria-controls^="studio-toggle-content"]');
    buttons.forEach(function (btn) {
      var wrap = btn.parentElement;
      var content = document.getElementById(btn.getAttribute('aria-controls'));
      btn.setAttribute('type', 'button');
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') !== 'true';
        var targets = [wrap].concat(Array.prototype.slice.call(wrap.querySelectorAll('._isClose, ._isOpen')));
        targets.forEach(function (el) {
          el.classList.toggle('_isClose', !open);
          el.classList.toggle('_isOpen', open);
        });
        btn.setAttribute('aria-expanded', String(open));
        if (content) {
          content.setAttribute('aria-hidden', String(!open));
          if (open) content.querySelectorAll('.appear').forEach(activate);
        }
      });
    });
  }

  /* ---------- 3. フォーム送信 ---------- */
  // /api/contact → メール通知・自動返信 → Canvas登録 → Slack通知。成功時に GA4 の generate_lead を送る
  var FORM_ENDPOINT = '/api/contact';

  function showMessage(form, text, isError) {
    var box = form.querySelector('.form-message');
    if (!box) {
      box = document.createElement('p');
      box.className = 'form-message';
      box.setAttribute('role', 'status');
      box.style.cssText = 'width:100%;margin:16px 0 0;padding:14px 16px;border-radius:6px;font-size:14px;line-height:1.7;text-align:center;';
      form.appendChild(box);
    }
    box.style.background = isError ? '#fdecee' : '#eaf6ee';
    box.style.color = isError ? '#c0283a' : '#1f6b3a';
    box.textContent = text;
  }

  // 全角数字・各種ハイフンをそろえ、数字10〜15桁か確認する（サーバー側でも同じ検証をする）
  function checkTel(tel) {
    if (!tel) return;
    tel.value = tel.value.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/[‐‑‒–—―ー－−]/g, '-').replace(/（/g, '(').replace(/）/g, ')').replace(/＋/g, '+')
      .replace(/[\s　]+/g, ' ').trim();
    var digits = tel.value.replace(/\D/g, '').length;
    tel.setCustomValidity(/^[0-9+\-() ]+$/.test(tel.value) && digits >= 10 && digits <= 15
      ? '' : '電話番号を10〜15桁の数字で入力してください。');
  }

  function initForms() {
    var form = document.querySelector('form[name="form1"]');
    if (!form) return;
    var btn = form.querySelector('button');
    var tel = form.querySelector('[name="tel"]');
    var sending = false;
    var submitted = false;
    if (btn) btn.setAttribute('type', 'submit');
    if (tel) tel.addEventListener('input', function () { tel.setCustomValidity(''); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending || submitted) return;
      checkTel(tel);
      if (!form.reportValidity()) return;
      var topics = form.querySelectorAll('input[name="topic"]');
      if (topics.length && !Array.prototype.some.call(topics, function (cb) { return cb.checked; })) {
        showMessage(form, '「お問い合わせ内容」を1つ以上選択してください。', true);
        topics[0].focus();
        return;
      }

      // lp-analytics.js が付けた流入元の hidden field も含めて送る
      var fd = new FormData(form);
      var body = {};
      fd.forEach(function (value, key) { if (key !== 'topic') body[key] = value; });
      body.topic = fd.getAll('topic').join('、');
      body.form = form.getAttribute('data-form') || 'contact';

      sending = true;
      if (btn) btn.disabled = true;
      showMessage(form, '送信中です…', false);
      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      }).then(function (result) {
        if (!result || result.ok !== true) throw new Error('送信失敗');
        submitted = true; // 二重登録を防ぐため、送信後はボタンを押せないままにする
        form.reset();
        showMessage(form, 'お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡いたします。', false);
        // 成功した申込だけを計測。ハニーポットで破棄した送信（lead_id なし）は数えない
        if (result.lead_id && window.LPAnalytics) {
          try { window.LPAnalytics.lead(result.lead_id); } catch (err) { /* 計測の失敗で再送させない */ }
        }
      }).catch(function () {
        showMessage(form, '送信に失敗しました。時間をおいて再度お試しいただくか、info@canvi.co.jp までご連絡ください。', true);
        if (btn) btn.disabled = false;
      }).then(function () {
        sending = false;
      });
    });
  }

  function init() {
    initToggles();
    initForms();
    initAppear();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

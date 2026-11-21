/*
 * STUDIO書き出しページ用の簡易ランタイム
 * STUDIO本体のJSの代わりに、以下の動きだけを再現します。
 *   1. スクロールで要素がふわっと出るアニメーション（.appear → .appear-active）
 *   2. よくある質問などのアコーディオン（_isClose ⇔ _isOpen）
 *   3. お問い合わせフォームの送信
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
  // 送信先URLは <form data-endpoint="..."> で指定します（README参照）
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

  function initForms() {
    document.querySelectorAll('form').forEach(function (form) {
      var btn = form.querySelector('button');
      if (btn) btn.setAttribute('type', 'submit');

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        if (!form.reportValidity()) return;
        var groups = {};
        form.querySelectorAll('input[type="checkbox"]:not([required])').forEach(function (cb) {
          (groups[cb.name] = groups[cb.name] || []).push(cb);
        });
        for (var name in groups) {
          if (!groups[name].some(function (cb) { return cb.checked; })) {
            showMessage(form, '「' + name + '」を1つ以上選択してください。', true);
            groups[name][0].focus();
            return;
          }
        }

        var endpoint = form.getAttribute('data-endpoint');
        if (!endpoint) {
          showMessage(form, 'フォームの送信先が未設定です。お手数ですが別の方法でお問い合わせください。', true);
          return;
        }

        var data = {};
        new FormData(form).forEach(function (value, key) {
          data[key] = data[key] ? data[key] + ', ' + value : value;
        });

        if (btn) btn.disabled = true;
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(data)
        }).then(function (res) {
          if (!res.ok) throw new Error(res.status);
          form.reset();
          showMessage(form, 'お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡いたします。', false);
        }).catch(function () {
          showMessage(form, '送信に失敗しました。時間をおいて再度お試しください。', true);
        }).finally(function () {
          if (btn) btn.disabled = false;
        });
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

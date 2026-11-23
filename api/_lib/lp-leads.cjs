/* 自動コピー：canvi-lp-analytics/shared/lp-leads.cjs。このファイルは直接編集せず、正本を直して `npm run sync` を実行すること */
/**
 * Canvi LP：問い合わせ（リード）を Canvas に登録し、Slack に投稿する共通モジュール
 *
 * 正本は canvi-lp-analytics/shared/lp-leads.cjs。各LPの api/_lib/ にはコピーを置く。
 * 各LPで直接編集せず、正本を直してから `npm run sync`（canvi-lp-analytics）で配布すること。
 *
 * 環境変数（未設定の項目は処理をスキップする。フォーム送信は失敗させない）
 *   CANVAS_API_KEY            Canvas 外部リード登録APIのキー（サーバー側でのみ使う。ブラウザには出さない）
 *   SLACK_LEADS_WEBHOOK_URL   リード投稿用 Incoming Webhook（非公開チャンネル）
 *   LP_NAME                   そのLPの lp_name（未設定なら各LPのコードの既定値）
 *
 * 失敗時：Canvas・Slack の失敗はサーバーログにだけ残し、フォーム送信と通知メールは成功させる。
 */

'use strict';

const crypto = require('crypto');

const LP_LABELS = {
  saiyou90: 'サイヨウ90',
  saiyou90_short: 'サイヨウ90ショート版',
  teleapo90: 'テレアポ90',
  byousokuis: '秒速IS',
  perxona: 'Perxona',
  jyuden_bancho: '受電番長',
  byosoku_mendan: '秒速面談',
  ai_apo_boost: 'AIアポブースト',
  medlead: 'MedLead',
  fast_call: '秒速架電',
  canvi_hp: 'Canvi コーポレートサイト'
};

const CANVAS_ENDPOINT = 'https://canvas.canvi.co.jp/api/external/leads';
/** Canvas のリード詳細画面（Slack 通知のリンク先） */
const CANVAS_LEAD_URL = 'https://canvas.canvi.co.jp/leads/';
const CANVAS_TIMEOUT_MS = 10000;
const SLACK_TIMEOUT_MS = 4000;
const SLACK_TEXT_LIMIT = 500;

/** ブラウザ（lp-analytics.js）が hidden field で送ってくる流入元の項目 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const ATTRIBUTION_KEYS = UTM_KEYS.concat(['referrer', 'referrer_host', 'landing_path', 'page_url']);
/** rawData に入れない項目（専用の項目で送るもの・スパム対策の隠し欄） */
const CONTACT_KEYS = ['company', 'name', 'email', 'tel'];
const SKIP_KEYS = ['website', '_hp'];

/* ---------- 申込1件の処理（Canvas 登録＋Slack 投稿） ---------- */

/**
 * 申込を Canvas に登録し、Slack に投稿する。どの処理が失敗しても例外は投げない（ログのみ）。
 * @param {object} o
 * @param {object} o.req           Vercel の req（User-Agent の取得に使う）
 * @param {object} o.body          送信された生データ（UTM などの hidden field を含む）
 * @param {string} o.lpName        既定の lp_name（環境変数 LP_NAME が優先）
 * @param {{company: string, name: string, email: string, tel: string}} o.contact  検証・整形済みの連絡先
 * @param {string} [o.formLabel]   どのフォームからの送信か（FVフォームなど）
 * @param {Array<[string, any]>} o.items  Slack に出すフォーム項目 [表示名, 値] の並び
 * @returns {Promise<{leadId: string, canvasLeadId: string|null}>}
 */
async function recordLead(o) {
  const leadId = newLeadId();
  let canvasLeadId = null;
  try {
    const env = process.env;
    const lead = buildLead({
      leadId,
      lpName: env.LP_NAME || o.lpName,
      body: o.body || {},
      userAgent: headerOf(o.req, 'user-agent'),
      vercelEnv: env.VERCEL_ENV,
      now: new Date()
    });

    // 1. Canvas に登録（Slack 通知に Canvas のリンクを付けるため、先に登録する）
    let canvas = null; // null＝未設定、{ leadId } ＝成功、{ failed: true }＝失敗
    if (env.CANVAS_API_KEY) {
      try {
        const payload = buildCanvasPayload(lead, o.contact || {}, o.body || {}, o.formLabel);
        canvasLeadId = await registerCanvasLead(env.CANVAS_API_KEY, payload, leadId);
        canvas = { leadId: canvasLeadId };
      } catch (err) {
        canvas = { failed: true };
        console.error('lp-leads: canvas failed', leadId, err && err.message ? err.message : err);
      }
    } else {
      console.warn('lp-leads: CANVAS_API_KEY が未設定のため Canvas 登録をスキップ', leadId);
    }

    // 2. Slack に投稿（Canvas のリンク、または登録失敗の注意を付ける）
    if (env.SLACK_LEADS_WEBHOOK_URL) {
      try {
        await postSlack(env.SLACK_LEADS_WEBHOOK_URL, buildSlackLeadMessage(lead, o.items || [], o.formLabel, canvas));
      } catch (err) {
        console.error('lp-leads: slack failed', leadId, err && err.message ? err.message : err);
      }
    } else {
      console.warn('lp-leads: SLACK_LEADS_WEBHOOK_URL が未設定のため投稿をスキップ', leadId);
    }
  } catch (err) {
    console.error('lp-leads: unexpected error', leadId, err);
  }
  return { leadId, canvasLeadId };
}

function newLeadId() {
  return crypto.randomBytes(8).toString('hex');
}

/** 送信データから、流入元などのメタ情報を取り出す */
function buildLead({ leadId, lpName, body, userAgent, vercelEnv, now }) {
  const lead = {
    submitted_at: formatJst(now),
    submitted_at_iso: now.toISOString(),
    lead_id: leadId,
    lp_name: String(lpName || ''),
    device: detectDevice(userAgent),
    env: vercelEnv === 'production' ? 'production' : (vercelEnv || 'development')
  };
  ATTRIBUTION_KEYS.forEach((k) => { lead[k] = cleanAttr(body[k], k); });
  // 古い形式（page / page_url）も受け付ける
  if (!lead.page_url) lead.page_url = cleanAttr(body.page, 'page_url');
  return lead;
}

function cleanAttr(v, key) {
  let s = Array.isArray(v) ? String(v[0] == null ? '' : v[0]) : String(v == null ? '' : v);
  s = s.replace(/[\r\n\t]/g, ' ').trim();
  if (key === 'referrer_host') s = s.toLowerCase().replace(/[^a-z0-9.\-:]/g, '');
  if (key === 'landing_path') s = s.split(/[?#]/)[0];
  return s.slice(0, key === 'page_url' || key === 'referrer' ? 1000 : 200);
}

function detectDevice(ua) {
  ua = String(ua || '');
  if (!ua) return '';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** 2026-11-04 18:30:12 形式（JST） */
function formatJst(date) {
  const d = new Date(date.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

function headerOf(req, name) {
  if (!req || !req.headers) return '';
  const h = req.headers;
  return typeof h.get === 'function' ? (h.get(name) || '') : (h[name] || '');
}

/* ---------- 電話番号（フォーム共通の必須項目） ---------- */

/** 全角数字・各種ハイフンを半角にそろえる（例「０３ー１２３４ー５６７８」→「03-1234-5678」） */
function normalizeTel(v) {
  return String(v == null ? '' : v)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―ー－−]/g, '-')
    .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[＋]/g, '+')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .slice(0, 20);
}

/** 数字が10〜15桁で、数字・ハイフン・括弧・+・空白だけなら有効 */
function isValidTel(v) {
  const s = normalizeTel(v);
  const digits = s.replace(/\D/g, '').length;
  return /^[0-9+\-() ]+$/.test(s) && digits >= 10 && digits <= 15;
}

/* ---------- Canvas（社内CRM）リード登録 ---------- */

/**
 * sourceDetail：LP名（例「サイヨウ90」）。どのLPから来たかを Canvas で区別するため（2026-11-05 指定）。
 * 送信したページのURL（サブドメイン）は rawData.pageUrl に入る。
 */
function canvasSourceDetail(lead) {
  return LP_LABELS[lead.lp_name] || lead.lp_name || '不明なLP';
}

/** Canvas に送る JSON を作る */
function buildCanvasPayload(lead, contact, body, formLabel) {
  const test = lead.env !== 'production';
  const company = String(contact.company || '').trim();

  // 上記以外のフォーム項目は、送られてきたキーのまま rawData に入れる（お問い合わせ内容を含む）
  const rawData = {};
  Object.keys(body).forEach((k) => {
    if (CONTACT_KEYS.includes(k) || SKIP_KEYS.includes(k) || ATTRIBUTION_KEYS.includes(k) || k === 'page') return;
    const v = body[k];
    if (v == null || v === '') return;
    rawData[k] = Array.isArray(v) ? v.map(String) : String(v);
  });
  if (formLabel) rawData.formLabel = String(formLabel);
  rawData.pageUrl = lead.page_url || '';
  rawData.referrer = lead.referrer || '';
  UTM_KEYS.forEach((k) => { if (lead[k]) rawData[k] = lead[k]; });
  rawData.submittedAt = lead.submitted_at_iso;
  rawData.lpLeadId = lead.lead_id;
  if (lead.landing_path) rawData.landingPath = lead.landing_path;

  const payload = {
    // Preview・ローカルからの送信は会社名に「【テスト】」を付ける（Canvi様側で削除できるように）
    companyName: test && company.indexOf('【テスト】') !== 0 ? '【テスト】' + company : company,
    sourceDetail: canvasSourceDetail(lead),
    rawData
  };
  // 氏名は1項目なので分けずに lastName に入れる
  if (contact.name) payload.lastName = String(contact.name).trim();
  if (contact.email) payload.email = String(contact.email).trim();
  if (contact.tel) payload.phone = String(contact.tel).trim().slice(0, 20);
  return payload;
}

/**
 * Canvas に登録する。成功（201）なら Canvas の leadId を返す。
 * 失敗時はステータス・レスポンス本文・request_id をログに残して例外を投げる（呼び出し側で握りつぶす）。
 */
async function registerCanvasLead(apiKey, payload, lpLeadId) {
  let r;
  try {
    r = await fetchWithTimeout(CANVAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload)
    }, CANVAS_TIMEOUT_MS);
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout(' + CANVAS_TIMEOUT_MS + 'ms)' : (err && err.message) || String(err);
    console.error('canvas: request failed', JSON.stringify({ lpLeadId, reason, sourceDetail: payload.sourceDetail }));
    throw new Error('Canvas ' + reason);
  }

  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  const requestId = (data && (data.request_id || data.requestId)) || r.headers.get('x-request-id') || '';

  if (r.status === 201 && data && data.leadId) {
    console.log('canvas: registered', JSON.stringify({ leadId: data.leadId, request_id: requestId, lpLeadId, sourceDetail: payload.sourceDetail }));
    return data.leadId;
  }
  console.error('canvas: failed', JSON.stringify({ status: r.status, body: text.slice(0, 1000), request_id: requestId, lpLeadId, sourceDetail: payload.sourceDetail }));
  throw new Error('Canvas ' + r.status);
}

/* ---------- Slack リード投稿 ---------- */

/** Slack の mrkdwn で特殊な意味を持つ文字を無効化する */
function escapeSlack(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…（以下省略）' : s;
}

function lpLabel(lpName) {
  return LP_LABELS[lpName] || lpName || 'LP';
}

/** 2列表示（section.fields）に入れる値の最大文字数。これより長い値は横幅いっぱいの段落にする */
const SLACK_FIELD_MAX = 60;

/**
 * Slack の太字 `*…*` は、閉じる * の直後が空白・改行でないと効かない（「*会社名*：」のように
 * 全角文字が続くと * がそのまま表示される）。そのため「*項目名*」の直後は必ず改行にする。
 */
function slackField(label, value) {
  return '*' + escapeSlack(label) + '*\n' + value;
}

/**
 * @param canvas  Canvas 登録の結果。{ leadId } ならリンクを付け、{ failed: true } なら注意を付ける。null は何も付けない
 */
function buildSlackLeadMessage(lead, items, formLabel, canvas) {
  const test = lead.env !== 'production';
  const title = (test ? '【テスト】' : '') + '【' + lpLabel(lead.lp_name) + '】新しい申込があります';

  const short = [slackField('申込日時', lead.submitted_at)];
  if (formLabel) short.push(slackField('フォーム', escapeSlack(formLabel)));
  const long = [];
  items.forEach(([label, value]) => {
    const v = Array.isArray(value) ? value.join(', ') : (value == null ? '' : String(value).trim());
    const text = v ? escapeSlack(clip(v, SLACK_TEXT_LIMIT)) : '（未入力）';
    (v.length > SLACK_FIELD_MAX || v.includes('\n') ? long : short).push(slackField(label, text));
  });

  const blocks = [{ type: 'header', text: { type: 'plain_text', text: title, emoji: true } }];
  if (canvas && canvas.leadId) {
    const url = CANVAS_LEAD_URL + encodeURIComponent(canvas.leadId);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':link: <' + url + '|Canvasでリードを開く>' } });
  } else if (canvas && canvas.failed) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':warning: Canvasへの登録に失敗しました。この内容を Canvas に手動で登録してください（管理ID `' + lead.lead_id + '`）' } });
  }
  // section.fields は1ブロック10項目まで
  for (let i = 0; i < short.length; i += 10) {
    blocks.push({ type: 'section', fields: short.slice(i, i + 10).map((t) => ({ type: 'mrkdwn', text: t })) });
  }
  long.forEach((t) => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(t, 2900) } }));

  const source = [lead.utm_source, lead.utm_medium, lead.utm_campaign].map((v) => v || '-').join(' / ');
  const meta = [
    '流入元 ' + escapeSlack(source) + (lead.utm_content ? '（' + escapeSlack(lead.utm_content) + '）' : '') +
      '　｜　参照元 ' + escapeSlack(lead.referrer_host || '直接／不明') +
      '　｜　着地 ' + escapeSlack(lead.landing_path || '-') + '　｜　端末 ' + (lead.device || '-'),
    '管理ID `' + lead.lead_id + '`'
  ];
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: meta.join('\n') }] });

  return { text: title, blocks };
}

async function postSlack(webhookUrl, payload) {
  const r = await fetchWithTimeout(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, SLACK_TIMEOUT_MS);
  if (!r.ok) throw new Error('Slack ' + r.status + ': ' + (await r.text()).slice(0, 300));
}

async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  recordLead,
  normalizeTel,
  isValidTel,
  // 以下は週次レポート・テスト用
  LP_LABELS,
  CANVAS_ENDPOINT,
  CANVAS_LEAD_URL,
  buildLead,
  buildCanvasPayload,
  canvasSourceDetail,
  registerCanvasLead,
  buildSlackLeadMessage,
  postSlack,
  detectDevice,
  formatJst,
  fetchWithTimeout
};

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/contact.js');

const BODY = {
  company: 'テスト株式会社', name: 'テスト 太郎', email: 'test@example.jp',
  tel: '０９０ー１２３４ー５６７８', topic: 'サービス内容・機能について、料金プラン・お申し込みについて', message: '導入時期の相談',
  agree: 'on', website: '', form: 'contact',
  utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test',
  page_url: 'https://fast-call.canvi.co.jp/1?utm_source=google', landing_path: '/'
};

function setup(t, overrides = {}, fail = '') {
  const env = {
    RESEND_API_KEY: 'test-key', INQUIRY_FROM: 'noreply@example.jp', INQUIRY_TO: 'sales@example.jp,info@example.jp',
    CANVAS_API_KEY: 'canvas-test-key', SLACK_LEADS_WEBHOOK_URL: 'https://hooks.slack.com/test',
    LP_NAME: 'fast_call', VERCEL_ENV: 'production', ...overrides
  };
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (fail && String(url).includes(fail)) return new Response('failed', { status: 500 });
    if (String(url).includes('canvas')) return new Response(JSON.stringify({ leadId: 'canvas-123' }), { status: 201 });
    return new Response('{}');
  });
  return calls;
}

async function submit(body = BODY, method = 'POST') {
  const result = { headers: {} };
  const res = {
    setHeader(key, value) { result.headers[key] = value; },
    status(code) { result.status = code; return this; },
    json(value) { result.body = value; return this; }
  };
  await handler({ method, body, headers: { 'user-agent': 'iPhone Mobile' } }, res);
  return result;
}

test('メール2通→Canvas→Slack、全項目・流入元・管理IDを保持', async (t) => {
  const calls = setup(t);
  const result = await submit();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(result.body.lead_id, /^[0-9a-f]{16}$/);
  assert.deepEqual(calls.map(c => new URL(c.url).hostname), ['api.resend.com', 'api.resend.com', 'canvas.canvi.co.jp', 'hooks.slack.com']);
  assert.deepEqual(calls[0].body.to, ['sales@example.jp', 'info@example.jp']);
  assert.equal(calls[0].body.reply_to, BODY.email);
  assert.match(calls[0].body.subject, /^【秒速架電】お問い合わせ：テスト株式会社$/);
  assert.deepEqual(calls[1].body.to, [BODY.email]);
  for (const key of ['company', 'name', 'email', 'topic', 'message']) assert.ok(calls[0].body.text.includes(BODY[key]), key);
  assert.ok(calls[0].body.text.includes('電話番号：090-1234-5678'));
  const canvas = calls[2].body;
  assert.equal(canvas.companyName, BODY.company);
  assert.equal(canvas.lastName, BODY.name);
  assert.equal(canvas.email, BODY.email);
  assert.equal(canvas.phone, '090-1234-5678');
  assert.equal(canvas.sourceDetail, '秒速架電');
  assert.equal(canvas.rawData.topic, BODY.topic);
  assert.equal(canvas.rawData.message, BODY.message);
  assert.equal(canvas.rawData.lpLeadId, result.body.lead_id);
  assert.equal(canvas.rawData.utm_campaign, 'test');
  assert.equal(canvas.rawData.pageUrl, BODY.page_url);
  assert.equal(canvas.rawData.formLabel, 'お問い合わせフォーム');
  assert.equal('website' in canvas.rawData, false);
  assert.match(JSON.stringify(calls[3].body), /秒速架電/);
});

test('お問い合わせ詳細は任意、INQUIRY_TO 未設定なら info@canvi.co.jp へ通知', async (t) => {
  const calls = setup(t, { INQUIRY_TO: null });
  const result = await submit({ ...BODY, message: '' });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0].body.to, ['info@canvi.co.jp']);
  assert.ok(calls[0].body.text.includes('お問い合わせ詳細：（未入力）'));
});

test('必須入力・電話・同意の不備、GET、ハニーポットでは外部送信しない', async (t) => {
  const calls = setup(t);
  for (const bad of [
    { company: ' ' }, { name: '' }, { email: 'invalid' }, { tel: '' }, { tel: '1234567' }, { topic: '' }, { agree: '' }
  ]) {
    assert.equal((await submit({ ...BODY, ...bad })).status, 400, JSON.stringify(bad));
  }
  const get = await submit(BODY, 'GET');
  assert.equal(get.status, 405);
  assert.equal(get.headers.Allow, 'POST');
  assert.deepEqual((await submit({ ...BODY, website: 'spam' })).body, { ok: true });
  assert.equal(calls.length, 0);
});

test('Resend未設定は503、通知メール失敗は500でリード登録しない', async (t) => {
  const calls = setup(t, { RESEND_API_KEY: '' }, 'resend');
  assert.equal((await submit()).status, 503);
  assert.equal(calls.length, 0);
  process.env.RESEND_API_KEY = 'test-key';
  assert.equal((await submit()).status, 500);
  assert.equal(calls.length, 1);
});

test('Canvas失敗でもSlackに注意を出し、フォームは成功を返す', async (t) => {
  const calls = setup(t, {}, 'canvas');
  const result = await submit();
  assert.equal(result.status, 200);
  assert.ok(result.body.lead_id);
  assert.match(JSON.stringify(calls[3].body), /Canvasへの登録に失敗/);
});

test('Slack失敗でもフォーム成功、Previewリードにはテスト表示', async (t) => {
  const calls = setup(t, { VERCEL_ENV: 'preview' }, 'slack');
  assert.equal((await submit()).status, 200);
  assert.match(calls[2].body.companyName, /^【テスト】/);
});

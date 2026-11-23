/** Resend通知・自動返信 → 共通のCanvas登録・Slack通知 → lead_idを返す。 */
'use strict';

const lpLeads = require('./_lib/lp-leads.cjs');

function clean(value) {
  return String(value == null ? '' : value).trim().slice(0, 2000);
}

async function sendMail(payload) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY.trim(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) {
    // Resend のエラー内容（未認証ドメインなど）を原因調査のためにログへ残す。APIキーは含まれない
    const detail = await response.text().catch(() => '');
    throw new Error('Resend ' + response.status + ' ' + detail.replace(/\s+/g, ' ').slice(0, 300));
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }

  const p = req.body || {};
  if (p.website) return res.status(200).json({ ok: true });

  const data = {};
  ['company', 'name', 'email', 'topic', 'message'].forEach((key) => {
    data[key] = clean(p[key]);
  });
  data.tel = lpLeads.normalizeTel(p.tel);
  if (!data.company || !data.name || !data.topic || !lpLeads.isValidTel(data.tel) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || p.agree !== 'on') {
    return res.status(400).json({ ok: false, error: 'missing fields' });
  }

  const { RESEND_API_KEY, INQUIRY_FROM } = process.env;
  if (!RESEND_API_KEY || !INQUIRY_FROM) {
    console.error('contact: RESEND_API_KEY / INQUIRY_FROM is not configured');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const formLabel = 'お問い合わせフォーム';
  const items = [
    ['会社名/屋号名', data.company], ['お名前', data.name], ['メールアドレス', data.email],
    ['電話番号', data.tel], ['お問い合わせ内容', data.topic], ['お問い合わせ詳細', data.message]
  ];
  const details = items.map(([label, value]) => label + '：' + (value || '（未入力）'));
  const notifyTo = (process.env.INQUIRY_TO || 'info@canvi.co.jp').split(',').map((s) => s.trim()).filter(Boolean);

  try {
    if (notifyTo.length) {
      await sendMail({
        from: INQUIRY_FROM, to: notifyTo, reply_to: data.email,
        subject: '【秒速架電】お問い合わせ：' + data.company.replace(/[\r\n]/g, ' '),
        text: [
          '秒速架電LPからお問い合わせがありました。', '',
          ...details, '送信元：' + clean(p.page_url || p.page)
        ].join('\n')
      });
    }
    await sendMail({
      from: INQUIRY_FROM, to: [data.email],
      subject: '【秒速架電・受付完了】お問い合わせありがとうございます',
      text: [
        data.company, data.name + ' 様', '',
        'このたびは秒速架電へお問い合わせいただき、ありがとうございます。',
        '以下の内容で受け付けました。担当者より折り返しご連絡いたします。', '',
        '────────────', ...details, '────────────', '', '※本メールは送信専用です。'
      ].join('\n')
    });
  } catch (err) {
    console.error('contact: send failed', err.message);
    return res.status(500).json({ ok: false, error: 'send failed' });
  }

  // Canvas・Slackが失敗しても、共通モジュールがログを残し送信成功を返す。
  const lead = await lpLeads.recordLead({
    req, body: { ...p, ...data }, lpName: 'fast_call',
    contact: { company: data.company, name: data.name, email: data.email, tel: data.tel },
    formLabel, items
  });
  return res.status(200).json({ ok: true, lead_id: lead.leadId });
};

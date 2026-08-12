#!/usr/bin/env node
/* Envia o card individual de conquista pro Telegram */
const fs = require('fs');

(async () => {
  const png = fs.readFileSync('/tmp/achv_one.png');
  const caption = `🏅 <b>Conquista desbloqueada!</b>\n\n<i>Leitor dedicado</i> — Leia 50 capítulos\n\n📊 <b>4/15</b> conquistas\n🔗 <a href="https://manganana.vercel.app">Ver no Manganana</a>`;
  const form = new FormData();
  form.append('chat_id', '7757264559');
  form.append('photo', new Blob([png], { type: 'image/png' }), 'achv_one.png');
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  const r = await fetch('https://api.telegram.org/bot8850481713:AAFF-rkb39B2UJdLNgYSIn3kbw44dk5hNAQ/sendPhoto', { method: 'POST', body: form });
  const j = await r.json();
  console.log('card individual enviado:', j.ok ? 'OK msg ' + j.result.message_id : j.description);
})();

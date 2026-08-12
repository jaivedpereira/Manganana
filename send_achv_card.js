#!/usr/bin/env node
/* Envia o card de conquistas pro Telegram do Jai */
const fs = require('fs');

(async () => {
  const png = fs.readFileSync('/tmp/achv_card.png');
  const caption = `🏆 <b>Suas conquistas no Manganana</b>\n\n13 de 15 desbloqueadas — complete a coleção! 📖`;
  const form = new FormData();
  form.append('chat_id', '7757264559');
  form.append('photo', new Blob([png], { type: 'image/png' }), 'achv_card.png');
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  const r = await fetch('https://api.telegram.org/bot8850481713:AAFF-rkb39B2UJdLNgYSIn3kbw44dk5hNAQ/sendPhoto', { method: 'POST', body: form });
  const j = await r.json();
  console.log('card conquistas enviado:', j.ok ? 'OK msg ' + j.result.message_id : j.description);
})();

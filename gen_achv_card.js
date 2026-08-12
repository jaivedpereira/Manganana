#!/usr/bin/env node
/* Gera o card de conquistas (SVG → PNG) com a mesma estética do card mensal */
const sharp = require('sharp');
const fs = require('fs');

const ACH = [
  ['📖', 'Primeiras páginas', 'cap10', true],
  ['📚', 'Leitor dedicado', 'cap50', true],
  ['🏛️', 'Biblioteca viva', 'cap200', true],
  ['🔥', 'Viciado oficial', 'cap500', true],
  ['👑', 'Lenda do Manganana', 'cap1000', true],
  ['🌱', 'Criando hábito', 'streak3', true],
  ['⚡', 'Semana completa', 'streak7', true],
  ['🌋', 'Mês de fogo', 'streak30', true],
  ['🎯', 'Explorador', 'manga5', true],
  ['🧭', 'Aventureiro', 'manga15', true],
  ['🌐', 'Colecionador de mundos', 'manga40', true],
  ['💛', 'Primeiros favoritos', 'fav10', true],
  ['💎', 'Gosto refinado', 'fav30', true],
  ['🏃', 'Maratonista', 'maratona', false],
  ['🦉', 'Coruja', 'madrugada', false],
];

const W = 1080, H = 1350;
const NAVY = '#0b1120', NAVY2 = '#111a30', GOLD = '#ffd60a', TEXT = '#e8edf7', MUTED = '#8a94ad';
const unlockedCount = ACH.filter(a => a[3]).length;
const total = ACH.length;

const cols = 3, gap = 20, padX = 36;
const cardW = (W - padX * 2 - gap * (cols - 1)) / cols;
const cardH = 175, cardGap = 22;
const gridTop = 320;

let cards = '';
ACH.forEach((a, i) => {
  const [icon, name, id, unlocked] = a;
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = padX + col * (cardW + gap);
  const y = gridTop + row * (cardH + cardGap);
  const fill = unlocked ? '#182238' : '#0d1526';
  const stroke = unlocked ? '#ffd60a' : '#1e2a4a';
  const iconOpacity = unlocked ? 1 : 0.35;
  const nameColor = unlocked ? TEXT : MUTED;
  cards += `
  <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="${unlocked ? 2.5 : 1.5}"/>
  <text x="${x + cardW / 2}" y="${y + 70}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="52" opacity="${iconOpacity}">${icon}</text>
  <text x="${x + cardW / 2}" y="${y + 120}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="21" font-weight="bold" fill="${nameColor}">${name}</text>
  ${unlocked ? `<text x="${x + cardW - 22}" y="${y + 30}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" font-weight="900" fill="${GOLD}">✓</text>` : `<text x="${x + cardW / 2}" y="${y + 150}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="15" fill="${MUTED}">bloqueada</text>`}`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0a1226"/>
    </linearGradient>
    <linearGradient id="goldline" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${GOLD}"/><stop offset="100%" stop-color="#ff8c00"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="900" cy="150" r="340" fill="#ffd60a" opacity="0.05"/>
  <circle cx="150" cy="1150" r="300" fill="#ff8c00" opacity="0.05"/>

  <text x="540" y="120" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="50" font-weight="800" fill="${TEXT}">🏆 CONQUISTAS</text>
  <text x="540" y="185" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="60" font-weight="900" fill="${GOLD}">MANGANANA</text>
  <rect x="390" y="215" width="300" height="6" rx="3" fill="url(#goldline)"/>
  <text x="540" y="275" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="30" fill="${MUTED}">${unlockedCount} de ${total} desbloqueadas</text>

  ${cards}

  <rect x="0" y="${H - 105}" width="${W}" height="105" fill="${NAVY2}"/>
  <text x="540" y="${H - 55}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" fill="${TEXT}">📖 manganana.vercel.app</text>
  <text x="540" y="${H - 22}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="${MUTED}">Histórias que viram mundos</text>
</svg>`;

fs.writeFileSync('/tmp/achv_card.svg', svg);
(async () => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync('/tmp/achv_card.png', png);
  console.log('card conquistas gerado:', png.length, 'bytes');
})();

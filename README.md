# 🍌 Manganana

> *Histórias que viram mundos.*

Aplicativo web de leitura de mangá em **português** — catálogo real com a **API do MangaDex**, capas oficiais, informações completas, leitor de capítulos com rolagem vertical, favoritos e histórico.

## ✨ Funcionalidades

- 🏠 **Início** — hero com destaque, mangás em alta, lançamentos recentes e "continue lendo"
- 🔍 **Explorar** — busca em tempo real + filtros por gênero (tags do MangaDex)
- 📚 **Biblioteca** — favoritos e histórico de leitura (salvos no navegador)
- 📖 **Leitor completo** — capítulos em PT-BR com:
  - Rolagem vertical ou modo página
  - Qualidade original ou economia de dados
  - Leitura RTL (direita → esquerda)
  - Navegação entre capítulos (anterior/próximo + lista)
  - Progresso salvo automaticamente
- 🌗 Tema escuro (padrão) e claro
- 📱 Layout mobile-first (estilo app com bottom nav)

## 🚀 Como rodar

```bash
cd manganana
python -m http.server 4173
```

Abra `http://localhost:4173`

## 📡 API utilizada

- **MangaDex API v5** — https://api.mangadex.org
- Busca de mangás com tradução em pt-br (`availableTranslatedLanguage[]=pt-br`)
- Capas: `uploads.mangadex.org/covers/{mangaId}/{fileName}`
- Capítulos: feed do mangá (`/manga/{id}/feed`)
- Páginas: servidor at-home (`/at-home/server/{chapterId}`)

> Obs: mangás licenciados (sem tradução pt-br no MangaDex) aparecem sem capítulos — é a política de distribuição da plataforma.

## 📁 Estrutura

```
manganana/
├── index.html   # Estrutura do app (SPA mobile-first)
├── styles.css   # Tema dark/amarelo, bottom nav, leitor
├── app.js       # API MangaDex, render, leitor, favoritos
└── vercel.json  # Deploy estático no Vercel
```

## 🛠️ Próximos passos

- [ ] Login e sincronização de favoritos na nuvem
- [ ] Leitura offline (PWA)
- [ ] Social: seguir amigos e ver o que estão lendo
- [ ] Chat entre leitores
- [ ] Notificações de novos capítulos

---

Feito para quem vive mil histórias. ✦

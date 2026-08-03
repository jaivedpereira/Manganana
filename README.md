# 🍌 Manganana

> *Histórias que viram mundos.*

Site de leitura de mangá em português — catálogo, busca, filtros por gênero, favoritos e tema escuro/claro. Feito com HTML + CSS + JS puro, sem dependências.

## ✨ Funcionalidades

- 🏠 Hero com arte em destaque e estatísticas
- 🔎 Busca em tempo real
- 🏷️ Filtros por gênero (Ação, Romance, Fantasia, Comédia, Drama)
- ❤️ Favoritos salvos no navegador (localStorage)
- 🌗 Tema escuro/claro
- 🎲 Botão "Estou com sorte"
- 📰 Newsletter
- 🎴 Modal de detalhes do mangá
- 📱 Layout responsivo (mobile-first)

## 🚀 Como rodar

```bash
cd manganana
python -m http.server 4173
```

Abra `http://localhost:4173`

## 📡 Integração com API

Estrutura pronta para integrar a [MangaDex API](https://api.mangadex.org) — busca por mangás traduzidos para português (`availableTranslatedLanguage[]=pt-br`). Em produção, recomenda-se um backend proxy para cache, CORS e filtragem de conteúdo/licenciamento.

## 📁 Estrutura

```
manganana/
├── index.html   # Página principal
├── styles.css   # Estilos (tema escuro/roxo, responsivo)
└── app.js       # Catálogo, busca, favoritos, modal
```

## 🛠️ Próximos passos

- [ ] Leitor de capítulos
- [ ] Login e perfis de usuário
- [ ] Histórico de leitura
- [ ] Sincronização entre dispositivos
- [ ] Painel administrativo

---

Feito para quem vive mil histórias. ✦

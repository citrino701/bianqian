# meu canto ✦

Feed pessoal visual: posts que crescem e encolhem, fotos jogadas, ligações e citações entre posts, zoom e aparência toda editável.

É um arquivo só: `index.html` (HTML + CSS + JS, sem build).
Os posts ficam no **Supabase** (projeto `bianqian`): tabelas `posts` e `site`, imagens no bucket privado `imagens`.
A primeira conta criada no site vira a dona; só ela escreve. Em **aparência → quem vê** dá pra deixar o feed público (todo mundo lê) ou privado.

## mexer
Abra `index.html` no navegador (ele já fala com o Supabase). Edite, salve, recarregue.

## publicar
Cada `git push` na branch `main` publica sozinho na Vercel.

## atalhos
`N` post · `T` texto solto · `A` aparência · `?` ajuda
ctrl+scroll = zoom · espaço+arrastar = rolar · alt+scroll num post = tamanho dele

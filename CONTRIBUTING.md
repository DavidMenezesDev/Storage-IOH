# Contribuindo

## Ambiente

```sh
make hooks   # ativa a validação de mensagens de commit (uma vez por clone)
make dev     # sobe API, worker, web, MinIO e dados de exemplo
make test    # testes do backend + lint/build do frontend
```

## Mensagens de commit

Seguimos [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/):

```
tipo(escopo): descrição curta no imperativo

Corpo opcional explicando o quê e por quê.

BREAKING CHANGE: o que quebrou e como migrar
Closes #123
```

- **Primeira linha**: até 72 caracteres, descrição em português, minúscula, no imperativo ("adiciona", "corrige"), sem ponto final.
- **Escopo** é opcional, mas recomendado.
- **Breaking change**: `!` antes dos dois-pontos (`feat(api)!: ...`) e o rodapé `BREAKING CHANGE:`.

| Tipo | Quando usar | Versão (SemVer) |
|---|---|---|
| `feat` | nova funcionalidade | minor |
| `fix` | correção de bug | patch |
| `perf` | melhoria de desempenho | patch |
| `refactor` | mudança de código sem alterar comportamento | — |
| `docs` | só documentação | — |
| `style` | formatação, sem mudança de lógica | — |
| `test` | testes | — |
| `build` | Docker, Makefile, dependências | — |
| `ci` | GitHub Actions | — |
| `chore` | manutenção que não se encaixa acima | — |
| `revert` | desfaz um commit anterior | — |

| Escopo | Área |
|---|---|
| `api` | API HTTP em `backend/` |
| `worker` | scanner, status e retenção |
| `db` | migrações e queries |
| `ingest` | upload por token (`/api/ingest`) |
| `alerts` | webhooks e e-mail |
| `web` | interface em `web/` |
| `docker` | `docker-compose*.yml` e Dockerfiles |
| `docs` | `docs/` e README |
| `deps` | atualização de dependências |
| `ci` | `.github/` |

Exemplos:

```
feat(web): adiciona filtro por status no painel
fix(worker): corrige cálculo de atraso com fuso horário
feat(ingest)!: exige cabeçalho X-Checksum no upload
build(deps): atualiza next para 16.5
```

O hook em `.githooks/commit-msg` valida o formato localmente (ative com `make hooks`, que também configura o template `.gitmessage` para o `git commit` sem `-m`).

## Pull requests

- Um PR por assunto; prefira PRs pequenos.
- **O título do PR segue o mesmo padrão dos commits** — o CI valida, e ele vira a mensagem do commit no *squash merge*.
- Preencha o modelo do PR (descrição, como testar, checklist).
- Mudanças visíveis ao usuário entram no `CHANGELOG.md`, seção `[Não lançado]`.

## Licença

Ao contribuir, você concorda que sua contribuição será licenciada sob a [GPL-3.0](LICENSE).

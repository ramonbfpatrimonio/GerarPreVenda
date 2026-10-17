# Gerar Pré-Venda

Programa desktop (Electron + React) que substitui a planilha `GERAR_PRE_VENDA.xlsm`.
Lê o pedido de compra em PDF (layout Bluesoft / Supermercados DB), confere os produtos no ERP
de cada cliente (SQL Server) e grava a pré-venda — tudo numa única transação.

- **Conexões por cliente**: cada cliente tem o seu banco (local ou na rede) e as suas regras.
  A faixa superior fica na cor da conexão ativa, para ninguém gerar no banco errado.
- **Login centralizado no Supabase**: o mesmo usuário em qualquer computador; papéis *admin* e *operador*.
- **Histórico central**: toda pré-venda gerada fica registrada na nuvem e o programa avisa
  quando o mesmo pedido de compra já foi lançado (no ERP ou por outro computador).
- **Atualização automática**: publique uma versão e todos os computadores atualizam sozinhos.

---

## 1. Supabase (uma vez)

1. Crie um projeto em <https://supabase.com>.
2. **SQL Editor** → cole e rode `supabase/migrations/001_inicial.sql`.
3. **Edge Function** (criar usuários e trocar senhas pelo programa):
   ```bash
   npx supabase login
   npx supabase link --project-ref SEU-PROJETO
   npx supabase functions deploy admin-usuarios
   ```
4. **Authentication → Providers → Email**: desligue *Allow new users to sign up*
   (só o administrador cria usuários).
5. **Authentication → Users → Add user**: crie o seu usuário (marque *Auto Confirm*).
6. No SQL Editor, torne-se administrador:
   ```sql
   update public.perfis set papel = 'admin', nome = 'Ramon' where email = 'seu-email@exemplo.com';
   ```
7. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   (*Project Settings → API*). A chave *anon* é pública por natureza; quem protege os dados são as políticas RLS.

Os demais usuários você cria pela aba **Usuários** do próprio programa.

---

## 2. Desenvolvimento

```bash
npm install
npm run dev        # abre o programa em modo desenvolvimento
npm test           # testes (leitor do PDF real + regras da planilha)
npm run typecheck
npm run demo       # só as telas, com dados simulados: http://localhost:5199/?logado
```

## 3. Gerar o instalador (no Windows)

```bash
npm run dist       # gera dist/GerarPreVenda-Setup-<versão>.exe
```

## 4. Atualização automática (nuvem)

As atualizações saem pelo **GitHub Releases** do repositório `ramonbfpatrimonio/gerar-pre-venda`
(configurado em `electron-builder.yml`, campo `publish`).

1. Crie o repositório **público** `gerar-pre-venda` na conta `ramonbfpatrimonio`.
   Se ele for privado, o programa instalado recebe erro 404 ao procurar atualizações.
2. Crie um token do GitHub com permissão `repo` e deixe-o na variável `GH_TOKEN`:
   ```powershell
   setx GH_TOKEN "ghp_xxxxxxxx"
   ```
3. A cada versão nova: aumente `"version"` no `package.json` (ex.: 1.0.0 → 1.0.1) e rode
   ```bash
   npm run release
   ```
Os programas instalados verificam ao abrir e a cada 4 horas, baixam em segundo plano e mostram
**"Reiniciar e atualizar"** na faixa superior.

---

## 5. Conexões com o SQL Server

Cadastre na aba **Conexões** (só administradores). Use **Testar conexão**: o programa lista os
bancos, confere as tabelas e colunas usadas, as permissões do usuário e mostra o que faltar.

| Situação | Como preencher |
|---|---|
| Banco neste computador | Servidor `localhost`, instância `SQLEXPRESS` (se for o caso) |
| Banco em outro PC da rede | Servidor `NOME-DO-PC` ou o IP; instância se houver |
| Porta fixa | Preencha a porta (a instância é ignorada) |

Se o teste disser que o servidor **não respondeu** ou **recusou a conexão**:

1. **SQL Server Configuration Manager** → *Protocolos para SQLEXPRESS* → habilite **TCP/IP** e reinicie o serviço.
2. Para instância nomeada sem porta, inicie o serviço **SQL Server Browser**.
3. No firewall do servidor, libere a porta **1433/TCP** (ou a porta da instância) e **1434/UDP** (Browser).

### Driver nativo (opcional)

O driver padrão conecta por TCP/IP e funciona sem instalar nada. O **ODBC nativo** (`msnodesqlv8`)
permite *autenticação do Windows* e conexão local com o TCP/IP desligado. Ele precisa ser compilado
para o Electron, o que exige o *Visual Studio Build Tools* (C++):

```bash
npm run rebuild:nativo   # antes do npm run dist
```

Sem isso, a opção aparece como "não instalado" na tela de conexões e o programa usa só o TCP/IP.

### Usuário do SQL só com o necessário (recomendado no lugar do `sa`)

```sql
CREATE LOGIN prevenda_app WITH PASSWORD = 'troque-esta-senha', CHECK_POLICY = ON;
USE [Hage.0001.Log];  -- repita para cada banco
CREATE USER prevenda_app FOR LOGIN prevenda_app;
GRANT SELECT                 ON dbo.Produtos        TO prevenda_app;
GRANT SELECT                 ON dbo.Clientes        TO prevenda_app;
GRANT SELECT, INSERT         ON dbo.Prevendas       TO prevenda_app;
GRANT INSERT                 ON dbo.PrevendasItens  TO prevenda_app;
GRANT SELECT, INSERT, UPDATE ON dbo.PrevendasIndice TO prevenda_app;
GRANT INSERT                 ON dbo.EventosSistema  TO prevenda_app;
```

### Regras por conexão

Valores que eram fixos no VBA e agora são configurados por cliente (os padrões são os da planilha):
equipe `1`, vendedor `001`, setor padrão `001` (ou o primeiro `Vendedor1..5` do cliente),
código do produto com 6 dígitos, CSTs com ST `10` e `70`, registro em `EventosSistema`.
Em **CNPJ da empresa deste banco**, informe o CNPJ do fornecedor (ex.: Hage 39.648.061/0001-03):
o programa sugere a conexão certa ao abrir o PDF e avisa se você estiver em outra.

As senhas dos bancos **não vão para a nuvem**: ficam cifradas pelo Windows neste computador.
Use **Exportar/Importar** para levar as conexões a outro PC (arquivo protegido por senha).

---

## 6. O que mudou em relação à planilha

- Número da pré-venda reservado com trava dentro de uma transação: não há mais números duplicados
  nem pré-venda gravada pela metade ou vazia.
- Produto não localizado **bloqueia** a geração (a planilha deixava de fora sem avisar).
- Leitura do PDF direto pelo texto: confere a soma com o "Valor de Mercadorias" do PDF.
- Conversões (caixa / unidade) e "abater ST" recalculadas sempre a partir do original: não acumulam.
- Total por linha `(Quantidade + Qtd. unid. ÷ Und. fornec.) × Valor`; números com ponto de milhar corretos.
- Uma consulta para todos os produtos (a planilha fazia milhares durante a importação).
- Consultas com parâmetros (apóstrofo no pedido não quebra mais nada).
- O nº do pedido de compra é lido no mesmo formato da planilha (`153331- 017`), para a conferência
  de duplicidade continuar valendo para pedidos lançados antes.

## Estrutura

```
src/shared/      regras da planilha, leitor do PDF, tipos (testados em tests/)
src/main/        processo principal: SQL Server, conexões, PDF, atualização
src/preload/     ponte segura entre a tela e o processo principal
src/renderer/    telas React (Pedido, Histórico, Conexões, Usuários, Login)
supabase/        SQL das tabelas/RLS e a Edge Function de usuários
```

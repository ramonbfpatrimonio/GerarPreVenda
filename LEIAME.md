# Gerar Pré-Venda

Programa desktop (Electron + React) que substitui a planilha `GERAR_PRE_VENDA.xlsm`.
Lê o pedido de compra em PDF (layout Bluesoft / Supermercados DB), confere os produtos no ERP
de cada cliente (SQL Server) e grava a pré-venda — tudo numa única transação.

- **Conexões por cliente**: cada cliente tem o seu banco (local ou na rede) e as suas regras.
  A faixa superior fica na cor da conexão ativa, para ninguém gerar no banco errado.
- **Várias empresas no mesmo Supabase**: cada empresa só vê os próprios usuários, conexões e histórico; você (super administrador) gerencia todas.
- **Funciona sem internet**: login offline por 7 dias e fila do histórico.
- **Histórico central**: toda pré-venda gerada fica registrada na nuvem e o programa avisa
  quando o mesmo pedido de compra já foi lançado (no ERP ou por outro computador).
- **Atualização automática**: publique uma versão e todos os computadores atualizam sozinhos.

---

## 1. Supabase

### Projeto novo (uma vez)
1. Crie um projeto em <https://supabase.com>.
2. **SQL Editor** → rode, nesta ordem, `001_inicial.sql`, `002_empresas.sql` e `003_eventos_aparencia.sql` (pasta `supabase/migrations`).
3. **Database → Extensions** → habilite **pg_cron** e rode o `002_empresas.sql` de novo (agenda a limpeza automática do histórico).
4. **Edge Functions → Deploy a new function → Via Editor**: nome `admin-usuarios`, cole `supabase/functions/admin-usuarios/index.ts`, **Deploy**.
5. **Authentication → Sign In / Providers → Email**: desligue *Allow new users to sign up*.
6. **Authentication → Users → Add user** (marque *Auto Confirm*) e, no SQL Editor:
   ```sql
   update public.perfis set papel = 'super_admin', nome = 'Ramon' where email = 'seu-email@exemplo.com';
   ```

### Atualização da versão 1.1 para a 1.2 (área administrativa, eventos, aparência)
1. **SQL Editor** → cole e rode `supabase/migrations/003_eventos_aparencia.sql` (pode rodar de novo sem problema).
   Ele cria a tabela de **eventos do sistema**, a de **aparência** (papel de parede e logo) e os gatilhos que registram
   sozinhos quem criou, alterou ou excluiu conexões, usuários, empresas, aparência e pré-vendas.
2. A Edge Function não mudou: não precisa publicar de novo.
3. Publique o instalador 1.2 (`npm run release`): os computadores atualizam sozinhos.

### Projeto que já estava rodando a versão 1.0 (atualização para várias empresas)
1. **SQL Editor** → rode `supabase/migrations/002_empresas.sql`. Ele:
   - cria a empresa **Hage** e coloca nela todos os usuários e o histórico que já existem;
   - transforma o primeiro administrador (você) em **super administrador**.
2. Habilite **pg_cron** (Database → Extensions) e rode o `002` mais uma vez.
3. **Edge Functions → admin-usuarios**: substitua o código pelo novo `index.ts` e clique em **Deploy**.
4. Instale a versão 1.1 do programa. Entre como super administrador, abra a área administrativa (Ctrl+Shift+B) → **Conexões** e clique em
   **Enviar para Hage** para subir as conexões que estavam só no seu computador.

O endereço e a chave *anon* do Supabase já estão em `src/renderer/src/servicos/nuvem.ts`
(um `.env` com `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` tem prioridade, se existir).
A chave *anon* é pública por natureza; quem protege os dados são as regras RLS do banco.

---

## Empresas, papéis e o que cada um vê

Na tela, todo mundo vê só **Pedido** e **Histórico**. O resto fica oculto na **área administrativa**:

| Papel | Vê e faz |
|---|---|
| **Super administrador** (você) | Todas as empresas: cria e bloqueia empresas, escolhe em qual empresa trabalhar na faixa do topo, vê histórico e eventos de todas |
| **Administrador da empresa** | Só a própria empresa: conexões, usuários, eventos, backups e aparência |
| **Operador** | Gera pré-vendas e vê o histórico da própria empresa. Não abre a área administrativa |

### Área administrativa (Ctrl + Shift + B)
- Em qualquer tela, aperte **Ctrl + Shift + B** e informe e-mail e senha de um administrador.
- Aparecem as abas **Conexões, Usuários, Eventos do sistema, Backups, Aparência** (e **Empresas** para o super administrador).
- É uma sessão separada: dá para abrir no computador de um operador sem desconectar ele; tudo o que for feito fica
  registrado no nome do administrador. Fecha sozinha após **10 minutos sem uso** ou em **Fechar administração**.
- Tentativas de operador ou senha errada ficam registradas nos eventos como **Negado**.

### Conexões ativas e desativadas
Em Conexões, desmarque **Conexão ativa** (ou clique em **Desativar**). Ela some da escolha de banco na faixa superior
e do pedido em todos os computadores da empresa, mas o cadastro continua lá para reativar depois.

### Eventos do sistema
Lista quem **criou, alterou, excluiu, salvou, gerou, entrou, saiu, fez backup, restaurou**, com **dia, hora com
segundos, estação (nome do computador) e usuário**. Filtros por período, ação, item e texto; **Exportar para Excel**.
Clique numa linha para ver os detalhes (o que era antes e o que ficou). Os registros de conexões, usuários, empresas,
aparência e pré-vendas são gravados pelo próprio banco (gatilhos), então não dependem do programa. Sem internet,
os eventos ficam na fila junto com as pré-vendas. São apagados junto com o histórico (prazo da empresa).

### Backups
- **Este computador:** um backup automático por dia ao abrir o programa em `Documentos\Gerar Pre-Venda\Backups`
  (conexões com as senhas do SQL cifradas, fila sem internet e aparência). Ficam os 30 mais recentes.
  **Restaurar** faz antes um backup do estado atual. As senhas só abrem no mesmo usuário do Windows.
- **Empresa na nuvem:** baixa um `.json` com usuários, conexões, histórico, eventos e aparência (sem senhas).
- **Senhas do SQL para outro computador:** Exportar/Importar conexões (arquivo protegido por senha).

### Aparência (papel de parede e logo do cliente)
Em **Aparência**, importe o papel de parede (ocupa 3/4 da tela de login, à esquerda; ideal 1920×1080) e a logo do
cliente (PNG transparente). As imagens são reduzidas sozinhas, guardadas na empresa e copiadas para cada computador,
então aparecem no login mesmo antes de entrar ou sem internet. A logo também vai para a barra superior.
Ícone do programa, da área de trabalho e a imagem lateral do instalador ficam em `build/` e `resources/`.

A separação é feita **pelo banco** (RLS), não só pela tela: mesmo com o programa modificado, uma empresa
não lê nem grava dados de outra. Os testes estão em `tests/sql/` (rodam num PostgreSQL comum:
`PGHOST=... PGUSER=postgres sh tests/sql/rodar.sh`).

**Cliente novo:** Empresas → **Nova empresa** (nome, CNPJ e o administrador) → instale o programa nos PCs do
cliente → o administrador dele entra, cadastra a conexão do ERP e cria os operadores.

**Conexões:** o cadastro (servidor, banco, cor, regras) fica na empresa e aparece em todos os computadores dela.
A **senha do SQL nunca vai para a nuvem**: cada computador informa uma vez e ela fica cifrada pelo Windows.

**Histórico:** guardado por 24 meses (ajustável por empresa em Empresas → Editar), apagado sozinho depois disso
pelo pg_cron. A pré-venda continua no ERP; sai só o registro da nuvem. Use **Exportar para Excel** se quiser guardar.

## Sem internet (modo offline)

- Quem já entrou naquele computador com internet consegue entrar sem internet por **7 dias** a partir do último
  acesso online (a verificação da senha fica cifrada no computador; a senha em si não é guardada).
- Gerar pré-venda funciona normalmente (o ERP está na rede local). O registro do histórico fica numa fila e é
  enviado sozinho quando a internet volta. A faixa do topo mostra **Sem internet** e quantos aguardam envio.
- Sem internet não dá para criar usuários, empresas ou alterar o cadastro de conexões.
- Usuário desativado ou empresa bloqueada perde o acesso offline no próximo contato com a internet.

### Limites do plano gratuito do Supabase
O programa grava menos de 1 KB por pré-venda (só o resumo). O plano gratuito pausa o projeto após 7 dias
sem nenhum uso e não tem backup automático; com vários clientes, considere o plano Pro.

---

## 2. Desenvolvimento

```bash
npm install
npm run dev        # abre o programa em modo desenvolvimento
npm test           # testes (leitor do PDF real + regras da planilha)
sh tests/sql/rodar.sh  # testes de isolamento entre empresas (precisa de um PostgreSQL)
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
Em **Backups**, use **Exportar/Importar conexões** para levar as conexões a outro PC (arquivo protegido por senha).

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
